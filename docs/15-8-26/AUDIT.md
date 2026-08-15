# Audit: CBT Memory Agent — Stubbed / Broken Features

> Audit date: 2026-08-15, against `main` with live backend.
> Backend health (via Vite proxy): `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}`. `typecheck` passes.
> Method: read-only source review of all features (`chat`, `sessions`, `memory`, `auth`, `crisis`, `privacy`) + Lambda handlers,
> plus live browser/Lighthouse verification (auth flow, onboarding, page snapshots).
>
> Companion docs in this folder:
> - [`WEB-QUALITY-AUDIT.md`](./WEB-QUALITY-AUDIT.md) — Lighthouse scores per page, Core Web Vitals, accessibility/SEO details.
> - [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md) — authN/authZ, data protection, privacy-claim mismatch, remediation.

Legend: REAL = works end-to-end · PARTIAL = partly works, partly fake · STUB = placeholder/not implemented · DEAD = no callers · BROKEN = broken behavior.

---

## 1. Chat — `/chat`

### 1.1 ✅ FIXED — On-device LLM stub short-circuited the fallback chain and hung streaming
- **Was:** `src/shared/lib/llmClient.ts:152` — `callOnDeviceLLM` never threw and never called `onStream`; it returned a hardcoded
  placeholder, so `callLLMWithFallback` (tries `local-webllm` first, advances only on error) short-circuited at the placeholder and
  `backend-proxy`/BYOK were never reached; `isStreaming` stayed `true` forever with an empty streaming bubble.
- **Fix (done):** `callOnDeviceLLM` now **throws** `"WebLLM belum di-load. On-device provider tidak tersedia — fallback ke backend."`
  (`llmClient.ts:162`) so the fallback chain (backend-proxy → openrouter) actually runs. Both callers (`sendMessage`/`resumeStream`)
  use `callLLMWithFallback` so the throw is handled; the stuck-streaming hang is resolved.
- Real SSE path still verified working server-side (`parseBackendProxySSE`; `lambda/handlers/chatTurn.ts` streams OpenRouter → SSE).
- **Still open:** integrating `@mlc-ai/web-llm` so on-device inference actually works (option c).

### 1.2 STUB — Hold-to-talk / voice
- `src/features/chat/components/HoldToTalkOrb.tsx:20` — `stop()` injects a **hardcoded fake voice-note message**; `start()` uses a no-op `setTimeout(() => undefined, 0)`.
- Entire audio stack is **dead code** — nothing calls `startAudioWorker`:
  `src/workers/audioClient.ts` (AudioWorklet → ScriptProcessor fallback, VAD gating, no destination connect), `audio.worker.ts`, `audio-processor.ts`, `vad.worker.ts` (Silero ONNX at `/models/silero_vad.onnx` exists 2.3MB, but is a "stateless approximation" and never invoked).
- Real implementation needs P1-2 Whisper.cpp WASM + wiring `startAudioWorker` into `HoldToTalkOrb`.

### 1.3 FAKE — Face expression detection
- `src/workers/face.worker.ts:30` — computes frame **luma** → maps to fake expression (neutral/engaged/tense/sad/distressed); `distressed` fires when the image is *bright*. Comment admits production would use MediaPipe Face Landmarker.
- `CameraPip.tsx` opens the **real camera** (getUserMedia, 320x240), real snapshot → `attachSnapshot`; but expression reading is fake.

### 1.4 FAKE — Waveform / audio playback / barge-in
- Seed `msg_3` carries hardcoded `audio.peaks`; `WaveformScrubber.tsx:12` is `const [progress, setProgress] = useState(0.22)` — static, no `<audio>`/AudioContext. Decorative only.
- "Swipe to barge-in" just halts generation (`triggerBargeIn`).
- `resumeStream`/`truncated` is **dead code** — `truncated: true` never set anywhere; `ChatBubble.tsx:146` resume button only shows when truncated.

### 1.5 DEMO — Seed data
- `chatStore.ts:52` `seedMessages` (3 fabricated turns incl. fake audio), `memoryStore.ts:32` `seedNodes` (7 nodes + 5 edges), `sessionStore.ts:31` seed sessions (6 demo).
- `getAuthHeaders()` returns `null` when anonymous → no hydrate, no chat sync.
- `useBackendSync` (new, untracked) hydrates memory+sessions only after login. Demo content is the default until successful hydrate.

### 1.6 REAL — Working chat features
Text composer + draft (`sessionStorage["cbt-composer-draft"]`), crisis detection (regex EN+ID), drag-to-inject memories (`SpatialDndProvider` DROP_ZONES), drag-to-quote, local file attachments (pdf/txt), End session, OfflineBanner (60s poll), camera snapshot capture.

