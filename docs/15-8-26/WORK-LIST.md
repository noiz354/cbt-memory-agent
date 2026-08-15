# Work List — CBT Memory Agent (next tasks)

> Generated: 2026-08-15, after the audit remediation commit (`5d3fa6b`).
> Purpose: prioritized backlog of implementable tasks. Ordered from **on-device / local-only** (no backend needed) →
> **features with no UI yet** → **backend endpoints with no frontend integration** → **hardening / infra**.
> Legend: 🟢 Ready (dependencies available) · 🔵 Medium · 🟡 Larger/uncertain · file refs are `file:line`.
> Status column: ⬜ not started / 🔶 partial / ✅ done (baseline from 5d3fa6b).

---

## 0. Baseline (already done in 5d3fa6b)

- LLM fallback chain unblocked (`llmClient.ts:162` now throws when WebLLM absent → backend-proxy/OpenRouter run).
- Auth persists across reloads (`versionedPersist.ts` merge unpack), magic-link hardened (crypto token + TTL + run-once consume).
- Hard purge wipes IndexedDB BYOK keys + calls server `/purge`; `/export` → 501; `/purge` real; auth middleware rejects malformed tokens; CORS fail-loud.
- A11y contrast/labels/robots.txt; empty states on hydrate failure; honest `TTS pending` badge.
- Docs: `AUDIT.md`, `WEB-QUALITY-AUDIT.md`, `SECURITY-AUDIT.md`, `ADDY-OSMANI-SKILLS.md`, `README.md`.

---

## 1. On-device / local-only (no backend) — unlock the faked "local" promises

These make the "on-device, zero-cloud" branding true for the parts that are currently stubs.

### 1.1 🟢 Integrate `@mlc-ai/web-llm` for real on-device LLM — ✅ DONE (Phase A)
- **Status:** implemented 2026-08-15. `@mlc-ai/web-llm` installed; new `src/shared/lib/onDeviceLLM.ts` (lazy `MLCEngine`, `Phi-3-mini-4k-instruct-q4f16_1-MLC`, streaming via `chat.completions`); `callOnDeviceLLM` (`llmClient.ts`) now does real on-device inference and throws only when the engine/model is unavailable so the fallback chain still runs.
- **Remaining nuance (✅ closed 2026-08-15 lanjutan):** progress UI kini **disurface di `LlmPanel.tsx`** — `subscribeOnDeviceProgress` + progress bar + tombol "Preload" (`preloadOnDeviceEngine()`/`isOnDeviceEngineReady()`); `setInitProgressCallback` (bukan opsi `reload`) di `onDeviceLLM.ts`. Model weights tetap ~GB class — butuh WebGPU/WebAssembly, tidak viable di low-memory.
- **Why:** `callOnDeviceLLM` now throws (baseline fix). On-device inference is the stated differentiator but never implemented.
- **What:** add `@mlc-ai/web-llm`, load a small model (e.g. `Phi-3-mini-4k-instruct-q4f16_1-MLC` as already referenced in `llmClient.ts`), wire into `callOnDeviceLLM` to stream tokens via `onStream`. Keep the throw only when the model isn't loaded.
- **Files:** `src/shared/lib/llmClient.ts:152-167`; new `src/workers/llm.worker.ts` optional.
- **Acceptance:** on-device replies stream in `/chat` when a model is loaded; fallback still fires otherwise; `supportsStreaming: true` in `llmRegistry` for `local-webllm`.
- **Considerations:** WASM + model weights are ~GB class; needs a download/progress UI; not viable on low-memory devices. This is the largest single task. 🟡

