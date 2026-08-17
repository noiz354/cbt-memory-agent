# BUG-1 — Assistant returns generic error "Terjadi kendala teknis" on valid user turn despite healthy backend status

- **Tanggal**: 2026-08-17
- **Severity**: High
- **Priority**: P1
- **Component**: Workspace / Chat Stream (`/chat`), `lambda/handlers/chatTurn.ts`, `src/shared/lib/llmClient.ts`, `src/shared/lib/apiClient.ts`
- **Status**: Fixed
- **Screenshot**: `Screenshot 2026-08-17 222522.png` (same directory)

---

## Judul

Assistant merender bubble error generik **"Terjadi kendala teknis. Coba lagi dalam beberapa saat."** sebagai *balasan asisten* setiap kali backend `/chat/turn` gagal — padahal badge status backend menampilkan **"Backend ok"** (hijau).

## Environment

- **User Profile**: `norman` (workspace)
- **App State**: Live session (`04:55`), On-device vision active (`Camera idle`), TTS Ready
- **Backend Health**: `Backend ok` (status badge hijau)
- **Vault Memories Pinned (14 total)**, termasuk:
  - `Desire for emotional space` (80%)
  - `Openness to CBT framing` (80%)
  - `Low mood and reduced appetite` (80%)

## Chat Stream History (dari layar)

| Waktu | Role | Isi |
|---|---|---|
| 22.21 | Assistant | *"Terjadi kendala teknis. Coba lagi dalam beberapa saat."* |
| 22.25 | User | `"saya lagi senang rasanya sekarang karena makan saya sudah 3 kali sehari dari sarapan hingga makan malam, tanpa adanya gangguan?"` |
| 22.25 | Assistant | *"Terjadi kendala teknis. Coba lagi dalam beberapa saat."* |

> Catatan: bubble error tampil **sebelum** pesan user berikutnya — artinya error bukan respons terhadap pesan yang men-trigger-nya saja, melainkan kegagalan turn sebelumnya (22.21) yang juga digagalkan saat dicoba ulang (22.25). Setiap dispatch `/chat/turn` menghasilkan pola kegagalan yang sama.

## Steps to Reproduce

1. Buka session sebagai `norman` di `/chat` dengan vault pinned items.
2. Pastikan badge backend hijau **"Backend ok"**.
3. Kirim prompt normal berbahasa Indonesia: `"saya lagi senang rasanya sekarang karena makan saya sudah 3 kali sehari dari sarapan hingga makan malam, tanpa adanya gangguan?"`
4. Enter → dispatch turn via SSE (`POST /api/v1/chat/turn`).
5. Bubble asisten menampilkan *"Terjadi kendala teknis. Coba lagi dalam beberapa saat."*

## Expected Behavior

- Turn diproses oleh orchestration backend; memori relevan (mis. `Low mood and reduced appetite`) di-recall dan di-stream balik sebagai respons terapeutik CBT empati.
- Jika LLM benar-benar gagal di semua provider, UI harus menampilkan pesan fallback eksplisit per runbook **J2.8**: *"— LLM unavailable. All providers failed (on-device, backend, and BYOK)…"* — **bukan** error generik yang berpura-pura jadi balasan asisten.

## Actual Behavior

Bubble *"Terjadi kendala teknis…"* dirender seolah-olah itu konten balasan asisten, tanpa indikasi error, tanpa fallback ke BYOK, meskipun healthcheck backend melaporkan sehat.

---

## Root Cause (Confirmed)

Ada tiga lapisan yang saling memperparah:

### 0. Frontend mengirim prompt CBT terbungkus sebagai `userMessage` → backend `plainto_tsquery` crash (penyebab utama)

**Bukti CloudWatch (log group `/aws/lambda/cbt-memory-agent`, event `chat.turn_failed`):** setiap turn chat gagal 100% sejak 2026-08-16 dengan error yang persis sama:

```
err: "syntax error in TSQuery: User message: \"<teks user>\"\n\nRespond using CBT techniques: identify the automatic thought, name the cognitive distortion, suggest an evidence-based reframe. Keep it warm, concise (200-400 words), and collaborative."
```

Timestamps terdampak: 2026-08-16T07:15:30/07:19:59Z, 2026-08-17T07:31:19-55Z, dan reproduksi live 2026-08-17T15:21:52/15:25:08/15:36:21/15:39:37Z (termasuk pesan `norman` 22:21/22:25 WIB). Kegagalan terjadi **sebelum pemanggilan LLM** (di langkah memory retrieval keyword) — **bukan** kuota OpenRouter. Chat rusak 100% untuk semua user.

