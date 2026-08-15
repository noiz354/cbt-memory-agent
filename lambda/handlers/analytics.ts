/**
 * Analytics Handlers — GET /api/v1/analytics/funnel, /activity, /retention
 *
 * Endpoint agregat lintas-user untuk panel Grafana + verifikasi live.
 * Semua pembagian NULLIF-safe (lib mengembalikan null, bukan NaN/Infinity).
 */

import { APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import {
  ACTIVATION_FUNNEL_STEPS,
  getActivity,
  getFunnel,
  getRetention,
} from "../lib/analytics";
import { isAllowedEventName } from "../lib/eventCatalog";

const PERIOD_RE = /^\d{4}-\d{2}(-\d{2})?$/;

function resolvePeriod(raw: string | undefined): { period: string; error?: string } {
  if (!raw) {
    const now = new Date();
    return { period: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}` };
  }
  if (!PERIOD_RE.test(raw)) return { period: raw, error: "period must be YYYY-MM or YYYY-MM-DD" };
  return { period: raw };
}

function json(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function parseSteps(raw: string | undefined): { steps?: readonly string[]; error?: string } {
  if (!raw) return { steps: ACTIVATION_FUNNEL_STEPS };
  const steps = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (steps.length === 0) return { error: "steps must be a non-empty comma-separated list" };
  if (steps.some((s) => !isAllowedEventName(s))) {
    return { error: "steps contain an event not in the tracked catalog" };
  }
  return { steps };
}

export async function handleAnalyticsFunnel(
  queryStringParameters: Record<string, string | undefined>,
  crdb: CrdbClient,
): Promise<APIGatewayProxyResult> {
  const { period, error } = resolvePeriod(queryStringParameters.period);
  if (error) return json(400, { error });

  const { steps, error: stepsError } = parseSteps(queryStringParameters.steps);
  if (stepsError) return json(400, { error: stepsError });

  const result = await getFunnel(crdb, period, steps);
  return json(200, { v: 1, period, ...result });
}

export async function handleAnalyticsActivity(
  queryStringParameters: Record<string, string | undefined>,
  crdb: CrdbClient,
): Promise<APIGatewayProxyResult> {
  const { period, error } = resolvePeriod(queryStringParameters.period);
  if (error) return json(400, { error });

  const result = await getActivity(crdb, period);
  return json(200, { v: 1, period, ...result });
}

export async function handleAnalyticsRetention(
  queryStringParameters: Record<string, string | undefined>,
  crdb: CrdbClient,
): Promise<APIGatewayProxyResult> {
  const { period, error } = resolvePeriod(queryStringParameters.period);
  if (error) return json(400, { error });

  const result = await getRetention(crdb, period);
  return json(200, { v: 1, period, ...result });
}
