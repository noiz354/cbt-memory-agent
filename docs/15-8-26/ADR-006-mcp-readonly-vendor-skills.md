# ADR-006: Managed MCP Read-Only + Vendor Agent Skills Repo

- **Status**: Accepted
- **Date**: 2026-08-16
- **Deciders**: Principal Engineer (agent), per ADDY-OSMANI-SKILLS.md Workstream A + B
- **Related**: docs/COCKROACHDB-AGENT-READY.md, docs/MCP-STATUS.md, mcp/mcp-config.json, .mcp.json, skills/cockroachdb-skills/

## Context

Hackathon mewajibkan ≥2 dari 4 tool CockroachDB. Proyek sudah memakai Distributed Vector
Indexing; untuk melengkapi submission diadopsi **Managed MCP Server** dan **Agent Skills
Repo**. Dua pertanyaan desain muncul:

1. **MCP runtime vs tooling** — MCP di Lambda runtime? Tidak: Lambda sudah connect langsung
   via `pg.Pool` (latency rendah, pooled). Managed MCP punya batasan (1 statement ≤16KB,
   20s timeout, 10KiB response, tanpa EXPLAIN ANALYZE, schema system diblokir) dan **stateless
   + single-identity** → tidak cocok data-plane multi-tenant.
2. **Vendor vs live-install skills** — Agent Skills repo dipakai untuk agent tooling, bukan
   runtime aplikasi. User memutuskan: "tidak perlu di integrasikan ke agent ya".

## Decision

1. **Managed MCP diadopsi read-only (WS-A)** — endpoint `https://cockroachlabs.cloud/mcp`,
   auth `Authorization: Bearer $CCLOUD_MCP_API_KEY` (service account) + header
   `mcp-cluster-id: 87275047-fbf8-4f18-8b8d-a5ff97a335e3`. Dipakai untuk introspeksi schema,
   eksplorasi data, EXPLAIN query, triage. **Bukti live** di `docs/15-8-26/mcp-proof/`
   (9 tool; list_databases, list_tables, get_table_schema embeddings + VECTOR INDEX,
   explain keyword pakai memory_nodes_search_idx, explain vector guardrail dimensi,
   select COUNT=10003, get_cluster). Konfigurasi: `mcp/mcp-config.json` (MCP client umum) +
   `.mcp.json` (Claude Code/editor). Write tools (create_database/create_table/insert_rows)
   **tidak diaktifkan** — semua write tetap lewat Lambda.
2. **ccloud CLI diperkuat (WS-C)** — `scripts/ccloud-audit.sh`: pola agent-ready
   `ccloud -o json` + jq; mode `--quiet` untuk CI (exit code) dan `--json` (machine-readable);
   6 check live (cluster state/version/region/spend-limit=0, SQL SELECT 1, MCP tools/list).
   Ditambahkan sebagai health gate di `.github/workflows/deploy.yml`.
3. **Agent Skills di-vendor (WS-B)** — `skills/cockroachdb-skills/` berisi klon statis
   (commit e14e86d23ce8, Apache 2.0) dari github.com/cockroachlabs/cockroachdb-skills
   (34 skills, 10 domain; .git/.github dihapus, LICENSE dipertahankan, VENDORED.md
   mendokumentasikan source/commit/update). **Tidak diintegrasikan** ke Lambda runtime,
   health-check, atau workflow agent — murni aset pengetahuan untuk sesi engineering.

## Consequences

- **Positif**: submission memenuhi 4/4 tool CockroachDB; agent (dev) bisa mengeksplorasi
  cluster lewat MCP/ccloud tanpa mengekspos write ke aplikasi; skills terkunci versinya
  (reproducible) tanpa membebani repo runtime.
- **Negatif / batasan**: (a) MCP stateless → tidak ada pooling/session antar panggilan;
  (b) key service account harus dirotasi manual bila bocor; (c) vendor skills butuh update
  manual berkala (bukan submodule); (d) CRDB_CLUSTER_NAME secret belum masuk GitHub (audit
  fallback ke default `woozy-grivet`).
- **Keamanan**: managed MCP read-only + service account granular; blast radius write tetap
  di Lambda dengan auth + audit.
