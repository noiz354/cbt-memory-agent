/**
 * Attachments Handlers — emotional media analysis (gambar/video/audio).
 *
 * Alur index media:
 *   1. POST /api/v1/attachments/presign → key `media/{userId}/{uuid}.{ext}` +
 *      presigned PUT URL (raw bytes di-upload client langsung ke S3).
 *   2. POST /api/v1/attachments → simpan memory_nodes(kind='attachment',
 *      verified=true) + attachments (analysis JSONB, embedded_narrative, s3_key)
 *      + writeNodeEmbedding(embedded_narrative) → recall otomatis via hybrid RRF.
 *   3. GET  /api/v1/attachments  → daftar attachment user (join memory_nodes).
 *   4. DELETE /api/v1/attachments/:id → hapus raw bytes S3 + node (attachments
 *      & embeddings ter-cascade via FK ON DELETE CASCADE).
 *
 * Analisis emosi SELALU on-device; server hanya menyimpan hasil (narrative
 * template deterministik, bukan LLM) + lokasi raw media di S3.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { CrdbClient } from "../lib/crdb";
import { OpenRouterClient } from "../lib/openrouter";
import { S3ClientService, MAX_MEDIA_UPLOAD_BYTES } from "../lib/s3";
import { writeNodeEmbedding } from "../lib/vectorWriter";
import { logger } from "../lib/logger";
import { AppError, errorEnvelope, reportError } from "../lib/errors";

const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
};

export type AttachmentKind = "image" | "video" | "audio";

export interface AttachmentInput {
  kind: AttachmentKind;
  analysis: Record<string, unknown>;
  embeddedNarrative: string;
  s3Key: string;
  title: string;
  confidence?: number;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  frameCount?: number;
  sessionId?: string;
  turnId?: string;
}

const VALID_KINDS: AttachmentKind[] = ["image", "video", "audio"];

/** Key media selalu ber-prefix `media/{userId}/` — cegah traversal antar-user. */
function expectedMediaPrefix(userId: string): string {
  return `media/${userId}/`;
}

function badRequest(error: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: CORS,
    body: JSON.stringify(errorEnvelope(new AppError("validation.invalid_request", { message: error }))),
  };
}

async function getUserId(crdb: CrdbClient, token: string): Promise<string> {
  const row = await crdb.queryOne<{ user_id: string }>(
    `SELECT md5($1::string)::uuid::text AS user_id`,
    [token],
  );
  const userId = row?.user_id ?? "";

  await crdb.execute(
    `INSERT INTO users (id, email, display_name, auth_method)
     VALUES (md5($1::string)::uuid, $1, 'device-user', 'passkey')
     ON CONFLICT (id) DO NOTHING`,
    [token],
  );
  return userId;
}

export async function handlePresignAttachment(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  s3: S3ClientService,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  let body: { v?: number; kind?: string; ext?: string; mimeType?: string };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return badRequest("Invalid JSON body");
  }

  const kind = body.kind as AttachmentKind | undefined;
  // ext dipakai di key S3 — validasi biar tidak ada karakter path/malformed.
  const rawExt = body.ext ?? (kind === "image" ? "jpg" : "webm");
  const ext = /^[a-zA-Z0-9]{1,8}$/.test(rawExt) ? rawExt : "bin";
  if (!kind || !VALID_KINDS.includes(kind)) {
    return badRequest(`Expected kind in ${VALID_KINDS.join(", ")}`);
  }

  try {
    const userId = await getUserId(crdb, token);
    const key = `media/${userId}/${uuidv4()}.${ext}`;
    const { url, fields } = await s3.presignMediaPost(key, body.mimeType);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ v: 1, key, action: url, fields }) };
  } catch (err) {
    const appErr = reportError(err);
    return {
      statusCode: appErr.statusCode,
      headers: CORS,
      body: JSON.stringify(errorEnvelope(appErr)),
    };
  }
}