### 1.7 ✅ FIXED — TTS badge in ChatSafetyHeader
- **Was:** `ChatSafetyHeader.tsx:52` — `"gpu" in navigator ? "WebGPU TTS" : "WASM audio"` — detected WebGPU, not TTS. No TTS code existed.
- **Fix (done):** badge now honestly shows **`<Badge>TTS pending</Badge>`** (`ChatSafetyHeader.tsx:51`).

---

## 2. Sessions — `/sessions`

### 2.1 ✅ FIXED (hydrate-failure path) — 6 hardcoded seed sessions (`sessionStore.ts:31-104`)
Fixed fake IDs (`ses_slack`, `ses_kitchen`, …), 2026 timestamps, scripted CBT content remain the **initial** state (demo until a successful hydrate), but **on hydrate failure the store now empties `sessions: []` + sets `hydrateError`** (`sessionStore.ts:141-144`) instead of keeping the seed, so `BackendSyncStatus` shows an error + Retry rather than fabricating history.

### 2.2 PARTIAL — listSessions / saveSession
- `listSessions` → `GET /sessions` → real Lambda/CRDB query (`sessionStore.ts:120`, `lambda/handlers/session.ts:106-151`). REAL.
- `saveSession` → `POST /session` upsert, real handler. But **only** called from "End session" (`ChatSafetyHeader.tsx:32`), fire-and-forget (`console.warn` on failure). The session built at finalize has **hardcoded metadata**: `status: "extracted", mood: 5, moodLabel: "grounded", reframe: null` (`ChatSafetyHeader.tsx:34-41`).

### 2.3 STUB/PARTIAL — Kanban status changes never persist
- Drag between columns → `setStatus` (`sessionStore.ts:141-144`) mutates only Zustand + localStorage. No backend call; no PATCH endpoint exists. **A drag from "Pending" to "Extracted" is lost on another device.**

### 2.4 BROKEN — Session detail shows no chat history
- `SessionDetailPage.tsx:11` reads only summary fields from `sessionStore`. Never touches `chatStore`/backend.
- Backend **writes** `chat_turns` (`chatTurn.ts:197`) but **no read endpoint exists** — history is unrecoverable from the UI.
- "Continue similar conversation" (`SessionDetailPage.tsx:71`) navigates to `/chat` with **no session ID**.

### 2.5 ✅ FIXED — Export: dead client path + backend now returns 501
- `apiClient.exportBundle` (`apiClient.ts:276-286`) → `POST /export`; caller `uploadExportBundle()` (`src/features/privacy/lib/exportBundle.ts:70`) still has **zero callers** (dead code).
- **Fix (done):** `lambda/handlers/export.ts:22-30` now returns **501 "Export upload is not implemented."** instead of a fake `s3Url: "https://s3.amazonaws.com/..."` — clients get an honest error rather than a silent false-success.

### 2.6 REAL (local) — CompareModal, MoodSparkline
- `CompareModal.tsx` genuinely compares two store sessions; `MoodSparkline.tsx` computes real SVG from store `mood`. Both operate on store data (may be seed/demo until hydrate).

---

## 3. Memory — `/memory`

### 3.1 ✅ FIXED (hydrate-failure path) — seed graph (`memoryStore.ts:32-163`)
7 nodes + 5 edges with fixed ids, coords, Aug-2026 timestamps remain the **initial** state (demo until hydrate), but **on hydrate failure the store now empties `nodes: [], edges: []` + sets `hydrateError`** (`memoryStore.ts:207-211`) instead of retaining demo data, so `BackendSyncStatus` shows the error + Retry rather than fabricated memories.

### 3.2 REAL — listMemory, deleteMemory
- `hydrate()` → `listMemory` → `GET /memory` → real CRDB (`memory.ts:44-92`).
- `finishPurge` → `deleteMemory` → `DELETE /memory/:id` → real SQL (`memory.ts:199-202`), edges cascade. Fire-and-forget.
- Misleading banner at `GraphCanvas.tsx:119`: "Memory burned locally" — it *does* hit the server.

### 3.3 PARTIAL — upsertMemory (edges only)
- Only write reaching the backend besides purge: `linkNodes` upserts `edge` (`memoryStore.ts:235-239`). No node upsert from UI.

### 3.4 DEAD — searchMemory
- `apiClient.searchMemory` (`apiClient.ts:239-249`) + backend `semanticSearch.ts` implemented, **zero callers** in `src/`.

