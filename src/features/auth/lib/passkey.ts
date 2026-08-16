const PASSKEY_REGISTRY_KEY = "cbt-passkey-registry";

export interface RegisteredPasskey {
  credentialId: string;
  source: "webauthn" | "local-device";
  email: string;
  displayName: string;
  profileId: string;
  registeredAt: string;
}

export async function platformPasskeyAvailable() {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    return false;
  }
  return true;
}

/** Decode a base64url string (as used by WebAuthn credential ids) to bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** All passkeys this browser has registered, oldest first. */
export function readPasskeyRegistry(): RegisteredPasskey[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PASSKEY_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RegisteredPasskey =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as RegisteredPasskey).credentialId === "string",
    );
  } catch {
    return [];
  }
}

/** Register (or re-register) a passkey identity so a returning user can sign in. */
export function registerPasskey(entry: RegisteredPasskey): void {
  if (typeof localStorage === "undefined") return;
  try {
    const entries = readPasskeyRegistry().filter((e) => e.credentialId !== entry.credentialId);
    entries.push(entry);
    localStorage.setItem(PASSKEY_REGISTRY_KEY, JSON.stringify(entries));
  } catch {
    // localStorage unavailable — passkey simply won't be restorable.
  }
}

export function revokePasskey(credentialId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const entries = readPasskeyRegistry().filter((e) => e.credentialId !== credentialId);
    localStorage.setItem(PASSKEY_REGISTRY_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

export function clearPasskeyRegistry(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(PASSKEY_REGISTRY_KEY);
  } catch {
    // ignore
  }
}

export async function mintPasskey(email: string) {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    return { ok: false as const, reason: "unsupported" as const };
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(email).slice(0, 16);

  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "CBT Memory Agent", id: window.location.hostname },
        user: {
          id: userId,
          name: email,
          displayName: email.split("@")[0] || "member",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 45_000,
        attestation: "none",
      },
    });

    if (!credential) return { ok: false as const, reason: "empty" as const };
    return { ok: true as const, credentialId: credential.id, source: "webauthn" as const };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "Error";
    if (name === "NotAllowedError") {
      return { ok: false as const, reason: "cancelled" as const };
    }
    return { ok: false as const, reason: "failed" as const };
  }
}

export type PasskeyAuthResult =
  | { ok: true; credentialId: string }
  | { ok: false; reason: "unsupported" | "empty" | "cancelled" | "failed" | "unregistered" };

/**
 * Assert an existing passkey via navigator.credentials.get and return which
 * registered identity it belongs to. Only WebAuthn credentials can be asserted —
 * local device keys are not verifiable through the authenticator.
 */
export async function authenticatePasskey(): Promise<PasskeyAuthResult> {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    return { ok: false, reason: "unsupported" };
  }

  const candidates = readPasskeyRegistry().filter((e) => e.source === "webauthn");
  if (candidates.length === 0) {
    return { ok: false, reason: "unregistered" };
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: candidates.map((e) => ({
          type: "public-key",
          id: base64UrlToBytes(e.credentialId),
        })),
        userVerification: "required",
        timeout: 45_000,
      },
    });

    if (!assertion) return { ok: false, reason: "empty" };
    return { ok: true, credentialId: assertion.id };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "Error";
    if (name === "NotAllowedError") {
      return { ok: false, reason: "cancelled" };
    }
    return { ok: false, reason: "failed" };
  }
}

export function mintLocalDeviceKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const credentialId = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ok: true as const, credentialId, source: "local-device" as const };
}
