/* Snapshot comparison (v0.17.2) — pure helpers for side-by-side diff of two JSON snapshots.
   No DOM here; caller (main.js) renders.
   Dual export for <script> and tests.
*/

function normalizeSnapshot(raw) {
  if (!raw) return { plan: null, walkAnswers: [], freezeFrame: [], logSnippet: [], meta: {} };
  return {
    plan: raw.plan || null,
    walkAnswers: Array.isArray(raw.walkAnswers) ? raw.walkAnswers : [],
    freezeFrame: Array.isArray(raw.freezeFrame) ? raw.freezeFrame : [],
    logSnippet: Array.isArray(raw.logSnippet) ? raw.logSnippet : [],
    meta: raw.meta || {},
  };
}

function keyByLabel(arr) {
  const m = new Map();
  for (const item of arr) {
    const k = (item && (item.label || item.id || item.key)) || String(item);
    m.set(k, item);
  }
  return m;
}

function diffFreezeFrames(a, b) {
  const ma = keyByLabel(a);
  const mb = keyByLabel(b);
  const allKeys = new Set([...ma.keys(), ...mb.keys()]);
  const rows = [];
  for (const k of [...allKeys].sort()) {
    const va = ma.get(k);
    const vb = mb.get(k);
    const vaVal = va && (va.value != null ? va.value : va);
    const vbVal = vb && (vb.value != null ? vb.value : vb);
    const same = String(vaVal) === String(vbVal);
    rows.push({ label: k, left: vaVal, right: vbVal, same });
  }
  return rows;
}

function diffWalk(aAnswers, bAnswers) {
  const len = Math.max(aAnswers.length, bAnswers.length);
  const steps = [];
  for (let i = 0; i < len; i++) {
    const la = aAnswers[i] || null;
    const lb = bAnswers[i] || null;
    steps.push({ idx: i + 1, left: la, right: lb, same: la === lb });
  }
  return steps;
}

function compareSnapshots(leftRaw, rightRaw) {
  const L = normalizeSnapshot(leftRaw);
  const R = normalizeSnapshot(rightRaw);
  return {
    meta: {
      left: L.meta,
      right: R.meta,
    },
    freezeFrame: diffFreezeFrames(L.freezeFrame, R.freezeFrame),
    walk: diffWalk(L.walkAnswers, R.walkAnswers),
    log: { left: L.logSnippet, right: R.logSnippet },
  };
}

/**
 * Produce a clean HTML table/string for the compare result (for direct insertion).
 * Pure, no side effects.
 */
function renderCompareHtml(cmp) {
  if (!cmp) return '<div class="muted">No comparison data.</div>';

  let out = '<div class="cmp-wrap" style="font-size:13px; line-height:1.45; border:1px solid var(--border); padding:10px; border-radius:6px; background:var(--panel)">';

  const lm = cmp.meta && cmp.meta.left || {};
  const rm = cmp.meta && cmp.meta.right || {};
  out += `<div style="margin-bottom:6px"><strong>Left:</strong> ${escapeForHtml(lm.vin || lm.profile || 'snapshot')} &nbsp; <strong>Right:</strong> ${escapeForHtml(rm.vin || rm.profile || 'snapshot')}</div>`;

  const ffDiffs = (cmp.freezeFrame || []).filter(r => !r.same);
  out += `<div style="margin:6px 0 4px"><strong>Freeze-frame</strong> (${ffDiffs.length} differences)</div>`;
  if (ffDiffs.length === 0) {
    out += '<div class="muted">All values match.</div>';
  } else {
    out += '<table class="cmp-table" role="table" aria-label="Freeze frame differences" style="width:100%; font-size:12px; border-collapse:collapse"><tr><th style="text-align:left">Field</th><th style="text-align:left">Left</th><th style="text-align:left">Right</th></tr>';
    for (const row of ffDiffs.slice(0, 8)) {
      out += `<tr><td>${escapeForHtml(row.label)}</td><td style="color:#b45309">${escapeForHtml(row.left ?? '—')}</td><td style="color:#1d4ed8">${escapeForHtml(row.right ?? '—')}</td></tr>`;
    }
    if (ffDiffs.length > 8) out += `<tr><td colspan="3" class="muted">+${ffDiffs.length-8} more…</td></tr>`;
    out += '</table>';
  }

  const wDiffs = (cmp.walk || []).filter(s => !s.same);
  out += `<div style="margin:8px 0 4px"><strong>Walk path</strong> (${wDiffs.length} diffs)</div>`;
  if (wDiffs.length === 0) {
    out += '<div class="muted">Paths match.</div>';
  } else {
    out += wDiffs.slice(0,5).map(s => `Step ${s.idx}: <b>${escapeForHtml(s.left)}</b> / <b>${escapeForHtml(s.right)}</b>`).join(' · ') + (wDiffs.length > 5 ? ' …' : '');
  }

  // log snippet side-by-side table
  const logL = cmp.log && cmp.log.left || [];
  const logR = cmp.log && cmp.log.right || [];
  const maxLog = Math.max(logL.length, logR.length);
  out += `<div style="margin:8px 0 4px"><strong>Log snippet</strong> (${maxLog} entries)</div>`;
  if (maxLog > 0) {
    out += '<table class="cmp-table" role="table" aria-label="Log snippet comparison" style="width:100%; font-size:11px; border-collapse:collapse"><tr><th style="text-align:left">L</th><th style="text-align:left">R</th></tr>';
    for (let i=0; i<Math.min(maxLog, 6); i++) {
      const l = escapeForHtml(logL[i] || '—');
      const r = escapeForHtml(logR[i] || '—');
      const same = logL[i] === logR[i];
      out += `<tr><td style="${same?'':'color:#b45309'}">${l}</td><td style="${same?'':'color:#1d4ed8'}">${r}</td></tr>`;
    }
    if (maxLog > 6) out += `<tr><td colspan="2" class="muted">+${maxLog-6} more…</td></tr>`;
    out += '</table>';
  } else {
    out += '<div class="muted">No log snippets.</div>';
  }

  out += '</div>';
  return out;
}

function escapeForHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { compareSnapshots, normalizeSnapshot, diffFreezeFrames, diffWalk, renderCompareHtml };
}
if (typeof window !== "undefined") {
  window.beeemuuSnapshotCompare = { compareSnapshots, renderCompareHtml };
}
