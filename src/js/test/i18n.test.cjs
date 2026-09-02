"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { t, setLang, getLang, apply, DICTS } = require("../i18n.js");
const enJson = require("../../../community/i18n/en.json");
const deJson = require("../../../community/i18n/de.json");
const frJson = require("../../../community/i18n/fr.json");

test("t falls back to English then key", () => {
  setLang("en");
  assert.equal(t("connect"), "Connect");
  assert.equal(t("missing_key_xyz"), "missing_key_xyz");
});

test("setLang de switches strings without reload", () => {
  setLang("de");
  assert.equal(getLang(), "de");
  assert.equal(t("connect"), "Verbinden");
  assert.equal(t("tab_vehicle"), "Fahrzeugtest");
  setLang("en");
  assert.equal(t("connect"), "Connect");
});

test("unknown lang falls back to en", () => {
  setLang("zz");
  assert.equal(getLang(), "en");
  assert.equal(t("share_log"), "Share log");
});

test("setLang fr switches strings", () => {
  setLang("fr");
  assert.equal(getLang(), "fr");
  assert.equal(t("connect"), "Connecter");
  setLang("en");
});

test("EN, DE, and FR each have at least 50 keys", () => {
  assert.ok(Object.keys(DICTS.en).length >= 50);
  assert.ok(Object.keys(DICTS.de).length >= 50);
  assert.ok(Object.keys(DICTS.fr).length >= 50);
  assert.deepEqual(Object.keys(DICTS.en).sort(), Object.keys(DICTS.de).sort());
  assert.deepEqual(Object.keys(DICTS.en).sort(), Object.keys(DICTS.fr).sort());
});

test("community JSON matches in-module dictionaries", () => {
  assert.deepEqual(enJson, DICTS.en);
  assert.deepEqual(deJson, DICTS.de);
  assert.deepEqual(frJson, DICTS.fr);
});

test("apply writes data-i18n text", () => {
  setLang("de");
  const el = { getAttribute: (n) => (n === "data-i18n" ? "connect" : null), textContent: "" };
  const root = {
    querySelectorAll: (sel) => (sel === "[data-i18n]" ? [el] : []),
  };
  apply(root);
  assert.equal(el.textContent, "Verbinden");
});
