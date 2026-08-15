# Ringkasan Skills Addy Osmani

> Disusun: 2026-08-15 · Sumber: skill terinstall di `~/.agents/skills/` (terdaftar di `AGENTS.md` proyek).
> **30 skill** dari 2 repo: **agent-skills** (24, github.com/addyosmani/agent-skills, ~87k stars) + **web-quality-skills** (6, github.com/addyosmani/web-quality-skills, ~2.6k stars). License MIT.
> 26 dari 30 terverifikasi identik dengan GitHub `main`; 4 sudah di-update (spec-driven-development, planning-and-task-breakdown, api-and-interface-design, security-and-hardening).

Skill dikelompokkan mengikuti alur kerja **Define → Plan → Build → Verify → Review → Ship**, plus satu paket **Web Quality** terpisah.

---

## 1. Define — mempertajam masalah sebelum menulis kode

| Skill | Trigger / kapan dipakai | Inti |
|---|---|---|
| **using-agent-skills** | Memulai sesi / ragu skill mana yang cocok | Skill meta: cara menemukan & meng-invoke semua skill lain. |
| **interview-me** | "build me X" tanpa detail; "interview me", "grill me" | Wawancara satu-pertanyaan-tiap-kali sampai ~95% yakin maksud sebenarnya; mengungkap yang diinginkan vs yang dikira diinginkan. |
| **idea-refine** | Ide masih samar; "ideate", "refine this idea", "stress-test my plan" | Berpikir divergen lalu konvergen: melebarkan opsi sebelum memilih, menguji asumsi sebelum komit. |
| **spec-driven-development** | Proyek/fitur baru tanpa spec; requirement ambigu | Membuat spec sebelum coding; memecah requirement lintas-kapabilitas menjadi capability map modul. |

## 2. Plan — memecah kerja jadi tugas terurut

| Skill | Trigger / kapan dipakai | Inti |
|---|---|---|
| **planning-and-task-breakdown** | Ada spec jelas tapi tugas terasa besar; butuh estimasi / kerja paralel | Memecah pekerjaan jadi tasks terurut; menaksir scope; mengidentifikasi peluang paralel. |

## 3. Build — menulis kode yang benar dan teruji

| Skill | Trigger / kapan dipakai | Inti |
|---|---|---|
| **incremental-implementation** | Perubahan menyentuh >1 file; mau menulis kode dalam jumlah besar | Menyerahkan perubahan bertahap, mendarat dalam langkah kecil. |
| **test-driven-development** | Implementasi logika / fix bug / ubah perilaku; butuh bukti kode jalan | Menulis tes dulu, lalu kode; TDD untuk setiap perubahan perilaku. |
| **context-engineering** | Sesi baru; kualitas output menurun; setup rules files | Mengoptimalkan setup konteks agent (rules/AGENTS.md) agar output konsisten. |
| **source-driven-development** | Bangun dengan framework/library; kebenaran penting | Setiap keputusan implementasi bersandar pada dokumentasi resmi; kode ter-cite, anti pola basi. |
| **doubt-driven-development** | Correctness > kecepatan; kode tak dikenal; risiko tinggi (produksi/keamanan) | Setiap keputusan non-trivial melewati review adversarial ber-context segar sebelum berdiri. |
| **frontend-ui-engineering** | Membangun/mengubah UI & halaman; komponen, layout, aksesibilitas, state | UI produksi: accessible (WCAG), responsive, terasa buatan profesional. |
| **api-and-interface-design** | Mendesain API/module boundary; REST/GraphQL; kontrak tipe antar-module | API dan interface stabil: kontrak tipe, batas frontend/backend yang jelas. |

## 4. Verify — memastikan apa yang dibangun benar-benar jalan

| Skill | Trigger / kapan dipakai | Inti |
|---|---|---|
| **browser-testing-with-devtools** | Apa pun yang jalan di browser; perlu inspeksi DOM/console/network/perf/visual | Tes di Chrome nyata via Chrome DevTools MCP; butuh chrome-devtools MCP server terkonfigurasi. |
| **debugging-and-error-recovery** | Test gagal, build rusak, perilaku tak sesuai, error tak terduga | Debugging root-cause sistematis, bukan menebak. |