### 1.2 🟢 Wire the audio pipeline into HoldToTalkOrb (voice notes, real) — ✅ DONE (Phase A)
- **Status:** implemented 2026-08-15. New `src/features/chat/lib/voiceNote.ts` (`startVoiceNote` getUserMedia + MediaRecorder + `startAudioWorker` VAD/level, `stopVoiceNote` → blob + transcription, `cancelVoiceNote`); `HoldToTalkOrb.tsx` rewritten (record → transcribe → `sendMessage(text, {src})`; no fake message; mic-denied toast; recording-level dot).
- **Lanjutan 2026-08-15 (P1-2):** `voiceNote.ts` kini juga feed `chatStore.setProsody(rms)` untuk crisis fusion; durasi blob diukur di main thread (`measureBlobDuration` — fix `new Audio()` yang tak ada di worker scope); `detectLanguage()` dari `navigator.language`; fallback Web Speech live (`webSpeech.ts`) → `via: "web-speech"` + toast info.
- **Why:** `HoldToTalkOrb.tsx:20` still injects a **hardcoded fake voice-note message** on stop; `startAudioWorker` has zero callers (dead code).
- **What:** in `HoldToTalkOrb.start()` call `getUserMedia({audio:true})` + `startAudioWorker(stream, onLevel, onVoice)`; on `stop()` stop the worker, transcribe the captured PCM, and call `sendMessage(transcript)`. Add VAD gating (`isVoiceActive`), mic-denied toast, and a recording-level indicator (RMS/peak already streamed from `audioClient.ts:37-62`).
- **Files:** `src/features/chat/components/HoldToTalkOrb.tsx`, `src/workers/audioClient.ts` (already complete), `src/workers/audio.worker.ts`, `src/workers/audio-processor.ts`, `src/workers/vad.worker.ts`.
- **Acceptance:** holding the orb records real audio, produces a real transcript in chat; no fake message; mic permission denied shows a toast, not a fabricated note.
- **Sub-task:** transcription engine — see 1.3.

### 1.3 🟡 On-device transcription (Whisper.cpp WASM / transformers.js) — ✅ DONE (Phase A)
- **Status:** implemented 2026-08-15. `@huggingface/transformers` (v4.2.0) installed; new `src/workers/transcribe.worker.ts` runs `pipeline('automatic-speech-recognition','onnx-community/whisper-tiny')` lazily on the recorded blob and returns the transcript; wired via `voiceNote.ts`. Model downloads on first use (`env.allowLocalModels = false`).
- **Lanjutan 2026-08-15 (P1-2):** EN + ID eksplisit — `TranscribeIn.language` (dari `detectLanguage()` main-thread) → `model(blobUrl, {language, return_timestamps:false})`. **Fix bug:** `new Audio()` di worker selalu `ReferenceError` (Audio/DOM tak ada di worker scope) → jalur Whisper selalu jatuh ke fallback; kini durasi diukur di main thread (`measureBlobDuration` di `voiceNote.ts`). Fallback Web Speech API real bila worker gagal (`via: "web-speech"`).
- **Why:** hold-to-talk has no transcription engine. `onnxruntime-web` is already a dependency (used by VAD); a Whisper ONNX model can reuse it.
- **What:** add a whisper-tiny/base ONNX build, decode in `src/workers/audio.worker.ts` (or a new `transcribe.worker.ts`), return text on flush after silence (`getSilenceFrames`).
- **Acceptance:** spoken phrase → text appended as a chat message. 🟡 (model size + runtime tuning)

### 1.4 🟢 Replace the fake face-expression worker with a real model — ✅ DONE (Phase A)
- **Status:** implemented 2026-08-15. `@mediapipe/tasks-vision` installed; `face_landmarker.task` (float16, 3.7MB) downloaded to `public/models/`; `src/workers/face.worker.ts` now runs real `FaceLandmarker` (CPU, IMAGE mode, `outputFaceBlendshapes`) and maps blendshapes → distressed/tense/sad/engaged/neutral with confidence. Same `FaceWorkerOut` contract; `FaceSignal.model` added (`'mediapipe'|'fallback'`), `CameraPip` shows `ML`/`approx`. Luma fallback retained only if the model fails to load.
- **Lanjutan 2026-08-15 (P1-1):** interval adaptif di `faceClient.ts` — self-scheduling `setTimeout`, `INTERVALS_MS={active:200,idle:1000,crisis:0}` + `CRISIS_POLL_MS=500`, mode dari `recording/isStreaming/crisisActive` via `getMode()` di `CameraPip`; guard `video.readyState<2` kini me-re-schedule (bukan return permanen). Wasm MediaPipe disalin ke `public/wasm/` (23MB) + `FilesetResolver.forVisionTasks('/wasm')` (fix build: API lama `{wasmPaths}` dihapus).
- **Why:** `src/workers/face.worker.ts:30` maps **luma** to a fake expression; the UI already shows expression+confidence from `CameraPip.tsx`.
- **What:** swap the stand-in for MediaPipe Face Landmarker (or an ONNX emotion model via existing `onnxruntime-web`). Keep the same `FaceWorkerOut` message contract so `faceClient.ts`/`CameraPip` don't change.
- **Files:** `src/workers/face.worker.ts`, `src/workers/faceClient.ts`.
- **Acceptance:** expression values reflect the actual face; `distressHint` in `CameraPip` no longer fires on bright frames.

