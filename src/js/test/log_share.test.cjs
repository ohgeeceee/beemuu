"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { shareLog } = require("../log_share.js");

test("shareLog posts and returns id", async ()=>{
  const origFetch = global.fetch;
  global.fetch = async (url, opts)=>{
    assert.ok(url.endsWith("/api/logs"));
    assert.equal(opts.method, "POST");
    return { ok:true, json: async()=>({id:"abc123", url:"/log-viewer.html?id=abc123", size: opts.body.length }) };
  };
  const res = await shareLog("a,b\n1,2\n", "");
  assert.equal(res.id, "abc123");
  global.fetch = origFetch;
});

test("shareLog throws on non-ok", async ()=>{
  const origFetch = global.fetch;
  global.fetch = async ()=>({ ok:false, status:429, text: async()=>"rate limit" });
  await assert.rejects(()=>shareLog("a,b\n1,2\n",""), /share failed/);
  global.fetch = origFetch;
});
