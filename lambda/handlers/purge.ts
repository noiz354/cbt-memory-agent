/**
 * Purge Handler — POST /api/v1/purge
 *
 * Hard delete all user data from CRDB (irreversible).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";

export async function handlePurge(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || "{}");
  if (body?.confirmation !== "hard-purge") {
    return {
      statusCode: 400,
      body: JSON.stringify({ v: 1, ok: false, error: "confirmation must be 'hard-purge'" }),
    };
  }

  try {
    const chatRows = await crdb.executeCount(`DELETE FROM chat_turns WHERE user_id = md5($1::string)::uuid`, [token]);
    const edges = await crdb.executeCount(`DELETE FROM memory_edges WHERE user_id = md5($1::string)::uuid`, [token]);
    const memories = await crdb.executeCount(`DELETE FROM memory_nodes WHERE user_id = md5($1::string)::uuid`, [token]);
    const sessions = await crdb.executeCount(`DELETE FROM sessions WHERE user_id = md5($1::string)::uuid`, [token]);
    const users = await crdb.executeCount(`DELETE FROM users WHERE id = md5($1::string)::uuid`, [token]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        v: 1,
        ok: true,
        deletedRows: { chatTurns: chatRows, memoryEdges: edges, memoryNodes: memories, sessions, users },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        v: 1,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }
}
