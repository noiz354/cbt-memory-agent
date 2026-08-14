# Manual Testing — CBT Memory Agent (Backend API)

Panduan pengetesan manual seluruh endpoint backend via `curl` ke Lambda Function URL.
Update: 2026-08-14.

## Prasyarat

```bash
BASE="https://armepcglafkj763liezd75etlm0sqals.lambda-url.us-east-1.on.aws"
TOKEN="test-user"          # bebas, non-empty. Backend memetakan user via md5(TOKEN)::uuid
DEVICE="device_test"       # bebas, non-empty (X-Device-Id)

AUTH=(-H "Authorization: Bearer $TOKEN" -H "X-Device-Id: $DEVICE")
JSON=(-H "Content-Type: application/json")
```

Catatan penting:
- Semua endpoint WAJIB auth (`Authorization` + `X-Device-Id`) **kecuali** `/api/v1/health`.
- `Authorization` berisi token apa pun yang non-empty (middleware belum validasi ke CRDB — TODO).
- Token sama → `user_id` yang sama di CRDB (`md5(token)::uuid`).
- **Known issue**: akses publik Function URL sempat `403 AccessDeniedException` walau policy `authorization_type="NONE"`. Jika Langkah 0 masih 403, fallback ke `aws lambda invoke` (contoh di tiap bagian).

## Ringkasan endpoint

| # | Endpoint | Method | Status implementasi | Harapan |
|---|----------|--------|---------------------|---------|
| 0 | `/api/v1/health` | GET | REAL | `ok/connected/available` |
| 1 | `/api/v1/chat/turn` | POST | REAL (SSE) | stream `data: {t:"…"}` + `[DONE]` |
| 2 | `/api/v1/memory` | GET | STUB | `{"v":1,"nodes":[],"edges":[]}` |
| 3 | `/api/v1/memory` | POST | STUB | `{"v":1,"ok":true,"id":"mem_new"}` |
| 4 | `/api/v1/memory/:id` | DELETE | STUB | `{"v":1,"ok":true,"deletedId":"mem_x"}` |
| 5 | `/api/v1/memory/semantic` | GET | REAL | `{"v":1,"results":[]}` (kosong jika belum ada embedding) |
| 6 | `/api/v1/session` | POST | STUB | `{"v":1,"ok":true,"id":"ses_new"}` |
| 7 | `/api/v1/sessions` | GET | STUB | `{"v":1,"sessions":[]}` |
| 8 | `/api/v1/export` | POST | STUB | v2 + fake `s3Url` |
| 9 | `/api/v1/purge` | POST | STUB | `{"v":1,"ok":true,"deletedRows":0}` |
| 10 | `/api/v1/metrics` | GET | STUB | `{"v":2,"metrics":[],"northStar":{},"guardrails":{}}` |

---

## Langkah 0 — Verifikasi akses publik + health

```bash
curl -i "$BASE/api/v1/health"
```

Harapan: `HTTP/1.1 200` dengan body
`{"status":"ok","crdb":"connected","llm":"available","s3":"available","version":"0.1.0"}`.

- Jika **200** → lanjut ke Langkah 1 (curl publik berfungsi).
- Jika **403** → akses publik masih diblokir di service layer; gunakan fallback `aws lambda invoke`:

```bash
export PATH="$HOME/bin:$PATH"
export AWS_PROFILE=aws-x-cdb
source scripts/aws-export-creds.sh >/dev/null 2>&1

aws lambda invoke \
  --function-name cbt-memory-agent \
  --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","path":"/api/v1/health"}' \
  /tmp/health_manual.json >/dev/null 2>&1
python3 -c "import json; print(json.load(open('/tmp/health_manual.json')).get('body',''))"
```

---

## Langkah 1 — Auth negatif (401)

```bash
# Tanpa header auth sama sekali → 401 "Missing Authorization header"
curl -i "$BASE/api/v1/metrics"

# Dengan token tapi tanpa X-Device-Id → 401 "Missing X-Device-Id"
curl -i -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/metrics"
```

Harapan: `HTTP/1.1 401` + `{"error":"Missing …"}`.

> Fallback invoke: tambahkan `"headers":{}` atau `"headers":{"Authorization":"Bearer x"}` pada payload, lalu lihat statusCode.

---

## Langkah 2 — Chat turn (SSE, fitur utama)

```bash
curl -N -i "$BASE/api/v1/chat/turn" "${AUTH[@]}" "${JSON[@]}" -d '{
  "v": 1,
  "sessionId": "ses_test2",
  "userMessage": "Halo, akhir-akhir ini aku sering merasa cemas sebelum tidur.",
  "clientTs": "2026-08-14T14:00:00.000Z",
  "deviceOnly": true
}'
```

Harapan:
- Header `Content-Type: text/event-stream`.
- Serangkaian `data: {"t":"<baris respons>"}` (SSE, per baris) lalu `data: [DONE]`.
- Respons CBT (teknik reframing/behavioral activation + satu pertanyaan penutup).

Verifikasi data tersimpan di CockroachDB:

```bash
# via psql (conn string di .env) — CRDB_HOST/DATABASE/USERNAME dari .env
export PATH="$HOME/bin:$PATH"
source scripts/aws-export-creds.sh >/dev/null 2>&1
CRDB_CONNECTION_URL="$(grep CRDB_CONNECTION_URL .env | cut -d= -f2-)"

# Contoh (psql bawaan Cockroach):
cockroach sql --url "$CRDB_CONNECTION_URL" --execute "
  SELECT role, LEFT(content, 40) AS preview, tokens_used
  FROM chat_turns WHERE session_id = 'ses_test2';"

# Harapan: 2 row — role 'user' (tokens 0) + role 'assistant' (tokensUsed > 0)
```

