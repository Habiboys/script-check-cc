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

const RESULT_COL_COUNT = RESULT_HEADERS.length;

const COL = {
  KELAS: 3,
  FE_STATUS: 6,
  BE_STATUS: 8,
  DB: 9,
  FIELDS: 12,
  ERRORS: 13,
  WARNINGS: 14,
};

const STYLE = {
  headerBg: { red: 0.12, green: 0.31, blue: 0.47 },
  headerText: { red: 1, green: 1, blue: 1 },
  zebraBg: { red: 0.95, green: 0.97, blue: 0.99 },
  okBg: { red: 0.85, green: 0.94, blue: 0.85 },
  okText: { red: 0.13, green: 0.45, blue: 0.2 },
  failBg: { red: 0.97, green: 0.86, blue: 0.86 },
  failText: { red: 0.6, green: 0.1, blue: 0.1 },
  warnBg: { red: 1, green: 0.95, blue: 0.8 },
  warnText: { red: 0.55, green: 0.35, blue: 0.05 },
};

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

async function getResultSheetInfo(sheets, spreadsheetId) {
  const sheetName = process.env.RESULT_SHEET_NAME || "Hasil Checker";
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties,conditionalFormats)",
  });
  let sheet = meta.data.sheets.find((s) => s.properties.title === sheetName);

  if (!sheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
    const refreshed = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties,conditionalFormats)",
    });
    sheet = refreshed.data.sheets.find((s) => s.properties.title === sheetName);
  }

  return {
    sheetName,
    sheetId: sheet.properties.sheetId,
    conditionalFormatCount: sheet.conditionalFormats?.length || 0,
  };
}

async function ensureResultSheet(sheets, spreadsheetId) {
  const { sheetName } = await getResultSheetInfo(sheets, spreadsheetId);
  return sheetName;
}

function dash(value) {
  if (value === "" || value === null || value === undefined) return "-";
  return value;
}

function linkFormula(url, label) {
  if (!url) return "-";
  const safe = String(url).replace(/"/g, '""');
  return `=HYPERLINK("${safe}","${label}")`;
}

function feStatusLabel(result) {
  return result.fe.accessible ? "OK" : "GAGAL";
}

function beStatusLabel(result) {
  if (result.be.errors.length > 0) return "GAGAL";
  if (result.be.health) return "OK";
  return "-";
}

function dbStatusLabel(result) {
  const db = result.be.health?.database;
  if (!db) return "-";
  return db === "connected" ? "connected" : db;
}

function resultToRow(result, checkedAt) {
  return [
    checkedAt,
    result.nim,
    result.name,
    dash(result.student.kelas),
    linkFormula(result.student.url_fe, "Buka FE"),
    linkFormula(result.student.url_be, "Buka BE"),
    feStatusLabel(result),
    dash(result.fe.statusCode),
    beStatusLabel(result),
    dbStatusLabel(result),
    dash(result.be.schema?.resourceName),
    dash(result.be.schema?.fieldCount),
    dash((result.be.schema?.fieldNames || []).join(", ")),
    dash(result.be.errors.join("; ")),
    dash(result.be.warnings.join("; ")),
  ];
}

function colRange(sheetId, col, startRow, endRow) {
  return {
    sheetId,
    startRowIndex: startRow,
    endRowIndex: endRow,
    startColumnIndex: col,
    endColumnIndex: col + 1,
  };
}

function statusConditionalRule(sheetId, col, okText, startRow, endRow) {
  return [
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [colRange(sheetId, col, startRow, endRow)],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: okText }] },
            format: {
              backgroundColor: STYLE.okBg,
              textFormat: { foregroundColor: STYLE.okText, bold: true },
            },
          },
        },
        index: 0,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [colRange(sheetId, col, startRow, endRow)],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "GAGAL" }] },
            format: {
              backgroundColor: STYLE.failBg,
              textFormat: { foregroundColor: STYLE.failText, bold: true },
            },
          },
        },
        index: 0,
      },
    },
  ];
}

