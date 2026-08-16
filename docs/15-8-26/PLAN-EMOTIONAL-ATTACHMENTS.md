# Plan — Emotional Media Attachments: On-Device Analysis → CockroachDB Vector Indexing + S3

> Status: **Shipped 2026-08-16** — Build (TDD) → Verify → Review → Ship, workflow
> `docs/15-8-26/ADDY-OSMANI-SKILLS.md`.
> Implementation commits: `143faa5` (backend+schema), `a33a7b7` (on-device analysis),
> `9155b37` (UI wiring), `8d7592b` (review fixes). Deploy live (terraform apply +
> migration CRDB) = sisa di luar sesi ini.

## Ringkasan

Attachment media emosional (gambar/video/audio) di-analysis **on-device** lalu di-index
ke CockroachDB sebagai memory node `kind='attachment'` (di-embed dari narrative deterministik),
dengan **raw media di S3** (presigned PUT). Recall otomatis via hybrid RRF `getMemoryContext`
(karena tidak ada filter kind di 3 leg retrieval).

## Keputusan (disetujui user)

1. **Implementasi penuh + TDD** — lambda vitest + setup vitest frontend (baru).
2. **Prosody lengkap + pitch** — autocorrelation (bukan RMS saja).
3. **Video temporal arc** — frame sampling 1/5s → timeline → arc/volatility.
4. **Static valence/arousal mapping** — bukan ML regression.
5. **Raw media disimpan di S3** — presigned PUT via Lambda.

## Arsitektur

```
Capture → on-device analysis (face/prosody/transcript) → narrative template
  → POST /attachments/presign → presigned PUT → raw media → S3 media/{userId}/{uuid}.ext
  → POST /attachments {analysis, embeddedNarrative, s3Key, title, confidence}
    → Lambda: INSERT memory_nodes(kind='attachment', verified=true) + attachments + writeNodeEmbedding
    → recall via getMemoryContext (3 leg) + injectedMemoryIds
```

## Skema

- **`memory_nodes.kind`** CHECK diperluas: `('core','transcript','attachment')`.
- **`attachments`** (baru): `id UUID PK`, `user_id FK CASCADE`, `memory_node_id FK
  memory_nodes(id) CASCADE`, `kind CHECK ('image','video','audio')`, `duration_ms`,
  `frame_count`, `analysis JSONB`, `embedded_narrative`, `s3_key`, `mime_type`,
  `size_bytes`, `session_id`, `turn_id`, `extracted_on_device`, `pipeline_version`,
  `created_at`, + 3 index. Raw media hanya `s3_key`; byte-nya di S3.

## API

| Route | Handler | Keterangan |
|---|---|---|
| POST `/api/v1/attachments/presign` | `handlePresignAttachment` | `{v:1,key,uploadUrl}`, key `media/{userId}/{uuid}.{ext}`, ext divalidasi `[a-zA-Z0-9]{1,8}` |
| POST `/api/v1/attachments` | `handleCreateAttachment` | validasi kind/narrative/title + `s3Key.startsWith(prefix)`; INSERT node+attachments+embedding → `{nodeId,attachmentId=nodeId}` |
| GET `/api/v1/attachments` | `handleListAttachments` | join memory_nodes, order created_at DESC |
| DELETE `/api/v1/attachments/:id` | `handleDeleteAttachment` | match `memory_node_id::string=$1` (id yang dikembalikan create); delete S3 object best-effort + node (cascade) |

## On-device pipeline (frontend)

- **`emotionMapping.ts`**: static `expression→{valence,arousal}` (neutral/engaged/tense/sad/
  distressed), `EMOTION_VA` (tambah anxious/calm/hopeless/tired/angry/irritable),
  `secondaryEmotionFrom`, `prosodyToEmotion` (heuristik wpm/pause/energy/pitchVar),
  `textEmotionFrom` (lexicon EN/ID).
