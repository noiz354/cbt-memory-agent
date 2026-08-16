# Progress — CBT Memory Agent

> Pipeline v2 migrasi: On-device media → Cloud LLM hanya intisari teks

## Live (ap-southeast-3 · akun 926375049642)

- **Frontend:** https://d2sbinyjz34sz4.cloudfront.net (CloudFront dist `EWWRSYJJMZAO9`, SPA S3+OAC)
- **Backend API:** https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws (Lambda Function URL, base `/api/v1`)
- **Health:** `GET /api/v1/health` → `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}` (via CF & direct, 200)
- **Dashboard:** https://console.aws.amazon.com/cloudwatch/home#dashboards/dashboard:CBTMemoryAgent
- **CI/CD:** GitHub Actions `Deploy Backend + Frontend` — pipeline **hijau penuh** (auto-deploy via OIDC `cbt-github-actions-deploy`, tanpa static AWS keys)

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
- [x] **TODO:** Deploy frontend — **S3 + CloudFront** (bukan docker/nginx) sejak 2026-08-16, lihat section `Deploy & CI` di bawah

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
- [x] Bersihkan resource us-east-1 yang ter-orphan (2026-08-16: S3 state bucket, DynamoDB lock, Lambda, log group, 6 SSM param — semua dihapus; ap-southeast-3 utuh)

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
- [x] **Masih terbuka (diselesaikan 2026-08-16):** passkey `credentials.get()` (commit `d8737e3`), `ALLOWED_ORIGIN` ter-set ke domain CloudFront, CSP + security headers via CloudFront response headers policy, hapus resource us-east-1 orphan. **Masih terbuka:** rewrite copy privasi, rate limit + server audit log (`audit_events` INSERT), route-level code splitting, re-run Lighthouse pada prod build

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
- [x] **Deployment live — VERIFIED 2026-08-16** (lihat section `Deploy & CI`): schema `auth_tokens` + `users.session_token` sudah di-apply ke CRDB sejak deploy Phase C; `RESEND_API_KEY` live di Lambda env; `POST /auth/magic-link` → `{ok:true,sent:true}`; `POST /auth/callback` diverifikasi E2E (single-use, replay ditolak). `deploy.yml` sudah kirim semua `TF_VAR_*` termasuk `resend_api_key`

## Observability: Full-Stack OpenTelemetry → Grafana Cloud (2026-08-15)

Instrumentasi OTel penuh 3 lapisan (traces+logs+metrics) ke Grafana Cloud OTLP gateway (stack 1494299, Tempo). Rencana & hasil di `docs/15-8-26-adding-observability/`. **✅ DEPLOYED + VERIFIED live.**

- [x] **Frontend** — `src/shared/lib/telemetry.ts` (WebTracerProvider + FetchInstrumentation + W3C propagator + OTLP exporter → relay `POST /api/v1/telemetry`); mount di `main.tsx`; span `agent.ondevice` di `onDeviceLLM.ts` (gen_ai provider=webllm). Sampling 10% default (`VITE_OTEL_SAMPLING_RATIO`). Token Grafana TIDAK di bundle — relay server-side.
- [x] **Backend** — `lambda/lib/telemetry.ts` (TracerProvider+metrics+logs, extract W3C traceparent, `flushTelemetry` sebelum return); `lambda/handlers/telemetry.ts` (relay passthrough + parse `OTEL_EXPORTER_OTLP_HEADERS`); `handler.ts` root span + `X-Trace-Id` header; spans `agent.memory.retrieve`/`llm.openrouter`/`db.persist` di `chatTurn.ts`.
- [x] **Infra** — SSM `/hackathon/grafana/otlp-endpoint` + `/hackathon/grafana/otlp-headers`; Lambda env `OTEL_SERVICE_NAME`/`OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_EXPORTER_OTLP_HEADERS`; `terraform apply` sukses (2 add, 1 change).
- [x] **Verifikasi E2E** — `npx tsx scripts/verify_telemetry.ts` → **PASS semua**: X-Trace-Id roundtrip (traceparent browser→backend), SSE chat valid, spans `agent.memory.retrieve`+`llm.openrouter`+`db.persist` ter-record di Tempo. Tempo query: `https://tempo-prod-23-prod-ap-southeast-2.grafana.net/tempo` (user 1446402 + read-only token).
- [x] **Fix kunci** — (1) `startSpan` harus pass `parentCtx` ke arg ke-3 `tracer.startSpan` (OpenTelemetry JS v2.x API) — tanpa ini trace selalu root baru; (2) `OTEL_EXPORTER_OTLP_HEADERS` di-recompute dari `GRAFANA_OTLP_TOKEN` saat ini (versi lama encode token usang); (3) relay parse `Authorization=Basic …` (nilai mengandung `=`) via `parseKeyValueHeaders`.
- [ ] **Masih terbuka** — Tempo/Loki/Mimir dashboard di Grafana UI; alert OTLP export failure; metrics dashboard util; re-verify frontend trace di browser (perlu `VITE_OTEL_ENABLED=true` di build frontend + dev proxy `/api/v1`).

## FASE 4: Monetisasi — Transaction Tracking + Metrik Grafana (2026-08-15)

Fondasi event ingestion + aggregasi keuangan + dashboard monetisasi. **✅ DEPLOYED + VERIFIED live** (CRDB `woozy-grivet`, Lambda ap-southeast-3, Grafana Cloud `imanino`). Spesifikasi & ADR di `docs/15-8-26/` (FASE4-MONETIZATION-SPEC.md, ADR-002-monetization-schema.md).

