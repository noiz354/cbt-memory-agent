/**
 * Health + Metrics Handlers — GET /api/v1/health, /api/v1/metrics
 */

import { APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { OpenRouterClient } from "../lib/openrouter";
import { S3ClientService } from "../lib/s3";

export async function handleHealth(
  crdb: CrdbClient,
  llm: OpenRouterClient,
  s3: S3ClientService,
): Promise<APIGatewayProxyResult> {
  const [crdbOk, llmOk, s3Ok] = await Promise.all([
    crdb.healthCheck(),
    llm.healthCheck(),
    s3.healthCheck(),
  ]);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: crdbOk && llmOk && s3Ok ? "ok" : "degraded",
      crdb: crdbOk ? "connected" : "disconnected",
      llm: llmOk ? "available" : "unavailable",
      s3: s3Ok ? "available" : "unavailable",
      version: "0.1.0",
    }),
  };
}

export async function handleMetrics(
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  // TODO: Implement
  return {
    statusCode: 200,
    body: JSON.stringify({ v: 2, metrics: [], northStar: {}, guardrails: {} }),
  };
}
