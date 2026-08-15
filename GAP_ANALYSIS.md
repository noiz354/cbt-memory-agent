# Gap Analysis — CBT Memory Agent

Audit terhadap blueprint produksi (6 halaman wajib, katalog 100 komponen 2026, 320+ poin UI/UX, paradigma spasial + multimodal on-device).

**Tanggal audit:** 2026-08-13  
**Kode:** ~103 berkas TS/TSX, arsitektur berbasis fitur.
**Pembaruan 2026-08-15:** beberapa item "OUT OF SCOPE" sudah terimplementasi di Phase A (lihat PROGRESS.md) — ditandai ✅ SHIPPED di bawah. Baris yang belum diubah masih berlaku.

Legenda:

| Status | Arti |
|---|---|
| **SHIPPED** | Hidup di UI, sesuai spek inti |
| **PARTIAL** | Ada, belum semua sub-fitur |
| **GAP** | Belum dibangun, masih masuk frontend |
| **OUT OF SCOPE** | Butuh IdP / SMS / server / blob model — ditolak oleh zero-cloud |

---

## Ringkasan

| Modul | DnD / spasial | Klinis / safety | Chrome 2026 |
|---|---|---|---|
| 1 Onboarding | SHIPPED | SHIPPED | SHIPPED |
| 2 Chat | SHIPPED | SHIPPED | SHIPPED |
| 3 Crisis | SHIPPED | SHIPPED | SHIPPED |
| 4 Sessions | SHIPPED | SHIPPED | SHIPPED |
| 5 Memory | SHIPPED | SHIPPED | SHIPPED |
| 6 Privacy | SHIPPED | SHIPPED | SHIPPED |
| Global shell | SHIPPED | SHIPPED | SHIPPED |

Enam rute + deep-link `/sessions/:id` dan `/memory/:id` hidup. Celah tersisa hampir seluruhnya **sengaja out of scope** (OAuth, JWT HTTP-only, MediaPipe penuh, billing) atau **nice-to-have katalog** (masonry native, FAB speed-dial, confetti).

---

## Page 1 — `/auth` · `/onboarding`

| Item spek | Status |
|---|---|
| Passkey / WebAuthn + fallback kunci lokal | SHIPPED |
| Magic link + `/auth/callback` on-device | SHIPPED |
| Disclosure “bukan terapis / bukan perangkat medis” | SHIPPED |
| Scroll-lock: slider terkunci sampai klausul di-scroll habis | SHIPPED |
| Drag-to-accept consent + keyboard End / panah | SHIPPED |
| Audit `CONSENT_GIVEN` + `schema_version` 2026.08-cbt-1 | SHIPPED |
| Goal chips → Personalized Vault (drag + klik) | SHIPPED |
| Emergency contact name / phone / opt-in overlay | SHIPPED |
| OAuth Google / Apple | OUT OF SCOPE — tidak ada IdP |
| OTP 6-digit SMS | OUT OF SCOPE — tidak ada SMS |
| JWT HTTP-only cookie | OUT OF SCOPE — persist Zustand lokal |

## Page 2 — `/chat`

| Item spek | Status |
|---|---|
| Virtualized stream, Markdown, KaTeX, token SSE simulasi | SHIPPED |
| Auto-expand textarea, Enter kirim, Shift+Enter baris | SHIPPED |
| Draft autosave `sessionStorage` | SHIPPED |
| Drag Core Memory → stream / composer | SHIPPED |
| Native file drop `.pdf` / `.txt` | SHIPPED |
| Drag gelembung AI → quote & reply | SHIPPED |
| Camera PiP draggable + worker ekspresi + snapshot | SHIPPED |
| Hold-to-talk orb, waveform scrub, swipe barge-in | SHIPPED |
| Pill 988 / 119 di header | SHIPPED |
| Session timer + badge model + WebGPU/WASM | SHIPPED |
| End session → kartu di `/sessions` | SHIPPED |
| Recall chip + % weight, taut `/memory` | SHIPPED |
| Highlight pola CBT (catastrophizing, threat-scan, …) | SHIPPED |
| Scroll-to-latest FAB | SHIPPED |
| Truncation 29s + tombol Auto-resume | SHIPPED |
| Rail menyembunyikan memori unverified &lt; 0.6 | SHIPPED |
| MediaPipe Face Landmarker sungguhan | ✅ SHIPPED (2026-08-15) — `@mediapipe/tasks-vision` + `face_landmarker.task` (3.7MB), worker real blendshapes → ekspresi, fallback luma jika model gagal; **lanjutan: interval adaptif** (5Hz aktif/1Hz idle/0Hz crisis, `faceClient.ts`), wasm di `public/wasm/` |
| Kokoro / Whisper on-device | 🔶 PARTIAL (2026-08-15) — Whisper tiny (`@huggingface/transformers` + `onnx-community/whisper-tiny`) + voice notes real via hold-to-talk; **lanjutan: EN+ID via `detectLanguage()` + fallback Web Speech API real** (`webSpeech.ts`); **Kokoro TTS belum** (pakai Web Speech `speechSynthesis`, bukan WebGPU/Kokoro) |

## Page 3 — Crisis overlay (`z-index: 99999`)

