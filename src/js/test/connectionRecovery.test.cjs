const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDIDBridge } = require('../live_data_bridge.js');
const { createKdcanSource } = require('../live_kdcan_source.js');
const { buildFirstScanGuide } = require('../first_scan_guide.js');

test('channel age expires independently and PID errors invalidate immediately', () => {
  let time = 0;
  const bridge = createDIDBridge({ now: () => time });
  assert.equal(bridge.freshness().state, 'waiting');
  bridge.applySweep([{ id: 'rpm', value: 750 }, { id: 'gear', value: 0, text: 'D3' }], []);
  time = 4000;
  bridge.applySweep([{ id: 'coolant', value: 90 }], []);
  time = 5000;
  assert.deepEqual(bridge.freshness(), { state: 'stale', staleKeys: ['rpm', 'gear'] });
  bridge.applySweep([], [{ id: 'coolant' }]);
  assert.ok(bridge.freshness().staleKeys.includes('coolant'));
  assert.equal(bridge.latestValues().coolant, 90, 'history remains separate from freshness');
  bridge.applySweep([{ id: 'rpm', value: 800 }, { id: 'coolant', value: 91 }, { id: 'gear', text: 'D4' }], []);
  assert.equal(bridge.freshness().state, 'live');
  bridge.markStale();
  assert.equal(bridge.freshness().state, 'stale');
});

test('reset and listener restart cannot reuse readings from a previous session', () => {
  const bridge = createDIDBridge();
  const source = createKdcanSource(bridge);
  try {
    source.start();
    source.applySweepFromTauri([{ id: 'rpm', value: 2000 }, { id: 'gear', text: 'D3' }], []);
    assert.equal(source.readingState().state, 'live');
    source.stop();
    assert.equal(source.readingState().state, 'stopped');
    source.start();
    assert.deepEqual(source.latestValues(), {});
    assert.deepEqual(source.latestText(), {});
    assert.equal(source.readingState().state, 'waiting');
    assert.equal(bridge.peakFor('rpm'), undefined);
  } finally { source.stop(); }
});

test('failed connection guide offers adapter-specific recovery', () => {
  for (const [kind, expected] of [['kdcan', /available port.*1 ms/], ['enet', /Discover.*firewall/], ['sim', /restart the simulator/]]) {
    const guide = buildFirstScanGuide({ connectionKind: kind, connectionError: true });
    assert.match(guide.steps[1].detail, expected);
    assert.equal(guide.steps[1].complete, false);
  }
});
