/**
 * Auth Middleware — validates session token + device ID.
 *
 * For hackathon: simple token validation.
 * For production: replace with OAuth2/OIDC + JWT validation.
 */

export interface AuthResult {
  valid: boolean;
  userId?: string;
  error?: string;
  statusCode?: number;
}

export function validateAuth(token: string, deviceId: string): AuthResult {
  if (!token) {
    return { valid: false, error: "Missing Authorization header", statusCode: 401 };
  }
  if (!deviceId) {
    return { valid: false, error: "Missing X-Device-Id header", statusCode: 401 };
  }

  // TODO (production): Validate token against CRDB users table — verify a
  // server-issued high-entropy session token bound to the user's row:
  //   SELECT id FROM users WHERE id = $1 AND session_token = $2
  // and bind `userId` from the DB row, never from the client-supplied token.
  // Until then, fail-closed on obviously-malformed tokens instead of accepting
  // any non-empty string. A minimal shape check reduces accidental breakage
  // (e.g. a bare profile.id without our `usr_` prefix) without a full rewrite.
  if (token.length < 8 || /\s/.test(token)) {
    return { valid: false, error: "Malformed Authorization token", statusCode: 401 };
  }

  // Accept for now (hackathon) — see TODO above.
  return { valid: true, userId: token };
}
