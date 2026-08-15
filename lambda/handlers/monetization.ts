/**
 * Monetization Handlers — GET /api/v1/monetization/cac, /api/v1/monetization/summary
 *
 * Endpoint baca untuk verifikasi live + integrasi dashboard. Metrik utama
 * dihitung di SQL (schema/monetization-queries.sql) untuk panel Grafana;
 * endpoint ini memakai lib yang sama (parameterized, NULLIF-safe).
 */

import { APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { calculateCAC, getMonetizationSummary } from "../lib/monetization";

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

export async function handleMonetizationCac(
  queryStringParameters: Record<string, string | undefined>,
  crdb: CrdbClient,
): Promise<APIGatewayProxyResult> {
  const { period, error } = resolvePeriod(queryStringParameters.period);
  if (error) return json(400, { error });

  const result = await calculateCAC(crdb, period);
  return json(200, { v: 1, period, ...result });
}

export async function handleMonetizationSummary(
  queryStringParameters: Record<string, string | undefined>,
  crdb: CrdbClient,
): Promise<APIGatewayProxyResult> {
  const { period, error } = resolvePeriod(queryStringParameters.period);
  if (error) return json(400, { error });

  const grossMargin = queryStringParameters.grossMargin !== undefined
    ? Number(queryStringParameters.grossMargin)
    : undefined;
  const churnRate = queryStringParameters.churnRate !== undefined
    ? Number(queryStringParameters.churnRate)
    : undefined;

  if (grossMargin !== undefined && (Number.isNaN(grossMargin) || grossMargin <= 0)) {
    return json(400, { error: "grossMargin must be a positive number" });
  }
  if (churnRate !== undefined && (Number.isNaN(churnRate) || churnRate < 0)) {
    return json(400, { error: "churnRate must be a non-negative number" });
  }

  const summary = await getMonetizationSummary(crdb, period, { grossMargin, churnRate });
  return json(200, { v: 1, period, ...summary });
}