## 5. Review — kualitas sebelum masuk branch utama

| Skill | Trigger / kapan dipakai | Inti |
|---|---|---|
| **code-review-and-quality** | Sebelum merge; review kode sendiri/agent/manusia | Review multi-axis (beberapa dimensi kualitas) sebelum perubahan masuk main. |
| **code-simplification** | Kode jalan tapi sulit dibaca/dipelihara; kompleksitas menumpuk | Refactor demi kejelasan tanpa mengubah perilaku. |
| **security-and-hardening** | Ada user input, auth, penyimpanan data, integrasi pihak ketiga; data pribadi / GDPR/CCPA | Hardening: kode tahan eksploitasi, rahasia aman, data tak tepercaya ditangani benar. |
| **performance-optimization** | Ada requirement performa; regresi; CWV lambat; query N+1; profiling | Optimasi lintas frontend/backend/query/database. |

## 6. Ship — rilis, deploy, dan rawat

| Skill | Trigger / kapan dipakai | Inti |
|---|---|---|
| **git-workflow-and-versioning** | Setiap perubahan kode; commit/branch/conflict; release & semantic versioning | Struktur praktik git; workflow paralel, tag, changelog. |
| **ci-cd-and-automation** | Setup/modifikasi pipeline build-deploy; quality gates; test runner di CI | Otomasi CI/CD; strategi deployment. |
| **deprecation-and-migration** | Menghapus sistem/API/fitur lama; migrasi user antar-implementasi | Mengelola deprecation & migrasi; memutuskan maintain vs sunset. |
| **documentation-and-adrs** | Keputusan arsitektur; API publik berubah; shipping fitur | Merekam keputusan (ADR) & konteks untuk engineer/agent masa depan. |
| **observability-and-instrumentation** | Tambah logging/metrics/tracing/alerting; fitur produksi butuh bukti jalan | Instrumentasi agar perilaku produksi terlihat & bisa didiagnosis. |
| **shipping-and-launch** | Persiapan deploy ke produksi | Checklist pra-rilis, monitoring, rollout bertahap, strategi rollback. |

## 7. Web Quality Skills (repo terpisah — paket audit & optimasi web)

| Skill | Trigger / kapan dipakai | Inti |
|---|---|---|
| **web-quality-audit** | "audit my site", "review web quality", "run lighthouse audit" | Audit komprehensif: performance + accessibility + SEO + best practices dalam satu alur. |
| **performance** | "speed up my site", "optimize performance", "reduce load time" | Optimasi kecepatan loading & pengalaman pengguna. |
| **core-web-vitals** | "improve Core Web Vitals", "fix LCP", "reduce CLS", "optimize INP" | Fokus metrik inti: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1. |
| **accessibility** | "improve accessibility", "a11y audit", "WCAG compliance", "keyboard navigation" | Audit & perbaikan aksesibilitas mengikuti WCAG 2.2. |
| **seo** | "improve SEO", "fix meta tags", "add structured data", "sitemap optimization" | Visibilitas & ranking mesin pencari: meta, structured data, sitemap. |
| **best-practices** | "apply best practices", "security audit", "modernize code", "check for vulnerabilities" | Praktik modern: keamanan, kompatibilitas, kualitas kode. |

---

## Skrip/slash commands (dari repo agent-skills)

8 perintah yang dipetakan ke alur kerja di atas: `/spec`, `/plan`, `/build`, `/test`, `/review`, `/webperf`, `/code-simplify`, `/ship`.
Repo juga menyediakan `agents/` (persona code-reviewer, test-engineer, security-auditor, web-performance-auditor),
`references/` (7 checklist termasuk security-checklist.md, performance-checklist.md, accessibility-checklist.md), dan `hooks/`.

## Catatan penting

- **Bukan Addy Osmani** (juga terinstall di `~/.agents/skills/`): `ccc`, `debugging-wizard`, `find-skills`, `postgresql-optimization`, `scrapling-official`, `systematic-debugging` (total 36 direktori).
- Skill-skill ini dipakai dalam audit proyek ini — lihat [`AUDIT.md`](./AUDIT.md), [`WEB-QUALITY-AUDIT.md`](./WEB-QUALITY-AUDIT.md), [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md) di folder yang sama.
