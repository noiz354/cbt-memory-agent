# Manual Runbook — Human Tester (Live, ap-southeast-3)

> Runbook pengetesan **manusia** terhadap fitur yang sudah **live** di produksi:
> Emotional Media Attachments, Reflection Loop (MCP + cluster health gate + skills),
> recall hybrid RRF, dan **11 perbaikan gap audit integrasi frontend-backend**
> (commits `158cc2a`..`76328ed`, `docs/FRONTEND-INTEGRATION-AUDIT.md`).
> Update: 2026-08-16. Backend: Lambda Function URL (`CBT Memory Agent`),
> DB: CockroachDB Cloud `woozy-grivet` (v26.2.5).

## 1. Lingkungan uji

| Item | Nilai |
|---|---|
| Base URL (Function URL) | `https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws` |
| Health (tanpa auth) | `GET {BASE}/api/v1/health` |
| Region / profile AWS | `ap-southeast-3` / `aws-x-cdb` (SSO `aws login --profile aws-x-cdb --remote`) |
| Terraform | `/home/norman2/bin/terraform` — butuh `export PATH="$HOME/bin:$PATH"` |
| CRDB | `woozy-grivet-31232.j77.aws-ap-southeast-3.cockroachlabs.cloud:26257`, conn di `.env` `CRDB_CONNECTION_URL` |
| S3 bucket | `cbt-memory-exports` (AES256 at-rest default) |
| Frontend (dev) | `http://localhost:5173` |
| EventBridge rule | `cbt-memory-agent-reflect` — `rate(6 hours)` (schedule-based, tidak terpicu `put-events`) |

**Cara pakai curl:**
```bash
BASE="https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws"
TOKEN="tester-$(date +%s)"            # bebas ≥8 karakter, tanpa spasi
DEVICE="runbook-device-1"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "X-Device-Id: $DEVICE")
JSON=(-H "Content-Type: application/json")
```

> Semua endpoint WAJIB `Authorization` + `X-Device-Id` **kecuali** `/api/v1/health`.
> Token yang sama → `user_id` yang sama (`md5(token)::uuid`), jadi satu runbook = satu user bersih.

---

## 2. Verifikasi dasar

### 2.1 Health check (tanpa auth)
```bash
curl -s "$BASE/api/v1/health"; echo
```
Harapan: `{"status":"ok","crdb":"connected","llm":"available","s3":"available","version":"0.1.0"}`

### 2.2 Auth negatif
```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/v1/metrics"                    # → 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/metrics"                                                            # → 401 (tanpa X-Device-Id)
```

---

## 3. Emotional media attachment (API live E2E)

> Alur nyata di browser: analisis **on-device** → kirim narrative ke backend → node
> `kind='attachment'` + raw media di S3. Runbook ini memverifikasi jalur backend yang sama.

### 3.1 Presign
```bash
curl -s "$BASE/api/v1/attachments/presign" "${AUTH[@]}" "${JSON[@]}" -d '{
  "v": 1, "kind": "image", "ext": "jpg", "mimeType": "image/jpeg"
}'; echo
```
Harapan: `{"v":1,"key":"media/<uuid>/<uuid>.jpg","uploadUrl":"https://cbt-memory-exports.s3......"}`
Simpan `key` dan `uploadUrl` (mis. variabel `KEY`, `UPLOAD`).

### 3.2 Upload raw bytes ke S3 (presigned PUT)
```bash
# Buat file uji (boleh dummy 1KB — server hanya menyimpan, tidak memvalidasi isi media)
head -c 1024 /dev/urandom > /tmp/opencode/tester.bin
curl -s -o /dev/null -w "PUT %{http_code}\n" -X PUT -H "Content-Type: image/jpeg" \
  --data-binary @/tmp/opencode/tester.bin "$UPLOAD"     # → 200
```

