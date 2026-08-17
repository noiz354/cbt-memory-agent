/**
 * Purge Handler — POST /api/v1/purge
 *
 * Hard delete all user data from CRDB (irreversible).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createHash } from "node:crypto";
import { CrdbClient } from "../lib/crdb";
import { S3ClientService } from "../lib/s3";
import { logger } from "../lib/logger";
import { AppError, errorEnvelope, reportError } from "../lib/errors";

export async function handlePurge(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  s3: S3ClientService,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || "{}");
  if (body?.confirmation !== "hard-purge") {
    return {
      statusCode: 400,
      body: JSON.stringify({ v: 1, ok: false, ...errorEnvelope(new AppError("validation.invalid_request", { message: "confirmation must be 'hard-purge'" })) }),
    };
  }

  try {
    const chatRows = await crdb.executeCount(`DELETE FROM chat_turns WHERE user_id = md5($1::string)::uuid`, [token]);
    const edges = await crdb.executeCount(`DELETE FROM memory_edges WHERE user_id = md5($1::string)::uuid`, [token]);
    const memories = await crdb.executeCount(`DELETE FROM memory_nodes WHERE user_id = md5($1::string)::uuid`, [token]);
    const sessions = await crdb.executeCount(`DELETE FROM sessions WHERE user_id = md5($1::string)::uuid`, [token]);
    // attachments ter-cascade dari memory_nodes (FK CASCADE) — tidak dihapus eksplisit.
    const users = await crdb.executeCount(`DELETE FROM users WHERE id = md5($1::string)::uuid`, [token]);

    // Raw media di S3 tidak punya FK — hapus eksplisit per-prefix user.
    let mediaDeleted = 0;
    try {
      mediaDeleted = await s3.deleteMediaPrefix(md5TokenUuid(token));
    } catch (err) {
      logger.warn("purge.media_delete_failed", "deleteMediaPrefix error", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        v: 1,
        ok: true,
        deletedRows: { chatTurns: chatRows, memoryEdges: edges, memoryNodes: memories, sessions, users },
        deletedMediaObjects: mediaDeleted,
      }),
    };
  } catch (err) {
    const appErr = reportError(new AppError("purge.failed", { cause: err }));
    return {
      statusCode: appErr.statusCode,
      body: JSON.stringify({ v: 1, ok: false, ...errorEnvelope(appErr) }),
    };
  }
}

/** Prefiks media S3 memakai UUID deterministik yang sama dengan user_id CRDB. */
function md5TokenUuid(token: string): string {
  return createHash("md5").update(token).digest("hex").replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5",
  );
}