Rantai penyebab:

1. `src/features/chat/store/chatStore.ts:242` membungkus pesan user dengan `buildCBTPrompt(text, memories)` → hasilnya `User message: "…"\n[Working context: …]\nRespond using CBT techniques: …`.
2. Prompt terbungkus itu dikirim sebagai `userMessage` ke `POST /api/v1/chat/turn` (`src/shared/lib/llmClient.ts:236-239`, `callBackendProxy`).
3. Backend `getMemoryContext` meneruskannya (tanpa pembersihan) ke `plainto_tsquery('english', $2)` (`lambda/handlers/chatTurn.ts:282`) → CockroachDB melempar `syntax error in TSQuery` karena penuh tanda baca/kutip/titik dua → exception meledak ke catch-all.
4. Catch-all mengembalikan error generik `{"t":…}` HTTP 200 → bubble asisten palsu (symptom yang terlihat).

Ini juga menjelaskan mengapa jalur sync terpisah (`apiClient.chatTurn`, `apiClient.ts:284+`) yang mengirim **teks mentah** tidak pernah sempat berjalan — generasi (yang mengirim prompt terbungkus) gagal lebih dulu setiap kali.

### 1. Error channel backend tidak dapat dibedakan dari content channel (amplifier)

`lambda/handlers/chatTurn.ts:175-187` — catch-all menelan **semua** exception internal dan mengembalikannya sebagai **HTTP 200** dengan SSE frame `data: {"t":"Terjadi kendala teknis. Coba lagi dalam beberapa saat."}`. Frame `t` persis berbentuk frame konten asli yang dipakai baris `chatTurn.ts:158-168`.

Karena HTTP = 200, frontend tidak pernah masuk jalur `!response.ok` (`llmClient.ts:256-266`), dan parser SSE (`parseBackendProxySSE`, `llmClient.ts:271-347`; juga `apiClient.chatTurn`, `apiClient.ts:284-337`) **tidak punya konsep "error frame"** — setiap `{"t":...}` di-append sebagai delta asisten:

```
llmClient.ts:305-321  json.t dianggap delta konten → onStream({delta}) → bubble asisten
```

Hasilnya tiga efek buruk sekaligus:

- **(a)** Error generik tampil sebagai **balasan asisten palsu** (symptom yang terlihat).
- **(b)** Fallback chain rusak: `callBackendProxy` menganggap sukses (HTTP 200) → **BYOK tidak pernah dicoba** → pesan J2.8 tidak pernah muncul.
- **(c)** Error asli ditelan — hanya `logger.error("chat.turn_failed", …, {err})` (`chatTurn.ts:176-178`) yang menyimpan pesan asli. Human user hanya melihat teks generik.

### 2. Healthcheck tidak menguji jalur inferensi (mengapa badge tetap hijau)

`/api/v1/health` (`lambda/handlers/health.ts:10-32`) hanya menguji:
- `crdb.healthCheck()` → `SELECT 1`
- `llm.healthCheck()` → `GET /credits` OpenRouter
- `s3.healthCheck()`

Tidak ada yang memanggil `POST /chat/completions` dengan `CHAT_MODEL = "openrouter/free"`. Karena itu konektivitas `ok` sepenuhnya kompatibel dengan kegagalan generasi (kuota free model habis/`openrouter/free` 402/429, key expire, jaringan Lambda ke OpenRouter, dsb.).

## Pemicu terkonfirmasi

Dikonfirmasi via CloudWatch + inspeksi bundle Lambda live (`$LATEST`, di-deploy 2026-08-16T17:58:49Z): error asli untuk seluruh window pengamatan adalah satu-satunya `syntax error in TSQuery` dilontarkan oleh langkah keyword retrieval di `getMemoryContext` — prompt CBT terbungkus yang dikirim frontend diteruskan apa adanya ke `plainto_tsquery`. **Bukan** kuota OpenRouter, bukan network, bukan skema DB. Bundle live berisi `plainto_tsquery('english', $2)` dengan param = `body.userMessage`; bundle tidak berisi teks `"User message:"` / `"Respond using CBT techniques"` — membuktikan teks tersebut dikirim oleh frontend.

Catatan: `ALLOWED_ORIGIN` di Lambda live masih `*` (masalah terpisah, CORS, bukan penyebab error ini).

