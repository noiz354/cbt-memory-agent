# Plan — Reflection Loop Additions A & B: Cluster Health Gate + Agent Skills Injection

> Disusun: 2026-08-16 · Status: Approved → Implemented (TDD) → Verified
> Scope: **additive only**. Tidak mengubah steps 1–5 reflection loop yang sudah jalan,
> tidak mengubah struktur prompt sistem, dan tidak mengubah write path (`pg.Pool`).
> Kerangka kerja: ADDY-OSMANI-SKILLS.md (Define → Plan → Build → Verify → Review → Ship).

## Ringkasan

Dua penambahan pada reflection loop (berjalan setelah step 1.5 MCP dari
`PLAN-MCP-REFLECTION-STEP.md`, sebelum LLM distillation):

- **Addition A — Cluster health gate.** Sebelum memproses user, cek status cluster
  CockroachDB Cloud. Bila terdegradasi (status selain `CREATED`/`UNSPECIFIED`), batalkan
  seluruh run (return `{userFacts:0, errors:0, skipped:0}`) + audit `CLUSTER_HEALTH_CHECK`.
  Semua failure (no id/key, binary down, network, timeout, parse) → `{healthy:true, skipped:true}`
  → caller melanjutkan loop seperti biasa. **Tidak pernah melempar.**
- **Addition B — Agent skills injection.** Baca 2 SKILL.md CockroachDB yang di-vendor
  (`cockroachdb-sql`, `profiling-statement-fingerprints`), truncate @ 500 chars, gabung jadi
  satu blok konteks (`--- CockroachDB Agent Skills Context ---`), dan sisipkan ke user prompt
  sebelum `Output JSON array of durable facts:`. File hilang → dilewati; semua hilang →
  `{content:"", names:[]}`. **Tidak pernah melempar.**

## Fakta verifikasi runtime

- **ccloud CLI**: v0.6.12; **tidak ada** subcommand `cluster get` — pakai
  `ccloud cluster list -o json` (ARRAY) + filter `.id`; field `.operation_status`/`.state`
  (pola terbukti di `scripts/ccloud-audit.sh:87-105`). Lambda **tidak punya** binary ccloud.
- **REST v1 fallback** (verified live): `GET https://cockroachlabs.cloud/api/v1/clusters/<id>`
  Bearer `CCLOUD_API_KEY` → field `.state`, `.operation_status`, `.regions[].node_count`
  (0 untuk serverless). `CCLOUD_API_KEY` sudah disuntik ke Lambda (main.tf) → REST path live di prod.
- **`CRDB_CLUSTER_ID`**: ada di SSM `/hackathon/crdb/cluster-id` (setup-ssm-params.sh:110,
  prefix `/cbt/hackathon`), IAM sudah grant `ssm:GetParameter` pada `/cbt/hackathon/*`.
  **Belum** ada di `infra/modules/lambda/main.tf` env block → ditambahkan via SSM data source.
- **Skills repo**: `skills/cockroachdb-skills/skills/<domain>/<skill>/SKILL.md` (di-vendor,
  ter-commit). Lambda bundle **tidak** berisi skills → `scripts/build-lambda.sh` menyalin
  SKILL.md ke `dist/skills/...` + zip `index.js skills`.
- **audit_events**: `type` CHECK belum berisi `'CLUSTER_HEALTH_CHECK'`; `user_id NOT NULL`
  (event level cluster tidak punya user) → perlu migration + update `crdb-schema.sql`.
  Pola migration = `schema/migration-2026-08-16-reflection-audit.sql` (DROP kedua nama
  constraint `*_type_check`/`check_type` + ADD CONSTRAINT eksplisit).
- Lambda runtime `nodejs22.x`, `timeout=300`, `memory_size=256`. `child_process`/`fs`/`path`
  adalah Node built-in → **tanpa npm dependency baru**.

## File yang berubah

- **`lambda/lib/clusterHealth.ts`** — BARU (Addition A).
- **`lambda/lib/agentSkills.ts`** — BARU (Addition B).
- **`lambda/lib/reflection.ts`** — wiring minimal: gate di `runReflectionForActiveUsers`,
  `mcpCtx` + `skills` di `reflectUser`, param `existingFacts`/`skillsContent` di
  `extractReflectionFacts`, param `mcpCtx`/`skillsNames` di `upsertReflectionFact`.
