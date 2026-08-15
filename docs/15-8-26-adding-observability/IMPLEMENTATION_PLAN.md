# Implementation Plan — Full-Stack OTel ke Grafana Cloud

> Disusun 2026-08-15 · Blueprint path file nyata + alur propagasi + verifikasi end-to-end. Ini dokumen eksekusi (Step 3–5).

---

## 1. Arsitektur & aliran trace (end-to-end)

```
Browser (src/)
  └─ WebTracerProvider + FetchInstrumentation
       ├─ span "navigation" + span fetch "POST /api/v1/chat/turn"
       ├─ injek header W3C  traceparent: 00-<trace_id>-<span_id>-01
       └─ export span via POST /api/v1/telemetry  (relay, token server-side)
            ↓
Lambda (lambda/)
  ├─ handler.ts: extract traceparent dari event.headers
  │    └─ root span "POST /api/v1/chat/turn"  (parent = span browser)
  │         ├─ child span "agent.memory.retrieve"  (getMemoryContext → CRDB)
  │         ├─ child span "llm.openrouter"         (streamChat → OpenRouter)
  │         └─ child span "db.persist"             (saveChatTurn → CRDB)
  ├─ set response header X-Trace-Id: <trace_id>   (untuk verifikasi)
  └─ OTLP export langsung → Grafana (traces+metrics+logs) + forceFlush
```

**Satu `trace_id`** mengalir dari klik browser → Lambda → CRDB → OpenRouter → kembali.

## 2. Blueprint file (path nyata)

### Frontend
| File | Isi |
|---|---|
| `src/shared/lib/telemetry.ts` | init WebTracerProvider + FetchInstrumentation + W3C propagator + OTLP exporter → `/api/v1/telemetry`. Headers dinamis (Authorization + X-Device-Id) dari `authSession.ts`. |
| `src/main.tsx` | panggil `initTelemetry()` sebelum `createRoot().render()`. |

### Backend
| File | Isi |
|---|---|
| `lambda/lib/telemetry.ts` | init TracerProvider/MeterProvider/LoggerProvider + OTLP exporters (read env `OTEL_*`). Helper `extractTraceparent(headers)`, `startSpan(name, parent)`, `flushTelemetry()`. |
| `lambda/handler.ts` | extract traceparent per request → root span; set `X-Trace-Id` header di semua response; `flushTelemetry()` sebelum return (di akhir catch/try). |
| `lambda/handlers/telemetry.ts` | **relay baru** `POST /api/v1/telemetry`: validasi auth (bearer+device), teruskan raw body+content-type ke `${OTLP_ENDPOINT}/v1/traces` dengan header dari env. |
| `lambda/handlers/chatTurn.ts` | tambah span `agent.memory.retrieve` & `db.persist`. |
| `lambda/lib/openrouter.ts` | tambah span `llm.openrouter` (tokensUsed dari return). |

### On-device agent (frontend)
| File | Isi |
|---|---|
| `src/shared/lib/onDeviceLLM.ts` | bungkus `generateOnDevice` dalam span `agent.ondevice`. |

### Infra
| File | Isi |
|---|---|
| `infra/modules/ssm/main.tf` | + `grafana/otlp-endpoint`, `grafana/otlp-token` (SecureString). |
| `infra/modules/ssm/variables.tf` + `outputs.tf` | wire variabel baru. |
| `infra/variables.tf` + `root.tf` | pass `grafana_otlp_endpoint`, `grafana_otlp_token`. |
| `infra/modules/lambda/main.tf` | read SSM grafana → env `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`. |
| `infra/modules/iam/main.tf` | cek: ssm-read policy sudah `/${environment}/*` → tidak perlu ubah. |
| `scripts/setup-ssm-params.sh` | tambah upload `grafana/otlp-endpoint` (String) + `grafana/otlp-token` (SecureString). |
| `scripts/build-lambda.sh` | tidak berubah (esbuild bundle semua). |

### Verifikasi
| File | Isi |
|---|---|
| `scripts/verify_telemetry.ts` | skrip E2E (lihat §6). |

## 3. Detail implementasi backend — `lambda/lib/telemetry.ts`

```
setupTelemetry():  // dipanggil sekali di module scope handler.ts
  - Resource: service.name=env OTEL_SERVICE_NAME, service.version
  - TracerProvider (BasicTracerProvider) + BatchSpanProcessor(OTLPTraceExporter)
  - MeterProvider + PeriodicExportingMetricReader(OTLPMetricExporter)
  - LoggerProvider + BatchLogRecordProcessor(OTLPLogExporter)
  - set global propagator W3CTraceContextPropagator

extractTraceparent(headers): propagation.extract(ROOT_CONTEXT, headers)
  - pakai W3CTraceContextPropagator.inject/extract

startSpan(name, parent, attrs): tracer.startSpan(name, {attributes}, parent)
  - return { span, ctx }

flushTelemetry(): await tracerProvider.forceFlush() + meterProvider.forceFlush() + loggerProvider.forceFlush()
```

`handler.ts` flow:
1. `const ctx = extractTraceparent(event.headers)` — baca `traceparent`.
2. `const { span, ctx: active } = startSpan("POST " + path, ctx, { http.method, http.route })`.
3. Route handlers dipanggil dengan `trace.setSpan(active, span)` context.
4. Set `span.recordException(err)` + set `http.status_code`.
5. Response headers `X-Trace-Id` = `span.spanContext().traceId`.
6. `await flushTelemetry()` di `finally` sebelum return (jangan tunggu di luar lambda).