## Fix yang Diterapkan

### Backend — `lambda/handlers/chatTurn.ts` (catch-all)

Error frame berubah dari `{"t": "<teks generik>"}` menjadi frame error terstruktur yang **tidak bisa dikira konten**:

```json
data: {"error":true,"code":"chat_turn_failed","message":"Terjadi kendala teknis. Coba lagi dalam beberapa saat."}
```

Tetap dipakai HTTP 200 + format SSE (kontrak API tidak berubah), tetapi sekarang ada penanda eksplisit.

### Backend — `lambda/handlers/chatTurn.ts` (`getMemoryContext`, keyword retrieval) — FIX PENYEBAB UTAMA

1. **Sanitasi input**: helper baru `sanitizeSearchText()` — buang semua non-`[A-Za-z0-9 ]`, kolapskan spasi, potong 500 char — dipakai sebagai param ke `plainto_tsquery('english', $2)` (`chatTurn.ts:275-286`). Prompt terbungkus tidak lagi bisa memicu `syntax error in TSQuery`.
2. **Fail-soft**: query keyword dibungkus `try/catch` → saat gagal, `logger.warn("chat.keyword_failed", …)` lalu lanjut ke vector query + `reciprocalRankFusion` (heuristic+vector). Turn tidak pernah crash karena input pengguna.

### Frontend — kirim teks mentah, bukan prompt terbungkus

- `src/shared/lib/llmClient.ts`: `LLMRequest` punya field opsional `backendUserText`; `callBackendProxy` memakai `request.backendUserText ?? <joined user messages>` sebagai `userMessage` body (`llmClient.ts:236-243`). `callLLMWithFallback` menerima `options?: { backendUserText? }` opsional (tanpa mengubah caller lain).
- `src/features/chat/store/chatStore.ts:252`: `sendMessage` meneruskan `{ backendUserText: text || "(media only)" }` → memory-recall backend berjalan atas pesan asli (sesuai semantik `recordedTitles`), dan LLM backend tidak lagi diberi prompt ganda (backend menyusun prompt CBT-nya sendiri).

### Frontend — `src/shared/lib/llmClient.ts` (`parseBackendProxySSE`) & `src/shared/lib/apiClient.ts` (`chatTurn` SSE reader)

Kedua parser SSE mendeteksi `{error:true}` dan **throw** (sebelum sempat di-append sebagai delta):

- `llmClient.ts`: `callLLMWithFallback` mendapat error dari backend → lanjut ke provider BYOK → jika semua gagal, `chatStore` catch (`chatStore.ts:289-307`) merender pesan J2.8 yang benar.
- Tidak ada lagi *fake assistant reply* berisi teks error generik.

### Tes regresi

- `src/shared/lib/llmClient.test.ts`: (a) feed error frame SSE → `callLLM` **meng-throw** (bukan me-*stream* teks error); (b) `backendUserText` dipakai sebagai `userMessage` di body fetch (bukan prompt terbungkus).
- `lambda/tests/chatTurn.test.ts`: (a) `handleChatTurn` dengan `crdb` yang melempar → SSE body mengandung `"error":true` (bukan `"t":"Terjadi…"`); (b) input ber-tanda baca → param keyword tersanitasi & mode tetap `hybrid`; (c) keyword query melempar → fall through ke vector+fuse tanpa throw.

## Verification Plan

1. `npm run typecheck`, `npm test`, `npm run build` hijau; lambda `npm run typecheck:test`, `npm test`, `npm run build` hijau.
2. Commit + push `main` → CI `deploy.yml` menjalankan terraform apply + deploy frontend (S3/CloudFront) + health check.
3. Smoke post-deploy: `POST /api/v1/chat/turn` dengan pesan nyata (mis. `halo, saya senang banget hari ini`) → SSE `data: {"t":…}` berisi balasan asli lalu `data: [DONE]` (bukan error frame).
4. CloudWatch: jumlah event `chat.turn_failed` berhenti bertambah; tersisa paling banyak event `chat.keyword_failed` (warn, benign).

## Related

- `docs/FRONTEND-INTEGRATION-AUDIT.md` baris 109 — item gap yang sama sudah ditandai: *"the `{"t":"Terjadi kendala teknis…"}` line IS streamed as if it were assistant content"* (XS effort, HIGH).
- `docs/QA-RUNBOOK-FRONTEND.md` baris 190 (J2.8) — ekspektasi pesan fallback eksplisit saat backend down.