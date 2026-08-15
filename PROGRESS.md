# Progress — CBT Memory Agent

> Pipeline v2 migrasi: On-device media → Cloud LLM hanya intisari teks

---

## Phase 0 — Foundation (P0) — Safety + Correctness

- [x] **P0-1** AudioWorklet menggantikan ScriptProcessorNode
  - [x] Buat `audio-processor.ts` (AudioWorkletProcessor via blob source string)
  - [x] Ganti `audioClient.ts`: AudioWorklet → postMessage PCM (`audioClient.ts:71-74`)
  - [x] Hapus `connect(destination)` — analisis only, no echo (analysis-only, `audioClient.ts:95-96`)
  - [x] Fallback: AudioWorklet → ScriptProcessor (`audioClient.ts:104-112`)

- [x] **P0-2** VAD (Voice Activity Detection) sebelum transkripsi
  - [x] Integrasi Silero VAD ONNX model (lazy load)
  - [x] Gate PCM ke transkripsi hanya saat voice detected
  - [x] Silence flush counter (~5s threshold)

- [x] **P0-3** Versi pada semua Zustand store + migrasi
  - [x] `cbt-memory-agent-auth` → `{ version: 1, data }`
  - [x] `cbt-memory-graph` → `{ version: 1, data }`
  - [x] `cbt-sessions` → `{ version: 1, data }`
  - [x] `cbt-audit-log` → `{ version: 1, data }`
  - [x] `cbt-theme` → `{ version: 1, data }`
  - [x] `onRehydrateStorage`: versi mismatch → migrasi atau reset + toast

- [x] **P0-4** Crisis fail-closed
  - [x] `detectCrisis` dipanggil **sebelum** `set({ isStreaming: true })`
  - [x] Jika `triggerCrisis` gagal → tetap `isStreaming: false` + pesan sistem
  - [x] ErrorBoundary di dalam CrisisOverlay (988 tetap hidup)

- [x] **P0-5** Hard purge allowlist key `cbt-*`
  - [x] Ganti `localStorage.clear()` → iterate `cbt-*` keys only
  - [x] Verifikasi pasca-hapus: jika sisa `cbt-*` → ulang + toast gagal
  - [x] BroadcastChannel: terima hanya `{ type: "SIGN_OUT" }`, abaikan lainnya

---

## Phase 1 — On-Device Intelligence (P1)

- [x] **P1-1** MediaPipe Face Landmarker
  - [x] Model `face_landmarker.task` (3.7MB) di `public/models/` (fetch dari origin, bukan IndexedDB)
  - [x] 478 landmark + 52 blendshapes → ekspresi (neutral/engaged/tense/sad/distressed)
  - [x] Interval adaptif: 5Hz aktif, 1Hz idle, 0Hz crisis (`faceClient.ts:6-10`, `INTERVALS_MS`; self-scheduling `setTimeout`, crisis poll 500ms untuk resume)
  - [x] Wasm MediaPipe disalin ke `public/wasm/` dan `FilesetResolver.forVisionTasks('/wasm')` (fix build: API lama `{wasmPaths}` dihapus)

- [x] **P1-2** Whisper.cpp WASM transkripsi
  - [x] Lazy load model saat first hold-to-talk (`@huggingface/transformers` + `onnx-community/whisper-tiny`)
  - [x] EN + ID support — `detectLanguage()` dari `navigator.language` → dikirim sebagai hint ke worker (`transcribe.worker.ts`)
  - [x] Fallback: Web Speech API real — `src/features/chat/lib/webSpeech.ts` (live recognition paralel; dipakai bila Whisper worker gagal, `via: "web-speech"`)
  - [x] Fix bug jalur Whisper: `new Audio()` di worker selalu `ReferenceError` (Audio tidak ada di worker scope) → durasi kini diukur di main thread (`voiceNote.ts measureBlobDuration`)

- [x] **P1-3** Crisis fusion multimodal
  - [x] Weighted sum: text(0.5) + prosody(0.3) + face(0.2) (`src/features/crisis/lib/crisisFusion.ts`)
  - [x] Threshold > 0.7 → hard-halt + overlay (`CrisisFusionBridge` di `AppShell`, poll 500ms; desain konservatif — face/prosody saja tidak bisa trigger)
  - [x] `distressHint` single-writer (bridge); CameraPip hanya publish `setFace`

