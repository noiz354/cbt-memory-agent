# BYOK — Bring Your Own Key (LLM)

> 24 providers, 50+ models, dual-API: on-device → backend → BYOK fallback chain.
> API keys dienkripsi dengan WebCrypto (AES-GCM), disimpan di IndexedDB.
> Tidak ada key yang masuk localStorage atau dikirim ke server kita.

**Tanggal:** 2026-08-13

---

## Arsitektur

```
┌─────────────────────────────────────────────────────┐
│                    CHAT (user types)                 │
│                         ↓                            │
│              callLLMWithFallback()                   │
│                         ↓                            │
├─────────────────────────────────────────────────────┤
│               FALLBACK CHAIN                         │
│                                                      │
│  1. On-device (WebLLM)                               │
│     - Phi-3-mini quantized (~2GB)                    │
│     - Gratis, privat, tidak keluar device            │
│     - Jika gagal/low-end → lanjut ke 2               │
│                         ↓                            │
│  2. Backend proxy (/api/v1/chat/completions)         │
│     - Server kita kelola                             │
│     - GPT-4o-mini default                            │
│     - Jika down/timeout → lanjut ke 3                │
│                         ↓                            │
│  3. BYOK (user's API key)                            │
│     - IndexedDB + WebCrypto AES-GCM                  │
│     - 24 providers, 50+ models                       │
│     - OpenRouter aggregator → 100+ model 1 key       │
└─────────────────────────────────────────────────────┘
```

---

## Providers (24)

| Kategori | Providers |
|---|---|
| **Aggregator** | OpenRouter (100+ models, 1 key) |
| **Hyperscaler** | OpenAI, Anthropic, Google (Gemini) |
| **Fast inference** | Groq (free), Cerebras (free), Together AI |
| **Open-weight** | DeepSeek, Mistral, Cohere, Fireworks, xAI (Grok) |
| **Regional** | SambaNova, Novita, Hyperbolic, Aliyun Bailian, Moonshot, MiniMax |
| **Free tier** | Llama API, Lambda Labs, Hugging Face Inference |
| **On-device** | WebLLM (Phi-3-mini, Llama 3.2 1B) |
| **Backend** | Backend proxy (kita kelola) |

---

## File Structure

| File | Peran |
|---|---|
| `src/shared/lib/llmRegistry.ts` | 24 providers, 50+ models, cost tiers, capabilities |
| `src/shared/lib/byokKeyManager.ts` | IndexedDB + WebCrypto AES-GCM encrypt/decrypt API keys |
| `src/shared/lib/llmClient.ts` | Unified LLM interface + fallback chain |
| `src/features/privacy/components/LlmPanel.tsx` | Settings tab untuk kelola keys |
| `src/features/chat/store/chatStore.ts` | Integration: `callLLMWithFallback()` ganti `craftReply()` |

---

## Cara Pakai

### User: Setup API Key

1. Buka **Settings → LLM** tab
2. Pilih provider (misal OpenRouter)
3. Pilih model (misal GPT-4o-mini)
4. Paste API key → **Save**
5. Key dienkripsi otomatis, tersimpan di IndexedDB
6. **Test** untuk verifikasi koneksi

### Developer: Tambah Provider Baru

```typescript
// Di llmRegistry.ts, tambahkan entry di PROVIDERS:
myProvider: {
  id: "my-provider",
  name: "My Provider",
  baseUrl: "https://api.myprovider.com",
  apiPath: "/v1/chat/completions",
  authType: "bearer",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  models: [
    { id: "my-model", name: "My Model", contextWindow: 128_000, maxOutput: 16_384, costPerMToken: 1, capabilities: ["text"] },
  ],
  defaultModel: "my-model",
  costTier: "low",
  supportsStreaming: true,
  docsUrl: "https://docs.myprovider.com",
  keyUrl: "https://myprovider.com/api-keys",
},
```

### Developer: Call LLM di Komponen Lain

```typescript
import { callLLMWithFallback } from "@/shared/lib/llmClient";

const response = await callLLMWithFallback(
  [{ role: "user", content: "Summarize this thought record..." }],
  (chunk) => {
    if (!chunk.done) {
      // Streaming: append delta
    } else {
      // Done
    }
  }
);
```

---

## Security

### API Key Storage

```
User input: "sk-abc123..."
          ↓
WebCrypto AES-GCM encrypt (256-bit key, random IV)
          ↓
IndexedDB: { ciphertext: "base64...", iv: "base64..." }
```

- Wrapping key dibuat sekali di startup, persistent di IndexedDB
- Key mentah tidak pernah masuk localStorage, console, atau network
- Revoke = hapus ciphertext dari IndexedDB

### Request Flow

```
Browser → Provider API (direct, tidak lewat server kita)
         Header: Authorization: Bearer sk-xxx
         (key diambil dari IndexedDB, decrypt, pakai sekali, discard)
```

Kita **tidak pernah** melihat API key user.

---

## Fallback Chain Logic

```typescript
try {
  return await callLLM({ providerId: "local-webllm", ... });
} catch {
  // On-device failed (model not loaded, OOM, etc)
}

try {
  return await callLLM({ providerId: "backend-proxy", ... });
} catch {
  // Backend down, timeout, or not deployed
}

// Last resort: BYOK
return await callLLM({ providerId: "openrouter", ... });
// Throws if no key configured
```

---

## Cost Estimates

| Tier | Provider Contoh | Cost/1M tokens | Use Case |
|---|---|---|---|
| Free | Groq, Cerebras, HuggingFace | $0 | Fallback pertama setelah on-device |
| Low | OpenAI (mini), DeepSeek, Mistral | $0.10-$1 | Daily use |
| Medium | Anthropic Sonnet, Cohere | $8-$15 | Complex reasoning |
| High | Anthropic Opus, GPT-4o | $15-$75 | Rare, heavy sessions |

**Rekomendasi:** OpenRouter + GPT-4o-mini ($0.60/1M tokens) — murah, cepat, cukup untuk CBT summarization.
