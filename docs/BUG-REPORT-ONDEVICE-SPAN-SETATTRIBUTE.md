# Bug Report — `span.setAttribute is not a function` on on-device LLM path

- **Tanggal**: 2026-08-16
- **Severity**: Medium (on-device WebLLM path always fails under default config; silently falls back to backend)
- **Status**: Fixed (`telemetry.ts` `withSpan`)

## Console transcript

```
[LLM] On-device failed, trying backend: Error: On-device LLM unavailable: span.setAttribute is not a function
    at callOnDeviceLLM (llmClient.ts:207:11)
overrideMethod @ installHook.js:1
(anonymous) @ llmClient.ts:152
```

## Root cause

`withSpan()` in `src/shared/lib/telemetry.ts:108` has a disabled-telemetry branch:

```ts
if (!tracerProvider) return fn(trace.getSpan(context.active()) ?? ({} as Span));
```

When telemetry is off (`VITE_OTEL_ENABLED !== "true"`), `tracerProvider` is `null` and **no context manager is registered**, so `trace.getSpan(context.active())` returns `undefined`. The fallback `{} as Span` is an empty object with **no `setAttribute` method**.

`generateOnDevice()` (`src/shared/lib/onDeviceLLM.ts:72-74`) then calls `span.setAttribute("gen_ai.provider", "webllm")` on that object → `TypeError`. The error is wrapped by `callOnDeviceLLM` (`src/shared/lib/llmClient.ts:207`) into `On-device LLM unavailable: span.setAttribute is not a function` and logged at `llmClient.ts:152`.

### Why it is the default path

Local `.env` does not define `VITE_OTEL_ENABLED`; `.env.example` documents the default `VITE_OTEL_ENABLED=false`. So in the default dev/prod config the on-device path **always** throws here, before WebLLM is even initialized.

### Call chain

```
withSpan("agent.ondevice", ...)              telemetry.ts:108  → passes {} as Span
  generateOnDevice(...)                      onDeviceLLM.ts:69
    span.setAttribute(...)                   onDeviceLLM.ts:72 → TypeError
  callOnDeviceLLM(...)                       llmClient.ts:179 → wraps message
console.warn("[LLM] On-device failed...")    llmClient.ts:152
```

## Impact

- On-device (private-by-design, WebLLM) inference never starts under the default config.
- The fail-closed fallback chain (backend proxy → BYOK) still answers, masking the bug.
- If the backend and BYOK are both unavailable, the user sees `LLM unavailable` even though on-device could have worked.

## Fix (applied)

`src/shared/lib/telemetry.ts` — remove the `{} as Span` special case. Always create the span via the tracer. When no provider is registered, `trace.getTracer()` → `ProxyTracer` → `NoopTracer.startSpan()` returns a real `NonRecordingSpan` whose `Span` methods are safe no-ops (verified in `@opentelemetry/api` `NoopTracer.js:15-26`, `NonRecordingSpan.js`). `NonRecordingSpan` is not re-exported from this `@opentelemetry/api` version's package index, so the span must come from `startSpan`, not an import.

```ts
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  opts: SpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name, { attributes: opts.attributes ?? {} });
  const ctx: Context = trace.setSpan(context.active(), span);
  try {
    return await context.with(ctx, () => fn(span));
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
}
```

The enabled-telemetry path is behaviorally unchanged.

## Verification

- `npm run typecheck`, `npm test`, `npm run build` pass.
- On-device path reaches WebLLM initialization (progress events) instead of throwing; console shows no `span.setAttribute` error.

## Related

- Non-blocking vendor warning also seen in the same session: `powerPreference ... ignored when calling requestAdapter() on Windows` — see `CONSOLE-WARNINGS-BENIGN.md`.
- Backend SSE sync failure seen alongside — see `BUG-REPORT-CHAT-SYNC-SSE-JSON.md`.