- [x] **P1-4** Intisari generator rule-based
  - [x] `generateIntisari(messages)` di `src/features/chat/lib/intisari.ts` — topic, mood cue, reframe template
  - [x] Dipakai di `ChatSafetyHeader.finalize()` (ganti metadata hardcoded `{mood:5,moodLabel:'grounded',reframe:null}`)
  - [ ] Output JSON `{themes, hotCognition, moodDelta, cbtPhase}` — **belum** (output saat ini: `{excerpt, mood, moodLabel, reframe}`)

---

## Phase 2 — Cloud Integration (P2)

- [x] **P2-1** Cloud LLM API endpoint
  - [x] POST /summarize dengan intisari terstruktur — diimplementasikan sebagai `POST /chat/turn` (SSE ke OpenRouter, `lambda/handlers/chatTurn.ts`)
  - [x] Max 500 token, tanpa PII, tanpa media — prompt CBT + streaming tokens

- [ ] **P2-2** Idempotency + cache 24h
  - [ ] `Idempotency-Key: {sessionId}` — **belum ada** (hanya di CORS allow_headers infra, tidak dibaca handler)
  - [ ] Fallback on-device jika cloud down/timeout 5s

- [ ] **P2-3** Audit log untuk saran cloud
  - [ ] Log setiap saran yang diterima/ditolak — **belum ada** (tabel `audit_events` ada tapi zero INSERT)

---

## Selesai

- [x] Port workspace-extracted ke project root
- [x] Docker multi-stage (node:22-alpine → nginx:1.27-alpine)
- [x] OPTIMISASI-10.md — 10 optimasi + 3 prioritas
- [x] ARSITEKTUR-PIPELINE-V2.md — desain pipeline 3 lapis
- [x] PROGRESS.md — checklist migrasi
- [x] 48 metrik — metricsStore + analytics + instrumentation + docs
- [x] BYOK — 24 providers, 50+ models, IndexedDB + WebCrypto, fallback chain

---

## Merge Monorepo (2026-08-14)

- [x] Gabung frontend + backend ke satu root tree (repo baru `main`, history dibuang)
- [x] `git init -b main`, 2 commit awal dibuat
- [x] `.env` real gitignored + `.env.example` (variabel saja, `BACKEND_URL`, `VITE_API_URL=/api/v1`)
- [x] Kredensial hardcoded dibersihkan dari docs → placeholder
- [x] Fix semua error build pre-existing: frontend `tsc -b` 8 error + lambda 6 error
- [x] Fix ONNX palsu (HTML) → `public/models/silero_vad.onnx` asli 2.3MB
- [x] `scripts/ccloud-auth.sh` — login ccloud headless (`--no-redirect`) + REST v1 API + cek MCP endpoint
- [x] `scripts/aws-login.sh` + `scripts/aws-export-creds.sh` — daily AWS SSO login + ekspor kredensial temp
- [x] `docs/DAILY-LOGIN-AWS.md` — panduan login harian AWS
- [x] `scripts/build-lambda.sh` — esbuild bundle → `lambda/cbt-memory-agent.zip`

## Deploy Backend (2026-08-14)

