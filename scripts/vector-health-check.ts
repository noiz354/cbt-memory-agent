/**
 * Vector Health Check (Gap utilisasi vector — observability otomatis)
 *
 * Health-check pipeline embedding/retrieval di CockroachDB:
 *   1. Coverage embedding per user NYATA (exclude user loadtest md5('loadtest-vectors')).
 *   2. Expression full-text INVERTED INDEX `memory_nodes_search_idx` aktif.
 *   3. EXPLAIN ANALYZE query vector chat → operator `vector search` (anti full-scan).
 *
 * Exit 0 = sehat, 1 = ada regresi (dipakai CI / scheduled workflow).
 *
 * Run:  npx tsx scripts/vector-health-check.ts [--min-coverage 95] [--json]
 * Env : CRDB_CONNECTION_URL (dari .env / environment)
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

interface CoverageRow {
  user_id: string;
  total_nodes: number;
  nodes_with_embedding: number;
  coverage_pct: number;
}

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

async function main(): Promise<void> {
  const env = loadEnv();
  const url = env.CRDB_CONNECTION_URL ?? env.DATABASE_URL;
  if (!url) {
    console.error("CRDB_CONNECTION_URL missing — set in .env");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const minCoverage = Number(args.includes("--min-coverage") ? args[args.indexOf("--min-coverage") + 1] : 95);
  const asJson = args.includes("--json");

  const loadtestUser = md5Uuid("loadtest-vectors");
  const probe = Array.from({ length: 1024 }, () => 0.1);
  const probeLiteral = toVectorLiteral(probe);

  const pool = new Pool({ connectionString: url, max: 2 });
  const report: Record<string, unknown> = { ok: true, checks: {} };

  try {
    // 1) Coverage per user nyata
    const coverageRes = await pool.query<CoverageRow>(
      `SELECT mn.user_id,
              COUNT(*)::int AS total_nodes,
              COUNT(DISTINCT e.node_id)::int AS nodes_with_embedding,
              ROUND(COUNT(DISTINCT e.node_id)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS coverage_pct
       FROM memory_nodes mn
       LEFT JOIN embeddings e ON e.node_id = mn.id AND e.user_id = mn.user_id
       WHERE mn.user_id <> $1::uuid
       GROUP BY mn.user_id
       ORDER BY total_nodes DESC`,
      [loadtestUser],
    );

    const lowCoverage = coverageRes.rows.filter((r) => r.coverage_pct < minCoverage);
    report.checks.coverage = {
      min_coverage: minCoverage,
      users: coverageRes.rows.map((r) => ({
        user_id: r.user_id,
        total_nodes: r.total_nodes,
        nodes_with_embedding: r.nodes_with_embedding,
        coverage_pct: r.coverage_pct,
      })),
      violations: lowCoverage.map((r) => ({ user_id: r.user_id, coverage_pct: r.coverage_pct })),
    };

    // 2) Full-text expression index aktif (memory_nodes_search_idx)
    const ftsRes = await pool.query<{ has_index: boolean }>(
      `SELECT
         (SELECT count(*) FROM pg_indexes
          WHERE schemaname='public' AND tablename='memory_nodes' AND indexname='memory_nodes_search_idx')::int = 1 AS has_index`,
    );
    const fts = ftsRes.rows[0];
    report.checks.fulltext = fts;

    // 3) EXPLAIN ANALYZE → operator `vector search`
    const explainSql = VECTOR_QUERY.replace(/\s+/g, " ")
      .replace(/\$1::uuid/g, `'${loadtestUser}'::uuid`)
      .replace(/\$2::vector/g, `'${probeLiteral}'::vector`)
      .trim();
    const explainRes = await pool.query(`EXPLAIN ANALYZE ${explainSql}`);
    const plan = explainRes.rows.map((r: any) => Object.values(r)[0]).join("\n");
    const hasVectorSearch = /vector search/i.test(plan);
    report.checks.vector_search = { ok: hasVectorSearch };

    if (!asJson) {
      console.log("── Vector Health Check ───────────────────────");
      for (const u of (report.checks.coverage as any).users) {
        console.log(`  coverage ${u.user_id.slice(0, 8)}… : ${u.nodes_with_embedding}/${u.total_nodes} (${u.coverage_pct}%)`);
      }
      console.log(`  fulltext index           : ${fts.has_index}`);
      console.log(`  EXPLAIN vector search    : ${hasVectorSearch ? "YES ✓" : "NO — full scan?!"}`);
      console.log("───────────────────────────────────────────────");
    }

    const ok = lowCoverage.length === 0 && fts.has_index && hasVectorSearch;
    report.ok = ok;
    if (asJson) console.log(JSON.stringify(report, null, 2));

    if (!ok) {
      console.error(`\n✗ Vector health check FAILED (min coverage ${minCoverage}%).`);
      process.exit(1);
    }
    console.log(`\n✓ Vector health check OK (${coverageRes.rows.length} user(s), min coverage ${minCoverage}%).`);
  } finally {
    await pool.end();
  }
}

main();
