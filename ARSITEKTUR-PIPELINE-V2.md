# Arsitektur Pipeline Unggul — CBT Memory Agent v2

> On-device camera + audio + transcribe → Cloud LLM hanya menerima intisari teks

**Tanggal:** 2026-08-13  
**Prinsip:** Zero-cloud untuk media mentah. Cloud hanya menerima teks terstruktur yang sudah diekstrak, disaring, dan dianonimkan di perangkat.

---

## Baseline Arsitektur Saat Ini

| Komponen | Status | Masalah |
|---|---|---|
| **Kamera** | `getUserMedia` 320×240 → `<video>` → snapshot JPEG ke composer | Resolusi rendah, tidak ada stabilisasi, tidak ada pipeline gambar on-device |
| **Face worker** | `face.worker.ts` — luma mean dari 64×48 → ekspresi dummy (bukan MediaPipe) | Tidak ada model ML sungguhan; hanya heuristic kecerahan piksel |
| **Audio worker** | `audio.worker.ts` — RMS + peak dari PCM 2048 sample | Hanya level meter; tidak ada transkripsi, tidak ada VAD, tidak ada FFT |
| **Audio client** | `ScriptProcessorNode` (deprecated) → `postMessage` PCM | Bisa bocor ke `destination` (echo), tidak ada AudioWorklet fallback |
| **Transkripsi** | Tidak ada — hold-to-talk hanya simulasi transkrip | User bicara → teks diketik manual atau simulasi |
| **Cloud LLM** | `craftReply()` hardcoded di `chatStore.ts` — bukan LLM sungguhan | Semua respons CBT di-generate lokal dari template statis |
| **Crisis detection** | Regex 6 pola EN+ID di `detectCrisis.ts` | Fail-open pada teks pendek; tanpa konteks prosodi atau ekspresi wajah |
| **Stream** | Token-by-token simulasi 29s timeout | Bukan SSE sungguhan; tidak ada resume dari offset |

---

## Arsitektur Target — Pipeline 3 Lapis