---

## Langkah 3 — Memory list (stub)

```bash
curl -i "$BASE/api/v1/memory" "${AUTH[@]}"
```

Harapan: 200 `{"v":1,"nodes":[],"edges":[]}` (stub — belum query CRDB).

---

## Langkah 4 — Memory upsert (stub)

```bash
curl -i "$BASE/api/v1/memory" "${AUTH[@]}" "${JSON[@]}" -d '{
  "v": 1,
  "action": "upsert",
  "node": {
    "id": "mem_test1",
    "kind": "core",
    "title": "Cemas sebelum tidur",
    "excerpt": "Pengguna merasa cemas saat menjelang tidur.",
    "tags": ["cemas", "tidur"],
    "weight": 5,
    "confidence": 0.8,
    "verified": true,
    "x": 0,
    "y": 0
  }
}'
```

Harapan: 200 `{"v":1,"ok":true,"id":"mem_new"}` (stub — ID dummy, belum insert ke `memory_nodes`).

---

## Langkah 5 — Memory delete (stub)

```bash
curl -i -X DELETE "$BASE/api/v1/memory/mem_x" "${AUTH[@]}"
```

Harapan: 200 `{"v":1,"ok":true,"deletedId":"mem_x"}` (stub).

---

## Langkah 6 — Semantic search (REAL, vector)

```bash
curl -i "$BASE/api/v1/memory/semantic?q=cemas&limit=5&minConfidence=0.6" "${AUTH[@]}"
```

Harapan: 200 `{"v":1,"results":[]}` — query embedding (bge-m3) jalan, kosong karena
`memory_nodes`/`embeddings` belum diisi (`handleUpsertMemory` masih stub).

> Fallback invoke:
> ```bash
> aws lambda invoke --function-name cbt-memory-agent --region us-east-1 \
>   --cli-binary-format raw-in-base64-out \
>   --payload '{"httpMethod":"GET","path":"/api/v1/memory/semantic","queryStringParameters":{"q":"cemas","limit":"5","minConfidence":"0.6"}}' \
>   /tmp/semantic_manual.json >/dev/null 2>&1
> python3 -c "import json; d=json.load(open('/tmp/semantic_manual.json')); print(d.get('statusCode'), d.get('body',''))"
> ```

---

## Langkah 7 — Save session (stub)

```bash
curl -i "$BASE/api/v1/session" "${AUTH[@]}" "${JSON[@]}" -d '{
  "v": 1,
  "session": {
    "id": "ses_test2",
    "title": "Sesi malam",
    "status": "pending",
    "mood": 3,
    "moodLabel": "cemas",
    "startedAt": "2026-08-14T14:00:00.000Z",
    "durationMin": 10,
    "excerpt": ""
  }
}'
```

Harapan: 200 `{"v":1,"ok":true,"id":"ses_new"}` (stub).

---

## Langkah 8 — List sessions (stub)

```bash
curl -i "$BASE/api/v1/sessions?status=all&query=" "${AUTH[@]}"
```

Harapan: 200 `{"v":1,"sessions":[]}` (stub — meski `chat/turn` sudah membuat row `sessions`).

---

## Langkah 9 — Export (stub)

```bash
curl -i "$BASE/api/v1/export" "${AUTH[@]}" "${JSON[@]}" -d '{
  "v": 1,
  "kinds": ["chat_turns", "memory", "sessions"]
}'
```

Harapan: 200 `{"v":2,"exportedAt":"…","s3Url":"https://s3.amazonaws.com/...","expiresAt":"…"}`
(stub — URL S3 dummy, belum upload).

---

## Langkah 10 — Purge (stub)

```bash
curl -i "$BASE/api/v1/purge" "${AUTH[@]}" "${JSON[@]}" -d '{
  "v": 1,
  "confirmation": "PURGE ALL MY DATA"
}'
```

Harapan: 200 `{"v":1,"ok":true,"deletedRows":0}` (stub — belum hard delete).

---

## Langkah 11 — Metrics (stub)

```bash
curl -i "$BASE/api/v1/metrics" "${AUTH[@]}"
```

Harapan: 200 `{"v":2,"metrics":[],"northStar":{},"guardrails":{}}` (stub).

---

## Checklist hasil

| Langkah | Fitur | Pass/Fail | Catatan |
|---------|-------|-----------|---------|
| 0 | health publik | | |
| 1 | auth 401 (no token / no device) | | |
| 2 | chat/turn SSE + row CRDB | | |
| 3 | memory list (stub) | | |
| 4 | memory upsert (stub) | | |
| 5 | memory delete (stub) | | |
| 6 | semantic search (kosong) | | |
| 7 | session save (stub) | | |
| 8 | sessions list (stub) | | |
| 9 | export (stub) | | |
| 10 | purge (stub) | | |
| 11 | metrics (stub) | | |

## Yang masih TODO (agar hasil "real")

- `handleUpsertMemory` — insert `memory_nodes` + `embeddings` (biar semantic punya data).
- `handleSaveSession` / `handleListSessions` — query CRDB `sessions`.
- `handleExport` — bundel + upload S3 + presigned URL.
- `handlePurge` — hard delete per user.
- `handleMetrics` — agregasi dari `audit_events`.
- Validasi token ke tabel `users` di middleware auth.
- Investigasi 403 publik Function URL (jika belum teratasi).
