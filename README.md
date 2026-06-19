# Checker FE/BE Mahasiswa — Cloud Computing 2026

Script untuk mengecek deployment frontend dan backend mahasiswa (`/health`, `/schema`), dengan integrasi Google Sheets dan penjadwalan otomatis via GitHub Actions.

## Cara Pakai

### Mode lokal (array hardcoded)

```bash
npm install
node index.js
# atau
node index.js --local
```

### Mode Google Sheets

1. Salin `.env.example` ke `.env` dan isi ID spreadsheet:
   - `INPUT_SPREADSHEET_ID` — file spreadsheet form responses (baca)
   - `RESULT_SPREADSHEET_ID` — file spreadsheet hasil checker (tulis)
2. Letakkan file JSON service account sebagai `credentials.json`, atau set `GOOGLE_CREDENTIALS`
3. **Share kedua spreadsheet** ke email service account dengan akses **Editor**
4. Jalankan:

```bash
node index.js --sheets
```

> Jika input dan output masih di **satu file**, cukup isi `SPREADSHEET_ID` saja (tanpa INPUT/RESULT terpisah).

## Setup Google Cloud (sekali)

1. Buka [Google Cloud Console](https://console.cloud.google.com)
2. Buat project baru (atau pakai yang sudah ada)
3. Aktifkan **Google Sheets API**
4. Buat **Service Account** → tab Keys → Add Key → JSON → download
5. **Share spreadsheet** ke email service account (`nama@project.iam.gserviceaccount.com`) dengan akses **Editor** — lakukan untuk **kedua file** jika input dan output terpisah

## Setup GitHub Actions

Push repo ke GitHub, lalu tambahkan **Secrets** di Settings → Secrets and variables → Actions:

| Secret | Isi |
|--------|-----|
| `GOOGLE_CREDENTIALS` | Seluruh isi file JSON service account (copy-paste) |
| `INPUT_SPREADSHEET_ID` | ID spreadsheet form responses |
| `RESULT_SPREADSHEET_ID` | ID spreadsheet hasil checker |

Opsional, tambahkan **Variables** (atau set di `.env` lokal):

| Variable | Default |
|----------|---------|
| `INPUT_SHEET_NAME` | `Form Responses 1` |
| `RESULT_SHEET_NAME` | `Hasil Checker` |
| `SPREADSHEET_ID` | Fallback jika INPUT/RESULT tidak diisi |

Workflow berjalan **setiap jam** (timezone `Asia/Jakarta`) dan bisa di-trigger manual lewat **Actions → Student Checker Hourly → Run workflow**.

## Alur Data

```
Spreadsheet Form (baca)  →  Checker  →  Spreadsheet Hasil (tulis, upsert per NIM)
```

- **Input** dibaca dari spreadsheet form (`INPUT_SPREADSHEET_ID`), tab `Form Responses 1`
- **Output** ditulis ke spreadsheet terpisah (`RESULT_SPREADSHEET_ID`), tab `Hasil Checker`
- Jika satu NIM submit berkali-kali, yang dipakai adalah **submission terbaru** (berdasarkan Timestamp)
- Di spreadsheet hasil: 1 baris per NIM, di-update (bukan ditumpuk) setiap run
- Kolom `Terakhir Dicek` diisi waktu pengecekan terakhir

## Struktur Proyek

```
script/
├── index.js              # Entry point + output terminal
├── lib/
│   ├── checker.js        # Logic cek FE/BE
│   └── sheets.js         # Baca/tulis Google Sheets
├── .github/workflows/
│   └── checker-hourly.yml
├── package.json
└── .env.example
```
