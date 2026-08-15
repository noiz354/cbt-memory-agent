# Security & Hardening Audit — CBT Memory Agent

> Audit date: 2026-08-15 · Method: source review (frontend `src/` + Lambda backend `lambda/`) + live endpoint probing via the Vite proxy.
> Scope: authentication, authorization, data-at-rest, data-in-transit, secrets handling, privacy claims, purge/export, supply chain.
> Legend: **BROKEN** = actively insecure · **HIGH** = meaningful risk · **MED** = hardening gap · **LOW** = cosmetic/defensive · **OK** = correctly done.
> **Status note (2026-08-15, same session):** items marked ✅ were remediated after this audit; see §7 for the follow-up log.

---

## 1. Summary of severity ranking

| # | Finding | Severity | Location | Status |
|---|---|---|---|---|
| 1.1 | Backend accepts **any non-empty token**; no real authN/authZ | **BROKEN** | `lambda/middleware/auth.ts:23-27` | 🔶 partially hardened (malformed rejected; real verification still TODO) |
| 1.2 | Frontend "token" is the user id itself (`profile.id`), minted locally | **BROKEN** | `authSession.ts:14-18`, `authStore.ts` | ⬜ open |
| 1.3 | Auth session does **not survive reload** (persist rehydration broken) | HIGH | `versionedPersist.ts`, `authStore.ts` | ✅ fixed (§7.1) |
| 1.4 | Magic-link token is `Math.random()` (predictable) + single-use broken by double-consume | HIGH | `format.ts:17`, `AuthCallbackPage.tsx` | ✅ fixed (§7.2) |
| 1.5 | Passkey: real `create()` but **no `credentials.get()`** (no login) + insecure fallback | HIGH | `passkey.ts`, `PasskeyPanel.tsx` | ⬜ open |
| 1.6 | Privacy copy is **false** ("never leaves this device") while data is uploaded to CRDB/AWS | HIGH | `AuthShell.tsx:6`, `AuthPage.tsx:25` | ⬜ open |
| 2.1 | CORS default `Access-Control-Allow-Origin: *` | MED | `handler.ts:127` | 🔶 fail-loud warn added; default still `*` |
| 2.2 | Hard purge deletes localStorage but **not IndexedDB BYOK keys** and **not server data** | MED | `hardPurge.ts`, `byokKeyManager.ts` | ✅ fixed (§7.3) |
| 2.3 | `/purge` and `/export` backend endpoints are unimplemented stubs | MED | `purge.ts:16`, `export.ts:18` | ✅ fixed (§7.4) |
| 2.4 | No rate limiting / no audit trail server-side | MED | `handler.ts` (all) | ⬜ open |
| 2.5 | No CSP / security headers | MED | `index.html`, `handler.ts:125-131` | ⬜ open |
| 3.1 | `.env` correctly gitignored | OK | `.gitignore:27-29` | — |
| 3.2 | BYOK keys encrypted at rest (WebCrypto AES-GCM) in IndexedDB | OK* | `byokKeyManager.ts` | — |
| 3.3 | LLM API keys never logged/console'd; not in localStorage | OK | `byokKeyManager.ts` | — |
| 3.4 | Health endpoint deliberately unauthenticated | OK | `handler.ts:51` | — |
| 4.1 | User display name hardcoded server-side as `'device-user'` | LOW | `chatTurn.ts:151-154` | ⬜ open |
| 4.2 | `credentialId` never used for anything | LOW | `authStore.ts` | ⬜ open |
| 4.3 | Seed demo data presented as real user data | LOW | `sessionStore/memoryStore/chatStore/privacyStore` | 🔶 hydrate-failure path fixed (empty states); initial seed remains |

\* OK with a caveat — see §3.2: the AES-GCM wrapping key lives in the **same** IndexedDB as the ciphertext, so it protects only against casual inspection of localStorage, not against an attacker with code execution in the origin.

---

## 2. Authentication & Authorization (the core problem)

### 2.1 BROKEN — The backend authenticates nothing
`lambda/middleware/auth.ts:23-27`:

```ts
// TODO: Validate token against CRDB users table
// For now, accept any non-empty token
return { valid: true, userId: token };
```

