"use strict";

/* Cold Start Auto-Logger — v3.0.0 feature 5.
 *
 * The intermittent cold-start fault. It happens on the drive to work, in the
 * rain, at 7am in December, and by the time you get the car on a lift it is
 * warm and it never happens again. Every logger in the world requires you to
 * press record at the moment the fault occurs, which is exactly the moment you
 * are too busy driving to press anything.
 *
 * This inverts it. Arm the logger before you leave, drive away, and the log is
 * already there in the morning. The monitor watches coolant temperature and
 * engine state, and when it sees a cold engine start it opens a capture window
 * automatically.
 *
 * The interesting constraint is not the trigger, it is the *arming* discipline.
 * A naive monitor that fires whenever the engine is cold and running will fire
 * on a warm engine that was left idling, and — worse — on a genuinely cold
 * start that happened before the user armed it. Both produce a log labelled
 * "cold start" that is not one, and a user who chases three of those will
 * stop trusting the fourth. So:
 *
 *   - Arming requires a *cold engine, not running* observation. That is the
 *     only state that legitimately precedes a cold start.
 *   - Once armed, the capture opens on the transition into running, and only
 *     that transition. Staying armed while the engine runs would fire repeatedly.
 *   - The capture closes on warm-up, and disarms itself, so the next cold
 *     start tomorrow is armed fresh.
 *   - A start that happens with no prior cold observation never opens a capture.
 *     We were not watching; we cannot claim to have seen the cold start.
 *
 * Pure: no DOM, no Tauri, no transport. A caller feeds it live values and acts
 * on the actions it returns. That keeps the state machine testable without a
 * car, which matters because the whole feature is a claim about timing.
 */

const ACTIONS = {
  none: "none",
  armed: "armed",
  start: "start_logging",
  stop: "stop_logging",
  disarmed: "disarmed",
};

const DEFAULTS = {
  /* Coolant at or below this counts as cold. 40C is the spec's number and is
   * also roughly the point where a BMW DME stops enrichment. */
  cold_temp: 40,
  /* The capture closes once the engine is properly warm. */
  warm_temp: 70,
  /* How long the capture stays open. The cold-start window is short and the
   * interesting part is over well before the engine reaches normal temp. */
  window_ms: 5 * 60 * 1000,
  /* The engine must be off for at least this long before a stop counts as
   * "cold and off" rather than a stall or an autostart hiccup. Guards against
   * arming on a brief stop-start in traffic, which is the opposite of a cold
   * start. */
  min_off_ms: 60 * 1000,
};

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * A cold-start capture monitor.
 *
 * Feed it one observation at a time via `tick()`; it returns the action the
 * caller should take. It holds no timers and reads no clock of its own beyond
 * the `t` you pass in, so a replayed log produces the same decisions as the
 * live one.
 */
function createMonitor(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  let armed = false;
  let logging = false;
  let captureStart = null;
  let offSince = null;
  let lastStartTemp = null;
  let captures = 0;
  let armedAt = null;

  function reset() {
    armed = false;
    logging = false;
    captureStart = null;
    offSince = null;
    lastStartTemp = null;
  }

  /**
   * Observe one sample.
   *
   * @param {Object} sample
   * @param {boolean} sample.running      engine is turning over
   * @param {number}  sample.coolant     coolant temperature, degrees C
   * @param {number}  sample.t           epoch ms (required — no internal clock)
   * @returns {{action: string, reason: string, ...}}
   */
  function tick(sample) {
    const s = sample || {};
    const running = !!s.running;
    const t = s.t;
    // Without a timestamp we cannot reason about the off-duration or the
    // capture window, and a monitor that guesses at elapsed time is worse than
    // one that declines to act.
    if (!finite(t)) return result(ACTIONS.none, "no timestamp");

    // A sample with no coolant reading still tells us whether the engine is
    // turning over, which is enough to track the off/run transition and to
    // open an armed capture. Only the arming decision needs a temperature.
    const coolant = finite(s.coolant) ? s.coolant : null;

    // --- the engine is not running -------------------------------------
    if (!running) {
      if (logging) {
        // Engine stopped mid-capture. That is the end of this capture, and the
        // monitor goes back to watching for the next cold start.
        logging = false;
        captureStart = null;
        // The off-soak clock restarts from here. Leaving the pre-start value in
        // place would let the very next cold sample re-arm instantly, turning a
        // stall in traffic into a phantom "cold start armed" — the precise
        // mislabelling this monitor exists to avoid.
        offSince = t;
        return result(ACTIONS.stop, "engine stopped during capture");
      }
      if (armed) {
        // Still off, still armed. Not an event.
        return result(ACTIONS.none, "waiting for a cold start");
      }
      // Only a cold engine can legitimately arm: arming on a warm engine would
      // promise a cold-start capture the car is not going to produce.
      const isCold = coolant != null && coolant <= o.cold_temp;
      if (isCold) {
        if (offSince == null) {
          offSince = t;
          return result(ACTIONS.none, "engine off and cold");
        }
        if (t - offSince >= o.min_off_ms) {
          armed = true;
          armedAt = offSince;
          return result(ACTIONS.armed, `engine off and cold for ${Math.round((t - offSince) / 1000)}s`);
        }
        return result(ACTIONS.none, "engine off and cold, waiting to settle");
      }
      offSince = null;
      return result(ACTIONS.none, coolant != null ? "engine off and warm" : "engine off");
    }

    // --- the engine is running -----------------------------------------
    if (logging) {
      const elapsed = t - captureStart;
      const warm = coolant != null && coolant >= o.warm_temp;
      if (warm) {
        // Fully warm: the cold-start window is definitively over.
        logging = false;
        armed = false;
        captureStart = null;
        offSince = null;
        return result(ACTIONS.stop, "engine reached full temperature");
      }
      if (elapsed >= o.window_ms) {
        // Time's up even though it is still warming. The interesting window is
        // over either way.
        logging = false;
        armed = false;
        captureStart = null;
        offSince = null;
        return result(ACTIONS.stop, `capture window of ${Math.round(o.window_ms / 1000)}s elapsed`);
      }
      return result(ACTIONS.none, "capturing");
    }

    if (armed) {
      // The transition we armed for. This is the only path that opens a capture.
      armed = false;
      logging = true;
      captureStart = t;
      lastStartTemp = coolant;
      captures++;
      return result(ACTIONS.start, coolant != null
        ? `cold start detected at ${coolant}C`
        : "cold start detected (coolant unknown)");
    }

    // Running with no prior cold observation: we were not watching for a cold
    // start, so we cannot claim one happened. This is the case that keeps a
    // warm idle from being logged as a cold start.
    if (coolant != null && coolant <= o.cold_temp) {
      return result(ACTIONS.none, "running and cold but not armed — no cold start was observed");
    }
    return result(ACTIONS.none, "running and not armed");
  }

  function result(action, reason) {
    return {
      action,
      reason,
      armed,
      logging,
      captures,
      last_start_temp: lastStartTemp,
      armed_at: armedAt,
    };
  }

  return {
    tick,
    reset,
    isArmed: () => armed,
    isLogging: () => logging,
    captureCount: () => captures,
    state: () => ({ armed, logging, captures, last_start_temp: lastStartTemp }),
    options: o,
  };
}

const api = { ACTIONS, DEFAULTS, createMonitor };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.beeemuuColdStart = api;
