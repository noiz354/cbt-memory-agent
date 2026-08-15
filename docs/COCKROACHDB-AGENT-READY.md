# CockroachDB "Agent Ready" — Knowledge Base + Gap Analysis

> Riset resmi tiga offerings AI agent CockroachDB (launch series **"CockroachDB is Agent Ready"**, 2026-03-25) dan gap analysis terhadap penggunaannya oleh agent di proyek CBT Memory Agent (woozy-grivet).

**Tanggal riset:** 2026-08-16
**Sumber utama:** blog resmi Cockroach Labs (MCP Server, ccloud CLI, Agent Skills) + docs + GitHub.

---

## 1. CockroachDB Cloud Managed MCP Server

**Ringkasan:** MCP server yang di-host dan dioperasikan oleh Cockroach Labs, terintegrasi langsung di CockroachDB Cloud. Connect AI agent ke cluster dengan satu config snippet dari Cloud Console.

- **Endpoint:** `https://cockroachlabs.cloud/mcp`
- **Works natively dengan:** Claude Code, Cursor, Cline, GitHub Copilot, Codex (semua via HTTP/HTTPS transport).
- **Safe by default:** read-only mode default; write hanya setelah consent eksplisit (opt-in). Guardrail berlapis independen dari SQL role.
- **Tanpa custom proxy:** tidak ada data-plane path baru — semua SQL mengalir lewat internal service proxies yang sudah ada.
- **Full audit logging:** structured logs bertag `mcp` (tool name, org/cluster context, redacted SQL shape, latency, error codes), end-to-end tracing, usage analytics.
- **Tidak ada overhead operasional:** upgrade/penambahan tool datang otomatis (fully managed).

### Arsitektur / alur request
1. MCP client kirim JSON-RPC over HTTPS → 2. load balancer → 3. internal `mcp-service` → 4. middleware (auth, rate limit, logging) → 5. tool handler (authz + execute) → 6. JSON-RPC response.

### Autentikasi (2 mekanisme)
| Metode | Kapan | Detail |
|---|---|---|
| **OAuth 2.1 (Auth Code + PKCE)** | Interaktif (Claude Code, Cursor, dll) | Scopes: `mcp:read` / `mcp:write`; consent screen "Authorize MCP Access"; short-lived token (lebih aman, direkomendasikan). |
| **Service account API keys** | Headless / CI-CD / autonomous | Header `Authorization: Bearer {api-key}`; peran Cloud RBAC scoped ke cluster tertentu. |

### Scope cluster
- Default: satu koneksi MCP bisa akses **semua cluster** di organisasi (sesuai permission user/service account).
- **Single cluster:** tambah header `mcp-cluster-id: {cluster-id}` — semua tool beroperasi di cluster itu; tool dengan `cluster_id` beda akan error.

### Tools
| Kategori | Tools |
|---|---|
| **Read (default)** | `list_clusters`, `get_cluster`, `list_databases`, `list_tables`, `get_table_schema`, `select_query`, `explain_query`, `show_statement`, `show_running_queries` |
| **Write (setelah consent)** | `create_database`, `create_table`, `insert_rows` |

Catatan keamanan: operasi destruktif (`DROP`, `TRUNCATE`) **tidak didukung**; system tables di-deny-list.

### Batasan (limits)
- 1 statement per tool call, maks 16.384 karakter.
- Timeout 20 detik per query.
- Respons maks 10 KiB.
- `select_query` tanpa `LIMIT` → otomatis `LIMIT 25`; `LIMIT` maks 10.000 (`LIMIT ALL` ditolak).
- `list_databases`/`list_tables` default 100, maks 10.000.
- `show_statement` maks 100 baris; hanya SHOW introspectif (`SHOW SCHEMAS`, `SHOW INDEXES`, `SHOW CONSTRAINTS`, `SHOW REGIONS`).
- `explain_query` hanya SELECT/INSERT/CREATE TABLE; **`EXPLAIN ANALYZE` tidak didukung** (akan mengeksekusi statement).
- Skema yang diblokir: `system`, `crdb_internal`, `pg_catalog`, `information_schema`, `pg_extension`.

