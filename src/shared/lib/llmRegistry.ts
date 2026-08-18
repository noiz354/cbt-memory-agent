/**
 * LLM Provider Registry — 24 providers, 50+ models.
 *
 * Unified interface for BYOK + Backend fallback.
 * Each provider defines: id, name, baseUrl, models[], authType, costTier.
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type LLMProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "together"
  | "deepseek"
  | "mistral"
  | "cohere"
  | "perplexity"
  | "fireworks"
  | "xai"
  | "openrouter"
  | "cerebras"
  | "sambanova"
  | "novita"
  | "hyperbolic"
  | "aliyun"
  | "moonshot"
  | "minimax"
  | "llama-api"
  | "lambdalabs"
  | "huggingface"
  | "local-webllm"
  | "backend-proxy"
  | "ollama";

export type LLMCostTier = "free" | "low" | "medium" | "high";
export type LLMAuthType = "bearer" | "api-key" | "x-api-key";

export interface LLMModel {
  id: string;
  name: string;
  contextWindow: number; // tokens
  maxOutput: number; // tokens
  costPerMToken: number; // USD per 1M output tokens (approx)
  capabilities: ("text" | "vision" | "reasoning")[];
}

export interface LLMProvider {
  id: LLMProviderId;
  name: string;
  baseUrl: string;
  apiPath: string; // e.g. "/v1/chat/completions"
  authType: LLMAuthType;
  authHeader: string; // e.g. "Authorization", "x-api-key"
  authPrefix?: string; // e.g. "Bearer " (empty string for api-key only)
  models: LLMModel[];
  defaultModel: string;
  costTier: LLMCostTier;
  supportsStreaming: boolean;
  docsUrl: string;
  keyUrl: string; // where user gets their API key
}

// ─────────────────────────────────────────────
// Model definitions per provider
// ─────────────────────────────────────────────

export const PROVIDERS: Record<LLMProviderId, LLMProvider> = {
  // ── Aggregators ──
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai",
    apiPath: "/api/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "openai/gpt-4o", name: "GPT-4o", contextWindow: 128_000, maxOutput: 16_384, costPerMToken: 15, capabilities: ["text", "vision"] },
      { id: "openai/gpt-4o-mini", name: "GPT-4o-mini", contextWindow: 128_000, maxOutput: 16_384, costPerMToken: 0.6, capabilities: ["text"] },
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", contextWindow: 200_000, maxOutput: 64_000, costPerMToken: 15, capabilities: ["text", "vision"] },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1_000_000, maxOutput: 64_000, costPerMToken: 2.5, capabilities: ["text", "vision"] },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1_000_000, maxOutput: 64_000, costPerMToken: 0.4, capabilities: ["text"] },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.4, capabilities: ["text"] },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.5, capabilities: ["text", "reasoning"] },
      { id: "mistralai/mistral-large-2411", name: "Mistral Large 2", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 8, capabilities: ["text"] },
    ],
    defaultModel: "openai/gpt-4o-mini",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://openrouter.ai/docs",
    keyUrl: "https://openrouter.ai/keys",
  },

  // ── Hyperscalers ──
  openai: {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000, maxOutput: 16_384, costPerMToken: 15, capabilities: ["text", "vision"] },
      { id: "gpt-4o-mini", name: "GPT-4o-mini", contextWindow: 128_000, maxOutput: 16_384, costPerMToken: 0.6, capabilities: ["text"] },
      { id: "o3-mini", name: "o3-mini", contextWindow: 200_000, maxOutput: 32_768, costPerMToken: 1.1, capabilities: ["text", "reasoning"] },
    ],
    defaultModel: "gpt-4o-mini",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://platform.openai.com/docs",
    keyUrl: "https://platform.openai.com/api-keys",
  },

  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiPath: "/v1/messages",
    authType: "x-api-key",
    authHeader: "x-api-key",
    authPrefix: "",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextWindow: 200_000, maxOutput: 64_000, costPerMToken: 15, capabilities: ["text", "vision"] },
      { id: "claude-opus-4-20250416", name: "Claude Opus 4", contextWindow: 200_000, maxOutput: 64_000, costPerMToken: 75, capabilities: ["text", "vision"] },
      { id: "claude-haiku-3-5-20241022", name: "Claude Haiku 3.5", contextWindow: 200_000, maxOutput: 8_192, costPerMToken: 0.8, capabilities: ["text"] },
    ],
    defaultModel: "claude-sonnet-4-20250514",
    costTier: "medium",
    supportsStreaming: true,
    docsUrl: "https://docs.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },

  google: {
    id: "google",
    name: "Google AI (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiPath: "/v1beta/models/{model}:generateContent",
    authType: "api-key",
    authHeader: "",
    authPrefix: "",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1_000_000, maxOutput: 64_000, costPerMToken: 2.5, capabilities: ["text", "vision"] },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1_000_000, maxOutput: 64_000, costPerMToken: 0.4, capabilities: ["text"] },
      { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite", contextWindow: 1_000_000, maxOutput: 8_192, costPerMToken: 0.075, capabilities: ["text"] },
    ],
    defaultModel: "gemini-2.5-flash",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://ai.google.dev/docs",
    keyUrl: "https://aistudio.google.com/app/apikey",
  },

  // ── Fast inference ──
  groq: {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com",
    apiPath: "/openai/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.59, capabilities: ["text"] },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", contextWindow: 32_768, maxOutput: 32_768, costPerMToken: 0.27, capabilities: ["text"] },
      { id: "gemma2-9b-it", name: "Gemma 2 9B", contextWindow: 8_192, maxOutput: 8_192, costPerMToken: 0.1, capabilities: ["text"] },
    ],
    defaultModel: "llama-3.3-70b-versatile",
    costTier: "free",
    supportsStreaming: true,
    docsUrl: "https://console.groq.com/docs",
    keyUrl: "https://console.groq.com/keys",
  },

  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    baseUrl: "https://inference.cerebras.ai",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "llama3.3-70b", name: "Llama 3.3 70B", contextWindow: 8_192, maxOutput: 8_192, costPerMToken: 0.6, capabilities: ["text"] },
      { id: "llama3.1-8b", name: "Llama 3.1 8B", contextWindow: 8_192, maxOutput: 8_192, costPerMToken: 0.1, capabilities: ["text"] },
    ],
    defaultModel: "llama3.3-70b",
    costTier: "free",
    supportsStreaming: true,
    docsUrl: "https://inference-docs.cerebras.ai",
    keyUrl: "https://cloud.cerebras.ai",
  },

  together: {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.88, capabilities: ["text"] },
      { id: "mistralai/Mixtral-8x22B-Instruct-v0.1", name: "Mixtral 8x22B", contextWindow: 64_000, maxOutput: 32_768, costPerMToken: 1.2, capabilities: ["text"] },
    ],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://docs.together.ai",
    keyUrl: "https://api.together.xyz/settings/api-keys",
  },

  // ── Open-weight / regional ──
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat V3", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.28, capabilities: ["text"] },
      { id: "deepseek-reasoner", name: "DeepSeek R1", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.5, capabilities: ["text", "reasoning"] },
    ],
    defaultModel: "deepseek-chat",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://platform.deepseek.com/docs",
    keyUrl: "https://platform.deepseek.com/api-keys",
  },

  mistral: {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "mistral-large-2411", name: "Mistral Large 2", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 8, capabilities: ["text"] },
      { id: "pixtral-12b-2409", name: "Pixtral 12B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.15, capabilities: ["text", "vision"] },
      { id: "ministral-8b-2410", name: "Ministral 8B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.1, capabilities: ["text"] },
    ],
    defaultModel: "ministral-8b-2410",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://docs.mistral.ai",
    keyUrl: "https://console.mistral.ai/api-keys/",
  },

  cohere: {
    id: "cohere",
    name: "Cohere",
    baseUrl: "https://api.cohere.com",
    apiPath: "/v1/chat",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "command-r-plus-08-2024", name: "Command R+", contextWindow: 128_000, maxOutput: 4_000, costPerMToken: 10, capabilities: ["text"] },
      { id: "command-r-08-2024", name: "Command R", contextWindow: 128_000, maxOutput: 4_000, costPerMToken: 1.5, capabilities: ["text"] },
    ],
    defaultModel: "command-r-08-2024",
    costTier: "medium",
    supportsStreaming: true,
    docsUrl: "https://docs.cohere.com",
    keyUrl: "https://dashboard.cohere.com/api-keys",
  },

  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    apiPath: "/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "sonar-pro", name: "Sonar Pro", contextWindow: 200_000, maxOutput: 8_192, costPerMToken: 3, capabilities: ["text"] },
      { id: "sonar-reasoning", name: "Sonar Reasoning", contextWindow: 128_000, maxOutput: 8_192, costPerMToken: 5, capabilities: ["text", "reasoning"] },
    ],
    defaultModel: "sonar-pro",
    costTier: "medium",
    supportsStreaming: true,
    docsUrl: "https://docs.perplexity.ai",
    keyUrl: "https://www.perplexity.ai/settings/api",
  },

  fireworks: {
    id: "fireworks",
    name: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai",
    apiPath: "/inference/v1/accounts/fireworks/models/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.9, capabilities: ["text"] },
      { id: "accounts/fireworks/models/qwen2p5-72b-instruct", name: "Qwen 2.5 72B", contextWindow: 32_768, maxOutput: 32_768, costPerMToken: 0.9, capabilities: ["text"] },
    ],
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://docs.fireworks.ai",
    keyUrl: "https://fireworks.ai/account/api-keys",
  },

  xai: {
    id: "xai",
    name: "xAI (Grok)",
    baseUrl: "https://api.x.ai",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "grok-3", name: "Grok 3", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 5, capabilities: ["text"] },
      { id: "grok-3-mini", name: "Grok 3 Mini", contextWindow: 128_000, maxOutput: 16_384, costPerMToken: 0.3, capabilities: ["text"] },
    ],
    defaultModel: "grok-3-mini",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://docs.x.ai",
    keyUrl: "https://console.x.ai/api-keys",
  },

  sambanova: {
    id: "sambanova",
    name: "SambaNova",
    baseUrl: "https://api.sambanova.ai",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "Meta-Llama-3.1-405B-Instruct", name: "Llama 3.1 405B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 5, capabilities: ["text"] },
      { id: "Meta-Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 1, capabilities: ["text"] },
    ],
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    costTier: "medium",
    supportsStreaming: true,
    docsUrl: "https://docs.sambanova.ai",
    keyUrl: "https://cloud.sambanova.ai/apis",
  },

  novita: {
    id: "novita",
    name: "Novita AI",
    baseUrl: "https://api.novita.ai",
    apiPath: "/v3/openai/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.5, capabilities: ["text", "reasoning"] },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.4, capabilities: ["text"] },
    ],
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://docs.novita.ai",
    keyUrl: "https://novita.ai/settings/api-key",
  },

  hyperbolic: {
    id: "hyperbolic",
    name: "Hyperbolic",
    baseUrl: "https://api.hyperbolic.ai",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "meta-llama/Meta-Llama-3.1-405B-Instruct", name: "Llama 3.1 405B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 4, capabilities: ["text"] },
      { id: "mistralai/Mixtral-8x22B-Instruct-v0.1", name: "Mixtral 8x22B", contextWindow: 64_000, maxOutput: 32_768, costPerMToken: 1, capabilities: ["text"] },
    ],
    defaultModel: "meta-llama/Meta-Llama-3.1-405B-Instruct",
    costTier: "medium",
    supportsStreaming: true,
    docsUrl: "https://docs.hyperbolic.xyz",
    keyUrl: "https://app.hyperbolic.xyz",
  },

  aliyun: {
    id: "aliyun",
    name: "Alibaba Cloud (Bailian)",
    baseUrl: "https://dashscope.aliyuncs.com",
    apiPath: "/compatible-mode/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "qwen-max", name: "Qwen-Max", contextWindow: 32_000, maxOutput: 8_192, costPerMToken: 1.6, capabilities: ["text"] },
      { id: "qwen-plus", name: "Qwen-Plus", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.12, capabilities: ["text"] },
    ],
    defaultModel: "qwen-plus",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://help.aliyun.com/zh/model-studio",
    keyUrl: "https://bailian.console.aliyun.com",
  },

  moonshot: {
    id: "moonshot",
    name: "Moonshot AI",
    baseUrl: "https://api.moonshot.cn",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "moonshot-v1-8k", name: "Moonshot V1 8K", contextWindow: 8_192, maxOutput: 8_192, costPerMToken: 1.5, capabilities: ["text"] },
      { id: "moonshot-v1-32k", name: "Moonshot V1 32K", contextWindow: 32_768, maxOutput: 32_768, costPerMToken: 3, capabilities: ["text"] },
    ],
    defaultModel: "moonshot-v1-8k",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://platform.moonshot.cn/docs",
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
  },

  minimax: {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.chat",
    apiPath: "/v1/text/chatcompletion_v2",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "MiniMax-Text-01", name: "MiniMax Text 01", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.5, capabilities: ["text"] },
    ],
    defaultModel: "MiniMax-Text-01",
    costTier: "low",
    supportsStreaming: true,
    docsUrl: "https://platform.minimax.chat/docs",
    keyUrl: "https://platform.minimax.chat/user-center/api-key",
  },

  "llama-api": {
    id: "llama-api",
    name: "Llama API",
    baseUrl: "https://api.llama-api.com",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "llama3.3-70b", name: "Llama 3.3 70B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.5, capabilities: ["text"] },
      { id: "llama3.2-90b", name: "Llama 3.2 90B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0.8, capabilities: ["text"] },
    ],
    defaultModel: "llama3.3-70b",
    costTier: "free",
    supportsStreaming: true,
    docsUrl: "https://docs.llama-api.com",
    keyUrl: "https://llama-api.com/account/settings",
  },

  lambdalabs: {
    id: "lambdalabs",
    name: "Lambda Labs",
    baseUrl: "https://api.lambdalabs.com",
    apiPath: "/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "llama3.1-8b", name: "Llama 3.1 8B", contextWindow: 8_192, maxOutput: 8_192, costPerMToken: 0.1, capabilities: ["text"] },
    ],
    defaultModel: "llama3.1-8b",
    costTier: "low",
    supportsStreaming: false,
    docsUrl: "https://docs.lambdalabs.com",
    keyUrl: "https://cloud.lambdalabs.com/api-keys",
  },

  huggingface: {
    id: "huggingface",
    name: "Hugging Face Inference",
    baseUrl: "https://api-inference.huggingface.co",
    apiPath: "/models/{model_id}/v1/chat/completions",
    authType: "bearer",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", contextWindow: 128_000, maxOutput: 32_768, costPerMToken: 0, capabilities: ["text"] },
      { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", name: "Mixtral 8x7B", contextWindow: 32_768, maxOutput: 32_768, costPerMToken: 0, capabilities: ["text"] },
    ],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    costTier: "free",
    supportsStreaming: true,
    docsUrl: "https://huggingface.co/docs/inference-endpoints",
    keyUrl: "https://huggingface.co/settings/tokens",
  },

  // ── On-device (WebLLM) ──
  "local-webllm": {
    id: "local-webllm",
    name: "On-Device (WebLLM)",
    baseUrl: "",
    apiPath: "",
    authType: "api-key",
    authHeader: "",
    authPrefix: "",
    models: [
      { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 1B (quantized)", contextWindow: 4_096, maxOutput: 2_048, costPerMToken: 0, capabilities: ["text"] },
      { id: "Phi-3-mini-4k-instruct-q4f16_1-MLC", name: "Phi-3-mini (quantized)", contextWindow: 4_096, maxOutput: 2_048, costPerMToken: 0, capabilities: ["text"] },
    ],
    defaultModel: "Phi-3-mini-4k-instruct-q4f16_1-MLC",
    costTier: "free",
    supportsStreaming: false,
    docsUrl: "https://webllm.mlc.ai",
    keyUrl: "",
  },

  // ── Backend proxy (kita kelola) ──
  "backend-proxy": {
    id: "backend-proxy",
    name: "Backend Proxy",
    baseUrl: "",
    apiPath: "/api/v1/chat/turn",
    authType: "api-key",
    authHeader: "",
    authPrefix: "",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o-mini (proxy)", contextWindow: 128_000, maxOutput: 16_384, costPerMToken: 0, capabilities: ["text"] },
    ],
    defaultModel: "gpt-4o-mini",
    costTier: "free",
    supportsStreaming: true,
    docsUrl: "",
    keyUrl: "",
  },

  // ── Local Ollama (fallback on-device, tanpa API key) ──
  // Base URL bisa di-override via VITE_OLLAMA_URL (mis. http://hostname.local:11434
  // di WSL ketika Ollama jalan di Windows host). Model di-fetch dinamis dari
  // GET /api/tags saat runtime — lihat fetchOllamaModels().
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    baseUrl: import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434",
    apiPath: "/v1/chat/completions",
    authType: "api-key",
    authHeader: "",
    authPrefix: "",
    models: [],
    defaultModel: "llama3.1:latest",
    costTier: "free",
    supportsStreaming: true,
    docsUrl: "https://ollama.com",
    keyUrl: "",
  },
};

// ─────────────────────────────────────────────
// Ollama — list model dinamis dari /api/tags
// ─────────────────────────────────────────────

export interface OllamaTag {
  name: string;
  model: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    context_length?: number;
  };
  capabilities?: string[];
}

export interface OllamaModelsResult {
  ok: boolean;
  baseUrl: string;
  models: OllamaTag[];
  error?: string;
}

/**
 * Candidate base URLs untuk Ollama. Urutan prioritas:
 *   1. VITE_OLLAMA_URL (eksplisit)
 *   2. http://localhost:11434
 *   3. http://<hostname>.local:11434 (WSL → Windows host)
 * Coba satu per satu sampai ada yang merespons.
 */
