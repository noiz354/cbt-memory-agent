export function formatClock(date: Date | string | number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatDay(date: Date | string | number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

/**
 * Cryptographically-secure opaque token (base64url, 32 random bytes).
 * Untuk magic link / one-time tokens — jangan pakai `uid()` yang berbasis
 * Math.random (predictable). Sekitar 256 bit entropi.
 */
export function secureToken(prefix = "tok") {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${prefix}_${b64}`;
}