### Setup (Claude Code contoh)
```bash
claude mcp add cockroachdb-cloud https://cockroachlabs.cloud/mcp --transport http
# single cluster:
claude mcp add cockroachdb-cloud https://cockroachlabs.cloud/mcp --transport http --header "mcp-cluster-id: {cluster-id}"
# API key:
claude mcp add cockroachdb-cloud https://cockroachlabs.cloud/mcp --transport http --header "Authorization: Bearer {api-key}"
```
Lalu `claude /mcp` → Authenticate → OAuth (login → pilih org → Authorize read/write).

**Custom MCP client:** OAuth redirect URL harus di-allowlist oleh Org Admin (Governance → OAuth apps → Add redirect URL). Client lokal dengan redirect ke localhost sudah allowlisted default.

### Referensi
- Blog: https://www.cockroachlabs.com/blog/cockroachdb-ai-agents-managed-mcp-server/
- Docs: https://www.cockroachlabs.com/docs/cockroachcloud/connect-to-the-cockroachdb-cloud-mcp-server

---

## 2. ccloud CLI (Agent-Ready)

**Ringkasan:** CLI control plane lengkap CockroachDB Cloud, didesain ulang agar AI agent jadi first-class consumer. Provision cluster, kelola backup, konfigurasi networking, monitor audit logs — semua dari terminal.

### Desain untuk AI (4 pilar "AI-ready")
1. **Consistent noun-verb patterns** — `ccloud cluster create`, `ccloud folder list`, `ccloud replication create`. Agent bisa infer dari `--help` seperti `git`/`docker`/`kubectl`.
2. **JSON output di setiap command** — flag global `-o json`; agent pipe ke `jq` tanpa screen-scraping.
3. **Predictable error codes** — machine-parseable status codes, bedakan "permission denied" vs "not found" vs "rate limited".
4. **Complete API coverage** — full CockroachDB Cloud API surface, tanpa fallback HTTP manual.

### Contoh alur agent-generated
```bash
ccloud cluster connection-string blue-dog \
  --database myapp --sql-user maxroach -o json \
  | jq -r '.connection_url' \
  | xargs -I{} psql {} -c "SELECT count(*) FROM user_events"
```

### MCP vs CLI (kapan pakai mana)
| | MCP | CLI |
|---|---|---|
| Cocok untuk | multi-turn conversational exploration, schema explorer, ad-hoc query, multi-user shared service (enterprise BI) | single-player, developer-first ops: scripting deploy, triage alert, runbook |
| Context overhead | tool schema = ribuan token per request | zero |
| Universal | hanya client yang support MCP (AutoGen/LangGraph/CI tidak native) | semua (terminal, GitHub Actions, Jenkins, ArgoCD) |
| Komposisi | tools terisolasi | pipe ke jq/psql/curl/kubectl |
| Scripting | tool call hidup-mati di session | script runbook → version control |
| Deployment | MCP server perlu di-host/maintain | satu binary |

### Enterprise security (4 pertanyaan)
| Pertanyaan | Jawaban ccloud |
|---|---|
| **Who is the agent?** (Identity) | Interactive agent → OAuth browser via SSO (OIDC/SAMLv2), SCIM 2.0 untuk provisioning; headless → `ccloud auth login --no-redirect` (device-code); automated → service account + API key. Tiap agent punya identitas traceable. |
| **What can it do?** (Authorization) | Granular role per service account. `Cluster Operator` = triage (read clusters/backups/maintenance, export logs — tidak bisa modify); `Cluster Admin` = + maintenance windows, backups, settings (scoped ke cluster tertentu). Blast radius dibatasi permission, bukan prompt. Contoh 403: `ccloud cluster create ... → { "code": 7, "message": "unauthorized" }`. |
| **How does it connect?** (Network) | Private endpoints, egress rules, IP allowlists, trusted cloud accounts, mTLS via client CA certs — agent lewat jalur network yang sama dengan aplikasi. |
| **How do you verify?** (Auditability) | `ccloud audit list` — siapa, kapan, apa yang berubah, per service account. Logs/metrics export ke CloudWatch/Datadog; CMEK untuk enkripsi data. |

