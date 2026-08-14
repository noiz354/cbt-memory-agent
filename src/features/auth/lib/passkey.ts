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

export function mintLocalDeviceKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const credentialId = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ok: true as const, credentialId, source: "local-device" as const };
}
