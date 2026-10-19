/* Real app shell with a mocked Tauri boundary; no vehicle commands leave the page. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => console.error("APP:", error.message));
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      window.connectionCalls = 0;
      window.connectFails = true;
      window.__TAURI__ = { core: { invoke: async (cmd) => {
        if (cmd === 'connect') {
          window.connectionCalls++;
          await new Promise(resolve => { window.finishConnect = resolve; });
          if (window.connectFails) throw new Error('Adapter unavailable');
          return { transport_name: 'Test adapter', vin: '' };
        }
        if (cmd === 'disconnect') throw new Error('Cable already removed');
        if (cmd === 'load_workspace') return {};
        if (cmd === 'list_profiles') return [{ id: 'test', label: 'Test profile' }];
        if (cmd === 'read_live_data') {
          if (window.deferLive) {
            await new Promise(resolve => { window.finishLive = resolve; });
            return { values: [{ id: 'rpm', value: 3000, label: 'RPM', min: 0, max: 8000, unit: 'rpm' }], errors: [] };
          }
          return { values: [], errors: [] };
        }
        return [];
      } } };
    });
    await page.goto('file://' + path.resolve(__dirname, '../src/index.html'));
    await page.waitForFunction(() => document.querySelector('#first-scan-guide-body').textContent.includes('Choose an adapter'));
    if (await page.locator('#modal-accept').isVisible()) await page.locator('#modal-accept').click();
    await page.locator('#conn-kind').selectOption('enet');
    await page.locator('#btn-connect').click();
    await page.evaluate(() => document.querySelector('#btn-connect').dispatchEvent(new Event('click')));
    assert.equal(await page.evaluate(() => window.connectionCalls), 1);
    assert.equal(await page.locator('#btn-connect').isDisabled(), true);
    await page.evaluate(() => window.finishConnect());
    await page.waitForFunction(() => !document.querySelector('#btn-connect').disabled);
    assert.match(await page.locator('#first-scan-guide-body').innerText(), /Connection failed.*Discover/s);
    if (process.env.RECOVERY_SCREENSHOTS) {
      fs.mkdirSync(process.env.RECOVERY_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.RECOVERY_SCREENSHOTS, 'recovery-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(process.env.RECOVERY_SCREENSHOTS, 'recovery-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.evaluate(() => { window.connectFails = false; });
    await page.locator('#btn-connect').click();
    await page.evaluate(() => window.finishConnect());
    await page.waitForFunction(() => document.querySelector('#btn-connect').textContent === 'Disconnect');
    assert.equal(await page.locator('#conn-kind').isDisabled(), true);
    // A late live read must not repopulate a disconnected session.
    await page.evaluate(() => {
      stopTriggerPoll();
      window.deferLive = true;
      window.pendingRead = pollOnce();
    });
    await page.waitForFunction(() => typeof window.finishLive === 'function');
    await page.locator('#btn-connect').click();
    await page.waitForFunction(() => document.querySelector('#btn-connect').textContent === 'Connect' && !document.querySelector('#btn-connect').disabled);
    assert.equal(await page.locator('#conn-kind').isDisabled(), false);
    const lateCount = await page.evaluate(async () => {
      window.finishLive();
      await window.pendingRead;
      return gauges.size;
    });
    assert.equal(lateCount, 0, 'late response cannot restore disconnected readings');
    await page.locator('#conn-kind').selectOption('kdcan');
    await page.locator('#btn-connect').click();
    assert.equal(await page.evaluate(() => window.connectionCalls), 2, 'missing port must not call backend connect');
    assert.match(await page.locator('#first-scan-guide-body').innerText(), /available port.*1 ms/s);
    // Render actual canvas gauges with per-channel freshness, then recover.
    const states = await page.evaluate(() => {
      const source = kdcanDataSource.getKdcanSource();
      const bridge = kdcanDataSource.getBridge();
      const controller = window.beeemuuLiveGauges.controller;
      source.start();
      source.applySweepFromTauri([{ id: 'rpm', value: 1200 }], []);
      controller.render();
      const live = document.querySelector('#live-can-status').textContent;
      bridge.markStale();
      controller.render();
      const stale = controller.gauges.rpm.textOverride;
      source.applySweepFromTauri([{ id: 'rpm', value: 800 }], []);
      controller.render();
      const recovered = controller.gauges.rpm.textOverride;
      bridge.reset();
      controller.render();
      const cleared = controller.gauges.rpm.textOverride;
      source.stop();
      return { live, stale, recovered, cleared };
    });
    assert.deepEqual(states, { live: 'Live', stale: 'Stale', recovered: null, cleared: 'Waiting' });
    console.log('PASS: connection retry, duplicate guard, disconnect failure cleanup and Live Gauges freshness');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
