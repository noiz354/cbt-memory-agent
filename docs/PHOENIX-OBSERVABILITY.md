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

## Lifecycle EC2 (dari user-data)

- Auto-stop tiap **23:00 Asia/Jakarta** (docker stop phoenix + shutdown).
- Auto-terminate mulai **2026-08-23** via `/usr/local/bin/phoenix-terminate-check.sh` (cron @reboot/21:10/22:50) — instance tidak akan bertahan (budget hackathon).
- IP publik **ephemeral** (no EIP): jika instance di-restart → IP baru → **wajib update** `PHOENIX_OTLP_ENDPOINT` + secret GH + tfvars + re-deploy, kalau tidak trace gagal (zombie).
- Biaya: t3.large ~ USD 0.10/jam; diset auto-stop agar tidak jalan semalaman.

## Off / rollback

- Set `phoenix_otlp_endpoint = ""` di tfvars (atau kosongkan secret GH) → SSM params di-destroy, env Lambda kosong, kode tetap jalan seperti sebelum Phoenix (telemetry Grafana tak terganggu).