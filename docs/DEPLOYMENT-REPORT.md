# Deployment Report — CBT Memory Agent

> Proyek: **CBT Memory Agent** (CockroachDB × AWS Hackathon 2026)
> Tanggal: **2026-08-14**
> Lingkungan: `hackathon`
> Status: **✅ Deployed** (deployment selesai, endpoint dapat diakses)

---

## 1. Ringkasan Deployment

Stack aplikasi serverless **CBT Memory Agent** berhasil di-deploy ke AWS region **ap-southeast-3**
(account `926375049642`) menggunakan **Terraform** (state remote di S3). Aplikasi memakai **AWS Lambda
+ Function URL** sebagai API, **S3** untuk bundle export, **SSM Parameter Store** untuk secret, dan
**CockroachDB Serverless** sebagai database.

| Komponen | Nilai |
|---|---|
| Stack | Terraform 1.15.8 + hashicorp/aws **6.60.0** |
| Region | `ap-southeast-3` (Jakarta) |
| Fungsi | `cbt-memory-agent` (nodejs22.x, 256MB, timeout 29s) |
| Endpoint API | `https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws/` |
| Total resource terkelola | **26** |
| Backend state | `s3://cbt-memory-agent-terraform-state-apse3/hackathon/terraform.tfstate` |

