/**
 * Events Handler — POST /api/v1/events
 *
 * Ingests batch event tracking (FASE 1-3 fondasi + event monetisasi) ke
 * `user_events`. Auth dilakukan di middleware (handler.ts); identity user
 * ditentukan SERVER (session_token lookup → real UUID, atau fallback legacy
 * md5(token)::uuid konsisten dengan chatTurn).
 *
 * Keamanan:
 * - Hanya event dalam allowlist (ALLOWED_MONETIZATION_EVENTS) yang di-insert.
 * - Payload divalidasi struktural (zod-like via validateEventsPayload).
 * - Tanpa PII: properties dibatasi skema (plan_id/amount/delta_amount/…).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { logger } from "../lib/logger";
import {
  partitionEvents,
  validateEventsPayload,
  type IncomingEvent,
} from "../lib/monetization";

interface UserIdRow {
  user_id: string;
}

async function ensureUser(crdb: CrdbClient, token: string): Promise<string> {
  const userId = await crdb.queryOne<UserIdRow>(
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

function parseOccurredAt(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export async function handleTrackEvents(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const parsed = validateEventsPayload(body);
  if (!parsed.ok || !parsed.events) {
    return json(400, { error: parsed.error ?? "Invalid events payload" });
  }

  const { valid, rejected } = partitionEvents(parsed.events);
  if (valid.length === 0) {
    return json(422, {
      error: "No allowed monetization events in batch",
      rejected: rejected.map((r) => r.name),
    });
  }

  let userId: string;
  try {
    userId = await ensureUser(crdb, token);
  } catch (err) {
    logger.error("events.user_failed", "failed to ensure user", {
      err: err instanceof Error ? err.message : String(err),
    });
    return json(500, { error: "Failed to resolve identity" });
  }

  const params: unknown[] = [];
  const placeholders: string[] = [];
  for (const ev of valid) {
    const idx = placeholders.length * 6 + 1;
    placeholders.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5})`);
    params.push(
      userId,
      ev.name,
      ev.properties ? JSON.stringify(ev.properties) : null,
      ev.sessionId ?? null,
      deviceId,
      parseOccurredAt(ev.occurredAt),
    );
  }

  try {
    await crdb.execute(
      `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
       VALUES ${placeholders.join(",")}`,
      params,
    );
  } catch (err) {
    logger.error("events.insert_failed", "failed to insert events", {
      err: err instanceof Error ? err.message : String(err),
      count: valid.length,
    });
    return json(500, { error: "Failed to persist events" });
  }

  logger.info("events.inserted", "events persisted", { inserted: valid.length, rejected: rejected.length });

  return json(201, {
    v: 1,
    inserted: valid.length,
    rejected: rejected.length,
    rejectedNames: rejected.length > 0 ? rejected.map((r) => r.name) : undefined,
  });
}

function json(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}