### 3.3 Create memory node + attachment
```bash
curl -s "$BASE/api/v1/attachments" "${AUTH[@]}" "${JSON[@]}" -d "{
  \"v\": 1,
  \"kind\": \"image\",
  \"title\": \"Camera \u00b7 sad 82% \u00b7 test\",
  \"excerpt\": \"User appeared sad (82% confidence)\",
  \"narrative\": \"User appeared sad (82% confidence) during the therapy session. Snapshot image attachment.\",
  \"s3Key\": \"$KEY\",
  \"mimeType\": \"image/jpeg\",
  \"sizeBytes\": 1024,
  \"emotions\": { \"primary\": \"sad\", \"confidence\": 0.82 }
}"; echo
```
Harapan: `{"v":1,"ok":true,"nodeId":"<uuid>","attachmentId":"<uuid>"}`

### 3.4 List
```bash
curl -s "$BASE/api/v1/attachments" "${AUTH[@]}"; echo
```
Harapan: array berisi attachment di atas (title, excerpt, s3Key, kind).

### 3.5 Delete (S3 object + cascade node)
```bash
curl -s -X DELETE "$BASE/api/v1/attachments/<NODE_ID>" "${AUTH[@]}"; echo   # → {"v":1,"ok":true}
curl -s "$BASE/api/v1/attachments" "${AUTH[@]}"; echo                        # attachment hilang
```
> Setelah 3.5, lanjut ke §4 dengan **token baru** supaya user uji tetap bersih — atau
> buat attachment kedua di 3.3 tanpa delete.

---

## 4. Recall attachment via hybrid RRF (semantic)

> Node attachment `verified=true`, `confidence=0.82` → lolos filter retrieval
> (`verified AND confidence >= 0.6`), dan 3 leg retrieval tidak memfilter `kind`.

### 4.1 Buat attachment yang mau di-recall (ulangi §3.1–3.3 dengan token ini)
```bash
TOKEN="tester-rrf-$(date +%s)"; DEVICE="runbook-device-1"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "X-Device-Id: $DEVICE")
```
Buat 1 attachment **tanpa delete** (mis. narrative berisi kata kunci unik seperti `helmet`).

### 4.2 Semantic search API
```bash
curl -s "$BASE/api/v1/memory/semantic?q=helmet&limit=5&minConfidence=0.6" "${AUTH[@]}"; echo
```
Harapan: `results` berisi node attachment dengan `matchReason:"vector"` dan score tinggi.

### 4.3 Chat turn (full hybrid RRF: heuristic + keyword fulltext + vector)
```bash
curl -N -s "$BASE/api/v1/chat/turn" "${AUTH[@]}" "${JSON[@]}" -d '{
  "v": 1,
  "sessionId": "runbook-rrf-1",
  "userMessage": "Aku masih ingat saat aku terlihat sedih di sesi lalu. Bisakah kamu ingatkan?",
  "clientTs": "2026-08-16T08:00:00.000Z",
  "deviceOnly": true
}'; echo
```
Harapan: respons SSE `data: {"t":"..."}` diakhiri `data: [DONE]`. Event terakhir sebelum
`[DONE]` kini membawa metadata recall: `data: {"t":"","injectedMemoryIds":[...],"recalledTitles":[...]}`
(commit `96e8cee` — backend meng-echo judul recall yang sebelumnya hanya ada di span
`agent.memory.retrieve`). Di log Lambda, span `agent.memory.retrieve` berisi
`memory.recalled_titles` yang memuat judul attachment.
> Verifikasi LLM mention-nya opsional — bukti kuat = retrieved titles di log (lihat §6)
> atau chip "Recalled N memories" + judul di UI (lihat §7 U1–U2).

---

## 5. Reflection loop (MCP + cluster health gate + skills)

> Rule EventBridge `cbt-memory-agent-reflect` berjalan `rate(6 hours)`. Untuk uji manual,
> invoke Lambda langsung (payload event reflection):

