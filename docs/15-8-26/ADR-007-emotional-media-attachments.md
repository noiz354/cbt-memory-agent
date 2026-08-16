# ADR-007: Emotional Media Attachments — On-Device Analysis → Vector Indexing + S3

- **Status**: Accepted
- **Date**: 2026-08-16
- **Deciders**: Principal Engineer (agent), per ADDY-OSMANI-SKILLS.md
- **Related**: docs/15-8-26/PLAN-EMOTIONAL-ATTACHMENTS.md, schema/migration-2026-08-16-attachments.sql,
  lambda/handlers/attachments.ts, src/features/chat/lib/attachmentAnalysis.ts

## Context

Aplikasi CBT single-page menangkap media pengguna (snapshot kamera, video, voice note).
Pertanyaan desain: bagaimana media + analisis emosi bisa masuk ke memory vault tanpa
melanggar janji privasi "on-device"? Opsi yang dipertimbangkan:

1. **Analisis di server (Cloud Vision / LLM)** — akurat tapi mengirim wajah/suara mentah ke
   pihak ketiga; bertentangan dengan copy privasi existing dan biaya per-media.
2. **Analisis on-device, simpan narasi + raw media di S3** — emosi diextract di browser
   (MediaPipe face, Whisper, prosody DSP), server hanya menerima hasil deterministik
   (`embedded_narrative` template) + lokasi byte di S3.
3. **Analisis on-device, tanpa raw media** — paling privat tapi kehilangan bukti/arsip media.

## Decision

**Opsi 2 diadopsi** — analisis emosi SELALU on-device; raw media disimpan di S3 via presigned
PUT; server menyimpan `analysis JSONB` + `embedded_narrative` + `s3_key` di tabel `attachments`
baru, dan memory node `kind='attachment'` (verified=true, confidence≥0.6) di-embed dari
narrative penuh → recall otomatis via `getMemoryContext` hybrid RRF (3 leg retrieval tidak
memfilter `kind`).

Keputusan turunan:

1. **Narrative deterministik template** (bukan LLM) — narasi disusun di device dari ekspresi/
   timeline/prosody; embedding memakai bge-m3 yang sudah ada (`writeNodeEmbedding`).
2. **Static valence/arousal mapping** — ekspresi diskret → koordinat valence/arousal (tabel
   statis), bukan ML regression; cukup untuk arc summary + volatility.
3. **S3 raw media dengan presigned PUT** — client upload langsung (Lambda tidak bolos byte),
   key `media/{userId}/{uuid}.{ext}` (prefix user cegah traversal). IAM menambah
   `s3:DeleteObject/DeleteObjects`.
4. **Purge & delete via FK CASCADE** — `attachments.memory_node_id → memory_nodes(id) ON
   DELETE CASCADE` (pola `embeddings`); hard purge menambah `s3.deleteMediaPrefix(userId)`.

## Consequences

- **Positif**: privasi terjaga (face/audio mentah tidak pernah ke LLM/cloud vision); demo
  "kamera → sad 82% → indexed" dan recall "kapan terakhir aku tenang?" bisa dipresentasikan;
  arsitektur reuse pipeline existing (MediaPipe face, Whisper, vector writer).
- **Trade-off**: akurasi emosi lebih kasar dari model cloud (5 label diskret + heuristik
  prosody); template narrative kurang natural vs LLM; biaya S3 + presign round-trip per media.
- **Keamanan**: s3Key divalidasi `startsWith(prefix)`; ext presign divalidasi regex; embed
  narrative batas 8000 char (sudah di `generateEmbedding`); semua SQL parameterized.
- **Sisa di luar ADR ini**: deploy live (terraform apply + migration), video-from-file,
  timeline audio, UI list/delete attachment, rate limit, retry upload.