### 3.5 PARTIAL — drag/position persists only to localStorage
- `moveNode` (`memoryStore.ts:206-209`) local-only; **overwritten by next successful `hydrate()`** which replaces all nodes from server.

### 3.6 DEAD — node creation from UI
- **No `addNode`/`createNode` action exists**; GraphToolbar has only zoom/fit/reset. Only possible node source is seed data or manual DB insert.

### 3.7 STUB — NodeInspector edit / verify / touch / recall
- `updateNode`, `verify`, `touch`, `touchRecall` (`memoryStore.ts:267-287`) all local-only; overwritten on next hydrate. `touchRecall` bumps `references` locally; backend `ref_count` never incremented.

### 3.8 BROKEN — unlink edge is visual-only
- `unlink` (`memoryStore.ts:245`) filters local edges; no edge-delete endpoint exists. Edge **remains in CockroachDB and reappears after next hydrate**.
- Edge-case bug: linking two seed-only nodes triggers FK `23503` (source/target not in DB); catch only swallows `23505` (unique) → 500 (`memory.ts:173-176`).

### 3.9 PurgeZone — node purge REAL; full user purge ✅ FIXED
- Node purge (`deleteMemory`) remains REAL (`memoryStore.ts:271`, `memory.ts:199-202`).
- **Was:** `apiClient.purge` → `lambda/handlers/purge.ts:16` `// TODO: Implement` returning `deletedRows: 0`; `hardPurge.ts` never called it.
- **Fix (done):** `lambda/handlers/purge.ts:17-40` is a real implementation — requires body `confirmation === "hard-purge"` (else 400),
  parameterized `DELETE` from `chat_turns`, `memory_edges`, `memory_nodes`, `sessions`, `users` (keyed `md5(token)::uuid`), returns
  `{ v:1, ok:true, deletedRows:{chatTurns,memoryEdges,memoryNodes,sessions,users} }`, 500 on error. `hardPurgeLocalData` now calls
  `apiClient.purge("hard-purge", …)` (see §6) and `lambda/lib/crdb.ts:44` gained `executeCount()`.

### 3.10 DEAD — `coreMemories()` (`memoryStore.ts:297`), `nodeScale()` (`types.ts:43`)

---

## 4. Auth / Onboarding — `/auth`, `/onboarding`

### 4.1 PARTIAL — Passkey
- `passkey.ts:22-43` real `navigator.credentials.create({ publicKey })`. **No `navigator.credentials.get()` anywhere** → every sign-in mints a new credential; no login.
- Fake fallback `mintLocalDeviceKey` (`passkey.ts:56-59`) mints a random hex string; wired at `PasskeyPanel.tsx:57-60` ("Sandbox has no platform authenticator…"), cosmetic 900ms wait.
- Backend hardcodes identity: every user upserted as `'device-user'` / `'passkey'` (`chatTurn.ts:151-154`, `memory.ts:222-225`, `session.ts:161-164`).

### 4.2 ✅ FIXED (token hardening) — Magic link
- **Was:** `authStore.issueMagicLink` stored the token in memory only; token = `uid()` = `Math.random().toString(36)` (**not crypto-safe**), no expiry; `MagicLinkForm.tsx:48-51` admits "There is no mail server in this build."
- **Fix (done):** `format.ts:25` added `secureToken(prefix)` — 32 bytes from `crypto.getRandomValues`, base64url. `issueMagicLink` uses `secureToken("lnk")` and sets `magicTokenExpiresAt = Date.now() + MAGIC_LINK_TTL_MS` (10 min, `authStore.ts:9`); `consumeMagicLink` now checks expiry. Still in-memory only (no mail server / no backend magic-link endpoint — remains a STUB at the transport level).

### 4.3 STUB — PersonalizedVault
- dnd-kit UI over `profile.goals` (array of ids), `addGoal`/`removeGoal` local-only (`authStore.ts:120-129`). **No encryption, no vault artifact, no credential-derived key.** Plaintext `localStorage["cbt-memory-agent-auth"]`.

### 4.4 REAL (local only) — Onboarding persistence
- `finishOnboarding` (`authStore.ts:130-134`) sets status `onboarded` if consent + ≥1 goal; persisted to localStorage. Nothing written to backend at onboarding.

### 4.5 STUB — AuthCallbackPage
- `authStore.consumeMagicLink` (`authStore.ts:78-83`) is a local `===` against the stored token. No server verification, no expiry. Copy "Validating the one-time token on this device" overstates a local comparison.

