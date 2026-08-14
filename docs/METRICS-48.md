# 48 Metrik — CBT Memory Agent

> Panduan role-based untuk Data Analyst, Data Engineer, Reviewer Medis, dan Frontend Developer.
>
> **Prinsip:** Frontend hanya supply data. Tidak ada interpretasi klinis di layer UI.
> Semua metrik dihitung on-device dari audit log + store counters. Tidak ada chat content,
> camera frame, PCM audio, atau device fingerprint yang dikirim.

**Tanggal:** 2026-08-13
**North star:** `Activation(21) × Crash-free(42) × Hard-halt integrity(7)`

---

## Arsitektur Data

```
┌──────────────────────────────────────────────────────────────────┐
│                      FRONTEND (UI events)                        │
│                                                                  │
│  Component calls:  metric.crisisOverlayOpened()                  │
│                    metric.streamDone()                           │
│                    metric.dndSuccess()                           │
│                                                                  │
│                    ↓                                              │
├──────────────────────────────────────────────────────────────────┤
│                    METRICS STORE (counters)                       │
│                                                                  │
│  localStorage: cbt-metrics                                       │
│  { counters: { crisisOverlayOpened: 3, streamDone: 12, ... } }   │
│  48 counters — raw integers, bumped at event time                │
│                                                                  │
│                    ↓                                              │
├──────────────────────────────────────────────────────────────────┤
│                   ANALYTICS LAYER (computation)                   │
│                                                                  │
│  computeMetrics() → 48 MetricValue[] with %, denominators        │
│  exportMetrics() → MetricsExport JSON { v, release, metrics,     │
│    northStar, guardrails }                                        │
│                                                                  │
│  Reads from: metricsStore + sessionStore + memoryStore           │
│  Does NOT read: chat content, PCM, camera frames                 │
│                                                                  │
│                    ↓                                              │
├──────────────────────────────────────────────────────────────────┤
│                       EXPORT / DASHBOARD                          │
│                                                                  │
│  JSON download (user-initiated) → metrics JSON v=2               │
│  No network send — data stays on-device until user exports        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Untuk Frontend Developer

### Aturan emas
1. **Frontend hanya supply data** — panggil `metric.xxx()` di event handler
2. **Jangan kirim payload klinis** — tidak ada chat content, PCM, atau frame kamera di metric
3. **Jangan hitung persentase di UI** — analytics layer yang hitung, UI hanya bump counter

### Cara pakai

```tsx
// Di CrisisOverlay.tsx — saat overlay terbuka
import { metric } from "@/shared/lib/metrics";

useEffect(() => {
  metric.crisisOverlayOpened();
}, []);

// Di ChatBubble.tsx — saat stream selesai
useEffect(() => {
  if (!message.streaming && !message.truncated) {
    metric.streamDone();
  }
  if (message.truncated) {
    metric.streamTruncated();
  }
}, [message.streaming, message.truncated]);