Deployment sempat gagal di tengah jalan (token expired + drift resource), kemudian berhasil
dipulihkan. Semua insiden terdokumentasi di bagian [5. Insiden & Resolusi](#5-insiden--resolusi-pelajaran).

---

## 2. Yang Di-Deploy

### Infrastruktur (26 resource di state)

| Modul / Resource | Detail |
|---|---|
| **Lambda** (`module.lambda`) | `cbt-memory-agent` — runtime nodejs22.x, publish versi, 7-hari log retention |
| Function URL | `auth_type = NONE` (demo), CORS `*`, InvokeMode BUFFERED |
| **S3** | Bucket `cbt-memory-exports` (force_destroy, BucketOwnerEnforced) |
| **IAM** (`module.iam`) | Role `cbt-memory-agent-execution` + 4 policy (logs, metrics, s3, ssm_read) |
| **SSM** (`module.ssm`) | 6 parameter: crdb url, cluster id, ccloud api key, openrouter key, daily cap, pepper |
| **Budget** (`module.budget`) | AWS Budgets alert (kontrol biaya hackathon) |
| **State backend** | S3 bucket + versioning + SSE + DynamoDB lock (migrasi ke `use_lockfile`) |

### Output Deployment

```
function_url       = https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws/
function_arn       = arn:aws:lambda:ap-southeast-3:926375049642:function:cbt-memory-agent
function_name      = cbt-memory-agent
exports_bucket     = cbt-memory-exports
log_group_name     = /aws/lambda/cbt-memory-agent
cloudwatch_dashboard = https://console.aws.amazon.com/cloudwatch/home#dashboards/dashboard:CBTMemoryAgent
ssm_parameters     = { ccloud_api_key, cluster_id, crdb_url, daily_cap, pepper → /hackathon/... }
```

> 🔒 Secret (CRDB connection URL, API keys) **tidak** dicetak di laporan ini — tersimpan di
> `.env` (lokal, gitignored) dan SSM Parameter Store.

---

## 3. Langkah Deployment yang Dieksekusi

1. **Setup credentials bridge** — tambah profile `aws-x-cdb-terraform` dengan `credential_process`
   di `~/.aws/config` agar SDK terraform membaca session AWS CLI 2.36 (`login_session`).
2. **Buka stale lock** — `terraform force-unlock` (lock sisa apply yang crash).
3. **Import resource yang sudah ada** (drift recovery):
   - `module.lambda.aws_lambda_function.this`
   - `module.lambda.aws_cloudwatch_log_group.lambda`
   - `module.lambda.aws_lambda_function_url.this`
4. **Plan & apply** — resource baru (S3 exports, function URL) dibuat, resource lama diadopsi.
5. **Koreksi backend** — hapus parameter deprecated `dynamodb_table`, pakai `use_lockfile = true`;
   `terraform init -reconfigure`.
6. **Fix Function URL 403** (lihat insiden #3):
   - Upgrade provider `hashicorp/aws` 5.100.0 → **6.60.0** (`~> 6.0`).
   - Tambah resource `aws_lambda_permission` dengan `invoked_via_function_url = true`.
   - Plan & apply → `1 to add, 1 to change`.
7. **Fix format event v1 vs v2.0** (lihat insiden #4):
   - Patch `lambda/handler.ts` agar mendukung payload v2.0 (Function URL / HTTP API).
   - `scripts/build-lambda.sh` → zip baru → `terraform apply` (hanya update lambda).
8. **Verifikasi end-to-end** (lihat bagian 4) — success flow `200` via URL publik.
9. **Integrasi frontend-backend** (2026-08-14):
   - Implementasi handler memory & session **real** (CRUD CockroachDB) di `lambda/handlers/`.
   - Fix FK write: `getUserId()` kini `ensureUser` (`INSERT INTO users ON CONFLICT DO NOTHING`).
   - Read-side `hydrate()` di `memoryStore` + `sessionStore` (server wins; empty server = empty state).
   - Vite dev proxy `/api/v1` → Function URL (via `VITE_PROXY_TARGET` di `.env`).
   - LLM `backend-proxy` diarahkan ke `/api/v1/chat/turn` (SSE) — fallback chain kini sehat.
   - Build zip → `terraform apply` (update lambda) → verifikasi roundtrip memory/session (lihat #4).

---

## 4. Hasil Verifikasi

| Uji | Hasil |
|---|---|
| `aws sts get-caller-identity` (profile bridge) | ✅ Sukses |
| Lambda state | ✅ `Active`, `LastUpdateStatus: Successful`, `nodejs22.x` |
| Function URL config | ✅ `AuthType: NONE`, BUFFERED |
| S3 bucket exports | ✅ `cbt-memory-exports` reachable |
| **Success flow** `GET /api/v1/health` (tanpa auth) | ✅ **HTTP 200** `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}` |
| **Auth flow** `GET /api/v1/memory` (Bearer + X-Device-Id) | ✅ **HTTP 200** `{"v":1,"nodes":[],"edges":[]}` (terhubung CockroachDB) |
| Auth enforcement (tanpa `X-Device-Id`) | ✅ HTTP 401 `{"error":"Missing X-Device-Id header"}` |
| Direct invoke (`aws lambda invoke`) | ✅ HTTP 200 |
| CORS preflight `OPTIONS` | ✅ HTTP 200 + header CORS lengkap |
| CloudWatch log stream | ✅ Ada — membuktikan invoke masuk |
| Resource-based policy (2 statement) | ✅ `lambda:InvokeFunctionUrl` + `lambda:InvokeFunction` (InvokedViaFunctionUrl=true) |
| `terraform plan` (idempotency) | ✅ Tidak ada diff yang tak diinginkan |
| **Memory write** `POST /api/v1/memory` (upsert node) | ✅ **HTTP 200** `{"v":1,"ok":true,"id":"..."}` |
| **Memory read** `GET /api/v1/memory` | ✅ **HTTP 200** node+edges dari CockroachDB (typed: `weight:0.7`, `references:0`) |
| **Memory delete** `DELETE /api/v1/memory/:id` | ✅ HTTP 200 (edge ter-cascade) |
| **Session write** `POST /api/v1/session` | ✅ **HTTP 200** `{"v":1,"ok":true,"id":"..."}` |
| **Session read** `GET /api/v1/sessions` | ✅ **HTTP 200** daftar session dari CockroachDB (typed: `mood:7`) |
| **Vite dev proxy** `localhost:5173/api/v1/*` | ✅ HTTP 200 — proxy ke Function URL (health/memory roundtrip) |

---

## 5. Insiden & Resolusi (Pelajaran)

### Insiden #1 — `ExpiredToken` saat apply awal + stale state lock

**Gejala:** Semua operasi (S3/Lambda/DynamoDB) ditolak `ExpiredToken`; apply gagal di tengah,
meninggalkan state lock dan `errored.tfstate`.

**Root cause:** AWS CLI 2.36 menyimpan session SSO di `~/.aws/cli/cache/session.db` (SQLite) dengan
key `login_session`. AWS CLI memahaminya, tapi **AWS provider terraform (aws-sdk-go-v2) tidak** →
`No valid credential sources found`. Ditambah token role yang expired di tengah apply (durasi 1 jam).

**Resolusi:**
- Profile bridge `aws-x-cdb-terraform` dengan `credential_process = aws configure export-credentials --profile aws-x-cdb --format process`.
- `terraform force-unlock` untuk lock yang sudah tidak aktif.
- Import resource yang sudah ada, lalu apply ulang.

**Pelajaran:** Gejala yang menyesatkan — CLI sukses tapi terraform gagal karena **backend dan
provider memakai SDK berbeda**. Selalu verifikasi dengan `aws sts get-caller-identity` sebelum apply,
dan gunakan profile bridge untuk semua tool non-CLI.

> 📄 Detail lengkap: `docs/TERRAFORM-DEPLOYMENT-ERROR-LOG.md`

### Insiden #2 — `ResourceConflictException: FunctionUrlConfig exists`

**Gejala:** Apply kedua gagal karena function URL sudah ada di AWS tapi belum ada di state.

**Root cause:** Function URL dibuat oleh apply pertama yang sebagian berhasil (sebelum crash),
tapi tidak ter-import.

**Resolusi:** `terraform import 'module.lambda.aws_lambda_function_url.this' cbt-memory-agent`,
lalu plan/apply ulang.

**Pelajaran:** Saat apply gagal di tengah, selalu bandingkan resource di AWS vs state sebelum
retry. Import lebih aman daripada menghapus resource produksi.

### Insiden #3 — Function URL 403 `AccessDeniedException` (fix hari ini)

**Gejala:** Endpoint balas **403 Forbidden** untuk semua GET/POST, sementara `OPTIONS` 200 dan
direct invoke (via CLI) 200. Lambda tidak pernah di-invoke (0 log stream).

**Root cause:** Sejak **Oktober 2025**, AWS mewajibkan function URL dengan `auth_type = NONE`
punya **2 statement** di resource-based policy:
1. `lambda:InvokeFunctionUrl` (condition `FunctionUrlAuthType = NONE`)
2. `lambda:InvokeFunction` (condition `InvokedViaFunctionUrl = true`)

Resource policy kita hanya punya statement #1 → statement #2 **missing** → semua invoke ditolak AWS,
**meskipun AuthType NONE**. Provider 5.100.0 juga belum otomatis menambah statement #2
(auto-add baru ada di provider **≥ 6.28.0**).

**Resolusi:**
- Upgrade provider `hashicorp/aws` `~> 5.0` → `~> 6.0` (6.60.0), `terraform init -upgrade`.
- Tambah di `infra/modules/lambda/main.tf`:

```hcl
resource "aws_lambda_permission" "function_url_invoke" {
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.this.function_name
  principal                = "*"
  statement_id             = "FunctionURLInvokeAllowPublicAccess"
  invoked_via_function_url = true
}
```

- Plan & apply → **401 aplikasi** (endpoint hidup), policy kini 2 statement.

**Pelajaran:**
1. **Jangan berasumsi 403 berarti request sampai ke aplikasi** — periksa `x-amzn-ErrorType` di
   header respons (di sini `AccessDeniedException` = ditolak di layer AWS).
2. **`OPTIONS` 200 ≠ aplikasi jalan** — preflight CORS di-handle infra tanpa invoke lambda;
   gunakan log stream CloudWatch sebagai bukti invoke benar-benar masuk.
3. **Kebijakan AWS berubah (Oct 2025)** — requirement 2-permission untuk function URL.
   Selalu cek dokumentasi resmi saat perilaku tak terduga, bukan menebak.
4. **Provider lama belum punya fix** — argumen `invoked_via_function_url` baru tersedia
   di provider ≥ 6.28.0; upgrade provider bila perlu.

### Insiden #4 — Handler format event v1, Function URL kirim v2.0 (fix hari ini)

**Gejala:** Setelah insiden #3 beres, request sampai ke aplikasi tapi semua endpoint balas
**401 `Missing Authorization header`** — termasuk `/api/v1/health` yang seharusnya bebas auth.

**Root cause:** Handler ditulis untuk format event **API Gateway v1** (`event.path`,
`event.httpMethod`, header case-sensitif). Tapi **Lambda Function URL** (dan modul `apigw`
di repo ini yang memakai HTTP API `payload_format_version = "2.0"`) mengirim **payload v2.0**:
- path ada di `event.rawPath` (bukan `event.path` → selalu `undefined`)
- method ada di `event.requestContext.http.method` (bukan `event.httpMethod`)
- nama header **dinormalisasi ke lowercase** (`authorization`, `x-device-id`)

Akibatnya: health tidak pernah di-skip auth, dan tidak ada route yang cocok → app
**tidak dapat digunakan** lewat URL, padahal kode aplikasinya sehat (direct invoke 200).

**Bukti:** Direct invoke dengan event gaya v1 (`path`/`httpMethod`) → `GET /api/v1/health`
mengembalikan **200** `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}`;
via Function URL sebelum patch → 401.

**Resolusi (patch `lambda/handler.ts`):**
```ts
type HandlerEvent = APIGatewayProxyEvent & {
  rawPath?: string;
  rawQueryString?: string;
  requestContext?: { http?: { method?: string } };
};

const path   = event.rawPath ?? event.path ?? "";
const method = event.requestContext?.http?.method ?? event.httpMethod ?? "";

// v2.0 / Function URL menormalkan nama header ke lowercase
const headers: Record<string, string> = {};
for (const [key, value] of Object.entries(event.headers ?? {})) {
  headers[key.toLowerCase()] = value ?? "";
}
const token    = headers["authorization"]?.replace(/^Bearer\s+/i, "") ?? "";
const deviceId = headers["x-device-id"] ?? "";
const queryStringParameters =
  event.queryStringParameters ?? parseQueryString(event.rawQueryString ?? "");
```

Lalu rebuild (`scripts/build-lambda.sh`) dan redeploy via terraform (hanya update
`source_code_hash`, tidak ada resource lain berubah).

**Verifikasi setelah patch (lewat URL publik):**
- `GET /api/v1/health` → **200** `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}`
- `GET /api/v1/memory` + `Authorization` + `X-Device-Id` → **200** `{"v":1,"nodes":[],"edges":[]}`
- Tanpa `X-Device-Id` → 401 (auth tetap enforce)

**Pelajaran:**
1. **Format event menentukan segalanya** — REST API v1 vs HTTP API/Function URL v2.0
   berbeda field & casing header. Tulis handler yang kompatibel dua-duanya
   (`rawPath ?? path`, `requestContext.http.method ?? httpMethod`, lookup header lowercase).
2. **"Request sampai aplikasi" belum berarti aplikasi bisa dipakai** — 401/`Missing
   Authorization` di semua endpoint adalah red flag format-event, bukan sekadar auth.
3. **Verifikasi dengan success flow nyata**, bukan hanya status non-5xx. Gunakan endpoint
   tanpa auth (`/api/v1/health`) sebagai smoke test end-to-end (memvalidasi CRDB, LLM, S3).
4. **Modul `apigw` di repo ini punya masalah yang sama** (HTTP API v2.0) — tidak dipakai,
   tapi bila diaktifkan harus tetap lewat handler yang sudah di-patch.

### Insiden #5 — Write memory/session gagal 500 (FK `user_id`), read 200

**Gejala:** Setelah handler memory/session ditulis real (CRUD CRDB), `GET /api/v1/memory`
dan `GET /api/v1/sessions` sukses 200, tapi `POST /api/v1/memory` (upsert node/edge) dan
`POST /api/v1/session` gagal **HTTP 500** `{"error":"Failed to save memory/session"}`.
CloudWatch: `violates foreign key constraint ..._user_id_fkey` — `user_id` tidak ada di tabel `users`.

**Root cause:** Handler `handleUpsertMemory`/`handleSaveSession` langsung `INSERT` ke
`memory_nodes`/`sessions` dengan `user_id = md5(token)::uuid`, tapi row `users` untuk UUID itu
belum pernah dibuat (di `chatTurn` user di-`upsert` sebelum menulis). Read tidak kena karena
tidak ada FK check pada `SELECT`.

**Resolusi:** `getUserId()` di `lambda/handlers/memory.ts` dan `session.ts` kini men-`INSERT INTO
users (id, email, display_name, auth_method) VALUES (md5(token)::uuid, token, 'device-user',
'passkey') ON CONFLICT (id) DO NOTHING` sebelum menulis — pola sama dengan `upsertUser()` di
`chatTurn.ts`. Sekaligus `toNode()`/`toSession()` diberi koersi `Number(...)`/`!!` karena
CockroachDB mengembalikan INT/BOOL sebagai **string** via pg (`references:"0"`, `mood:"7"`) yang
akan merusak tipe numerik di frontend.

**Pelajaran:**
1. **FK constraint tidak hanya soal relasi — harus ada row parent-nya.** Token sebarang bisa
   menjadi `user_id` yang valid secara format tapi belum tentu ada di `users`. Selalu `ensureUser`
   pada path write.
2. **Read vs write punya jalur error berbeda** — GET sukses ≠ POST pasti sukses. Selalu tes
   roundtrip (tulis → baca → hapus), bukan cuma baca.
3. **CockroachDB lewat pg driver mengembalikan numerik/bool sebagai string.** Koersikan eksplisit
   di boundary JSON (`Number()`, `!!`) agar tipe kontrak API stabil.

---

## 6. Rollback Plan

| Skenario | Langkah |
|---|---|
| **Rusak aplikasi (kode)** | Re-deploy zip lama: `scripts/build-lambda.sh` lalu `terraform apply` (source_code_hash berubah otomatis) |
| **Rusak infrastruktur** | `terraform plan` review → `terraform apply` versi state sebelumnya (state di S3, ada versioning) |
| **Mau hapus total** | `terraform destroy -var-file=environments/hackathon.tfvars` (hati-hati: `force_destroy` pada S3 exports) |
| **Endpoint tak bisa diakses** | Cek: resource policy (2 statement), log group, `aws sts get-caller-identity` untuk creds |

Resource **tidak** punya `prevent_destroy`; database (CockroachDB) terpisah dari terraform sehingga
tidak ikut ter-destroy.

---

## 7. Status Pasca-Deployment & Sign-off

- [x] Lambda `Active`, runtime nodejs22.x, `LastUpdateStatus: Successful`
- [x] **Success flow `GET /api/v1/health` → HTTP 200** (`crdb: connected`, `llm: available`, `s3: available`)
- [x] **Auth flow** endpoint ber-auth → HTTP 200 (CRUD terhubung CockroachDB)
- [x] Function URL dapat diakses publik (tanpa 403/401 AWS)
- [x] Resource-based policy lengkap (2 statement — compliant dengan kebijakan Oct 2025)
- [x] S3 exports bucket tersedia
- [x] SSM parameters terisi (crdb, ccloud, openrouter, pepper)
- [x] CloudWatch dashboard + log group aktif (retensi 7 hari)
- [x] Provider upgraded 5.100.0 → 6.60.0, plan bersih
- [x] 26 resource di state, tidak ada drift
- [x] **Memory roundtrip real** (upsert → list → delete) → HTTP 200 semua, data di CockroachDB
- [x] **Session roundtrip real** (save → list) → HTTP 200 semua, tipe numerik ter-koersi (`mood:7`)
- [x] **Vite dev proxy** `localhost:5173/api/v1/*` → Function URL → HTTP 200
- [x] Integrasi frontend: read-side hydrate aktif (server wins), empty states benar, LLM backend-proxy sehat

**Deployer:** Norman (AWS SSO `AdministratorAccess`, profile bridge `aws-x-cdb-terraform`)
**Status:** ✅ **SUCCESS** — deployment diterima untuk keperluan hackathon.

---

## Referensi

- `docs/TERRAFORM-DEPLOYMENT-ERROR-LOG.md` — log error lengkap insiden #1–#2
- `infra/` — konfigurasi terraform (main.tf, backend.tf, modules/)
- [AWS: Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