- `validateAuth` only checks that `Authorization` and `X-Device-Id` headers are **non-empty**.
- Any caller who sends `Authorization: Bearer anything` + `X-Device-Id: anything` is accepted and their data is keyed to `userId = token`.
- Data isolation between users is therefore **token-string equality**, not cryptography. Two browsers that pick the same
  `profile.id` (see 2.2) read/write the same CockroachDB rows.
- This is a documented hackathon placeholder (`// TODO: Validate token against CRDB users table`), but it is a **complete absence of auth** and must be called out.

**Fix:** implement token verification (e.g., store a `session_token` (high-entropy, generated with `crypto.getRandomValues`) server-side at onboarding, verify it per request, and bind `userId` from the DB not from the client-supplied token). Move `userId` resolution out of the client-controlled value.

### 2.2 BROKEN — The client "token" is the user id
`src/shared/lib/authSession.ts:14-18`:

```ts
return { token: profile.id, deviceId: getDeviceId() };
```

- `profile.id = uid("usr")` — generated locally with `Math.random().toString(36)` (see `format.ts`, `authStore.emptyProfile`).
- So the bearer token is a **client-mintable, low-entropy, never-verified identifier**. Combined with 2.1, a user can trivially impersonate another user whose id they observe (ids are visible in localStorage, network headers, and even in any DB row that leaks an id).
- The `deviceId` is `device_${crypto.randomUUID()}` — at least UUID-grade, but also client-controlled and unverified.

### 2.3 ✅ FIXED — Auth session now survives a page reload
Root cause was the versioned-persist wrapper (details in AUDIT.md §4.8):

- **Was:** `createVersionedPersist` persisted `{ version: 1, data: partialize(state) }` (`versionedPersist.ts:30-33`); Zustand's default `merge` (`{ ...currentState, ...persistedState }`) only merged the top-level wrapper keys, so `data.status/profile/step` were never unpacked → after any reload the store rehydrated as `status: 'anonymous'`, `profile: null`, and the console logged *"State loaded from storage couldn't be migrated since no migrate function was provided"*; `/chat` redirected to `/auth`. There is no server-side session to fall back to.
- **Fix (done):** `versionedPersist.ts:39-42` now supplies a custom `merge` that **unpacks `persistedState.data`** (with legacy unwrapped-shape fallback) into the store. Verified: auth persists across reloads, `setHydrated(true)`/`onRehydrateStorage` still fire, and the migration warning is gone.

### 2.4 🔶 FIXED (client-side) — Magic-link token + double-consume
- **Was:** `issueMagicLink` used `uid("lnk")` → `Math.random().toString(36)` (`src/shared/lib/format.ts:17`) — not cryptographically random, no expiry; and `AuthCallbackPage.tsx`'s `useEffect` (deps included `params`, an object changing identity per render) ran **twice** — first run consumed the token, second found `magicToken === null` and showed **"Link not valid"** even though the user *is* authenticated. `magicToken` was not in the persisted slice → reload/new-tab always yielded "Link not valid".
- **Fix (done):** `format.ts:25` adds `secureToken(prefix)` — 32 bytes `crypto.getRandomValues`, base64url. `issueMagicLink` uses `secureToken("lnk")` + sets `magicTokenExpiresAt = Date.now() + MAGIC_LINK_TTL_MS` (10 min); `consumeMagicLink` rejects expired tokens. `AuthCallbackPage.tsx:17-24` adds a `consumedRef` run-once guard and treats `status` already `authenticated`/`onboarded` as success (navigates to `/onboarding`).
- **Still open (server-side):** no backend magic-link endpoint; token verification is still local-only (no server verification / true single-use enforcement). The in-memory token remains unpersisted by design.

### 2.5 HIGH — Passkey ceremony is incomplete
- `passkey.ts:22-43` — real `navigator.credentials.create({ publicKey })`, good.
- **But there is no `navigator.credentials.get()` anywhere** (grep: zero matches) → the app **never verifies a passkey / never logs a user back in**; every sign-in mints a brand-new credential.
- Fallback `mintLocalDeviceKey()` (`passkey.ts:56-59`) fabricates a random hex string with a cosmetic 900 ms wait, and the UI copy frames it as legitimate: *"Sandbox has no platform authenticator — a local device key was minted instead. Still zero-cloud."*
- The `credentialId` is stored in the profile but never sent to the server or used for anything (see 4.2).

