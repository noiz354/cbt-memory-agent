/**
 * Telemetry Relay Handler — POST /api/v1/telemetry
 *
 * Frontend browser OTLP spans tidak bisa ekspor langsung ke Grafana karena token
 * tidak boleh bocor ke bundle browser. Endpoint ini menerima raw body OTLP dari
 * browser, lalu meneruskan (passthrough) ke Grafana Cloud OTLP gateway.
 *
 * Alur:
 *   1. Auth middleware (handler.ts) sudah memvalidasi token + device.
 *   2. Terima body + Content-Type apa adanya.
 *   3. POST body yang sama ke `${OTLP_ENDPOINT}/v1/traces` dengan header
 *      Authorization dari env (server-side, tidak pernah terekspos ke browser).
 *   4. Return status upstream; gagal → 502 (bukan crash).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

export async function handleTelemetryRelay(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const authHeader = process.env.OTEL_EXPORTER_OTLP_HEADERS;

  if (!endpoint || !authHeader) {
    console.error("[telemetry] OTLP endpoint/auth not configured");
    return {
      statusCode: 502,
      headers: relayCors(),
      body: JSON.stringify({ error: "Telemetry not configured" }),
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
      body: JSON.stringify({ error: "Payload too large" }),
    };
  }

  const payload = isBase64 ? Buffer.from(body, "base64") : Buffer.from(body, "utf8");
  const contentType = event.headers?.["Content-Type"] ?? event.headers?.["content-type"] ?? "application/x-protobuf";

  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
      method: "POST",
      headers: {
        ...parseKeyValueHeaders(authHeader),
        "Content-Type": contentType,
      },
      body: payload,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[telemetry] upstream ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
      return {
        statusCode: 502,
        headers: relayCors(),
        body: JSON.stringify({ error: "Telemetry upstream failed" }),
      };
    }

    console.log("[telemetry] OTLP export 200/OK");
    return {
      statusCode: 200,
      headers: relayCors(),
      body: "",
    };
  } catch (err) {
    console.error("[telemetry] relay error:", err);
    return {
      statusCode: 502,
      headers: relayCors(),
      body: JSON.stringify({ error: "Telemetry relay failed" }),
    };
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