```
┌──────────────────────────────────────────────────────────┐
│                    LAYAR 1: ON-DEVICE                     │
│  (semua media mentah diproses di sini, tidak pernah keluar) │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Camera Pipeline                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ getUserMedia │→│ ImageCapture  │→│  Face Landmarker │  │
│  │ 1080p/30fps  │  │ grabFrame()   │  │  (WASM/TFLite)  │  │
│  └─────────────┘  └──────────────┘  └─────────────────┘  │
│         │                                  │               │
│         ▼                                  ▼               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Stabilization│→│ Expr Analysis │→│  Affect Summary  │  │
│  │ + Auto-crop │  │ 7-class AU    │  │ {trend, peaks}  │  │
│  └─────────────┘  └──────────────┘  └─────────────────┘  │
│                                                           │
│  Audio Pipeline                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ AudioWorklet │→│  VAD (silero) │→│  Whisper.cpp /   │  │
│  │ 48kHz PCM   │  │  voice/silence│  │  WebLLM on-device│  │
│  └─────────────┘  └──────────────┘  └─────────────────┘  │
│         │                                  │               │
│         ▼                                  ▼               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ FFT + Prosody│→│  Noise Suppr. │→│  Transcript Text │  │
│  │ (pitch,energy)│ │ (RNNoise)     │  │  {text, lang,   │  │
│  └─────────────┘  └──────────────┘  │   confidence}    │  │
│                                     └─────────────────┘  │
│                                                           │
│  Crisis Fusion (on-device)                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Text Regex   │ +│ Prosody Spike│ +│ Face Distress   │→ │
│  │ (EN + ID)    │  │ (>threshold) │  │ (>0.7 AU4+AU6+AU9)│ │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│         │                  │                   │           │
│         └──────────────────┴───────────────────┘           │
│                            ▼                               │
│                   ┌──────────────┐                          │
│                   │ Crisis Score │→ fail-closed → overlay   │
│                   │ weighted sum │                          │
│                   └──────────────┘                          │
│                                                           │
│  Intisari Generator (on-device)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Session Buffer│→│ CBT Extractor│→│  Structured Text │  │
│  │ last 5 min    │  │ (rule-based + │  │ {themes,        │  │
│  │ of transcript │  │  micro-LLM)  │  │  cognitions,    │  │
│  │ + affect data │  │              │  │  mood_delta}    │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│                                                           │
└──────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS POST (hanya teks terstruktur)
                            ▼
┌──────────────────────────────────────────────────────────┐
│                    LAYAR 2: CLOUD LLM                     │
│  (hanya menerima intisari teks — tanpa media, tanpa PII)  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Input yang diterima cloud:                               │
│  ```json                                                  │
│  {                                                        │
│    "v": 2,                                                │
│    "sessionId": "ses_abc123",                             │
│    "summary": {                                           │
│      "themes": ["threat-scan", "avoidance"],              │
│      "hotCognition": "If I speak up, I'll be judged",     │
│      "moodStart": 4, "moodEnd": 6,                        │
│      "affectTrend": "tense→neutral",                      │
│      "transcript_excerpt": "...",                         │
│      "cbtPhase": "cognitive_restructuring"                │
│    },                                                     │
│    "consentVersion": "2026.08-cbt-1",                     │
│    "deviceOnly": true                                     │
│  }                                                        │
│  ```                                                      │
│                                                           │
│  Cloud LLM merespons:                                     │
│  ```json                                                  │
│  {                                                        │
│    "v": 2,                                                │
│    "suggestions": [                                       │
│      { "type": "reframe", "text": "..." },                │
│      { "type": "behavioral_experiment", "text": "..." },  │
│      { "type": "thought_record_prompt", "text": "..." }   │
│    ],                                                     │
│    "crisisFlag": false                                    │
│  }                                                        │
│  ```                                                      │
│                                                           │
│  Batasan cloud:                                           │
│  - Tidak pernah menerima gambar, audio, atau video         │
│  - Tidak pernah menerima nama, email, atau credential      │
│  - Tidak pernah menerima raw transcript > 500 token        │
│  - Response di-cache 24h per sessionId (idempotent)        │
│  - Jika cloud down → fallback ke micro-LLM on-device       │
│                                                           │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                    LAYAR 3: CLIENT UI                     │
│  (render saran cloud sebagai opsional, bukan kebenaran)   │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  - Saran cloud muncul sebagai "chip opsional" di rail     │
│  - Terapis (user) bisa terima, modifikasi, atau abaikan   │
│  - Semua saran di-log audit lokal                         │
│  - Jika crisisFlag → cloud response diabaikan, overlay    │
│    on-device mengambil alih                               │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## Detail Pipeline — On-Device

### 1. Kamera — Dari Luma Dummy ke Face Landmarker Sungguhan

**Saat ini:** 64×48 → mean luma → mapping ke ekspresi (5 kelas) via arithmetic sederhana.

**Target:**

| Langkah | Teknologi | Output |
|---|---|---|
| Capture | `ImageCapture.grabFrame()` 1080p → downscaled 256×256 | `ImageBitmap` per 200ms |
| Stabilisasi | Canvas 2-pass: crop stabilizer ( Optical Flow sederhana) | Frame stabil, auto-center wajah |
| Inferensi | `@mediapipe/face-landmarker` (WASM, ~6MB model, cached di IndexedDB) | 478 landmark + 52 AU (Action Unit) intensitas |
| Klasifikasi | Lightweight MLP 2-layer (ONNX Runtime Web, ~200KB) | 7 ekspresi: neutral, happy, sad, angry, fearful, disgusted, surprised |
| Agregasi | Window 3 detik → trend, peak, variance | `{trend: "tense→neutral", peak: "angry@0.8", variance: 0.3}` |

**Optimasi:**
- Model di-load sekali di startup, simpan di IndexedDB (bukan fetch ulang)
- Interval adaptif: 5 Hz saat user aktif, 1 Hz saat idle, 0 Hz saat crisis overlay
- Tidak ada pixel yang keluar dari worker — hanya JSON `{v, type, au, expr, confidence, ts}`

### 2. Audio — Dari RMS Meter ke Transkripsi On-Device

**Saat ini:** `ScriptProcessorNode` → RMS + peak → waveform visual. Tidak ada transkripsi.

**Target:**

| Langkah | Teknologi | Output |
|---|---|---|
| Capture | `AudioWorkletProcessor` (bukan ScriptProcessor) | PCM 16kHz mono |
| Noise Suppression | RNNoise (WASM, ~1MB) | PCM bersih |
| VAD | Silero VAD (ONNX, ~500KB) | Voice/silence segmentation |
| Transkripsi | Whisper.cpp WASM (`base` model ~140MB) atau WebLLM | `{text, language, confidence, timestamps}` |
| Prosodi | FFT di AudioWorklet → pitch (YAAPT), energy, speaking rate | `{pitch_mean, pitch_std, energy, rate}` |

**Fallback berjenjang:**
```
AudioWorklet + Whisper WASM → AudioWorklet + Web Speech API → ScriptProcessor + dummy level
```

**Optimasi:**
- Model Whisper di-load secara lazy (bukan di startup, hanya saat user pertama kali klik "hold-to-talk")
- VAD mencegah transkripsi silence (hemat CPU 60-80%)
- Hasil transkripsi di-buffer 30 detik → jika tidak ada voice activity 5 detik → flush ke session buffer

### 3. Crisis Fusion — Multimodal On-Device

**Saat ini:** Regex 6 pola pada teks chat saja.

**Target:** Skor krisis = weighted sum dari 3 sumber on-device:

```
crisisScore = (w_text × textScore) + (w_prosody × prosodyScore) + (w_face × faceScore)

