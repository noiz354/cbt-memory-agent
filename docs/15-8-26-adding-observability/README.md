# Adding Observability — Rencana Full-Stack OpenTelemetry → Grafana Cloud

> Disusun: 2026-08-15 · Stack nyata: React+Vite TS (`src/`) · Lambda Node 22 TS (`lambda/`) · Terraform+SSM (`infra/`) · Grafana Cloud OTLP (stack 1494299, ap-southeast-2).
> Mengikuti alur kerja skill **Define → Plan → Build → Verify → Review → Ship** (lihat `../15-8-26/ADDY-OSMANI-SKILLS.md`).
> **STATUS: ✅ IMPLEMENTED + DEPLOYED + VERIFIED 2026-08-15** (liat Status di bawah).

## Status — Hasil verifikasi E2E (live)

`npx tsx scripts/verify_telemetry.ts` → **SEMUA PASS** pada URL live:

| Bukti | Hasil |
|---|---|
| X-Trace-Id roundtrip (W3C traceparent browser→backend) | ✅ PASS |
| Respons chat valid (SSE [DONE] + konten) | ✅ PASS |
| Spans agent di Tempo: `agent.memory.retrieve`, `llm.openrouter`, `db.persist`, root `POST /api/v1/chat/turn` | ✅ PASS |

Grafana query API yang berhasil: `https://tempo-prod-23-prod-ap-southeast-2.grafana.net/tempo` (user 1446402 + read-only token `glc_...-ht-read-tempo-key...`).

Perbaikan penting selama implementasi:
- Header `.env`/`terraform.tfvars` di-recompute — versi lama meng-encode token usang (`LW92bHAt`), versi benar = base64 dari `GRAFANA_OTLP_TOKEN` saat ini (`LW90bHAt`). Probe OTLP (span `probe.health`) dipakai untuk memvalidasi kredensial sebelum deploy.
- `lambda/lib/telemetry.ts` `startSpan()` harus meneruskan `parentCtx` sebagai argumen ke-3 `tracer.startSpan(name, opts, parentCtx)` — tanpa ini, setiap span menjadi root trace baru (bug awal: X-Trace-Id tidak match, diperbaiki lalu diverifikasi ulang).
- Relay `parseKeyValueHeaders()` mem-parse env `OTEL_EXPORTER_OTLP_HEADERS` (format `key=value`) → header `Authorization` yang benar (nilai bisa mengandung `=`).

## Goal

Implementasi instrumentasi OpenTelemetry penuh di 3 lapisan — **Frontend**, **Backend**, **AI Agent** — mengekspor traces, logs, dan metrics ke Grafana Cloud OTLP Gateway (Tempo, Loki, Mimir/Prometheus). Satu `trace_id` mengalir dari klik browser sampai respons LLM.

## Dokumen rencana

| Doc | Step | Content |
|---|---|---|
| [`FREE_TIER_RESEARCH.md`](./FREE_TIER_RESEARCH.md) | 1 | Audit free tier: Grafana Cloud OTLP, AWS ap-southeast-3, Cloudflare. Hard limits + cost guardrails. |
| [`TELEMETRY_STACK.md`](./TELEMETRY_STACK.md) | 2 | SDK & package OTel per lapisan, spesifikasi env var, pemilihan tooling. |
| [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) | 3-5 | Blueprint path file, alur propagasi W3C trace context, kode link Frontend→Backend→Agent→LLM, skrip verifikasi end-to-end. |

## Pemetaan skill (ADDY-OSMANI-SKILLS.md)

| Fase | Skill | Penerapan di rencana ini |
|---|---|---|
| Define | **spec-driven-development** | Spesifikasi 3 sinyal (traces/logs/metrics) + kontrak header `traceparent` di `IMPLEMENTATION_PLAN.md`. |
| Plan | **planning-and-task-breakdown** | Urutan eksekusi 8 langkah di `IMPLEMENTATION_PLAN.md` §7. |
| Build | **source-driven-development** | OTel SDK versi & API divalidasi dari dokumen resmi (env vars `OTEL_*`, endpoint `/v1/traces`,`/v1/metrics`,`/v1/logs`). |
| Build | **api-and-interface-design** | Endpoint relay baru `POST /api/v1/telemetry` — kontrak: raw body passthrough, auth bearer + device. |
| Verify | **test-driven-development** | `scripts/verify_telemetry.ts` membuktikan 4 kriteria sebelum dianggap selesai. |
| Review | **code-review-and-quality** | Review multi-axis setelah implementasi (keamanan token, cardinality, perf overhead). |
| Review | **security-and-hardening** | Token Grafana TIDAK pernah di bundle browser — relay server-side. |
| Ship | **observability-and-instrumentation** | Instrumentasi 3 layer + bukti produksi via verifikasi. |
| Ship | **git-workflow-and-versioning** | Commit per lapisan, konvensi Conventional Commits. |

## Keputusan kunci (disetujui user 2026-08-15)

1. **Frontend export path:** Relay via Lambda `POST /api/v1/telemetry` (token tetap server-side) — bukan OTLP langsung dari browser.
2. **Scope:** Implement semua + deploy ke live (terraform apply + verifikasi terhadap URL live).
3. **Relay auth:** Wajib bearer token device (`Authorization` + `X-Device-Id`) — konsisten dengan endpoint lain.

## Credentials

Disimpan di `.env` (git-ignored): `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, `GRAFANA_OTLP_TOKEN`, `OTEL_EXPORTER_OTLP_HEADERS`, `GRAFANA_TEMPO_URL`, `GRAFANA_TEMPO_USER`, `GRAFANA_TEMPO_TOKEN`, `GRAFANA_OTLP_PRIVATELINK_*`. Untuk Lambda: lewat SSM `/hackathon/grafana/*` → env Terraform.

## Live stack

- Backend live: `https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws`
- Grafana Cloud: `https://otlp-gateway-prod-ap-southeast-2.grafana.net/otlp` (instance 1494299)
- PrivateLink (VPC): `com.amazonaws.vpce.ap-southeast-3.vpce-svc-05fcb4d8387c35c07` → `prod-ap-southeast-2-otlp-gateway.ap-southeast-3.vpce.grafana.net` (AZ apse3-az1, apse3-az3)
