/**
 * Load Test Vector Indexing (FASE Vector Indexing — Gap 7)
 *
 * Membuktikan index C-SPANN bekerja di skala: seed ribuan embeddings sintetis ke
 * user fake, EXPLAIN ANALYZE → pastikan operator `vector search` (bukan full scan),
 * lalu ukur latensi p50/p95 dengan tuning beam/partition.
 *
 * Run:  npx tsx scripts/load-test-vectors.ts [--seed 10000] [--fresh] [--cleanup]
 * Env : CRDB_CONNECTION_URL (dari .env)
 *
 * CATATAN:
 *   - User fake (md5('loadtest-vectors')::uuid) + node id `lt-<n>` — tidak
 *     mencemari data user nyata. Wipe otomatis saat --fresh, atau --cleanup.
 *   - Seed via generate_series server-side (satu statement besar tanpa batas
 *     placeholder client); resume otomatis dari count existing (tanpa --fresh).
 *   - Tidak memakai OpenRouter: embedding sintetis (random server-side).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const lambdaRequire = createRequire(new URL("../lambda/package.json", import.meta.url));
const { Pool } = lambdaRequire("pg") as typeof import("pg");

import { toVectorLiteral } from "../lambda/lib/vectors";

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
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  return { ...process.env, ...env };
}

function md5Uuid(input: string): string {
  const hash = createHash("md5").update(input).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/** Cosine query chat-vector (identik dengan lambda/handlers/chatTurn.ts vector path). */
const VECTOR_QUERY = `
SELECT mn.id, mn.title
FROM memory_nodes mn
JOIN (SELECT e.node_id, e.embedding <=> $2::vector AS distance
      FROM embeddings e
      WHERE e.user_id = $1::uuid
      ORDER BY e.embedding <=> $2::vector
      LIMIT 16) sub ON sub.node_id = mn.id
WHERE mn.user_id = $1::uuid
  AND mn.verified = true
  AND mn.confidence >= 0.6
ORDER BY sub.distance`;

function pct(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length));
  return sorted[idx];
}

