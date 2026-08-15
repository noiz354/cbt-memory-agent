/**
 * API Client — HTTP client ke backend (CockroachDB + AWS).
 *
 * Frontend hanya memanggil endpoint ini. Backend bertanggung jawab atas:
 * - CockroachDB (persistent memory layer)
 * - OpenRouter (LLM inference + embeddings)
 * - AWS Lambda (API handler)
 * - Amazon S3 (export storage)
 * - Distributed Vector Indexing (semantic search)
 * - CockroachDB MCP Server (AI agent ↔ CRDB)
 *
 * Pendekatan: Backend-primary, local cache.
 * Zustand stores = cache untuk offline-first UX.
 * Saat online → sync ke backend.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

interface ApiOptions extends RequestInit {
  token?: string;
  deviceId?: string;
}

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token, deviceId, ...init } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> ?? {}),
  };

  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (deviceId) headers["X-Device-Id"] = deviceId;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ChatTurnRequest {
  v: 1;
  sessionId: string;
  userMessage: string;
  memoryIds?: string[];
  clientTs: string;
  deviceOnly: true;
}

export interface ChatTurnResponse {
  v: 1;
  turnId: string;
  assistantMessage: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface MemoryNode {
  id: string;
  kind: "core" | "transcript";
  title: string;
  excerpt?: string;
  tags?: string[];
  weight: number;
  confidence: number;
  verified: boolean;
  references: number;
  lastTouched: string;
  x: number;
  y: number;
  crisisFlag?: boolean;
}

export interface MemoryEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  createdAt: string;
}

export interface MemoryListResponse {
  v: 1;
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

export interface SemanticSearchResult {
  node: { id: string; title: string; excerpt?: string };
  score: number;
  matchReason: string;
}

export interface SessionData {
  id: string;
  title: string;
  status: "extracted" | "pending" | "interrupted";
  mood: number;
  moodLabel: string;
  startedAt: string;
  durationMin: number;
  excerpt: string;
  thought?: string;
  reframe?: string | null;
}

export interface ExportResponse {
  v: 2;
  exportedAt: string;
  consentVersion: string;
  deviceOnly: true;
  s3Url: string;
  expiresAt: string;
}

export interface PurgeResponse {
  v: 1;
  ok: true;
  deletedRows: number;
}

export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  crdb: string;
  llm: string;
  s3: string;
  version: string;
}

// ─────────────────────────────────────────────
// API Client
// ─────────────────────────────────────────────

export const apiClient = {
  /**
   * POST /chat/turn — Simpan chat turn ke CockroachDB + LLM response via OpenRouter.
   * Mendukung streaming SSE (jika response.body ada).
   */
  chatTurn: async (
    body: ChatTurnRequest,
    token: string,
    deviceId: string,
    onChunk?: (delta: string, done: boolean) => void,
  ): Promise<ChatTurnResponse> => {
    const res = await fetch(`${API_BASE}/chat/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Device-Id": deviceId,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);

    // Streaming response
    if (onChunk && res.body) {
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
              onChunk("", true);
              return { v: 1, turnId: "", assistantMessage: fullContent, tokensUsed: 0, latencyMs: 0 };
            }
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.t ?? "";
              if (delta) {
                fullContent += delta;
                onChunk(delta, false);
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      onChunk("", true);
      return { v: 1, turnId: "", assistantMessage: fullContent, tokensUsed: 0, latencyMs: 0 };
    }

    // Non-streaming response
    return res.json() as Promise<ChatTurnResponse>;
  },

  /** GET /memory — List all memory nodes + edges from CockroachDB. */
  listMemory: (token: string, deviceId: string) =>
    api<MemoryListResponse>("/memory", { token, deviceId }),

  /** POST /memory — Upsert node atau edge ke CockroachDB. */
  upsertMemory: (
    body: { v: 1; action: "upsert"; node?: Omit<MemoryNode, "references" | "lastTouched">; edge?: MemoryEdge },
    token: string,
    deviceId: string,
  ) => api<{ v: 1; ok: true; id: string }>("/memory", {
    method: "POST",
    token,
    deviceId,
    body: JSON.stringify(body),
  }),

  /** DELETE /memory/:id — Purge node dari CockroachDB. */
  deleteMemory: (id: string, token: string, deviceId: string) =>
    api<{ v: 1; ok: true; deletedId: string }>(`/memory/${id}`, {
      method: "DELETE",
      token,
      deviceId,
    }),

  /** DELETE /memory/edge/:id — Hapus edge dari CockroachDB. */
  deleteMemoryEdge: (id: string, token: string, deviceId: string) =>
    api<{ v: 1; ok: true; deletedEdgeId: string }>(`/memory/edge/${id}`, {
      method: "DELETE",
      token,
      deviceId,
    }),

  /** GET /memory/semantic — Semantic search via Distributed Vector Indexing. */
  searchMemory: (
    q: string,
    token: string,
    deviceId: string,
    limit = 5,
    minConfidence = 0.6,
  ) =>
    api<{ v: 1; results: SemanticSearchResult[] }>(
      `/memory/semantic?q=${encodeURIComponent(q)}&limit=${limit}&minConfidence=${minConfidence}`,
      { token, deviceId },
    ),

  /** POST /session — Save session ke CockroachDB. */
  saveSession: (
    body: { v: 1; session: SessionData },
    token: string,
    deviceId: string,
  ) => api<{ v: 1; ok: true; id: string }>("/session", {
    method: "POST",
    token,
    deviceId,
    body: JSON.stringify(body),
  }),

  /** GET /sessions — List all sessions dari CockroachDB. */
  listSessions: (
    token: string,
    deviceId: string,
    status = "all",
    query = "",
  ) =>
    api<{ v: 1; sessions: SessionData[] }>(
      `/sessions?status=${status}&query=${encodeURIComponent(query)}`,
      { token, deviceId },
    ),

  /** GET /session/:id/turns — Chat transcript untuk satu session. */
  listSessionTurns: (
    sessionId: string,
    token: string,
    deviceId: string,
  ) =>
    api<{
      v: 1;
      turns: {
        id: string;
        role: "user" | "assistant" | "system";
        content: string;
        tokensUsed: number;
        injectedMemoryIds: string[];
        createdAt: string;
      }[];
    }>(`/session/${sessionId}/turns`, { token, deviceId }),

  /** POST /auth/magic-link — Request a magic-link email (public). */
  requestMagicLink: (email: string, displayName: string) =>
    api<{ ok: boolean; sent: boolean; devUrl?: string; error?: string }>("/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, displayName }),
    }),

  /** POST /auth/callback — Consume a magic-link token (public), returns session token. */
  consumeMagicLink: (token: string) =>
    api<{ ok: boolean; userId?: string; sessionToken?: string; email?: string; error?: string }>(
      "/auth/callback",
      { method: "POST", body: JSON.stringify({ token }) },
    ),

  /** POST /export — Mint export bundle, upload ke S3. */
  exportBundle: (
    kinds: string[],
    token: string,
    deviceId: string,
  ) =>
    api<ExportResponse>("/export", {
      method: "POST",
      token,
      deviceId,
      body: JSON.stringify({ v: 1, kinds }),
    }),

  /** POST /purge — Hard purge semua data user di server. */
  purge: (
    confirmation: string,
    token: string,
    deviceId: string,
  ) =>
    api<PurgeResponse>("/purge", {
      method: "POST",
      token,
      deviceId,
      body: JSON.stringify({ v: 1, confirmation }),
    }),

  /** GET /metrics — Aggregate metrics dari audit_events. */
  metrics: (token: string, deviceId: string) =>
    api<Record<string, unknown>>("/metrics", { token, deviceId }),

  /** GET /health — Health check. */
  health: () => api<HealthResponse>("/health"),
};