w_text = 0.50    (regex + keyword)
w_prosody = 0.30 (pitch spike + speaking rate drop)
w_face = 0.20    (AU4 brow lower + AU6 cheek raise + AU9 nose wrinkle = fear/distress)

Threshold: score > 0.7 → hard-halt + overlay
```

**Kenapa multimodal lebih baik:**
- Regex saja mudah false negative ("saya baik-baik saja" dengan wajah distressed + suara gemetar)
- Prosody alone bisa false positive (user baru olahraga)
- Kombinasi 3 sumber → lebih robust, tetap on-device

### 4. Intisari Generator — On-Device Pre-Processor

**Masalah saat ini:** `craftReply()` di `chatStore.ts` adalah template statis — bukan CBT sungguhan, bukan LLM.

**Target:** Sebelum mengirim ke cloud, on-device menghasilkan intisari terstruktur:

```
Session Buffer (rolling 5 menit):
├── Transcript: "Saya merasa cemas saat meeting besok..."
├── Affect: {trend: "neutral→tense", peak: "anxious@0.7"}
├── Prosody: {pitch_mean: 180Hz, rate: 140 wpm}  ← normal ~150
├── MemoryHits: ["mem_perfectionism", "mem_avoidance"]
└── CBTPhase: "identifying_automatic_thoughts"

