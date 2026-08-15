# Usage Ringkasan — Frontend, Ekspektasi, dan Verifikasi Backend

Ringkasan cara fitur dipakai di frontend, apa yang pengguna harapkan, dan bagaimana
backend memproses/verifikasi hasilnya. Berbasis pembacaan kode langsung (bukan spekulasi).

---

## 1. Auth (Magic-link)

| Aspek | Detail |
|---|---|
| **Frontend** | `features/auth` — `AuthPage` → input email + display name → `apiClient.requestMagicLink` → `AuthCallbackPage` → `apiClient.consumeMagicLink` → simpan `sessionToken` via `authSession.ts`. `OnboardingPage` untuk pilih goals. `SessionGate` di router menghalangi akses `/chat`, `/memory`, `/sessions`, dll jika belum auth. |
| **Ekspektasi pengguna** | Login tanpa password; cukup satu email; klaim sesi otomatis; hanya bisa masuk lewat perangkat ini. |
| **Backend** | `handlers/auth.ts` — `handleRequestMagicLink` kirim email (dev: `devUrl`), `handleConsumeMagicLink` validasi token lalu return `sessionToken`. Setiap request ber-auth dicek: handler memanggil `getUserId(crdb, token)` yang menurunkan `md5(token)::uuid` — **deterministic**, jadi token sama = user sama, tanpa tabel sesi. |

## 2. Chat (fitur inti)

| Aspek | Detail |
|---|---|
| **Frontend** | `features/chat` — `ChatPage` (header goals + safety), `MemoryRail` (rel memori yang bisa di-drag), `ChatStream` (virtualized, drag-untuk-inject), `Composer`, `MediaDock` (voice/attachments), `ChatSafetyHeader` (intisari mood/reframe). `chatStore.sendMessage`: detectCrisis → tambah pesan → `callLLMWithFallback` (on-device → backend-proxy → BYOK) streaming token → **fire-and-forget** `apiClient.chatTurn` untuk sinkron ke CRDB. |
| **Ekspektasi pengguna** | Balasan AI streaming, sadar memori (mengangkat memori relevan), aman (tidak menyebut PII, tidak berlanjut saat krisis), bisa voice/attachment/drag-memory. |
| **Backend** | `handlers/chatTurn.ts` — validasi zod `{v:1, sessionId, userMessage, memoryIds?, clientTs, deviceOnly}`. `getMemoryContext`: (1) query heuristik `memory_nodes` (verified+conf≥0.6, id filter), (2) jika `memoryIds` kosong → embed userMessage, query **vector derived-table** (subquery vector search LIMIT 16 → join `memory_nodes`), (3) `reciprocalRankFusion` (k=60, top 8) → mode `hybrid`. Bangun prompt CBT, stream OpenRouter ke SSE, simpan `sessions` + `chat_turns` (user+assistant, `injected_memory_ids`). |
| **Verifikasi backend** | `getMemoryContext` ekspor: `{rows, mode, embeddingMs?, failed?}`. Span `agent.memory.retrieve` + `memory.semantic_search` mencatat `memory.results`, `memory.mode`, `memory.embedding_ms`, `memory.failed`. Query vector sekarang memakai **operator `vector search`** (C-SPANN) — dibuktikan EXPLAIN live (lihat `FIX-VECTOR-SEARCH-FULL-SCAN.md`). |

## 3. Memory / Vault

| Aspek | Detail |
|---|---|
| **Frontend** | `features/memory` — `MemoryPage` (header Vault + input search + tombol hasil semantik), `GraphCanvas` (spatial graph). `memoryStore`: seed lokal → `hydrate()` panggil `GET /memory` → tampilkan node/edge. Aksi user: tambah node (`addNode`), drag/pindah (`moveNode`), link (`linkNodes`), purge (`finishPurge`), verify (`verify`), edit (`updateNode`) — semua **sync fire-and-forget** ke backend. |
| **Ekspektasi pengguna** | Vault tersinkron lintas perangkat; pencarian memahami makna, bukan cuma kata; node yang di-purge hilang permanen. |
| **Backend** | `handlers/memory.ts` — GET list nodes+edges (filter `user_id`); POST upsert node/edge (ON CONFLICT); DELETE node (edges cascade). **Vector writer**: tiap upsert node → `writeNodeEmbedding` → `buildEmbeddingChunks` (title+tags+excerpt, chunk 2000/overlap 100) → delete embedding lama → insert per-chunk ke `embeddings`. Best-effort: embedding gagal tidak menggagalkan upsert. |
| **Semantic search** | `handlers/semanticSearch.ts` GET `/memory/semantic` — embed query → query **vector derived-table** (subquery vector search prefix `user_id` → join `memory_nodes`, filter verified/confidence, `ORDER BY sub.distance`) → `{node, score, matchReason:'vector'}`. Hasil hanya node `verified=true`, `limit` ≤ 20. |
| **Verifikasi backend** | Hydrate gagal → **FAIL-CLOSED**: frontend drop seed demo, tampilkan state kosong + `BackendSyncStatus` (jujur, bukan memori palsu). Tiap aksi sync punya `.catch` yang hanya `console.warn` (offline-safe). |

