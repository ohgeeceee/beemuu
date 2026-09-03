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
test("e90 and e70 prefixes", ()=>{
  const rich = {
    WBA3C1: { options: ["N52 3.0", "E90 328i"] },
    "5UXZV4": { options: ["N62 4.8", "E70 X5 4.8i"] },
  };
  assert.deepEqual(lookupVin("WBA3C11070A12345", rich), ["N52 3.0", "E90 328i"]);
  assert.deepEqual(lookupVin("5UXZV4C58J0L12345", rich), ["N62 4.8", "E70 X5 4.8i"]);
});