export function ollamaBaseUrlCandidates(): string[] {
  const explicit = import.meta.env.VITE_OLLAMA_URL;
  const hostname = typeof location !== "undefined" ? location.hostname : "localhost";
  const candidates = explicit ? [explicit] : [];
  candidates.push("http://localhost:11434");
  if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
    candidates.push(`http://${hostname}.local:11434`);
  }
  return [...new Set(candidates)];
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * List model dari Ollama lokal. Mencoba semua kandidat base URL sampai satu
 * berhasil; semua gagal → { ok:false, error }. Tidak pernah melempar.
 */
export async function fetchOllamaModels(signal?: AbortSignal): Promise<OllamaModelsResult> {
  let lastError: string | null = null;
  for (const baseUrl of ollamaBaseUrlCandidates()) {
    try {
      const data = await fetchJson<{ models: OllamaTag[] }>(`${baseUrl}/api/tags`, signal);
      return { ok: true, baseUrl, models: data.models ?? [] };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, baseUrl: ollamaBaseUrlCandidates()[0], models: [], error: lastError ?? "unknown" };
}

/** Filter model yang bisa dipakai chat (bukan embedding-only). */
export function ollamaChatModels(models: OllamaTag[]): OllamaTag[] {
  return models.filter(
    (m) =>
      !m.capabilities ||
      m.capabilities.includes("completion") ||
      m.capabilities.includes("tools"),
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function getProvider(id: LLMProviderId): LLMProvider {
  return PROVIDERS[id];
}

export function getModel(providerId: LLMProviderId, modelId: string): LLMModel | undefined {
  return PROVIDERS[providerId].models.find((m) => m.id === modelId);
}

export function listModelsByCostTier(tier: LLMCostTier): { provider: LLMProvider; model: LLMModel }[] {
  const result: { provider: LLMProvider; model: LLMModel }[] = [];
  for (const provider of Object.values(PROVIDERS)) {
    if (provider.costTier === tier) {
      for (const model of provider.models) {
        result.push({ provider, model });
      }
    }
  }
  return result.sort((a, b) => a.model.costPerMToken - b.model.costPerMToken);
}

export function allModels(): { provider: LLMProvider; model: LLMModel }[] {
  const result: { provider: LLMProvider; model: LLMModel }[] = [];
  for (const provider of Object.values(PROVIDERS)) {
    for (const model of provider.models) {
      result.push({ provider, model });
    }
  }
  return result;
}
