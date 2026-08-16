# Console Warnings — Known Benign (no fix required)

- **Tanggal**: 2026-08-16

## `powerPreference` ignored on Windows

```
index.js:883 The powerPreference option is currently ignored when calling
requestAdapter() on Windows. See https://crbug.com/369219127
```

### Origin

onnxruntime-web (`ort-wasm-simd-threaded`) inside the **transcribe worker**
(`src/workers/transcribe.worker.ts`). Stack trace goes through
`engine.ts:341 detectGPUDevice` → `index.js:881 detectGPUDevice` → `requestAdapter()`.
This is Chromium-on-Windows WebGPU behavior, not application code.

### Verdict

**Benign / no code fix.** The WebGPU EP falls back to a default adapter. Affects
Windows only; macOS/Linux/Android do not emit it. Silence options if desired:

- Ignore (recommended — vendor noise, informational only).
- Suppress in the transcribe worker by avoiding WebGPU on Windows (e.g. select CPU EP
  when `navigator.userAgentData?.platform === "Windows"`), but the warning is harmless
  and the GPU path still works.

## Related

This appeared in the same console session as two real bugs:

- `BUG-REPORT-ONDEVICE-SPAN-SETATTRIBUTE.md` — `span.setAttribute is not a function`
- `BUG-REPORT-CHAT-SYNC-SSE-JSON.md` — `res.json()` on an SSE response
