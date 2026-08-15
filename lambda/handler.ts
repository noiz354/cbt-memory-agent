/**
 * Lambda Handler — Main entry point for API Gateway.
 *
 * Routes endpoints to their respective handlers.
 * Auth middleware validates session token + device ID.
 *
 * Observability (OpenTelemetry):
 *   - setupTelemetry() inisialisasi tracer/metrics/logs saat cold start.
 *   - Setiap request: extract W3C `traceparent` dari header (dari browser),
 *     ciptakan root span, teruskan context ke handlers.
 *   - Response selalu menyertakan `X-Trace-Id` untuk verifikasi end-to-end.
 *   - flushTelemetry() sebelum return agar spans terkirim ke Grafana.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { SpanStatusCode, Context } from "@opentelemetry/api";
import { CrdbClient } from "./lib/crdb";
import { OpenRouterClient } from "./lib/openrouter";
import { S3ClientService } from "./lib/s3";
import { validateAuth } from "./middleware/auth";
import { extractTraceContext, flushTelemetry, setupTelemetry, startSpan } from "./lib/telemetry";
import { handleChatTurn } from "./handlers/chatTurn";
import { handleListMemory, handleUpsertMemory, handleDeleteMemory, handleDeleteMemoryEdge } from "./handlers/memory";
import { handleSemanticSearch } from "./handlers/semanticSearch";
import { handleSaveSession, handleListSessions } from "./handlers/session";
import { handleListSessionTurns } from "./handlers/turns";
import { handleExport } from "./handlers/export";
import { handlePurge } from "./handlers/purge";
import { handleMetrics, handleHealth } from "./handlers/health";
import { handleTelemetryRelay } from "./handlers/telemetry";
import { handleRequestMagicLink, handleConsumeMagicLink } from "./handlers/auth";

const crdb = new CrdbClient(process.env.CRDB_CONNECTION!);
const llm = new OpenRouterClient();
const s3 = new S3ClientService(process.env.S3_BUCKET ?? "cbt-memory-exports");

// Inisialisasi telemetry sekali saat cold start (sebelum request pertama).
setupTelemetry();

// Lambda Function URLs / API Gateway HTTP API deliver payload v2.0 (rawPath,
// requestContext.http.method, lowercased headers) — not the v1 fields (path, httpMethod).
type HandlerEvent = APIGatewayProxyEvent & {
  rawPath?: string;
  rawQueryString?: string;
  requestContext?: { http?: { method?: string } };
};

export async function handler(
  event: HandlerEvent,
): Promise<APIGatewayProxyResult> {
  const path = event.rawPath ?? event.path ?? "";
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? "";

  // v2.0 / Function URL events normalize header names to lowercase
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    headers[key.toLowerCase()] = value ?? "";
  }

  const token = headers["authorization"]?.replace(/^Bearer\s+/i, "") ?? "";
  const deviceId = headers["x-device-id"] ?? "";
  const queryStringParameters =
    event.queryStringParameters ?? parseQueryString(event.rawQueryString ?? "");
  const parentCtx = extractTraceContext(headers);
  const [rootSpan, rootCtx] = startSpan(`${method} ${path || "/"}`, parentCtx, {
    attributes: {
      "http.method": method,
      "http.route": path || "/",
    },
  });

  try {
    const result = await route(event, {
      path,
      method,
      headers,
      token,
      deviceId,
      queryStringParameters,
      rootCtx,
    });

    rootSpan.setAttribute("http.status_code", result.statusCode);
    return attachTraceId(result, rootSpan);
  } catch (err) {
    console.error("Unhandled API error:", err);
    rootSpan.recordException(err instanceof Error ? err : new Error(String(err)));
    rootSpan.setStatus({ code: SpanStatusCode.ERROR });
    rootSpan.setAttribute("http.status_code", 500);
    return attachTraceId(
      {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Internal server error" }),
      },
      rootSpan,
    );
  } finally {
    rootSpan.end();
    // Pastikan spans/metrics/logs terkirim sebelum lambda berhenti.
    await flushTelemetry();
  }
}

interface RouteContext {
  path: string;
  method: string;
  headers: Record<string, string>;
  token: string;
  deviceId: string;
  queryStringParameters: Record<string, string | undefined>;
  rootCtx: Context;
}

async function route(
  event: HandlerEvent,
  ctx: RouteContext,
): Promise<APIGatewayProxyResult> {
  const { path, method, headers, token, deviceId, queryStringParameters, rootCtx } = ctx;

  // Public routes — skip auth middleware (health + magic-link request/consume).
  const isPublic =
    path === "/api/v1/health" ||
    path === "/api/v1/auth/magic-link" ||
    path === "/api/v1/auth/callback";

  if (!isPublic) {
    const authResult = await validateAuth(token, deviceId, crdb);
    if (!authResult.valid) {
      return {
        statusCode: authResult.statusCode ?? 401,
        headers: corsHeaders(),
        body: JSON.stringify({ error: authResult.error }),
      };
    }
  }

  // Auth (public)
  if (method === "POST" && path === "/api/v1/auth/magic-link") {
    return await handleRequestMagicLink(event, crdb);
  }
  if (method === "POST" && path === "/api/v1/auth/callback") {
    return await handleConsumeMagicLink(event, crdb);
  }

  // Telemetry relay (autentikasi via middleware di atas)
  if (method === "POST" && path === "/api/v1/telemetry") {
    return await handleTelemetryRelay(event);
  }

  // Chat
  if (method === "POST" && path === "/api/v1/chat/turn") {
    return await handleChatTurn(event, crdb, llm, token, deviceId, rootCtx);
  }

  // Memory CRUD
  if (method === "GET" && path === "/api/v1/memory") {
    return await handleListMemory(crdb, token, deviceId);
  }
  if (method === "POST" && path === "/api/v1/memory") {
    return await handleUpsertMemory(event, crdb, token, deviceId);
  }
  if (method === "DELETE" && path.startsWith("/api/v1/memory/edge/")) {
    const id = path.split("/").pop()!;
    return await handleDeleteMemoryEdge(id, crdb, token, deviceId);
  }
  if (method === "DELETE" && path.startsWith("/api/v1/memory/")) {
    const id = path.split("/").pop()!;
    return await handleDeleteMemory(id, crdb, token, deviceId);
  }
  if (method === "GET" && path === "/api/v1/memory/semantic") {
    const qs = queryStringParameters;
    return await handleSemanticSearch(qs, crdb, llm, token, deviceId);
  }

  // Sessions
  if (method === "POST" && path === "/api/v1/session") {
    return await handleSaveSession(event, crdb, token, deviceId);
  }
  if (method === "GET" && path === "/api/v1/sessions") {
    const qs = queryStringParameters;
    return await handleListSessions(qs, crdb, token, deviceId);
  }
  if (method === "GET" && path.startsWith("/api/v1/session/") && path.endsWith("/turns")) {
    const sessionId = path.split("/").filter(Boolean).at(-2) ?? "";
    return await handleListSessionTurns(sessionId, crdb, token, deviceId);
  }

  // Export
  if (method === "POST" && path === "/api/v1/export") {
    return await handleExport(event, crdb, s3, token, deviceId);
  }

  // Purge
  if (method === "POST" && path === "/api/v1/purge") {
    return await handlePurge(event, crdb, token, deviceId);
  }

  // Metrics
  if (method === "GET" && path === "/api/v1/metrics") {
    return await handleMetrics(crdb, token, deviceId);
  }

  // Health
  if (method === "GET" && path === "/api/v1/health") {
    return await handleHealth(crdb, llm, s3);
  }

  return notFound();
}

/** Suntikkan X-Trace-Id ke header response (tanpa mengubah CORS headers). */
function attachTraceId(result: APIGatewayProxyResult, span: { spanContext(): { traceId: string } }): APIGatewayProxyResult {
  const traceId = span.spanContext().traceId;
  if (traceId) {
    result.headers = { ...(result.headers ?? {}), "X-Trace-Id": traceId };
  }
  return result;
}

function corsHeaders(): Record<string, string> {
  const origin = process.env.ALLOWED_ORIGIN;
  if (!origin) {
    // Fail-loud: never silently deploy with wildcard CORS. If ALLOWED_ORIGIN is
    // missing we still respond (hackathon default) but log so it can't be missed.
    console.warn("[cors] ALLOWED_ORIGIN is not set — falling back to '*' (set it in production)");
  }
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id,traceparent",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function notFound(): APIGatewayProxyResult {
  return {
    statusCode: 404,
    headers: corsHeaders(),
    body: JSON.stringify({ error: "Not found" }),
  };
}

function parseQueryString(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split("&")) {
    if (!pair) continue;
    const [key, value] = pair.split("=");
    out[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
  }
  return out;
}