### 4.6 STUB/PARTIAL — SessionGate
- Gates on `localStorage["cbt-memory-agent-auth"].status` string. **No token validation, expiry, or server check** — editing localStorage bypasses auth. (Now that §4.8 is fixed, the persisted `status` at least restores across reloads.)
- `getAuthHeaders` (`authSession.ts:14-18`) uses `profile.id` as bearer token; backend `lambda/middleware/auth.ts:30-35` now rejects malformed tokens (length<8/whitespace → 401) but still accepts **any well-formed non-empty token** as `userId = token` — real CRDB verification remains TODO.

### 4.7 MISLEADING copy
- `AuthShell.tsx:6` "session material never leave this browser profile" / `AuthPage.tsx:25` "session key never leaves this device" — but chat turns, memories, sessions **are** uploaded to CRDB/AWS under `profile.id`.

### 4.8 ✅ FIXED — Auth session did not survive a page reload (persist rehydration broken)
- **Was:** `src/shared/lib/versionedPersist.ts:30-33` — `createVersionedPersist` persisted `{ version: STORE_VERSION, data: partialize(state) }`;
  Zustand's default merge `{ ...currentState, ...persistedState }` merged only the top-level wrapper keys, so the inner
  `data.status/profile/step` were never unpacked → every reload rehydrated as `status:'anonymous'`, `/chat` → `/auth`.
- **Fix (done):** `versionedPersist.ts:39-42` adds a custom `merge` that **unpacks `persistedState.data`** (falling back to the unwrapped shape for legacy format) into the store. Verified: auth now restores across reloads; `onRehydrateStorage`/`setHydrated(true)` still fire. The "couldn't be migrated" console warning is gone.

### 4.9 ✅ FIXED — Magic-link double-consume → "Link not valid" even when authenticated
- **Was:** `AuthCallbackPage.tsx` `useEffect` deps `[consumeMagicLink, navigate, params]` — `params` object identity changed each render → effect ran **twice**; second run found `magicToken === null` → `setOk(false)` → "Link not valid" though the user *is* authenticated. `magicToken` is not in the persisted slice, so any reload/new-tab also yielded "Link not valid".
- **Fix (done):** `AuthCallbackPage.tsx:17,20-24` adds `consumedRef = useRef(false)` run-once guard, and the effect first checks `status === "authenticated" | "onboarded"` → treats as success (`setOk(true)` + `navigate("/onboarding")`). Deps updated to include `status`.
- **User-confirmed workaround flow** (how the app was entered during auditing, now unnecessary): `/auth` → magic link → "Open magic link" → "Link not valid" → "Return to sign in" → auto-redirect to `/onboarding`.

---

## 5. Crisis — REAL end-to-end (local-only persistence)

- `detectCrisis.ts` — real regex EN+ID; fired on user's outgoing message (`chatStore.ts:139`), hard-halt + overlay (`chatStore.ts:150-176`).
- `CrisisHaltBridge.tsx` — real; watches `appStore.crisisActive` → `hardHalt()` (streaming/recording/cameraOpen false).
- `BreathingCircle.tsx` — real 4-7-8 phase machine (setTimeout/setInterval, framer-motion scale, pointer hold, cycle count).
- `GroundingGame.tsx` — real dnd-kit drag 5 tokens onto pads; completion → `onComplete`.
- `CalmingAudio.tsx:20-38` — real WebAudio oscillators (174Hz+180Hz, **no asset files exist**; but mixed into one GainNode → monophonic 6Hz beat, **not true binaural** — no L/R panning).
- `SwipeToCall.tsx` — real `tel:` navigation gated on ≥88% drag; `988` (US) and `119` (ID) correct.
- `CrisisOverlay.tsx` — real flow: focus trap + Escape-block, emergency-contact `tel:` gated on `emergency.notify`, `tel:988`/`sms:119`, UGD map search; exit disabled until grounded. Logs `CRISIS_ENGAGED`/`CRISIS_DISMISSED` to local audit store only — **no backend `/crisis` endpoint**.
- `ChatSafetyHeader` session timer (`:21-25`) measures **header mount duration** only (resets on navigation). End session builds hardcoded mood (see 2.2).

---

## 6. Settings / Privacy — `/settings/privacy` (no dedicated `src/features/settings`)

