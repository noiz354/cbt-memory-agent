# Demo Script — CBT Memory Agent (≤3 menit)

> Script video untuk submission **CockroachDB × AWS Agent Challenge 2026**.
> Target durasi: **2:45–3:00**. Bahasa: Inggris (untuk juri internasional).
> Rekam dengan OBS/screen recording; suara voiceover jelas; teks pendek muncul di layar untuk tiap segmen.

---

## 0:00–0:20 — Hook (20 detik)

> **Visual:** aplikasi CBT Memory Agent di browser — tampilan workspace.
> **Narasi:** "Meet CBT Memory Agent: a private cognitive-behavioral-therapy workspace. Every conversation, every insight — stored as persistent memory in CockroachDB, served from AWS."

**Overlay teks:** `CBT Memory Agent · CockroachDB × AWS`

## 0:20–1:00 — Agentic memory loop (40 detik)

> **Visual:** chat dengan user. Kirim pesan. Animasi "retrieving memories".
> **Narasi:** "When you talk to it, the agent doesn't just answer — it retrieves what it already knows about you. Each turn fuses three signals: keyword full-text search, vector similarity, and weighted heuristics — ranked together with Reciprocal Rank Fusion."

**Overlay teks:** `getMemoryContext · 3-set RRF · CockroachDB vector index`

> **Visual:** terminal memunculkan `EXPLAIN`/log span `memory.retrieve`.

> **Narasi:** "The planner uses CockroachDB's C-SPANN vector index — `embeddings_vector_idx` — so retrieval stays fast as memories grow."

## 1:00–1:30 — Reflection job, memory that gets smarter (30 detik)

> **Visual:** CloudWatch/EventBridge rule `cbt-memory-agent-reflect`, lalu query `memory_nodes` + `audit_events`.
> **Narasi:** "Every six hours, EventBridge wakes the agent. It reads recent sessions, asks the LLM to distill durable facts — patterns, preferences, mood — and writes them back as verified core memories, with embeddings. Next conversation, those facts surface automatically."

**Overlay teks:** `EventBridge → reflect.ts → REFLECTION_RAN`

## 1:30–2:20 — The 4 CockroachDB tools (50 detik)

> **Visual:** per tool — bukti live di layar.

1. **(~1:30)** Managed MCP — **Visual:** terminal JSON-RPC POST ke `cockroachlabs.cloud/mcp`, `tools/list`, `explain_query`. **Narasi:** "My agent connects read-only to the cluster through CockroachDB Cloud's Managed MCP server — introspecting schema, running EXPLAIN, triaging live."
2. **(~1:45)** Distributed Vector Indexing — **Visual:** `get_table_schema` menunjukkan `embeddings_vector_idx`. **Narasi:** "Vector indexing powers semantic memory — no separate vector database."
3. **(~2:00)** ccloud CLI — **Visual:** `scripts/ccloud-audit.sh` → `6/6 PASS`. **Narasi:** "ccloud CLI is wired into CI as a health gate — the agent drives the control plane with `-o json`."
4. **(~2:10)** Agent Skills — **Visual:** `skills/cockroachdb-skills/` tree. **Narasi:** "And we vendor the open-source Agent Skills repo — 34 skills encoding CockroachDB expertise."

## 2:20–2:45 — AWS + wrap (25 detik)

> **Visual:** AWS console — Lambda, S3, EventBridge, CloudWatch.
> **Narasi:** "Everything runs serverless on AWS: Lambda for compute, S3 for exports, EventBridge for scheduling, CloudWatch for observability. One CockroachDB cluster, zero separate stores, no reindexing — memory that just scales."

**Overlay teks:** `AWS Lambda · S3 · EventBridge · CloudWatch · OpenRouter`

> **Narasi penutup:** "CockroachDB made it possible for an agent to remember — so it can help, better, every session."

**Overlay teks:** `MIT License · open source · https://<repo-url>`

---

## Cue cards / shot list

| Waktu | Scene | Sumber materi |
|---|---|---|
| 0:00 | App workspace | Frontend (localhost:5173) |
| 0:20 | Chat + retrieval | Browser + Lambda logs |
| 1:00 | Reflection | EventBridge rule + psql query |
| 1:30 | Managed MCP | `docs/15-8-26/mcp-proof/tools-list.txt` |
| 1:45 | Vector index | `get-table-schema-embeddings.txt` |
| 2:00 | ccloud audit | `scripts/ccloud-audit.sh` |
| 2:10 | Agent Skills | `skills/cockroachdb-skills/` |
| 2:20 | AWS console | Lambda/S3/EventBridge/CloudWatch |
| 2:40 | Logo + links | Repo |

## Tips recording

- Potong antar-scene; tidak perlu sekali take.
- Zoom pada terminal saat bukti live — juri mencari **bukti nyata**, bukan klaim.
- Tetap <3:00 — YouTube waktu terpotong di 3:00.
- Upload ke YouTube/Vimeo, masukkan link ke README (item checklist "Video Demo").
