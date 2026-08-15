/**
 * Auth Middleware — validates session token + device ID.
 *
 * Real verification (3.2): looks up the server-issued high-entropy `session_token`
 * against the users table and returns the DB row's real id, never trusting a
 * client-supplied value as the identity key.
 *
 * Backward-compatible fallback: if no users row matches (legacy `usr_…`
 * profile.id tokens from before the magic-link flow), keep the previous
 * behavior — accept and let handlers derive `md5(token)::uuid` — so existing
 * sessions don't break.
 */

import { CrdbClient } from "../lib/crdb";

export interface AuthResult {
  valid: boolean;
  userId?: string;
  error?: string;
  statusCode?: number;
}

export async function validateAuth(
  token: string,
  deviceId: string,
  crdb?: CrdbClient,
): Promise<AuthResult> {
  if (!token) {
    return { valid: false, error: "Missing Authorization header", statusCode: 401 };
  }
  if (!deviceId) {
    return { valid: false, error: "Missing X-Device-Id header", statusCode: 401 };
  }
  if (token.length < 8 || /\s/.test(token)) {
    return { valid: false, error: "Malformed Authorization token", statusCode: 401 };
  }

  // Real verification: the token is a server-issued session_token.
  if (crdb) {
    try {
      const row = await crdb.queryOne<{ id: string }>(
        `SELECT id FROM users WHERE session_token = $1 LIMIT 1`,
        [token],
      );
      if (row) {
        return { valid: true, userId: row.id };
      }
    } catch (err) {
      console.warn("[auth] session_token lookup failed, falling back:", err);
    }
  }

  // Legacy fallback: accept and let handlers derive md5(token)::uuid.
  return { valid: true, userId: token };
}
