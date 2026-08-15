# FIX: Vector Search Full Scan — Root Cause & Rencana Fix

> Dokumentasi eksperimen read-only EXPLAIN ANALYZE (live CockroachDB serverless).

## Akar Masalah Ditemukan

Bukti eksperimen (read-only EXPLAIN ANALYZE, live):

| Varian | Bentuk | Operator | KV rows | execution |
|---|---|---|---|---|
| V1 | chat JOIN + DISTINCT ON + `IS NOT NULL` | full scan (hash join) | 20,006 | 311ms |
| V2 | embeddings-only + `IS NOT NULL` | full scan | 10,003 | 260ms |
| V3 | embeddings-only **tanpa** `IS NOT NULL` | **vector search** ✓ | 757 | 81ms |
| V6/V8 | subquery `IN (vector...)` | **vector search** ✓ | 102–104 | 55–59ms |
| V10 | derived-table JOIN + `ORDER BY sub.distance` | **vector search** ✓ | 104 | 66ms |

**Dua blocker yang memaksa full scan:**
1. Filter `e.embedding IS NOT NULL` — vector search berhenti terpilih.
2. Bentuk JOIN langsung (`FROM embeddings e JOIN memory_nodes mn`) — optimizer pilih hash join scan penuh.

**Bentuk yang bekerja:** vector search di subquery → lookup `memory_nodes`.

V10 juga **mempertahankan urutan jarak** (penting untuk RRF). Beam 32/64/128 tidak mengubah plan.

## Rencana Fix

1. **Ubah vector query di `lambda/handlers/chatTurn.ts:248-261` (`getMemoryContext`)** — dari JOIN+DISTINCT ON ke derived-table:
   ```sql
   SELECT mn.id, mn.title, COALESCE(mn.excerpt,'') AS excerpt,
          COALESCE(mn.crisis_flag,false) AS crisisFlag, sub.distance
   FROM memory_nodes mn
   JOIN (SELECT e.node_id, e.embedding <=> $1::vector AS distance
         FROM embeddings e
         WHERE e.user_id = $2::uuid
         ORDER BY e.embedding <=> $1::vector
         LIMIT 16) sub ON sub.node_id = mn.id
   WHERE mn.user_id = $2::uuid AND mn.verified = true AND mn.confidence >= 0.6
   ORDER BY sub.distance
   ```
   - Hapus `AND e.embedding IS NOT NULL` (NULL tak masuk index C-SPANN, aman — 0/10.000 NULL terbukti).
   - LIMIT 16 karena multi-chunk → beberapa embedding per node; RRF dedup by id (`retrieval.ts`) menangani duplikat.
   - Urutan hasil (jarak) jadi rank di set vector untuk RRF.

2. **Update `scripts/load-test-vectors.ts`**: ganti `VECTOR_QUERY` + blok EXPLAIN ke bentuk baru; hapus baris tuning `min_partition_size`/`max_partition_size` (invalid session var); re-run → buktikan `vector search YES` + ukur latensi baseline vs beam.

3. **Sync test**: sesuaikan asersi SQL string di test yang mengecek query vector.

4. **Verifikasi**: `cd lambda && npx tsc --noEmit && npm test` (86+ test) + frontend typecheck.

5. **Update FASE spec + PROGRESS**: centang "EXPLAIN = vector search", catat bukti (104 KV rows vs 20,006; ~59ms).
