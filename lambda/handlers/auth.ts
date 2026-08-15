/**
 * Auth handlers — Resend magic-link flow.
 *
 * POST /api/v1/auth/magic-link  (public)  { email, displayName }
 *   → generates a 32-byte token, stores its SHA-256 hash in auth_tokens
 *     (10-min TTL, single-use), and emails a callback link via Resend.
 *   → If RESEND_API_KEY is missing (dev mode) returns { ok, sent:false, devUrl }
 *     so the frontend can keep its on-device preview fallback.
 *
 * POST /api/v1/auth/callback  (public)  { token }
 *   → verifies hash, not used, not expired; marks used_at; upserts the user;
 *     issues a session_token and returns it for the frontend to store.
 */

import { createHash, randomBytes } from "node:crypto";
import { APIGatewayProxyEvent } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { logger } from "../lib/logger";

const MAGIC_LINK_TTL_MS = 10 * 60 * 1000;

interface MagicLinkBody {
  email?: string;
  displayName?: string;
}

interface CallbackBody {
  token?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cors(): Record<string, string> {
  const origin = process.env.ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  };
}

function json(status: number, body: unknown): { statusCode: number; headers: Record<string, string>; body: string } {
  return { statusCode: status, headers: cors(), body: JSON.stringify(body) };
}

/** Send via Resend's plain HTTP API (no SDK needed). */
async function sendMagicLinkEmail(
  email: string,
  displayName: string,
  link: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your CBT Memory Agent sign-in link",
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#0f766e">Hi ${displayName.replace(/[<>&]/g, "")} 👋</h2>
            <p>Tap the button below to open your on-device workspace. The link expires in 10 minutes and can only be used once.</p>
            <p style="margin:24px 0">
              <a href="${link}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">
                Sign in to CBT Memory Agent
              </a>
            </p>
            <p style="color:#6b7280;font-size:13px">
              If the button doesn't work, paste this link into your browser:<br />
              <a href="${link}" style="color:#0f766e">${link}</a>
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `Resend ${response.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "email send failed" };
  }
}

export async function handleRequestMagicLink(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  let body: MagicLinkBody;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const displayName = (body.displayName ?? "").trim() || email.split("@")[0];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "A valid email is required" });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();

  try {
    await crdb.execute(
      `INSERT INTO auth_tokens (email, token_hash, expires_at, method)
       VALUES ($1, $2, $3, 'magic-link')`,
      [email, tokenHash, expiresAt],
    );
  } catch (err) {
    logger.error("auth.magic_link_insert_failed", "auth/magic-link insert error", { err: err instanceof Error ? err.message : String(err) });
    return json(500, { error: "Failed to store token" });
  }

  // ALLOWED_ORIGIN is often "*" (CORS) — never use it as the link origin,
  // or the email link becomes "*/auth/callback?...". Prefer APP_URL.
  const appOrigin = (process.env.APP_URL ?? process.env.ALLOWED_ORIGIN ?? "").replace(/\/$/, "");
  const origin = appOrigin && appOrigin !== "*" ? appOrigin : "http://localhost:5173";
  const link = `${origin}/auth/callback?token=${token}`;

  const sent = await sendMagicLinkEmail(email, displayName, link);

  // Dev mode (no RESEND_API_KEY): return the link so the frontend can show its
  // on-device preview instead of failing the flow.
  if (!sent.ok) {
    if (!process.env.RESEND_API_KEY) {
      return json(200, { ok: true, sent: false, devUrl: link });
    }
    logger.warn("auth.resend_send_failed", "Resend send failed", { error: sent.error });
    return json(502, { ok: false, sent: false, error: sent.error });
  }

  return json(200, { ok: true, sent: true });
}

export async function handleConsumeMagicLink(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  let body: CallbackBody;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const token = (body.token ?? "").trim();
  if (!token) return json(400, { error: "A token is required" });

  const tokenHash = sha256(token);

  try {
    const row = await crdb.queryOne<{
      email: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT email, expires_at, used_at FROM auth_tokens
       WHERE token_hash = $1 ORDER BY created_at DESC LIMIT 1`,
      [tokenHash],
    );

    if (!row) return json(401, { error: "Link is not valid" });
    if (row.used_at) return json(401, { error: "This link has already been used" });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json(401, { error: "This link has expired" });
    }

    await crdb.execute(
      `UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1`,
      [tokenHash],
    );

    const email = row.email;
    const sessionToken = randomBytes(32).toString("base64url");

    // The user's identity key derives from the server-issued session_token
    // (md5(sessionToken)::uuid) so every handler's existing `md5(token)::uuid`
    // derivation resolves to the same row. display_name comes from the email
    // prefix; the email itself is stored on the row.
    await crdb.execute(
      `INSERT INTO users (id, email, display_name, auth_method, session_token)
       VALUES (md5($1::string)::uuid, $2, $3, 'magic-link', $1)
       ON CONFLICT (id) DO UPDATE SET session_token = EXCLUDED.session_token, last_active = now()`,
      [sessionToken, email, email.split("@")[0]],
    );

    const userId = await crdb.queryOne<{ user_id: string }>(
      `SELECT md5($1::string)::uuid::text AS user_id`,
      [sessionToken],
    );

    return json(200, { ok: true, userId: userId?.user_id ?? "", sessionToken, email });
  } catch (err) {
    logger.error("auth.callback_failed", "auth/callback error", { err: err instanceof Error ? err.message : String(err) });
    return json(500, { error: "Failed to verify token" });
  }
}
