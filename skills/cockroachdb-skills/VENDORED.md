# Vendored: CockroachDB Agent Skills

Konten di direktori ini adalah **vendor** dari repo open-source
[CockroachDB Skills](https://github.com/cockroachlabs/cockroachdb-skills)
(license Apache 2.0, lihat `LICENSE`), sesuai mekanisme instalasi yang
direkomendasikan CockroachDB (`npx skills add cockroachlabs/cockroachdb-skills`
= clone + symlink; di sini di-vendor langsung agar tercatat di git).

**Sumber:** `https://github.com/cockroachlabs/cockroachdb-skills`
**Commit:** `e14e86d23ce8` (2026-08-16)
**Lisensi:** Apache 2.0 — atribusi hak cipta dipertahankan di `LICENSE`.

## Tujuan penggunaan

Skills ini adalah **tooling agent** (panduan operasional + referensi) untuk sesi
pengembangan/operasional cluster. Skills TIDAK diintegrasikan ke runtime Lambda
atau workflow aplikasi — Lambda memakai `pg.Pool` langsung
(`lambda/lib/crdb.ts`).

## Daftar skill (10 domain)

- `skills/cockroachdb-onboarding-and-migrations/` — molt-fetch, molt-replicator,
  molt-verify, setting-up-local-cluster
- `skills/cockroachdb-query-and-schema-design/` — cockroachdb-sql
- `skills/cockroachdb-application-development/` — benchmarking-transaction-patterns,
  designing-application-transactions, designing-multi-region-applications
- `skills/cockroachdb-performance-and-scaling/` — (lihat repo, .gitkeep)
- `skills/cockroachdb-operations-and-lifecycle/` — managing-cluster-capacity,
  managing-cluster-settings, performing-cluster-maintenance,
  provisioning-cluster-for-production, reviewing-cluster-health,
  upgrading-cluster-version, managing-certificates-and-encryption
- `skills/cockroachdb-resilience-and-disaster-recovery/` — (lihat repo, .gitkeep)
- `skills/cockroachdb-observability-and-diagnostics/` — analyzing-range-distribution,
  analyzing-schema-change-storage-risk, auditing-table-statistics,
  monitoring-background-jobs, profiling-statement-fingerprints,
  profiling-transaction-fingerprints, triaging-live-sql-activity
- `skills/cockroachdb-security-and-governance/` — auditing-cis-benchmark,
  auditing-cloud-cluster-security, configuring-audit-logging,
  configuring-ip-allowlists, configuring-log-export,
  configuring-private-connectivity, configuring-sso-and-scim,
  enabling-cmek-encryption, enforcing-password-policies,
  hardening-user-privileges, managing-tls-certificates,
  preparing-compliance-documentation
- `skills/cockroachdb-integrations-and-ecosystem/` — (lihat repo, .gitkeep)
- `skills/cockroachdb-cost-and-usage-management/` — (lihat repo, .gitkeep)

## Update vendor

```bash
cd skills/cockroachdb-skills
git remote remove origin 2>/dev/null  # sudah dihapus saat vendor
# re-vendor:
rm -rf skills/cockroachdb-skills
git clone --depth 1 https://github.com/cockroachlabs/cockroachdb-skills.git skills/cockroachdb-skills
rm -rf skills/cockroachdb-skills/.git skills/cockroachdb-skills/.github
```

## Validasi spec

```bash
python3 skills/cockroachdb-skills/scripts/validate-spec.py skills/cockroachdb-skills/skills/
```