- **`prosody.ts`**: `computeProsody(samples, sampleRate, {wordCount})` — RMS per 20ms frame,
  pitch autocorrelation (fundamental = lag pertama ≥85% puncak korelasi), pause ratio, wpm.
- **`prosody.worker.ts`**: decode blob → `computeProsody` di worker.
- **`attachmentAnalysis.ts`** (pure): `analyzeImageSnapshot` (narrative + secondary +
  'approximately confidence' bila model fallback), `analyzeVideoTimeline` (timeline sorted,
  dominant = sum confidence, volatility = stddev arousal, arcSummary template), `analyzeAudio`
  (text 0.5 · prosody 0.3 · face 0.2, fused confidence = bestScore/availableWeight).
- **`faceClient.analyzeFrame(frame)`**: worker one-shot dedikasi, model hangat, copy buffer,
  queue FIFO; `stopAnalyzeWorker()` reject semua pending.
- **`face.worker.ts`**: mode `{type:'analyze'}` — warm model → MediaPipe classify → fallback;
  rejection apapun → `fallbackSignal` (tidak pernah hang).
- **`attachmentIndex.ts`**: orchestrasi presign→PUT→create; throw → UI toast.
- **`videoNote.ts`**: `startVideoNote/stopVideoNote/cancelVideoNote` (MediaRecorder video+audio),
  `buildVideoTimeline(blobUrl, durationMs)` — seek step `max(5000, durationMs/12)`, ≤12 sample,
  `analyzeFrame` per frame.
- **`voiceAttachment.ts`**: `analyzeVoiceProsody(blobUrl, wordCount)` → `indexVoiceNote`.

## UI

- **CameraPip**: tombol "Analyze & save" → one-shot face → narrative → index; Check saat sukses.
- **VideoRecorderPip** (Composer, sebelah HoldToTalkOrb): hold-to-record → timeline → index.
- **HoldToTalkOrb**: setelah send, `indexVoiceNote` best-effort (toast teal/danger).
- **Composer**: accept `image/*,video/*,audio/*` (image dapat preview), kind mapping baru.
- **ChatBubble**: ikon image/video/audio; **MemoryKind='attachment'** di types/memoryStore/
  GraphNodeCard (icon Image + label "Attachment")/NodeInspector/MemoryPage count.
- **Privacy copy**: AuthPage lede, MediaDock badge, chat seed message — "raw media stays
  in-browser; only the clinical summary syncs".

## Verify (semua hijau)

- Lambda: **136 tests / 16 files** pass (`npx vitest run`), `tsc --noEmit` clean,
  `typecheck:test` hanya error pra-eksisting (memory.test.ts, reflection.test.ts 215/226).
- Frontend: **25 tests / 3 files** pass (`npm test`), `npm run build` (tsc -b && vite build)
  clean (chunk-size warning pra-eksisting).
- Catatan: `npx tsc --noEmit` tidak menangkap semua error yang `npm run build` (tsc -b) tangkap
  (TS2367 video kind, TS2345 attachFiles, TS6133 unused nodeId, TS2322 prosody) — sudah diperbaiki.

## Review (8d7592b)

- **fix**: delete attachment di-match `memory_node_id` (bukan `attachments.id` auto-gen yang
  tidak pernah sama dengan id yang dikembalikan create) → mencegah delete-by-nodeId selalu 404.
- **fix**: presign ext divalidasi regex (cegah S3 key malformed/traversal dalam prefix user).
- **fix**: face.worker analyze `.catch` → fallback signal (analisis tidak pernah hang).
- `getUserId` private helper = pola existing di 4 handler (memory/semanticSearch/session) — konsisten.

## Scope / batas

- Narrative = **template on-device** (deterministik, tanpa LLM).
- Belum: video-from-file (hanya rekam langsung), timeline audio, UI delete/list attachment,
  pagination list, rate limit, retry upload S3.
- Export bundle tetap metadata-only (previewUrl di-strip) — tidak berubah.
