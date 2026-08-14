# Daily Login — AWS

Kredensial AWS memakai **SSO/Identity Center** (bukan access key statis). CLI-nya adalah **AWS CLI v2.36+** yang punya fitur baru `aws login` (menggantikan `aws sso login`).

## Profil

| Field | Nilai |
|---|---|
| Profile | `aws-x-cdb` |
| Account ID | `926375049642` |
| Role | `AWSReservedSSO_AdministratorAccess2_28930a6b74ecbbff` |
| Region | `ap-southeast-3` |
| User | `normansyah` |

Konfigurasi tersimpan di `~/.aws/config` (`login_session` + `region`). Token OAuth disimpan otomatis di `~/.aws/login/cache/` — tidak perlu disimpan manual.

## Login harian

```bash
# 1. Login (buka browser untuk OAuth) — sekali per masa sesi
aws login --profile aws-x-cdb

# Headless / server tanpa browser → print URL, buka di browser mana pun, masukkan code:
aws login --profile aws-x-cdb --remote

# 2. Aktifkan profile (cukup sekali per terminal)
export AWS_PROFILE=aws-x-cdb

# 3. Verifikasi
aws sts get-caller-identity
```

## Script helper

Repositori ini menyediakan `scripts/aws-login.sh`:

```bash
# Cek session → otomatis login bila expired (browser) / --remote bila headless
bash scripts/aws-login.sh

# Headless (print URL + minta authorization code)
bash scripts/aws-login.sh --remote

# Hanya cek, output "OK"/"FAIL" + exit 0/1 (cron/CI)
bash scripts/aws-login.sh --quiet
```

Variabel `AWS_PROFILE` / `AWS_REGION` / `AWS_ACCOUNT_ID` juga ada di `.env` (di-load otomatis oleh script).

## Catatan

- Session SSO biasanya berlaku ~8 jam, setelah itu `aws login` perlu dijalankan ulang.
- `aws login` TIDAK menyimpan key di `~/.aws/credentials` — semua via cache login (`~/.aws/login/cache/`).
- Jangan pernah commit token dari `~/.aws/login/cache/` atau output `aws sts get-caller-identity` dengan key raw.
