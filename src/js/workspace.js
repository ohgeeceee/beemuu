/* Pure helpers for the persisted workspace layout (v0.7.0 PR #2).
 *
 * The workspace is the app's UI-preference state — theme, mode, active
 * tab, connection panel choices, profile selectors, traffic auto-refresh,
 * and the per-profile log channel enabled map. It lives in
 * ~/beeemuu-exports/workspace.json; main.js owns the file I/O (via the
 * export_text / read_export_text Tauri commands) and holds the in-memory
 * state, while this module owns the pure (de)serialisation rules so they
 * stay Node-testable. Same dual-context pattern as live_format.js:
 * loaded as a plain <script> in index.html (exposes window.Workspace)
 * and require()d by src/js/test/workspace.test.cjs under Node.
 *
 * Design rules:
 *  - Forward- and backward-tolerant: unknown keys are dropped, missing
 *    keys stay absent (callers fall back to their own defaults), and
 *    wrong-typed values are dropped. A file written by a newer app
 *    version still loads; a file from an older one gains nothing it
 *    didn't have.
 *  - Corrupt or missing input is not an error: parseWorkspace() returns
 *    null and the caller falls back to legacy migration / defaults.
 *  - `version` is written for future migrations but not gated on read.
 */

const WORKSPACE_VERSION = 1;

function isPlainObject(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function strOrUndef(x) {
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

/* Sanitise an arbitrary parsed-JSON value into a clean, sparse workspace
 * state: only known keys with valid values survive. Returns null when
 * the input isn't a plain object at all. */
function sanitizeWorkspace(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  if (raw.theme === "dark" || raw.theme === "light") out.theme = raw.theme;
  if (strOrUndef(raw.mode)) out.mode = raw.mode;
  if (strOrUndef(raw.activeTab)) out.activeTab = raw.activeTab;
  if (isPlainObject(raw.conn)) {
    const conn = {};
    if (strOrUndef(raw.conn.kind)) conn.kind = raw.conn.kind;
    if (typeof raw.conn.port === "string") conn.port = raw.conn.port;
    if (strOrUndef(raw.conn.dcan)) conn.dcan = raw.conn.dcan;
    if (typeof raw.conn.addr === "string") conn.addr = raw.conn.addr;
    if (typeof raw.conn.optsOpen === "boolean") conn.optsOpen = raw.conn.optsOpen;
    if (Object.keys(conn).length) out.conn = conn;
  }
  if (strOrUndef(raw.liveProfile)) out.liveProfile = raw.liveProfile;
  if (strOrUndef(raw.logProfile)) out.logProfile = raw.logProfile;
  if (typeof raw.trafficAuto === "boolean") out.trafficAuto = raw.trafficAuto;
  if (isPlainObject(raw.logChannels)) {
    const lc = {};
    for (const [profile, map] of Object.entries(raw.logChannels)) {
      if (!isPlainObject(map)) continue;
      const clean = {};
      for (const [id, enabled] of Object.entries(map)) {
        if (typeof enabled === "boolean") clean[id] = enabled;
      }
      if (Object.keys(clean).length) lc[profile] = clean;
    }
    if (Object.keys(lc).length) out.logChannels = lc;
  }
  return out;
}

/* Parse workspace.json text. Returns the sanitised state, or null when
 * the text is empty / unparseable / not a JSON object / carries no
 * usable keys — i.e. "nothing worth restoring". */
function parseWorkspace(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    return null;
  }
  const clean = sanitizeWorkspace(raw);
  if (!clean || Object.keys(clean).length === 0) return null;
  return clean;
}

/* Serialise the in-memory state for writing. The version field is
 * always (re)stamped, and the same sanitiser drops any non-schema keys
 * so the file never accumulates junk. */
function serializeWorkspace(state) {
  const clean = sanitizeWorkspace(state) || {};
  return JSON.stringify({ version: WORKSPACE_VERSION, ...clean }, null, 2) + "\n";
}

/* One-time migration from the pre-v0.7.0 localStorage keys. Input is
 * the raw localStorage values (strings or null):
 *   dark:     "1" | "0" | null        (beeemuu_dark)
 *   settings: JSON string | null      (beeemuu_settings)
 *   mode:     string | null           (beeemuu_mode)
 * Returns a sparse workspace state — possibly empty, but always an
 * object, so the caller can use it directly. */
function migrateLegacy({ dark, settings, mode } = {}) {
  const out = {};
  if (dark === "1") out.theme = "dark";
  else if (dark === "0") out.theme = "light";
  if (strOrUndef(mode)) out.mode = mode;
  if (typeof settings === "string" && settings.length) {
    try {
      const s = JSON.parse(settings);
      if (isPlainObject(s)) {
        const conn = {};
        if (strOrUndef(s.connKind)) conn.kind = s.connKind;
        if (typeof s.connPort === "string") conn.port = s.connPort;
        if (strOrUndef(s.connDcan)) conn.dcan = s.connDcan;
        if (typeof s.connAddr === "string") conn.addr = s.connAddr;
        // NOTE: the legacy flag ANDed the two option panels' hidden
        // states, so it is effectively always false in the wild. We
        // still honour a stored true; we just don't inherit the bug.
        if (s.connOptsOpen === true) conn.optsOpen = true;
        if (Object.keys(conn).length) out.conn = conn;
        if (strOrUndef(s.liveProfile)) out.liveProfile = s.liveProfile;
        if (strOrUndef(s.logProfile)) out.logProfile = s.logProfile;
        if (typeof s.trafficAuto === "boolean") out.trafficAuto = s.trafficAuto;
      }
    } catch (_) { /* corrupt legacy blob — ignore */ }
  }
  return out;
}

/* Standardised dual export (same pattern as live_format.js). */
const Workspace = {
  WORKSPACE_VERSION,
  sanitizeWorkspace,
  parseWorkspace,
  serializeWorkspace,
  migrateLegacy,
};
if (typeof module !== "undefined" && module.exports) {
  module.exports = Workspace;
}
if (typeof window !== "undefined") {
  window.Workspace = Workspace;
}