**Fix:** implement the assertion ceremony (`credentials.get`), and make the local-key fallback an explicit sandbox-only path (or remove it).

### 2.6 HIGH — Privacy claims contradict actual data flow
Copy shown to the user:

- `AuthShell.tsx:6` — *"session material never leave this browser profile"*.
- `AuthPage.tsx:25` — *"session key never leaves this device"*.

Reality: whenever authenticated, the app uploads chat turns (`chatStore.ts:218`), memories (`memoryStore.ts:175,235`), and sessions (`sessionStore.ts:120,162`) to CockroachDB/AWS under `profile.id`; health probes hit the Lambda. The on-device "vault" is also just plaintext localStorage. For a **clinical CBT app**, this copy is a compliance/trust liability.

**Fix:** either (a) make the app truly device-local and disable the backend sync, or (b) rewrite the copy to state plainly that data is encrypted-in-transit and stored in the user's cloud workspace. Never claim "never leaves this device" when it does.

---

## 3. Data protection

### 3.1 OK — `.env` / secrets
- `.env` and `.env.*` are gitignored (`.gitignore:27-29`), `.env.example` committed with placeholders. Verified: `.env` is ignored.
- Contains real `CRDB_*`, `CCLOUD_API_KEY`, `OPENROUTER_API_KEY`, AWS profile/region/account. Keep it out of git (it is).
- Lambda reads secrets from `process.env` at cold start (CRDB connection, OpenRouter key, S3 bucket). No key material in source.

### 3.2 OK* — BYOK API keys (with a structural caveat)
`byokKeyManager.ts` is a genuinely decent design:
- Keys encrypted with **WebCrypto AES-GCM-256** before storage; ciphertext + IV in IndexedDB `cbt-byok-keys`.
- Plaintext never in localStorage, never logged, only decrypted on demand for a call.
- `getApiKey` updates `lastUsedAt`; `revokeApiKey` deletes; `wipeAllApiKeys` clears all.

**Caveat (MED):** the AES-GCM wrapping key is also stored **in the same IndexedDB** (`wrappingKey` store) as the ciphertext.
That means the protection is really *obfuscation against casual localStorage inspection*, not defense against an attacker who
can execute JS in the origin (e.g., via XSS or a compromised dependency). True protection would derive the wrapping key from a
passphrase or use the OS-level WebAuthn/credential-backed key. For a hackathon this is acceptable; document the threat model.

### 2.2/MED ✅ FIXED — Hard purge now wipes BYOK keys and calls server purge
`hardPurgeLocalData()` (`privacy/lib/hardPurge.ts:33-60`) — **was:** wiped only the allowlisted `cbt-*` localStorage keys and reset stores (correctly avoided `localStorage.clear()`), but **never called `wipeAllApiKeys()`** and **never called `apiClient.purge`**, so encrypted BYOK keys and CockroachDB rows survived "account erased".
- **Fix (done):** now `async` — awaits `wipeAllApiKeys()` (clears IndexedDB BYOK keys; fail-open `try/catch`), then best-effort `apiClient.purge("hard-purge", auth.token, auth.deviceId)`; on server failure shows a toast ("Server data not purged") + `console.warn`. `DestructionKey.tsx:116` runs `void hardPurgeLocalData().finally(() => navigate('/auth'))`.

### 2.3/MED ✅ FIXED — Server purge real; export returns 501
- **Was:** `lambda/handlers/purge.ts:16-17` returned `{ ok: true, deletedRows: 0 }` (silent false-success); `lambda/handlers/export.ts:18-26` returned a fake `s3Url` (false-success). Frontend `uploadExportBundle()` still has zero callers (dead).
- **Fix (done):** `purge.ts:17-40` is a real implementation — requires body `confirmation === "hard-purge"` (else 400), parameterized `DELETE` from `chat_turns`/`memory_edges`/`memory_nodes`/`sessions`/`users` keyed `md5(token)::uuid`, returns per-table `deletedRows`, 500 on error (backed by new `crdb.executeCount` at `lambda/lib/crdb.ts:44`). `export.ts:22-30` returns **501 "Export upload is not implemented."** — honest failure instead of a fake success.