- **ExportBuilder / `buildExportBundle`** (`exportBundle.ts:11-53`) — REAL: assembles chat/mood/memory from stores → local JSON download. Server upload path DEAD + backend STUB (see 2.5).
- **DestructionKey / `hardPurgeLocalData`** (`hardPurge.ts:33-60`) — REAL local wipe (allowlisted `cbt-*` keys, verify, retry, sign out). **✅ FIXED:** now `async`, awaits `wipeAllApiKeys()` (clears IndexedDB BYOK keys, fail-open try/catch) then best-effort `apiClient.purge("hard-purge", auth.token, auth.deviceId)` with a failure toast ("Server data not purged") + `console.warn`. `DestructionKey.tsx:116` calls `void hardPurgeLocalData().finally(() => navigate('/auth'))`. Server `/purge` now real (see 3.9).
- **LlmPanel / BYOK** (`byokKeyManager.ts`) — REAL: IndexedDB + WebCrypto AES-GCM, real test-connection fetch. 24 providers from `llmRegistry.ts`.
- **SessionTable / privacyStore** (`privacyStore.ts:13-38`) — FAKE data: `seedDevices` hardcoded ("This browser", "Clinic iPad — Supervision room", "Shared workstation — Admin desk"). `revoke` only filters local array; current-device revoke signs out locally via BroadcastChannel. **No backend device/session management exists.**
- **PrefsPanel** — theme light/dark/system REAL (`themeStore`).
- **AuditPanel** — reads local audit store (capped 80 events).

---

## 7. Backend Lambda TODO stubs (updated after fixes)

| Endpoint | Location | Status |
|---|---|---|
| `POST /export` (S3 upload) | `lambda/handlers/export.ts:22-30` | ✅ now **501** "Export upload is not implemented." (honest error, no fake `s3Url`) |
| `POST /purge` | `lambda/handlers/purge.ts:17-40` | ✅ now **REAL** (confirmation-gated per-user `DELETE`, returns `deletedRows`) |
| `/metrics` | `lambda/handlers/health.ts:39` | `// TODO: Implement`, empty arrays |
| Auth validation | `lambda/middleware/auth.ts:30-35` | **partial fix:** malformed tokens rejected (length<8/whitespace → 401); still accepts any well-formed non-empty token (`userId = token`) — real CRDB verification still TODO |
| CORS | `lambda/handler.ts:126-131` | ✅ fail-loud: `console.warn` when `ALLOWED_ORIGIN` unset (still falls back to `*`) |
| Read chat_turns endpoint | none | **missing** — written but unreadable |

## 8. Dead code / console stubs (fire-and-forget masking)

- `metrics.ts:16-60` — 8 crisis metric wrappers defined, **never called** (only `metric.purgeFromGraph`, `metric.streamDone` used).
- `uploadExportBundle` / `apiClient.exportBundle` — DEAD.
- `apiClient.searchMemory` — DEAD. `apiClient.purge` — DEAD.
- `coreMemories()`, `nodeScale()` — DEAD.
- Backend sync failures swallowed with `console.warn` in 4 files (`chatStore.ts:231`, `sessionStore.ts:166`, `memoryStore.ts:239,262`, `exportBundle.ts:79`).

---

## Recommended fix order — status after this session

| # | Fix | Status |
|---|---|---|
| 1 | **Fix the LLM fallback short-circuit** (make `callOnDeviceLLM` throw when WebLLM isn't loaded) | ✅ **DONE** (§1.1) |
| 2 | **Fix auth persistence** (real `merge` in `createVersionedPersist` that unpacks `data`) | ✅ **DONE** (§4.8) |
| 3 | **Fix magic-link double-consume** (run-once guard; treat already-authenticated as success) | ✅ **DONE** (§4.9); also token hardened to `crypto.getRandomValues` + 10-min expiry (§4.2) |
| 4 | Wire `startAudioWorker` into `HoldToTalkOrb` with graceful failure | ⬜ OPEN (§1.2) |
| 5 | Stop presenting seed/demo data as real: empty states instead of seeds on hydrate failure | ✅ **DONE** (`memoryStore.ts:207-211`, `sessionStore.ts:141-144` — both set `[]` + `hydrateError`) |
| 6 | Persist Kanban status + edge/node edits; implement `searchMemory` + `addNode` or remove | ⬜ OPEN (§2.3/§3.4/§3.6) |
| 7 | Implement server purge/export/auth-validation; wire into hardPurge; add `GET /turns`; set `ALLOWED_ORIGIN`; rate limiting | 🔶 **PARTIAL** — purge real + export 501 + auth malformed-check + `wipeAllApiKeys` wired + `apiClient.purge` wired; `GET /turns`, real token verification, `ALLOWED_ORIGIN` set, rate limiting still open |
| 8 | Web-quality fixes: contrast, `aria-label` on file input + sessions `<select>`, `public/robots.txt` | ✅ **DONE** (see WEB-QUALITY-AUDIT.md §7) |
| 9 | Remove/annotate fake face worker + TTS badge | 🔶 **PARTIAL** — TTS badge fixed (§1.7); fake face worker (§1.3) still present, annotated |