- **`schema/migration-2026-08-16-cluster-health-audit.sql`** — BARU (CHECK + nullable user_id).
- **`schema/crdb-schema.sql`** — audit_events: user_id nullable + `'CLUSTER_HEALTH_CHECK'` di CHECK.
- **`infra/modules/lambda/main.tf`** — SSM data source `crdb_cluster_id` + env `CRDB_CLUSTER_ID`.
- **`scripts/build-lambda.sh`** — salin 2 SKILL.md ke `dist/skills/...`; zip `index.js skills`.
- **`.env.example`** — dokumentasi `CCLOUD_HEALTH_TIMEOUT_MS` (MCP vars sudah dari fase sebelumnya).
- **Tests**: `lambda/tests/clusterHealth.test.ts` (BARU), `lambda/tests/agentSkills.test.ts`
  (BARU), `lambda/tests/reflection.test.ts` (tambah).

## Desain — `lambda/lib/clusterHealth.ts`

```ts
export interface ClusterHealth { healthy: boolean; status: string; nodeCount: number | null; skipped: boolean }
export const CLUSTER_HEALTH_TIMEOUT_MS = Number(process.env.CCLOUD_HEALTH_TIMEOUT_MS ?? 10000) || 10000;
export const CLUSTER_HEALTH_AUDIT_TYPE = "CLUSTER_HEALTH_CHECK";
export const CCLOUD_CLUSTERS_API = "https://cockroachlabs.cloud/api/v1/clusters";
const HEALTHY_STATUSES = new Set(["CREATED", "UNSPECIFIED"]);
```

- `parseHealth(raw)`: `status = String(raw.operation_status ?? raw.state ?? "UNKNOWN")`;
  `nodeCount = sum(raw.regions[].node_count)` (null bila regions absent).
- `runCcloudList(clusterId)`: `execFile("ccloud", ["cluster","list","-o","json"], {timeout, maxBuffer:2MB})`
  → `JSON.parse` → `.find(c => c.id === clusterId)`.
- `fetchClusterViaRest(clusterId)`: `fetch(CCLOUD_CLUSTERS_API/<id>)` Bearer
  `CCLOUD_API_KEY ?? CCLOUD_MCP_API_KEY`, AbortController + setTimeout(CLUSTER_HEALTH_TIMEOUT_MS) + clearTimeout.
- `checkClusterHealth(crdb)`: ccloud dulu, fallback REST (keduanya di dalam satu outer try).
  Total failure → log `reflection.cluster_health_failed` + return `{healthy:true,status:"UNKNOWN",nodeCount:null,skipped:true}`.
  Sukses → INSERT audit `(user_id=NULL, type=CLUSTER_HEALTH_CHECK, detail={status,nodeCount,healthy,reason?})`
  (audit insert dibungkus try/catch sendiri → `reflection.cluster_health_audit_failed`) + log
  `reflection.cluster_health` → return `{healthy,status,nodeCount,skipped:false}`.

**Keputusan kunci:** total failure tetap `healthy:true, skipped:true` (bukan `healthy:false`)
karena health gate tidak boleh menghentikan refleksi hanya karena tooling-nya sendiri rusak.
Degradasi (status terbaca, di luar set sehat) yang menghentikan run.

## Desain — `lambda/lib/agentSkills.ts`

```ts
export interface ReflectionSkills { content: string; names: string[] }
export const SKILL_MAX_CHARS = 500;
const SKILL_FILES = [
  { name: "cockroachdb-sql", rel: "cockroachdb-query-and-schema-design/cockroachdb-sql/SKILL.md" },
  { name: "profiling-statement-fingerprints", rel: "cockroachdb-observability-and-diagnostics/profiling-statement-fingerprints/SKILL.md" },
];
```

- `skillCandidates(rel)`: `[ SKILLS_DIR ?? <repo>/skills/cockroachdb-skills/skills, <bundle>/skills/cockroachdb-skills/skills ]`
  (dev/test path via `__dirname`; bundled path = `/var/task` di Lambda).
- `readFirstExisting(rel)`: coba tiap kandidat, kembalikan teks pertama yang terbaca (null bila semua gagal).
- `loadReflectionSkills()`: baca per file, truncate `SKILL_MAX_CHARS`, log `reflection.skills_failed`
  per file yang hilang. Bangun blok:
  `--- CockroachDB Agent Skills Context ---\n\n<name>: <content>` (dipisah `\n\n--- `).
  Semua hilang → `{content:"", names:[]}`.

## Wiring — `lambda/lib/reflection.ts`

1. `runReflectionForActiveUsers`: setelah `windowDays`, `const health = await checkClusterHealth(crdb);`
   bila `!health.skipped && !health.healthy` → log `reflection.cluster_unhealthy` + return
   `{userFacts:0, errors:0, skipped:0, reflectedAt}` (gate).
2. `reflectUser` opts: tambah `existingFactsProvider?: (userId)=>Promise<McpContext>` (default `fetchExistingCoreFacts`).
   Setelah `chronological`: `const mcpCtx = await provider(userId);` → `const skills = await loadReflectionSkills();`
   → `extractReflectionFacts(llm, chronological, mcpCtx.facts, skills.content)` → upsert loop
   memanggil `upsertReflectionFact(crdb, llm, userId, fact, mcpCtx, skills.names)`.
