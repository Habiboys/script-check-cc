const TIMEOUT_MS = 10000;
const SIMILARITY_THRESHOLD = 0.6;

async function fetchWithTimeout(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function checkFrontend(url) {
  try {
    const res = await fetchWithTimeout(url);
    return {
      accessible: res.ok || res.status === 200 || res.redirected,
      statusCode: res.status,
      redirected: res.redirected,
      finalUrl: res.url,
      error: null,
    };
  } catch (err) {
    return {
      accessible: false,
      statusCode: null,
      redirected: false,
      finalUrl: null,
      error: err.name === "AbortError" ? "Timeout" : err.message,
    };
  }
}

async function checkBackend(student) {
  const result = { health: null, schema: null, errors: [], warnings: [] };

  try {
    const res = await fetchWithTimeout(`${student.url_be}/health`);
    const data = await res.json();
    result.health = {
      status: data.status,
      database: data.database,
      studentFromResponse: data.student,
    };
    if (data.database !== "connected") result.warnings.push("Database tidak terhubung");
    if (data.student?.nim && data.student.nim !== student.nim)
      result.warnings.push(`NIM di /health (${data.student.nim}) ≠ daftar (${student.nim})`);
  } catch (err) {
    result.errors.push(`/health: ${err.name === "AbortError" ? "Timeout" : err.message}`);
  }

  try {
    const res = await fetchWithTimeout(`${student.url_be}/schema`);
    const data = await res.json();
    const resourceName = data.resource?.name || data.resource || null;
    const fields = Array.isArray(data.fields) ? data.fields : [];
    const fieldNames = fields.map((f) => (typeof f === "string" ? f : f.name)).filter(Boolean);
    result.schema = { resourceName, fieldNames, fieldCount: fieldNames.length, endpoints: data.endpoints || null };
    if (!resourceName) result.warnings.push("/schema tidak ada resource.name");
    if (fieldNames.length === 0) result.warnings.push("/schema tidak ada fields");
    if (!data.endpoints) result.warnings.push("/schema tidak ada endpoints");
    if (data.student?.nim && data.student.nim !== student.nim)
      result.warnings.push(`NIM di /schema (${data.student.nim}) ≠ daftar (${student.nim})`);
  } catch (err) {
    result.errors.push(`/schema: ${err.name === "AbortError" ? "Timeout" : err.message}`);
  }

  return result;
}

function fieldSimilarity(f1, f2) {
  if (f1.length === 0 && f2.length === 0) return 1;
  if (f1.length === 0 || f2.length === 0) return 0;
  const s1 = new Set(f1.map((f) => f.toLowerCase()));
  const s2 = new Set(f2.map((f) => f.toLowerCase()));
  const inter = [...s1].filter((f) => s2.has(f)).length;
  return inter / new Set([...s1, ...s2]).size;
}

function detectDuplicates(results) {
  const dups = [];
  const ok = results.filter((r) => r.be.schema !== null);
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      const a = ok[i];
      const b = ok[j];
      const sameRes =
        a.be.schema.resourceName &&
        b.be.schema.resourceName &&
        a.be.schema.resourceName.toLowerCase() === b.be.schema.resourceName.toLowerCase();
      const sim = fieldSimilarity(a.be.schema.fieldNames, b.be.schema.fieldNames);
      if (sameRes || sim >= SIMILARITY_THRESHOLD) {
        dups.push({
          studentA: { nim: a.nim, name: a.name },
          studentB: { nim: b.nim, name: b.name },
          sameRes,
          similarity: Math.round(sim * 100),
          resourceA: a.be.schema.resourceName,
          fieldsA: a.be.schema.fieldNames,
          resourceB: b.be.schema.resourceName,
          fieldsB: b.be.schema.fieldNames,
        });
      }
    }
  }
  return dups;
}

async function runChecks(students) {
  return Promise.all(
    students.map(async (s) => {
      const [fe, be] = await Promise.all([checkFrontend(s.url_fe), checkBackend(s)]);
      return { nim: s.nim, name: s.name, student: s, fe, be };
    })
  );
}

module.exports = {
  TIMEOUT_MS,
  SIMILARITY_THRESHOLD,
  runChecks,
  detectDuplicates,
};
