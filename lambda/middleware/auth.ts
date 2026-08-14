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

  // TODO: Validate token against CRDB users table
  // For now, accept any non-empty token
  // Production: SELECT id FROM users WHERE id = $1 AND credential_id = $2

  return { valid: true, userId: token };
}