- [x] Terraform v1.15.8 diinstal ke `~/bin`
- [x] Bootstrap remote state: S3 `cbt-memory-agent-terraform-state` + DynamoDB lock table (manual, lalu di-import ke state)
- [x] Fix infra: `role_arn` lambda module, S3 bucket `cbt-memory-exports` ditambahkan, outputs.tf root diperbaiki, budget module (time_unit/anomaly/notification conditional)
- [x] Pilih region **us-east-1** (awal; cohere.embed-english-v3 ada di sana; ap-southeast-3 cuma embed-v4) — **DIGANTI ap-southeast-3** setelah migrasi OpenRouter
- [x] `terraform init` + `validate` + `plan` (23 resources) + `apply` — **SUKSES**
- [x] Deployed: Lambda `cbt-memory-agent` (nodejs22.x), Function URL, S3 exports, log group 7-day, budget $1, 5 SSM params, IAM role
- [x] Fix `--external:pg` → pg dibundle dalam zip (217KB) — perbaiki `Cannot find module 'pg'`
- [x] Function URL (us-east-1): `https://armepcglafkj763liezd75etlm0sqals.lambda-url.us-east-1.on.aws/`
- [x] `aws lambda invoke` → **200** `{"status":"ok","crdb":"connected","llm":"available","s3":"available","version":"0.1.0"}`
- [x] **403 Fixed:** Akses publik Function URL 403 (`AccessDeniedException`) — root cause: sejak Okt 2025 AWS butuh **dua** permission di resource-based policy (`lambda:InvokeFunctionUrl` + `lambda:InvokeFunction`) walau AuthType=NONE. Commit `8145e93` menambah statement kedua (`infra/modules/lambda/main.tf:94-104`); recheck pada ap-southeast-3 → **HTTP 200**. 403 murni dari AWS layer (handler tidak pernah return 403). Sisa: `docs/MANUAL-TESTING.md` masih menunjuk URL us-east-1 lama
- [ ] **TODO:** Setup GitHub remote + secrets untuk `.github/workflows/deploy.yml` (butuh static AWS keys, CRDB creds, dll) — `git remote -v` masih kosong; deploy.yml butuh 9 secrets + tambah `TF_VAR_resend_api_key` (variabel required)
- [ ] **TODO:** Deploy frontend (docker image + nginx proxy `/api/v1` → backend) — infra masih Lambda-only, belum ada compute frontend

## Migrasi Bedrock → OpenRouter (2026-08-14)

Keputusan: LLM inference + embeddings dipindah total dari Amazon Bedrock ke OpenRouter
(Bedrock TIDAK wajib untuk hackathon — cukup ≥1 AWS service, Lambda + S3 sudah cukup).

- [x] `lambda/lib/openrouter.ts` dibuat — LLM chat (`openrouter/free` router) + embeddings (`baai/bge-m3`, 1024-dim) + health check `/credits`
- [x] `lambda/lib/bedrock.ts` dihapus; `handler.ts`/`health.ts`/`chatTurn.ts`/`semanticSearch.ts` pakai `OpenRouterClient`
- [x] `lambda/package.json` hapus `@aws-sdk/client-bedrock-runtime`; lockfile regen; `tsc --noEmit` PASS
- [x] `handleChatTurn` diimplementasi — upsert user (`md5(token)::uuid`), memory context, CBT prompt, SSE stream ke OpenRouter, simpan chat_turns
- [x] `handleSemanticSearch` diimplementasi — embedding query → pgvector cosine (`<=>`), filter user + confidence
- [x] Terraform: hapus bedrock policy IAM + `BEDROCK_REGION`; tambah SSM `/hackathon/openrouter/api-key` + env `OPENROUTER_API_KEY`; `terraform validate` PASS
- [x] `src/shared/lib/apiClient.ts` `HealthResponse.bedrock` → `llm`; frontend `tsc --noEmit` PASS
- [x] OpenRouter API verified: `baai/bge-m3` = 1024-dim (free), `openrouter/free` router streaming OK, `/credits` HTTP 200
- [x] **DEPLOY DONE**: build zip (207KB) + `terraform apply` (SSM `/hackathon/openrouter/api-key` + env `OPENROUTER_API_KEY`, bedrock policy dihapus)
- [x] **Invoke test PASS**: health `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}`; chat/turn → SSE stream CBT response (tokensUsed 606, chat_turns + sessions + users tersimpan di CRDB); semantic → `{"v":1,"results":[]}` (200, embeddings kosong — memory upsert masih stub)
- [x] **DONE**: `handleUpsertMemory` + `handleDeleteMemory` real (CRDB), FK user di-ensure saat write
- [x] **INTEGRASI FRONTEND-BACKEND (2026-08-14)**: handler memory/session real (list/upsert/delete CRDB); read-side hydrate di memoryStore + sessionStore (server wins, empty server = empty state); `BackendSyncStatus` komponen (loading/error/empty); `OfflineBanner` health probe; Vite dev proxy `/api/v1` → Function URL; LLM `backend-proxy` diarahkan ke `/api/v1/chat/turn` (SSE); semua endpoint terverifikasi 200 via curl langsung + lewat proxy `localhost:5173`

## Migrasi Region us-east-1 → ap-southeast-3 (2026-08-14)

