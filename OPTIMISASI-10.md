# 10 Optimasi — CBT Memory Agent

> Audit: 2026-08-13 · Arsitektur: React 19 + Vite 6 + Zustand + dnd-kit + Web Workers

---

## 1. Virtualisasi yang benar-benar hemat (performance)

`ChatStream` memakai `@tanstack/react-virtual`, tetapi setiap gelembung adalah `motion.article` + `layout` + Markdown/KaTeX. Saat stream token, `measure()` dipanggil setiap perubahan `tailContent` — itu memaksa layout ulang seluruh item yang terlihat.

- Matikan `layout` Framer pada item di luar viewport; animasi hanya untuk pesan baru.
- Jangan parse KaTeX sampai pesan `streaming === false`.
- Ganti `estimateSize: 128` dengan cache tinggi per `message.id` agar scroll tidak "loncat".
- Graph memori: 7 node aman; di atas ~200 node, pindahkan edge ke satu `<canvas>` / WebGL, jangan SVG path per tautan.

## 2. Persist tanpa versi = korupsi diam-diam (security + fallback)

`cbt-memory-agent-auth`, `cbt-memory-graph`, `cbt-sessions`, `cbt-audit-log`, `cbt-theme` tidak punya `version` / migrasi. Node memori baru (`confidence`, `verified`) "hilang" pada data lama; `emergency` bisa `undefined` dan merusak overlay krisis.

