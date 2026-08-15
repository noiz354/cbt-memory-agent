# Audit: CBT Memory Agent — Stubbed / Broken Features

> Audit date: 2026-08-15, against `main` with live backend.
> Backend health (via Vite proxy): `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}`. `typecheck` passes.
> Method: read-only source review of all features (`chat`, `sessions`, `memory`, `auth`, `crisis`, `privacy`) + Lambda handlers,
> plus live browser/Lighthouse verification (auth flow, onboarding, page snapshots).
> **Status update (2026-08-15, later session):** Phase A + B (WORK-LIST on-device + no-UI features) and Phase C (Resend magic-link)
> have been implemented since this audit was written; sections below are annotated where they are now ✅ FIXED. See PROGRESS.md.
> **Phase 1 on-device (2026-08-15, later still):** P1-1 adaptive interval + P1-2 Whisper EN+ID + Web Speech fallback + P1-3 crisis fusion multimodal
> + P1-4 intisari rule-based now DONE (§1.2-1.4, §2.2, §5). WebLLM progress surfaced in `LlmPanel.tsx`. `npx tsc -b` + `npm run build` PASS.
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
- **Follow-up (done 2026-08-15 Phase A):** `@mlc-ai/web-llm` integrated (`src/shared/lib/onDeviceLLM.ts`, lazy `MLCEngine`, Phi-3-mini Q4, real streaming). **✅ 2026-08-15 lanjutan:** progress kini disurface di UI — `subscribeOnDeviceProgress` + progress bar + tombol "Preload" di `LlmPanel.tsx`; `preloadOnDeviceEngine()`/`isOnDeviceEngineReady()`; `setInitProgressCallback` bukan options `reload`.

### 1.2 ✅ FIXED — Hold-to-talk / voice (real, Phase A 2026-08-15)
- `src/features/chat/lib/voiceNote.ts` (new): `getUserMedia` + `MediaRecorder` + `startAudioWorker` (VAD/level) → blob + transkrip.
- `HoldToTalkOrb.tsx` ditulis ulang: record → transcribe → `sendMessage(text, {src})`; tidak ada pesan fake; mic-denied toast; indikator level.
- Transkripsi on-device: `src/workers/transcribe.worker.ts` (`@huggingface/transformers` + `onnx-community/whisper-tiny`, lazy, `env.allowLocalModels = false`).
- **✅ 2026-08-15 lanjutan (P1-2):** EN+ID — `detectLanguage()` dari `navigator.language` → hint `language` ke worker (`transcribe.worker.ts`). Fallback Web Speech real: `src/features/chat/lib/webSpeech.ts` (live recognition paralel, dipakai bila Whisper worker gagal → `via: "web-speech"`, toast info di `HoldToTalkOrb`).
- **✅ 2026-08-15 lanjutan (fix bug):** `new Audio()` di worker selalu `ReferenceError` (tidak ada DOM di worker) → jalur Whisper selalu jatuh ke fallback; durasi kini diukur di main thread (`measureBlobDuration`).

### 1.3 ✅ FIXED — Face expression detection (real MediaPipe, Phase A 2026-08-15)
- `@mediapipe/tasks-vision` + `face_landmarker.task` (3.7MB, `public/models/`) → `src/workers/face.worker.ts` (CPU, IMAGE mode, `outputFaceBlendshapes`) → blendshapes → distressed/tense/sad/engaged/neutral + confidence.
- Kontrak `FaceWorkerOut` dipertahankan; `FaceSignal.model` (`'mediapipe'|'fallback'`), `CameraPip` menampilkan `ML`/`approx`. Luma fallback dipertahankan hanya jika model gagal load.
- **✅ 2026-08-15 lanjutan (P1-1):** interval adaptif di `faceClient.ts` — self-scheduling `setTimeout` (`INTERVALS_MS = {active:200, idle:1000, crisis:0}`, `CRISIS_POLL_MS=500`), mode dari `recording/isStreaming/crisisActive` via `getMode()` di `CameraPip`. Wasm kini disalin ke `public/wasm/` (23MB) + `FilesetResolver.forVisionTasks('/wasm')` (API lama `{wasmPaths}` dihapus — fix build).

