/**
 * Turn Handlers — GET /api/v1/session/:id/turns
 *
 * Read-only transcript retrieval for a session's chat history.
 */

import { APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { logger } from "../lib/logger";

interface ChatTurnRow {
  id: string;
  role: string;
  content: string;
  tokens_used: number | null;
  injected_memory_ids: string[] | null;
  created_at: string;
}

const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
};

export async function handleListSessionTurns(
  sessionId: string,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  try {
    const userId = (
      await crdb.queryOne<{ user_id: string }>(
        `SELECT md5($1::string)::uuid::text AS user_id`,
        [token],
      )
    )?.user_id ?? "";

    const turns = await crdb.query<ChatTurnRow>(
      `SELECT id, role, content, tokens_used, injected_memory_ids, created_at
       FROM chat_turns
       WHERE user_id = $1::uuid AND session_id = $2
       ORDER BY created_at ASC`,
      [userId, sessionId],
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        v: 1,
        turns: turns.map((t) => ({
          id: t.id,
          role: t.role,
          content: t.content,
          tokensUsed: t.tokens_used ?? 0,
          injectedMemoryIds: t.injected_memory_ids ?? [],
          createdAt: t.created_at,
        })),
      }),
    };
  } catch (err) {
    logger.error("turns.list_failed", "listSessionTurns error", {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Failed to load session turns" }),
    };
  }
}
