# Progress — CBT Memory Agent

> Pipeline v2 migrasi: On-device media → Cloud LLM hanya intisari teks

---

## Phase 0 — Foundation (P0) — Safety + Correctness

- [ ] **P0-1** AudioWorklet menggantikan ScriptProcessorNode
  - [ ] Buat `audio-processor.js` (AudioWorkletProcessor)
  - [ ] Ganti `audioClient.ts`: AudioWorklet → postMessage PCM
  - [ ] Hapus `connect(destination)` — analisis only, no echo
  - [ ] Fallback: AudioWorklet → ScriptProcessor → dummy level

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

- [ ] **P1-1** MediaPipe Face Landmarker
  - [ ] Load model dari IndexedDB (bukan fetch ulang)
  - [ ] 478 landmark + 52 AU intensitas
  - [ ] Interval adaptif: 5Hz aktif, 1Hz idle, 0Hz crisis

- [ ] **P1-2** Whisper.cpp WASM transkripsi
  - [ ] Lazy load model `base` (~140MB) saat first hold-to-talk
  - [ ] EN + ID support
  - [ ] Fallback: Web Speech API → dummy

- [ ] **P1-3** Crisis fusion multimodal
  - [ ] Weighted sum: text(0.5) + prosody(0.3) + face(0.2)
  - [ ] Threshold > 0.7 → hard-halt + overlay

- [ ] **P1-4** Intisari generator rule-based
  - [ ] Extract CBT constructs dari transcript buffer 5 menit
  - [ ] Output JSON: `{themes, hotCognition, moodDelta, cbtPhase}`

---

## Phase 2 — Cloud Integration (P2)

- [ ] **P2-1** Cloud LLM API endpoint
  - [ ] POST /summarize dengan intisari terstruktur
  - [ ] Max 500 token, tanpa PII, tanpa media

- [ ] **P2-2** Idempotency + cache 24h
  - [ ] `Idempotency-Key: {sessionId}`
  - [ ] Fallback on-device jika cloud down/timeout 5s

- [ ] **P2-3** Audit log untuk saran cloud
  - [ ] Log setiap saran yang diterima/ditolak

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
- [ ] **TODO:** Akses publik URL masih 403 (`AccessDeniedException`) walau policy `FunctionURLAllowPublicAccess` benar — request diblokir di service layer (bukan handler); perlu investigasi lanjut
- [ ] **TODO:** Setup GitHub remote + secrets untuk `.github/workflows/deploy.yml` (butuh static AWS keys, CRDB creds, dll)
- [ ] **TODO:** Deploy frontend (docker image + nginx proxy `/api/v1` → backend)

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
- [ ] **Masih terbuka** (untuk lanjutan): real authN/authZ server-side (verifikasi token vs CRDB users), passkey `credentials.get()`, rewrite copy privasi, `GET /turns` read endpoint, set `ALLOWED_ORIGIN` + rate limit + CSP, route-level code splitting, re-run Lighthouse pada prod build, integrasi WebLLM on-device, wiring `startAudioWorker` (Hold-to-talk)

## Phase A + B (2026-08-15) — implementasi WORK-LIST

Semua item Phase A (on-device) + Phase B (no-UI features) dari `docs/15-8-26/WORK-LIST.md` selesai. `npm run typecheck` (frontend) + `npx tsc --noEmit` (lambda/) PASS.

- [x] **1.5 Binaural** — `CalmingAudio.tsx` dua `StereoPannerNode` (L=-1, R=+1), 174/180Hz → beat 6Hz stereo beneran (bukan monophonic)
- [x] **1.6 TTS** — `src/shared/lib/speech.ts` (speechSynthesis: speak/stop/isSpeaking/toggle); tombol **Speak/Stop** di tiap balasan assistant (`ChatBubble`); badge header `TTS ready/unavailable` jujur
- [x] **1.4 Face expression real** — `@mediapipe/tasks-vision` + model `face_landmarker.task` (3.7MB, `public/models/`); worker baru `classifyBlendshapes` (distressed/tense/sad/engaged/neutral), fallback luma hanya jika model gagal load; `FaceSignal.model` label `ML`/`approx`
- [x] **1.7 Waveform playback + truncated** — `WaveformScrubber` pakai `HTMLAudioElement` real (play/pause, scrub seek); `triggerBargeIn` kini set `truncated: true` → tombol "Auto-resume" jadi reachable
- [x] **1.2+1.3 Voice notes** — `@huggingface/transformers` + worker Whisper (`transcribe.worker.ts`, `onnx-community/whisper-tiny`); `voiceNote.ts` merekam mic (MediaRecorder) + wiring `startAudioWorker` (VAD+level); `HoldToTalkOrb` kirim transkrip + blob audio (waveform playable)
- [x] **1.1 WebLLM** — `@mlc-ai/web-llm` + `src/shared/lib/onDeviceLLM.ts` (MLCEngine lazy, Phi-3-mini-4k Q4, streaming via `chat.completions`); `callOnDeviceLLM` kini benar-benar inferensi on-device; gagal → throw (fallback chain tetap jalan)
- [x] **2.1 Semantic memory search UI** — `MemoryPage` debounce 400ms → `apiClient.searchMemory` (GET `/memory/semantic`), hasil chip clickable; fallback substring lokal
- [x] **2.2 Add-memory-node UI** — `memoryStore.addNode` (+ `syncNode` ke backend); tombol "Add memory" di `GraphToolbar`; `AddMemoryModal` dialog baru
- [x] **2.6 Kanban status persist** — `sessionStore.setStatus` kini `apiClient.saveSession` (upsert) → status bertahan di CockroachDB
- [x] **2.7 Memory persist + edge-delete** — `moveNode`/`touch`/`verify`/`updateNode` sync via `syncNode`; `unlink` → `apiClient.deleteMemoryEdge` (endpoint `DELETE /memory/edge/:id` baru di `memory.ts` + routing)
- [x] **2.5 Session detail transcript** — `GET /session/:id/turns` baru (`handlers/turns.ts`) baca `chat_turns`; `SessionDetailPage` render transkrip; tombol continue → `/chat?session=…`
- [x] **2.3 Metrics page + /metrics real** — `handleMetrics` query real (sessions/memory/chat_turns/audit_events per-user); halaman `/metrics` baru + nav "Metrics"
- [x] **2.4 S3 export real** — `handleExport` kumpulkan bundle (sessions/memories/edges/turns/audit) → `s3.uploadExport` (presigned URL); `ExportBuilder` tombol "Upload to S3" wire `uploadExportBundle` (sebelumnya dead code)
- [ ] **Masih terbuka** (Phase C/D): real authN/authZ, passkey `credentials.get()`, rewrite copy privasi, rate limit + server audit, `ALLOWED_ORIGIN` ter-set, CSP + code splitting, re-run Lighthouse prod build
