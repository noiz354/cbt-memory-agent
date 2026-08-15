# ADR-005: Agentic Memory Loop — Recall Eksplisit + Reflection Cron

- **Status**: Accepted
- **Date**: 2026-08-16
- **Deciders**: Principal Engineer (agent), per ADDY-OSMANI-SKILLS.md Workstream D
- **Related**: ADR-004 (hybrid RRF retrieval), docs/ARCHITECTURE.md, schema/crdb-schema.sql

## Context

Hackathon requirement utama: "memory (conversation history, user context, task state,
embeddings) is what makes the agent useful." Sebelum WS-D, memory hanya **tulis-simpan**:
`getMemoryContext` mengambil node yang sudah ada (heuristik + keyword + vector via RRF),
tapi tidak ada loop yang membuat agent **semakin pintar seiring waktu**. Gap:

1. **Recall tidak terlihat** — user/agent tidak tahu memori mana yang disuntikkan ke prompt.
2. **Belum ada pola durable** — insight lintas sesi (preferensi, pattern, mood) hanya
   tersimpan implisit di chat_turns; tidak diekstrak jadi memory_nodes.
3. **Tidak ada trigger periodik** — tidak ada yang men-scan percakapan lama.

## Decision

1. **Recall eksplisit (D1)** — `getMemoryContext` (chatTurn.ts) kini mengembalikan
   `recalledTitles: string[]`; span OTel `agent.memory.retrieve` diberi atribut
   `memory.recalled_titles`; response SSE menambahkan meta event
   `{ t: '', injectedMemoryIds: [...] }` sebelum `[DONE]`. Frontend tetap aman karena
   parser SSE hanya me-render `json.t` non-empty.
2. **`vectorWriter` diekstrak (D2)** — logika embedding (buildEmbeddingChunks, DELETE
   lama, INSERT per-chunk) dipindah dari memory.ts ke `lambda/lib/vectorWriter.ts`
   (`writeNodeEmbedding`), dipakai bersama oleh memory handler dan reflection.
3. **Reflection job (D3)** — `lambda/lib/reflection.ts` + `lambda/handlers/reflect.ts`:
   setiap 7 hari terakhir, ambil user aktif (DISTINCT user_id dari chat_turns, limit
   opsional), ambil max 20 turn terakhir per user, minta LLM mengekstrak **max 8 durable
   facts** (JSON best-effort, no PII, no fabrication), lalu upsert sebagai memory_nodes
   `kind=core`, `verified=true`, `confidence>=0.8`, `weight=0.8`, id deterministic
   `md5(userId || '::' || title)::uuid` (ref_count+1 saat konflik), embedding ulang, dan
   catat audit `REFLECTION_RAN`.
4. **Scheduling via EventBridge (D4)** — Terraform module `eventbridge`: rule
   `cbt-memory-agent-reflect` schedule `rate(6 hours)`, target Lambda dengan event
   `{source: agent.memory, detail-type: reflect}`, permission events.amazonaws.com.
   Lambda `handler.ts` mendeteksi event ini → `handleReflect` (bukan response HTTP API).
5. **Pattern surfacing (D5)** — otomatis: fact reflection `verified=true` +
   `confidence>=0.8` lolos filter `getMemoryContext` (`verified=true AND confidence>=0.6`),
   sehingga langsung muncul di RRF turn berikutnya.
6. **Timeout Lambda dinaikkan 29s → 300s** — reflection bisa >29s (LLM call + upsert);
   diubah di 3 tempat (modules/lambda default, root variables default, terraform.tfvars).

## Consequences

- **Positif**: agent menyimpan insight lintas sesi dan menyuntikkannya ke turn berikutnya;
  loop memori tervalidasi live (3 node reflection + 3 embeddings + 3 audit REFLECTION_RAN).
- **Negatif / batasan**: (a) reflection adalah **best-effort** — jika LLM gagal/rate-limit,
  user di-skip dan dihitung `errors`/`skipped`, tidak retry otomatis; (b) LLM non-deterministik
  → dua run pada data sama bisa menghasilkan jumlah fact berbeda (bukan bug); (c) idempotensi
  via md5 title → judul fact berbeda menghasilkan node berbeda; (d) biaya LLM naik per 6 jam
  (window 7 hari, aktif user terbatas).
- **Kontrol**: audit trail penuh di audit_events (`REFLECTION_RAN`), migration idempotent
  `schema/migration-2026-08-16-reflection-audit.sql` (DROP CONSTRAINT IF EXISTS + ADD).