### 1.4 ✅ FIXED — Waveform / audio playback / barge-in (Phase A 2026-08-15)
- `WaveformScrubber.tsx` kini memutar `HTMLAudioElement` real (play/pause, scrub seek) saat `audio.src` ada.
- `triggerBargeIn` set `truncated: true` → path resume di `ChatBubble.tsx:146` reachable; swipe barge-in menghentikan generation + playback note saat unmount.

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
- `saveSession` → `POST /session` upsert, real handler. But **only** called from "End session" (`ChatSafetyHeader.tsx:32`), fire-and-forget (`console.warn` on failure). **✅ 2026-08-15 lanjutan (P1-4):** metadata session kini dihasilkan `generateIntisari(messages)` (`src/features/chat/lib/intisari.ts`, rule-based) — topic keywords + mood cues + reframe template → `{excerpt, mood, moodLabel, reframe}` menggantikan hardcoded `{mood:5, moodLabel:"grounded", reframe:null}` (`ChatSafetyHeader.tsx:34-41`).

### 2.3 ✅ FIXED (Phase B 2026-08-15) — Kanban status changes persist
- `sessionStore.setStatus` kini fire-and-forget `apiClient.saveSession` (POST /session upsert by id) → status drag survives reload/hydrate (`sessionStore.ts`, WORK-LIST 2.6).

### 2.4 ✅ FIXED (Phase B 2026-08-15) — Session detail shows the real chat transcript
- New `GET /api/v1/session/:id/turns` (`lambda/handlers/turns.ts:25-70`, baca `chat_turns`), routed `handler.ts:112-115`; `apiClient.listSessionTurns`; `SessionDetailPage` render transkrip (bubbles + timestamps + injected-memory count).
- "Continue similar conversation" → `/chat?session=<id>` (chatStore `setActiveSession`).

### 2.5 ✅ FIXED (Phase B 2026-08-15) — Export now real S3 upload (was 501)
- `lambda/handlers/export.ts` kini membangun bundle penuh (sessions/memories/edges/turns/audit) dan upload ke S3 (AES256) via `S3ClientService` → presigned GET URL 24h; 501 hanya bila `S3_BUCKET` unset.
- `ExportBuilder.tsx:78-92` — tombol "Upload to S3" → `uploadExportBundle` (sebelumnya dead code).

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

### 3.3 ✅ FIXED (Phase B 2026-08-15) — upsertMemory (nodes + edges)
- Semua edit path kini sync ke backend via `syncNode` → `upsertMemory` (node body): `moveNode`/`touch`/`verify`/`updateNode`/`addNode`. Bukan lagi local-only.
- `unlink` → `DELETE /api/v1/memory/edge/:id` baru (`memory.ts` + routing) — edge tidak resurrect setelah hydrate.
- **Follow-up tersisa:** FK `23503` (link 2 node yang belum ada di server) belum di-catch → masih bisa 500 (`memory.ts:173-176` hanya catch `23505`).

### 3.4 ✅ FIXED (Phase B 2026-08-15) — searchMemory wired
- `apiClient.searchMemory` (GET `/memory/semantic`) kini punya caller: `MemoryPage` search box debounce 400ms → hasil chip clickable; fallback substring lokal.

### 3.5 ✅ FIXED (Phase B 2026-08-15) — drag/position persists to backend
- `moveNode` kini sync via `syncNode` → `upsertMemory`; tidak lagi overwritten oleh hydrate.

### 3.6 ✅ FIXED (Phase B 2026-08-15) — node creation from UI
- `memoryStore.addNode` + tombol "Add memory" di `GraphToolbar` + `AddMemoryModal` dialog (title/excerpt, Enter submit, Escape close).

### 3.7 ✅ FIXED (Phase B 2026-08-15) — NodeInspector edit / verify / touch / recall persist
- `updateNode`/`verify`/`touch`/`touchRecall` kini sync via `syncNode` → `upsertMemory` (node body); `touchRecall` menaikkan `references` dan tersinkron ke backend `ref_count`.

### 3.8 ✅ FIXED (Phase B 2026-08-15) — unlink edge real (endpoint baru)
- `unlink` memanggil `DELETE /api/v1/memory/edge/:id` — edge dihapus dari CockroachDB, tidak reappear setelah hydrate.
- Edge-case FK `23503` (link dua seed-only node) **masih bisa 500** — hanya `23505` (unique) yang di-catch (`memory.ts:173-176`). Open follow-up.

### 3.9 PurgeZone — node purge REAL; full user purge ✅ FIXED
- Node purge (`deleteMemory`) remains REAL (`memoryStore.ts:271`, `memory.ts:199-202`).
- **Was:** `apiClient.purge` → `lambda/handlers/purge.ts:16` `// TODO: Implement` returning `deletedRows: 0`; `hardPurge.ts` never called it.
- **Fix (done):** `lambda/handlers/purge.ts:17-40` is a real implementation — requires body `confirmation === "hard-purge"` (else 400),
  parameterized `DELETE` from `chat_turns`, `memory_edges`, `memory_nodes`, `sessions`, `users` (keyed `md5(token)::uuid`), returns
  `{ v:1, ok:true, deletedRows:{chatTurns,memoryEdges,memoryNodes,sessions,users} }`, 500 on error. `hardPurgeLocalData` now calls
  `apiClient.purge("hard-purge", …)` (see §6) and `lambda/lib/crdb.ts:44` gained `executeCount()`.

