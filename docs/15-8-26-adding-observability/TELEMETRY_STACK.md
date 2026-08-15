# Telemetry Stack — Dependencies & Env Spec

> Disusun 2026-08-15 · Adapted ke stack nyata (React+Vite TS + Lambda Node 22 TS). Path user-asli (Python FastAPI) TIDAK dipakai karena repo adalah TypeScript.

---

## 1. Frontend (`src/`) — Browser OTel SDK

### Dependencies (tambah ke `package.json` root)

| Package | Versi | Fungsi |
|---|---|---|
| `@opentelemetry/api` | ^1.9 | API tracing (tracer, context, propagation) |
| `@opentelemetry/sdk-trace-web` | ^1.25 | WebTracerProvider (browser) |
| `@opentelemetry/exporter-trace-otlp-http` | ^0.52 | Exporter OTLP/HTTP (protobuf) |
| `@opentelemetry/instrumentation-fetch` | ^0.52 | Auto-instrument fetch: buat span + injek `traceparent` |
| `@opentelemetry/context-zone-peer-dep` | ^1.25 | Propagasi context async via Zone.js |
| `@opentelemetry/w3c-trace-context-propagator` | ^1.25 | Propagator W3C `traceparent` |

> Catatan: `zone.js` ikut sebagai peer dep dari context-zone-peer-dep. Versi dibawah disesuaikan saat install (pastikan kompatibel dengan OTel v1.25/v0.52 line).

### Env spec frontend (`.env`, bukan hardcode)

```
VITE_OTEL_ENABLED=true
VITE_OTEL_SERVICE_NAME=cbt-memory-agent-frontend
VITE_OTEL_TRACE_ENDPOINT=/api/v1/telemetry   # relative → di-resolve ke location.origin
VITE_OTEL_SAMPLING_RATIO=0.1                 # default 10% (hackathon bisa 1.0 via local env)
```

Token Grafana **TIDAK pernah** masuk env frontend.

## 2. Backend (`lambda/`) — OTel SDK Node + Exporter

### Dependencies (tambah ke `lambda/package.json`)

| Package | Fungsi |
|---|---|
| `@opentelemetry/api` | API tracing |
| `@opentelemetry/sdk-trace-base` | BasicTracerProvider (manual spans — cocok Lambda) |
| `@opentelemetry/exporter-trace-otlp-http` | Export traces → `${ENDPOINT}/v1/traces` |
| `@opentelemetry/sdk-metrics` | MeterProvider |
| `@opentelemetry/exporter-metrics-otlp-http` | Export metrics → `${ENDPOINT}/v1/metrics` |
| `@opentelemetry/sdk-logs` | LoggerProvider |
| `@opentelemetry/exporter-logs-otlp-http` | Export logs → `${ENDPOINT}/v1/logs` |
| `@opentelemetry/resources` | Resource attrs (service.name, service.version) |
| `@opentelemetry/semantic-conventions` | Constant nama atribut (gen_ai.*, http.*) |

> **Catatan deploy:** Lambda dibundle esbuild (`scripts/build-lambda.sh`) → semua OTel di-bundle ke `dist/index.js` (CJS). Tidak pakai Lambda Layer / `@opentelemetry/auto-instrumentations-node` agar bundle terkontrol & cold start minimal.

### Env spec backend (dari SSM → env Lambda)

```
OTEL_SERVICE_NAME=cbt-memory-agent-backend
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-ap-southeast-2.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instance_id:token)>
OTEL_TRACES_SAMPLER=parentbased_always_on   # hackathon: selalu sampel; ganti ratio utk prod
```

SSM baru (SecureString):
```
/hackathon/grafana/otlp-endpoint
/hackathon/grafana/otlp-token
```

## 3. AI Agent — manual spans (tanpa wrapper eksternal)

Agent di repo ini adalah orkestrasi sederhana di `lambda/handlers/chatTurn.ts` + `lambda/lib/openrouter.ts`. Tidak ada LangChain/LlamaIndex. Jadi tidak perlu package wrapper LLM — gunakan manual spans:

| Span | Lokasi | Atribut |
|---|---|---|
| `agent.memory.retrieve` | `chatTurn.ts` getMemoryContext | `db.system=postgres`, `db.operation=SELECT` |
| `llm.openrouter` | `openrouter.ts` streamChat | `gen_ai.provider=openrouter`, `gen_ai.request.model`, `gen_ai.usage.output_tokens`, `gen_ai.usage.input_tokens` |
| `db.persist` | `chatTurn.ts` saveChatTurn | `db.operation=INSERT` |
| `agent.ondevice` | `src/shared/lib/onDeviceLLM.ts` | `gen_ai.provider=webllm`, `gen_ai.request.model` |

## 4. Signal mapping → endpoint OTLP

| Signal | Endpoint (suffix dari `OTEL_EXPORTER_OTLP_ENDPOINT`) |
|---|---|
| Traces | `POST /v1/traces` |
| Metrics | `POST /v1/metrics` |
| Logs | `POST /v1/logs` |
| Browser (via relay) | `POST /api/v1/telemetry` → backend teruskan ke `/v1/traces` |

## 5. Protokol & header

- `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` — body protobuf, content-type `application/x-protobuf`.
- Header auth: `Authorization: Basic <base64>` di mana `<base64>` = `base64("<instance_id>:<token>")`.
- Content-type dikirim ulang apa adanya oleh relay (passthrough).

## 6. Versioning check

Versi di atas adalah line yang divalidasi dari dokumen OTel (v1.25 SDK / v0.52 exporters). Saat implementasi, cek versi terbaru di npm (`npm info @opentelemetry/exporter-trace-otlp-http version`) dan gunakan yang kompatibel satu sama lain (SDK & exporter harus line yang sama, mis. 0.52.x / 1.25.x).