### 1.5 🟢 Make CalmingAudio actually binaural — ✅ DONE (Phase A)
- **Status:** implemented 2026-08-15. Each oscillator routed to its own `StereoPannerNode` (`pan` = −1 / +1) before the shared gain → true 6 Hz stereo binaural beat; user-gesture start preserved.
- **Why:** `CalmingAudio.tsx:20-38` mixes two oscillators into one GainNode → monophonic 6 Hz beat, labelled "binaural-ish".
- **What:** route each oscillator to a separate `StereoPannerNode` (L/R), `panner.pan.setValueAtTime(±1)`; keep user-gesture start requirement.
- **Acceptance:** true stereo binaural beat; no regression in autoplay policy handling.

### 1.6 🟢 Real TTS (or keep honest badge) — ✅ DONE (Phase A)
- **Status:** implemented 2026-08-15 via Web Speech `speechSynthesis`. New `src/shared/lib/speech.ts` (`speak`/`stopSpeaking`/`isSpeaking`/`toggleSpeak`, markdown-strips text); a **Speak/Stop** button per assistant reply in `ChatBubble`; header badge now reflects reality (`"speechSynthesis" in window ? 'TTS ready' : 'TTS unavailable'`).
- **Why:** `ChatSafetyHeader.tsx:51` now honestly shows `TTS pending`. Implement or leave as is.
- **What:** (a) use Web Speech `speechSynthesis` for the assistant reply (simplest, zero deps) or (b) WebGPU/WebLLM-based TTS (matches the original "WebGPU TTS" badge). Wrap in a `speak(text)` util with `prefers-reduced-motion`/session-safety guard.
- **Acceptance:** a "Speak reply" affordance plays the assistant message; badge reflects reality.

### 1.7 🟢 Wire waveform playback + real barge-in — ✅ DONE (Phase A)
- **Status:** implemented 2026-08-15. `WaveformScrubber` plays a real `HTMLAudioElement` when `audio.src` is present (play/pause + scrub seek); `triggerBargeIn` now sets `truncated: true` so the `ChatBubble` resume path is reachable; swipe-left barge-in halts generation (playback of the attached note stops when the message unmounts).
- **Why:** `WaveformScrubber.tsx:12` is `useState(0.22)` static; `resumeStream`/`truncated` are dead (never set).
- **What:** when audio is attached to a message, render the real buffer and allow scrubbing/playback; set `truncated: true` when the stream is halted so `ChatBubble.tsx:146` resume path becomes reachable; make swipe-barge-in stop actual playback, not just generation.
- **Acceptance:** seed `audio.peaks` message plays real audio; barge-in halts both LLM streaming and playback.

---

## 2. Features with NO UI yet (backend or lib code exists, UI missing)

