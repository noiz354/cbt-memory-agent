# Arize Phoenix — LLM Observability

Dual-sink untuk trace LLM: **Grafana Tempo** (ops umum) + **Arize Phoenix** (spesialisasi LLM — render prompt/response, token usage, latency per-span).

## Kenapa Phoenix

- Prompt/response asli (OpenInference) untuk debugging perilaku model.
- Panel khusus UX troubleshooting LLM (input/output, token, angka 401/429) jauh lebih cepat daripada menggali Tempo.
- Self-hosted di EC2 sendiri (tanpa data bayar-sewa observability tambahan).

## Arsitektur

```
Lambda (OTel SDK)
  ├─ BatchSpanProcessor #1 → Grafana Cloud OTLP gateway  (HTTP/JSON)
  │      └─ StrippingExporter wrapper: atribut payload LLM
  │         (gen_ai.request.*, gen_ai.response.*, input.value,
  │          output.value, llm.*_messages) DI-STRIP → Tempo
  │         tetap menerima span tanpa prompt (governance).
  ├─ BatchSpanProcessor #2 → Phoenix OTLP/HTTP :6006/v1/traces
  │      └─ @opentelemetry/exporter-trace-otlp-proto (PROTOBUF —
  │         Phoenix menolak OTLP JSON dengan HTTP 415).
  └─ resource: service.name = cbt-memory-agent-backend
```

Atribut OpenInference ditambahkan di jalur LLM:

| Lokasi | Span | Atribut payload |
|---|---|---|
| `lambda/lib/openrouter.ts` `chat()` | `llm.openrouter` | `openinference.span.kind=LLM`, `gen_ai.request.input`, `gen_ai.response.text` |
| `lambda/lib/openrouter.ts` `generateEmbedding()` | `llm.embedding` | `openinference.span.kind=EMBEDDING`, `input.value` |
| `lambda/handlers/chatTurn.ts` (streaming) | `llm.openrouter` | `openinference.span.kind=LLM`, `gen_ai.request.input`, `gen_ai.response.text` |

Sanitizer (`lambda/lib/telemetry.ts` `sanitizeAttributes`): atribut payload LLM diizinkan sampai 32 KB (bukan 512 B); tetap ada redaksi UUID + denylist secret/PII.

## Konfigurasi

- `PHOENIX_OTLP_ENDPOINT` = `http://<ec2-ip>:6006` (port UI sekaligus OTLP/HTTP; tidak perlu 4318).
- `PHOENIX_OTLP_HEADERS` = `Authorization=Bearer <system-api-key>` (WAJIB; `PHOENIX_ENABLE_AUTH=true` di EC2).
- Rantai: `.env`/`terraform.tfvars` (git-ignored) → `infra/variables.tf` → SSM `/hackathon/phoenix/otlp-endpoint` (String) + `/hackathon/phoenix/otlp-headers` (SecureString) → env Lambda. GH Actions lewat secrets `PHOENIX_OTLP_ENDPOINT`/`PHOENIX_OTLP_HEADERS` (`deploy.yml` TF_VAR).
- Endpoint kosong = Phoenix dinonaktifkan (SSM param tidak dibuat; env lambda kosong).

## Verifikasi

1. Panggil 1x chat/embedding (mis. `curl https://d2sbinyjz34sz4.cloudfront.net/api/v1/health` → pastikan degraded karena `llm.quota_exhausted`, lalu kirim turn chat).
2. Buka `http://<ec2-ip>:6006` (login: `admin` / password awal di instance user-data), cek project `cbt-memory-agent-backend` → span `llm.openrouter` / `llm.embedding` punya input/output value + token usage.
3. Grafana: query Tempo `{resource.service.name="cbt-memory-agent-backend"}` → span SAMA hadir TAPI tanpa atribut prompt/response (stripper bekerja).

### Hasil verifikasi E2E (2026-08-18)

Sudah terbukti di produksi: trace chat turn `a3f02149...` / `6722800013e29c...` (04:13–04:14Z) masuk ke **kedua sink dengan trace_id yang sama**. Detail garis besar trace: `POST /api/v1/chat/turn` → `llm.openrouter` ×2 + `llm.embedding` ×2 + `agent.memory.retrieve` ×2 + `db.query` ×34.

- **Phoenix** (`/v1/projects/default/spans?name=llm.openrouter`): `span_kind=LLM`, atribut `gen_ai.request.input` = prompt system+user **lengkap**, `gen_ai.request.model=openrouter/free`.
- **Tempo** (trace yang sama via `/api/traces/{trace_id}`): span `llm.openrouter` hanya berisi `gen_ai.operation.name=chat` + `openinference.span.kind=LLM` → **atribut prompt/response/usage ter-strip**; governance tidak bocorkan prompt ke dashboard perusahaan.

Karena kuota LLM (OpenRouter free tier) sedang habis (`llm.quota_exhausted`), response text/token usage tidak ada pada span uji; begitu credit ditambah, `gen_ai.response.text` + `gen_ai.usage.*` ikut muncul (stripper tetap membuangnya dari jalur Tempo).

### Temuan & catatan perbaikan (2026-08-18)

- Setelah dual-sink pertama (`2840cb6`), **Tempo sempat kosong total**: `StrippingExporter` menyalin span via *object spread* `{...span}` yang membuang `SpanImpl.prototype` (method/getter `spanContext()`, `duration` ada di prototype, bukan properti own) → transformator OTLP memanggil `span.spanContext()` → `TypeError` sinkron di dalam `exporter.export` → `BatchSpanProcessor` membuang batch tanpa log. Sink Phoenix tetap jalan karena menerima objek span asli (tanpa wrapper).
- Perbaikan di `afe932b`: klon dengan `Object.assign(Object.create(Object.getPrototypeOf(span)), span, { attributes })` — prototipe tersimpan, metode/getter masih hidup, `attributes` diganti versi ter-strip. Ditambah 3 regression test (prototipe hidup di ekspor, payload ter-strip, span sumber tidak termutasi sehingga jalur Phoenix utuh). Test **181/181** ✓, CI green (#32098015898).
- Gejala khas jika sink gagal diam-diam lagi: health/db traces terakhir di Tempo berhenti pada waktu deploy, tapi Phoenix terus menerima span. Cek log lambda untuk baris `[otel] telemetry enabled → grafana=on/off`.

## Lifecycle EC2 (dari user-data)

- Auto-stop tiap **23:00 Asia/Jakarta** (docker stop phoenix + shutdown).
- Auto-terminate mulai **2026-08-23** via `/usr/local/bin/phoenix-terminate-check.sh` (cron @reboot/21:10/22:50) — instance tidak akan bertahan (budget hackathon).
- IP publik **ephemeral** (no EIP): jika instance di-restart → IP baru → **wajib update** `PHOENIX_OTLP_ENDPOINT` + secret GH + tfvars + re-deploy, kalau tidak trace gagal (zombie).
- Biaya: t3.large ~ USD 0.10/jam; diset auto-stop agar tidak jalan semalaman.

## Off / rollback

- Set `phoenix_otlp_endpoint = ""` di tfvars (atau kosongkan secret GH) → SSM params di-destroy, env Lambda kosong, kode tetap jalan seperti sebelum Phoenix (telemetry Grafana tak terganggu).