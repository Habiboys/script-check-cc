const { google } = require("googleapis");
const fs = require("fs");

const RESULT_HEADERS = [
  "Terakhir Dicek",
  "NIM",
  "Nama",
  "Kelas",
  "URL FE",
  "URL BE",
  "FE Status",
  "FE HTTP",
  "BE Status",
  "DB",
  "Resource",
  "Jumlah Field",
  "Fields",
  "Errors",
  "Warnings",
];

const INPUT_HEADERS = {
  timestamp: "Timestamp",
  name: "Nama Lengkap",
  nim: "NIM",
  kelas: "Kelas",
  url_fe: "Link Hasil Deploy Frontend",
  url_be: "Link Hasil Deploy Backend",
};

function normalizeUrl(url) {
  if (!url) return "";
  return String(url).trim().replace(/\/+$/, "");
}

function parseTimestamp(value) {
  if (!value) return 0;
  const text = String(value).trim();
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, d, m, y, h, min, s] = match;
    return new Date(
      `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${min}:${s}`
    ).getTime();
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatCheckedAt(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "credentials.json";
  if (fs.existsSync(credPath)) {
    return JSON.parse(fs.readFileSync(credPath, "utf8"));
  }
  throw new Error(
    "Kredensial Google tidak ditemukan. Set GOOGLE_CREDENTIALS atau GOOGLE_APPLICATION_CREDENTIALS."
  );
}

function getServiceAccountEmail() {
  return getCredentials().client_email || "(client_email tidak ada di kredensial)";
}

function formatSheetsError(err, context) {
  if (err?.code !== 403 && err?.status !== 403) return err;

  const email = getServiceAccountEmail();
  const lines = [
    `Akses Google Sheets ditolak (403) saat ${context}.`,
    "",
    "Periksa langkah berikut:",
    `1. Share spreadsheet ke email service account: ${email}`,
    "2. Beri akses Editor (bukan hanya Viewer)",
    "3. Pastikan INPUT_SPREADSHEET_ID / RESULT_SPREADSHEET_ID benar",
    "4. Pastikan Google Sheets API sudah diaktifkan di GCP project yang sama dengan service account",
    "5. Pastikan secret GOOGLE_CREDENTIALS di GitHub berisi JSON service account lengkap",
  ];
  return new Error(lines.join("\n"));
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function findColumnIndex(headers, name) {
  return headers.findIndex((h) => h && String(h).trim() === name);
}

function buildColumnMap(headers) {
  return {
    timestamp: findColumnIndex(headers, INPUT_HEADERS.timestamp),
    name: findColumnIndex(headers, INPUT_HEADERS.name),
    nim: findColumnIndex(headers, INPUT_HEADERS.nim),
    kelas: findColumnIndex(headers, INPUT_HEADERS.kelas),
    url_fe: findColumnIndex(headers, INPUT_HEADERS.url_fe),
    url_be: findColumnIndex(headers, INPUT_HEADERS.url_be),
  };
}

function rowValue(row, index) {
  if (index < 0) return "";
  return row[index] ?? "";
}

async function ensureResultSheet(sheets, spreadsheetId) {
  const sheetName = process.env.RESULT_SHEET_NAME || "Hasil Checker";
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === sheetName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [RESULT_HEADERS] },
    });
  }

  return sheetName;
}

function resultToRow(result, checkedAt) {
  return [
    checkedAt,
    result.nim,
    result.name,
    result.student.kelas || "",
    result.student.url_fe,
    result.student.url_be,
    result.fe.accessible ? "OK" : "GAGAL",
    result.fe.statusCode ?? "",
    result.be.health?.status ?? "",
    result.be.health?.database ?? "",
    result.be.schema?.resourceName ?? "",
    result.be.schema?.fieldCount ?? "",
    (result.be.schema?.fieldNames || []).join(", "),
    result.be.errors.join("; "),
    result.be.warnings.join("; "),
  ];
}

function getInputSpreadsheetId() {
  return process.env.INPUT_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
}

function getResultSpreadsheetId() {
  return process.env.RESULT_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
}

function buildNimRowMap(rows) {
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const nim = String(rows[i][1] || "").trim();
    if (nim) map.set(nim, i + 1);
  }
  return map;
}

async function loadStudentsFromSheet() {
  const spreadsheetId = getInputSpreadsheetId();
  if (!spreadsheetId) throw new Error("INPUT_SPREADSHEET_ID atau SPREADSHEET_ID tidak diset");

  const inputSheetName = process.env.INPUT_SHEET_NAME || "Form Responses 1";
  const sheets = getSheetsClient();

  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${inputSheetName}'!A:Z`,
    });
  } catch (err) {
    throw formatSheetsError(err, `membaca INPUT spreadsheet (tab "${inputSheetName}")`);
  }

  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const col = buildColumnMap(rows[0]);
  if (col.nim < 0) throw new Error(`Kolom "${INPUT_HEADERS.nim}" tidak ditemukan di sheet input`);

  const byNim = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const nim = String(rowValue(row, col.nim)).trim();
    if (!nim) continue;

    const ts = parseTimestamp(rowValue(row, col.timestamp));
    const student = {
      nim,
      name: String(rowValue(row, col.name)).trim(),
      kelas: String(rowValue(row, col.kelas)).trim(),
      url_fe: normalizeUrl(rowValue(row, col.url_fe)),
      url_be: normalizeUrl(rowValue(row, col.url_be)),
    };

    const prev = byNim.get(nim);
    if (!prev || ts >= prev.ts) {
      byNim.set(nim, { ...student, ts });
    }
  }

  return [...byNim.values()].map(({ ts, ...student }) => student);
}

async function upsertCheckerResults(results) {
  const spreadsheetId = getResultSpreadsheetId();
  if (!spreadsheetId) throw new Error("RESULT_SPREADSHEET_ID atau SPREADSHEET_ID tidak diset");

  const sheets = getSheetsClient();
  let sheetName;
  try {
    sheetName = await ensureResultSheet(sheets, spreadsheetId);
  } catch (err) {
    throw formatSheetsError(err, "mengakses RESULT spreadsheet");
  }

  const checkedAt = formatCheckedAt();

  let existing;
  try {
    existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:O`,
    });
  } catch (err) {
    throw formatSheetsError(err, `membaca RESULT spreadsheet (tab "${sheetName}")`);
  }

  let rows = existing.data.values || [];
  if (rows.length === 0 || rows[0][0] !== RESULT_HEADERS[0]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [RESULT_HEADERS] },
    });
    rows = [RESULT_HEADERS];
  }

  const nimMap = buildNimRowMap(rows);
  const updates = [];
  const appends = [];

  for (const result of results) {
    const rowData = resultToRow(result, checkedAt);
    const rowIndex = nimMap.get(result.nim);
    if (rowIndex) {
      updates.push({
        range: `'${sheetName}'!A${rowIndex}:O${rowIndex}`,
        values: [rowData],
      });
    } else {
      appends.push(rowData);
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates,
      },
    });
  }

  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A:O`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appends },
    });
  }

  return { updated: updates.length, inserted: appends.length, checkedAt };
}

module.exports = {
  loadStudentsFromSheet,
  upsertCheckerResults,
  getServiceAccountEmail,
};