// Di SpatialDndProvider.tsx — saat drop sukses
onDrop={() => {
  metric.dndSuccess();
  // ... existing logic
}};
```

### Hook points yang sudah tersedia

| Event | File yang harus diubah | Metric call |
|---|---|---|
| Crisis overlay mount | `CrisisOverlay.tsx` | `metric.crisisOverlayOpened()` |
| Crisis dismissed <15s | `CrisisOverlay.tsx` | `metric.crisisFalseShort()` |
| Grounding completed | `BreathingCircle.tsx` / `GroundingGame.tsx` | `metric.crisisGroundingDone()` |
| Safe exit after grounding | `CrisisOverlay.tsx` | `metric.crisisSafeExit()` |
| Lifeline tap (988/119) | `SwipeToCall.tsx` | `metric.crisisLifelineTap()` |
| Hard-halt success | `CrisisHaltBridge.tsx` | `metric.crisisHardHaltOk()` |
| Distress hint no halt | `CameraPip.tsx` | `metric.distressHintNoHalt()` |
| Consent completed | `ConsentSlider.tsx` | `metric.consentCompleted()` |
| Export success | `ExportBuilder.tsx` | `metric.exportSuccess()` |
| Purge started/completed | `DestructionKey.tsx` | `metric.purgeStarted()` / `.purgeCompleted()` |
| Session finalized | `ChatPage.tsx` (End session) | `metric.sessionFinalized()` |
| Memory injected | `SpatialDndProvider.tsx` | `metric.turnWithMemory()` |
| Stream done/truncated | `chatStore.ts` (streamTokens) | `metric.streamDone()` / `.streamTruncated()` |
| Resume success | `chatStore.ts` (resumeStream) | `metric.resumeSuccess()` |
| DnD success | `SpatialDndProvider.tsx` | `metric.dndSuccess()` |
| Compare opened | `CompareModal.tsx` | `metric.compareOpened()` |
| ErrorBoundary catch | `ErrorBoundary.tsx` | `metric.crashBoundary()` |
| Worker valid/fail | `face.worker.ts` / `audio.worker.ts` | `metric.workerValid()` / `.workerParseFail()` |

---

## Untuk Data Analyst

### Export format

```bash
# Di browser console atau fitur export:
import { exportMetrics } from "@/shared/lib/metricsAnalytics";
const data = exportMetrics();
console.log(JSON.stringify(data, null, 2));
```

### Output structure

```json
{
  "v": 2,
  "releasedAt": "2026-08-13T00:00:00.000Z",
  "release": { "version": "0.1.0", "sha": "abc123", "buildAt": "..." },
  "metrics": [
    { "id": 1, "name": "Crisis precision (proxy)", "category": "A", "direction": "→", "value": 85.7, "denominator": 7 },
    { "id": 7, "name": "Hard-halt integrity", "category": "A", "direction": "↑", "value": 100, "denominator": 7 }
  ],
  "northStar": { "activation": 12, "crashFree": 100, "hardHaltIntegrity": 100 },
  "guardrails": { "falseCrisisRate": 0, "distressNoAutoHalt": 100, "purgeAbandon": 2 }
}
```

### North star metrics (3 angka)

| Metrik | ID | Interpretasi |
|---|---|---|
| **Activation (D0)** | 21 | % install yang onboarding + 1 turn chat |
| **Crash-free** | 42 | 1 − (ErrorBoundary / total sesi) |
| **Hard-halt integrity** | 7 | % krisis di mana streaming berhenti dalam 1 frame |

Produk gagal jika salah satu runtuh. Ini bukan "success rate" — ini viability gate.

### Guardrail metrics (jangan optimasi naik)

| Metrik | ID | Kenapa tidak boleh naik |
|---|---|---|
| False-crisis rate | 2 | Naik = terlalu sering false alarm → user trauma |
| Distress-hint no-auto-halt | 10 | Harus ~100% — distressed ≠ crisis |
| Time-on-consent (too fast) | 13 | <30 detik = user tidak baca |
| Purge abandon | 18 | Normal ada yang batal — jangan push completion |
| Distortion-mark rate | 33 | Jangan game dengan tag semua balasan |
| Mood delta | 34 | Bukan bukti efikasi — interpretasi hati-hati |

### Segmentasi wajib

- `release` (SemVer+SHA)
- `authMethod` (passkey vs magic-link)
- `theme` (light/dark/system)
- `hasEmergencyContact` (ya/tidak)
- `crisisTriggered` (ya/tidak)

**Jangan segmentasi:** wajah/ekspresi, isi chat, transcript content.

### Sample size

30 hari × install lokal. Jangan kejar signifikansi A/B pada krisis — N kecil dan etis bermasalah.

### Query contoh

```
// Crisis precision: % overlay dari deteksi (bukan manual)
crisisFromDetection / crisisOverlayOpened

// Thought-reframe coverage: % sesi extracted dengan reframe != null
sessions.filter(s => s.reframe != null).length / sessions.filter(s => s.status === "extracted").length

// Stream completion: % reply done tanpa truncated
streamDone / (streamDone + streamTruncated)
```

---

## Untuk Data Engineer

### Pipeline data on-device

```
Event (component) → metric.bump() → metricsStore (localStorage)
                                              ↓
                                    computeMetrics()
                                              ↓
                                    exportMetrics() → JSON download
