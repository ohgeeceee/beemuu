"use strict";

// Workspace persistence rules for ~/beeemuu-exports/workspace.json.
// Pure helpers — no DOM, dual export. Consumed by main.js as window.Workspace.

const VERSION = 1;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseWorkspace(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let obj;
  try { obj = JSON.parse(text); } catch (_) { return null; }
  if (!isPlainObject(obj)) return null;
  delete obj.version;
  return obj;
}

function serializeWorkspace(state) {
  const body = isPlainObject(state) ? state : {};
  return JSON.stringify({ version: VERSION, ...body }, null, 2);
}

// One-time migration from the pre-v0.7.0 localStorage keys
// ("beeemuu_dark", "beeemuu_settings", "beeemuu_mode").
function migrateLegacy(legacy) {
  const l = legacy || {};
  const state = {};
  if (l.dark === "1" || l.dark === "true") state.theme = "dark";
  else if (l.dark === "0" || l.dark === "false") state.theme = "light";
  if (typeof l.mode === "string" && l.mode) state.mode = l.mode;
  if (typeof l.settings === "string" && l.settings) {
    try {
      const s = JSON.parse(l.settings);
      if (isPlainObject(s)) {
        for (const k of Object.keys(s)) {
          if (!(k in state)) state[k] = s[k];
        }
      }
    } catch (_) { /* corrupt legacy value — ignore */ }
  }
  return state;
}

const api = { parseWorkspace, serializeWorkspace, migrateLegacy };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.Workspace = api;