Intisari (rule-based + micro-LLM on-device):
{
  "themes": ["anticipatory anxiety", "perfectionism"],
  "hotCognition": "If I mess up, everyone will know I'm incompetent",
  "moodStart": 5, "moodEnd": 3,
  "affectTrend": "neutral→tense",
  "transcript_excerpt": "Saya merasa cemas saat meeting besok...",
  "cbtPhase": "identifying_automatic_thoughts",
  "memoryContext": ["perfectionism", "avoidance pattern"]
}
```

**Teknologi:**
- Rule-based extractor: regex + template untuk CBT constructs (thought, emotion, behavior, distortion type)
- Micro-LLM opsional: WebLLM dengan model `Phi-3-mini` (~2GB, quantized) untuk summarization jika device mampu
- Jika device low-end → pure rule-based (masih menghasilkan JSON terstruktur)

---

## Detail Pipeline — Cloud LLM

### Yang Cloud Terima

```json
{
  "v": 2,
  "sessionId": "ses_abc123",
  "summary": {
    "themes": ["anticipatory anxiety", "perfectionism"],
    "hotCognition": "If I mess up, everyone will know I'm incompetent",
    "moodStart": 5,
    "moodEnd": 3,
    "affectTrend": "neutral→tense",
    "transcript_excerpt": "Saya merasa cemas saat meeting besok...",
    "cbtPhase": "identifying_automatic_thoughts",
    "memoryContext": ["perfectionism", "avoidance pattern"]
  },
  "consentVersion": "2026.08-cbt-1",
  "deviceOnly": true
}
```

### Yang Cloud Kembalikan

```json
{
  "v": 2,
  "suggestions": [
    {
      "type": "socratic_question",
      "text": "What evidence do you have that messing up would reveal incompetence?"
    },
    {
      "type": "behavioral_experiment",
      "text": "Try sending a 'good-enough' draft and observe the actual response vs. the feared one."
    },
    {
      "type": "cognitive_reframe",
      "text": "The anxiety is about being judged — but the evidence suggests you're already competent enough to be in the thread."
    }
  ],
  "crisisFlag": false
}
```

### Cloud Guardrails

| Aturan | Implementasi |
|---|---|
| Tidak ada PII | Client-side filter: hapus nama, email, phone sebelum POST |
| Tidak ada media | Tidak ada field `image`, `audio`, `video`, `previewUrl` |
| Max 500 token excerpt | Potong `transcript_excerpt` di 500 token on-device |
| Idempotent | `Idempotency-Key: {sessionId}` — cloud cache response 24h |
| Timeout 5s | Jika > 5s tanpa response → abort, fallback on-device |
| Crisis override | Jika `crisisFlag: true` di request → cloud tidak merespons, client handle sendiri |

---

## Migrasi Dari Arsitektur Saat Ini

### Phase 1 — Foundation (P0)

| Item | Usaha | Dampak |
|---|---|---|
| Ganti `ScriptProcessorNode` → `AudioWorklet` | Sedang | Mencegah echo, CPU lebih efisien |
| Tambah VAD (Silero) sebelum transkripsi | Kecil | Hemat CPU 60-80% saat silence |
| Tambah versi pada semua Zustand store | Kecil | Mencegah korupsi data diam-diam |
| Crisis fail-closed (deteksi sebelum streaming) | Kecil | Safety-critical |
| Hard purge allowlist key `cbt-*` | Kecil | Mencegah hapus data origin lain |

### Phase 2 — On-Device Intelligence (P1)

| Item | Usaha | Dampak |
|---|---|---|
| Integrasi MediaPipe Face Landmarker | Besar | Ekspresi wajah akurat, bukan luma dummy |
| Integrasi Whisper.cpp WASM (`base` model) | Besar | Transkripsi on-device EN + ID |
| Crisis fusion multimodal (text + prosody + face) | Sedang | Deteksi krisis lebih robust |
| Intisari generator rule-based | Sedang | Cloud hanya terima teks terstruktur |

### Phase 3 — Cloud Integration (P2)

| Item | Usaha | Dampak |
|---|---|---|
| API endpoint cloud LLM (POST /summarize) | Sedang | Saran CBT berbasis konteks |
| Idempotency + cache 24h | Kecil | Tidak duplikat response |
| Fallback on-device jika cloud down | Kecil | Resiliensi |
| Audit log untuk saran cloud | Kecil | Transparansi |

---

## Perbandingan: Sebelum vs Sesudah

| Aspek | Saat Ini | Target |
|---|---|---|
| **Kamera** | 320×240, snapshot JPEG, face worker luma dummy | 1080p, stabilisasi, Face Landmarker 478 landmark, 7-class emotion |
| **Audio** | ScriptProcessor, RMS + peak, tidak ada transkripsi | AudioWorklet, RNNoise, VAD, Whisper transkripsi on-device |
| **Crisis** | Regex 6 pola, teks saja | Multimodal: text + prosody + face AU, weighted score |
| **Cloud** | Tidak ada (hardcoded template) | LLM menerima intisari teks terstruktur, max 500 token |
| **Privacy** | Zero-cloud (media tidak keluar) | Zero-cloud media + cloud teks terstruktur anonim |
| **CPU** | Face 280ms interval + audio main thread | VAD-gated, adaptif interval, AudioWorklet |
| **Persist** | Tanpa versi, JSON.parse mentah | Versioned store, migrasi eksplisit, JSON Schema |

---

## Teknologi yang Direkomendasikan

| Komponen | Pilihan | Ukuran | Catatan |
|---|---|---|---|
| Face Landmarker | `@mediapipe/face-landmarker` | ~6MB | Cached di IndexedDB, WASM |
| VAD | Silero VAD (ONNX) | ~500KB | Voice/silence segmentation |
| Transkripsi | `whisper.cpp` WASM atau `@webllm/webllm` | 140MB-2GB | `base` untuk EN+ID, quantized |
| Noise Suppression | RNNoise (WASM) | ~1MB | Real-time, low latency |
| Emotion Classification | Custom MLP (ONNX) | ~200KB | 7 kelas, input 52 AU |
| Micro-LLM (opsional) | `WebLLM` + Phi-3-mini | ~2GB | Quantized, device high-end saja |
| Cloud LLM | API agnostic (OpenAI/Claude/Groq) | N/A | Hanya intisari, tidak ada media |

---

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Model WASM terlalu besar untuk low-end device | App tidak bisa load | Lazy load, fallback rule-based, progress indicator |
| Whisper transkripsi ID kurang akurat | User frustrasi | Fine-tune `base` model dengan data ID, fallback Web Speech API |
| Cloud response lambat (>5s) | UX terputus | Idempotency + retry, fallback on-device suggestions |
| Face Landmarker crash di Safari lama | Kamera broken | Feature detect, graceful degradation ke luma dummy |
| Memory usage >500MB (3 model WASM) | Tab crash | Load satu per satu, unload model tidak aktif, monitor `performance.memory` |