- [x] **Schema** (`schema/migration-2026-08-15-monetization.sql`, idempotent, diterapkan live) — `user_events` (event stream: event_name, properties JSONB, session_id, device_id, occurred_at; index `(user_id)` + `(event_name, occurred_at)`), `subscriptions` (status CHECK, amount DECIMAL(12,2), billing_cycle monthly/yearly, started/ended/cancelled_at), `marketing_ad_spend` (period_date, channel, cost DECIMAL, UNIQUE(period_date,channel)). Semua nilai uang DECIMAL, semua pembagian NULLIF-safe.
- [x] **Backend events** — `lambda/handlers/events.ts` POST `/api/v1/events` (batch ≤50, allowlist 6 event monetisasi, non-allowlist di-drop → 201 {inserted,rejected}, 400/422/500). Identity user dari server (md5(token)::uuid konsisten chatTurn). Routing di `handler.ts`.
- [x] **Backend monetisasi lib** (`lambda/lib/monetization.ts`) — `calculateCAC` (spend / new paying, null-safe) + `getMonetizationSummary` (mrr, arr, arpu, arppu, ltv, ltvCac, cac, revenueChurnRate, checkoutAbandonmentRate, failedPaymentRate, grossMargin, churnRate; rasio 0..1). Handlers GET `/api/v1/monetization/cac` + `/summary` (param period YYYY-MM/YYYY-MM-DD, grossMargin, churnRate). Semua rasio null (bukan NaN/Inf) saat pembagi nol.
- [x] **SQL native** (`schema/monetization-queries.sql`) — 8 query siap-macro Grafana: MRR growth New/Expansion/Churned (date_trunc + FILTER), MRR level+ARR, ARPU/ARPPU, LTV vs CAC + LTV:CAC, checkout funnel, failed payment rate, revenue churn rate, checkout abandonment — tiap pembagian `NULLIF(denominator,0)`, monetari `::numeric`.
- [x] **Seed deterministik** (`scripts/seed-monetization.ts`, npx tsx) — 45 user, 43 subscriptions (34 aktif/9 cancel, 12% yearly, 18% upgrade starter→pro, 25% churn), 152 user_events (funnel checkout/payment/cancel/upgrade + 8 abandoned checkout), ad spend harian google/meta/tiktok/organic 6 bulan. Wipe 3 tabel dulu (dev-only). PRNG mulberry32 reproduksibel.
- [x] **Frontend helper only** — `src/shared/lib/trackEvent.ts` (buffered, batch 50 / flush 10s / pagehide) + `apiClient.trackEvent()` → POST /events. Tanpa UI billing (per spec).
- [x] **Grafana** — dashboard 8 panel `infra/grafana/monetization-dashboard.json` (uid `monetization`): MRR growth timeseries stacked, MRR&ARR stat, ARPU/ARPPU, LTV vs CAC (~3:1), checkout funnel bargauge, failed payment gauge, revenue churn + abandonment stat. Provisioning `scripts/grafana-provision.sh` (datasource postgres uid `crdb-postgres` + import dashboard) — **sukses live di Grafana Cloud imanino** (health "Database Connection OK", query E2E funnel [53,43,45,3] via /api/ds/query).
- [x] **Tests** — `lambda/tests/monetization.test.ts` 13 tes (validation/allowlist/CAC div-0/summary full-math via mock CRDB substring dispatch) + handler.contract routes diperluas 3 route baru. `npm test` 35/35 ✓, `npx tsc --noEmit` ✓, frontend `npm run typecheck` ✓.
- [x] **Deploy live** — `terraform apply` (source_code_hash) → Lambda Function URL ap-southeast-3. Curl live: POST /events → 201 {inserted:2,rejected:1}; GET /monetization/cac?period=2026-06 → {spend:2346.34,newPayingUsers:7,cac:335.19}; GET /monetization/summary?period=2026-06 → {mrr:1349,arr:16188,arpu:103.77,arppu:64.24,ltv:254.23,ltvCac:0.76,revenueChurnRate:1.4,cac:335.19,churnRate:0.29}.
- [x] **Grafana provisioning gotchas fixed** — (1) `.env` tidak bisa di-bash-`source` (baris bare base64 token) → loader grep-based; (2) Grafana 13.2 postgres datasource API wajib `access:"proxy"`; (3) `node -e` argv mulai `slice(1)` (bukan slice(2)) saat arg ikut.
- [ ] **Masih terbuka (Review/SHIP decisions)** — API mengembalikan rasio 0..1 sedangkan panel Grafana persen (*100): dokumentasi sudah ada di ADR-002; `getUserChurnRate` fallback `?? 0` saat paying=0 (proxy data-driven; butuh sumber billing asli seperti Stripe untuk produksi); rate limiting + auth ketat untuk POST /events di produksi.

## FASE 1+2+3: Core Telemetry · UX Funnel · Retention & Cohort (2026-08-15)

Fondasi event stream produksi, funnel aktivasi, dan cohort retention. **✅ DEPLOYED + VERIFIED live** (CRDB `woozy-grivet`, Lambda ap-southeast-3, Grafana Cloud `imanino`). Spesifikasi & ADR di `docs/15-8-26/` (FASE123-ANALYTICS-SPEC.md, ADR-003-analytics.md).

### FASE 1 — Core Telemetry
- [x] **Event catalog terpusat** (`lambda/lib/eventCatalog.ts`) — 30 event, 8 kategori (core/auth/chat/crisis/voice/memory/privacy/monetization); `partitionEvents`/`isAllowedEventName` pindah ke katalog (re-export dari `monetization.ts`, allowlist monetisasi 6 nama tetap).
- [x] **Frontend track layer** (`src/shared/lib/telemetryEvents.ts`) — `track(name, properties?)` + konstanta `TELEMETRY_EVENTS`, wrapping buffer `trackEvent.ts`.
- [x] **Wiring ~20 call-site** — authStore (login_completed magic-link+passkey, onboarding_completed), appStore (crisis_triggered/resolved), AppShell (app_launch + RouteTracker page_view via `useLocation`), PasskeyPanel (signup_completed), chatStore (session_started, message_sent, stream_done, stream_truncated ×2, resumeStream), CrisisOverlay (crisis_grounding_done ref-guarded), SwipeToCall (crisis_lifeline_used), voiceNote (voice_note_recorded, transcript_received whisper/web-speech), memoryStore (memoryAdded/Updated/Deleted/EdgeLinked), MemoryPage (memorySearched), sessionStore (sessionFinalized/Interrupted), exportBundle (export_completed), hardPurge+DestructionKey (purge*).
- [x] **Bug metric.* diperbaiki** — `addNode` salah panggil `graphLinkCreated` → `track(memoryAdded)`; metric dead-code di-wire (purgeStarted/Completed/Abandon/postPurgeResidue, streamTruncated, crisisGroundingDone, crisisLifelineTap, sessionFinalized/Orphaned/RequeueOk); fix brace `hardHalt` di chatStore (syntax error saat build).

### FASE 2 — UX Funnel
- [x] **Backend** (`lambda/lib/analytics.ts` + `lambda/handlers/analytics.ts`) — GET `/api/v1/analytics/funnel?period&steps`: distinct user per step + konversi antar-step NULLIF-safe; default steps signup_completed→onboarding_completed→message_sent→session_finalized; `steps` divalidasi terhadap catalog.
- [x] **SQL** (`schema/analytics-queries.sql`) — per-step counts + conversion pct (Grafana macro + standalone), NULLIF-safe.

