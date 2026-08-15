/**
 * Chat Turn Handler — POST /api/v1/chat/turn
 *
 * 1. Parse & validasi body (zod)
 * 2. Upsert user (md5(token)::uuid) — frontend mengirim profile.id non-UUID
 * 3. Ambil memory context dari CRDB (nodes yang di-refer + verified nodes)
 * 4. Bangun CBT prompt (tanpa PII)
 * 5. Stream OpenRouter → SSE `data: {t:"..."}` + `data: [DONE]`
 * 6. Simpan chat_turns (user + assistant)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { Context } from "@opentelemetry/api";
import { CrdbClient } from "../lib/crdb";
import { OpenRouterClient } from "../lib/openrouter";
import { withSpan } from "../lib/telemetry";
import { logger } from "../lib/logger";

const chatTurnSchema = z.object({
  v: z.literal(1),
  sessionId: z.string().min(1),
  userMessage: z.string().min(1).max(20000),
  memoryIds: z.array(z.string()).optional(),
  clientTs: z.string().optional(),
  deviceOnly: z.literal(true).optional(),
});

const SYSTEM_PROMPT = `You are a supportive CBT (Cognitive-Behavioral Therapy) assistant.
Follow these guardrails:
- Respond with warmth, curiosity, and evidence-based CBT techniques (cognitive restructuring, Socratic questioning, behavioral activation).
- Use the user's stored memory context below to personalize responses. Do NOT invent memories that are not provided.
- NEVER store or echo personal identifying details (real names, phone numbers, addresses, passwords).
- If the user expresses thoughts of self-harm or suicide, respond with immediate empathy and urge them to contact local crisis services (in Indonesia: 119, or emergency 112).
- Keep responses concise (under ~250 words) and end with one gentle, actionable question.
- If there is no memory context, acknowledge the user warmly and ask how they are feeling.`;

interface MemoryContext {
  id: string;
  title: string;
  excerpt: string | null;
  crisisFlag: boolean;
}

export async function handleChatTurn(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  llm: OpenRouterClient,
  token: string,
  deviceId: string,
  rootCtx: Context,
): Promise<APIGatewayProxyResult> {
  const cors = {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };

  // 1. Parse body
  let body: z.infer<typeof chatTurnSchema>;
  try {
    body = chatTurnSchema.parse(JSON.parse(event.body ?? "{}"));
  } catch {
    return {
      statusCode: 400,
      headers: cors,
      body: "data: " + JSON.stringify({ t: "Invalid request body" }) + "\n\ndata: [DONE]\n\n",
    };
  }

  try {
    // 2. Upsert user — deterministic UUID dari token
    const userId = await upsertUser(crdb, token);

    // 3. Memory context (span semantik bisnis; span db.query dibuat oleh wrapper crdb)
    const memories = await withSpan(
      "agent.memory.retrieve",
      rootCtx,
      async (span) => {
        const rows = await getMemoryContext(crdb, userId, body.memoryIds ?? []);
        span.setAttribute("memory.ids_requested", body.memoryIds?.length ?? 0);
        span.setAttribute("memory.results", rows.length);
        return rows;
      },
      { attributes: { "memory.ids_requested": body.memoryIds?.length ?? 0 } },
    );

    // 4. Build prompt
    const contextBlock =
      memories.length > 0
        ? "Stored memories (use to personalize):\n" +
          memories
            .map((m) => `- [${m.title}]${m.crisisFlag ? " (CRISIS-RELATED)" : ""}: ${m.excerpt ?? ""}`)
            .join("\n")
        : "No stored memories for this user yet.";

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "system" as const,
        content: `Memory context:\n${contextBlock}`,
      },
      { role: "user" as const, content: body.userMessage },
    ];

    // 5. Stream response
    let fullContent = "";
    let tokensUsed = 0;

    const llmResult = await withSpan(
      "llm.openrouter",
      rootCtx,
      async (span) => {
        span.setAttribute("gen_ai.operation.name", "chat");
        span.setAttribute("gen_ai.request.model", "openrouter/free");
        span.setAttribute("gen_ai.request.max_tokens", 1024);

        const stream = llm.streamChat(messages);
        let content = "";
        let tokens = 0;
        while (true) {
          const { done, value } = await stream.next();
          if (done) {
            tokens = (value as { tokensUsed: number } | undefined)?.tokensUsed ?? 0;
            break;
          }
          content += value;
        }
        span.setAttribute("gen_ai.usage.output_tokens", tokens);
        return { content, tokens };
      },
      { attributes: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "openrouter/free" } },
    );
    fullContent = llmResult.content;
    tokensUsed = llmResult.tokens;

    if (!fullContent.trim()) {
      fullContent = "Maaf, saya tidak bisa memproses pesan itu saat ini. Coba lagi ya.";
    }

    // 6. Save chat_turns (span db.query dibuat otomatis oleh wrapper crdb)
    await upsertSession(crdb, userId, body.sessionId);
    await saveChatTurn(crdb, userId, body.sessionId, "user", body.userMessage, 0, body.memoryIds ?? []);
    await saveChatTurn(crdb, userId, body.sessionId, "assistant", fullContent, tokensUsed, []);

    const sse =
      fullContent
        .split("\n")
        .map((line) => "data: " + JSON.stringify({ t: line }) + "\n\n")
        .join("") + "data: [DONE]\n\n";

    return {
      statusCode: 200,
      headers: cors,
      body: sse,
    };
  } catch (err) {
    logger.error("chat.turn_failed", "chatTurn error", {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 200,
      headers: cors,
      body:
        "data: " +
        JSON.stringify({ t: "Terjadi kendala teknis. Coba lagi dalam beberapa saat." }) +
        "\n\ndata: [DONE]\n\n",
    };
  }
}

async function upsertUser(crdb: CrdbClient, token: string): Promise<string> {
  const userId = await crdb.queryOne<{ user_id: string }>(
    `SELECT md5($1::string)::uuid::text AS user_id`,
    [token],
  );
  const userIdVal = userId?.user_id ?? "";

  await crdb.execute(
    `INSERT INTO users (id, email, display_name, auth_method)
     VALUES (md5($1::string)::uuid, $1, 'device-user', 'passkey')
     ON CONFLICT (id) DO NOTHING`,
    [token],
  );
  return userIdVal;
}

async function getMemoryContext(
  crdb: CrdbClient,
  userId: string,
  memoryIds: string[],
): Promise<MemoryContext[]> {
  const rows = await crdb.query<MemoryContext>(
    `SELECT id, title, COALESCE(excerpt, '') AS excerpt, COALESCE(crisis_flag, false) AS crisisFlag
     FROM memory_nodes
     WHERE user_id = $1::uuid
       AND verified = true
       AND confidence >= 0.6
       AND (id = ANY($2::string[]) OR $2::string[] = '{}')
     ORDER BY weight DESC, last_touched DESC
     LIMIT 8`,
    [userId, memoryIds],
  );
  return rows;
}

async function upsertSession(crdb: CrdbClient, userId: string, sessionId: string): Promise<void> {
  await crdb.execute(
    `INSERT INTO sessions (id, user_id, title, status, started_at)
     VALUES ($1, $2::uuid, 'Session', 'pending', now())
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, userId],
  );
}

async function saveChatTurn(
  crdb: CrdbClient,
  userId: string,
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  tokensUsed: number,
  injectedMemoryIds: string[],
): Promise<void> {
  await crdb.execute(
    `INSERT INTO chat_turns (user_id, session_id, role, content, tokens_used, injected_memory_ids)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
    [userId, sessionId, role, content, tokensUsed, injectedMemoryIds],
  );
}
