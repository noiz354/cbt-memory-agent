# CockroachDB MCP Server — Implementation Status

> Status implementasi **CockroachDB Cloud Managed MCP Server** (endpoint
> `https://cockroachlabs.cloud/mcp`) untuk agent tooling proyek ini.

**Tanggal:** 2026-08-16 (terakhir diperbarui)  
**Cluster:** woozy-grivet (AWS ap-southeast-3, Serverless, v26.2.5)  
**Spend Limit:** $0.00/month ✅  
**ccloud CLI:** ✅ Sudah login dan bisa akses cluster  
**Managed MCP:** ✅ **AKTIF — read-only, terverifikasi live**

---

## ✅ YANG SUDAH SELESAI

| Item | Status | Bukti |
|---|---|---|
| ccloud CLI install | ✅ Done | `ccloud version` working |
| ccloud auth login | ✅ Done | OAuth berhasil |
| Cluster provisioning | ✅ Done | `woozy-grivet` running di AWS ap-southeast-3 |
| Spend limit $0.00 | ✅ Set | Verified via `ccloud cluster info` |
| Schema SQL file | ✅ Ready | `schema/crdb-schema.sql` |
| Query patterns SQL | ✅ Ready | `scripts/04-query-patterns.sql` |
| Schema applied live | ✅ Done | 12 tabel + vector index + fulltext inverted index live |
| Vector indexing verified | ✅ Done | `embeddings_vector_idx` (user_id, vector_cosine_ops) live |
| **Managed MCP active (read-only)** | ✅ **Done 2026-08-16** | Endpoint `https://cockroachlabs.cloud/mcp` + header `mcp-cluster-id` + `Authorization: Bearer $CCLOUD_MCP_API_KEY` |

---

## 🚧 YANG BELUM SELESAI

### 1. MCP write mode

**Status:** ⏳ Sengaja **tidak diaktifkan** — keputusan desain: Managed MCP dipakai
**read-only** untuk introspeksi schema, eksplorasi data, dan diagnosa query. Semua
write tetap lewat Lambda data-path (`pg.Pool`). Jika demo butuh write via MCP,
ganti API key ke service account dengan peran write + consent di Cloud Console.

### 2. Lambda MCP Client (read-only, step 1.5 reflection) ✅

**Status:** ✅ **Dibuat 2026-08-16** — `lambda/lib/mcp.ts` (fetch-based, stateless).
Dipakai oleh reflection loop (`lambda/lib/reflection.ts`) sebagai "step 1.5": sebelum
distilasi LLM, ambil core facts user yang sudah `verified=true` via MCP `select_query`
(LIMIT 25) dan kirim sebagai konteks tambahan agar LLM tidak menduplikasi fakta yang
sudah dikenal.

- **Read-only:** hanya memanggil tool `select_query` (`database=defaultdb`). Semua write
  tetap lewat `pg.Pool` (`lambda/lib/crdb.ts`).
- **Resilience:** timeout `MCP_FETCH_TIMEOUT_MS` (default 5000ms) via AbortController;
  semua failure (no-key, network, HTTP, timeout, parse) → `EMPTY_MCP_CONTEXT`, tidak pernah
  menggagalkan reflection.
- **Observability:** satu log `reflection.mcp_query` per panggilan (`userId`, `durationMs`,
  `factsCount`, `success`) + `reflection.mcp_failed` pada gagal.
- **Audit trail:** detail `audit_events` (REFLECTION_RAN) kini menyertakan
  `mcp_context_used` + `mcp_facts_count` (ternormalisasi: true/n, true/0, false/0).
- Referensi: `docs/15-8-26/PLAN-MCP-REFLECTION-STEP.md` · test `lambda/tests/mcp.test.ts`.
- Live di produksi karena Lambda sudah punya `CCLOUD_API_KEY` (fallback ke
  `CCLOUD_MCP_API_KEY` jika diset).

### 3. Reflection health gate (cluster health) ✅

**Status:** ✅ **Dibuat 2026-08-16** — `lambda/lib/clusterHealth.ts`. Sebelum memproses user,
reflection loop mengecek status cluster CockroachDB Cloud; cluster terdegradasi (status selain
`CREATED`/`UNSPECIFIED`) → seluruh run dibatalkan.

- **Hybrid mechanism:** `ccloud cluster list -o json` (filter `.id` == `CRDB_CLUSTER_ID`) →
  fallback REST `GET /api/v1/clusters/<id>` Bearer `CCLOUD_API_KEY ?? CCLOUD_MCP_API_KEY`.
- **Resilience:** timeout `CCLOUD_HEALTH_TIMEOUT_MS` (default 10000ms) untuk ccloud (execFile) dan
  REST (AbortController). Semua failure → `{healthy:true, skipped:true}` → loop lanjut. Tidak pernah
  melempar.
- **Audit trail:** `audit_events` type `CLUSTER_HEALTH_CHECK` (baru di migration
  `schema/migration-2026-08-16-cluster-health-audit.sql`), `user_id=NULL` (event level cluster),
  `detail = {status, nodeCount, healthy, reason?}`.
- **Infra:** `CRDB_CLUSTER_ID` disuntik dari SSM `/hackathon/crdb/cluster-id` (main.tf data source).
- **Live (2026-08-16):** `terraform apply` (Lambda v18) + migration CRDB live. Invoke reflect →
  log `reflection.cluster_health` (`status UNSPECIFIED, nodeCount 0, healthy:true` — REST fallback)
  + audit row `CLUSTER_HEALTH_CHECK` (`user_id` NULL, detail `{status,nodeCount,healthy}`) terverifikasi.
