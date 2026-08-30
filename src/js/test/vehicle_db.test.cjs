"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { lookupVin } = require("../vehicle_db.js");
const db = {
  "WBA8E9": { options: ["M Sport", "N55"] },
  "WBA8E": { options: ["Generic F30"] },
};
test("longest prefix wins", ()=>{
  assert.deepEqual(lookupVin("WBA8E9G51GNU12345", db), ["M Sport","N55"]);
  assert.deepEqual(lookupVin("WBA8E3", db), ["Generic F30"]);
});
test("no match empty", ()=>{
  assert.deepEqual(lookupVin("XYZ123", db), []);
});
