# Free Tier Research — OTel Cost Guardrails

> Verified via web 2026-08-15 (grafana.com/pricing, aws.amazon.com/free). Berlaku untuk stack CBT Memory Agent + Grafana Cloud OTLP.

---

## 1. Grafana Cloud Free (stack 1494299 · prod-ap-southeast-2)

| Signal | Kuota free/bulan | Retention | Status | Catatan |
|---|---|---|---|---|
| **Traces (Tempo)** | 50 GB ingest | 14 hari | ✅ aman | volume hackathon « 50GB |
| **Logs (Loki)** | 50 GB ingest | 14 hari | ✅ aman | batasi log spans, jangan log payload PII |
| **Metrics (Mimir)** | 10k active series | 14 hari | ✅ aman | jaga cardinality rendah |
| Frontend Observability | 50k sessions/mo | — | opsional | tidak dipakai (pakai OTel web langsung) |
| Application Observability | 2,232 host-hr/mo | — | opsional | tidak relevan (serverless) |
| Grafana Assistant | 3 AI users / 40M tokens | — | opsional | tidak dipakai |
| Agent Observability | 30k generations/mo | — | opsional | tidak dipakai (manual spans) |

**Hard limits / guardrails:**
- Kuota dihitung per **ingest**, bukan per query. OTLP push tetap gratis selama < kuota.
- **Jangan** export span granularity tinggi dari loop 5Hz face/polling — hanya span user-action penting.
- Traces & logs share bucket terpisah (masing-masing 50GB) — tidak saling mengganggu.
- **Rate limit OTLP:** Grafana Cloud menerapkan limit burst (~10k spans/detik per instance pada free tier); jaga default sampling.
- Retensi 14 hari berarti trace lama otomatis terhapus — tidak ada biaya retention di free.

## 2. AWS ap-southeast-3 (Jakarta)

> Stack ini TIDAK pakai EC2 — memakai Lambda Function URL + SSM + S3 + CloudWatch. EC2/EBS/egress di bawah untuk lengkapnya.

| Resource | Kuota free (12 bulan) | Dipakai stack? | Cost |
|---|---|---|---|
| EC2 t3.micro | 750 h/bulan | ❌ tidak dipakai | — |
| EBS gp2/gp3 | 30 GB | ❌ tidak dipakai | — |
| Egress internet | 100 GB/bulan | ✅ minimal (Lambda ↔ CRDB/OpenRouter/Grafana) | ✅ $0 |
| **Lambda** | 1M req/mo + 400k GB-s | ✅ **dipakai** | ✅ $0 |
| Lambda Function URL | termasuk | ✅ | ✅ $0 |
| SSM Parameter Store | 10k parameter (standard + SecureString) | ✅ ~8 param (+2 baru: grafana/otlp) | ✅ $0 |
| CloudWatch Logs | 5 GB ingest + retention 7 hari (sudah diset) | ✅ | ✅ $0 |
| S3 | 5 GB storage | ✅ export bundles | ✅ $0 |

**Guardrails eksisting yang tetap berlaku:**
- Budget modul Terraform: **$1/bulan** (infra/modules/budget/main.tf) → alert 50/80/100%.
- CloudWatch retention 7 hari (infra/modules/lambda/main.tf).
- Tanpa NAT Gateway / VPC → OTLP HTTPS publik langsung dari Lambda (tidak ada biaya NAT $32/bulan).
- Tambahan **egress ke Grafana** masuk kuota 100GB/mo — volume telemetri hackathon ≈ KB, tidak signifikan.

## 3. Cloudflare Free

| Fitur | Kuota | Relevansi |
|---|---|---|
| CDN | **Unlimited bandwidth**, no limit file count | optional (frontend bisa via Cloudflare Pages) |
| Cloudflare Tunnel | **Gratis, unlimited** | opsi akses lokal/private ke dev tanpa expose |
| Zero Trust Access | **Gratis untuk ≤50 user** | opsi proteksi endpoint internal |

Saat ini stack TIDAK memakai Cloudflare (Lambda Function URL langsung). Opsi disimpan sebagai pengganti jika ingin custom domain HTTPS di depan frontend.

## 4. Estimasi cost telemetri (hackathon 5 hari)

| Item | Estimasi | Cost |
|---|---|---|
| Traces ingest | < 50 MB | ✅ $0 |
| Logs ingest | < 20 MB | ✅ $0 |
| Metrics series | ~20 series aktif | ✅ $0 |
| Lambda tambahan (relay /api/v1/telemetry) | < 1k req | ✅ $0 (dalam kuota 1M) |
| **TOTAL** | | **$0** |

## 5. Sampling strategy (guardrail biaya + perf)

- **Backend:** semua span endpoint di-sampling 100% (volume kecil) TAPI jangan instrument loop; batch processor.
- **Frontend:** hanya span user-action (klik chat, session finalize, error) — bukan setiap frame/audio.
- **Metrics:** histogram `llm.latency`, counter `llm.tokens`, counter `http.requests` — cardinality rendah (tanpa per-user high-cardinality label).
- **Logs:** jangan log isi pesan user / token / PII ke Loki. Log hanya metadata (method, path, status, trace_id, duration).

## Verdict

✅ **SEMUA FREE TIER COMPATIBLE** — Total estimasi cost: **$0** untuk 5 hari hackathon, selama sampling & cardinality dijaga.