3. `extractReflectionFacts(llm, turns, existingFacts=[], skillsContent="")`: system prompt TIDAK berubah;
   `existingBlock` (Already-known durable facts DO NOT re-extract...) + `skillsBlock` disisipkan ke
   user prompt sebelum `Output JSON array of durable facts:`.
4. `upsertReflectionFact(..., mcpCtx=EMPTY_MCP_CONTEXT, skillsNames=[])`: audit `detail` kini
   `JSON.stringify({factTitle, mcp_context_used, mcp_facts_count, skills_used, skills_injected})`.
   Statement INSERT tidak berubah.

## Migration — `schema/migration-2026-08-16-cluster-health-audit.sql`

Idempotent (guard `IF EXISTS`), non-destructive, pola mengikuti migration reflection-audit:
`SET sql_safe_updates=false` → `DROP CONSTRAINT IF EXISTS audit_events_type_check` →
`DROP CONSTRAINT IF EXISTS check_type` → `ADD CONSTRAINT audit_events_type_check CHECK (type IN (…11 existing + 'CLUSTER_HEALTH_CHECK'))`
→ `ALTER TABLE audit_events ALTER COLUMN user_id DROP NOT NULL`.
Sinkron: `schema/crdb-schema.sql` (user_id nullable + nilai baru di CHECK) untuk fresh install.

## Infra & Build

- `infra/modules/lambda/main.tf`: `data "aws_ssm_parameter" "crdb_cluster_id" { name = "/${var.environment}/crdb/cluster-id" }`
  + env `CRDB_CLUSTER_ID = data.aws_ssm_parameter.crdb_cluster_id.value` (di antara CRDB_CONNECTION dan CCLOUD_API_KEY).
- `scripts/build-lambda.sh`: `mkdir -p dist/skills/cockroachdb-skills/skills/{cockroachdb-query-and-schema-design/cockroachdb-sql, cockroachdb-observability-and-diagnostics/profiling-statement-fingerprints}`,
  `cp` kedua SKILL.md, lalu `zip -qr "$OUT_ZIP" index.js skills`.

## Verify (Build — TDD, semua hijau)

- `lambda/tests/clusterHealth.test.ts` (5): healthy via ccloud (tanpa REST, status `UNSPECIFIED`,
  nodeCount sum regions, audit params `[CLUSTER_HEALTH_AUDIT_TYPE, null, JSON{healthy:true}]`);
  ccloud gagal → REST fallback; degraded (`NOT_READY`) → `healthy:false, skipped:false`;
  keduanya gagal → `skipped:true, healthy:true`, tanpa audit; `CRDB_CLUSTER_ID` kosong → `skipped:true`, tanpa network.
  Mock: `vi.mock("child_process", {execFile: vi.fn()})` + stub `globalThis.fetch`.
- `lambda/tests/agentSkills.test.ts` (3): muat 2 file vendored nyata → names + konten blok;
  truncation < SKILL_MAX_CHARS+60 per segmen; `SKILLS_DIR` tak valid → `{content:"", names:[]}`.
- `reflection.test.ts` (tambah): skills block masuk user prompt (`CockroachDB Agent Skills Context` + `use UPSERT`);
  audit detail `skills_used`/`skills_injected`; gate unhealthy → `userFacts 0, skipped 0, errors 0`, `crdb.query`/`llm.chat`
  tidak dipanggil; `skipped:true` → loop tetap lanjut. Hermetic via `vi.mock` clusterHealth + agentSkills
  (dev box punya ccloud live + CCLOUD_API_KEY nyata di .env — jangan sampai hit network saat `npm test`).
- Jalankan: `cd lambda && npm test && npm run typecheck:test && npx tsc --noEmit`.

## Review / Ship (pasca implementasi)

- Pass `code-review-and-quality` pada file tersentuh; pastikan steps 1–5 logic tidak berubah
  dan semua failure path `clusterHealth`/`agentSkills` graceful (tidak pernah melempar).
- Update `docs/MCP-STATUS.md` (tambah entry cluster health gate + skills injection).
- Dokumentasi `.env.example` untuk `CCLOUD_HEALTH_TIMEOUT_MS` (selesai).

## Hasil verifikasi (2026-08-16)

- `npm test`: **15 files / 122 tests pass** (sebelumnya 109).
- `npx tsc --noEmit` (prod tsconfig): bersih.
- `npm run typecheck:test`: hanya error pra-eksisting yang tersisa (memory.test.ts 60,61,83,84,99,100,135,139;
  reflection.test.ts 215,226 — TS7006 implicit-any di kode lama) — tidak disentuh.
