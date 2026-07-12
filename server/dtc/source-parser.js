"use strict";

const { normalizeRecord } = require("./normalizer");

const ARRAY_FIELDS = new Set(["symptoms", "causes", "fixes", "compatibility"]);

function parseJsonSource(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.records)) return parsed.records;
  throw new Error("JSON DTC source must be an array or an object with records[]");
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseDelimitedText(text) {
  const lines = String(text || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const record = {};
    headers.forEach((header, index) => {
      const value = cells[index] || "";
      record[header] = ARRAY_FIELDS.has(header)
        ? value.split("|").map((item) => item.trim()).filter(Boolean)
        : value;
    });
    return record;
  });
}

function mergeUnique(a = [], b = []) {
  const out = [];
  const seen = new Set();
  for (const raw of [...a, ...b]) {
    const item = String(raw || "").trim();
    if (!item) continue;
    const key = item.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function reconcileRecords(rawRecords) {
  const byCode = new Map();

  for (const raw of rawRecords) {
    const record = normalizeRecord(raw);
    const existing = byCode.get(record.code);

    if (!existing) {
      byCode.set(record.code, record);
      continue;
    }

    byCode.set(record.code, {
      ...existing,
      ...record,
      symptoms: mergeUnique(existing.symptoms, record.symptoms),
      causes: mergeUnique(existing.causes, record.causes),
      fixes: mergeUnique(existing.fixes, record.fixes),
      compatibility: mergeUnique(existing.compatibility, record.compatibility).map((tag) => tag.toUpperCase())
    });
  }

  return [...byCode.values()];
}

module.exports = {
  parseJsonSource,
  parseDelimitedText,
  reconcileRecords
};
