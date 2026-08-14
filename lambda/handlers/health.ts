/**
 * Health + Metrics Handlers — GET /api/v1/health, /api/v1/metrics
 */

import { APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { BedrockClient } from "../lib/bedrock";
import { S3ClientService } from "../lib/s3";

export async function handleHealth(
  crdb: CrdbClient,
  bedrock: BedrockClient,
  s3: S3ClientService,
): Promise<APIGatewayProxyResult> {
  const [crdbOk, bedrockOk, s3Ok] = await Promise.all([
    crdb.healthCheck(),
    bedrock.healthCheck(),
    s3.healthCheck(),
  ]);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: crdbOk && bedrockOk && s3Ok ? "ok" : "degraded",
      crdb: crdbOk ? "connected" : "disconnected",
      bedrock: bedrockOk ? "available" : "unavailable",
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