| Item spek | Status |
|---|---|
| Full blur, banner crimson, hard halt stream/mic/kamera | SHIPPED |
| Deteksi bahasa on-device (EN + ID) | SHIPPED |
| Swipe-to-call 988 / 119 | SHIPPED |
| SMS / Crisis text + cari UGD | SHIPPED |
| Kartu kontak darurat pribadi (jika opt-in) | SHIPPED |
| 4-7-8 touch-and-hold | SHIPPED |
| 5-point drag grounding | SHIPPED |
| Calming oscillator on-device (gesture-gated) | SHIPPED |
| Focus trap; Esc tidak menutup | SHIPPED |
| Exit hanya setelah siklus napas atau 5 titik | SHIPPED |
| QStash / sendBeacon priority extract | OUT OF SCOPE — tidak ada backend |

## Page 4 — `/sessions` · `/sessions/:sessionId`

| Item spek | Status |
|---|---|
| Kanban / timeline toggle | SHIPPED |
| Drag kartu antar Extracted / Pending / Interrupted | SHIPPED |
| Drag A menimpa B → modal compare | SHIPPED |
| Mood sparkline + scrubber menyorot kartu | SHIPPED |
| Pull-to-refresh mengantre ulang interrupted | SHIPPED |
| Search + filter status | SHIPPED |
| KPI mood delta (paruh awal vs akhir) | SHIPPED |
| Deep link detail + export JSON sesi | SHIPPED |
| Continue / jump ke `/chat` | SHIPPED |
| Filter rentang tanggal kustom | PARTIAL — search teks, bukan date picker |
| IDOR JWT `user_id` | OUT OF SCOPE — data hanya profil browser ini |

## Page 5 — `/memory` · `/memory/:memoryId`

| Item spek | Status |
|---|---|
| Node spasial Core + Chunk, pan / pinch / wheel-zoom | SHIPPED |
| Snap-to-grid + alignment guides | SHIPPED |
| Drag A ke B → tautan Bézier kustom | SHIPPED |
| Decay: node kecil / pudar / badge | SHIPPED |
| Purge zone bakar + Delete keyboard | SHIPPED |
| Confidence meter, unverified &lt; 0.6 | SHIPPED |
| Verify + edit judul/excerpt | SHIPPED |
| Reference count naik saat diinjeksikan ke chat | SHIPPED |
| Crisis flag visual | SHIPPED (field + badge; seed belum menandai krisis) |
| Search vault (memilih node cocok) | SHIPPED |
| Sort “paling sering dipanggil” | GAP |
| Graph 3D | GAP — spek mengizinkan 2D |

## Page 6 — `/settings/privacy`

| Item spek | Status |
|---|---|
| Tab Security / Data rights / Preferences / Audit | SHIPPED |
| Swipe-left revoke; current device = sign out + BroadcastChannel | SHIPPED |
| Export crate Chat / Mood / Memory → JSON lokal | SHIPPED |
| Ketik `HAPUS SELURUH DATA SAYA` + kunci merah + hold 3s | SHIPPED |
| Theme Light / Dark / System | SHIPPED |
| Audit stream (80 event, persist) | SHIPPED |
| Daftar passkey + add WebAuthn baru di hub | PARTIAL — mint di `/auth`, bukan tabel hub |
| Notification matrix, billing, custom domain | OUT OF SCOPE |

## Global shell & katalog 100 komponen

**SHIPPED:** sidebar pin/collapse, glass floating dock, `100dvh`, `@container`, spring 300/25, glassmorphism, token WCAG AA, Cmd/Ctrl+K, toast, offline banner, error boundary, TabSync logout.

**TETAP GAP (katalog, bukan P0 klinis):** masonry native, FAB speed-dial, bottom-sheet snap points, confetti, NProgress top bar, WYSIWYG, color picker, credit-card mask, vector map, lightbox, code-diff, PDF embed, heatmap.

**OUT OF SCOPE:** OAuth stack, OTP, JWT cookie, Cockroach/Redis/QStash, MediaPipe/Kokoro/Whisper berbobot, billing.

---

## Keputusan arsitektur yang disengaja

1. **Tidak ada server.** “JWT”, “QStash”, “IDOR” diganti persist + gate klien. Ini konsisten dengan *Zero-Cloud Privacy* di mega-prompt, bukan regresi.
2. **Vision/audio adalah pipeline on-device.** (Pembaruan 2026-08-15: face kini real MediaPipe Face Landmarker; transkripsi real Whisper tiny via transformers.js; binaural real; WebLLM on-device real — lihat PROGRESS.md Phase A.)
3. **Crisis language adalah Layer 1 (regex).** Layer 2 LLM classifier membutuhkan endpoint; tidak dipasang.
4. **Hard purge bersifat lokal dan irreversible** di `localStorage` + store. Tidak ada OTP email kedua.

## Sisa kerja yang masih masuk akal (jika ada pass berikutnya)

1. Date-range picker di Sessions.  
2. Sort vault by `references`.  
3. Tabel passkey di tab Security.  
4. Seed satu node `crisisFlag: true` untuk demo badge.  
5. ✅ ~~Mengganti face worker dengan Face Landmarker~~ — **DONE (2026-08-15)** via `@mediapipe/tasks-vision` (lihat Page 2).
