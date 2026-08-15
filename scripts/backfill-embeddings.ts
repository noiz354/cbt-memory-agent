/**
 * Backfill Embeddings (FASE Vector Indexing — Gap 4)
 *
 * Mengisi embeddings untuk memory node yang belum punya embedding (node lama,
 * seed, atau yang gagal saat upsert). Membaca node via pg Pool, generate
 * embedding via OpenRouter (baai/bge-m3), INSERT per-node (loop, bukan batch —
 * best practice C-SPANN; hindari batch insert vektor).
 *
 * Run:  npx tsx scripts/backfill-embeddings.ts [--user <md5-uuid>|--all] [--dry-run]
 * Env : CRDB_CONNECTION_URL + OPENROUTER_API_KEY (dari .env)
 *
 * Idempotent: hanya memproses node yang TIDAK punya embeddings. Exit non-zero
 * bila ada embedding yang gagal.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const lambdaRequire = createRequire(new URL("../lambda/package.json", import.meta.url));
const { Pool } = lambdaRequire("pg") as typeof import("pg");

import { OpenRouterClient } from "../lambda/lib/openrouter";
import { buildEmbeddingChunks, toVectorLiteral } from "../lambda/lib/vectors";

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

interface NodeRow {
  id: string;
  user_id: string;
  title: string;
  excerpt: string | null;
  tags: string[];
}

async function coverage(pool: any, userId?: string): Promise<{ total: number; embedded: number }> {
  const params = userId ? [userId] : [];
  const where = userId ? "WHERE mn.user_id = $1::uuid" : "";
  const row = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(DISTINCT e.node_id)::int AS embedded
     FROM memory_nodes mn
     LEFT JOIN embeddings e ON e.node_id = mn.id AND e.user_id = mn.user_id
     ${where}`,
    params,
  );
  return { total: row.rows[0].total, embedded: row.rows[0].embedded };
}

function printCoverage(label: string, c: { total: number; embedded: number }): void {
  const pct = c.total > 0 ? ((c.embedded / c.total) * 100).toFixed(1) : "100.0";
  console.log(`  [${label}] ${c.embedded}/${c.total} nodes embedded (${pct}%)`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const url = env.CRDB_CONNECTION_URL ?? env.DATABASE_URL;
  const apiKey = env.OPENROUTER_API_KEY;
  if (!url) {
    console.error("CRDB_CONNECTION_URL missing — set in .env");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY missing — set in .env");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const userFlag = args.includes("--user") ? args[args.indexOf("--user") + 1] : undefined;
  if (userFlag === undefined && args.includes("--all")) {
    // --all = semua user
  } else if (userFlag === undefined) {
    console.error("Pass --all atau --user <md5-uuid>");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 2 });
  const llm = new OpenRouterClient(apiKey);

  try {
    const before = await coverage(pool, userFlag);
    printCoverage("before", before);

    const params = userFlag ? [userFlag] : [];
    const where = userFlag ? "AND mn.user_id = $1::uuid" : "";
    const { rows } = await pool.query<NodeRow>(
      `SELECT mn.id, mn.user_id, mn.title, mn.excerpt, mn.tags
       FROM memory_nodes mn
       LEFT JOIN embeddings e ON e.node_id = mn.id AND e.user_id = mn.user_id
       WHERE e.id IS NULL ${where}
       ORDER BY mn.last_touched DESC`,
      params,
    );

    console.log(`\nFound ${rows.length} node(s) without embeddings. ${dryRun ? "DRY-RUN — no writes." : ""}`);
    if (dryRun) {
      for (const r of rows) console.log(`  - ${r.id} (${r.title})`);
      process.exit(0);
    }

    let done = 0;
    let failed = 0;
    for (const node of rows) {
      const chunks = buildEmbeddingChunks(node);
      if (chunks.length === 0) {
        done += 1;
        continue;
      }
      try {
        await pool.query(`DELETE FROM embeddings WHERE user_id = $1::uuid AND node_id = $2`, [
          node.user_id,
          node.id,
        ]);
        for (const chunk of chunks) {
          const embedding = await llm.generateEmbedding(chunk.text.slice(0, 8000));
          await pool.query(
            `INSERT INTO embeddings (user_id, node_id, embedding, text_source)
             VALUES ($1::uuid, $2, $3, $4)`,
            [node.user_id, node.id, toVectorLiteral(embedding), chunk.textSource],
          );
        }
        done += 1;
        if (done % 10 === 0) console.log(`  ...${done}/${rows.length}`);
      } catch (err) {
        failed += 1;
        console.error(`  FAIL node ${node.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const after = await coverage(pool, userFlag);
    console.log("");
    printCoverage("after", after);
    console.log(`Done: ${done} embedded, ${failed} failed.`);
    if (failed > 0) process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
