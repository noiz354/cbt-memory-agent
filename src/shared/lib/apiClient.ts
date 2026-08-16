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

/**
 * Global 401 handler (set once at bootstrap). Fired whenever any authenticated
 * API call returns HTTP 401 — i.e. the session token was revoked/expired and the
 * user must sign in again. The app wires this to signOut + redirect to /auth.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/**
 * Notify the registered 401 handler. Exported so callers with raw `fetch`
 * (e.g. the SSE stream path in llmClient) can trigger the same session-expiry
 * handling as the typed `api()` helper.
 */
export function notifyUnauthorized(): void {
  try {
    unauthorizedHandler?.();
  } catch {
    // Never let the interceptor break the caller's error path.
  }
}

/**
 * Rate limiting from the backend / gateway / upstream provider (HTTP 429).
 * Carries the server's suggested retry delay (`Retry-After`, seconds or
 * HTTP-date) so callers can show a meaningful, timing-aware message.
 */
export class RateLimitError extends Error {
  readonly retryAfterMs: number | null;

  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function isRateLimitError(err: unknown): boolean {
  return err instanceof RateLimitError || (err as { name?: string })?.name === "RateLimitError";
}

/** Parse a `Retry-After` header value into ms (seconds or HTTP-date). */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/** Build a user-facing rate-limit error from a 429 response. */
async function rateLimitError(res: Response): Promise<RateLimitError> {
  const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
  const body = await res.text().catch(() => "");
  const hint = retryAfterMs !== null ? ` Try again in ~${Math.round(retryAfterMs / 1000)}s.` : "";
  const detail = body.trim().slice(0, 120);
  return new RateLimitError(
    `Rate limit reached (429)${detail ? ` — ${detail}` : ""}.${hint}`,
    retryAfterMs,
  );
}

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
    if (res.status === 401) notifyUnauthorized();
    if (res.status === 429) throw await rateLimitError(res);
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
  /** Memory IDs the backend injected into this turn (from the final SSE event). */
  injectedMemoryIds?: string[];
  /** Titles of the memories the backend recalled for this turn (final SSE event). */
  recalledTitles?: string[];
}

export interface MemoryNode {
  id: string;
  kind: "core" | "transcript" | "attachment";
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

export type AttachmentKind = "image" | "video" | "audio";

export interface AttachmentAnalysisInput {
  kind: AttachmentKind;
  analysis: Record<string, unknown>;
  embeddedNarrative: string;
  s3Key: string;
  title: string;
  confidence?: number;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  frameCount?: number;
  sessionId?: string;
  turnId?: string;
}

export interface PresignResponse {
  v: 1;
  key: string;
  uploadUrl: string;
}

export interface CreateAttachmentResponse {
  v: 1;
  ok: true;
  nodeId: string;
  attachmentId: string;
}

export interface AttachmentListItem {
  id: string;
  kind: AttachmentKind;
  title: string;
  excerpt?: string;
  embeddedNarrative?: string;
  createdAt?: string;
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

    if (!res.ok) {
      if (res.status === 401) notifyUnauthorized();
      if (res.status === 429) throw await rateLimitError(res);
      throw new Error(`API ${res.status}: ${res.statusText}`);
    }

    // Streaming response — backend /chat/turn always speaks SSE, even when the
    // caller does not pass onChunk (fire-and-forget sync). Guard onChunk so the
    // same path serves both; never res.json() the SSE body.
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
                return {
                  v: 1,
                  turnId: "",
                  assistantMessage: fullContent,
                  tokensUsed: 0,
                  latencyMs: 0,
                  injectedMemoryIds: json.injectedMemoryIds as string[],
                  recalledTitles: Array.isArray(json.recalledTitles)
                    ? (json.recalledTitles as string[])
                    : undefined,
                };
              }
              if (delta) {
                fullContent += delta;
                onChunk?.(delta, false);
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      onChunk?.("", true);
      return { v: 1, turnId: "", assistantMessage: fullContent, tokensUsed: 0, latencyMs: 0 };
    }

    // No response body (unexpected) — fall back to JSON parse
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

  /** GET /analytics/funnel — Distinct users per activation step + step conversion. */
  analyticsFunnel: (token: string, deviceId: string, period?: string) =>
    api<{
      v: 1;
      period: string;
      steps: { name: string; users: number }[];
      conversion: { from: string; to: string; rate: number | null }[];
    }>(`/analytics/funnel${period ? `?period=${encodeURIComponent(period)}` : ""}`, { token, deviceId }),

  /** GET /analytics/activity — DAU/WAU/MAU + sticky factor for the period. */
  analyticsActivity: (token: string, deviceId: string, period?: string) =>
    api<{ v: 1; period: string; dau: number; wau: number; mau: number; stickyFactor: number | null }>(
      `/analytics/activity${period ? `?period=${encodeURIComponent(period)}` : ""}`,
      { token, deviceId },
    ),

  /** GET /analytics/retention — Cohort retention (6-month window ending at period). */
  analyticsRetention: (token: string, deviceId: string, period?: string) =>
    api<{
      v: 1;
      period: string;
      cohorts: { cohort: string; age: number; size: number; active: number; retentionPct: number | null }[];
    }>(`/analytics/retention${period ? `?period=${encodeURIComponent(period)}` : ""}`, { token, deviceId }),

  /** POST /events — Track product/monetization events (FASE 4). */
  trackEvent: (
    events: { name: string; properties?: Record<string, unknown> | null; sessionId?: string; occurredAt?: string }[],
    token: string,
    deviceId: string,
  ) =>
    api<{ v: 1; inserted: number; rejected: number; rejectedNames?: string[] }>("/events", {
      method: "POST",
      token,
      deviceId,
      body: JSON.stringify({ events }),
    }),

  /** GET /health — Health check. */
  health: () => api<HealthResponse>("/health"),

  /** POST /attachments/presign — Presigned PUT URL untuk raw media. */
  presignMedia: (
    body: { v: 1; kind: AttachmentKind; ext?: string; mimeType?: string },
    token: string,
    deviceId: string,
  ) =>
    api<PresignResponse>("/attachments/presign", {
      method: "POST",
      token,
      deviceId,
      body: JSON.stringify(body),
    }),

  /** PUT raw blob langsung ke S3 memakai presigned URL. */
  uploadMediaToS3: async (uploadUrl: string, blob: Blob, mimeType?: string): Promise<void> => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: mimeType ? { "Content-Type": mimeType } : undefined,
      body: blob,
    });
    if (!res.ok) throw new Error(`S3 upload ${res.status}: ${res.statusText}`);
  },

  /** POST /attachments — Simpan memory node kind=attachment + analysis. */
  createAttachment: (
    body: { v: 1; attachment: AttachmentAnalysisInput },
    token: string,
    deviceId: string,
  ) =>
    api<CreateAttachmentResponse>("/attachments", {
      method: "POST",
      token,
      deviceId,
      body: JSON.stringify(body),
    }),

  /** GET /attachments — Daftar attachment user. */
  listAttachments: (token: string, deviceId: string) =>
    api<{ v: 1; attachments: AttachmentListItem[] }>("/attachments", { token, deviceId }),

  /** DELETE /attachments/:id — Hapus raw S3 + node (cascade). */
  deleteAttachment: (id: string, token: string, deviceId: string) =>
    api<{ v: 1; ok: true; deletedId: string }>(`/attachments/${id}`, {
      method: "DELETE",
      token,
      deviceId,
    }),
};
