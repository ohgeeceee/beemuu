"use strict";

// Safe math channels — v0.15.4
// Allows expressions like "map - baro", "rail / load", "(map - baro) * 10"
// Only: param ids [a-z0-9_], numbers, + - * / ( ) and whitespace.
// No function calls, no property access, no JS eval.

const ALLOWED_OPS = new Set(["+", "-", "*", "/", "(", ")"]);
const TOKEN_RE = /([a-z_][a-z0-9_]*|\d+(?:\.\d+)?|[+\-*/()])\s*/gi;

function tokenize(expr) {
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  const stripped = expr.trim();
  // check for illegal chars by rebuilding
  let rebuilt = "";
  while ((m = TOKEN_RE.exec(expr)) !== null) {
    tokens.push(m[1]);
    rebuilt += m[0];
  }
  if (rebuilt.trim() !== stripped) {
    // leftover illegal chars
    const illegal = stripped.slice(rebuilt.trim().length);
    throw new Error("Illegal token: " + JSON.stringify(illegal));
  }
  if (tokens.length === 0) throw new Error("Empty expression");
  return tokens;
}

function validate(tokens, allowedIds) {
  const allowed = new Set(allowedIds.map((s) => s.toLowerCase()));
  for (const t of tokens) {
    if (ALLOWED_OPS.has(t)) continue;
    if (/^\d+(\.\d+)?$/.test(t)) continue;
    if (/^[a-z_][a-z0-9_]*$/.test(t)) {
      if (!allowed.has(t.toLowerCase())) throw new Error("Unknown channel: " + t);
      continue;
    }
    throw new Error("Invalid token: " + t);
  }
  // parens balanced
  let depth=0;
  for(const t of tokens){ if(t==="(") depth++; if(t===")") depth--; if(depth<0) throw new Error("Unbalanced )"); }
  if(depth!==0) throw new Error("Unbalanced parens");
}

function evaluate(expr, valuesMap) {
  // valuesMap: Map<id, number> case-insensitive
  const lowerMap = new Map();
  for (const [k,v] of valuesMap.entries()) lowerMap.set(k.toLowerCase(), v);
  const tokens = tokenize(expr);
  // replace ids with numbers
  const jsExpr = tokens.map((t)=>{
    if (/^[a-z_][a-z0-9_]*$/.test(t)) {
      const v = lowerMap.get(t.toLowerCase());
      if (v==null || typeof v!=="number" || !isFinite(v)) throw new Error("Missing value for "+t);
      return String(v);
    }
    return t;
  }).join(" ");
  // safe eval: only numbers and ops remain, use Function with no globals
  // eslint-disable-next-line no-new-func
  const fn = new Function('"use strict"; return (' + jsExpr + ');');
  const out = fn();
  if (typeof out !== "number" || !isFinite(out)) throw new Error("Non-finite result");
  return out;
}

function createChannel(label, expr, allowedIds) {
  const tokens = tokenize(expr);
  validate(tokens, allowedIds);
  // trial eval with dummy values
  const dummy = new Map(allowedIds.map((id)=>[id, 1]));
  evaluate(expr, dummy);
  return { id: "math_" + label.toLowerCase().replace(/[^a-z0-9]+/g,"_"), label, expr, tokens };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { tokenize, validate, evaluate, createChannel };
}
if (typeof window !== "undefined") {
  window.beeemuuMath = { tokenize, validate, evaluate, createChannel };
}
