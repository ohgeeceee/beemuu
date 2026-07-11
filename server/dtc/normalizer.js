"use strict";

const DTC_TYPES = Object.freeze({
  OBD2: "obd2",
  BMW_HEX: "bmw_hex"
});

const OBD2_CODE = /^[PCBU][0-9A-F]{4}$/;
const BMW_HEX_CODE = /^[0-9A-F]{4}$/;

function normalizeCode(value) {
  let code = String(value || "").trim().toUpperCase();
  code = code.replace(/^0X/, "").replace(/[^A-Z0-9]/g, "");

  if (!OBD2_CODE.test(code) && !BMW_HEX_CODE.test(code)) {
    throw new Error(`Invalid DTC code: ${value}`);
  }

  return code;
}

function inferDtcType(code) {
  const normalized = normalizeCode(code);
  if (OBD2_CODE.test(normalized)) return DTC_TYPES.OBD2;
  if (BMW_HEX_CODE.test(normalized)) return DTC_TYPES.BMW_HEX;
  throw new Error(`Unsupported DTC code: ${code}`);
}

function normalizeType(rawType, code) {
  if (!rawType) return inferDtcType(code);

  const value = String(rawType)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (["obd2", "obd_ii", "obdii", "standard", "obd2_standard"].includes(value)) {
    return DTC_TYPES.OBD2;
  }

  if (
    [
      "bmw_hex",
      "bmw",
      "hex",
      "bmw_factory_hex",
      "bmw_proprietary_hex",
      "bmw_proprietary"
    ].includes(value)
  ) {
    return DTC_TYPES.BMW_HEX;
  }

  throw new Error(`Unsupported DTC type "${rawType}" for code ${code}`);
}

function normalizeArray(value, { upper = false } = {}) {
  const arr = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[;\n|]/g);

  const seen = new Set();
  const cleaned = [];

  for (const raw of arr) {
    const item = String(raw || "").trim();
    if (!item) continue;
    const normalized = upper ? item.toUpperCase() : item;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push(normalized);
  }

  return cleaned;
}

function normalizeRecord(raw) {
  const code = normalizeCode(raw && raw.code);
  const type = normalizeType(raw && raw.type, code);
  const ecuModule = String((raw && raw.ecu_module) || "").trim().toUpperCase();
  const shortDesc = String((raw && raw.short_desc) || "").trim();

  if (!ecuModule) throw new Error(`Missing ecu_module for ${code}`);
  if (!shortDesc) throw new Error(`Missing short_desc for ${code}`);

  return {
    code,
    type,
    ecu_module: ecuModule,
    short_desc: shortDesc,
    symptoms: normalizeArray(raw.symptoms),
    causes: normalizeArray(raw.causes),
    fixes: normalizeArray(raw.fixes),
    compatibility: normalizeArray(raw.compatibility, { upper: true })
  };
}

module.exports = {
  DTC_TYPES,
  OBD2_CODE,
  BMW_HEX_CODE,
  normalizeCode,
  inferDtcType,
  normalizeType,
  normalizeArray,
  normalizeRecord
};