export async function handleCreateAttachment(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  llm: OpenRouterClient,
  s3: S3ClientService,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  let body: { v?: number; attachment?: AttachmentInput };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return badRequest("Invalid JSON body");
  }

  const attachment = body.attachment;
  if (!attachment) return badRequest("Expected { v: 1, attachment: {...} }");

  if (!VALID_KINDS.includes(attachment.kind)) {
    return badRequest(`Expected kind in ${VALID_KINDS.join(", ")}`);
  }
  if (!attachment.embeddedNarrative || !attachment.embeddedNarrative.trim()) {
    return badRequest("embeddedNarrative is required");
  }
  if (!attachment.title) return badRequest("title is required");

  try {
    const userId = await getUserId(crdb, token);

    const prefix = expectedMediaPrefix(userId);
    if (!attachment.s3Key.startsWith(prefix)) {
      return badRequest("s3Key must be under the user's media prefix");
    }

    // Verifikasi raw media SUNGGAH sudah ter-upload ke S3 sebelum mencatat
    // node — cegah memory node "hantu" tanpa bytes (roots penyebab kegagalan).
    const head = await s3.headMediaObject(attachment.s3Key);
    if (!head.exists) {
      return badRequest("Media not uploaded yet — POST the blob to the presigned action first");
    }
    // Defense in depth kedua: reject bila ada pihak lain upload >25MB (cap
    // utama ditegakkan S3 lewat presigned POST) dan buang bytes-nya.
    const actualSize = head.sizeBytes ?? attachment.sizeBytes;
    if (actualSize != null && actualSize > MAX_MEDIA_UPLOAD_BYTES) {
      await s3.deleteMediaObject(attachment.s3Key).catch(() => undefined);
      return badRequest("Media exceeds the 25MB upload limit");
    }
    if (attachment.sizeBytes != null && head.sizeBytes != null && head.sizeBytes !== attachment.sizeBytes) {
      return badRequest("sizeBytes does not match the object in S3");
    }

    const nodeId = uuidv4();
    const now = new Date().toISOString();
    const excerpt = attachment.embeddedNarrative.slice(0, 200);
    const confidence = Math.min(1, Math.max(0, attachment.confidence ?? 0.6));

    await crdb.execute(
      `INSERT INTO memory_nodes (id, user_id, kind, title, excerpt, tags, weight, confidence, verified, ref_count, last_touched, x, y, crisis_flag)
       VALUES ($1, $2::uuid, 'attachment', $3, $4, $5, 0.6, $6, true, 0, $7, 0, 0, false)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt,
         tags = EXCLUDED.tags, weight = EXCLUDED.weight, confidence = EXCLUDED.confidence,
         verified = EXCLUDED.verified, last_touched = EXCLUDED.last_touched`,
      [nodeId, userId, attachment.title, excerpt, [attachment.kind], confidence, now],
    );

    await crdb.execute(
      `INSERT INTO attachments (user_id, memory_node_id, kind, duration_ms, frame_count, analysis, embedded_narrative, s3_key, mime_type, size_bytes, session_id, turn_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        userId,
        nodeId,
        attachment.kind,
        attachment.durationMs ?? null,
        attachment.frameCount ?? null,
        JSON.stringify(attachment.analysis ?? {}),
        attachment.embeddedNarrative,
        attachment.s3Key,
        attachment.mimeType ?? null,
        attachment.sizeBytes ?? null,
        attachment.sessionId ?? null,
        attachment.turnId ?? null,
      ],
    );

    // Embedding dari narrative (bukan excerpt 200 char) — recall semantik penuh.
    await writeNodeEmbedding(crdb, llm, userId, {
      id: nodeId,
      title: attachment.title,
      excerpt: attachment.embeddedNarrative,
      tags: [attachment.kind],
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ v: 1, ok: true, nodeId, attachmentId: nodeId }),
    };
  } catch (err) {
    const appErr = reportError(err);
    return {
      statusCode: appErr.statusCode,
      headers: CORS,
      body: JSON.stringify(errorEnvelope(appErr)),
    };
  }
}

export async function handleListAttachments(
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  try {
    const userId = await getUserId(crdb, token);
    const rows = await crdb.query<{
      id: string;
      kind: string;
      title: string;
      excerpt: string | null;
      embedded_narrative: string | null;
      created_at: string | null;
    }>(
      `SELECT a.id, a.kind, mn.title, mn.excerpt, a.embedded_narrative, a.created_at
       FROM attachments a
       JOIN memory_nodes mn ON mn.id = a.memory_node_id
       WHERE a.user_id = $1::uuid
       ORDER BY a.created_at DESC`,
      [userId],
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        v: 1,
        attachments: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          excerpt: r.excerpt ?? undefined,
          embeddedNarrative: r.embedded_narrative ?? undefined,
          createdAt: r.created_at ?? undefined,
        })),
      }),
    };
  } catch (err) {
    const appErr = reportError(err);
    return {
      statusCode: appErr.statusCode,
      headers: CORS,
      body: JSON.stringify(errorEnvelope(appErr)),
    };
  }
}

export async function handleDeleteAttachment(
  id: string,
  crdb: CrdbClient,
  s3: S3ClientService,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  try {
    const userId = await getUserId(crdb, token);

    const row = await crdb.queryOne<{ s3_key: string | null }>(
      `SELECT a.s3_key FROM attachments a
       JOIN memory_nodes mn ON mn.id = a.memory_node_id
       WHERE a.memory_node_id::string = $1 AND a.user_id = $2::uuid`,
      [id, userId],
    );
    if (!row) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify(errorEnvelope(new AppError("media.not_found"))) };
    }

    if (row.s3_key) {
      try {
        await s3.deleteMediaObject(row.s3_key);
      } catch (err) {
        // Object mungkin sudah terhapus — tetap lanjut hapus node (best-effort).
        logger.warn("attachments.s3_delete_failed", "deleteMediaObject error", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // attachments + embeddings ter-cascade dari memory_nodes (FK CASCADE).
    await crdb.execute(
      `DELETE FROM memory_nodes WHERE id = $1 AND user_id = $2::uuid`,
      [id, userId],
    );

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ v: 1, ok: true, deletedId: id }) };
  } catch (err) {
    const appErr = reportError(err);
    return {
      statusCode: appErr.statusCode,
      headers: CORS,
      body: JSON.stringify(errorEnvelope(appErr)),
    };
  }
}
