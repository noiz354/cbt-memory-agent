/**
 * Export Handler — POST /api/v1/export
 *
 * Gathers the user's full data bundle (sessions, memories, chat turns) from
 * CockroachDB, uploads it to S3 (SSE-AES256) and returns a presigned download URL.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { S3ClientService } from "../lib/s3";
import { AppError, errorEnvelope, reportError } from "../lib/errors";

export async function handleExport(
  _event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  s3: S3ClientService,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  try {
    if (!process.env.S3_BUCKET) {
      return {
        statusCode: 501,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(errorEnvelope(new AppError("resource.misconfigured", { message: "S3 export bucket is not configured." }))),
      };
    }

    const [sessions, memories, edges, turns, audit] = await Promise.all([
      crdb.query(
        `SELECT id, title, status, mood, mood_label, started_at, duration_min, excerpt, thought, reframe, created_at
         FROM sessions WHERE user_id = md5($1::string)::uuid ORDER BY created_at DESC`,
        [token],
      ),
      crdb.query(
        `SELECT id, kind, title, excerpt, tags, weight, confidence, verified, ref_count, last_touched, x, y, crisis_flag, created_at
         FROM memory_nodes WHERE user_id = md5($1::string)::uuid ORDER BY created_at DESC`,
        [token],
      ),
      crdb.query(
        `SELECT id, source, target, label, created_at
         FROM memory_edges WHERE user_id = md5($1::string)::uuid ORDER BY created_at`,
        [token],
      ),
      crdb.query(
        `SELECT id, session_id, role, content, tokens_used, injected_memory_ids, created_at
         FROM chat_turns WHERE user_id = md5($1::string)::uuid ORDER BY created_at ASC`,
        [token],
      ),
      crdb.query(
        `SELECT type, detail, created_at
         FROM audit_events WHERE user_id = md5($1::string)::uuid ORDER BY created_at ASC`,
        [token],
      ),
    ]);

    const bundle = {
      v: 2,
      exportedAt: new Date().toISOString(),
      deviceId,
      user: { displayName: "device-user" },
      sessions,
      memories,
      edges,
      turns,
      audit,
    };

    // Reuse the deterministic user id convention (md5(token)::uuid) as the S3 prefix.
    const userKey = token.length >= 8 ? token : deviceId;
    const s3Url = await s3.uploadExport(userKey, bundle);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        v: 2,
        ok: true,
        s3Url,
        bundleCounts: {
          sessions: sessions.length,
          memories: memories.length,
          edges: edges.length,
          turns: turns.length,
          audit: audit.length,
        },
      }),
    };
  } catch (err) {
    const appErr = reportError(new AppError("export.failed", { cause: err }));
    return {
      statusCode: appErr.statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: 2, ok: false, ...errorEnvelope(appErr) }),
    };
  }
}