```bash
export PATH="$HOME/bin:$PATH"; export AWS_PROFILE=aws-x-cdb
printf '{"source":"agent.memory","detail-type":"reflect","detail":{}}' > /tmp/opencode/re.txt
aws lambda invoke --function-name cbt-memory-agent \
  --region ap-southeast-3 --payload fileb:///tmp/opencode/re.txt \
  --log-type Tail /tmp/opencode/re-out.json 2>/dev/null
python3 - <<'PY'
import json, base64, gzip
raw = json.load(open('/tmp/opencode/re-out.json'))
print("BODY:", raw.get("body"))
logs = gzip.decompress(base64.b64decode(raw["LogResult"])).decode()
for ln in logs.splitlines():
    if any(k in ln for k in ("reflection.cluster_health","reflection.mcp_query","reflection.completed")):
        print(ln[:300])
PY
```
Harapan:
- BODY: `{"v":1,"ok":true,"reflectedAt":"...","userFacts":0,"errors":0,"skipped":0}`
- Log `reflection.cluster_health`: `{"status":"UNSPECIFIED","nodeCount":0,"healthy":true,...}` (REST fallback)
- Log `reflection.mcp_query`: `success:true` dengan `factsCount` per user (0–25)
- Log `reflection.completed`: `userFacts:0,errors:0,skipped:0`

---

## 6. Verifikasi audit & data di CockroachDB

```bash
export PATH="$HOME/bin:$PATH"
CRDB_URL="$(grep CRDB_CONNECTION_URL .env | cut -d= -f2-)"
cockroach sql --url "$CRDB_URL" --execute "
  SELECT type, user_id IS NULL AS null_user, created_at
  FROM audit_events
  WHERE type IN ('REFLECTION_RAN','CLUSTER_HEALTH_CHECK')
  ORDER BY created_at DESC LIMIT 10;"
```
Harapan: ada baris `CLUSTER_HEALTH_CHECK` dengan `null_user=true` (event level cluster),
dan baris `REFLECTION_RAN` per run.

```bash
cockroach sql --url "$CRDB_URL" --execute "
  SELECT kind, COUNT(*) FROM memory_nodes GROUP BY kind;"   # → core / transcript / attachment
cockroach sql --url "$CRDB_URL" --execute "
  SELECT id, kind, title, verified, confidence FROM memory_nodes
  WHERE kind='attachment' ORDER BY last_touched DESC LIMIT 5;"
```

---

## 7. UI Frontend — Verifikasi Manual (fitur pasca-audit)

> Perbaikan 11 gap audit integrasi (`docs/FRONTEND-INTEGRATION-AUDIT.md`) sudah **live** dan
> butuh verifikasi **manusia di browser**. Jalankan frontend: `npm run dev` di root →
> buka `http://localhost:5173` (Vite proxy `/api/v1` → Function URL live). Login dengan
> magic-link (token bebas ≥8 karakter; dev-mode menampilkan preview link).

| # | Fitur | Langkah uji | Harapan |
|---|---|---|---|
| U1 | Chip "Recalled N memories" | Kirim pesan yang memicu retrieval (setelah ada memory `verified=true`) | Balasan asisten menampilkan chip `Recalled N memories` (dari event SSE `injectedMemoryIds`) |
| U2 | Chip judul recall | Lihat balasan yang memicu recall pada U1 | Chip judul memory (teal) muncul di balasan; klik → pindah ke `/memory` |
| U3 | Chat hydrate dari backend | Kirim beberapa pesan → reload halaman → buka sesi aktif | Percakapan lama termuat dari `chat_turns`, **tanpa pesan seed demo** |
| U4 | Galeri attachment | Buka `/memory` → toggle **Graph/Media** | Daftar attachment tampil; tombol hapus → node + S3 terhapus |
| U5 | Analytics di `/metrics` | Buka `/metrics` → section **Analytics** | Kartu funnel / activity (DAU/WAU/MAU) / retention dari API nyata |
| U6 | Passkey sign-in | Setelah pernah passkey sign-in, logout → "Sign in with existing passkey" | Kembali ke profil yang sama (tanpa profil baru) |
| U7 | Session expiry → redirect | (Opsional) set `sessionExpiresAt` ke masa lalu di localStorage → reload | Redirect ke `/auth` + sign-out bersih |
| U8 | AbortController (Stop) | Mulai stream jawaban panjang → klik **Stop** | Stream benar-benar berhenti; tidak ada ghost token |
| U9 | Rate-limit 429 | Burst beberapa chat turn cepat | Pesan rate-limit ramah dengan hint `Retry-After`, bukan error generik |
| U10 | Crisis → audit server | Picu overlay crisis (atau kirim `crisis_triggered`/`crisis_resolved` via `/events`) | `audit_events` berisi `CRISIS_ENGAGED`/`CRISIS_DISMISSED` (cek §6) |
| U11 | Web Vitals | Build dengan `VITE_OTEL_ENABLED=true`, buka app, cek Tempo | Span `web-vitals.<name>` (CLS/LCP/INP/FCP/TTFB) tercatat |

