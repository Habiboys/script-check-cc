/**
 * =====================================================
 * CHECKER FRONTEND + BACKEND MAHASISWA
 * Cloud Computing 2026 - Universitas Andalas
 * =====================================================
 * Cara pakai:
 *   Lokal (array):     node index.js
 *   Lokal (sheets):    node index.js --sheets
 *   GitHub Actions:    otomatis setiap jam (lihat README.md)
 * =====================================================
 */
const { runChecks, detectDuplicates, TIMEOUT_MS, SIMILARITY_THRESHOLD } = require("./lib/checker");
const { loadStudentsFromSheet, upsertCheckerResults, getServiceAccountEmail } = require("./lib/sheets");

const STUDENTS = [
  { nim: "2411522035", name: "Muhammad Zada Aufa Ningrat", url_fe: "https://komputasi-awan-2026-4.as.r.appspot.com", url_be: "http://34.101.43.24:3001" },
  { nim: "2311522034", name: "Amanda Fitri Abdillah", url_fe: "https://fe-2311522034-dot-komputasi-awan-2026-2.et.r.appspot.com", url_be: "https://be-2311522034-820070603847.asia-southeast2.run.app" },
  { nim: "2311521004", name: "Vannesa Tania", url_fe: "http://34.101.190.54:3000", url_be: "http://34.128.64.40:3000" },
  { nim: "2311521010", name: "Maghfira Islami", url_fe: "http://34.50.97.113:3000", url_be: "https://be-2311521010-321920053903.asia-southeast2.run.app" },
  { nim: "2411523015", name: "Daffarael Anaqi Ali", url_fe: "https://fe-2411523015-dot-komputasi-awan-2026-6.an.r.appspot.com", url_be: "https://be-2411523015-64289881252.asia-southeast2.run.app" },
  { nim: "2311523011", name: "Muhammad Afiq Jakhel", url_fe: "https://fe-2311523011-538629174383.asia-southeast2.run.app", url_be: "http://34.87.107.42:3000" },
  { nim: "2411523026", name: "Larisa Alifia Handini", url_fe: "https://fe-2411523026-dot-komputasi-awan-2026-6.an.r.appspot.com", url_be: "https://be-2411523026-64289881252.asia-southeast2.run.app" },
  { nim: "2411523008", name: "Mutiara Ayudya Ramadhani", url_fe: "https://fe-2411523008-329364261770.asia-southeast1.run.app", url_be: "https://be-2411523008-dot-komputasi-awan-2026-5.et.r.appspot.com" },
  { nim: "2411523024", name: "Loudysa Azisvi Angelia", url_fe: "https://fe-2411523024-64289881252.asia-southeast2.run.app", url_be: "https://be-2411523024-dot-komputasi-awan-2026-6.an.r.appspot.com" },
  { nim: "2411522025", name: "Naufal Baihaqi Zachwan", url_fe: "https://fe-2411522025-538629174383.asia-southeast2.run.app", url_be: "http://34.21.246.178:8080" },
  { nim: "2311523026", name: "Dimas Radithya Nurizkitha", url_fe: "https://fe-2311523026-713198913151.asia-southeast2.run.app", url_be: "https://34.101.233.16.nip.io" },
  { nim: "2311522008", name: "Ahmad Rasha Radya Aufa Lubis", url_fe: "https://fe-2311522008-321920053903.europe-west1.run.app", url_be: "http://34.31.159.51:3000" },
  { nim: "2411522037", name: "Hasyfi Zharfan Caniago", url_fe: "https://fe-2411522037-538629174383.asia-southeast2.run.app", url_be: "http://35.197.155.227:3001" },
];

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bgRed: "\x1b[41m",
};

const log = {
  ok: (msg) => console.log(`${C.green}[OK]${C.reset} ${msg}`),
  warn: (msg) => console.log(`${C.yellow}[WARN]${C.reset} ${msg}`),
  err: (msg) => console.log(`${C.red}[ERR]${C.reset} ${msg}`),
  header: (msg) =>
    console.log(
      `\n${C.bold}${C.cyan}${"=".repeat(60)}${C.reset}\n${C.bold}${C.cyan} ${msg}${C.reset}\n${C.bold}${C.cyan}${"=".repeat(60)}${C.reset}`
    ),
  section: (msg) => console.log(`\n${C.bold}${C.yellow}--- ${msg} ---${C.reset}`),
};

function useSheetsMode() {
  const args = process.argv.slice(2);
  if (args.includes("--local")) return false;
  if (args.includes("--sheets")) return true;
  return Boolean(
    process.env.INPUT_SPREADSHEET_ID ||
      process.env.RESULT_SPREADSHEET_ID ||
      process.env.SPREADSHEET_ID
  );
}

async function loadStudents() {
  if (!useSheetsMode()) {
    log.ok("Mode lokal: memakai array STUDENTS di index.js");
    return STUDENTS;
  }

  log.ok("Mode sheets: membaca dari Google Spreadsheet...");
  log.ok(`Service account: ${getServiceAccountEmail()}`);
  const students = await loadStudentsFromSheet();
  log.ok(`Ditemukan ${students.length} mahasiswa (dedupe per NIM, submission terbaru)`);
  return students;
}

