/**
 * Reflection lib — agentic memory loop: konversi percakapan menjadi durable memory.
 *
 * Alur (dipicu oleh cron EventBridge `agent.memory.reflect` tiap 6 jam):
 *   1. Ambil user aktif terakhir (window 7d) + chat_turns terbaru.
 *   2. Kirim turn-turns (tanpa PII) ke LLM untuk ekstraksi best-effort JSON:
 *      - durable facts/patterns/mood (yang layak diingat lama)
 *      - guardrail: jangan ambil identitas, info medis sensitif, dll.
 *   3. Upsert memory_nodes kind=core, verified=true, confidence tinggi, + embedding.
 *   4. Catat audit_events type=REFLECTION_RAN.
 *
 * Semua ekstraksi best-effort — kegagalan LLM/embedding tidak menggagalkan cron.
 */

import { CrdbClient } from "./crdb";
import { OpenRouterClient } from "./openrouter";
import { writeNodeEmbedding } from "./vectorWriter";
import { logger } from "./logger";

/** Faktur durable hasil ekstraksi LLM. */
export interface ReflectionFact {
  title: string;
  excerpt: string;
  confidence?: number;
  tags?: string[];
}

export interface ReflectionResult {
  userFacts: number;
  errors: number;
  skipped: number;
  reflectedAt: string;
}

export const REFLECT_AUDIT_TYPE = "REFLECTION_RAN";
export const REFLECT_KIND = "core";
export const REFLECT_MAX_FACTS = 8;
export const REFLECT_MAX_TURNS = 20;
export const REFLECT_WINDOW_DAYS = 7;
export const REFLECT_MIN_CONFIDENCE = 0.8;

/**
 * Jalankan reflection untuk SEMUA user aktif dalam window (panggil per-user via
 * `reflectUser`). Menangani error per-user tanpa menggagalkan user lain.
 */
export async function runReflectionForActiveUsers(
  crdb: CrdbClient,
  llm: OpenRouterClient,
  opts: { windowDays?: number; limitUsers?: number } = {},
): Promise<ReflectionResult> {
  const windowDays = opts.windowDays ?? REFLECT_WINDOW_DAYS;
  const activeUsers = await crdb.query<{ user_id: string }>(
    `SELECT DISTINCT ct.user_id
     FROM chat_turns ct
     WHERE ct.created_at > now() - (INTERVAL '1 day' * $1::int)
     ORDER BY ct.user_id
     LIMIT $2`,
    [windowDays, opts.limitUsers ?? 500],
  );

  let userFacts = 0;
  let errors = 0;
  let skipped = 0;

  for (const { user_id: userId } of activeUsers) {
    try {
      const res = await reflectUser(crdb, llm, userId, { windowDays });
      userFacts += res.factsUpserted;
      skipped += res.skipped;
    } catch (err) {
      errors += 1;
      logger.warn("reflection.user_failed", "Reflection failed for user", {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    userFacts,
    errors,
    skipped,
    reflectedAt: new Date().toISOString(),
  };
}

/**
 * Reflection untuk SATU user: ambil turn terbaru, ekstrak fakta, upsert ke
 * memory_nodes (kind=core, verified, confidence tinggi) + embedding.
 */
export async function reflectUser(
  crdb: CrdbClient,
  llm: OpenRouterClient,
  userId: string,
  opts: { windowDays?: number; maxTurns?: number } = {},
): Promise<{ factsUpserted: number; skipped: number }> {
  const windowDays = opts.windowDays ?? REFLECT_WINDOW_DAYS;
  const maxTurns = opts.maxTurns ?? REFLECT_MAX_TURNS;

  const turns = await crdb.query<{ role: string; content: string }>(
    `SELECT role, content
     FROM chat_turns
     WHERE user_id = $1::uuid AND created_at > now() - (INTERVAL '1 day' * $2::int)
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, windowDays, maxTurns],
  );
  if (turns.length === 0) return { factsUpserted: 0, skipped: 0 };

  // Reverse → kronologis (kita ambil DESC, balikkan ke urutan asli).
  const chronological = [...turns].reverse();

  const facts = await extractReflectionFacts(llm, chronological);
  if (facts.length === 0) return { factsUpserted: 0, skipped: 0 };

  let factsUpserted = 0;
  let skipped = 0;

  for (const fact of facts.slice(0, REFLECT_MAX_FACTS)) {
    try {
      await upsertReflectionFact(crdb, llm, userId, fact);
      factsUpserted += 1;
    } catch (err) {
      skipped += 1;
      logger.warn("reflection.fact_failed", "Reflection fact upsert skipped", {
        userId,
        title: fact.title,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { factsUpserted, skipped };
}

/**
 * Ekstraksi best-effort via LLM. Prompt meminta JSON strict (tanpa PII).
 * Output diparse dengan fallback lenient (cari blok [ ... ] / { ... }).
 */
export async function extractReflectionFacts(
  llm: OpenRouterClient,
  turns: { role: string; content: string }[],
): Promise<ReflectionFact[]> {
  const transcript = turns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, 500)}`)
    .join("\n");

  const systemPrompt = `You are the reflection module of a CBT memory assistant.
Extract durable, long-term-useful facts from the therapy conversation that the assistant should remember to personalize future sessions.

Requirements:
- Output STRICT JSON array: [{"title": "...", "excerpt": "...", "confidence": 0.9, "tags": ["..."]}]
- title: short label (max 60 chars). excerpt: 1-2 sentences summary (max 200 chars).
- confidence: 0-1 how confident this fact is true & stable. tags: 0-3 short tags.
- Extract at most 8 facts. Empty array if nothing durable.
- NEVER extract: real names, phone numbers, addresses, employer names, or any personal identifying information.
- NEVER fabricate. Only facts clearly stated by the user.
- Patterns/moods/themes count as durable facts (e.g. "prefers morning sessions", "struggles with sleep-onset anxiety").`;

  const userPrompt = `Conversation (no PII expected):
${transcript}

Output JSON array of durable facts:`;

  let raw: string;
  try {
    const res = await llm.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 1024 },
    );
    raw = res.content;
  } catch (err) {
    logger.warn("reflection.extract_failed", "Reflection LLM extract failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  return parseReflectionJson(raw);
}

/** Parse JSON hasil LLM dengan fallback lenient. */
export function parseReflectionJson(raw: string): ReflectionFact[] {
  const trimmed = raw.trim();

  const tryParse = (s: string): ReflectionFact[] | null => {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
          .map((f) => ({
            title: String(f.title ?? "").slice(0, 60),
            excerpt: String(f.excerpt ?? "").slice(0, 200),
            confidence: clampConfidence(
              typeof f.confidence === "number" ? f.confidence : parseFloat(String(f.confidence ?? "")),
            ),
            tags: Array.isArray(f.tags) ? f.tags.map((t) => String(t).slice(0, 30)) : [],
          }))
          .filter((f) => f.title.trim().length > 0 && f.excerpt.trim().length > 0);
      }
    } catch {
      return null;
    }
    return null;
  };

  // 1. Coba langsung
  const direct = tryParse(trimmed);
  if (direct) return direct;

  // 2. Cari blok array/objek pertama di dalam teks (LLM kadang menambah prosa)
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const fromArray = tryParse(arrayMatch[0]);
    if (fromArray) return fromArray;
  }
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const fromObj = tryParse(`[${objMatch[0]}]`);
    if (fromObj) return fromObj;
  }

  return [];
}