```

### Tidak ada pipeline ke server

Semua data tetap di perangkat. Export JSON adalah satu-satunya cara data keluar, dan itu user-initiated.

### Schema evolution

- `cbt-metrics` store: `{ version: 1, counters: { ... } }`
- Jika versi berubah → `createVersionedPersist` handles migration
- Counter names tidak boleh dihapus, hanya ditambah
- Jika counter deprecated → biarkan nilainya stagnan, jangan reset

### Storage budget

- 48 counters × 8 bytes (number) = ~384 bytes
- Ditambah overhead JSON ≈ ~500 bytes di localStorage
- Audit log: 80 events max ≈ ~8KB
- Total: <10KB untuk seluruh metrics + audit

### Export JSON validation

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["v", "release", "metrics", "northStar", "guardrails"],
  "properties": {
    "v": { "const": 2 },
    "release": {
      "type": "object",
      "required": ["version", "sha"],
      "properties": {
        "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
        "sha": { "type": "string", "minLength": 7 }
      }
    },
    "metrics": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "category", "direction", "value"],
        "properties": {
          "id": { "type": "number", "minimum": 1, "maximum": 48 },
          "category": { "enum": ["A", "B", "C", "D", "E", "F"] },
          "direction": { "enum": ["↑", "↓", "→"] }
        }
      },
      "minItems": 48,
      "maxItems": 48
    }
  }
}
```

### Validation rules saat import (jika ada)

- Tolak jika `v !== 2`
- Tolak jika ada `previewUrl`, `buffer`, `samples` di payload
- Tolak jika metrics count !== 48
- Strip HTML di semua text field

---

## Untuk Reviewer Medis / Privasi

### Pertanyaan yang selalu ditanya duluan

| # | Pertanyaan | Metrik | Target |
|---|---|---|---|
| 1 | Apakah krisis benar-benar menghentikan session? | #7 Hard-halt integrity | ↑ 100% |
| 2 | Apakah consent tercatat dengan versi benar? | #11 Consent completion | schema `2026.08-cbt-1` |
| 3 | Apakah export JSON valid tanpa data terlarang? | #16 Export success | v=1, tanpa previewUrl |
| 4 | Apakah purge benar-benar bersih? | #19 Post-purge residue | ↓ 0 |
| 5 | Apakah app tetap stabil? | #42 Crash-free sessions | ↑ ≥ 99% |
| 6 | Apakah crash tidak menelan crisis overlay? | #43 Crisis-safe crashes | ↑ 100% |

### Klaim yang TIDAK dibuat app ini

- ❌ "Tingkat kesembuhan" — bukan alat diagnostik
- ❌ "Skor bunuh diri menurun" — bukan alat asesmen klinis
- ❌ "Ekspresi wajah mendeteksi depresi" — hanya hint, bukan diagnosis
- ❌ "Mood delta membuktikan efikasi" — self-report, bukan outcome

### Privasi

- Zero-cloud: tidak ada data yang dikirim ke server secara otomatis
- Export JSON: user-initiated, hanya jika user memilih "Mint JSON"
- Hard purge: irreversible, menghapus semua key `cbt-*` dari localStorage
- BroadcastChannel: hanya `{ type: "SIGN_OUT" }` — tidak ada payload lain
- Kamera: frame dipotong 64×48 untuk face analysis, tidak disimpan, tidak dikirim
- Audio: PCM dianalisis di worker, tidak disimpan, tidak dikirim

### Consent

- Versi `2026.08-cbt-1` tercatat di audit log saat user accept
- Scroll-lock: slider terkunci sampai klausul di-scroll habis
- Drag-to-accept: consent tercatat dengan timestamp + schema version

---

## Peta File

| File | Peran |
|---|---|
| `src/shared/store/metricsStore.ts` | Zustand persist — 48 raw counters |
| `src/shared/lib/metrics.ts` | Thin wrappers — frontend memanggil `metric.xxx()` |
| `src/shared/lib/metricsAnalytics.ts` | Analytics layer — `computeMetrics()`, `exportMetrics()` |
| `src/shared/store/auditStore.ts` | Audit log — 80 events max, terpisah dari counters |
| `src/shared/lib/versionedPersist.ts` | Versioning wrapper — semua store pakai ini |
