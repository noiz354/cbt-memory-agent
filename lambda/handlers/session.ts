/**
 * Session Handlers — GET/POST /api/v1/session, /api/v1/sessions
 *
 * Persistent session CRUD terhadap CockroachDB:
 * - POST /session    → INSERT atau UPDATE session milik user
 * - GET  /sessions   → list sessions user + filter status & query
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { AppError, errorEnvelope, reportError } from "../lib/errors";

interface SessionRow {
  id: string;
  title: string;
  status: string;
  mood: number | null;
  mood_label: string | null;
  started_at: string | null;
  duration_min: number | null;
  excerpt: string | null;
  thought: string | null;
  reframe: string | null;
}

const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
};

export async function handleSaveSession(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  let body: {
    v?: number;
    session?: {
      id?: string;
      title?: string;
      status?: string;
      mood?: number;
      moodLabel?: string;
      startedAt?: string;
      durationMin?: number;
      excerpt?: string;
      thought?: string;
      reframe?: string | null;
    };
  };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (body.v !== 1 || !body.session) {
    return badRequest('Expected { v: 1, session: {...} }');
  }

  const s = body.session;
  if (!s.id || !s.title) return badRequest("Session requires id + title");

  try {
    const userId = await getUserId(crdb, token);
    await crdb.execute(
      `INSERT INTO sessions (id, user_id, title, status, mood, mood_label, started_at, duration_min, excerpt, thought, reframe)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         title        = EXCLUDED.title,
         status       = EXCLUDED.status,
         mood         = EXCLUDED.mood,
         mood_label   = EXCLUDED.mood_label,
         started_at   = EXCLUDED.started_at,
         duration_min = EXCLUDED.duration_min,
         excerpt      = EXCLUDED.excerpt,
         thought      = EXCLUDED.thought,
         reframe      = EXCLUDED.reframe
       WHERE sessions.user_id = $2::uuid`,
      [
        s.id,
        userId,
        s.title,
        s.status ?? "pending",
        s.mood ?? null,
        s.moodLabel ?? null,
        s.startedAt ?? new Date().toISOString(),
        s.durationMin ?? null,
        s.excerpt ?? null,
        s.thought ?? null,
        s.reframe ?? null,
      ],
    );
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ v: 1, ok: true, id: s.id }) };
  } catch (err) {
    const appErr = reportError(err);
    return {
      statusCode: appErr.statusCode,
      headers: CORS,
      body: JSON.stringify(errorEnvelope(appErr)),
    };
  }
}

export async function handleListSessions(
  qs: Record<string, string | undefined>,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  const status = qs.status && qs.status !== "all" ? qs.status : null;
  const query = qs.query?.trim() ?? "";

  const where = ["user_id = $1::uuid"];
  const params: any[] = [""];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (query) {
    params.push(`%${query}%`);
    where.push(`(title ILIKE $${params.length} OR COALESCE(excerpt,'') ILIKE $${params.length} OR COALESCE(thought,'') ILIKE $${params.length})`);
  }

  try {
    const userId = await getUserId(crdb, token);
    params[0] = userId;

    const rows = await crdb.query<SessionRow>(
      `SELECT id, title, status, mood, mood_label, started_at, duration_min, excerpt, thought, reframe
       FROM sessions
       WHERE ${where.join(" AND ")}
       ORDER BY started_at DESC NULLS LAST`,
      params,
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ v: 1, sessions: rows.map(toSession) }),
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

function toSession(row: SessionRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    mood: Number(row.mood ?? 0),
    moodLabel: row.mood_label ?? "neutral",
    startedAt: row.started_at ?? new Date().toISOString(),
    durationMin: Number(row.duration_min ?? 0),
    excerpt: row.excerpt ?? "",
    thought: row.thought ?? "",
    reframe: row.reframe ?? null,
  };
}

function badRequest(error: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: CORS,
    body: JSON.stringify(errorEnvelope(new AppError("validation.invalid_request", { message: error }))),
  };
}