## 4. Sessions / Journaling

| Aspek | Detail |
|---|---|
| **Frontend** | `features/sessions` — `SessionsPage` (kanban/timeline toggle, search, filter status, pull-to-retry interrupted, `MoodSparkline`, KPI mood delta), `SessionDetailPage` (thought/reframe/excerpt/mood + transcript turns + tombol "Continue similar conversation" + export JSON). `sessionStore`: hydrate via `GET /sessions`, drag antar kolom → `setStatus` → `saveSession`. |
| **Ekspektasi pengguna** | Riwayat sesi terstruktur; pindah status antar kolom tersimpan; detail sesi menampilkan transcript dengan badge "Recalled N memories". |
| **Backend** | `handlers/session.ts` — `handleSaveSession` upsert `sessions` (status: extracted/pending/interrupted, mood, thought, reframe, duration); `handleListSessions` filter status + `ILIKE` query. Transcript: GET `/session/:id/turns` (dari `chat_turns`, termasuk `injected_memory_ids`). |
| **Verifikasi backend** | Setiap transisi status di kanban → POST upsert; `retryInterrupted` (pull-down) menghitung ulang sesi interrupted. Detail turn menampilkan `injectedMemoryIds.length` sebagai "Recalled N memories" — bukti visual bahwa retrieval berjalan. |

## 5. Krisis / Safety

| Aspek | Detail |
|---|---|
| **Frontend** | `features/crisis` — `detectCrisis(text)` di `chatStore.sendMessage` → jika terdeteksi: pesan system "Crisis protocol engaged", `hardHalt` (streaming berhenti), `triggerCrisis` (overlay). `CrisisOverlay`, `BreathingCircle`, `CalmingAudio`, `GroundingGame`, `SwipeToCall`. `CrisisHaltBridge`/`CrisisFusionBridge` menggabungkan sinyal (face + prosody + text). |
| **Ekspektasi pengguna** | Jika menyebut hal berbahaya → aplikasi berhenti, tidak lanjut generate, kasih alat menenangkan + kontak darurat. |
| **Backend** | Fail-closed: `hardHalt` terjadi **di frontend** tanpa perlu backend. Chat turn tetap boleh tersimpan (riwayat), tapi tidak ada generasi lanjutan. |
| **Verifikasi backend** | Krisis adalah keputusan lokal (device); backend tidak mengecek ulang, tapi `chat_turns` menyimpan content user untuk audit. |

## 6. Metrik, Ekspor, Privasi

| Aspek | Detail |
|---|---|
| **Frontend** | `MetricsPage` (GET `/metrics` — northStar, sessions, memory, audit, guardrails). `features/privacy` — export bundle (POST `/export` → S3 URL) + hard purge (POST `/purge`, konfirmasi ketik). |
| **Backend** | `handlers/metrics.ts` (aggregate `audit_events`), `handlers/export.ts` (mint + upload S3 presigned), `handlers/purge.ts` (hard delete per user). |
| **Verifikasi backend** | Response divalidasi shape (v, ok). Purge menghapus row user di seluruh tabel (cascade). |

## 7. Telemetri / Observability (lintas fitur)

| Aspek | Detail |
|---|---|
| **Frontend** | `shared/lib/telemetry.ts` (OTel FetchInstrumentation + OTLP exporter → POST `/api/v1/telemetry`), `trackEvent` → POST `/api/v1/events` (FASE 4). |
| **Backend** | `handlers/telemetry.ts` (relay OTLP), `handlers/events.ts` (insert `audit_events`), `lib/telemetry.ts` (`withSpan`/`startSpan`). Span kunci: `agent.memory.retrieve`, `memory.semantic_search`, `llm.openrouter`, `db.query`. |

## Pola Umum Frontend → Backend → Verifikasi

1. **Backend-primary, local cache**: Zustand stores = cache offline-first; `hydrate()` tarik dari CRDB; aksi = update lokal + sync fire-and-forget ke API.
2. **Auth deterministik**: `user_id = md5(token)::uuid` — tidak ada tabel sesi; token = identity.
3. **Fail-closed**: hydrate gagal → drop seed demo (tidak menampilkan memori palsu); krisis → stop generasi.
4. **Verifikasi backend** = response shape + span observability + (untuk vector) EXPLAIN live membuktikan operator `vector search` dipakai, bukan full scan.

## Gap yang Masih Terbuka (temuan selama ringkasan)

- ~~`handlers/semanticSearch.ts` masih memakai bentuk query JOIN + `embedding IS NOT NULL` (berpotensi full scan)~~ — **sudah ditangani**: diubah ke bentuk derived-table (subquery vector search prefix `user_id` → join `memory_nodes`), filter `IS NOT NULL` dihapus; dibuktikan operator `vector search` via EXPLAIN live (lihat `FIX-VECTOR-SEARCH-FULL-SCAN.md`).
