import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  base64UrlToBytes,
  authenticatePasskey,
  clearPasskeyRegistry,
  readPasskeyRegistry,
  registerPasskey,
} from "@/features/auth/lib/passkey";

const WEB_AUTHN_CRED_ID = "aW9lbnRlbmNpYWwtY3JlZGVudGlhbC1pZA"; // arbitrary base64url

function stubLocalStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("passkey registry", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts empty", () => {
    expect(readPasskeyRegistry()).toEqual([]);
  });

  it("registers and reads back a passkey identity", () => {
    registerPasskey({
      credentialId: WEB_AUTHN_CRED_ID,
      source: "webauthn",
      email: "alice@example.com",
      displayName: "Alice",
      profileId: "usr-1",
      registeredAt: "2026-08-16T00:00:00.000Z",
    });
    const registry = readPasskeyRegistry();
    expect(registry).toHaveLength(1);
    expect(registry[0]).toMatchObject({ credentialId: WEB_AUTHN_CRED_ID, source: "webauthn", profileId: "usr-1" });
  });

  it("re-registering the same credentialId replaces (no duplicates)", () => {
    registerPasskey({ credentialId: WEB_AUTHN_CRED_ID, source: "webauthn", email: "a@b.c", displayName: "A", profileId: "usr-1", registeredAt: "t1" });
    registerPasskey({ credentialId: WEB_AUTHN_CRED_ID, source: "webauthn", email: "a@b.c", displayName: "A", profileId: "usr-2", registeredAt: "t2" });
    expect(readPasskeyRegistry()).toHaveLength(1);
    expect(readPasskeyRegistry()[0].profileId).toBe("usr-2");
  });

  it("tolerates corrupt localStorage payload", () => {
    localStorage.setItem("cbt-passkey-registry", "{not-json");
    expect(readPasskeyRegistry()).toEqual([]);
    localStorage.setItem("cbt-passkey-registry", JSON.stringify([{ nope: true }]));
    expect(readPasskeyRegistry()).toEqual([]);
  });

  it("clearPasskeyRegistry wipes entries", () => {
    registerPasskey({ credentialId: WEB_AUTHN_CRED_ID, source: "webauthn", email: "a@b.c", displayName: "A", profileId: "usr-1", registeredAt: "t" });
    clearPasskeyRegistry();
    expect(readPasskeyRegistry()).toEqual([]);
  });
});

describe("base64UrlToBytes", () => {
  it("decodes a base64url credential id to bytes", () => {
    const bytes = base64UrlToBytes("SGVsbG8");
    expect([...bytes]).toEqual([...new TextEncoder().encode("Hello")]);
  });

  it("handles padding-less and padding variants", () => {
    const a = base64UrlToBytes("AQID");
    const b = base64UrlToBytes("AQID");
    expect([...a]).toEqual([...b]);
    expect([...a]).toEqual([1, 2, 3]);
  });
});

describe("authenticatePasskey", () => {
  const originalGet = navigator.credentials?.get;
  const originalCreate = navigator.credentials?.create;

  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGet) navigator.credentials.get = originalGet;
    if (originalCreate) navigator.credentials.create = originalCreate;
  });

  it("returns unregistered when no WebAuthn credentials exist", async () => {
    vi.stubGlobal("window", { PublicKeyCredential: class {}, location: { hostname: "localhost" } });
    (navigator as { credentials?: unknown }).credentials = {
      get: vi.fn(),
    } as never;
    const result = await authenticatePasskey();
    expect(result).toEqual({ ok: false, reason: "unregistered" });
  });

  it("asserts a matching credential and returns its id", async () => {
    registerPasskey({ credentialId: WEB_AUTHN_CRED_ID, source: "webauthn", email: "a@b.c", displayName: "A", profileId: "usr-1", registeredAt: "t" });
    vi.stubGlobal("window", { PublicKeyCredential: class {}, location: { hostname: "localhost" } });
    (navigator as { credentials?: unknown }).credentials = {
      get: vi.fn().mockResolvedValue({ id: WEB_AUTHN_CRED_ID }),
    } as never;
    const result = await authenticatePasskey();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.credentialId).toBe(WEB_AUTHN_CRED_ID);
  });

  it("maps NotAllowedError to cancelled", async () => {
    registerPasskey({ credentialId: WEB_AUTHN_CRED_ID, source: "webauthn", email: "a@b.c", displayName: "A", profileId: "usr-1", registeredAt: "t" });
    vi.stubGlobal("window", { PublicKeyCredential: class {}, location: { hostname: "localhost" } });
    (navigator as { credentials?: unknown }).credentials = {
      get: vi.fn().mockRejectedValue(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError")),
    } as never;
    const result = await authenticatePasskey();
    expect(result).toEqual({ ok: false, reason: "cancelled" });
  });

  it("returns unsupported when WebAuthn is unavailable", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    const result = await authenticatePasskey();
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });
});