### 3.10 DEAD (masih open) — `coreMemories()` (`memoryStore.ts:347`), `nodeScale()` (`types.ts:43`)

---

## 4. Auth / Onboarding — `/auth`, `/onboarding`

### 4.1 PARTIAL — Passkey
- `passkey.ts:22-43` real `navigator.credentials.create({ publicKey })`. **No `navigator.credentials.get()` anywhere** (verified 2026-08-15, grep 0 hits) → every sign-in mints a new credential; no login ceremony.
- Fake fallback `mintLocalDeviceKey` (`passkey.ts:56-59`) mints a random hex string; wired at `PasskeyPanel.tsx:57-60` ("Sandbox has no platform authenticator…"), cosmetic 900ms wait.
- Backend hardcodes identity: user upsert `'device-user'` / `'passkey'` hanya di legacy/passkey path (`chatTurn.ts:151-152`, `memory.ts:245-246`, `session.ts:161-162`); magic-link path kini pakai email prefix (`auth.ts:198-203`).

### 4.2 ✅ FIXED (token hardening + server-backed transport) — Magic link
- **Was:** `authStore.issueMagicLink` stored the token in memory only; token = `uid()` = `Math.random().toString(36)` (**not crypto-safe**), no expiry; `MagicLinkForm.tsx:48-51` admits "There is no mail server in this build."
- **Fix 1 (done, earlier):** `format.ts:25` added `secureToken(prefix)` — 32 bytes from `crypto.getRandomValues`, base64url. `issueMagicLink` uses `secureToken("lnk")` and sets `magicTokenExpiresAt = Date.now() + MAGIC_LINK_TTL_MS` (10 min, `authStore.ts:9`); `consumeMagicLink` now checks expiry.
- **Fix 2 (done 2026-08-15, Phase C):** magic link is now **server-backed via Resend email** when `RESEND_API_KEY` is configured. Flow: `POST /api/v1/auth/magic-link` (public) → backend generates 32 B `crypto.randomBytes` token, stores its SHA-256 hash in the new `auth_tokens` table (10-min TTL, single-use `used_at`), emails a sign-in link via Resend (`lambda/handlers/auth.ts`, plain fetch to `api.resend.com`). `POST /api/v1/auth/callback` verifies the hash (expiry + reuse), marks it used, upserts the `users` row with a fresh server-issued `session_token`, and returns it. Frontend stores `sessionToken` on the profile; `getAuthHeaders` now prefers `sessionToken` over the legacy `profile.id`. Dev mode (no `RESEND_API_KEY`): backend returns `{ok:true, sent:false, devUrl}` and the form keeps the on-device inbox preview. **Deployment pending:** deployed Lambda lacks `RESEND_API_KEY` env + new schema (`auth_tokens`, `users.session_token`) — until redeploy, live behavior is the dev-mode preview path.

### 4.3 STUB — PersonalizedVault
- dnd-kit UI over `profile.goals` (array of ids), `addGoal`/`removeGoal` local-only (`authStore.ts:120-129`). **No encryption, no vault artifact, no credential-derived key.** Plaintext `localStorage["cbt-memory-agent-auth"]`.

### 4.4 REAL (local only) — Onboarding persistence
- `finishOnboarding` (`authStore.ts:130-134`) sets status `onboarded` if consent + ≥1 goal; persisted to localStorage. Nothing written to backend at onboarding.

### 4.5 ✅ FIXED (Phase C 2026-08-15) — AuthCallbackPage real server verification
- `authStore.consumeMagicLink` kini async server-first: `POST /api/v1/auth/callback` (server verify hash/expiry/reuse → upsert users → kembalikan `session_token`); dev-mode fallback ke perbandingan lokal tetap ada.
- Copy "Validating the one-time token on this device" masih agak overstated untuk dev-mode; live server path benar.

