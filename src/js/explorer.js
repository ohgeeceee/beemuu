/**
 * explorer.js — ByteExplorerEngine
 *
 * High-frequency byte-frame diff engine for parameter telemetry discovery.
 * Designed for hot poll loops (Tauri invoke → update()):
 *   - Zero per-frame string allocation (256-entry lookup tables, built once)
 *   - Zero per-frame object allocation in steady state (cell objects are
 *     pooled and mutated in place; update() returns the same array reference)
 *   - Typed-array state buffers (prev values, timestamps, counters, direction)
 *
 * No dependencies. ES module.
 */

/* ---------------------------------------------------------------- *
 *  Static lookup tables (built once per module load)                *
 * ---------------------------------------------------------------- */

const HEX_LUT = new Array(256); // "00".."FF"
const DEC_LUT = new Array(256); // "000".."255"
const ASC_LUT = new Array(256); // printable char or "."

for (let i = 0; i < 256; i++) {
  HEX_LUT[i] = i.toString(16).toUpperCase().padStart(2, '0');
  DEC_LUT[i] = i.toString(10).padStart(3, '0');
  ASC_LUT[i] = i >= 0x20 && i <= 0x7e ? String.fromCharCode(i) : '.';
}

/* Direction states (internal codes → exported strings) */
const DIR_NONE = 0;
const DIR_UP = 1;
const DIR_DOWN = 2;
const DIR_STR = ['none', 'up', 'down'];

/* ---------------------------------------------------------------- */

export class ByteExplorerEngine {
  /**
   * @param {object}  [opts]
   * @param {number}  [opts.highlightTimeout=1200]  ms before a stale
   *                  directional highlight is cleared.
   * @param {number}  [opts.capacity=64]  initial frame length hint;
   *                  buffers grow automatically if frames are larger.
   */
  constructor({ highlightTimeout = 1200, capacity = 64 } = {}) {
    this.highlightTimeout = highlightTimeout;

    /** Frames processed since construction / reset. */
    this.frameCount = 0;

    /** Length of the most recent frame. */
    this.length = 0;

    this._alloc(capacity);
  }

  /* -------------------------------------------------------------- *
   *  Public API                                                     *
   * -------------------------------------------------------------- */

  /**
   * Ingest one frame and diff it against the previous one.
   *
   * @param {ArrayLike<number>} newBytes  values 0–255
   * @param {number} [now]  timestamp (ms); defaults to performance.now().
   *                        Injectable for replay/testing.
   * @returns {Array<{
   *   index: number,
   *   hex: string,
   *   dec: string,
   *   ascii: string,
   *   direction: 'none'|'up'|'down',
   *   changed: boolean,
   *   mutations: number,
   *   activity: number
   * }>}  Pooled array — valid until the next update() call.
   *      Do not retain across frames; copy if you must persist.
   */
  update(newBytes, now = performance.now()) {
    const len = newBytes.length;
    if (len > this._prev.length) this._grow(len);

    const prev = this._prev;
    const dir = this._dir;
    const counts = this._counts;
    const stamps = this._stamps;
    const cells = this._cells;
    const firstFrame = this.frameCount === 0;
    const timeout = this.highlightTimeout;

    for (let i = 0; i < len; i++) {
      const v = newBytes[i] & 0xff;
      const p = prev[i];
      const cell = cells[i];
      let changed = false;

      if (firstFrame || i >= this.length) {
        // Baseline: no diff possible yet at this position.
        stamps[i] = now;
        dir[i] = DIR_NONE;
        counts[i] = 0;
      } else if (v !== p) {
        changed = true;
        dir[i] = v > p ? DIR_UP : DIR_DOWN;
        counts[i]++;
        stamps[i] = now;
      } else if (dir[i] !== DIR_NONE && now - stamps[i] >= timeout) {
        dir[i] = DIR_NONE; // stale highlight decay
      }

      prev[i] = v;

      // Mutate pooled cell in place (monomorphic shape, no allocation).
      cell.index = i;
      cell.hex = HEX_LUT[v];
      cell.dec = DEC_LUT[v];
      cell.ascii = ASC_LUT[v];
      cell.direction = DIR_STR[dir[i]];
      cell.changed = changed;
      cell.mutations = counts[i];
      cell.activity = this._activity(counts[i], stamps[i], now);
    }

    this.length = len;
    this.frameCount++;

    // Expose exactly `len` cells without reallocating the pool.
    if (this._view.length !== len) this._view.length = len;
    for (let i = 0; i < len; i++) this._view[i] = cells[i];
    return this._view;
  }

  /**
   * Positions sorted by volatility, most active first.
   * Allocates (sorting) — call on demand, not in the hot loop.
   * @param {number} [limit]  max entries
   * @returns {Array<{index:number, mutations:number}>}
   */
  hotspots(limit = this.length) {
    const out = [];
    for (let i = 0; i < this.length; i++) {
      if (this._counts[i] > 0) out.push({ index: i, mutations: this._counts[i] });
    }
    out.sort((a, b) => b.mutations - a.mutations);
    if (out.length > limit) out.length = limit;
    return out;
  }

  /** Clear all diff state (e.g., when switching ECU address / DID). */
  reset() {
    this.frameCount = 0;
    this.length = 0;
    this._dir.fill(DIR_NONE);
    this._counts.fill(0);
    this._stamps.fill(0);
    this._view.length = 0;
  }

  /* -------------------------------------------------------------- *
   *  Internals                                                      *
   * -------------------------------------------------------------- */

  /**
   * Volatility activity score in [0, 1]: recency-weighted so it reads as
   * "how alive is this byte right now". 0 = never mutated or long idle,
   * →1 = mutated this instant with a deep history.
   */
  _activity(count, stamp, now) {
    if (count === 0) return 0;
    const recency = 1 - Math.min((now - stamp) / this.highlightTimeout, 1);
    // Saturating history weight: 1 mutation ≈ .24, 8 ≈ .70, 32+ ≈ .90+
    const depth = count / (count + 3);
    return recency * depth;
  }

  _alloc(capacity) {
    this._prev = new Uint8Array(capacity);
    this._dir = new Uint8Array(capacity);
    this._counts = new Uint32Array(capacity);
    this._stamps = new Float64Array(capacity);
    this._cells = new Array(capacity);
    for (let i = 0; i < capacity; i++) this._cells[i] = ByteExplorerEngine._makeCell();
    this._view = [];
  }

  _grow(minLen) {
    const cap = Math.max(minLen, this._prev.length * 2);
    const grown = (Ctor, old) => {
      const b = new Ctor(cap);
      b.set(old);
      return b;
    };
    this._prev = grown(Uint8Array, this._prev);
    this._dir = grown(Uint8Array, this._dir);
    this._counts = grown(Uint32Array, this._counts);
    this._stamps = grown(Float64Array, this._stamps);
    for (let i = this._cells.length; i < cap; i++) {
      this._cells[i] = ByteExplorerEngine._makeCell();
    }
  }

  /** Single shape for every cell → keeps V8 monomorphic on the hot path. */
  static _makeCell() {
    return {
      index: 0,
      hex: '00',
      dec: '000',
      ascii: '.',
      direction: 'none',
      changed: false,
      mutations: 0,
      activity: 0,
    };
  }
}

export default ByteExplorerEngine;