### 2.1 🟢 Semantic memory search UI — ✅ DONE (Phase B)
- **Status:** implemented 2026-08-15. `MemoryPage` search input now debounces 400 ms → `apiClient.searchMemory` (GET `/memory/semantic`); ranked hits render as clickable chips that select the node; local substring search retained as fallback.
- **Why:** `apiClient.searchMemory` (`apiClient.ts:239`) + backend `handleSemanticSearch` are implemented with **zero UI callers**.
- **What:** add a search box (e.g. in `MemoryPage` header or `CommandPalette`) → `searchMemory(q)` → highlight/rank matching nodes on the graph. Also consider injecting top hits as `pendingMemories` into the composer.
- **Files:** `src/features/memory/pages/MemoryPage.tsx`, `src/features/memory/components/` (new `MemorySearch.tsx`).
- **Acceptance:** typing a query returns ranked semantic results rendered in the memory view; `searchMemory` has real callers.

### 2.2 🟢 "Add memory node" UI — ✅ DONE (Phase B)
- **Status:** implemented 2026-08-15. `memoryStore.addNode` (node body → `upsertMemory` via new `syncNode` helper) + "Add memory" button in `GraphToolbar` + new `AddMemoryModal` dialog (title/excerpt, Enter submits, Escape closes).
- **Why:** there is **no `addNode`/create action** anywhere; the only node source is seed data or manual DB inserts. Backend `POST /memory` accepts nodes.
- **What:** an "Add memory" affordance (toolbar button or composer → "save as memory") that builds a `MemoryNode` and calls `upsertMemory` with a node body; mirror the existing edge-upsert path (`memoryStore.ts:235-239`).
- **Files:** `src/features/memory/store/memoryStore.ts` (new `addNode`), `GraphToolbar.tsx`, `src/features/memory/components/`.
- **Acceptance:** a node created in the UI persists to CRDB and survives hydrate.

### 2.3 🟢 Metrics / dashboard page — ✅ DONE (Phase B)
- **Status:** implemented 2026-08-15. `handleMetrics` (health.ts) rewritten with real per-user aggregates (sessions by status, memory counts/confidence/refs, chat_turns count, audit_events grouped by type, crisis counts); new `/metrics` route + sidebar item + `src/features/metrics/pages/MetricsPage.tsx` (StatCards + Refresh). `apiClient.metrics` now has a caller. Note: `metric.*` crisis wrappers still not called from `CrisisOverlay` — the numbers rely on server-side `audit_events`.
- **Why:** `GET /metrics` handler exists but is a TODO stub (`health.ts:39`); `apiClient.metrics` has zero callers; the `metrics.ts` crisis wrappers are dead.
- **What:** implement `handleMetrics` (aggregate from `audit_events` — crisis counts, grounding completions, lifeline taps, session count, per-day mood) and add a `Settings → Metrics` (or `/metrics` route + sidebar item) page rendering them.
- **Files:** `lambda/handlers/health.ts:34-44`, new `src/features/metrics/` page + route in `router.tsx`.
- **Acceptance:** `/api/v1/metrics` returns real aggregates; a UI page displays them. Tie-in: call `metric.crisisGroundingDone` etc. from `CrisisOverlay` so the numbers are meaningful.

### 2.4 🟢 Real server-side export path (wire the dead `uploadExportBundle`) — ✅ DONE (Phase B)
- **Status:** implemented 2026-08-15. `handleExport` (export.ts) builds a full bundle (sessions/memories/edges/turns/audit) and uploads to S3 via the existing `S3ClientService` (AES256, presigned GET URL 24 h); returns 501 only when `S3_BUCKET` is unset. `ExportBuilder` gained an "Upload to S3" button wired to `uploadExportBundle` (was dead code).
- **Why:** `uploadExportBundle` (`exportBundle.ts:70`) + `apiClient.exportBundle` are dead; backend `/export` now returns 501.
- **What:** implement the backend to mint a JSON bundle and upload to S3 (S3 client already exists: `lambda/lib/s3.ts`), return a real signed URL; wire `uploadExportBundle` into `ExportBuilder` as an option alongside local download.
- **Files:** `lambda/handlers/export.ts`, `src/features/privacy/components/ExportBuilder.tsx`, `src/features/privacy/lib/exportBundle.ts`.
- **Acceptance:** "Export to cloud" produces a real S3 object with a working download URL.