### FASE 3 — Retention & Cohort
- [x] **Backend** — GET `/api/v1/analytics/activity` → {dau,wau,mau,stickyFactor} (user_events ∪ users.last_active); GET `/api/v1/analytics/retention` → cohort matrix (cohort = bulan `users.created_at`, window periodStart−5 bulan, retensi per umur bulan, NULLIF-safe). Fix: `cohortsStart` tidak terpakai (hanya cohort bulan berjalan) → dipakai; `age/size/active` di-`Number()` (pg mengembalikan string).
- [x] **SQL** — DAU/WAU/MAU date_trunc, cohort retention CTE, sticky factor — semua `::numeric` + NULLIF.
- [x] **Seed rework** (`scripts/seed-monetization.ts`) — hapus `seed-%@example.com` (CASCADE); `users.created_at` di-backdate per bulan join (JOIN_WEIGHTS); emit telemetry aktivasi (signup→onboarding→message→finalized dengan drop-off per tahap) + aktivitas bulanan per cohort (RETENTION_CURVE decay).
- [x] **Grafana** — dashboard `infra/grafana/analytics-dashboard.json` (uid `analytics`, 5 panel: activation funnel bargauge, conversion stat, DAU/WAU/MAU timeseries, sticky factor stat, cohort retention table) + `grafana-provision.sh` diparametrize (loop import SEMUA `infra/grafana/*.json`). **Sukses live** https://imanino.grafana.net/d/analytics/cac9c6c.
- [x] **Fix quirk CockroachDB v26.2.5** — `COUNT(DISTINCT user_id) FILTER (WHERE event_name=…)` + range timestamptz + multi-aggregat mengembalikan jumlah kecil yang salah (4|4|2|5) → diganti `COUNT(DISTINCT CASE WHEN event_name='X' THEN user_id END)` → benar (40|31|30|19). Catatan di `analytics-queries.sql`. `getFunnel` lib pakai WHERE-style jadi tidak terdampak.

### Verifikasi live
- [x] **Tests** — lambda `npm test` 56/56 ✓ (eventCatalog 9, analytics 12, monetization 13, telemetry 9, contract 8, logger 5), `npx tsc --noEmit` ✓, frontend `npm run typecheck` + `vite build` ✓.
- [x] **Seed live** — users 40 (cohorts 03:2/04:4/05:12/06:9/07:5/08:13), subscriptions 40, user_events 385 (page_view 129, signup 40, onboarding 31, message 30, finalized 19).
- [x] **Deploy live** — `terraform apply` (source_code_hash, version 11) → Lambda dengan 3 route analytics baru. Curl live: funnel?period=2026-06 → {signup 9, onboarding 6, message 7, finalized 3}; activity → {dau 2, wau 13, mau 24, sticky 0.08}; retention → matrix cohort 03/04/05/06, ages 0-3, decay 100→50 / 100→91.67.
- [x] **Grafana E2E** — POST /api/ds/query funnel (CASE WHEN) → 40|31|30|19 via proxy Grafana, cocok dengan psql.
- [x] **Commits** — `6b71b63` feat(telemetry), `e1c8049` feat(analytics), `7c72b8f` feat(analytics), `a958303` docs(analytics). Working tree bersih.
- [ ] **Masih terbuka** — endpoint analytics = agregat lintas-user (wajar untuk app single-user/demo; hardening rate-limit/auth-admin dicatat di ADR-003); sumber aktivitas `users.last_active` hanya ter-update oleh seed — perlu update berkala di produksi.

## Vector Indexing — Writer Embeddings + Semantic Search Aktif (2026-08-15)

Riset CockroachDB Distributed Vector Indexing (C-SPANN) → implementasi **Opsi A** (writer embeddings + semantic endpoint aktif). Riset lengkap di `docs/15-8-26/RESEARCH-VECTOR-INDEXING.md` (Define+Plan). **✅ DEPLOYED + VERIFIED live.**

- [x] **Riset** — VECTOR(N) type, operator cosine `<=>`, index C-SPANN (bukan HNSW; `USING hnsw` = alias), opclass `vector_l2_ops` (default)/`vector_cosine_ops`/`vector_ip_ops`, RaBitQ quantization + rerank, prefix columns per-tenant, GA sejak v25.4 (cosine accelerated, online backfill), quirk: batch insert dihindari, `IMPORT INTO` tidak didukung pada tabel ber-vector index, backfill tabel non-empty butuh `SET sql_safe_updates=false`.
- [x] **Gap ditemukan** — tabel `embeddings` selalu kosong: tidak ada satu pun `INSERT INTO embeddings` di codebase. `handleUpsertMemory` hanya menulis `memory_nodes`+`memory_edges`; semantic search hidup tapi tak pernah punya data.
- [x] **Vector writer** (`lambda/lib/vectors.ts` + `writeNodeEmbedding` di `memory.ts`) — saat upsert memory: bangun teks `title — excerpt` (slice 8000), `generateEmbedding` (baai/bge-m3 1024-dim), DELETE embedding lama node lalu INSERT baru (`text_source='title+excerpt'`). **Best-effort**: kegagalan embedding dicatat `logger.warn("memory.embedding_failed")`, TIDAK menggagalkan upsert node.
- [x] **Refactor** — `toVectorLiteral` dipindah dari `semanticSearch.ts` ke `lambda/lib/vectors.ts` (satu sumber, dipakai writer + semantic query). `handleUpsertMemory` menerima `llm: OpenRouterClient` (route POST /api/v1/memory di `handler.ts` pass `llm`).
- [x] **Index cosine** — `crdb-schema.sql` vector index diganti opclass `vector_cosine_ops` (cocok query `<=>`). Migration idempotent `schema/migration-2026-08-15-vector-cosine.sql` (drop+recreate) **diterapkan live** di cluster woozy-grivet v26.2.5. Konfirmasi live: `embeddings_vector_idx` = `USING cspann (embedding vector_cosine_ops)`.
- [x] **Tests** — `lambda/tests/memory.test.ts` baru (7 tes): upsert sukses menulis embeddings, best-effort saat embedding gagal (node tetap 200), delete-lalu-insert, matcher string literal vector, dll. Lambda `npm test` **63/63 ✓**, `npx tsc --noEmit` ✓, frontend typecheck ✓.
- [x] **Deploy live** — `terraform apply` sukses (source_code_hash). E2E curl: upsert 2 node (crisis-noise + sleep-hygiene) → keduanya 200; `embeddings` 2 baris/2 node di DB; semantic "client anxious about loud noise" → node-1 0.78 > node-2 0.52 (relevan ✓); "how to fall asleep faster at night" → node-2 0.64 > node-1 0.36 (relevan ✓).
- [x] **UI hint diperbarui** — `MemoryPage.tsx` tidak lagi bilang "embeddings may be empty server-side".
- [x] **FIX full scan → vector search (10k rows)** — root cause query lama: filter `embedding IS NOT NULL` + bentuk JOIN langsung memaksa full scan (20.006 KV rows, 247–335ms). Query chat diubah ke derived-table subquery (`ORDER BY e.embedding <=> $1::vector LIMIT 16` di subquery, lookup `memory_nodes` + filter verified/confidence di luar) → EXPLAIN ANALYZE live memilih **`vector search`** (prefix span user, ~90 KV rows, p50≈96ms; beam 64/128 tidak mengubah plan). Detail eksperimen + fix di `docs/15-8-26/FIX-VECTOR-SEARCH-FULL-SCAN.md`. Test suite 86/86 ✓, tsc ✓, frontend typecheck ✓.
- [x] **Semantic search (endpoint `/memory/semantic`) ikut derived-table** — root cause sama (JOIN + `embedding IS NOT NULL` → full scan); refactor ke derived-table subquery (prefix `user_id`, LIMIT candidate min(max(limit*4,16),80), filter verified/confidence di luar) → EXPLAIN ANALYZE live: operator `vector search`, ~89 KV rows, 65ms. Commit `6a2b43b`.

