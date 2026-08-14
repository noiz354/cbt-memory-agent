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