Keputusan: **semua resource AWS dipindah ke ap-southeast-3** agar Lambda berada dekat dengan cluster CRDB `woozy-grivet` (ap-southeast-3) — menghindari cross-region hop. Setelah migrasi OpenRouter (region-agnostic), tidak ada alasan lagi bertahan di us-east-1.

- [x] Bootstrap state infra baru di ap-southeast-3: S3 `cbt-memory-agent-terraform-state-apse3` + DynamoDB `cbt-memory-agent-terraform-lock-apse3`
- [x] Update backend.tf/main.tf + default region variables (ap-southeast-3)
- [x] `terraform init -migrate-state` → pindahkan state
- [x] Update `lambda/lib/s3.ts` (region-aware), scripts, CI deploy.yml, docs
- [x] `terraform apply` → destroy us-east-1, create ap-southeast-3
- [x] Verifikasi health/chat/semantic di region baru + recheck 403
- [ ] Bersihkan resource us-east-1 yang ter-orphan

## Audit Komprehensif (2026-08-15)

Audit fitur, kualitas web (Lighthouse), dan keamanan selesai. Dokumen lengkap di `docs/15-8-26/`.

- [x] **AUDIT.md** — status tiap fitur: REAL / PARTIAL / STUB / DEAD / BROKEN / FAKE (chat, sessions, memory, auth, crisis, privacy, Lambda stubs)
- [x] **WEB-QUALITY-AUDIT.md** — Lighthouse 13.4.1: `/auth` perf 57/a11y 92/BP 100/SEO 91; authed pages a11y 90–96, BP 100, SEO 80. Temuan utama: kontras `text-white/40` gagal 4.5:1 di sidebar semua halaman; file input & `<select>` tanpa label; `robots.txt` belum ada. (Angka perf adalah dev-server; re-run prod build.)
- [x] **SECURITY-AUDIT.md** — backend menerima token non-empty apa pun (tanpa authN/authZ); token = `profile.id` (Math.random); sesi tidak bertahan reload (persist rehydration bug); magic-link double-consume; passkey tanpa `credentials.get()`; copy "never leaves this device" bertentangan dengan upload CRDB; hard purge tidak hapus IndexedDB BYOK keys & data server; CORS default `*`; `/purge` `/export` stub.
- [x] **Bug kunci terverifikasi di browser**: (1) persist auth tidak restore `status/profile` setelah reload → `/chat` → `/auth`; (2) magic-link "Link not valid" padahal sudah autentik (double-consume `params` di deps effect). Workaround masuk app: `/auth` → magic link → "Open magic link" → "Return to sign in" → onboarding → `/chat`.
- [x] `npm run typecheck` PASS setelah audit (audit tidak mengubah source).

## Remediasi Audit (2026-08-15) — implementasi fix order

Fix dari AUDIT/WEB-QUALITY/SECURITY diimplementasikan; `npm run typecheck` (frontend) + `npx tsc --noEmit` (lambda) PASS.

