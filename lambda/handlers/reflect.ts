/**
 * Reflection Handler — cron EventBridge `agent.memory.reflect` (tiap 6 jam).
 *
 * Bukan endpoint HTTP; dipanggil langsung oleh EventBridge rule dengan event
 * berformat `{ "source": "agent.memory", "detail-type": "reflect" }`.
 * Menjalankan agentic memory loop: aktifkan user → ekstrak durable facts →
 * upsert memory_nodes (kind=core, verified, confidence tinggi) + embedding.
 */

import { Context } from "@opentelemetry/api";
import { CrdbClient } from "../lib/crdb";
import { OpenRouterClient } from "../lib/openrouter";
import { runReflectionForActiveUsers } from "../lib/reflection";
import { logger } from "../lib/logger";

export interface ReflectionHandlerResult {
  v: 1;
  ok: true;
  reflectedAt: string;
  userFacts: number;
  errors: number;
  skipped: number;
}

/**
 * Entry point untuk EventBridge. Menerima raw event (bukan APIGatewayProxyEvent)
 * — detail event tidak dipakai, hanya trigger. Return objek JSON (bukan HTTP).
 */
export async function handleReflect(
  crdb: CrdbClient,
  llm: OpenRouterClient,
  _rootCtx: Context,
): Promise<ReflectionHandlerResult> {
  const result = await runReflectionForActiveUsers(crdb, llm);

  logger.info("reflection.completed", "Reflection run completed", {
    userFacts: result.userFacts,
    errors: result.errors,
    skipped: result.skipped,
  });

  return {
    v: 1,
    ok: true,
    reflectedAt: result.reflectedAt,
    userFacts: result.userFacts,
    errors: result.errors,
    skipped: result.skipped,
  };
}
