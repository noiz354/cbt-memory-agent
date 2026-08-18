/**
 * On-device LLM engine — wraps @mlc-ai/web-llm MLCEngine.
 *
 * Lazily initializes on first call; downloads the model once and streams tokens.
 * The configured model matches the one referenced in llmRegistry for local-webllm.
 */

import * as webllm from "@mlc-ai/web-llm";
import { withSpan } from "./telemetry";

const MODEL_ID = "Phi-3-mini-4k-instruct-q4f16_1-MLC";

let engine: webllm.MLCEngine | null = null;
let initPromise: Promise<webllm.MLCEngine> | null = null;
let progress = 0;

type ProgressListener = (p: number) => void;
const listeners = new Set<ProgressListener>();

export function getOnDeviceLoadProgress(): number {
  return progress;
}

export function subscribeOnDeviceProgress(cb: ProgressListener): () => void {
  listeners.add(cb);
  cb(progress);
  return () => listeners.delete(cb);
}

function setProgress(p: number): void {
  progress = p;
  listeners.forEach((cb) => cb(progress));
}

function initEngine(): Promise<webllm.MLCEngine> {
  if (engine) return Promise.resolve(engine);
  if (!initPromise) {
    initPromise = (async () => {
      const e = new webllm.MLCEngine();
      e.setInitProgressCallback((p) => setProgress(p.progress));
      setProgress(0);
      await e.reload(MODEL_ID);
      engine = e;
      setProgress(1);
      return e;
    })();
  }
  return initPromise;
}

/** Kick off the model download without waiting on it. Safe to call repeatedly. */
export function preloadOnDeviceEngine(): Promise<webllm.MLCEngine> {
  return initEngine();
}

export function isOnDeviceEngineReady(): boolean {
  return engine !== null;
}

/**
 * Streaming generation against the on-device engine.
 * Throws when WebLLM/WASM/WebGPU is unsupported or the model fails to load.
 */
export async function generateOnDevice(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onDelta?: (delta: string) => void,
): Promise<{ content: string; tokensUsed: number }> {
  const e = await initEngine();
  return withSpan(
    "agent.ondevice",
    async (span) => {
      span.setAttribute("gen_ai.provider", "webllm");
      span.setAttribute("gen_ai.request.model", MODEL_ID);
      span.setAttribute("gen_ai.request.temperature", 0.7);
      span.setAttribute("openinference.span.kind", "LLM");

      const completion = await e.chat.completions.create({
        messages: messages as webllm.ChatCompletionMessageParam[],
        stream: Boolean(onDelta),
        temperature: 0.7,
        max_tokens: 2048,
      });

      let fullContent = "";
      if (onDelta && Symbol.asyncIterator in completion) {
        const stream = completion as unknown as AsyncIterable<{
          choices: { delta?: { content?: string } }[];
        }>;
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullContent += delta;
            onDelta(delta);
          }
        }
      } else {
        const usage = (completion as unknown as { usage?: { completion_tokens?: number } }).usage;
        fullContent = (completion as unknown as { choices?: { message?: { content?: string } }[] })
          .choices?.[0]?.message?.content ?? "";
        span.setAttribute("gen_ai.usage.output_tokens", usage?.completion_tokens ?? 0);
        span.setAttribute("gen_ai.response.model", MODEL_ID);
        span.setAttribute("gen_ai.response.text", fullContent);
        return { content: fullContent, tokensUsed: usage?.completion_tokens ?? 0 };
      }

      span.setAttribute("gen_ai.response.model", MODEL_ID);
      span.setAttribute("gen_ai.response.text", fullContent);
      return { content: fullContent, tokensUsed: 0 };
    },
    { attributes: { "gen_ai.usage.input_tokens": messages.length, "gen_ai.request.input": JSON.stringify(messages) } },
  );
}