- [x] **LLM fallback short-circuit** — `callOnDeviceLLM` sekarang `throw` saat WebLLM belum di-load (`llmClient.ts:162`) → chain backend-proxy→openrouter benar-benar jalan, stuck streaming hilang
- [x] **Auth persist rehydration** — `versionedPersist.ts:39-42` custom `merge` unpack `persistedState.data` → `status/profile` restore lintas reload
- [x] **Magic-link hardening** — `secureToken()` (32B `crypto.getRandomValues`, base64url, `format.ts:25`); TTL 10 menit (`magicTokenExpiresAt`); `AuthCallbackPage` run-once `consumedRef` + treat-already-authenticated-as-success → bug "Link not valid" hilang
- [x] **A11y** — kontras `text-white/40→/60`, `text-white/45→/60`, teal→`teal-700`; `aria-label` file input (`Composer.tsx:97`) + `<select>` filter (`SessionsPage.tsx:103`); `public/robots.txt`
- [x] **TTS badge** — `ChatSafetyHeader.tsx:51` kini jujur `TTS pending` (bukan deteksi `"gpu" in navigator`)
- [x] **Hard purge** — `hardPurgeLocalData` async: `wipeAllApiKeys()` + `apiClient.purge("hard-purge", …)` + toast gagal; `DestructionKey` navigate setelah selesai
- [x] **Backend** — `purge.ts` real (confirmation-gated per-user `DELETE` semua tabel via `crdb.executeCount`); `export.ts` → 501; `auth.ts` tolak token malformed (len<8/whitespace); CORS fail-loud warn saat `ALLOWED_ORIGIN` kosong
- [x] **Empty state hydrate gagal** — `memoryStore`/`sessionStore` set `[]` + `hydrateError` (bukan seed sebagai data asli)
- [x] **Dokumen audit diperbarui** menandai status fix (AUDIT.md, WEB-QUALITY-AUDIT.md, SECURITY-AUDIT.md §7 remediation log)
- [x] **DONE sejak 2026-08-15 (Phase A/B/C):** real authN/authZ server-side **sebagian** (session_token verification via `validateAuth` async + `SELECT id FROM users WHERE session_token=$1`, `middleware/auth.ts:41-42`; legacy `profile.id` masih fallback), `GET /turns` read endpoint (2.5), integrasi WebLLM on-device (1.1), wiring `startAudioWorker` → Hold-to-talk (1.2), passkey `credentials.create` real (create saja, `get` belum)
- [ ] **Masih terbuka** (untuk lanjutan): passkey `credentials.get()` assertion ceremony, rewrite copy privasi, `ALLOWED_ORIGIN` ter-set (masih `*`), rate limit + server audit log, CSP handler, route-level code splitting, re-run Lighthouse pada prod build, hapus resource us-east-1 orphan

## Phase A + B (2026-08-15) — implementasi WORK-LIST

Semua item Phase A (on-device) + Phase B (no-UI features) dari `docs/15-8-26/WORK-LIST.md` selesai. `npm run typecheck` (frontend) + `npx tsc --noEmit` (lambda/) PASS.

