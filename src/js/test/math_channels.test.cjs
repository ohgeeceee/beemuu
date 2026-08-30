"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { tokenize, validate, evaluate, createChannel } = require("../math_channels.js");

test("tokenize basic", ()=>{ assert.deepEqual(tokenize("map - baro"), ["map","-","baro"]); });
test("evaluate map-baro", ()=>{
  const m = new Map([["map", 180],["baro",100]]);
  assert.equal(evaluate("map - baro", m), 80);
});
test("evaluate with parens and mult", ()=>{
  const m = new Map([["map",150],["baro",100]]);
  assert.equal(evaluate("(map - baro) * 2", m), 100);
});
test("validate rejects unknown id", ()=>{
  assert.throws(()=>validate(tokenize("map - unknown"), ["map","baro"]));
});
test("validate rejects illegal chars", ()=>{
  assert.throws(()=>tokenize("map; baro"));
});
test("createChannel ok", ()=>{
  const ch = createChannel("Boost diff", "map - baro", ["map","baro","rpm"]);
  assert.equal(ch.id, "math_boost_diff");
});
test("evaluate missing value throws", ()=>{
  assert.throws(()=>evaluate("map - baro", new Map([["map",1]])));
});