## Utilisasi Vector Indexing — Evaluasi Klaim + Hybrid Keyword + Observability (2026-08-16)

Evaluasi klaim marketing CockroachDB Distributed Vector Indexing terhadap utilisasi nyata di proyek, lalu menutup 3 gap terpilih. **✅ VERIFIED live** (CRDB `woozy-grivet` v26.2.5, Lambda ap-southeast-3, Grafana Cloud `imanino`).

- [x] **Evaluasi utilisasi** — klaim "store/query embeddings at scale, retrieval stay fast as data grows, no separate vector store, no reindexing pain, no consistency gaps, ideal RAG/long-term memory/semantic search" sebagian besar sudah terpenuhi (C-SPANN prefix index, semantic derived-table, hybrid RRF, writer+chunking, backfill idempotent, span observability). Gap: (1) tak ada Grafana panel coverage vector, (2) tak ada health-check/alert otomatis, (3) hybrid masih heuristic+vector (bukan keyword+vector seperti rekomendasi docs). User memilih menutup **3 gap** (coverage dashboard, health-check, hybrid keyword+vector); cleanup data loadtest tidak diambil.
- [x] **Hybrid keyword+vector retrieval** — `getMemoryContext` kini fuse **3 set** via RRF (k=60, top 8): heuristik + keyword full-text + vector. Keyword leg: `to_tsvector('english', title || excerpt) @@ plainto_tsquery('english', $n)`, ORDER BY ts_rank, LIMIT 8, verified/confidence, equality user_id. Span baru `memory.keyword_ms`. Commit `30083a1`.
- [x] **Constraint CRDB ditemukan (live)** — (1) computed column **STORED** menolak ekspresi context-dependent (`array_to_string(tags)` dan `tags::string` cast → error), sehingga full-text memakai **expression INVERTED INDEX** `memory_nodes_search_idx ON memory_nodes (user_id, to_tsvector('english', title || ' ' || COALESCE(excerpt, '')))` (GIN, prefix user_id); `tags` dikecualikan. (2) `plainto_tsquery` **tidak di-constant-fold** oleh planner → EXPLAIN plan-standalone dengan literal tsquery tampak full scan; namun **custom plan** (PREPARE+EXECUTE / param string node-postgres) memakai index + operator `inverted filter` (terbukti live: kata langka "node 9999" → 1 row decoded). Migration idempotent `schema/migration-2026-08-15-vector-keyword.sql` **diterapkan live**.
- [x] **Health-check otomatis** — `scripts/vector-health-check.ts` (npx tsx): coverage embedding per user **nyata** (exclude user loadtest md5('loadtest-vectors')), index full-text `memory_nodes_search_idx` ada, EXPLAIN ANALYZE query vector chat berisi operator `vector search`; exit 1 saat regresi; `--min-coverage 95` default, `--json` mode. `.github/workflows/vector-health.yml` (cron 06:00 UTC + workflow_dispatch, `CRDB_CONNECTION_URL` dari secrets). **Live OK**: coverage b5fc3dbb… 3/3 = 100%, fulltext index true, vector search YES.
- [x] **Grafana dashboard vector** — `infra/grafana/vector-dashboard.json` (uid `vector-indexing`, 5 panel): coverage per user, distribusi text_source (chunking), node tanpa embedding (kandidat backfill), total embedding per user, penanda eksistensi `embeddings_vector_idx`. Auto-import oleh `grafana-provision.sh` (loop `infra/grafana/*.json`).
- [x] **Docs diperbarui** — FASE-VECTOR-INDEXING-SPEC.md (capability C8 + acceptance criteria), ADR-004-vector-hybrid-retrieval.md (amendment keputusan 10–14: keyword leg, expression index, temuan custom-plan, health-check, dashboard), USAGE-FRONTEND-BACKEND.md (getMemoryContext 3-set, `keywordMs`, span).
- [x] **Verifikasi** — lambda `npm test` 86/86 ✓, `npx tsc --noEmit` ✓, frontend `npm run typecheck` ✓, health-check live OK. Commits `30083a1` (feat hybrid keyword+vector) + `bbfe50e` (feat health check + dashboard). Working tree bersih.

## Hackathon Final Push — 4/4 CockroachDB Tools + Agentic Memory Loop (2026-08-16)

Penyelesaian requirement submission CockroachDB × AWS Agent Challenge: gunakan ≥2 dari 4 tool CRDB + ≥1 AWS service. **Semua VERIFIED live** (CRDB `woozy-grivet` v26.2.5, Lambda `cbt-memory-agent` ap-southeast-3, EventBridge, Grafana Cloud `imanino`).

