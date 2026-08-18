# Migrasi Bedrock → OpenRouter (2026-08-14)

Keputusan final: LLM inference + embeddings **dipindah total dari Amazon Bedrock ke OpenRouter**.

Alasan (per `docs/INFRASTRUCTURE-NOTES.md` §5 + riset Devpost):
- Bedrock TIDAK wajib untuk hackathon (cukup ≥1 AWS service: Lambda + S3 sudah memenuhi).
- OpenRouter punya model gratis untuk chat + embedding 1024-dim.
- Tanpa Bedrock → IAM policy + env var + dependency AWS SDK Bedrock bisa dibuang.

## Model yang dipakai (VERIFIED 2026-08-14)
| Fungsi | Model | Dimensi | Status |
|---|---|---|---|
| Chat LLM | `openrouter/free` (router → `nvidia/nemotron-3-super-120b-a12b:free`) | — | ✅ Streaming OK |
| Embeddings | `baai/bge-m3` | 1024 | ✅ Cocok `vector(1024)` |

Catatan verifikasi:
- `snowflake/snowflake-arctic-embed:latest` → **HTTP 400 "does not exist"** (tidak ada di OpenRouter).
- `meta-llama/llama-3.3-70b-instruct:free` → **404** (slot free tidak tersedia; hanya slug berbayar).
- `google/gemma-4-31b-it:free` → **429** upstream rate-limited.
- `nvidia/nemotron-3-embed-1b:free` → 2048-dim (TIDAK cocok, ditolak).
- `openrouter/free` router dipakai agar LLM tidak pernah berbayar.

## Endpoint OpenRouter
- Chat: `POST https://openrouter.ai/api/v1/chat/completions` (stream SSE, header `Authorization: Bearer <key>`)
- Embeddings: `POST https://openrouter.ai/api/v1/embeddings` (OpenAI-compatible, tanpa streaming)
- Health: `GET https://openrouter.ai/api/v1/credits`

## Perubahan Kode

### Backend Lambda
1. **Baru `lambda/lib/openrouter.ts`** — class `OpenRouterClient`:
   - `generateEmbedding(text)` → `baai/bge-m3`, throw jika dimensi != 1024
   - `streamChat(messages)` → async generator hasil stream chat
   - `healthCheck()` → cek `/credits`
   - API key dari `process.env.OPENROUTER_API_KEY`
2. **Hapus `lambda/lib/bedrock.ts`**
3. **`handlers/chatTurn.ts`** — implementasi penuh:
   - Parse body (zod) → upsert user `md5(token)::uuid` → ambil memory context → master prompt (`prompts/klinik-psikolog.md` via `promptLoader.ts`) → stream OpenRouter → SSE `data: {t:"..."}` + `data: [DONE]` → simpan chat_turns
4. **`handlers/semanticSearch.ts`** — implementasi penuh:
   - embedding query → `SELECT ... 1 - (embedding <=> $1::vector) AS score ... ORDER BY <=> LIMIT n` → `{v:1, results}`
5. **`handlers/health.ts`** — `bedrock` → `llm` field
6. **`handler.ts`** — `BedrockClient` → `OpenRouterClient`, hapus `BEDROCK_REGION`
7. **`lambda/package.json`** — hapus `@aws-sdk/client-bedrock-runtime`, regen lockfile

### Terraform
8. `infra/variables.tf` — tambah `openrouter_api_key` (sensitive)
9. `infra/modules/ssm/main.tf` — param `/${env}/openrouter/api-key` (SecureString); root.tf pass var
10. `infra/modules/lambda/main.tf` — data SSM openrouter + env `OPENROUTER_API_KEY`, hapus `BEDROCK_REGION`
11. `infra/modules/iam/main.tf` — **hapus blok bedrock policy**
12. `infra/legacy/serverless.yml` — hapus IAM statement Bedrock

### Frontend + Config
13. `src/shared/lib/apiClient.ts` — `HealthResponse.bedrock` → `llm`
14. `.env` / `.env.example` — tambah `OPENROUTER_API_KEY`

### Docs
15. Update penyebutan Bedrock → OpenRouter di semua file docs. Kebutuhan CRDB (MCP Server + Distributed Vector Indexing) TETAP wajib — jangan diubah.

## Deploy & Verifikasi (SELESAI 2026-08-14)
1. ✅ Verifikasi API OpenRouter: `baai/bge-m3` 1024-dim + `openrouter/free` streaming + `/credits` 200
2. ✅ `bash scripts/build-lambda.sh` → zip 207KB + `npx tsc --noEmit` PASS
3. ✅ `terraform apply` dengan `-var "openrouter_api_key=..."` → SSM `/hackathon/openrouter/api-key` dibuat, bedrock policy dihapus
4. ✅ `aws lambda invoke`:
   - health → `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}`
   - chat/turn → SSE stream respons CBT (tokensUsed 606); users + sessions + chat_turns tersimpan di CRDB
   - semantic → `{"v":1,"results":[]}` (200; embeddings kosong karena `handleUpsertMemory` masih stub)
5. ✅ Update `PROGRESS.md`

**Bug yang ditemukan & diperbaiki saat deploy:**
- `md5($1)` → `md5($1::string)` (CRDB tak bisa infer tipe placeholder, code 42P18)
- chat_turns gagal FK `session_id` → tambah `upsertSession` (INSERT sessions ON CONFLICT DO NOTHING)
- Vector literal harus format `[0.1,0.2,...]` (bukan array JS `{...}`) → helper `toVectorLiteral`, code 22P02
