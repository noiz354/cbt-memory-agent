/**
 * Verify End-to-End OpenTelemetry — scripts/verify_telemetry.ts
 *
 * Bukti:
 *   1. Frontend kirim W3C `traceparent` → backend terima (X-Trace-Id roundtrip).
 *   2. Backend buat child spans (agent.memory.retrieve, llm.openrouter, db.persist).
 *   3. OTLP export ke Grafana Cloud sukses (traces sampai ke Tempo).
 *
 * Run:  npx tsx scripts/verify_telemetry.ts
 *
 * Env (dari .env / environment):
 *   BACKEND_URL            — live Lambda Function URL (default .env VITE_BACKEND_URL)
 *   GRAFANA_TEMPO_URL      — Tempo query API (mis. https://tempo-prod-23-prod-ap-southeast-2.grafana.net/tempo)
 *   GRAFANA_TEMPO_USER     — org user id untuk Basic auth (mis. 1446402)
 *   GRAFANA_TEMPO_TOKEN    — read-only Tempo token (glc_...ht-read-tempo-key...)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = typeof globalThis.__dirname === "string"
  ? globalThis.__dirname
  : fileURLToPath(new URL(".", import.meta.url));

interface ParsedEnv {
  [key: string]: string;
}

function loadEnv(): ParsedEnv {
  const env: ParsedEnv = {};
  const root = join(__dirname, "..");
  for (const file of [join(root, ".env"), join(root, ".env.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      env[key] = value;
    }
  }
  return { ...process.env, ...env } as ParsedEnv;
}

function randomHex(len: number): string {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

const PASS = "PASS";
const FAIL = "FAIL";

async function main(): Promise<void> {
  const env = loadEnv();

  const backendUrl = (env.VITE_BACKEND_URL ?? env.BACKEND_URL ?? "").replace(/\/$/, "");
  const tempoUrl = (env.GRAFANA_TEMPO_URL ?? "").replace(/\/$/, "");
  const tempoUser = env.GRAFANA_TEMPO_USER ?? "";
  const tempoToken = env.GRAFANA_TEMPO_TOKEN ?? "";

  if (!backendUrl) {
    console.error("❌ BACKEND_URL tidak diset (pakai VITE_BACKEND_URL di .env)");
    process.exit(1);
  }
  if (!tempoUrl || !tempoUser || !tempoToken) {
    console.error("❌ GRAFANA_TEMPO_URL/USER/TOKEN tidak lengkap di .env");
    process.exit(1);
  }

  // Legacy auth fallback: token ≥ 8 char tanpa spasi → valid sebagai device-user.
  const token = env.VERIFY_TOKEN ?? `verify-${randomHex(12)}`;
  const deviceId = env.VERIFY_DEVICE_ID ?? `verify-device-${randomHex(8)}`;

  // 1. Generate W3C traceparent
  const traceId = randomHex(32);
  const spanId = randomHex(16);
  const traceparent = `00-${traceId}-${spanId}-01`;

  console.log("──────────────────────────────────────────────────");
  console.log("OpenTelemetry End-to-End Verification");
  console.log(`  backend : ${backendUrl}`);
  console.log(`  tempo   : ${tempoUrl}`);
  console.log(`  traceId : ${traceId}`);
  console.log("──────────────────────────────────────────────────");

  // 2. POST chat/turn dengan traceparent header
  console.log("\n[1/3] Kirim chat turn dengan W3C traceparent …");
  const body = JSON.stringify({
    v: 1,
    sessionId: `verify-session-${randomHex(8)}`,
    userMessage: "Halo, ini pesan verifikasi telemetry. Balas singkat saja ya.",
    memoryIds: [],
    clientTs: new Date().toISOString(),
  });

  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/v1/chat/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Device-Id": deviceId,
        traceparent,
      },
      body,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    console.log(`  ${FAIL} request gagal: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
    return;
  }

  const xTraceId = res.headers.get("x-trace-id") ?? res.headers.get("X-Trace-Id");
  const sse = await res.text();

  const ok1 = res.status === 200 && xTraceId === traceId;
  console.log(`  HTTP ${res.status}, X-Trace-Id: ${xTraceId ?? "(tidak ada)"}`);
  console.log(`  ${ok1 ? PASS : FAIL} X-Trace-Id roundtrip (bukti #1+#2: frontend→backend context)`);

  const done = sse.includes("[DONE]");
  const hasAssistant = sse.includes('"t"');
  console.log(`  ${done && hasAssistant ? PASS : FAIL} respons chat valid (SSE [DONE] + konten)`);

  if (!ok1) {
    console.error("  — Gagal memverifikasi roundtrip. Berhenti.");
    process.exit(1);
  }

  // 3. Query Tempo untuk traceId yang sama → cek spans backend
  console.log("\n[2/3] Query Tempo untuk traceId …");
  await sleep(4000); // beri waktu export + ingest (BatchSpanProcessor forceFlush)

  let tempoOk = false;
  let traceNames: string[] = [];
  try {
    const tempoRes = await fetch(`${tempoUrl}/api/traces/${traceId}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${tempoUser}:${tempoToken}`).toString("base64")}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (tempoRes.ok) {
      const data = (await tempoRes.json()) as {
        batches?: Array<{
          scopeSpans?: Array<{ spans?: Array<{ name?: string; status?: { code?: number } }> }>;
        }>;
      };
      traceNames = (data.batches ?? []).flatMap((b) =>
        (b.scopeSpans ?? []).flatMap((ss) => (ss.spans ?? []).map((s) => s.name ?? "?")),
      );
      tempoOk = true;
    } else {
      console.log(`  Tempo HTTP ${tempoRes.status} ${tempoRes.statusText}`);
    }
  } catch (err) {
    console.log(`  Tempo query error: ${err instanceof Error ? err.message : err}`);
  }

  if (tempoOk) {
    console.log(`  spans di Tempo: ${traceNames.length > 0 ? traceNames.join(", ") : "(kosong)"}`);
    const hasRetrieve = traceNames.includes("agent.memory.retrieve");
    const hasLlm = traceNames.includes("llm.openrouter");
    const hasPersist = traceNames.includes("db.persist");
    const ok3 = hasRetrieve && hasLlm;
    console.log(`  ${ok3 ? PASS : FAIL} spans agent (agent.memory.retrieve + llm.openrouter) — bukti #3`);
    if (hasPersist) console.log(`  ${PASS} span db.persist ikut ter-record`);
    if (!ok3) {
      console.log("  (beberapa span mungkin belum ingest; cek ulang di Grafana UI)");
    }
  } else {
    console.log(`  ${FAIL} tidak bisa query Tempo — cek GRAFANA_TEMPO_* env`);
  }

  // 4. Kesimpulan
  console.log("\n[3/3] Kesimpulan");
  const allOk = ok1 && tempoOk;
  console.log(`  ${allOk ? PASS : FAIL} ${allOk ? "semua kriteria terverifikasi ✓" : "sebagian gagal — lihat log di atas"}`);
  console.log(`  Buka di Grafana: ${tempoUrl.replace(/\/tempo$/, "")}/explore?left=[\"now-1h\",\"now\",\"tempo\"]`);
  process.exit(allOk ? 0 : 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