async function bench(pool: any, userId: string, embedding: string, runs = 30): Promise<{ p50: number; p95: number; first: number }> {
  const latencies: number[] = [];
  let first = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await pool.query(VECTOR_QUERY, [userId, embedding]);
    const ms = performance.now() - t0;
    latencies.push(ms);
    if (i === 0) first = ms;
  }
  latencies.sort((a, b) => a - b);
  return { p50: pct(latencies, 50), p95: pct(latencies, 95), first };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const url = env.CRDB_CONNECTION_URL ?? env.DATABASE_URL;
  if (!url) {
    console.error("CRDB_CONNECTION_URL missing — set in .env");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const seedArg = args.includes("--seed") ? Number(args[args.indexOf("--seed") + 1]) : 10_000;
  const seedCount = Number.isFinite(seedArg) ? seedArg : 10_000;
  const fresh = args.includes("--fresh");
  const cleanup = args.includes("--cleanup");

  const userId = md5Uuid("loadtest-vectors");
  const pool = new Pool({ connectionString: url, max: 4 });

  try {
    // 0) Wipe seed lama (CASCADE dari memory_nodes → embeddings) — hanya saat --fresh
    if (fresh) {
      await pool.query(`DELETE FROM memory_nodes WHERE user_id = $1::uuid`, [userId]);
      console.log(`Fresh wipe: semua data loadtest user ${userId} dihapus.`);
    }

    if (cleanup) {
      console.log(`Cleanup: semua data loadtest user ${userId} dihapus.`);
      return;
    }

    // 1) Pastikan user ada
    await pool.query(
      `INSERT INTO users (id, email, display_name, auth_method)
       VALUES ($1::uuid, 'loadtest-vectors@local.test', 'loadtest-vectors', 'passkey')
       ON CONFLICT (id) DO NOTHING`,
      [userId],
    );

    // 2) Seed memory_nodes + embeddings (server-side generate_series, resume dari existing)
    const existing = await pool.query(
      `SELECT count(*)::int AS n FROM embeddings WHERE user_id = $1::uuid AND text_source = 'loadtest'`,
      [userId],
    );
    const start = existing.rows[0].n;
    console.log(`Existing loadtest embeddings: ${start}. Target: ${seedCount}.`);

    if (start < seedCount) {
      console.log(`Seeding ${seedCount - start} memory_nodes + embeddings...`);
      await pool.query(
        `INSERT INTO memory_nodes (id, user_id, kind, title, excerpt, tags, weight, confidence, verified, ref_count, last_touched)
         SELECT 'lt-' || g, $1::uuid, 'core',
                'Memory node #' || g || ' — tema ' || (g % 20) || ' anxiety trigger ' || (g % 7),
                'Excerpt sintetis #' || g || ' berisi konteks CBT untuk load test.',
                ARRAY['loadtest', 'tema-' || (g % 5)],
                0.3 + 0.7 * random(),
                0.6 + 0.4 * random(),
                true,
                (g % 10)::int,
                now()
         FROM generate_series($2::int, $3::int - 1) AS g
         ON CONFLICT (id) DO NOTHING`,
        [userId, start, seedCount],
      );
      await pool.query(
        `INSERT INTO embeddings (user_id, node_id, embedding, text_source)
         SELECT $1::uuid, 'lt-' || g,
                (SELECT ('[' || string_agg((random() * 2 - 1)::text, ',') || ']') FROM generate_series(1, 1024))::vector,
                'loadtest'
         FROM generate_series($2::int, $3::int - 1) AS g`,
        [userId, start, seedCount],
      );
      const after = await pool.query(
        `SELECT count(*)::int AS n FROM embeddings WHERE user_id = $1::uuid AND text_source = 'loadtest'`,
        [userId],
      );
      console.log(`Seeded. Total loadtest embeddings sekarang: ${after.rows[0].n}.`);
    }

    // 3) EXPLAIN ANALYZE → buktikan `vector search` (bukan full scan)
    // EXPLAIN tidak mendukung placeholders → inline user_id + literal vektor.
    const probe = Array.from({ length: 1024 }, () => 0.1);
    const probeLiteral = toVectorLiteral(probe);
    const explainSql =
      VECTOR_QUERY.replace(/\s+/g, " ")
        .replace(/\$1::uuid/g, `'${userId}'::uuid`)
        .replace(/\$2::vector/g, `'${probeLiteral}'::vector`)
        .trim();
    const explainRes = await pool.query(`EXPLAIN ANALYZE ${explainSql}`);
    const plan = explainRes.rows.map((r: any) => Object.values(r)[0]).join("\n");
    const hasVectorSearch = /vector search/i.test(plan);
    console.log("\n── EXPLAIN ANALYZE ──");
    console.log(plan);
    console.log(`\nVector search operator: ${hasVectorSearch ? "YES ✓" : "NO — full scan?!"}`);

    // 4) Latensi baseline (default settings)
    const base = await bench(pool, userId, toVectorLiteral(probe));
    console.log(`\nLatency (default settings): first=${base.first.toFixed(1)}ms p50=${base.p50.toFixed(1)}ms p95=${base.p95.toFixed(1)}ms`);

    // 5) Tuning session — beam
    for (const settings of [
      { name: "beam=64", sql: `SET vector_search_beam_size = 64` },
      { name: "beam=128", sql: `SET vector_search_beam_size = 128` },
    ]) {
      try {
        await pool.query(settings.sql);
        const r = await bench(pool, userId, toVectorLiteral(probe), 15);
        console.log(`Tuning ${settings.name}: p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms`);
      } catch (err) {
        console.log(`Tuning ${settings.name}: SKIP (${err instanceof Error ? err.message : String(err)})`);
      }
      await pool.query(`RESET vector_search_beam_size`);
    }

    console.log("\nLoad test selesai. Jalankan --cleanup untuk menghapus data seed.");
  } finally {
    await pool.end();
  }
}

main();