### 4.6 PARTIAL — SessionGate
- Gates on `localStorage["cbt-memory-agent-auth"].status` string (local UI gate; bukan security boundary).
- `getAuthHeaders` (`authSession.ts:14-18`) kini pakai `profile.sessionToken ?? profile.id` sebagai bearer; backend `lambda/middleware/auth.ts:41-42` kini `validateAuth` async → `SELECT id FROM users WHERE session_token=$1` → identity dari DB. **Legacy fallback masih ada** (`middleware/auth.ts:53-54` → `userId = token`) agar sesi lama tetap jalan — jadi token non-DB yang well-formed masih diterima. Live Lambda belum deploy schema `session_token` (Phase C pending).

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
- `CalmingAudio.tsx` — real WebAudio, **✅ kini true binaural (Phase A 2026-08-15):** tiap oscillator → `StereoPannerNode` sendiri (pan = −1 / +1) sebelum shared gain → beat 6Hz stereo beneran (bukan monophonic).
- `SwipeToCall.tsx` — real `tel:` navigation gated on ≥88% drag; `988` (US) and `119` (ID) correct.
- `CrisisOverlay.tsx` — real flow: focus trap + Escape-block, emergency-contact `tel:` gated on `emergency.notify`, `tel:988`/`sms:119`, UGD map search; exit disabled until grounded. Logs `CRISIS_ENGAGED`/`CRISIS_DISMISSED` to local audit store only — **no backend `/crisis` endpoint**.
- `ChatSafetyHeader` session timer (`:21-25`) measures **header mount duration** only (resets on navigation). End session builds mood via `generateIntisari` (see 2.2).
- **✅ 2026-08-15 lanjutan (P1-3) — crisis fusion multimodal:** `src/features/crisis/lib/crisisFusion.ts` — `computeCrisisScore({text, prosody, face})` = text×0.5 + prosody×0.3 + face×0.2, threshold > 0.7; desain konservatif (face/prosody saja tak bisa trigger). `CrisisFusionBridge` (mount di `AppShell`) poll 500ms → `triggerCrisis` bila lintas threshold; `distressHint` single-writer (komponen ini), `computeDistressHint()` menerima fallback luma bila confidence > 0.7. Input: teks user terakhir + `chatStore.prosody` (RMS live, dari audio worker saat recording) + `chatStore.face` (MediaPipe).

## 6. Settings / Privacy — `/settings/privacy` (no dedicated `src/features/settings`)

- **ExportBuilder / `buildExportBundle`** (`exportBundle.ts:11-53`) — REAL: assembles chat/mood/memory from stores → local JSON download. **✅ Phase B:** tombol "Upload to S3" → `uploadExportBundle` (`ExportBuilder.tsx:78-92`); backend `POST /export` real (bundle → S3 AES256 → presigned URL, 501 hanya jika `S3_BUCKET` unset).
- **DestructionKey / `hardPurgeLocalData`** (`hardPurge.ts:33-60`) — REAL local wipe (allowlisted `cbt-*` keys, verify, retry, sign out). **✅ FIXED:** now `async`, awaits `wipeAllApiKeys()` (clears IndexedDB BYOK keys, fail-open try/catch) then best-effort `apiClient.purge("hard-purge", auth.token, auth.deviceId)` with a failure toast ("Server data not purged") + `console.warn`. `DestructionKey.tsx:116` calls `void hardPurgeLocalData().finally(() => navigate('/auth'))`. Server `/purge` now real (see 3.9).
- **LlmPanel / BYOK** (`byokKeyManager.ts`) — REAL: IndexedDB + WebCrypto AES-GCM, real test-connection fetch. 24 providers from `llmRegistry.ts`.
- **SessionTable / privacyStore** (`privacyStore.ts:13-38`) — FAKE data: `seedDevices` hardcoded ("This browser", "Clinic iPad — Supervision room", "Shared workstation — Admin desk"). `revoke` only filters local array; current-device revoke signs out locally via BroadcastChannel. **No backend device/session management exists.**
- **PrefsPanel** — theme light/dark/system REAL (`themeStore`).
- **AuditPanel** — reads local audit store (capped 80 events).

---

## 7. Backend Lambda TODO stubs (updated after fixes + Phase B/C)