### 3.3 OK — LLM key hygiene
Keys are only present in IndexedDB (encrypted) and decrypted transiently; no key material in console/logs; the LlmPanel test-connection fetch sends the key only to the chosen provider endpoint. Good.

---

## 4. Transport & configuration hardening (MED/LOW)

### 2.1 🔶 MED — CORS default `*` (fail-loud now)
`handler.ts:126-131`: `"Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*"`. **Partial fix (done):** when `ALLOWED_ORIGIN` is unset the handler now logs `console.warn("[cors] ALLOWED_ORIGIN is not set — falling back to '*' (set it in production)")` — fail-loud so a wildcard-CORS deploy can't go unnoticed. **Still open:** set the env var to the deployed frontend origin(s) so the wildcard is never actually used. If auth were real (§2.1) a wildcard would compound; today the effective exposure is the fake-auth CRUD API.

### 2.5 MED — No CSP / security headers
- `index.html` has **no `Content-Security-Policy`** meta and no HSTS/`X-Content-Type-Options`/`Referrer-Policy`.
- The SPA loads Google Fonts + inline scripts; a strict CSP needs tuning (Vite injects inline scripts; Tailwind/vite dev needs `unsafe-inline`/`unsafe-eval` in dev, but prod can be stricter).
- For a clinical app, add at minimum: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and set `SameSite=Lax` cookies (currently the auth state is localStorage, which has no SameSite/HttpOnly concept — a known client-side-token tradeoff).

### 2.4 MED — No rate limiting / server audit
- No throttling on `POST /chat/turn` (LLM cost abuse — anyone with a token can burn OpenRouter credits), no brute-force protection on the (currently nonexistent) auth verification, no server-side audit log (audit events exist only in the local `cbt-audit-log`, capped at 80).
- `X-Device-Id` has no server-side registry (the "active sessions" device list in `privacyStore.ts` is **hardcoded demo data**: "This browser", "Clinic iPad — Supervision room", "Shared workstation — Admin desk"), so revocation of a real device is impossible.

### 4.1 LOW — Server hardcodes user identity
`chatTurn.ts:151-154` (and `memory.ts:222-225`, `session.ts:161-164`) upsert the user as `'device-user'` / `'passkey'` via `md5(token)::uuid`. The display name typed during onboarding never reaches the server. Combined with 2.1, the `users` table is effectively a fake-identity shim.

### 4.3 LOW — Demo data presented as user data
Seed sessions/memories/messages/devices (with hardcoded 2026-08-xx timestamps) are shown when hydration hasn't succeeded, and are **retained on hydrate failure** (see AUDIT.md §1.5/§2.1/§3.1). Users may believe fabricated "Sunday kitchen spiral" memories are their own. For a therapy tool this is more than cosmetic.

---

## 5. Attack-surface walkthrough (top scenarios)

1. **Impersonation:** attacker learns any `profile.id` (localStorage, devtools network, DB leak) → sends it as `Bearer` → reads/writes that user's CockroachDB rows. Full break if `ALLOWED_ORIGIN=*`.
2. **LLM-cost abuse:** no rate limit on `/chat/turn` + any non-empty token → burn OpenRouter credits; responses include personal chat content.
3. **Session loss:** any reload wipes local auth (2.3) → forced re-auth; on the server, orphaned rows keep accumulating keyed to dead tokens.
4. **Magic-link guessing:** low-entropy `Math.random()` token + no expiry + no server validation (2.4) → predictable/spear-phishable entry.
5. **Stale data after "purge":** user believes data deleted (2.2/2.3) but copies remain in IndexedDB (BYOK keys) and CRDB (all content) — a GDPR/right-to-be-forgotten failure if this is real clinical data.

---

## 6. Prioritized remediation

