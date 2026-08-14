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
- [x] Pilih region **us-east-1** (cohere.embed-english-v3 ada di sana; ap-southeast-3 cuma embed-v4)
- [x] `terraform init` + `validate` + `plan` (23 resources) + `apply` — **SUKSES**
- [x] Deployed: Lambda `cbt-memory-agent` (nodejs22.x), Function URL, S3 exports, log group 7-day, budget $1, 5 SSM params, IAM role
- [x] Fix `--external:pg` → pg dibundle dalam zip (217KB) — perbaiki `Cannot find module 'pg'`
- [x] Function URL: `https://armepcglafkj763liezd75etlm0sqals.lambda-url.us-east-1.on.aws/`
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
- [ ] **TODO:** Implement `handleUpsertMemory` (simpan node + embedding) agar semantic search punya data