- Setiap store: `{ version: N, data }`.
- `onRehydrateStorage`: jika versi tidak cocok → migrasi eksplisit atau reset ke seed + toast "Vault schema upgraded locally".
- Jangan `JSON.parse` mentah dari `localStorage` tanpa cek bentuk (lihat #4).

## 3. Kontrak pesan worker — EXACT REQUEST format

Sekarang `face.worker` / `audio.worker` longgar. Kunci ke skema tetap agar tidak ada `postMessage` sampah atau transfer buffer dua kali.

**Main → Face worker (transferable):**
```
{ "v": 1, "type": "frame", "w": 64, "h": 48, "ts": 1720000000000, "buffer": ArrayBuffer }
```
Transfer list: `[buffer]`.

**Face worker → Main:**
```
{ "v": 1, "type": "signal", "expression": "neutral"|"tense"|"sad"|"engaged"|"distressed", "confidence": 0.0-1.0, "ts": 1720000000000 }
```
Tidak pernah mengembalikan piksel.

**Main → Audio worker:**
```
{ "v": 1, "type": "pcm", "sampleRate": 48000, "samples": Float32Array }
```

**Audio worker → Main:**
```
{ "v": 1, "type": "level", "rms": number, "peak": number, "ts": number }
```

Tolak pesan jika `v !== 1` atau `type` tidak dikenal. Itu fallback parsing.

## 4. EXACT REQUEST parsing — validasi di batas (security)

Tiga batas yang hari ini percaya input:

| Batas | Risiko sekarang | Parsing yang harus kaku |
|---|---|---|
| `detectCrisis(text)` | string apa saja, ReDoS potensial jika pola diperluas | Panjang max 8k (sudah di textarea); normalisasi NFC; potong sebelum regex; timeout / fail-closed ke *bukan krisis* jika parse gagal — **kecuali** karakter berbahaya yang sudah match literal |
| Magic link `?token=` | token dibandingkan string mentah | Format: `lnk_[a-z0-9]{7}_[a-z0-9]+`; selain itu → `ok: false`, jangan sentuh `status` |
| Export / persist JSON | `JSON.parse` tanpa schema | Ajukan JSON Schema per bundle: `exportedAt` ISO-8601, `deviceOnly: true`, `chat[].role` enum, **larang** `previewUrl` / `data:` |
| WebAuthn `credential.id` | disimpan apa adanya | Panjang + charset Base64URL; jangan log |

Aturan: **parse → validate → copy field yang diizinkan saja** (allowlist). Jangan spread objek persist ke state.

## 5. Hard halt & krisis — fail-closed, bukan fail-open (fallback + security)

`CrisisHaltBridge` dan `detectCrisis` adalah Layer 1. Jika overlay gagal mount atau `hardHalt` throw, stream CBT tetap jalan — itu gagal terbuka.

- `sendMessage`: deteksi krisis **sebelum** `set({ isStreaming: true })`.
- Jika `triggerCrisis` gagal, tetap `isStreaming: false` + pesan sistem.
- Face `distressed` jangan pernah hard-halt (sudah benar); biarkan sebagai hint.
- Overlay: jika `BreathingCircle` / `GroundingGame` error, **tetap tampilkan swipe-to-call** (sudah ada ErrorBoundary global — pecah jadi boundary *di dalam* overlay agar 988 tidak ikut mati).

## 6. Stream 29s — kontrak resume yang deterministik (request format + fallback)

`resumeStream` sekarang menambahkan paragraf baru, bukan sisa token. Kalau nanti ada backend SSE:

**Request (client → server), satu bentuk saja:**
```
POST /v1/session/{sessionId}/turn
Content-Type: application/json
Idempotency-Key: {uuid}

{ "v": 1, "text": "...", "memoryIds": ["mem_breath"], "clientTs": "...", "resumeFrom": null | { "turnId": "msg_…", "charOffset": 412 } }
```

**SSE event types yang diizinkan:** `token` | `done` | `truncated` | `crisis` | `error`  
Payload `token`: `{ "t": "string" }` saja.

Fallback: jika event tidak dikenal → abaikan; jika 29s tanpa `done`/`truncated` → UI menandai truncated lokal dan *tidak* mengirim ulang tanpa `Idempotency-Key` yang sama.

## 7. Auth & purge — hardening tanpa server

- `localStorage` untuk sesi = XSS = akun. Ketatkan: tanpa `dangerouslySetInnerHTML` (Markdown sudah lewat `react-markdown` — **kunci** `rehype-raw` tetap mati; jangan pernah nyalakan).
- Magic link di query string masuk history/Referer. Setelah consume: `replaceState` buang `?token=`, jangan persist `magicToken` (sudah di-null-kan — pastikan *tidak* masuk `partialize`).
- Hard purge: hapus **daftar allowlist key** (`cbt-*`), bukan `localStorage.clear()` (bisa merusak kunci lain di origin yang sama). Verifikasi pasca-hapus; jika sisa key `cbt-` → ulang + toast gagal.
- `BroadcastChannel('cbt-memory-agent-auth')`: terima hanya `{ type: "SIGN_OUT" }`. Abaikan payload lain (jangan eksekusi `type` dinamis).

## 8. Media & AudioContext — fallback yang jujur (performance + fallback)

- `ScriptProcessorNode` di `audioClient` sudah deprecated dan berjalan di main-ish graph. Fallback berjenjang: `AudioWorklet` → `ScriptProcessor` → level dummy. Jangan `connect(destination)` jika hanya analisis (itu bisa bocor echo).
- Kamera: satu `getUserMedia` per sesi; stop track di `hardHalt` *dan* unmount *dan* visibility `hidden`.
- Calming oscillator + hold-to-talk + face interval 280ms bersamaan memakan thread. Saat crisis overlay buka: **pause face worker**. Saat hold-to-talk: turunkan face ke 1 Hz atau stop.
- Jangan panggil `getUserMedia` ulang jika permission `denied` — tampilkan state, jangan loop.

## 9. DnD + pointer global — jank dan "drop siluman" (performance)

`GraphCanvas` listen `pointermove` di `window` setiap geser node + `setState` Zustand per frame. Itu merender seluruh graph.

- Tulis posisi ke ref saat drag; commit ke store di `pointerup` (kecuali alignment guides — update throttled 1 frame).
- `elementsFromPoint` per move mahal; hit-test node dengan AABB di ruang world, purge dengan `getBoundingClientRect` (sudah ada).
- Satu `DndContext` per permukaan. Jangan sarangkan context export/destruction di dalam context sesi jika suatu saat di-portal ke root.

## 10. Privacy / export / persist — EXACT bundle + parsing

Export hari ini berbentuk longgar. Kunci versi:

```
{
  "v": 1,
  "exportedAt": "2026-08-13T00:00:00.000Z",
  "consentVersion": "2026.08-cbt-1",
  "deviceOnly": true,
  "chat": [ { "id", "role": "user"|"assistant"|"system", "content", "createdAt" } ],
  "mood": [ { "id", "mood": 0-10, "startedAt", "status" } ],
  "memory": { "nodes": [...], "edges": [...] }
}
```

Parsing (jika suatu saat ada *import*): tolak jika `v` bukan 1, `deviceOnly !== true`, ada key `previewUrl`/`buffer`/`samples`, atau `mood` di luar 0–10. Strip HTML di `content` (Markdown sudah cukup).

---

## Saran tambahan (di luar sepuluh, tetap penting)

- **Krisis Layer 1 vs 2:** regex sekarang fail-open pada teks pendek (`< 4`). Pertahankan. Jangan perkaya regex dengan lookahead kompleks (ReDoS). Layer 2 LLM hanya lewat worker/WASM lokal, bukan fetch.
- **WCAG vs drag-only:** slider consent + kunci merah sudah punya keyboard. Pastikan 5-titik grounding juga punya alternatif klik (sudah ada di goal chips; grounding pads belum setara).
- **Error boundary pecah tiga:** shell / chat stream / crisis. Satu crash KaTeX tidak boleh menelan 988.
- **Jangan ukur "produksi medis" dari UI saja.** Tanpa at-rest encryption (`IndexedDB` + Wrapping key dari WebAuthn PRF, atau sandi perangkat), XSS atau laptop terbuka = vault. Itu hardening berikutnya yang paling berharga, masih on-device.
- **Idempotency:** `End session` bisa diklik ganda → duplikat kartu. Kunci ke `sessionId` yang di-mint sekali di awal timer.
- **Logging:** `console.error` di ErrorBoundary cukup untuk dev; jangan pernah log isi pesan, token, atau `credentialId`.

## Prioritas

Jika hanya tiga yang dikerjakan nanti:

1. **(2) Versi persist + parse allowlist**
2. **(5) Fail-closed krisis**
3. **(7) XSS/Markdown + purge allowlist**

Itu yang paling merusak jika salah, tanpa perlu backend.