> Verifikasi API untuk fitur yang sama (recall titles di SSE, dll.) tetap via curl di
> §3–§6. UI items U1–U11 memetakan 1:1 ke perbaikan yang di-commit (`158cc2a` s.d.
> `76328ed`).

---

## 8. Checklist hasil

| # | Verifikasi | Command ref | Pass/Fail |
|---|---|---|---|
| 1 | Health ok | §2.1 | ☐ |
| 2 | Auth negatif 401 | §2.2 | ☐ |
| 3 | Presign → uploadUrl | §3.1 | ☐ |
| 4 | S3 PUT 200 (raw media) | §3.2 | ☐ |
| 5 | Create node+attachments+embedding | §3.3 | ☐ |
| 6 | List attachments | §3.4 | ☐ |
| 7 | Delete → S3 object + cascade | §3.5 | ☐ |
| 8 | Semantic search recall attachment | §4.2 | ☐ |
| 9 | Chat turn hybrid RRF (recalled titles) | §4.3 | ☐ |
| 10 | Reflection invoke live (health gate + MCP + completed) | §5 | ☐ |
| 11 | Audit `CLUSTER_HEALTH_CHECK` + `REFLECTION_RAN` di CRDB | §6 | ☐ |
| 12 | `memory_nodes` kind='attachment' ada | §6 | ☐ |

### Checklist UI (fitur pasca-audit)

| # | Verifikasi | Langkah | Pass/Fail |
|---|---|---|---|
| U1 | Chip "Recalled N memories" muncul di balasan | §7 U1 | ☐ |
| U2 | Chip judul recall tampil + navigasi ke `/memory` | §7 U2 | ☐ |
| U3 | Chat restore dari backend (tanpa seed) setelah reload | §7 U3 | ☐ |
| U4 | Galeri attachment list + delete | §7 U4 | ☐ |
| U5 | Analytics (funnel/activity/retention) di `/metrics` | §7 U5 | ☐ |
| U6 | Passkey sign-in balik ke profil sama | §7 U6 | ☐ |
| U7 | Session expiry → redirect `/auth` | §7 U7 | ☐ |
| U8 | Stop benar-benar menghentikan stream | §7 U8 | ☐ |
| U9 | 429 rate-limit UX | §7 U9 | ☐ |
| U10 | Crisis ter-mirror ke `audit_events` | §7 U10 | ☐ |
| U11 | Web Vitals span di Tempo (opsional) | §7 U11 | ☐ |

---

## 9. Catatan & workaround

- **Payload Lambda**: gunakan `--payload fileb://` (file). `--payload '{"..."}'` dan
  `file://` di-mangle CLI v2 (error JSON); `--cli-binary-format raw-in-base64-out` juga gagal.
  Hasil `--log-type Tail` = gzip+base64 → decode dengan python (contoh §5).
- **Presigned PUT**: hanya header `Content-Type` yang perlu dikirim. Jangan tambahkan
  SSE/checksum header — itu bug `SignatureDoesNotMatch` yang sudah diperbaiki (commit `68a6dcb`).
- **Frontend**: fitur on-device (MediaPipe face, prosody DSP, Whisper transcript) butuh
  kamera/mikro di browser; jalankan `npm run dev` di root lalu buka `http://localhost:5173`.
  Untuk verifikasi UI pasca-audit gunakan checklist UI §8-U1..U11. Web Vitals
  (span `web-vitals.*`) hanya aktif bila build frontend memakai `VITE_OTEL_ENABLED=true`
  (default false) — cek Tempo/Grafana untuk span-nya.
- **Cluster health**: ccloud CLI tidak ada di Lambda → REST fallback dipakai
  (`status UNSPECIFIED` pada cluster belum aktif — dianggap sehat, loop lanjut).