| Endpoint | Location | Status |
|---|---|---|
| `POST /export` (S3 upload) | `lambda/handlers/export.ts` | ✅ **REAL (Phase B)** — bundle → S3 AES256 → presigned URL 24h; 501 hanya bila `S3_BUCKET` unset |
| `POST /purge` | `lambda/handlers/purge.ts:17-40` | ✅ **REAL** (confirmation-gated per-user `DELETE`, returns `deletedRows`) — masih belum menulis `HARD_PURGE` ke `audit_events` |
| `/metrics` | `lambda/handlers/health.ts:34-110` | ✅ **REAL (Phase B)** — aggregasi per-user: sessions by status, memory counts/confidence/refs, chat_turns, `audit_events` grouped, crisis counts |
| `GET /session/:id/turns` | `lambda/handlers/turns.ts:25-70` | ✅ **REAL (Phase B)** — baca `chat_turns`, routed `handler.ts:112-115` |
| `DELETE /memory/edge/:id` | `lambda/handlers/memory.ts` | ✅ **REAL (Phase B)** — edge-delete, routed; FK `23503` follow-up open |
| `POST /auth/magic-link`, `/auth/callback` | `lambda/handlers/auth.ts` | ✅ **REAL (Phase C)** — Resend email, `auth_tokens` table, `session_token` upsert; **deployment ke live belum diverifikasi** |
| Auth validation | `lambda/middleware/auth.ts:41-42,53-54` | 🔶 **partial:** kini async `SELECT id FROM users WHERE session_token=$1` (identity dari DB); malformed rejected (401); **legacy `profile.id` fallback masih ada**; live schema belum apply |
| CORS | `lambda/handler.ts:149-156` | 🔶 fail-loud: `console.warn` saat `ALLOWED_ORIGIN` unset (masih fallback `*`; tfvars masih `"*"`) |

## 8. Dead code / console stubs (fire-and-forget masking)

- `metrics.ts:16-60` — 7 crisis metric wrappers defined, **never called** (hanya `metric.purgeFromGraph`, `metric.streamDone`, `metric.graphLinkCreated`, `metric.exportSuccess` yang dipakai). `CrisisOverlay` pakai `auditStore.log` langsung → angka krisis di Metrics selalu 0.
- `coreMemories()` (`memoryStore.ts:347`), `nodeScale()` (`types.ts:43`) — DEAD (nol caller).
- ✅ `uploadExportBundle` / `apiClient.exportBundle` — **sekarang LIVE** (Phase B, `ExportBuilder.tsx:82`). ✅ `apiClient.searchMemory` — **LIVE** (2.1). ✅ `apiClient.purge` — **LIVE** (hard purge).
- Backend sync failures swallowed with `console.warn` (fire-and-forget pattern tetap ada di beberapa path).

---

## Recommended fix order — status after this session

| # | Fix | Status |
|---|---|---|
| 1 | **Fix the LLM fallback short-circuit** (make `callOnDeviceLLM` throw when WebLLM isn't loaded) | ✅ **DONE** (§1.1) + Phase A: WebLLM real (`onDeviceLLM.ts`) |
| 2 | **Fix auth persistence** (real `merge` in `createVersionedPersist` that unpacks `data`) | ✅ **DONE** (§4.8) |
| 3 | **Fix magic-link double-consume** (run-once guard; treat already-authenticated as success) | ✅ **DONE** (§4.9); token hardened (§4.2) + **server-backed via Resend (Phase C, §4.2/§4.5)** — deployment live belum diverifikasi |
| 4 | Wire `startAudioWorker` into `HoldToTalkOrb` with graceful failure | ✅ **DONE (Phase A §1.2)** — voice notes real (`voiceNote.ts`, Whisper tiny transkrip) |
| 5 | Stop presenting seed/demo data as real: empty states instead of seeds on hydrate failure | ✅ **DONE** (`memoryStore.ts:207-211`, `sessionStore.ts:141-144`); *initial* seed di store baru masih demo (4.7 open) |
| 6 | Persist Kanban status + edge/node edits; implement `searchMemory` + `addNode` | ✅ **DONE (Phase B)** — 2.3/2.6/2.7/3.3-3.8 di atas |
| 7 | Implement server purge/export/auth-validation; wire into hardPurge; add `GET /turns`; set `ALLOWED_ORIGIN`; rate limiting | 🔶 **PARTIAL** — purge real + export real S3 + `GET /turns` + token verification (`session_token`) done (Phase B/C); `ALLOWED_ORIGIN` masih `*`, rate limiting + server audit open |
| 8 | Web-quality fixes: contrast, `aria-label` on file input + sessions `<select>`, `public/robots.txt` | ✅ **DONE** (see WEB-QUALITY-AUDIT.md §7) |
| 9 | Remove/annotate fake face worker + TTS badge | ✅ **DONE** — face worker kini real MediaPipe (§1.3); TTS badge jujur (§1.7); CalmingAudio true binaural (§5) |
| 10 | Phase C/D tersisa | passkey `credentials.get()`, privacy copy, device registry, rate limit + `audit_events` INSERT, CSP handler, code splitting, Lighthouse prod, deploy Phase C ke live, bersihkan us-east-1 orphan |
