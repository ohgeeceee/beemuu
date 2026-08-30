"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// mock localStorage
global.localStorage = { _s:{}, getItem(k){return this._s[k]||null}, setItem(k,v){this._s[k]=v}, removeItem(k){delete this._s[k]} };
const { save, load, clear } = require("../workspace.js");

test("save/load round-trip", ()=>{
  clear();
  save([{profile_id:"n55", param_id:"rpm", min:0, max:7000}], "light");
  const got = load();
  assert.equal(got.theme,"light");
  assert.equal(got.gauges[0].param_id,"rpm");
});
test("load empty defaults", ()=>{
  clear();
  const got = load();
  assert.deepEqual(got.gauges,[]);
  assert.equal(got.theme,"dark");
});
test("save overwrites", ()=>{
  save([{profile_id:"b58",param_id:"boost_cmd",min:0,max:300}],"dark");
  const got=load();
  assert.equal(got.gauges[0].profile_id,"b58");
});