### 2.5 🟢 Session detail: show the real chat transcript — ✅ DONE (Phase B)
- **Status:** implemented 2026-08-15. New `GET /api/v1/session/:id/turns` (new `lambda/handlers/turns.ts`, reads `chat_turns`); `apiClient.listSessionTurns`; `SessionDetailPage` renders the transcript (bubbles + timestamps + injected-memory count); "Continue similar conversation" now navigates to `/chat?session=<id>` (chatStore gained `setActiveSession`).
- **Why:** backend **writes** `chat_turns` but there is **no read endpoint**; `SessionDetailPage` shows only summary fields and never touches `chatStore`/backend.
- **What:** add `GET /sessions/:id/turns` (or `GET /chat/turns?sessionId=`), an `apiClient.getTurns(sessionId)` method, and render the transcript in `SessionDetailPage` (falling back to a "session synced" note when the session is local-only). Wire "Continue similar conversation" to pass the session ID.
- **Files:** `lambda/handler.ts` (route), new `lambda/handlers/turns.ts`, `src/shared/lib/apiClient.ts`, `src/features/sessions/pages/SessionDetailPage.tsx`.
- **Acceptance:** opening a synced session shows its full chat history from CRDB.

### 2.6 🟢 Kanban status changes persist — ✅ DONE (Phase B)
- **Status:** implemented 2026-08-15. `sessionStore.setStatus` now fire-and-forgets `apiClient.saveSession` (POST /session upserts by id) so a status drag survives reload after hydrate.
- **Why:** `setStatus` (`sessionStore.ts:141-144`) is local-only (Zustand + localStorage); dragging "Pending"→"Extracted" never reaches the backend; no PATCH endpoint.
- **What:** add `POST /session/:id/status` (or extend `POST /session` upsert) and call it from `setStatus` (fire-and-forget like `saveSession`). Debounce rapid drags.
- **Files:** `lambda/handler.ts`, `lambda/handlers/session.ts`, `src/features/sessions/store/sessionStore.ts`.
- **Acceptance:** a status drag survives reload on another device after hydrate.

### 2.7 🟢 Memory edits / verification persist to backend — ✅ DONE (Phase B)
- **Status:** implemented 2026-08-15. `moveNode`/`touch`/`verify`/`updateNode`/`addNode` all sync via `syncNode` → `upsertMemory` (node body); `unlink` now calls the new `DELETE /api/v1/memory/edge/:id` endpoint (`handleDeleteMemoryEdge` in memory.ts) so edges no longer resurrect on hydrate. FK 23503 still not explicitly caught (link of two server-missing nodes may 500 — open follow-up).
- **Why:** `updateNode`/`verify`/`touch`/`touchRecall` (`memoryStore.ts:267-287`) are local-only and **overwritten by the next hydrate**; `unlink` (edge) is visual-only (no edge-delete endpoint, FK 23503 can 500).
- **What:** call `upsertMemory` (node body) on edit/verify; add `DELETE /memory/edge/:id` (or extend `DELETE /memory/:id` with `?kind=edge`); catch FK 23503 and surface a clear error.
- **Files:** `lambda/handlers/memory.ts`, `src/features/memory/store/memoryStore.ts`.
- **Acceptance:** edits/verifies persist and survive hydrate; unlinking an edge removes it server-side; linking seed-only nodes no longer 500s.

---

## 3. Backend endpoints with no frontend integration (or stubbed)

### 3.1 ✅ DONE — `/metrics` real (see 2.3)
`handleMetrics` (`lambda/handlers/health.ts:34-110`) adalah aggregasi real per-user (sessions by status, memory counts/confidence/refs, chat_turns, `audit_events` grouped by type, crisis counts); routed di `handler.ts:128-130`.

### 3.2 ✅ DONE — Real token verification in `validateAuth`
- **Status (2026-08-15, Phase C, via Resend magic-link):** backend now mints a server-side `session_token` (32 B `crypto.randomBytes`) at magic-link consumption, stores it on the `users` row (`users.session_token` added to schema); `validateAuth` (now async, takes `crdb`) does `SELECT id FROM users WHERE session_token=$1` and returns the row's id. Legacy `profile.id` tokens still pass via fallback (`userId = token`) so old sessions keep working. `getAuthHeaders` prefers `sessionToken` over `profile.id`. **Deployment pending:** schema + env not yet applied to the live Lambda.
- **Acceptance:** a forged/guessed token is rejected; the server derives `userId` from its own table.

