/* Predictive CBS Timeline — pure prediction engine.
 *
 * Condition Based Service (CBS) on modern BMWs reports the *current* state of
 * each service item (brake pad thickness, oil condition, distance since reset).
 * This module predicts when each item will actually be due, based on:
 *   1. the item's wear model (new value, threshold, default wear rate),
 *   2. historical measurements (km, value) for a measured wear rate, and
 *   3. the driver's profile, which scales wear (aggressive wears faster,
 *      highway cruises wear slower).
 *
 * Kept dependency-free and dual-context: loaded as a plain <script> in
 * index.html (exposes `window.CbsPredict`) and `require()`d by
 * `src/js/test/cbs_predict.test.cjs` under Node. All date logic takes an
 * injectable `nowIso` so tests are deterministic.
 *
 * Units: distance in km, pad thickness in mm, oil/filter remaining as a
 * percentage or a distance-interval in km. See CBS_ITEMS for the catalog.
 */
(function (root) {
  "use strict";

  /* Standard BMW CBS wear models. `new_value` is a freshly-reset measurement,
   * `threshold` is the value at which the item is DUE, `default_wear_per_1000km`
   * is the assumed wear for a mixed driver with no history, and
   * `max_interval_km`/`max_interval_months` bound how long the item should last
   * regardless of measured wear (so a slowly-wearing filter is still flagged on
   * BMW's own conservative schedule). */
  const CBS_ITEMS = {
    front_brake: {
      id: "front_brake", label: "Front brake pads", unit: "mm",
      new_value: 12, threshold: 2,
      default_wear_per_1000km: 0.14,   // ~2.8mm per 20k km from new pads
      max_interval_km: 60000, max_interval_months: null,
    },
    rear_brake: {
      id: "rear_brake", label: "Rear brake pads", unit: "mm",
      new_value: 12, threshold: 2,
      default_wear_per_1000km: 0.1,    // ~2mm per 20k km
      max_interval_km: 80000, max_interval_months: null,
    },
    brake_fluid: {
      id: "brake_fluid", label: "Brake fluid", unit: "mo",
      new_value: 24, threshold: 0,     // replaced at 24 months
      default_wear_per_1000km: 0,
      max_interval_km: null, max_interval_months: 24,
    },
    engine_oil: {
      id: "engine_oil", label: "Engine oil", unit: "km",
      new_value: 15000, threshold: 0,  // distance-interval item
      default_wear_per_1000km: 0,
      max_interval_km: 15000, max_interval_months: 24,
    },
    microfilter: {
      id: "microfilter", label: "Microfilter / cabin filter", unit: "km",
      new_value: 30000, threshold: 0,
      default_wear_per_1000km: 0,
      max_interval_km: 30000, max_interval_months: 24,
    },
    spark_plugs: {
      id: "spark_plugs", label: "Spark plugs", unit: "km",
      new_value: 100000, threshold: 0,
      default_wear_per_1000km: 0,
      max_interval_km: 100000, max_interval_months: null,
    },
    coolant: {
      id: "coolant", label: "Coolant", unit: "mo",
      new_value: 48, threshold: 0,
      default_wear_per_1000km: 0,
      max_interval_km: null, max_interval_months: 48,
    },
  };

  /* Driving profiles scale the measured/default wear rate. `mixed` is baseline
   * (1.0); aggressive wears components faster, highway cruise slower. */
  const DRIVING_FACTORS = { mixed: 1.0, city: 1.15, aggressive: 1.35, highway: 0.7 };

  function _finite(n) { return typeof n === "number" && Number.isFinite(n); }

  /* Average km driven per day, from at least two {km, date} odometer readings.
   * Returns null if we can't compute it (insufficient data). */
  function dailyKm(snapshots) {
    if (!Array.isArray(snapshots) || snapshots.length < 2) return null;
    const dated = snapshots.filter(s => _finite(s.km) && typeof s.date === "string" && Number.isFinite(new Date(s.date).getTime()));
    if (dated.length < 2) return null;
    dated.sort((a, b) => new Date(a.date) - new Date(b.date));
    const first = dated[0], last = dated[dated.length - 1];
    const days = Math.max(1, (new Date(last.date) - new Date(first.date)) / 86400000);
    return Math.max(0, (last.km - first.km) / days);
  }

  /* Measured wear rate for an item (value-units consumed per 1000 km), from the
   * most recent two measurements that share the item's history. Returns null
   * when history is too sparse to be trusted. */
  function measuredWearRate(itemId, history) {
    if (!Array.isArray(history)) return null;
    const points = history
      .filter(p => p && p.id === itemId && _finite(p.km) && _finite(p.value))
      .sort((a, b) => a.km - b.km);
    if (points.length < 2) return null;
    const first = points[0], last = points[points.length - 1];
    const km = last.km - first.km;
    if (km <= 0) return null;
    return ((first.value - last.value) / km) * 1000; // consumed per 1000 km
  }

  /* Classify an item's current state: OK / DUE / OVERDUE. */
  function status(item, value, predictedDueKm, currentKm) {
    if (item.max_interval_months && value <= 0) return "OVERDUE";
    if (item.threshold && value <= item.threshold) return "OVERDUE";
    if (predictedDueKm != null && currentKm != null && predictedDueKm <= currentKm) return "DUE";
    return "OK";
  }

  /* Predict a single item's due point. Returns a CbsPrediction. */
  function predictItem(item, currentValue, currentKm, history, driving, avgKmPerDay, nowIso) {
    const factor = DRIVING_FACTORS[driving] || 1.0;
    const now = nowIso ? new Date(nowIso) : new Date();
    let predictedDueKm = null;
    let predictedDueDate = null;
    let confidence = 0;
    let note = "";

    // Items whose value is a distance remaining (interval-based: oil,
    // filters) — the value IS the remaining distance, so the due odometer
    // is the current odometer plus that remaining distance.
    if (item.max_interval_km && item.new_value > 0 && item.threshold === 0) {
      predictedDueKm = currentKm + currentValue;
      note = "distance-based interval";
      confidence = 80;
    } else if (item.max_interval_months && item.threshold === 0 && item.default_wear_per_1000km === 0) {
      // time-based interval (brake fluid, coolant): value = months remaining
      const dueDate = new Date(now.getTime() + currentValue * 30 * 86400000);
      predictedDueDate = dueDate.toISOString().slice(0, 10);
      note = "time-based interval";
      confidence = 70;
    } else {
      // Wear-based (brake pads): extrapolate current value to the threshold.
      const rate = measuredWearRate(item.id, history) ?? item.default_wear_per_1000km;
      const effectiveRate = rate * factor;
      const gap = currentValue - item.threshold;
      if (effectiveRate > 0 && gap > 0) {
        const remainingKm = (gap / effectiveRate) * 1000;
        predictedDueKm = currentKm + remainingKm;
        // Cap by the conservative max interval from a fresh reset.
        if (item.max_interval_km && currentValue >= item.new_value - 0.5 && remainingKm > item.max_interval_km) {
          predictedDueKm = currentKm + item.max_interval_km;
        }
        note = measuredWearRate(item.id, history) ? "measured wear" : "default wear";
        confidence = measuredWearRate(item.id, history) ? 75 : 50;
      }
    }

    // Convert a due-km estimate into a calendar date when we know the pace.
    if (predictedDueKm != null && avgKmPerDay != null && avgKmPerDay > 0) {
      const days = Math.max(0, Math.round((predictedDueKm - currentKm) / avgKmPerDay));
      const dueDate = new Date(now.getTime() + days * 86400000);
      predictedDueDate = dueDate.toISOString().slice(0, 10);
    }

    return {
      item: item.id,
      label: item.label,
      unit: item.unit,
      current_status: status(item, currentValue, predictedDueKm, currentKm),
      current_value: currentValue,
      predicted_due_km: predictedDueKm,
      predicted_due_date: predictedDueDate,
      driving_adjustment: `${Math.round(factor * 100)}% of mixed-driving wear`,
      confidence,
      note,
    };
  }

  /* Predict every CBS item from a map of current values. `values` is
   * {itemId: number}; missing items are skipped so callers can predict a subset.
   * Returns predictions sorted by soonest due. */
  function predictAll(values, currentKm, history, driving, snapshots, nowIso) {
    const avg = dailyKm(snapshots);
    const out = [];
    for (const id of Object.keys(CBS_ITEMS)) {
      if (!_finite(values[id])) continue;
      out.push(predictItem(CBS_ITEMS[id], values[id], currentKm, history, driving, avg, nowIso));
    }
    const base = nowIso ? new Date(nowIso).getTime() : Date.now();
    const score = p => {
      // Normalize km-remaining and calendar-date due points to an estimated
      // due epoch so a mixed list sorts consistently. Falls back to current
      // time for anything already due, Infinity for the unknown.
      if (p.predicted_due_date) return new Date(p.predicted_due_date).getTime();
      if (p.predicted_due_km != null) {
        if (avg != null && avg > 0) {
          const days = Math.max(0, Math.round((p.predicted_due_km - currentKm) / avg));
          return base + days * 86400000;
        }
        return p.predicted_due_km;
      }
      return Infinity;
    };
    out.sort((a, b) => score(a) - score(b));
    return out;
  }

  const api = { CBS_ITEMS, DRIVING_FACTORS, dailyKm, measuredWearRate, predictItem, predictAll, status };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CbsPredict = api;
})(typeof window !== "undefined" ? window : null);