| # | Severity | Action | Status |
|---|---|---|---|
| 1 | BROKEN | Replace `validateAuth` with real server-side token verification bound to a `users` row (create high-entropy token at onboarding); never trust client `userId`. | ⬜ open (malformed-token rejection added only) |
| 2 | BROKEN | Fix `versionedPersist` merge so auth survives reload; add `migrate` that unpacks `data`. | ✅ **DONE** (§7.1) |
| 3 | HIGH | Magic-link tokens via `crypto.getRandomValues`, with expiry; fix `AuthCallbackPage` double-consume (run-once ref); add server verification. | 🔶 client side done (§7.2); server verification open |
| 4 | HIGH | Rewrite "never leaves this device" copy to match reality, or disable cloud sync. | ⬜ open |
| 5 | HIGH | Complete the passkey flow (`credentials.get`) or remove the fake-local-key path. | ⬜ open |
| 6 | MED | Set `ALLOWED_ORIGIN`; implement `/purge` + `/export` (or return 501); wire `wipeAllApiKeys` + server purge into hard purge; add rate limiting; add CSP/security headers. | 🔶 purge+export+wipe+purging done (§7.3/§7.4); `ALLOWED_ORIGIN` value, rate limiting, CSP open |
| 7 | MED | Add server-side audit log + real device registry; replace `seedDevices`. | ⬜ open |
| 8 | LOW | Stop showing seed data as real (empty states on hydrate failure); send the real display name to the server. | 🔶 hydrate-failure empty states done; initial seed + server name open |

> **Bottom line (updated):** The two most damaging bugs are now fixed — auth **persists** across reloads (§7.1), the magic-link token is
> crypto-random + expired with the double-consume bug gone (§7.2), hard purge actually removes IndexedDB keys **and** server rows (§7.3/§7.4),
> and the export endpoint stops lying with a fake URL. **Remaining blockers for production/clinical use are unchanged in principle:**
> the auth layer is still simulated end-to-end (client-minted `profile.id` accepted as a bearer token, §2.1/§2.2), the privacy copy still
> overstates device-local processing (§2.6), and passkey has no sign-in ceremony (§2.5).

---

## 7. Follow-up: remediation log (2026-08-15)

| # | Change | Files |
|---|---|---|
| 7.1 | **Auth persist rehydration fixed** — custom `merge` unpacks `persistedState.data` into the store (legacy-shape fallback). Verified across reloads. | `src/shared/lib/versionedPersist.ts:39-42` |
| 7.2 | **Magic-link hardening** — `secureToken()` (32 B `crypto.getRandomValues`, base64url); `issueMagicLink` sets `magicTokenExpiresAt` (10 min TTL); `consumeMagicLink` checks expiry; `AuthCallbackPage` run-once `consumedRef` guard + already-authenticated → success. | `src/shared/lib/format.ts:25`, `src/features/auth/store/authStore.ts`, `src/features/auth/pages/AuthCallbackPage.tsx:17-24` |
| 7.3 | **Hard purge complete** — `hardPurgeLocalData` now `async`, awaits `wipeAllApiKeys()`, then calls `apiClient.purge("hard-purge", …)` with a failure toast; caller fires-and-navigates. | `src/features/privacy/lib/hardPurge.ts:33-60`, `src/features/privacy/components/DestructionKey.tsx:116` |
| 7.4 | **Server purge real + export 501** — `purge.ts` confirmation-gated per-user `DELETE` of all tables (via new `crdb.executeCount`); `export.ts` returns 501 instead of fake `s3Url`. | `lambda/handlers/purge.ts:17-40`, `lambda/handlers/export.ts:22-30`, `lambda/lib/crdb.ts:44` |
| 7.5 | **Auth middleware partial hardening** — malformed tokens (length < 8 / whitespace) rejected with 401 before the accept-any path. | `lambda/middleware/auth.ts:30-35` |
| 7.6 | **CORS fail-loud** — warns in logs when `ALLOWED_ORIGIN` is unset. | `lambda/handler.ts:126-131` |
| 7.7 | **LLM fallback short-circuit fixed** — on-device stub now throws → real backend-proxy/BYOK chain runs, stuck streaming resolved. | `src/shared/lib/llmClient.ts:162` |
| 7.8 | **Seed-as-real on hydrate failure fixed** — `memoryStore`/`sessionStore` hydrate catch now empties arrays + sets `hydrateError`. | `memoryStore.ts:207-211`, `sessionStore.ts:141-144` |
| 7.9 | **A11y + robots.txt** — contrast bumps, `aria-label` on file input + sessions select, `public/robots.txt`. | see WEB-QUALITY-AUDIT.md §7 |

Verification: `npm run typecheck` (frontend) and `npx tsc --noEmit` (in `lambda/`) both pass after the above.