- [x] **1.5 Binaural** — `CalmingAudio.tsx` dua `StereoPannerNode` (L=-1, R=+1), 174/180Hz → beat 6Hz stereo beneran (bukan monophonic)
- [x] **1.6 TTS** — `src/shared/lib/speech.ts` (speechSynthesis: speak/stop/isSpeaking/toggle); tombol **Speak/Stop** di tiap balasan assistant (`ChatBubble`); badge header `TTS ready/unavailable` jujur
- [x] **1.4 Face expression real** — `@mediapipe/tasks-vision` + model `face_landmarker.task` (3.7MB, `public/models/`); worker baru `classifyBlendshapes` (distressed/tense/sad/engaged/neutral), fallback luma hanya jika model gagal load; `FaceSignal.model` label `ML`/`approx`
- [x] **1.7 Waveform playback + truncated** — `WaveformScrubber` pakai `HTMLAudioElement` real (play/pause, scrub seek); `triggerBargeIn` kini set `truncated: true` → tombol "Auto-resume" jadi reachable
- [x] **1.2+1.3 Voice notes** — `@huggingface/transformers` + worker Whisper (`transcribe.worker.ts`, `onnx-community/whisper-tiny`); `voiceNote.ts` merekam mic (MediaRecorder) + wiring `startAudioWorker` (VAD+level); `HoldToTalkOrb` kirim transkrip + blob audio (waveform playable)
- [x] **1.1 WebLLM** — `@mlc-ai/web-llm` + `src/shared/lib/onDeviceLLM.ts` (MLCEngine lazy, Phi-3-mini-4k Q4, streaming via `chat.completions`); `callOnDeviceLLM` kini benar-benar inferensi on-device; gagal → throw (fallback chain tetap jalan)
- [x] **P1-1 Interval adaptif face** — `faceClient.ts` self-scheduling `setTimeout` (`INTERVALS_MS={active:200,idle:1000,crisis:0}`, `CRISIS_POLL_MS=500`); mode dari `recording/isStreaming/crisisActive` (`getMode` di `CameraPip`); fix guard `video.readyState<2` re-schedule; wasm MediaPipe → `public/wasm/` + `FilesetResolver.forVisionTasks('/wasm')` (build fix)
- [x] **P1-2 Whisper EN+ID + Web Speech fallback** — `detectLanguage()` → hint `language` ke `transcribe.worker.ts`; fallback real via `webSpeech.ts` (live recognition, `via:"web-speech"` + toast); fix bug `new Audio()` di worker (ReferenceError) → durasi diukur di main thread (`measureBlobDuration`)
- [x] **P1-3 Crisis fusion multimodal** — `src/features/crisis/lib/crisisFusion.ts` `computeCrisisScore` (text 0.5 + prosody 0.3 + face 0.2, threshold >0.7); `CrisisFusionBridge` (AppShell, poll 500ms) → `triggerCrisis`; `distressHint` single-writer (bridge), `chatStore.prosody` dari audio worker
- [x] **P1-4 Intisari rule-based** — `src/features/chat/lib/intisari.ts` `generateIntisari` (topic/mood/reframe); dipakai `ChatSafetyHeader.finalize()` ganti metadata hardcoded
- [x] **WebLLM progress UI** — `LlmPanel.tsx`: progress bar + tombol Preload (`subscribeOnDeviceProgress`, `preloadOnDeviceEngine`, `isOnDeviceEngineReady`; `setInitProgressCallback`)
- [x] **2.1 Semantic memory search UI** — `MemoryPage` debounce 400ms → `apiClient.searchMemory` (GET `/memory/semantic`), hasil chip clickable; fallback substring lokal
- [x] **2.2 Add-memory-node UI** — `memoryStore.addNode` (+ `syncNode` ke backend); tombol "Add memory" di `GraphToolbar`; `AddMemoryModal` dialog baru
- [x] **2.6 Kanban status persist** — `sessionStore.setStatus` kini `apiClient.saveSession` (upsert) → status bertahan di CockroachDB
- [x] **2.7 Memory persist + edge-delete** — `moveNode`/`touch`/`verify`/`updateNode` sync via `syncNode`; `unlink` → `apiClient.deleteMemoryEdge` (endpoint `DELETE /memory/edge/:id` baru di `memory.ts` + routing)
- [x] **2.5 Session detail transcript** — `GET /session/:id/turns` baru (`handlers/turns.ts`) baca `chat_turns`; `SessionDetailPage` render transkrip; tombol continue → `/chat?session=…`
- [x] **2.3 Metrics page + /metrics real** — `handleMetrics` query real (sessions/memory/chat_turns/audit_events per-user); halaman `/metrics` baru + nav "Metrics"
- [x] **2.4 S3 export real** — `handleExport` kumpulkan bundle (sessions/memories/edges/turns/audit) → `s3.uploadExport` (presigned URL); `ExportBuilder` tombol "Upload to S3" wire `uploadExportBundle` (sebelumnya dead code)
- [ ] **Masih terbuka** (Phase C/D): **deploy Phase C ke Lambda live** (SSM `RESEND_API_KEY` + apply schema `auth_tokens`/`session_token`), passkey `credentials.get()`, rewrite copy privasi, rate limit + server audit log (`audit_events` INSERT), `ALLOWED_ORIGIN` ter-set (masih `*`), CSP + code splitting, re-run Lighthouse prod build, device registry (`seedDevices` → real `/devices`)

## Phase C: Resend magic-link (2026-08-15)

Magic-link email via Resend — server-backed auth, resolves WORK-LIST 3.2 (real token verification).