## 4. Detail implementasi relay — `lambda/handlers/telemetry.ts`

```
POST /api/v1/telemetry
  1. auth: validateAuth(token, deviceId, crdb) — wajib valid (keputusan user)
  2. baca event.body (string) + isBase64Encoded → Buffer
  3. content-type dari header (application/x-protobuf | application/json)
  4. fetch(`${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`, {
       method POST, headers: { Authorization: OTEL_EXPORTER_OTLP_HEADERS, "Content-Type": content-type },
       body: buffer })
  5. return { statusCode: upstream.status, corsHeaders } — gagal → 502 (bukan crash)
  - Tanpa logging payload (hindari PII)
```

Route di `handler.ts`: `if (method === "POST" && path === "/api/v1/telemetry")` → `handleTelemetryRelay(event, crdb, token, deviceId)` (setelah auth, sebelum routing lain).

## 5. Detail implementasi frontend — `src/shared/lib/telemetry.ts`

```
initTelemetry():
  if (!import.meta.env.VITE_OTEL_ENABLED) return
  - WebTracerProvider({ resource, sampler: parentbased(ratio) })
  - FetchInstrumentation({ propagateTraceHeaderCorsUrls: [location.origin + "*"] })
  - OTLPTraceExporter({ url: resolve(location.origin, VITE_OTEL_TRACE_ENDPOINT),
      headers: () => getAuthHeaders() → { Authorization, "X-Device-Id" } })
  - context.setGlobalPropagator(new W3CTraceContextPropagator())
  - provider.register()

export { getTracer, withSpan }  // dipakai onDeviceLLM.ts untuk span agent.ondevice
```

> CORS: relay hanya menerima POST; `Access-Control-Allow-Headers` di corsHeaders() harus menyertakan `traceparent`? Tidak wajib — header dikirim dari browser ke same-origin (atau via Vite proxy). Untuk cross-origin Lambda URL, tambahkan `traceparent` ke allow-headers di `corsHeaders()`.

## 6. Verifikasi E2E — `scripts/verify_telemetry.ts`

Run: `npx tsx scripts/verify_telemetry.ts`

```
1. README env: BACKEND_URL, GRAFANA_TEMPO_URL, GRAFANA_INSTANCE_ID, GRAFANA_OTLP_TOKEN
2. Mint session: POST {BACKEND_URL}/api/v1/auth/magic-link + /auth/callback → token (atau legacy token dummy ≥8 char + deviceId)
3. Generate W3C traceparent: `00-${traceId32hex}-${spanId16hex}-01`
4. POST {BACKEND_URL}/api/v1/chat/turn  dengan header:
     Authorization: Bearer <token>, X-Device-Id: <deviceId>, traceparent: <tp>
   → baca response header X-Trace-Id
   ASSERT: X-Trace-Id === traceId   (bukti #1 frontend kirim traceparent, #2 backend terima context)
5. Agent child spans: chatTurn pasti mengeksekusi getMemoryContext (tool DB) + saveChatTurn.
   Query Tempo: GET {GRAFANA_TEMPO_URL}/api/traces/{traceId} (Basic instance:token)
   ASSERT: span "agent.memory.retrieve" dan "llm.openrouter" ada   (bukti #3)
6. OTLP exporter OK: log backend "OTLP export 200/OK"  → tampilkan status
   (bukti #4: exporter return HTTP 200 dari Grafana Cloud)
7. Print PASS/FAIL per langkah; exit code non-zero jika gagal
```

Fallback jika host Tempo prod tidak sesuai: gunakan `https://tempo-prod-ap-southeast-2.grafana.net` (dicoba dulu) → jika 404/401, cek `/api/otlp` atau pakai endpoint stack. Bagian yang dijamin pass: round-trip `X-Trace-Id` + status eksport 200 di log.

## 7. Urutan eksekusi

1. Tulis docs ini (selesai).
2. Install deps frontend (`npm i` root) + backend (`npm i` di `lambda/`).
3. Implement `src/shared/lib/telemetry.ts` + mount di `main.tsx` + span on-device.
4. Implement `lambda/lib/telemetry.ts`, `lambda/handlers/telemetry.ts`, wire `handler.ts`, spans chatTurn + openrouter.
5. Infra: SSM module + variables + root + lambda env + setup-ssm-params.sh.
6. `bash scripts/setup-ssm-params.sh` (upload grafana params) → `bash scripts/build-lambda.sh` → `terraform apply`.
7. `npx tsx scripts/verify_telemetry.ts`.
8. Update PROGRESS.md / AUDIT.md status.

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| OTLP exporter menambah latency Lambda (cold start/forceFlush) | Batch processor; hanya flush di akhir; timeout flush < Lambda timeout (29s). |
| Token bocor di bundle | Token hanya di env Lambda/SSM; frontend relay tanpa token. |
| CORS relay cross-origin | Gunakan Vite proxy di dev; di prod frontend di-serve same-origin dengan `/api/v1`. Tambah `traceparent` ke allow-headers. |
| Tempo API host berubah | Deteksi otomatis di skrip verifikasi; fallback log-status. |
| Perf overhead browser (Zone.js) | FetchInstrumentation saja (tanpa XHR) — minimal. |
| Cardinality metrics membesar | Hanya counter/histogram tanpa label per-user. |
