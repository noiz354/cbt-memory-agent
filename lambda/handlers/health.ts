/**
 * Health + Metrics Handlers — GET /api/v1/health, /api/v1/metrics
 */

import { APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { OpenRouterClient } from "../lib/openrouter";
import { S3ClientService } from "../lib/s3";

export async function handleHealth(
  crdb: CrdbClient,
  llm: OpenRouterClient,
  s3: S3ClientService,
): Promise<APIGatewayProxyResult> {
  const [crdbOk, llmAvail, s3Ok] = await Promise.all([
    crdb.healthCheck(),
    llm.checkChatAvailability(),
    s3.healthCheck(),
  ]);

  // Jujur: /credits 200 bahkan saat total_credits=0. Probe chat aktual yang
  // menentukan: kuota free-tier habis → degraded + llm=quota_exhausted.
  const llmState = !llmAvail.available
    ? llmAvail.quotaExhausted
      ? "quota_exhausted"
      : "unavailable"
    : "available";
  const allOk = crdbOk && llmAvail.available && s3Ok;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: allOk ? "ok" : "degraded",
      crdb: crdbOk ? "connected" : "disconnected",
      llm: llmState,
      s3: s3Ok ? "available" : "unavailable",
      version: "0.1.0",
    }),
  };
}

export async function handleMetrics(
  crdb: CrdbClient,
  token: string,
  _deviceId: string,
): Promise<APIGatewayProxyResult> {
  try {
    const [auditRows, memoryRow, sessionRows, turnRow] = await Promise.all([
      crdb.query<{ type: string; count: string }>(
        `SELECT type, COUNT(*)::INT AS count FROM audit_events
         WHERE user_id = md5($1::string)::uuid
         GROUP BY type`,
        [token],
      ),
      crdb.queryOne<{
        nodeCount: string;
        edgeCount: string;
        avgConfidence: string | null;
        totalRefCount: string | null;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM memory_nodes WHERE user_id = md5($1::string)::uuid)::INT AS nodeCount,
           (SELECT COUNT(*) FROM memory_edges WHERE user_id = md5($1::string)::uuid)::INT AS edgeCount,
           (SELECT AVG(confidence) FROM memory_nodes WHERE user_id = md5($1::string)::uuid) AS avgConfidence,
           (SELECT COALESCE(SUM(ref_count),0) FROM memory_nodes WHERE user_id = md5($1::string)::uuid)::INT AS totalRefCount`,
        [token],
      ),
      crdb.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::INT AS count FROM sessions
         WHERE user_id = md5($1::string)::uuid
         GROUP BY status`,
        [token],
      ),
      crdb.queryOne<{ turnCount: string; crisisCount: string }>(
        `SELECT
           (SELECT COUNT(*) FROM chat_turns WHERE user_id = md5($1::string)::uuid)::INT AS turnCount,
           (SELECT COUNT(*) FROM audit_events WHERE user_id = md5($1::string)::uuid AND type IN ('CRISIS_ENGAGED','CRISIS_DISMISSED'))::INT AS crisisCount`,
        [token],
      ),
    ]);

    const audit: Record<string, number> = {};
    for (const row of auditRows) audit[row.type] = Number(row.count);
    const sessions: Record<string, number> = {};
    for (const row of sessionRows) sessions[row.status] = Number(row.count);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        v: 2,
        northStar: {
          activeSessions: sessions.extracted ?? 0,
          chatTurns: Number(turnRow?.turnCount ?? 0),
          memoryNodes: Number(memoryRow?.nodeCount ?? 0),
          crisisEvents: Number(turnRow?.crisisCount ?? 0),
        },
        metrics: {
          sessions,
          memory: {
            nodes: Number(memoryRow?.nodeCount ?? 0),
            edges: Number(memoryRow?.edgeCount ?? 0),
            avgConfidence: memoryRow?.avgConfidence != null ? Number(Number(memoryRow.avgConfidence).toFixed(2)) : null,
            totalRefCount: Number(memoryRow?.totalRefCount ?? 0),
          },
          audit,
        },
        guardrails: {},
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: 2, error: err instanceof Error ? err.message : "metrics failed" }),
    };
  }
}