function printStudent(r) {
  const beOk = r.be.errors.length === 0;
  const feOk = r.fe.accessible;
  const hasWarn = r.be.warnings.length > 0;
  const icon = !beOk || !feOk ? `${C.red}✗${C.reset}` : hasWarn ? `${C.yellow}⚠${C.reset}` : `${C.green}✓${C.reset}`;

  console.log(`\n${icon} ${C.bold}[${r.nim}]${C.reset} ${r.name}`);

  const feColor = feOk ? C.green : C.red;
  const feStatus = feOk
    ? `OK (HTTP ${r.fe.statusCode}${r.fe.redirected ? " → redirect" : ""})`
    : `GAGAL${r.fe.error ? " - " + r.fe.error : r.fe.statusCode ? " HTTP " + r.fe.statusCode : ""}`;
  console.log(`   FE  ${feColor}${feStatus}${C.reset}`);
  console.log(`   ${C.gray}${r.student.url_fe}${C.reset}`);

  if (r.be.health) {
    const dbColor = r.be.health.database === "connected" ? C.green : C.red;
    console.log(`   BE  /health → ${r.be.health.status} | db: ${dbColor}${r.be.health.database}${C.reset}`);
  }
  if (r.be.schema) {
    console.log(
      `       /schema → resource: ${C.cyan}${r.be.schema.resourceName}${C.reset} (${r.be.schema.fieldCount} fields)`
    );
    console.log(`       ${C.gray}fields: [${r.be.schema.fieldNames.join(", ")}]${C.reset}`);
  }
  console.log(`   ${C.gray}${r.student.url_be}${C.reset}`);

  r.be.errors.forEach((e) => console.log(`   ${C.red}→ BE ERROR: ${e}${C.reset}`));
  r.be.warnings.forEach((w) => console.log(`   ${C.yellow}→ WARN: ${w}${C.reset}`));
}

function printSummary(results) {
  log.section("Statistik");
  const feOk = results.filter((r) => r.fe.accessible).length;
  const beOk = results.filter((r) => r.be.errors.length === 0).length;
  const schemaOk = results.filter((r) => r.be.schema !== null).length;
  const dbOk = results.filter((r) => r.be.health?.database === "connected").length;
  const bothOk = results.filter((r) => r.fe.accessible && r.be.errors.length === 0).length;

  console.log(`  Total mahasiswa   : ${results.length}`);
  console.log(`  FE dapat diakses  : ${C.green}${feOk}${C.reset} / ${results.length}`);
  console.log(`  BE dapat diakses  : ${C.green}${beOk}${C.reset} / ${results.length}`);
  console.log(`  DB connected      : ${C.green}${dbOk}${C.reset} / ${results.length}`);
  console.log(`  /schema berhasil  : ${C.green}${schemaOk}${C.reset} / ${results.length}`);
  console.log(`  FE + BE keduanya  : ${bothOk === results.length ? C.green : C.yellow}${bothOk}${C.reset} / ${results.length}`);

  const feFail = results.filter((r) => !r.fe.accessible);
  if (feFail.length > 0) {
    log.section("Frontend Tidak Dapat Diakses");
    feFail.forEach((r) =>
      console.log(`  ${C.red}✗${C.reset} [${r.nim}] ${r.name} → ${r.fe.error || "HTTP " + r.fe.statusCode || "tidak diketahui"}`)
    );
  }

  const beFail = results.filter((r) => r.be.errors.length > 0);
  if (beFail.length > 0) {
    log.section("Backend Tidak Dapat Diakses / Error");
    beFail.forEach((r) => console.log(`  ${C.red}✗${C.reset} [${r.nim}] ${r.name} → ${r.be.errors.join(" | ")}`));
  }

  log.section("Deteksi Duplikasi Tema / Struktur Data");
  const dups = detectDuplicates(results);
  if (dups.length === 0) {
    log.ok("Tidak ada duplikasi tema atau struktur data yang terdeteksi.");
  } else {
    console.log(`\n${C.bgRed}${C.bold} !! TERDETEKSI ${dups.length} PASANG DUPLIKASI !! ${C.reset}\n`);
    dups.forEach((d, i) => {
      const color = d.sameRes ? C.red : C.yellow;
      const level = d.sameRes ? "KRITIS - Resource sama" : `Mirip ${d.similarity}%`;
      console.log(`${color}${C.bold}[DUPLIKASI ${i + 1}] ${level}${C.reset}`);
      console.log(`  A: ${d.studentA.nim} ${d.studentA.name}`);
      console.log(`     resource="${d.resourceA}" | fields=[${d.fieldsA.join(", ")}]`);
      console.log(`  B: ${d.studentB.nim} ${d.studentB.name}`);
      console.log(`     resource="${d.resourceB}" | fields=[${d.fieldsB.join(", ")}]`);
      console.log(`  Kesamaan field: ${d.similarity}%\n`);
    });
  }
}

async function main() {
  log.header("CHECKER FE + BE MAHASISWA - Cloud Computing 2026");

  const students = await loadStudents();
  if (students.length === 0) {
    log.warn("Tidak ada mahasiswa untuk dicek.");
    return;
  }

  console.log(
    `\n${C.gray}Total: ${students.length} mahasiswa | Timeout: ${TIMEOUT_MS / 1000}s | Similarity threshold: ${SIMILARITY_THRESHOLD * 100}%${C.reset}`
  );

  log.section("Mengecek semua FE & BE secara paralel...");
  const results = await runChecks(students);

  log.section("Hasil Per Mahasiswa");
  results.forEach(printStudent);
  printSummary(results);

  if (useSheetsMode()) {
    log.section("Menulis hasil ke Google Spreadsheet...");
    const { updated, inserted, checkedAt } = await upsertCheckerResults(results);
    log.ok(`Selesai: ${updated} baris diupdate, ${inserted} baris baru (Terakhir Dicek: ${checkedAt})`);
  }

  log.header("Selesai");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
