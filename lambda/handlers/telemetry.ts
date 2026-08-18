/**
 * Telemetry Relay Handler — POST /api/v1/telemetry
 *
 * Frontend browser OTLP spans tidak bisa ekspor langsung ke Grafana karena token
 * tidak boleh bocor ke bundle browser. Endpoint ini menerima raw body OTLP dari
 * browser, lalu meneruskan (fan-out) ke Grafana Cloud OTLP gateway (wajib) dan
 * Arize Phoenix (opsional, LLM observability).
 *
 * Alur:
 *   1. Auth middleware (handler.ts) sudah memvalidasi token + device.
 *   2. Terima body + Content-Type apa adanya (browser kini mengirim protobuf).
 *   3. POST body yang sama (byte-identik) ke `${OTLP_ENDPOINT}/v1/traces` dan
 *      `${PHOENIX_OTLP_ENDPOINT}/v1/traces` dengan header dari env (server-side,
 *      tidak pernah terekspos ke browser).
 *   4. Grafana = sink wajib: gagal → 502 (bukan crash). Phoenix = opsional:
 *      gagal sendirian hanya dilaporkan, browser tetap mendapat 200.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { randomInt } from "node:crypto";
import { logger } from "../lib/logger";
import { AppError, errorEnvelope, reportError } from "../lib/errors";

export async function handleTelemetryRelay(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const authHeader = process.env.OTEL_EXPORTER_OTLP_HEADERS;

  if (!endpoint || !authHeader) {
    reportError(new AppError("dependency.telemetry_unavailable", { message: "OTLP endpoint/auth not configured" }));
    return {
      statusCode: 502,
      headers: relayCors(),
      body: JSON.stringify(errorEnvelope(new AppError("dependency.telemetry_unavailable"))),
    };
  }

  const body = event.body ?? "";
  const isBase64 = Boolean(event.isBase64Encoded);
  const contentLength = isBase64 ? body.length : Buffer.byteLength(body, "utf8");
  const maxBytes = 3 * 1024 * 1024; // 3 MB guard — spans tidak pernah sebesar ini
  if (contentLength > maxBytes) {
    return {
      statusCode: 413,
      headers: relayCors(),
      body: JSON.stringify(errorEnvelope(new AppError("validation.payload_too_large"))),
    };
  }

  // Head sampling di relay (pengganti Collector): browser mengirim 100% span,
  // relay memutuskan apakah batch diteruskan. Ratio dari env, default 1.0.
  const sampleRatio = Number(process.env.OTEL_RELAY_SAMPLING_RATIO ?? 1.0);
  if (sampleRatio < 1) {
    const keep = sampleRatio > 0 && randomInt(0, 10000) < sampleRatio * 10000;
    if (!keep) {
      logger.info("telemetry.sampled_out", "OTLP batch sampled out by relay", {
        ratio: sampleRatio,
      });
      return {
        statusCode: 204,
        headers: relayCors(),
        body: "",
      };
    }
  }

  const payload = isBase64 ? Buffer.from(body, "base64") : Buffer.from(body, "utf8");
  const contentType = event.headers?.["Content-Type"] ?? event.headers?.["content-type"] ?? "application/x-protobuf";

  // Fan-out ke beberapa sink:
  //   1. Grafana Tempo — wajib (ops umum). Gagal → 502 seperti sebelumnya.
  //   2. Arize Phoenix — opsional (LLM observability). Browser TIDAK boleh gagal
  //      hanya karena Phoenix down → kegagalan Phoenix dilaporkan tapi 200 tetap.
  // Sink menerima BYTES yang sama (browser kini mengirim protobuf, yang diterima
  // Phoenix; JSON hanya diterima Grafana versi HTTP).
  const failures: string[] = [];

  const grafanaOk = await forwardSink(
    `${endpoint.replace(/\/$/, "")}/v1/traces`,
    parseKeyValueHeaders(authHeader),
    payload,
    contentType,
  );
  if (!grafanaOk) failures.push("grafana");

  const phoenixEndpoint = process.env.PHOENIX_OTLP_ENDPOINT;
  const phoenixHeaders = process.env.PHOENIX_OTLP_HEADERS;
  if (phoenixEndpoint && phoenixHeaders) {
    const phoenixOk = await forwardSink(
      `${phoenixEndpoint.replace(/\/$/, "")}/v1/traces`,
      parseKeyValueHeaders(phoenixHeaders),
      payload,
      contentType,
    );
    if (!phoenixOk) failures.push("phoenix");
  }

  const failed = failures.includes("grafana");
  if (failed) {
    reportError(new AppError("dependency.telemetry_unavailable", { message: "telemetry upstream grafana failed" }));
    return {
      statusCode: 502,
      headers: relayCors(),
      body: JSON.stringify(errorEnvelope(new AppError("dependency.telemetry_unavailable"))),
    };
  }

  if (failures.includes("phoenix")) {
    reportError(new AppError("dependency.phoenix_unavailable", { message: "phoenix upstream failed" }));
  }

  logger.info("telemetry.export_ok", "OTLP export 200/OK");
  return {
    statusCode: 200,
    headers: relayCors(),
    body: "",
  };
}

async function forwardSink(
  url: string,
  headers: Record<string, string>,
  payload: Buffer,
  contentType: string,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": contentType },
      body: payload,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function relayCors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id,traceparent",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  };
}

/**
 * Parse format env OTel: `Authorization=Basic <b64>,OtherKey=value` → record.
 * Nilai boleh mengandung `=` (mis. Basic base64), jadi split hanya pada `=` pertama.
 */
function parseKeyValueHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}