- Referensi: `docs/15-8-26/PLAN-CLUSTER-HEALTH-SKILLS.md` · test `lambda/tests/clusterHealth.test.ts`.

### 4. Reflection agent skills injection ✅

**Status:** ✅ **Dibuat 2026-08-16** — `lambda/lib/agentSkills.ts`. Reflection loop membaca 2 SKILL.md
CockroachDB yang di-vendor (`cockroachdb-sql`, `profiling-statement-fingerprints`), truncate @ 500 chars,
lalu menyisipkan blok `CockroachDB Agent Skills Context` ke user prompt sebelum LLM distillation.

- **Paths:** dev/test `<repo>/skills/cockroachdb-skills/skills/<rel>`; bundled `/var/task/skills/...`
  (Lambda zip — `scripts/build-lambda.sh` menyalin SKILL.md ke `dist/skills/` + zip `index.js skills`).
- **Resilience:** file hilang → dilewati; semua hilang → `{content:"", names:[]}`. Tidak pernah melempar.
- **Audit trail:** detail `REFLECTION_RAN` kini menyertakan `skills_used` (array) + `skills_injected`
  (boolean).
- Referensi: `docs/15-8-26/PLAN-CLUSTER-HEALTH-SKILLS.md` · test `lambda/tests/agentSkills.test.ts`.

### 5. Emotional media attachments (kind='attachment' + S3 raw media) ✅

**Status:** ✅ **Dibuat 2026-08-16** — Media emosional (gambar/video/audio) di-analysis **on-device**
(MediaPipe face, prosody DSP, Whisper transcript) lalu di-index sebagai memory node
`kind='attachment'` (verified=true) + **raw media di S3**. Recall otomatis via hybrid RRF
`getMemoryContext` (3 leg retrieval tidak memfilter `kind`).

- **API:** `POST /api/v1/attachments/presign` (presigned PUT, key `media/{userId}/{uuid}.{ext}`,
  ext divalidasi) → `POST /api/v1/attachments` (INSERT node + `attachments` row + `writeNodeEmbedding`
  dari narrative) → `GET /api/v1/attachments` → `DELETE /api/v1/attachments/:id` (match
  `memory_node_id`, delete S3 + node cascade). Handler: `lambda/handlers/attachments.ts`.
- **Schema:** migration `schema/migration-2026-08-16-attachments.sql` (kind CHECK + tabel `attachments`
  FK `memory_node_id → memory_nodes(id) ON DELETE CASCADE` — pola embeddings, purge otomatis).
- **S3:** `lambda/lib/s3.ts` + `presignMediaUpload`/`deleteMediaObject`/`deleteMediaPrefix`; IAM
  `s3:DeleteObject/DeleteObjects`.
- **Frontend pipeline:** `attachmentAnalysis.ts` (narrative template deterministik), `prosody.ts` +
  `prosody.worker.ts` (pitch autocorrelation, pause, wpm), `faceClient.analyzeFrame()` one-shot,
  `attachmentIndex.ts` orchestration; UI di CameraPip/VideoRecorderPip/HoldToTalkOrb/Composer.
- **Privacy:** raw media stays in-browser; hanya clinical summary + upload eksplisit yang sinkron.
- **Live (2026-08-16):** migration CRDB live (tabel `attachments` + kind CHECK `'attachment'`
  terverifikasi), `terraform apply` (Lambda v19, IAM `s3:DeleteObject/DeleteObjects`). Live E2E:
  presign → **S3 PUT 200** → create (node `verified=true` + attachments + embeddings) → list →
  delete (S3 object terhapus + cascade). Fix presigned PUT signature (commit `68a6dcb`):
  drop `x-amz-server-side-encryption` (bucket AES256 at-rest) + `requestChecksumCalculation:
  "WHEN_REQUIRED"` — SDK v3.800 signer mismatch saat klien browser/curl PUT polos.
- Referensi: `docs/15-8-26/PLAN-EMOTIONAL-ATTACHMENTS.md` · `ADR-007` · test `lambda/tests/attachments.test.ts`.

---

## 🎯 HACKATHON SUBMISSION CHECKLIST

| Requirement | Status | Bukti |
|---|---|---|
| CockroachDB Tool #1: Managed MCP Server | ✅ **Done (read-only, live)** | `docs/15-8-26/mcp-proof/` + config |
| CockroachDB Tool #2: Distributed Vector Indexing | ✅ Done | `embeddings_vector_idx` + semantic search + hybrid keyword |
| CockroachDB Tool #3: ccloud CLI | ✅ Done | Provisioning + audit script |
| CockroachDB Tool #4: Agent Skills Repo | ✅ Done | Vendor `skills/cockroachdb-skills/` |
| AWS Service #1: Lambda | ✅ Done | Deployed (ap-southeast-3) |
| LLM + Embeddings: OpenRouter | ✅ Done | `lambda/lib/openrouter.ts` |
| AWS Service #2: S3 | ✅ Done | Export bucket |
| Public Repo + MIT License | ✅ Done | Repo ini |
| README + Setup Instructions | ⏳ Pending | Update di Workstream E |

---

**Last Updated:** 2026-08-16  
**Next Action:** (WS-E) update README tools matrix + demo script
