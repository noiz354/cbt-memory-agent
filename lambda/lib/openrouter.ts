/**
 * OpenRouter Client — LLM chat + embeddings untuk CBT Memory Agent.
 *
 * Menggantikan Amazon Bedrock (keputusan 2026-08-14):
 * - Chat:      meta-llama/llama-3.3-70b-instruct:free (streaming SSE)
 * - Embedding: baai/bge-m3 (1024-dim, verified 2026-08-14)
 *
 * Catatan: snowflake/snowflake-arctic-embed TIDAK ADA di OpenRouter (HTTP 400).
 * baai/bge-m3 = 1024-dim, cocok schema embeddings.embedding vector(1024).
 *
 * API key dari environment: OPENROUTER_API_KEY
 */

const BASE_URL = "https://openrouter.ai/api/v1";

import { logger } from "./logger";
import { context, trace } from "@opentelemetry/api";
import {
  ATTR_GEN_AI_SYSTEM,
  ATTR_GEN_AI_OPERATION_NAME,
} from "@opentelemetry/semantic-conventions/incubating";
import { recordGenAiOperation } from "./telemetry";

export const CHAT_MODEL = "openrouter/free";
export const EMBED_MODEL = "baai/bge-m3";
export const EMBED_DIM = 1024;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResult {
  content: string;
  tokensUsed: number;
}

export class OpenRouterClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    if (!this.apiKey) {
      logger.warn("llm.openrouter_missing_key", "OPENROUTER_API_KEY not set — OpenRouter calls will fail");
    }
  }

  /**
   * Generate embedding vector untuk sebuah teks.
   * bge-m3 = 1024-dim (verified 2026-08-14), cocok schema vector(1024).
   * Jika dimensi tidak cocok, lempar error jelas (jangan simpan ke schema).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const trimmed = text.slice(0, 8000);

    const tracer = trace.getTracer("cbt-memory-agent-backend", "0.1.0");
    const parentCtx = context.active();
    const span = tracer.startSpan("llm.embedding", { attributes: {} }, parentCtx);
    const startedAt = Date.now();

    span.setAttribute(ATTR_GEN_AI_SYSTEM, "openrouter");
    span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, "embeddings");
    span.setAttribute("gen_ai.request.model", EMBED_MODEL);

    try {
      const res = await context.with(trace.setSpan(parentCtx, span), async () => {
        const resp = await fetch(`${BASE_URL}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: EMBED_MODEL, input: trimmed }),
        });

        if (!resp.ok) {
          throw new Error(`OpenRouter embeddings ${EMBED_MODEL}: HTTP ${resp.status} ${resp.statusText}`);
        }

        const data = (await resp.json()) as {
          data?: { embedding?: number[] }[];
        };
        const embedding = data.data?.[0]?.embedding;
        if (!embedding || embedding.length === 0) {
          throw new Error(`OpenRouter embeddings ${EMBED_MODEL}: empty result`);
        }
        if (embedding.length !== EMBED_DIM) {
          throw new Error(
            `Embedding dim ${embedding.length} != ${EMBED_DIM} for ${EMBED_MODEL} — check EMBED_MODEL`,
          );
        }
        return embedding;
      });
      return res;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
      recordGenAiOperation("embeddings", Date.now() - startedAt);
    }
  }

  /**
   * Stream chat response dari OpenRouter.
   * Yields chunk teks per delta; resolve `{ content, tokensUsed }` saat selesai.
   */
  async *streamChat(
    messages: ChatMessage[],
    opts: { maxTokens?: number } = {},
  ): AsyncGenerator<string, ChatResult> {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        stream: true,
        max_tokens: opts.maxTokens ?? 1024,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter chat: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("OpenRouter chat: response body not readable");

    const decoder = new TextDecoder();
    let content = "";
    let tokensUsed = 0;
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") break;

          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
              usage?: { total_tokens?: number };
            };
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              content += delta;
              tokensUsed += Math.max(1, Math.ceil(delta.length / 4));
              yield delta;
            }
            if (json.usage?.total_tokens) tokensUsed = json.usage.total_tokens;
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { content, tokensUsed };
  }

  /** Health check — verifikasi API key valid + service reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/credits`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