### 3.3 ✅ DONE — `/memory/semantic` search is implemented + wired (see 2.1)
Backend `semanticSearch.ts` real; UI di `MemoryPage.tsx` (debounce 400ms → `apiClient.searchMemory`, chips clickable, fallback substring lokal).

### 3.4 ✅ DONE — Edge-delete endpoint (see 2.7)
`DELETE /api/v1/memory/edge/:id` added in `lambda/handlers/memory.ts` + routed in `handler.ts`; frontend `apiClient.deleteMemoryEdge` + `unlink` wired. **Follow-up tersisa:** FK `23503` (link 2 node yang belum ada di server) belum di-catch → masih bisa 500 (`memory.ts:173-176` hanya catch `23505`).

### 3.5 🟡 `/chat/turn` rate limiting + server audit — ⬜ still open (verified 2026-08-15)
- **Why:** any token-holder can burn OpenRouter credits; no server-side audit log.
- **Status:** `lambda/lib/rateLimit.ts` belum ada; nol `429`/`rateLimit` di seluruh `lambda/`. Tabel `audit_events` ada di schema (9 jenis event) tapi **zero INSERT** — hanya dibaca (export.ts:51, health.ts:42/69); bahkan `purge.ts` tidak menulis `HARD_PURGE`.
- **What:** per-token rate limit (in-memory map atau DynamoDB; atau API Gateway throttling), dan `audit_events` write pada crisis/consent/purge events server-side.
- **Files:** `lambda/handler.ts`, new `lambda/lib/rateLimit.ts`, `lambda/lib/crdb.ts`.
- **Acceptance:** N requests/minute/token → 429; crisis/purge events appear in the DB.

### 3.6 🟡 Set `ALLOWED_ORIGIN` in deployed Lambda env — 🔶 partial (wired, value masih `*`)
Baseline made it fail-loud; now actually set the env var to the deployed frontend origin so CORS is never `*`. **Status 2026-08-15:** env `ALLOWED_ORIGIN` sudah di-wire lewat terraform (`infra/modules/lambda/main.tf:46`) tapi nilai di `infra/terraform.tfvars:16` masih `"*"`; `.env`/`.env.example` tidak punya key `ALLOWED_ORIGIN`. **Infra/ops task** — butuh deployed domain + update tfvars/SSM.

### 3.7 🟢 Device registry (replace fake `seedDevices`) — ⬜ open (verified 2026-08-15)
- **Status:** masih `seedDevices` palsu di `privacyStore.ts:13-38` (3 device demo); `revoke` cuma filter array lokal. Tidak ada endpoint `/devices` di `lambda/handler.ts` (routing `:72-135`) maupun `lambda/handlers/`.
- **What:** backend endpoints `POST /devices`, `GET /devices`, `DELETE /devices/:id`; frontend `SessionTable` reads/writes them; current-device revoke clears the stored session token.
- **Files:** `lambda/handler.ts` + new `lambda/handlers/devices.ts`, `src/features/privacy/store/privacyStore.ts`, `src/features/privacy/components/SessionTable.tsx`.
- **Acceptance:** the privacy "active sessions" list reflects real registered devices and revoke actually kills a session server-side.

---

## 4. Hardening / infra (defense-in-depth for a clinical app)