async function applyResultSheetFormatting(sheets, spreadsheetId, sheetId, conditionalFormatCount, dataRowCount) {
  const totalRows = Math.max(dataRowCount + 1, 2);
  const requests = [];

  for (let i = conditionalFormatCount - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  requests.push(
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: RESULT_COL_COUNT },
        cell: {
          userEnteredFormat: {
            backgroundColor: STYLE.headerBg,
            textFormat: { bold: true, foregroundColor: STYLE.headerText, fontSize: 10 },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 },
        fields: "pixelSize",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: RESULT_COL_COUNT },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
            textFormat: { fontSize: 10 },
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)",
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: RESULT_COL_COUNT }],
          booleanRule: {
            condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: "=ISEVEN(ROW())" }] },
            format: { backgroundColor: STYLE.zebraBg },
          },
        },
        index: 0,
      },
    },
    ...statusConditionalRule(sheetId, COL.FE_STATUS, "OK", 1, totalRows),
    ...statusConditionalRule(sheetId, COL.BE_STATUS, "OK", 1, totalRows),
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [colRange(sheetId, COL.DB, 1, totalRows)],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "connected" }] },
            format: {
              backgroundColor: STYLE.okBg,
              textFormat: { foregroundColor: STYLE.okText, bold: true },
            },
          },
        },
        index: 0,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [colRange(sheetId, COL.ERRORS, 1, totalRows)],
          booleanRule: {
            condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: '=$N2<>"-"' }] },
            format: {
              backgroundColor: STYLE.failBg,
              textFormat: { foregroundColor: STYLE.failText },
            },
          },
        },
        index: 0,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [colRange(sheetId, COL.WARNINGS, 1, totalRows)],
          booleanRule: {
            condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: '=$O2<>"-"' }] },
            format: {
              backgroundColor: STYLE.warnBg,
              textFormat: { foregroundColor: STYLE.warnText },
            },
          },
        },
        index: 0,
      },
    },
    {
      setBasicFilter: {
        filter: {
          range: { sheetId, startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: RESULT_COL_COUNT },
        },
      },
    }
  );

  const columnWidths = [145, 95, 200, 55, 85, 85, 80, 70, 80, 90, 120, 85, 220, 180, 180];
  for (let i = 0; i < columnWidths.length; i++) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: columnWidths[i] },
        fields: "pixelSize",
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

async function sortResultSheet(sheets, spreadsheetId, sheetId, dataRowCount) {
  if (dataRowCount < 2) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          sortRange: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: dataRowCount + 1,
              startColumnIndex: 0,
              endColumnIndex: RESULT_COL_COUNT,
            },
            sortSpecs: [
              { dimensionIndex: COL.KELAS, sortOrder: "ASCENDING" },
              { dimensionIndex: 1, sortOrder: "ASCENDING" },
            ],
          },
        },
      ],
    },
  });
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
  let sheetId;
  let conditionalFormatCount = 0;

  try {
    const info = await getResultSheetInfo(sheets, spreadsheetId);
    sheetName = info.sheetName;
    sheetId = info.sheetId;
    conditionalFormatCount = info.conditionalFormatCount;
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
        valueInputOption: "USER_ENTERED",
        data: updates,
      },
    });
  }

  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A:O`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appends },
    });
  }

  const refreshed = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:O`,
  });
  const dataRowCount = Math.max((refreshed.data.values || []).length - 1, 0);

  await sortResultSheet(sheets, spreadsheetId, sheetId, dataRowCount);

  const infoAfterSort = await getResultSheetInfo(sheets, spreadsheetId);
  await applyResultSheetFormatting(
    sheets,
    spreadsheetId,
    sheetId,
    infoAfterSort.conditionalFormatCount,
    dataRowCount
  );

  return { updated: updates.length, inserted: appends.length, checkedAt };
}

module.exports = {
  loadStudentsFromSheet,
  upsertCheckerResults,
  getServiceAccountEmail,
};
