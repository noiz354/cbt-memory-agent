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

/**
 * Best-effort mirror of crisis lifecycle events into `audit_events`.
 *
 * `/api/v1/metrics` northStar.crisisEvents menghitung row
 * `audit_events.type IN ('CRISIS_ENGAGED','CRISIS_DISMISSED')` per user
 * (handlers/health.ts). Frontend sudah mengirim `crisis_triggered` /
 * `crisis_resolved` ke `/events` (appStore.triggerCrisis/dismissCrisis →
 * track()), tetapi row audit hanya bisa ditulis server-side. Di sini kita
 * derive CRISIS_ENGAGED/CRISIS_DISMISSED dari batch events yang valid.
 *
 * Dijamin tidak pernah throw / menggagalkan request — kegagalan audit hanya
 * dicatat di log (pola sama dengan clusterHealth.ts).
 */
async function writeCrisisAudit(crdb: CrdbClient, userId: string, events: IncomingEvent[]): Promise<void> {
  const auditRows: { type: string; detail: string }[] = [];
  for (const ev of events) {
    if (ev.name === "crisis_triggered") {
      auditRows.push({
        type: "CRISIS_ENGAGED",
        detail: JSON.stringify({
          event: ev.name,
          reason: ev.properties?.reason ?? null,
          occurredAt: parseOccurredAt(ev.occurredAt),
        }),
      });
    } else if (ev.name === "crisis_resolved") {
      auditRows.push({
        type: "CRISIS_DISMISSED",
        detail: JSON.stringify({
          event: ev.name,
          occurredAt: parseOccurredAt(ev.occurredAt),
        }),
      });
    }
  }
  if (auditRows.length === 0) return;

  try {
    const placeholders = auditRows.map((_, i) => `($1::uuid, $${i + 2}, $${i + 3})`).join(",");
    const params: unknown[] = [userId];
    for (const row of auditRows) params.push(row.type, row.detail);
    await crdb.execute(
      `INSERT INTO audit_events (user_id, type, detail)
       VALUES ${placeholders}
       ON CONFLICT DO NOTHING`,
      params,
    );
  } catch (err) {
    logger.warn("events.crisis_audit_failed", "crisis audit insert failed", {
      err: err instanceof Error ? err.message : String(err),
      count: auditRows.length,
    });
  }
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

  await writeCrisisAudit(crdb, userId, valid);

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