- **Schema** (`schema/crdb-schema.sql`): new `auth_tokens` table (email, token_hash SHA-256, method='magic-link', expires_at 10min, used_at single-use) + `users.session_token` column
- **Backend** (`lambda/handlers/auth.ts` baru): `POST /api/v1/auth/magic-link` (public) — 32B `crypto.randomBytes` token, simpan hash, kirim email via Resend (plain fetch, tanpa SDK); `POST /api/v1/auth/callback` — verifikasi hash/expiry/reuse, upsert `users` dengan `session_token` baru, kembalikan ke frontend. Dev mode tanpa `RESEND_API_KEY` → `{ok:true,sent:false,devUrl}` (on-device preview tetap jalan)
- **Routing** (`lambda/handler.ts`): kedua route auth public (skip middleware); `validateAuth` kini async + `SELECT id FROM users WHERE session_token=$1` → identity dari DB (bukan client). Legacy `profile.id` tetap lolos via fallback
- **Frontend**: `apiClient.requestMagicLink/consumeMagicLink` (public); `authStore.issueMagicLink/consumeMagicLink` async (server-first, fallback local dev); `getAuthHeaders` pakai `profile.sessionToken ?? profile.id`; `SessionProfile.sessionToken?`; `MagicLinkForm` state loading/sent/dev-preview; `AuthCallbackPage` server verify
- **Config**: `RESEND_API_KEY` + `EMAIL_FROM=onboarding@resend.dev` di `.env` (git-ignored) + placeholder di `.env.example`. **Tidak pernah di-commit**
- **Cost** (verified): ≤100 email/bulan ≈ $0 (Resend free tier 3k/mo, Lambda free tier). 1 email = 1 invokasi Lambda (~$0) + 1 email Resend
- **Terraform wiring done** (commit `fe98ab3`): env `RESEND_API_KEY` via SSM `/hackathon/resend/api-key`, `EMAIL_FROM`, `APP_URL` masuk ke Lambda env; `infra/terraform.tfvars` siap
- **⚠ Deployment live belum diverifikasi**: perlu `aws login --profile aws-x-cdb`, apply schema ke CRDB, `terraform apply`, lalu test magic-link. Sampai saat itu perilaku live = dev-mode preview (`{ok:true, sent:false, devUrl}`). Juga `deploy.yml` belum kirim `TF_VAR_resend_api_key` (variabel `resend_api_key` sekarang required tanpa default → CI `terraform apply` akan gagal sampai secret ditambah)

## Observability: Full-Stack OpenTelemetry → Grafana Cloud (2026-08-15)

Instrumentasi OTel penuh 3 lapisan (traces+logs+metrics) ke Grafana Cloud OTLP gateway (stack 1494299, Tempo). Rencana & hasil di `docs/15-8-26-adding-observability/`. **✅ DEPLOYED + VERIFIED live.**

- [x] **Frontend** — `src/shared/lib/telemetry.ts` (WebTracerProvider + FetchInstrumentation + W3C propagator + OTLP exporter → relay `POST /api/v1/telemetry`); mount di `main.tsx`; span `agent.ondevice` di `onDeviceLLM.ts` (gen_ai provider=webllm). Sampling 10% default (`VITE_OTEL_SAMPLING_RATIO`). Token Grafana TIDAK di bundle — relay server-side.
- [x] **Backend** — `lambda/lib/telemetry.ts` (TracerProvider+metrics+logs, extract W3C traceparent, `flushTelemetry` sebelum return); `lambda/handlers/telemetry.ts` (relay passthrough + parse `OTEL_EXPORTER_OTLP_HEADERS`); `handler.ts` root span + `X-Trace-Id` header; spans `agent.memory.retrieve`/`llm.openrouter`/`db.persist` di `chatTurn.ts`.
- [x] **Infra** — SSM `/hackathon/grafana/otlp-endpoint` + `/hackathon/grafana/otlp-headers`; Lambda env `OTEL_SERVICE_NAME`/`OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_EXPORTER_OTLP_HEADERS`; `terraform apply` sukses (2 add, 1 change).
- [x] **Verifikasi E2E** — `npx tsx scripts/verify_telemetry.ts` → **PASS semua**: X-Trace-Id roundtrip (traceparent browser→backend), SSE chat valid, spans `agent.memory.retrieve`+`llm.openrouter`+`db.persist` ter-record di Tempo. Tempo query: `https://tempo-prod-23-prod-ap-southeast-2.grafana.net/tempo` (user 1446402 + read-only token).
- [x] **Fix kunci** — (1) `startSpan` harus pass `parentCtx` ke arg ke-3 `tracer.startSpan` (OpenTelemetry JS v2.x API) — tanpa ini trace selalu root baru; (2) `OTEL_EXPORTER_OTLP_HEADERS` di-recompute dari `GRAFANA_OTLP_TOKEN` saat ini (versi lama encode token usang); (3) relay parse `Authorization=Basic …` (nilai mengandung `=`) via `parseKeyValueHeaders`.
- [ ] **Masih terbuka** — Tempo/Loki/Mimir dashboard di Grafana UI; alert OTLP export failure; metrics dashboard util; re-verify frontend trace di browser (perlu `VITE_OTEL_ENABLED=true` di build frontend + dev proxy `/api/v1`).