### Auth command pattern
```bash
ccloud auth login --org my-org
ccloud auth login --vanity-name my-company
ccloud auth login --no-redirect      # headless / remote
```

### Referensi
- Blog: https://www.cockroachlabs.com/blog/cockroachdb-ai-agents-cli-database-automation
- Docs: https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-get-started

---

## 3. CockroachDB Agent Skills Repo (Open Source)

**Ringkasan:** Repo publik terkurasi berisi Agent Skills yang meng-encode expertise operasional CockroachDB, mengikuti [Agent Skills Specification](https://agentskills.io/specification). Machine-executable, portable lintas Claude/Cursor/LangChain/40+ agent.

- **Repo:** https://github.com/cockroachlabs/cockroachdb-skills (Apache 2.0, 20★, 13 forks, 64 commits)
- **Install 1 baris:** `npx skills add cockroachlabs/cockroachdb-skills` (works dengan 43+ agent: Claude Code, Cursor, Windsurf, Cline, OpenHands, Roo Code, GitHub Copilot, dll)
- **Manual:** clone → symlink/copy ke `.claude/skills/` (project-level) atau `~/.claude/skills/` (user-level)
- **Struktur:** `skills/<domain>/<skill>/SKILL.md` (frontmatter + konten terstruktur). Validasi otomatis via CI (`scripts/validate-spec.py skills/`).

### 9 domain operasional (~29 skill)
| Domain | Skill |
|---|---|
| **Onboarding and migrations** | `molt-fetch`, `molt-replicator`, `molt-verify`, `setting-up-local-cluster` (MOLT: bulk fetch dari PG/MySQL/Oracle/MSSQL, CDC replication, verify sebelum cutover) |
| **Application development** | `benchmarking-transaction-patterns`, `designing-application-transactions`, `designing-multi-region-applications` |
| **Query and schema design** | `cockroachdb-sql` (natural language → SQL, enforce distributed best practices, anti-patterns: sequential ID hotspot / missing PK, validasi tiap query dengan EXPLAIN) |
| **Operations and lifecycle** | `managing-certificates-and-encryption`, `managing-cluster-capacity`, `managing-cluster-settings`, `performing-cluster-maintenance`, `provisioning-cluster-for-production`, `reviewing-cluster-health`, `upgrading-cluster-version` |
| **Observability and diagnostics** | `analyzing-range-distribution`, `analyzing-schema-change-storage-risk`, `auditing-table-statistics`, `monitoring-background-jobs`, `profiling-statement-fingerprints`, `profiling-transaction-fingerprints`, `triaging-live-sql-activity` |
| **Security and governance** | `auditing-cis-benchmark`, `auditing-cloud-cluster-security`, `configuring-audit-logging`, `configuring-ip-allowlists`, `configuring-log-export`, `configuring-private-connectivity`, `configuring-sso-and-scim`, `enabling-cmek-encryption`, `enforcing-password-policies`, `hardening-user-privileges`, `managing-tls-certificates`, `preparing-compliance-documentation` |
| Performance and scaling | *(belum ada skill isi — hanya `.gitkeep`)* |
| Resilience and DR | *(belum ada — `.gitkeep`)* |
| Integrations and ecosystem | *(belum ada — `.gitkeep`)* |
| Cost and usage management | *(belum ada — `.gitkeep`)* |

### Prinsip desain
Scope discipline (satu skill = satu task), progressive disclosure, **guardrails by default** (skill yang memodifikasi data punya safety checks + rollback guidance), authoritative references (link ke docs resmi, bukan duplikasi), trigger clarity ("when to use" di deskripsi).

### Contoh workflow nyata (blog)
Agent "morning routine" → deteksi CPU spike alert → konek ke cluster via managed MCP → pakai skills diagnostics (monitor background jobs, profiling statement) → diagnosis root cause (UUID PK random → write hotspots, backup overlap, full scan) → rekomendasi fix (hash-sharded PK, secondary index, reschedule backup) → generate migration script, TIDAK auto-apply, human approves.

### Referensi
- Repo: https://github.com/cockroachlabs/cockroachdb-skills
- Docs: https://www.cockroachlabs.com/docs/stable/agent-skills

---

## 4. Tambahan: OSS MCP Server (self-hosted) `cockroachdb-mcp-server`

Bukan bagian dari tiga offerings utama, tapi relevan karena proyek ini memakai variannya.
- **Repo:** https://github.com/cockroachdb/cockroachdb-mcp-server (Go, Apache 2.0) — server MCP open-source yang menghubungkan agent ke cluster (bisa self-host/docker).
- **Read tools (default):** `list_databases`, `list_tables`, `get_table_schema`, `get_cluster`, `list_sql_users`, `list_cluster_nodes`, `show_running_queries`, `select_query`, `explain_query`, `show_statement`.
- **Write tools (opt-in `CRDB_MCP_ENABLE_WRITE_QUERIES=true`):** `create_database`, `create_table`, `insert_rows`, `update_rows`, `delete_rows` (WHERE mandatory).
- **Auth:** stdio + cert-based (recommended); password-based auth ditolak default (`CRDB_MCP_ALLOW_PASSWORD_AUTH=true` untuk opt-in); HTTP mode pakai bearer token + TLS.
- **Konfigurasi:** env vars; `CRDB_DATABASE_URL` (libpq) precedence; `sslmode` harus `require`/`verify-ca`/`verify-full`.
- **Tracing:** OTel opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT` / `CRDB_MCP_OTEL_FILE`.
- **Contoh config (mirip yang dipakai proyek):**
  ```json
  { "mcpServers": { "cockroachdb": {
      "command": "cockroachdb-mcp-server",
      "env": { "CRDB_DATABASE_URL": "postgresql://..." }
  } } }
  ```

---

## 5. Gap Analysis — Pemakaian di Proyek CBT Memory Agent

**Pertanyaan:** apakah semua hal yang disebutkan (managed MCP server, ccloud agent-ready, agent skills) sudah digunakan oleh agent di proyek ini?

**Ringkasan: 0 dari 3 offerings terpakai penuh.** Managed MCP **belum aktif**, ccloud **parsial (bukan gaya agent-ready)**, Agent Skills **belum diadopsi**.

### 5.1 Managed MCP Server — ⚠️ BELUM DIGUNAKAN
| Aspek | Kondisi proyek |
|---|---|
| Config snippet | `docs/MCP-SETUP-INSTRUCTIONS.md` & `scripts/ccloud-bootstrap.sh` **menuliskan instruksi + JSON template** untuk endpoint `https://cockroachlabs.cloud/mcp` + header `mcp-cluster-id` (cluster `87275047-fbf8-4f18-8b8d-a5ff97a335e3`), tapi **statusnya "⏳ belum setup"**. |
| Config MCP aktif | `mcp/mcp-config.json` memakai **OSS `@anthropic-ai/mcp-server-cockroachdb`** (stdio, env `COCKROACH_DATABASE_URL`), **bukan** managed cloud endpoint. |
| Agent runtime (opencode sesi ini) | **TIDAK ada MCP server CockroachDB ter-wire** — tidak ada tool MCP (`list_tables`, `select_query`, dst) di toolset agent. Agent mengakses CRDB lewat **`psql` langsung di bash** dengan connection string dari `.env`/SSM. |
| Reachability check | `scripts/ccloud-auth.sh` hanya **curl probe HTTP status** ke `/mcp` (cek reachable), bukan koneksi MCP sungguhan. |
| Gap | Managed MCP (OAuth/service-account, read-only default, full audit log, limits aman) **belum diaktifkan** untuk agent ini. |

### 5.2 ccloud CLI — 🔶 PARSIAL (installed + dipakai, tapi bukan alur agent-ready)
| Kapabilitas agent-ready | Kondisi proyek |
|---|---|
| Install + auth | ✅ `ccloud` ter-install; `ccloud auth login --no-redirect` (device-code) dipakai di `ccloud-auth.sh` / `ccloud-bootstrap.sh`. |
| Noun-verb patterns | 🔶 sebagian — `ccloud cluster create/list`, `ccloud cluster sql ... --connection-url` dipakai; bukan pola lengkap (no `ccloud audit list`, no `ccloud cluster maintenance`, dst). |
| **`-o json` di setiap command** | 🔶 parsial — beberapa script `--output json` (bootstrap) lalu parse python3; `ccloud-auth.sh` justru **fallback ke REST API v1** (`curl .../api/v1`) karena komentar "ccloud 0.6.12 tidak dukung `--api-key`". Bukan "JSON on every command". |
| Service-account RBAC granular | 🔶 `CCLOUD_API_KEY` (service account) dipakai, disimpan ke SSM; tapi **tidak ada role granular** yang didefinisikan per-agent (triage vs admin). |
| Audit log monitoring | ❌ belum memakai `ccloud audit list`. |
| Network (private endpoints / mTLS / IP allowlist) | ❌ tidak dikelola via CLI di repo (Terraform-only infra di AWS). |
| Backup schedule / restore | ❌ hanya catatan "set up via Cloud Console", bukan via ccloud. |
| CI/CD pakai ccloud | ❌ `.github/workflows/deploy.yml` memakai **Terraform + secrets**, bukan ccloud. |

### 5.3 Agent Skills — ❌ BELUM DIADOPSI
| Aspek | Kondisi proyek |
|---|---|
| Instalasi repo `cockroachlabs/cockroachdb-skills` | ❌ **tidak ada** skill CockroachDB dari repo resmi di lingkungan agent (`~/.agents/skills` / `~/.config/opencode/skills`). |
| Skill yang tersedia | Skill terkait DB yang ada hanyalah generik: `sql-pro`, `postgresql-optimization` — **bukan** skill operasional CockroachDB (health review, statement profiling, range distribution, upgrade, dst). |
| Skill yang relevan & hilang | `reviewing-cluster-health`, `profiling-statement-fingerprints`, `triaging-live-sql-activity`, `analyzing-range-distribution`, `monitoring-background-jobs`, `managing-cluster-capacity`, `configuring-ip-allowlists`, `auditing-cloud-cluster-security`, `managing-tls-certificates`, dst — semuanya **belum tersedia**. |
| Workflow dokumen sendiri | Proyek membangun dokumen workflow sendiri (`docs/15-8-26/ADDY-OSMANI-SKILLS.md`, FASE spec) — berguna tapi **bukan** mengadopsi repo skill resmi; observability/health-check dikerjakan manual (`scripts/vector-health-check.ts`, dashboard Grafana). |
| Install command | Belum pernah `npx skills add cockroachlabs/cockroachdb-skills`. |

### 5.4 Kenapa ini penting (nilai yang hilang)
1. **Managed MCP** → agent bisa eksplorasi schema & query dengan guardrail read-only + audit log tanpa psql manual; mengurangi risiko injeksi/perubahan tak sengaja.
2. **ccloud agent-ready** → operasional lifecycle (backup, maintenance, audit, network) bisa diotomasi & di-audit per service account, bukan manual/console.
3. **Agent Skills resmi** → menghindari reinvent the wheel untuk diagnosis performa/health/keamanan; guardrail + referensi docs built-in, portable ke agent lain.

### 5.5 Rekomendasi (jika mau menutup gap)
- [ ] **MCP:** aktifkan managed endpoint di config agent (Claude Code/opencode): `mcp/mcp-config.json` → `httpUrl https://cockroachlabs.cloud/mcp` + header `mcp-cluster-id` (cluster ID `87275047-fbf8-4f18-8b8d-a5ff97a335e3`) + auth service-account `CCLOUD_API_KEY` (read-only dulu). Verifikasi dengan `list_tables`/`select_query`/`explain_query` live.
- [ ] **ccloud:** adopsi pola `-o json` + pipe jq di script; tambah `ccloud audit list` ke observability; definisikan service-account terpisah (triage vs admin) bila perlu.
- [ ] **Agent Skills:** `npx skills add cockroachlabs/cockroachdb-skills` (atau manual symlink ke `~/.agents/skills`), mulai dari `reviewing-cluster-health`, `profiling-statement-fingerprints`, `monitoring-background-jobs`, `configuring-ip-allowlists`.

---

*Sumber resmi: blog "CRDB is Agent Ready" series (2026-03-25), docs.cockroachlabs.com, github.com/cockroachlabs/cockroachdb-skills, github.com/cockroachdb/cockroachdb-mcp-server.*