/** Clamp confidence ke [0,1]; NaN/blank → default REFLECT_MIN_CONFIDENCE. */
function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return REFLECT_MIN_CONFIDENCE;
  return Math.min(1, Math.max(0, value));
}

/**
 * Upsert satu reflection fact ke memory_nodes (kind=core, verified=true,
 * confidence tinggi, ref_count +1 per refleksi) + embedding via vectorWriter.
 * Idempotent: ON CONFLICT (id) DO UPDATE dengan id deterministik dari hash teks.
 */
async function upsertReflectionFact(
  crdb: CrdbClient,
  llm: OpenRouterClient,
  userId: string,
  fact: ReflectionFact,
): Promise<void> {
  const id = await deterministicNodeId(crdb, userId, fact.title);
  const confidence = Math.min(1, Math.max(0, fact.confidence ?? REFLECT_MIN_CONFIDENCE));
  const weight = 0.8;
  const now = new Date().toISOString();

  await crdb.execute(
    `INSERT INTO memory_nodes (id, user_id, kind, title, excerpt, tags, weight, confidence, verified, ref_count, last_touched, x, y, crisis_flag)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, true, 1, $9, 0, 0, false)
     ON CONFLICT (id) DO UPDATE SET
       title       = EXCLUDED.title,
       excerpt     = EXCLUDED.excerpt,
       tags        = EXCLUDED.tags,
       weight      = EXCLUDED.weight,
       confidence  = EXCLUDED.confidence,
       verified    = true,
       ref_count   = memory_nodes.ref_count + 1,
       last_touched = EXCLUDED.last_touched
     WHERE memory_nodes.user_id = $2::uuid`,
    [id, userId, REFLECT_KIND, fact.title, fact.excerpt, fact.tags ?? [], weight, confidence, now],
  );

  await writeNodeEmbedding(crdb, llm, userId, { id, title: fact.title, excerpt: fact.excerpt, tags: fact.tags });

  await crdb.execute(
    `INSERT INTO audit_events (user_id, type, detail)
     VALUES ($2::uuid, $1, $3)
     ON CONFLICT DO NOTHING`,
    [REFLECT_AUDIT_TYPE, userId, JSON.stringify({ factTitle: fact.title })],
  );
}

/** Id deterministik dari (user, title) — refleksi yang sama menghasilkan node yang sama. */
async function deterministicNodeId(
  crdb: CrdbClient,
  userId: string,
  title: string,
): Promise<string> {
  const row = await crdb.queryOne<{ node_id: string }>(
    `SELECT md5($1::string || '::' || $2::string)::uuid::text AS node_id`,
    [userId, title],
  );
  return row?.node_id ?? "";
}