- [x] **WS-A: Managed MCP read-only AKTIF (tool #1)** — endpoint `https://cockroachlabs.cloud/mcp` + header `mcp-cluster-id` + `Authorization: Bearer $CCLOUD_MCP_API_KEY`. **9 tool diverifikasi live** (bukti di `docs/15-8-26/mcp-proof/`): `list_databases` (defaultdb), `list_tables` (12 tabel; memory_nodes 10.003, embeddings 10.003), `get_table_schema` embeddings (VECTOR INDEX `embeddings_vector_idx`), `explain_query` keyword (pakai `memory_nodes_search_idx`, 1 span), `explain_query` vector (guardrail nyata: "different vector dimensions 4 and 1024"), `select_query` COUNT=10003, `get_cluster` (v26.2.5 AWS BASIC ap-southeast-3). Konfigurasi: `mcp/mcp-config.json` + `.mcp.json` (Claude Code/editor). `.env.example` + `CCLOUD_MCP_API_KEY`. Write tools sengaja TIDAK diaktifkan. `docs/MCP-STATUS.md` di-rewrite (checklist submission 4/4 Done).
- [x] **WS-B: Agent Skills Repo di-vendor (tool #4)** — `skills/cockroachdb-skills/` = klon statis commit `e14e86d23ce8` (Apache 2.0; `.git`/`.github` dihapus; LICENSE + VENDORED.md + docs + scripts dipertahankan). **34 skills, 10 domain**; `validate-spec.py` 0 error. Keputusan user: "tidak perlu di integrasikan ke agent ya" → murni aset pengetahuan tooling, tidak dipakai runtime.
- [x] **WS-C: ccloud CLI diperkuat (tool #3)** — `scripts/ccloud-audit.sh`: pola agent-ready `ccloud -o json` + jq; mode default/`--quiet` (exit code, CI)/`--json`; **6/6 check PASS live** (state, version v26.2.5, region, spend limit $0, SQL SELECT 1, MCP tools/list probe). Dijadikan **health gate CI** di `.github/workflows/deploy.yml` (sebelum build zip). Fix: script tidak `source .env` (OTEL header ber-spasi bikin error bash).
- [x] **WS-D: Agentic memory loop** — memori bikin agent makin pintar antar sesi:
  - **D1 recall eksplisit** — `getMemoryContext` (chatTurn.ts) mengembalikan `recalledTitles`; span `agent.memory.retrieve` atribut `memory.recalled_titles`; SSE menambah meta event `{t:'', injectedMemoryIds:[...]}` sebelum `[DONE]` (frontend aman: parser hanya render `json.t` non-empty).
  - **D2 vectorWriter diekstrak** — `lambda/lib/vectorWriter.ts` (`writeNodeEmbedding`) dipakai memory + reflection; `OpenRouterClient.chat()` non-streaming baru.
  - **D3 reflection lib + handler** — `lambda/lib/reflection.ts`: ambil user aktif 7 hari (DISTINCT chat_turns), max 20 turn/user, LLM ekstrak **max 8 durable facts** (JSON best-effort, no PII, no fabrication), upsert `memory_nodes` kind=core verified=true confidence≥0.8 weight=0.8, **id deterministic** `md5(userId||'::'||title)::uuid` (ref_count+1 on conflict), embedding ulang, audit `REFLECTION_RAN`. `lambda/handlers/reflect.ts` + deteksi event scheduled di `handler.ts`.
  - **D4 EventBridge Terraform** — module `infra/modules/eventbridge/`: rule `cbt-memory-agent-reflect` schedule `rate(6 hours)`, target Lambda `{source:agent.memory, detail-type:reflect}`, permission events.amazonaws.com. **Terapkan live**.
  - **D5 surfacing otomatis** — fact reflection (verified, conf≥0.8) lolos filter retrieval (verified AND conf≥0.6) → muncul di RRF turn berikutnya tanpa kode tambahan.
  - **D6 12 test** `lambda/tests/reflection.test.ts`. Full suite **99/99 ✓**.
  - **Debug live terselesaikan**: migration CRDB (no dynamic `EXECUTE` → `DROP CONSTRAINT IF EXISTS` idempotent); `make_interval` → `now() - INTERVAL '1 day' * $1::int` (CRDB tak punya make_interval); timeout Lambda 29→300s (3 tempat); param ke-9 upsert (weight). **Reflection diinvoke live**: `{"v":1,"ok":true,"userFacts":3,"errors":0,"skipped":0}` → 3 node core + 3 embeddings + 3 audit REFLECTION_RAN; idempoten (run kedua 0 fact, tanpa duplikat).
- [x] **WS-E: Submission artifacts** — README di-rewrite (matrix 4/4 tool + AWS + checklist + URL live + API status semua ✅ + struktur monorepo terkini); `docs/ARCHITECTURE.md` (diagram mermaid: overview + chat loop + reflection + security + tooling map); `docs/DEMO-SCRIPT.md` (script video ≤3 menit, shot list, tips); LICENSE MIT sudah ada.
- [x] **Verifikasi akhir** — lambda `npm test` 99/99 ✓, `npx tsc --noEmit` ✓ (lambda + frontend `npm run typecheck` ✓), `scripts/vector-health-check.ts` live OK (3 user 100% coverage, fulltext index true, EXPLAIN vector search YES), `scripts/ccloud-audit.sh --quiet` OK (6/6). Backend live: `GET /api/v1/health` → `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}`.
- [x] **Docs** — ADR-005 (agentic memory loop), ADR-006 (MCP read-only + vendor skills), `docs/COCKROACHDB-AGENT-READY.md` (riset 3 offering + gap analysis), `docs/MCP-STATUS.md` di-rewrite. **Sisa**: rekam video demo ≤3 menit (script siap) + isi link ke README.

## Reflection Loop Upgrade — MCP Read-Only Step + Cluster Health Gate + Agent Skills (2026-08-16)

Penguatan agentic memory loop: anteseden akurat via MCP read-only, health gate cluster, dan konteks skill CockroachDB di prompt LLM. **Semua VERIFIED** (test suite 122/122). Commit `5f067f1`. Rencana & keputusan di `docs/15-8-26/PLAN-MCP-REFLECTION-STEP.md` + `docs/15-8-26/PLAN-CLUSTER-HEALTH-SKILLS.md` (workflow ADDY-OSMANI-SKILLS.md).

- [x] **MCP step 1.5 (reflection anteseden read-only)** — `lambda/lib/mcp.ts` (BARU): client fetch-based minimal tanpa dependency (Node 22 global fetch + SSE parse), `select_query` read-only pada Managed MCP CockroachDB Cloud (endpoint `https://cockroachlabs.cloud/mcp`, `mcp-cluster-id` header, Bearer `CCLOUD_MCP_API_KEY ?? CCLOUD_API_KEY`), ambil **max 25 fact core terverifikasi** user sebagai konteks prompt sebelum LLM distillation. Timeout `MCP_FETCH_TIMEOUT_MS` (default 5000ms) via `AbortController`+`setTimeout` (bukan `AbortSignal.timeout` — vitest tidak bisa fake timer-nya). Gagal/timeout → `EMPTY_MCP_CONTEXT` + log `reflection.mcp_failed`; **tidak pernah throw**. Semua write tetap via `pg.Pool` (MCP read-only).
- [x] **Wiring reflection** — `reflection.ts`: `existingFactsProvider` opt di `reflectUser` (default `fetchExistingCoreFacts`); blok `Already-known durable facts DO NOT re-extract...` disisipkan ke **user prompt saja** (system prompt tidak berubah); audit `REFLECTION_RAN` detail kini `{factTitle, mcp_context_used, mcp_facts_count}`; `MCP_MAX_FACTS=25`; test hermetik (vi.mock + fake timers). Docs: `.env.example` MCP vars, `docs/MCP-STATUS.md` §2 rewritten.
- [x] **Addition A — cluster health gate** — `lambda/lib/clusterHealth.ts` (BARU): hybrid `ccloud cluster list -o json` (filter `.id` == `CRDB_CLUSTER_ID`) → fallback REST `GET /api/v1/clusters/<id>` Bearer `CCLOUD_API_KEY`. Status sehat = `CREATED`/`UNSPECIFIED`; nodeCount = sum `regions[].node_count`. Cluster terdegradasi → **seluruh run dibatalkan** (`{userFacts:0, errors:0, skipped:0}`). **Semua failure tooling → `{healthy:true, skipped:true}`** (loop lanjut, tidak pernah throw). Timeout `CCLOUD_HEALTH_TIMEOUT_MS` (default 10000ms) untuk execFile + REST (AbortController).
- [x] **Audit CLUSTER_HEALTH_CHECK** — migration `schema/migration-2026-08-16-cluster-health-audit.sql` (idempotent, `DROP CONSTRAINT IF EXISTS` + ADD CHECK, `user_id DROP NOT NULL`); `schema/crdb-schema.sql` sinkron (12 type di CHECK, user_id nullable). Detail audit `{status, nodeCount, healthy, reason}`; insert dibungkus try/catch sendiri (`reflection.cluster_health_audit_failed`).
- [x] **Addition B — agent skills injection** — `lambda/lib/agentSkills.ts` (BARU): baca 2 SKILL.md di-vendor (`cockroachdb-sql`, `profiling-statement-fingerprints`), truncate @500 chars, gabung blok `--- CockroachDB Agent Skills Context ---` disisipkan ke user prompt sebelum `Output JSON array of durable facts:`. Resolusi path dev (`__dirname/../../skills/...`) + bundled (`/var/task`, Lambda zip). File hilang → dilewati; semua hilang → `{content:"", names:[]}`. Audit detail kini `{factTitle, mcp_context_used, mcp_facts_count, skills_used, skills_injected}`.
- [x] **Infra & build** — `infra/modules/lambda/main.tf`: `data aws_ssm_parameter crdb_cluster_id` (`/${var.environment}/crdb/cluster-id`, SSM sudah ada + IAM sudah grant) + env `CRDB_CLUSTER_ID`. `scripts/build-lambda.sh`: salin 2 SKILL.md ke `dist/skills/...` + zip `index.js skills`. Tanpa dependency npm baru (child_process/fs/path = built-in).
- [x] **Tests** — `lambda/tests/mcp.test.ts` (7, incl. fake-timer timeout), `clusterHealth.test.ts` (5: healthy via ccloud, REST fallback, degraded, skipped, cluster-id kosong — mock child_process + stub fetch), `agentSkills.test.ts` (3), `reflection.test.ts` ditambah (skills block di user prompt, audit skills_used/injected, gate unhealthy → run skipped tanpa query/LLM, skipped:true → loop lanjut). Full suite **122/122 ✓**, `npx tsc --noEmit` ✓ (lambda), `npm run typecheck:test` (sisa hanya error implicit-any pra-eksisting memory.test.ts + reflection.test.ts yang tidak disentuh).
- [x] **Docs** — `docs/15-8-26/PLAN-MCP-REFLECTION-STEP.md` + `docs/15-8-26/PLAN-CLUSTER-HEALTH-SKILLS.md` (Define→Plan→Build→Verify→Review→Ship, hasil verifikasi tertera), `docs/MCP-STATUS.md` §3 (cluster health gate) + §4 (skills injection).
- [x] **Deploy live + verifikasi** — `terraform apply` (IAM `s3:DeleteObject`/`DeleteObjects` + Lambda v18, env `CRDB_CLUSTER_ID`) + migration CRDB live (`cluster-health-audit` + `attachments`). **Live E2E attachment** (token sementara): presign → **S3 PUT 200** → create (node+attachments+embeddings, verified=true) → list → delete (S3 object terhapus + cascade). **Bug ditemukan live**: presigned PUT `SignatureDoesNotMatch` karena SDK v3.800 menandatangani `x-amz-server-side-encryption` (dari `ServerSideEncryption: AES256`) + placeholder CRC32 yang tidak pernah dikirim klien → fix `lambda/lib/s3.ts` (commit `68a6dcb`): drop SSE header (bucket sudah AES256 at-rest) + `requestChecksumCalculation: "WHEN_REQUIRED"`. **Reflection live**: invoke direct dengan event `{source:"agent.memory","detail-type":"reflect"}` → log `reflection.cluster_health` (`status UNSPECIFIED, healthy:true`, REST fallback) + `reflection.mcp_query` (5 facts, 1 fact, 0 facts) + `reflection.completed` (`userFacts:0, errors:0, skipped:0`) + audit `CLUSTER_HEALTH_CHECK` (user_id NULL). Full suite lambda **136/136 ✓** setelah fix.

## Emotional Media Attachments — On-Device Analysis → Vector Indexing + S3 (2026-08-16)

Media emosional (gambar/video/audio) di-analysis **on-device**, lalu di-index ke CockroachDB sebagai memory node `kind='attachment'` (di-embed dari narrative deterministik) + **raw media di S3**. **Semua VERIFIED** (lambda 136/136 ✓, frontend 25/25 ✓, build bersih). Commits: `143faa5` (backend+schema), `a33a7b7` (on-device analysis), `9155b37` (UI wiring), `8d7592b` (review fixes). Rencana & keputusan: `docs/15-8-26/PLAN-EMOTIONAL-ATTACHMENTS.md` + `docs/15-8-26/ADR-007-emotional-media-attachments.md`.

- [x] **Skema & migration** — `schema/migration-2026-08-16-attachments.sql`: `memory_nodes.kind` CHECK diperluas `('core','transcript','attachment')`; tabel `attachments` baru (analysis JSONB, embedded_narrative, s3_key, FK `memory_node_id → memory_nodes(id) ON DELETE CASCADE` — pola embeddings, purge/delete otomatis). `schema/crdb-schema.sql` sinkron untuk fresh install.
- [x] **API attachments** — `lambda/handlers/attachments.ts` (BARU): `POST /attachments/presign` (key `media/{userId}/{uuid}.{ext}`, ext divalidasi `[a-zA-Z0-9]{1,8}`, presigned PUT 900s) → `POST /attachments` (validasi kind/narrative/title + `s3Key.startsWith(prefix)` anti traversal; INSERT node kind=attachment verified=true + attachments + `writeNodeEmbedding` dari narrative penuh) → `GET /attachments` (join node) → `DELETE /attachments/:id` (match `memory_node_id`, delete S3 object best-effort + node cascade). Semua failure → 500, tidak pernah throw. Routing di `handler.ts`; `handlePurge` kini menerima `s3` + `s3.deleteMediaPrefix(userId)`.
- [x] **S3 & IAM** — `lambda/lib/s3.ts`: `presignMediaUpload`, `deleteMediaObject`, `deleteMediaPrefix` (ListObjectsV2+DeleteObjects batch) — semua dibungkus `traced()` (span `aws.s3.operation` + RED metric). `infra/modules/iam/main.tf`: tambah `s3:DeleteObject` + statement `s3:DeleteObjects`.
- [x] **On-device analysis (frontend)** — vitest di-root (baru): `emotionMapping.ts` (static valence/arousal per ekspresi + prosody/text heuristik EN/ID), `prosody.ts` (DSP: RMS/frame, pitch autocorrelation — fundamental = lag pertama ≥85% puncak korelasi, pause ratio, wpm), `prosody.worker.ts`, `attachmentAnalysis.ts` (pure: image snapshot, video timeline — dominant=sum confidence, volatility=stddev arousal, arcSummary template; audio fused text 0.5·prosody 0.3·face 0.2), `faceClient.analyzeFrame()` one-shot (worker dedikasi, model hangat, copy buffer), `face.worker.ts` mode `analyze` (warm model → MediaPipe → fallback; rejection → fallbackSignal, tidak pernah hang), `attachmentIndex.ts` (presign→PUT→create; throw → toast).
- [x] **UI wiring** — CameraPip "Analyze & save" (snapshot → ekspresi → narrative → index, Check saat sukses); VideoRecorderPip baru (hold-to-record MediaRecorder video+audio → frame sampling `max(5s, duration/12)` → timeline → arc/volatility → index, di Composer); HoldToTalkOrb → `indexVoiceNote` best-effort (prosody → fused emotion); Composer accept `image/*,video/*,audio/*` (image preview); ChatBubble ikon video/audio; `MemoryKind='attachment'` di memory types/store + GraphNodeCard (icon Image, label "Attachment") + NodeInspector + MemoryPage count.
- [x] **Privacy copy** — AuthPage lede, MediaDock badge, chat welcome seed: "raw media stays in-browser; only the clinical summary syncs" (janji jujur pasca S3).
- [x] **Tests** — `lambda/tests/attachments.test.ts` (14: presign key/kind, create validasi + embedding dari narrative, traversal 400, list join, delete S3+node, delete-by-nodeId regression, 404) → lambda **136/136 ✓**, `tsc --noEmit` ✓, `typecheck:test` bersih (sisa hanya pra-eksisting). Frontend `attachmentAnalysis.test.ts` (25: mapping, narrative, timeline arc/volatility, fused emotion, prosody DSP sine/silence, formatDuration) → **25/25 ✓**, `npm run build` (tsc -b && vite build) ✓.
- [x] **Review & docs** — code-review 5-axis → fix delete-by-nodeId (sebelumnya `attachments.id` tidak pernah cocok dengan id yang dikembalikan create → selalu 404), validasi ext presign, harden analyze worker.
- [x] **Deploy live + verifikasi** — migration CRDB live (`attachments` table + `kind CHECK ('core','transcript','attachment')` terverifikasi di cluster), `terraform apply` (Lambda v19, IAM S3 delete), **live E2E** presign→PUT 200→create→list→delete (S3 + cascade), fix presigned PUT signature (commit `68a6dcb`), reflection gate live (`CLUSTER_HEALTH_CHECK` audit row).
- [x] **Runbook manual tester** — `docs/MANUAL-RUNBOOK.md`: langkah curl live (health, auth, presign→PUT→create→list→delete), recall semantic + hybrid RRF via chat turn, invoke reflection langsung, query audit CRDB, checklist 12 item. Pengujian UI/frontend live & recall attachment kini **handoff ke human tester** mengikuti runbook ini.

## Frontend-Backend Integration Audit + 11 Gap Fixes (2026-08-16)

Audit integrasi frontend-backend 100 item (`docs/FRONTEND-INTEGRATION-AUDIT.md`, coverage awal 70%) → **semua 11 gap prioritas diperbaiki** (5 DEMO-BLOCKER + 6 HIGH) via workflow `docs/15-8-26/ADDY-OSMANI-SKILLS.md` (tiap item: define→plan→build→verify→review→ship). Coverage naik ke **86%**. **Semua VERIFIED** (frontend 74 tes/11 file ✓, typecheck ✓, build ✓; lambda 139 tes/16 file ✓).

- [x] **DB1 — SSE `injectedMemoryIds` dikonsumsi** (`158cc2a`): `parseBackendProxySSE` + `apiClient.chatTurn` parse ID → `recalledMemoryIds` → chatStore `recordBackendRecall` → chip "Recalled N memories" di ChatBubble.
- [x] **DB2 — `recalledTitles` disurface** (`96e8cee`): backend final SSE event kini mengirim `recalledTitles`; parser baca → `recordBackendRecallTitles` → chip judul teal (link `/memory`).
- [x] **DB3 — Chat hydrate dari backend** (`c21208c`): `seedMessages` dihapus; chat di-hydrate dari `apiClient.listSessionTurns` → `turnsToMessages` (membawa `recalledMemoryIds`); active session id dipersist ke localStorage `cbt-memory-agent-active-session`; empty-state fail-closed di ChatStream.
- [x] **DB4 — Analytics UI** (`2576749`): `AnalyticsSection` di MetricsPage (funnel/activity/retention) via `Promise.allSettled` + helper pure `analyticsFormat.ts`; 3 method apiClient baru.
- [x] **DB5 — Attachment gallery** (`64f155d`): `AttachmentGallery` di MemoryPage (toggle Graph/Media); delete → `deleteAttachment` + toast + `void hydrate()`.
- [x] **HIGH1 — AbortController stream** (`57c7b79`): `isAbortError` rethrow sebelum provider-fallback; `activeAbort` module-level di-abort `triggerBargeIn`/`hardHalt`; signal menembus semua provider + loop SSE + generasi on-device.
- [x] **HIGH2 — Passkey `credentials.get`** (`d8737e3`): `authenticatePasskey()` (allowCredentials dari registry localStorage `cbt-passkey-registry`, timeout 45s) → restore profileId; tombol ghost "Sign in with existing passkey".
- [x] **HIGH3 — 401 + session expiry** (`1ea2a76`): `setUnauthorizedHandler`/`notifyUnauthorized` di apiClient → `signOut()` (kecuali anonymous); SessionGate cek `isSessionExpired(sessionExpiresAt)` (TTL 30 hari di-set tiap auth sukses, dicek sekali per mount).
- [x] **HIGH4 — Crisis events → server** (`43c95a2`): backend `writeCrisisAudit` derive `CRISIS_ENGAGED`/`CRISIS_DISMISSED` di `audit_events` dari `/events` `crisis_triggered`/`crisis_resolved` (best-effort, tidak pernah throw) → metrik `crisisEvents` kini real.
- [x] **HIGH5 — Core Web Vitals** (`1775f6c`): `webVitals.ts` custom (CLS/LCP/INP/FCP/TTFB via PerformanceObserver, threshold web.dev) → span OTel `web-vitals.<name>`, gated `VITE_OTEL_ENABLED==="true"`; `initWebVitals()` di main.tsx.
- [x] **HIGH6 — 429 handling** (`76328ed`): `RateLimitError` bertipe dengan `retryAfterMs` dari header `Retry-After` (detik atau HTTP-date); chatStore tampilkan copy rate-limit ramah.
- [x] **Docs** — `docs/FRONTEND-INTEGRATION-AUDIT.md` diperbarui (status tiap gap, coverage 86%, commit per item); `docs/MANUAL-RUNBOOK.md` + checklist UI **U1–U11** untuk human tester (fitur pasca-audit: chip recall, chat hydrate, galeri, analytics, passkey, session expiry, abort, 429, crisis audit, web vitals).
- [x] **Sisa gap (dokumentasi)** — monetization UI, server audit viewer, hard-purge leak, logout reset state, token refresh, session rename, compare real-turns, "active sessions" real, retention setting, streaming un-buffer, per-call error tracking (daftar lengkap + status di audit doc).

## Deploy & CI — Frontend S3+CloudFront, OIDC GitHub Actions, Phase C Magic-Link Live, Cleanup us-east-1 (2026-08-16)

Penuntasan work package Deploy/CI dari WORK-LIST 3.6 + Phase C deployment + production frontend. **Semua VERIFIED live** (ap-southeast-3, akun 926375049642). Menggunakan workflow `docs/15-8-26/ADDY-OSMANI-SKILLS.md` (Define→Plan→Build→Verify→Review→Ship).

- [x] **Frontend hosting — S3 + CloudFront (bukan docker/nginx)** — `infra/modules/frontend/` (baru): S3 bucket `cbt-memory-agent-frontend` (private, versioning, AES256) + CloudFront OAC (S3 origin) + custom origin ke Lambda Function URL untuk `/api/v1/*` (CachingDisabled `4135ea2d…`, AllViewerExceptHostHeader `b689b0a8…`, https-only) + **response headers policy** replicating nginx (CSP, X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy, X-XSS-Protection) + SPA fallback (403/404 → index.html). **Live:** `https://d2sbinyjz34sz4.cloudfront.net` (dist `EWWRSYJJMZAO9`), `/api/v1/health` via CF → 200, security headers diverifikasi via curl, hashed asset `immutable` 1y, `index.html` no-cache.
- [x] **CORS Lambda terkunci** — `infra/modules/lambda/main.tf`: `allow_origins = [var.allowed_origin]` (bukan `*`); live = `[https://d2sbinyjz34sz4.cloudfront.net]`, preflight OK.
- [x] **Deploy script** — `scripts/deploy-frontend.sh`: build → `aws s3 sync` (immutable) + `index.html` no-cache → auto-detect dist ID → `create-invalidation "/*"`.
- [x] **CI → OIDC** — `infra/modules/oidc/` (baru): OIDC provider `token.actions.githubusercontent.com` (thumbprint `6938fd4d…`) + role `cbt-github-actions-deploy` trust `repo:noiz354/cbt-memory-agent:ref:refs/heads/main` dengan **least-privilege inline policy** (state S3, lock DDB, SSM `/hackathon/*`, Lambda+url, logs, S3 exports+frontend, CloudFront, IAM PassRole). `deploy.yml` rewrite: static AWS keys **dihapus** → `configure-aws-credentials@v4` `role-to-assume ${{ secrets.AWS_DEPLOY_ROLE_ARN }}` (id-token: write); TF_VAR lengkap (`resend_api_key`, `email_from`, `app_url`, `grafana_otlp_endpoint`, `grafana_otlp_headers` ditambah); step deploy frontend; health check backend + frontend; paths diperluas (`src/**`, `scripts/**`, `deploy.yml`).
- [x] **GitHub repo + secrets** — repo **public** `noiz354/cbt-memory-agent` (dibuat via `gh repo create`; history dibersihkan dari blob 1.09GB `reverse-prompt-aws-cockroachdb.md` via `git filter-repo`, di-gitignore, KEPT local). 14 secrets: `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `APP_URL`, `ALLOWED_ORIGIN`, `API_URL`, `EMAIL_FROM`, `CRDB_CONNECTION_URL`, `CRDB_CLUSTER_ID`, `CRDB_CLUSTER_NAME`, `CCLOUD_API_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_OTLP_HEADERS` (dari `.env`, tanpa AWS keys).
- [x] **Phase C magic-link live** — schema `auth_tokens` + `users.session_token` sudah di-apply; `POST /api/v1/auth/magic-link` `{email:noiz354@gmail.com}` → `{ok:true,sent:true}` (Resend free tier hanya kirim ke email owner akun); `POST /auth/callback` E2E verified (token single-use, `used_at` ter-set, replay → "Link is not valid", `users.session_token` + `display_name` ter-update, `GET /sessions` 200). `app_url`/`allowed_origin` di tfvars = domain CloudFront.
- [x] **Cleanup us-east-1 orphan** — S3 `cbt-memory-agent-terraform-state` (termasuk semua versi), DynamoDB `cbt-memory-agent-terraform-lock`, Lambda `cbt-memory-agent` + log group, 6 SSM `/hackathon/*` — semua dihapus (region-scoped). **ap-southeast-3 utuh** (state bucket, lock ACTIVE, frontend+CF live). Budgets akun dibiarkan.
- [x] **Verify/Review** — `~/bin/terraform fmt/validate/plan/apply` bersih (0 change ke lambda/budget/eventbridge eksisting); lambda `npm test` 139/139 ✓, `tsc --noEmit` ✓; frontend `npm run typecheck` ✓. Deploy pipeline OIDC divalidasi lewat push + `gh run watch`.
- [x] **CI pipeline 100% hijau** — `Deploy Backend + Frontend` (avg 3m) ALL PASS: Typecheck (λ+FE), Test (λ 139), ccloud audit, Build zip, OIDC creds, TF init/apply, Deploy frontend, Health check (backend) + (frontend via CF). Iterasi OIDC deny-tinggal-action (5x): `s3:GetReplication/Encryption/LifecycleConfiguration`, `logs:ListTagsForResource` (+ Resource log-group di-widen `/aws/lambda/${fn}*`), `lambda` reads pada qualified version ARN (`function:${fn}:*`) — semua ditambah ke `cbt-github-actions-deploy-scoped`. **Budget module DIHAPUS** (`af7b980`) krn provider v6.60 baca `budgets:ViewBudget/ViewBudgets/ListTagsForResource` yg terus men-deny; konfigurasi disimpan di `docs/15-8-26/BUDGET-ALERT-RETIRED.md` (including cara restore). **Gotcha secret**: `API_URL` sempat ber-suffix `/api/v1` → health check CI curl `.../api/v1/api/v1/health` → 401 `{error:"Missing Authorization header"}`; fixed → bare base `https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws`. Health check diberi retry loop (10×15s) utk toleransi cold-start (`90b5e2f`).
- [ ] **Sisa** — Video demo ≤3 menit (script `docs/DEMO-SCRIPT.md`), re-run Lighthouse terhadap prod build CF.
