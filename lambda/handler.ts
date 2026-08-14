/**
 * Lambda Handler — Main entry point for API Gateway.
 *
 * Routes 11 endpoints to their respective handlers.
 * Auth middleware validates session token + device ID.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "./lib/crdb";
import { OpenRouterClient } from "./lib/openrouter";
import { S3ClientService } from "./lib/s3";
import { validateAuth } from "./middleware/auth";
import { handleChatTurn } from "./handlers/chatTurn";
import { handleListMemory, handleUpsertMemory, handleDeleteMemory } from "./handlers/memory";
import { handleSemanticSearch } from "./handlers/semanticSearch";
import { handleSaveSession, handleListSessions } from "./handlers/session";
import { handleExport } from "./handlers/export";
import { handlePurge } from "./handlers/purge";
import { handleMetrics, handleHealth } from "./handlers/health";

const crdb = new CrdbClient(process.env.CRDB_CONNECTION!);
const llm = new OpenRouterClient();
const s3 = new S3ClientService(process.env.S3_BUCKET ?? "cbt-memory-exports");

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const method = event.httpMethod;
  const headers = event.headers || {};
  const token = headers["Authorization"]?.replace("Bearer ", "") ?? "";
  const deviceId = headers["X-Device-Id"] ?? "";

  // Auth middleware — skip for health check
  if (path !== "/api/v1/health") {
    const authResult = validateAuth(token, deviceId);
    if (!authResult.valid) {
      return {
        statusCode: authResult.statusCode ?? 401,
        headers: corsHeaders(),
        body: JSON.stringify({ error: authResult.error }),
      };
    }
  }

  // Route handling
  try {
    // Chat
    if (method === "POST" && path === "/api/v1/chat/turn") {
      return await handleChatTurn(event, crdb, llm, token, deviceId);
    }

    // Memory CRUD
    if (method === "GET" && path === "/api/v1/memory") {
      return await handleListMemory(crdb, token, deviceId);
    }
    if (method === "POST" && path === "/api/v1/memory") {
      return await handleUpsertMemory(event, crdb, token, deviceId);
    }
    if (method === "DELETE" && path.startsWith("/api/v1/memory/")) {
      const id = path.split("/").pop()!;
      return await handleDeleteMemory(id, crdb, token, deviceId);
    }
    if (method === "GET" && path === "/api/v1/memory/semantic") {
      const qs = event.queryStringParameters || {};
      return await handleSemanticSearch(qs, crdb, llm, token, deviceId);
    }

    // Sessions
    if (method === "POST" && path === "/api/v1/session") {
      return await handleSaveSession(event, crdb, token, deviceId);
    }
    if (method === "GET" && path === "/api/v1/sessions") {
      const qs = event.queryStringParameters || {};
      return await handleListSessions(qs, crdb, token, deviceId);
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
  } catch (err) {
    console.error("Unhandled API error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
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
