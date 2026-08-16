# Bug Report — Chat turn sync fails: `res.json()` on an SSE response

- **Tanggal**: 2026-08-16
- **Severity**: High (chat turns never persisted from the frontend sync path → memory/reflection silently degrades)
- **Status**: Open (fix proposed)

## Console transcript

```
[API] Failed to sync chat turn to backend: SyntaxError: Unexpected token 'd', "data: {"t""... is not valid JSON (at VM8623:1:1)
overrideMethod @ installHook.js:1
(anonymous) @ chatStore.ts:286
```

## Root cause

The backend `/api/v1/chat/turn` handler (`lambda/handlers/chatTurn.ts`) **always** responds in SSE format, even when the client does not request streaming:

- `Content-Type: text/event-stream; charset=utf-8` (`chatTurn.ts:59`)
- Body always shaped as `data: {"t":"..."}\n\n ... data: [DONE]\n\n` (`chatTurn.ts:157-168`), including the error path (`chatTurn.ts:182-185`).

The frontend `apiClient.chatTurn` (`src/shared/lib/apiClient.ts:259`) only reads SSE when `onChunk && res.body` (`apiClient.ts:282`). Otherwise it falls through to:

```ts
// Non-streaming response
return res.json() as Promise<ChatTurnResponse>;   // apiClient.ts:338
```

`res.json()` tries to parse the SSE text `data: {"t":"..."}` as JSON → `SyntaxError: Unexpected token 'd'...`.

`chatStore.ts:273` calls `apiClient.chatTurn(...)` with **no `onChunk`** (fire-and-forget sync after a chat turn), so this path is always taken.

### Call chain

```
chatStore.ts:273  apiClient.chatTurn({...}, token, deviceId)   ← no onChunk
  apiClient.ts:282  onChunk && res.body  → false
  apiClient.ts:338  res.json() on "data: {...} data: [DONE]"   → SyntaxError
chatStore.ts:286  console.warn("[API] Failed to sync chat turn to backend:", err)
```

## Impact

- `chat_turns` are never persisted from the frontend sync path.
- When the assistant reply comes from the backend proxy (`llmClient.callBackendProxy`), the backend itself already saved user+assistant turns during `handleChatTurn` (step 6, `chatTurn.ts:152-155`), so persistence still works for that provider.
- When the reply comes from **on-device (WebLLM)** or **BYOK (OpenRouter)**, the frontend sync is the only writer — and it always fails. Backend memory/reflection (`lambda/lib/reflection.ts` queries `FROM chat_turns`) then has no recent turns for those users → silent degradation of the persistent-memory feature.

## Fix (proposed)

`src/shared/lib/apiClient.ts` — make the SSE branch unconditional when a body exists (the backend always speaks SSE), guarding the `onChunk` calls:

```ts
if (res.body) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "data: [DONE]") {
          onChunk?.("", true);
          return { v: 1, turnId: "", assistantMessage: fullContent, tokensUsed: 0, latencyMs: 0 };
        }
        if (!trimmed.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.t ?? "";
          if (Array.isArray(json.injectedMemoryIds)) {
            onChunk?.("", true);
            return { v: 1, turnId: "", assistantMessage: fullContent, tokensUsed: 0, latencyMs: 0, injectedMemoryIds: json.injectedMemoryIds, recalledTitles: Array.isArray(json.recalledTitles) ? json.recalledTitles : undefined };
          }
          if (delta) { fullContent += delta; onChunk?.(delta, false); }
        } catch { /* skip malformed SSE lines */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  onChunk?.("", true);
  return { v: 1, turnId: "", assistantMessage: fullContent, tokensUsed: 0, latencyMs: 0 };
}

// Only reached if no body is available
return res.json() as Promise<ChatTurnResponse>;
```

Changes: `if (onChunk && res.body)` → `if (res.body)`; all `onChunk(...)` → `onChunk?.(...)`. Mirrors the working SSE reader `parseBackendProxySSE` in `src/shared/lib/llmClient.ts:271`.

### Alternative (backend-side)

Add a plain-JSON response branch keyed on `Accept: application/json` in `lambda/handlers/chatTurn.ts`. More invasive; changes the API contract.

## Verification plan

- After fix: send a chat message, confirm no `[API] Failed to sync chat turn to backend` warning.
- Confirm `chat_turns` rows appear for an on-device/BYOK reply (e.g. `SELECT COUNT(*) FROM chat_turns` in CockroachDB).
- `npm run typecheck`, `npm test`, `npm run build` pass.

## Related

- Same console session also logged the on-device span bug — see `BUG-REPORT-ONDEVICE-SPAN-SETATTRIBUTE.md`.