- **4.1** CSP + `X-Content-Type-Options`/`Referrer-Policy` headers — **🔶 partial:** nginx sudah set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, dan full CSP (`nginx.conf:45-49`). Yang masih terbuka: CSP meta di `index.html` (belum ada) + `corsHeaders()` di `lambda/handler.ts` (lambda tak punya CSP/X-CTO/Referrer). (WEB-QUALITY §7#7.)
- **4.2** Route-level code splitting — **⬜ open:** `src/app/router.tsx:3-11` masih statik import semua 9 page; nol `React.lazy`/dynamic `import(`. (WEB-QUALITY §7#6.)
- **4.3** Re-run Lighthouse terhadap `npm run build` + `vite preview` (atau deployed bundle) untuk angka perf/CWV nyata. (WEB-QUALITY §7#5.)
- **4.4** Fix the misleading privacy copy ("never leaves this device") atau gate cloud sync di belakang opt-in eksplisit, per SECURITY §2.6. — **⬜ open (verified 2026-08-15):** `chatStore.ts:59`, `llmClient.ts:67`, `PrivacyPage.tsx:33`, `AuthPage.tsx:25` masih mengklaim on-device padahal data di-upload.
- **4.5** Complete passkey (`navigator.credentials.get()` assertion ceremony) atau hapus fallback fake local-key, per SECURITY §2.5. — **🔶 partial:** `credentials.create` real (`passkey.ts:22-43`); `credentials.get` nol match → belum ada login ceremony; `mintLocalDeviceKey()` masih dipakai di `PasskeyPanel.tsx:59-60`.
- **4.6** Send the real display name to the server — **🔶 partial (2026-08-15):** magic-link consumption stores email prefix as `display_name` (`auth.ts:198-203`); passkey/legacy path masih `'device-user'` di `chatTurn.ts:151-152`, `memory.ts:245-246`, `session.ts:161-162`, `export.ts:60`.
- **4.7** Replace remaining seed data with true empty states on first run — **⬜ open (verified 2026-08-15):** baseline fixed hydrate-failure only; *initial* seed masih demo (`chatStore.ts:53-81` seedMessages, `memoryStore.ts:33-120` seedNodes+seedEdges, `sessionStore.ts:31-104` seed, `privacyStore.ts:13-38` seedDevices).
- **4.8** Remove dead code surfaced by the audit — **🔶 partial:** `coreMemories()` (`memoryStore.ts:347`), `nodeScale()` (`types.ts:43`), 7 metric crisis wrappers (`metrics.ts`) — semua DEAD (nol caller). `uploadExportBundle` **sudah LIVE** sejak Phase B (`ExportBuilder.tsx:82`) — bukan dead lagi. `apiClient.searchMemory`/`apiClient.purge` juga sudah punya caller.

---

## Suggested sequencing

| Phase | Items | Goal |
|---|---|---|
| **A — On-device trust** | 1.4, 1.5, 1.6, 1.7 (small); 1.2+1.3 (transcription); 1.1 (WebLLM, biggest) | Make the "on-device" claims real |
| **B — No-UI features** | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 | Close the biggest feature gaps with least backend risk |
| **C — Real auth** | 3.2, 3.7, 4.4, 4.5 | Remove the security blockers before any real deployment |
| **D — Hardening** | 3.5, 3.6, 4.1–4.3, 4.6–4.8 | Production readiness |

> **Phases A + B completed 2026-08-15** (see PROGRESS.md). Phase C (real auth) partially done 2026-08-15: **3.2 real token verification + Resend magic-link email backend** implemented (deployment pending — needs `aws login` + schema/env apply). Remaining Phase C: **deploy Phase C**, 3.7 device registry, 4.4 privacy copy, 4.5 passkey `credentials.get()`. Phase D (hardening): open below.
>
> **Verified 2026-08-15:** 3.1 & 3.3 done (real metrics + semantic search wired), 3.4 edge-delete done (FK 23503 follow-up open), 3.5 rate limit + server audit open, 3.6 `ALLOWED_ORIGIN` masih `*`, 3.7 device registry open, 4.1 CSP partial (nginx done), 4.2/4.3/4.4/4.7 open, 4.5/4.6/4.8 partial, 1.1 progress UI **✅ closed (LlmPanel)**, 1.2/1.3 **✅ + EN+ID + Web Speech fallback + fix Audio-in-worker**, 1.4 **✅ + interval adaptif**, **P1-3 crisis fusion + P1-4 intisari DONE**. `deploy.yml` belum kirim `TF_VAR_resend_api_key` (required var) → CI akan gagal sampai secret ditambah.
