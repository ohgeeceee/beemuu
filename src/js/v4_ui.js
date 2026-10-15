/* v4.x diagnostics panels — signal integrity, drive cycles, fleet, provenance,
 * sensor cross-check, community opinion, plugin capabilities.
 *
 * Why a second UI file instead of another section of `v3_ui.js`: the v3 panels
 * are the shipped, tested surface of the v3 arc and are pinned by
 * `test/v3_wiring.test.cjs`. This file mounts the v4 arc's panels against the
 * same DOM contract (a `.panel` inside `#view-diagnostics`, a `-body` node to
 * render into) and the same read-only bridge, so the two arcs can be reasoned
 * about — and rolled back — independently.
 *
 * Two rules this file obeys, because both are load-bearing for diagnostics:
 *
 *  1. Every number on screen comes from an engine that was handed real data or
 *     from a parser that rejected the input outright. Nothing is invented: a
 *     panel with no data says so in words instead of drawing an empty axis.
 *  2. A panel never blocks another panel. Each mount is wrapped so that a
 *     missing engine degrades that one panel to "unavailable" and leaves the
 *     rest of the session working.
 *
 * The panels read live data through `window.beeemuuV3` (the read-only bridge
 * `main.js` publishes) and read the user's own records from inputs that persist
 * to localStorage under `beeemuu.<panel>.v1`, matching the v3 panels that keep
 * their samples the same way. A refresh restores exactly what was typed.
 */

(function () {
  "use strict";

  /* ---------------- named thresholds and formats ---------------- */

  // The fleet board grades vehicles against the manufacturer interval the app
  // already assumes for engine oil when no vehicle-specific figure is known.
  var DEFAULT_OIL_INTERVAL_KM = 15000;
  var DEFAULT_OIL_INTERVAL_MONTHS = 12;

  // Opinion quorum mirrors opinion_consensus.js: an engine answer below this is
  // reported as "not enough opinions", never as a weak consensus.
  var OPINION_QUORUM = 4;

  // A vehicle at or below this grade is what a fleet owner must look at today.
  var FLEET_URGENT_GRADES = { D: true, F: true };

  var STORE = {
    fleet: "beeemuu.fleet.v1",
    provenance: "beeemuu.prov.v1",
    opinion: "beeemuu.opinion.v1",
    plugin: "beeemuu.plugin.v1",
  };

  var EXAMPLE_MANIFEST = [
    "{",
    '  "id": "com.example.dpfdoc",',
    '  "name": "DPF Doctor",',
    '  "version": "1.0.0",',
    '  "capabilities": ["read-vin", "read-dtc", "read-live-data", "write-dtc"]',
    "}",
  ].join("\n");

  /* ---------------- tiny DOM helpers ---------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null && text !== "") node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }

  function clear(node) {
    if (node) while (node.firstChild) node.removeChild(node.firstChild);
  }

  function muted(node, text) {
    node.appendChild(el("p", text, "v3-note muted"));
  }

  // verdict -> card accent + pill kind. Unknown verdicts stay neutral rather
  // than defaulting to a reassuring colour.
  var VERDICT_CLASS = {
    ok: "v3-ok",
    info: "v3-info",
    warn: "v3-warn",
    bad: "v3-danger",
    danger: "v3-danger",
    unknown: "v3-muted-card",
  };

  function accent(verdict) {
    return VERDICT_CLASS[verdict] || "v3-muted-card";
  }

  // Pill kinds are a separate vocabulary from card accents: an unknown verdict
  // reads as grey "none", never as a green "ok".
  var PILL_KIND = {
    ok: "ok",
    info: "info",
    warn: "warn",
    bad: "danger",
    danger: "danger",
  };

  function pill(verdict, label) {
    return el("span", label, "v3-pill v3-pill-" + (PILL_KIND[verdict] || "none"));
  }

  function card(verdict, title, subtitle) {
    var box = el("div", null, "v3-card " + accent(verdict));
    var head = el("div", null, "v3-card-head");
    head.appendChild(el("span", title, "v3-card-title"));
    box.appendChild(head);
    if (subtitle) box.appendChild(el("div", subtitle, "v3-card-body"));
    return box;
  }

  function meta(box, pairs) {
    var row = el("div", null, "v3-card-meta");
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][1] === null || pairs[i][1] === undefined) continue;
      row.appendChild(el("span", pairs[i][0] + ": " + pairs[i][1]));
    }
    box.appendChild(row);
    return box;
  }

  function evidenceList(box, lines) {
    if (!lines || !lines.length) return box;
    var list = el("div", null, "v3-list");
    for (var i = 0; i < lines.length; i++) {
      if (typeof lines[i] !== "string" || !lines[i]) continue;
      var row = el("div", null, "v3-list-row");
      row.appendChild(el("span", lines[i]));
      list.appendChild(row);
    }
    if (list.firstChild) box.appendChild(list);
    return box;
  }

  function unavailable(body, engine, what) {
    clear(body);
    muted(body, engine + " is not loaded in this build, so " + what + " cannot be shown.");
  }

  function dead(message) {
    var box = el("div", "Note: " + message, "v3-note v3-note-warn");
    return box;
  }

  function store(key, value) {
    try {
      if (value === undefined) {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      }
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable: the panel still works for this session */
    }
    return value;
  }

  function bridge() {
    return window.beeemuuV4 || window.beeemuuV3 || null;
  }

  function seriesOf() {
    var b = bridge();
    if (!b || typeof b.logSeries !== "function") return null;
    try {
      return b.logSeries();
    } catch (e) {
      return null;
    }
  }

  function num(v, digits) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    return digits ? v.toFixed(digits) : String(Math.round(v));
  }

  /* ---------------- input parsing (strict, never guesses) ---------------- */

  // Users paste records; the parsers below accept one documented shape and
  // reject everything else with a line number, because a silently mis-parsed
  // service record would produce a confident but wrong provenance verdict.
  function splitLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(function (l) {
        return l.trim();
      })
      .filter(function (l) {
        return l && l.charAt(0) !== "#";
      });
  }

  function fields(line) {
    return line.split("|").map(function (f) {
      return f.trim();
    });
  }

  function isIsoDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  function parseFleet(text) {
    var out = { vehicles: [], errors: [] };
    var lines = splitLines(text);
    for (var i = 0; i < lines.length; i++) {
      var f = fields(lines[i]);
      var label = f[0];
      var odo = Number(f[1]);
      if (!label || !f[1] || !isFinite(odo) || odo < 0) {
        out.errors.push("line " + (i + 1) + ": expected label | odometer_km (and optionally DTCs)");
        continue;
      }
      var vehicle = {
        id: "fleet-" + i,
        label: label,
        odometer_km: odo,
        dtcs: [],
        service_intervals: [],
      };
      if (f[2]) {
        var codes = f[2].split(",").map(function (c) {
          return c.trim();
        });
        for (var c = 0; c < codes.length; c++) {
          if (codes[c]) vehicle.dtcs.push({ code: codes[c], description: null });
        }
      }
      var lastKm = Number(f[3]);
      var lastDate = f[4];
      if (f[3] || f[4]) {
        if (!f[3] || !isFinite(lastKm) || lastKm < 0 || !isIsoDate(lastDate || "")) {
          out.errors.push(
            "line " + (i + 1) + ": last service needs BOTH odometer_km and a YYYY-MM-DD date"
          );
          continue;
        }
        vehicle.service_intervals.push({
          label: "Engine oil",
          km: DEFAULT_OIL_INTERVAL_KM,
          months: DEFAULT_OIL_INTERVAL_MONTHS,
          last_done_km: lastKm,
          last_done_date: lastDate,
        });
      }
      vehicle.service_history = [];
      out.vehicles.push(vehicle);
    }
    return out;
  }

  function parseProvenance(text) {
    var out = { entries: [], errors: [] };
    var lines = splitLines(text);
    for (var i = 0; i < lines.length; i++) {
      var f = fields(lines[i]);
      var cost = f[2] === undefined || f[2] === "" ? null : Number(f[2]);
      var odo = Number(f[1]);
      if (!isIsoDate(f[0])) {
        out.errors.push("line " + (i + 1) + ": date must be YYYY-MM-DD");
        continue;
      }
      if (!f[1] || !isFinite(odo) || odo < 0) {
        out.errors.push("line " + (i + 1) + ": odometer_km must be a non-negative number");
        continue;
      }
      if (cost !== null && (!isFinite(cost) || cost < 0)) {
        out.errors.push("line " + (i + 1) + ": cost must be a non-negative number or blank");
        continue;
      }
      out.entries.push({
        date: f[0],
        odometer_km: odo,
        cost: cost,
        description: f[3] || "",
      });
    }
    out.entries.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    return out;
  }

  function parseOpinions(text) {
    var out = { opinions: [], errors: [] };
    var lines = splitLines(text);
    for (var i = 0; i < lines.length; i++) {
      var f = fields(lines[i]);
      var conf = Number(f[4]);
      if (!isIsoDate(f[0])) {
        out.errors.push("line " + (i + 1) + ": date must be YYYY-MM-DD");
        continue;
      }
      if (!f[1] || !f[2] || !f[3]) {
        out.errors.push("line " + (i + 1) + ": expected date | source | author | repair");
        continue;
      }
      if (!isFinite(conf) || conf < 0 || conf > 1) {
        out.errors.push("line " + (i + 1) + ": confidence must be between 0 and 1");
        continue;
      }
      var km = f[5] === undefined || f[5] === "" ? null : Number(f[5]);
      if (km !== null && (!isFinite(km) || km < 0)) {
        out.errors.push("line " + (i + 1) + ": mileage_km must be a non-negative number or blank");
        continue;
      }
      out.opinions.push({
        id: "op-" + i,
        date: f[0],
        source: f[1],
        author: f[2],
        verdict: f[3],
        confidence: conf,
        mileage_km: km,
      });
    }
    return out;
  }

  function errorBox(body, errors) {
    if (!errors.length) return;
    var box = el("div", null, "v3-card v3-warn");
    box.appendChild(el("div", errors.length + " line(s) were ignored:", "v3-card-title"));
    evidenceList(box, errors);
    body.appendChild(box);
  }

  /* ---------------- 1. signal integrity (v3.8.0) ---------------- */

  function mountSignalIntegrity() {
    var run = $("v4-signal-run");
    var body = $("v4-signal-body");
    if (!run || !body) return;

    function render() {
      var api = window.beeemuuSignalQuality;
      if (!api || typeof api.analyze !== "function") {
        return unavailable(body, "signal_quality.js", "channel integrity");
      }
      var series = seriesOf();
      if (!series || typeof series.forEach !== "function" || !series.size) {
        clear(body);
        return muted(body, "No log is loaded. Capture or open a log, then run the check again.");
      }
      var result = api.analyze(series);
      clear(body);
      var s = result.summary || {};
      var head = card(
        s.bad > 0 ? "warn" : s.warn > 0 ? "info" : "ok",
        s.headline || "Signal integrity",
        null
      );
      meta(head, [
        ["channels", s.channels],
        ["trustworthy", s.is_trustworthy ? "yes" : "no"],
        ["clean", s.ok],
        ["suspect", s.warn],
        ["unusable", s.bad],
        ["dropouts", s.dropouts_total],
      ]);
      body.appendChild(head);

      var channels = (result.channels || []).slice().sort(function (a, b) {
        var rank = { bad: 0, warn: 1, unknown: 2, ok: 3 };
        var ra = rank[a.verdict] === undefined ? 4 : rank[a.verdict];
        var rb = rank[b.verdict] === undefined ? 4 : rank[b.verdict];
        return ra - rb;
      });
      var list = el("div", null, "v3-signal-list");
      for (var i = 0; i < channels.length; i++) {
        var c = channels[i];
        var row = el("div", null, "v3-signal-row");
        row.appendChild(el("span", c.name, "v3-signal-name"));
        row.appendChild(pill(c.verdict, c.verdict || "unknown"));
        row.appendChild(el("span", "score " + (num(c.score) || "—")));
        row.appendChild(el("span", "n=" + (num(c.n) || 0)));
        if (c.dropouts && c.dropouts.count) row.appendChild(el("span", c.dropouts.count + " dropout(s)", "v3-tag v3-tag-warn"));
        if (c.flatline && c.flatline.frozen) row.appendChild(el("span", "frozen", "v3-tag v3-tag-warn"));
        list.appendChild(row);
        if (c.evidence && c.evidence.length) {
          var ev = el("div", null, "v3-list");
          for (var e = 0; e < c.evidence.length; e++) {
            ev.appendChild(el("div", c.evidence[e], "v3-list-row"));
          }
          list.appendChild(ev);
        }
      }
      if (list.firstChild) body.appendChild(list);
    }

    run.addEventListener("click", function () {
      try {
        render();
      } catch (e) {
        clear(body);
        body.appendChild(dead("the signal check failed: " + e.message));
      }
    });
    return render;
  }

  /* ---------------- 2. drive cycles (v3.9.0) ---------------- */

  function mountDriveCycles() {
    var run = $("v4-cycle-run");
    var body = $("v4-cycle-body");
    if (!run || !body) return;

    function render() {
      var api = window.beeemuuDriveCycle;
      if (!api || typeof api.analyze !== "function") {
        return unavailable(body, "drive_cycle.js", "trip segmentation");
      }
      var series = seriesOf();
      if (!series || typeof series.forEach !== "function" || !series.size) {
        clear(body);
        return muted(body, "No log is loaded. Capture a drive or open a log, then segment it.");
      }
      var result = api.analyze(series);
      clear(body);
      var s = result.summary || {};
      if (result.reason) {
        var why = el("div", "Not segmented: " + result.reason, "v3-note v3-note-warn");
        body.appendChild(why);
      }
      var head = card(
        s.cold_warmup_concerns ? "warn" : s.n_cycles ? "ok" : "unknown",
        s.headline || "Drive cycles",
        null
      );
      meta(head, [
        ["trips", s.n_cycles],
        ["cold starts", s.cold_starts],
        ["moving", num(s.total_duration_s - s.total_idle_s) + " s"],
        ["idling", num(s.total_idle_s) + " s"],
        ["cold-start concerns", s.cold_warmup_concerns],
      ]);
      evidenceList(head, s.evidence);
      body.appendChild(head);

      var cycles = result.cycles || [];
      for (var i = 0; i < cycles.length; i++) {
        var c = cycles[i];
        var box = card(
          c.verdict,
          "Trip " + (c.index + 1) + (c.open ? " (still open)" : ""),
          null
        );
        meta(box, [
          ["duration", num(c.duration_s) + " s"],
          ["idle", num((c.idle_ratio || 0) * 100) + "%"],
          ["avg rpm", num(c.avg_rpm)],
          ["max rpm", num(c.max_rpm)],
          ["warm-up", c.cold_start ? (num(c.warm_up_s) || "n/a") + " s" : "already warm"],
          ["samples", c.n],
        ]);
        if (c.cold_start) box.appendChild(el("div", "cold start", "v3-tag v3-tag-warn"));
        evidenceList(box, c.evidence);
        body.appendChild(box);
      }
      if (!cycles.length) muted(body, "No trip could be separated from this log.");
    }

    run.addEventListener("click", function () {
      try {
        render();
      } catch (e) {
        clear(body);
        body.appendChild(dead("segmentation failed: " + e.message));
      }
    });
    return render;
  }

  /* ---------------- 3. fleet board (v4.0.0) ---------------- */

  function mountFleet() {
    var run = $("v4-fleet-run");
    var input = $("v4-fleet-input");
    var body = $("v4-fleet-body");
    if (!run || !input || !body) return;

    var saved = store(STORE.fleet);
    if (saved && typeof saved.text === "string") input.value = saved.text;
    else if (bridge() && typeof bridge().vehicleInfo === "function") {
      // Seed the field with the vehicle plugged in right now, so the board is
      // useful on first run without the user retyping what the app knows.
      var info = bridge().vehicleInfo() || {};
      var label = info.model || info.vin || "this vehicle";
      input.value = label + " | 0";
    }

    function render() {
      var api = window.beeemuuFleetDashboard;
      if (!api || typeof api.fleet !== "function") {
        return unavailable(body, "fleet_dashboard.js", "the fleet board");
      }
      store(STORE.fleet, { text: input.value });
      var parsed = parseFleet(input.value);
      clear(body);
      errorBox(body, parsed.errors);
      if (!parsed.vehicles.length) {
        return muted(body, "Add one vehicle per line as label | odometer_km | DTCs | last_service_km | last_service_date.");
      }
      var result = api.fleet(parsed.vehicles, parsed.now);
      var s = result.summary || {};
      var head = card(
        s.urgent > 0 ? "danger" : s.n_ungraded > 0 ? "warn" : "ok",
        s.headline || "Fleet",
        null
      );
      meta(head, [
        ["vehicles", s.n_vehicles],
        ["graded", s.n_graded],
        ["needs attention", s.urgent],
        ["total service spend", num(s.total_cost)],
      ]);
      body.appendChild(head);

      var vehicles = result.vehicles || [];
      for (var i = 0; i < vehicles.length; i++) {
        var v = vehicles[i];
        var verdict = FLEET_URGENT_GRADES[v.grade] ? "danger" : v.grade === "A" || v.grade === "B" ? "ok" : "warn";
        var box = card(verdict, (v.label || v.id) + " — grade " + (v.grade || "?"), null);
        meta(box, [
          ["score", v.score],
          ["open DTCs", v.open_dtcs],
          ["codes", (v.open_dtc_codes || []).join(", ") || "none"],
          ["overdue service", v.overdue_count],
          ["due soon", v.due_soon_count],
          ["service spend", num(v.cost_total)],
          ["confidence", num((v.confidence || 0) * 100) + "%"],
        ]);
        evidenceList(box, v.reasons);
        body.appendChild(box);
      }
    }

    run.addEventListener("click", function () {
      try {
        render();
      } catch (e) {
        clear(body);
        body.appendChild(dead("the fleet board failed: " + e.message));
      }
    });
    return render;
  }

  /* ---------------- 4. service provenance (v4.1.0) ---------------- */

  function mountProvenance() {
    var run = $("v4-prov-run");
    var input = $("v4-prov-input");
    var body = $("v4-prov-body");
    if (!run || !input || !body) return;

    var saved = store(STORE.provenance);
    if (saved && typeof saved.text === "string") input.value = saved.text;

    function render() {
      var api = window.beeemuuServiceProvenance;
      if (!api || typeof api.analyze !== "function") {
        return unavailable(body, "service_provenance.js", "the service history check");
      }
      store(STORE.provenance, { text: input.value });
      var parsed = parseProvenance(input.value);
      clear(body);
      errorBox(body, parsed.errors);
      if (!parsed.entries.length) {
        return muted(body, "Paste one service record per line as YYYY-MM-DD | odometer_km | cost | description.");
      }
      var result = api.analyze(parsed.entries);
      var head = card(
        result.verdict === "ok" ? "ok" : result.verdict === "unknown" ? "unknown" : "warn",
        "History verdict: " + (result.verdict || "unknown"),
        result.summary ? result.summary.headline : null
      );
      meta(head, [
        ["records", result.summary ? result.summary.n_entries : parsed.entries.length],
        ["span", result.summary ? num(result.summary.span_days) + " days" : null],
        ["mileage covered", result.summary ? num(result.summary.span_km) + " km" : null],
        ["score", result.score],
      ]);
      body.appendChild(head);

      var findings = result.findings || [];
      if (!findings.length) muted(body, "No inconsistency found in these records.");
      for (var i = 0; i < findings.length; i++) {
        var f = findings[i];
        var sev = f.severity === "high" ? "danger" : f.severity === "medium" ? "warn" : "info";
        var box = card(sev, f.kind, f.detail);
        meta(box, [["severity", f.severity], ["records", (f.indices || []).join(", ")]]);
        body.appendChild(box);
      }
    }

    run.addEventListener("click", function () {
      try {
        render();
      } catch (e) {
        clear(body);
        body.appendChild(dead("the provenance check failed: " + e.message));
      }
    });
    return render;
  }

  /* ---------------- 5. sensor cross-check (v4.2.0) ---------------- */

  function mountSensorCrossCheck() {
    var run = $("v4-sensor-run");
    var body = $("v4-sensor-body");
    if (!run || !body) return;

    function render() {
      var api = window.beeemuuSensorPlausibility;
      if (!api || typeof api.analyze !== "function") {
        return unavailable(body, "sensor_plausibility.js", "the sensor cross-check");
      }
      var series = seriesOf();
      if (!series || typeof series.forEach !== "function" || !series.size) {
        clear(body);
        return muted(body, "No log is loaded. The cross-check needs at least two related channels.");
      }
      var result = api.analyze(series);
      clear(body);
      var s = result.summary || {};
      var head = card(
        s.mismatched > 0 ? "danger" : s.inconclusive > 0 ? "warn" : "ok",
        s.headline || "Sensor cross-check",
        null
      );
      meta(head, [
        ["checks", s.n_checks],
        ["consistent", s.ok],
        ["mismatched", s.mismatched],
        ["inconclusive", s.inconclusive],
        ["not measurable", s.unknown],
      ]);
      body.appendChild(head);

      var checks = result.checks || [];
      for (var i = 0; i < checks.length; i++) {
        var c = checks[i];
        var box = card(c.verdict, c.id + (c.attribution ? " → " + c.attribution : ""), null);
        meta(box, [
          ["score", c.score],
          ["deviation", num(c.deviation, 2)],
          ["confidence", num((c.confidence || 0) * 100) + "%"],
        ]);
        evidenceList(box, c.evidence);
        body.appendChild(box);
      }
      var mismatches = result.mismatches || [];
      if (mismatches.length) {
        var list = el("div", null, "v3-list");
        list.appendChild(el("h4", "Relationships that did not hold"));
        for (var m = 0; m < mismatches.length; m++) {
          list.appendChild(el("div", mismatches[m], "v3-list-row"));
        }
        body.appendChild(list);
      }
    }

    run.addEventListener("click", function () {
      try {
        render();
      } catch (e) {
        clear(body);
        body.appendChild(dead("the cross-check failed: " + e.message));
      }
    });
    return render;
  }

  /* ---------------- 6. community opinion (v4.3.0) ---------------- */

  function mountOpinion() {
    var run = $("v4-opinion-run");
    var input = $("v4-opinion-input");
    var body = $("v4-opinion-body");
    if (!run || !input || !body) return;

    var saved = store(STORE.opinion);
    if (saved && typeof saved.text === "string") input.value = saved.text;

    function render() {
      var api = window.beeemuuOpinionConsensus;
      if (!api || typeof api.analyze !== "function") {
        return unavailable(body, "opinion_consensus.js", "the second-opinion board");
      }
      store(STORE.opinion, { text: input.value });
      var parsed = parseOpinions(input.value);
      clear(body);
      errorBox(body, parsed.errors);
      if (!parsed.opinions.length) {
        return muted(body, "Paste one opinion per line as YYYY-MM-DD | source | author | repair | confidence | mileage_km.");
      }
      var result = api.analyze(parsed.opinions);
      var con = result.consensus || {};
      var head = card(
        con.contested ? "warn" : con.winner ? "ok" : "unknown",
        con.winner ? "Most supported repair: " + con.winner : "No single repair is supported yet",
        result.summary ? result.summary.headline : null
      );
      meta(head, [
        ["opinions", result.summary ? result.summary.n_opinions : parsed.opinions.length],
        ["sources", result.summary ? result.summary.n_sources : null],
        ["quorum", OPINION_QUORUM + " opinions"],
        ["contested", con.contested ? "yes" : "no"],
        ["confidence", num((con.confidence || 0) * 100) + "%"],
      ]);
      evidenceList(head, con.evidence);
      body.appendChild(head);

      var ranking = result.ranking || [];
      if (ranking.length) {
        var list = el("div", null, "v3-list");
        list.appendChild(el("h4", "Support, weighted by source"));
        for (var i = 0; i < ranking.length; i++) {
          var r = ranking[i];
          var row = el("div", null, "v3-list-row");
          row.appendChild(el("span", r.repair_id, "v3-code"));
          row.appendChild(el("span", (r.supporters || 0) + " in favour"));
          row.appendChild(el("span", (r.dissenters || 0) + " against"));
          row.appendChild(el("span", "weight " + num(r.weighted, 2)));
          row.appendChild(el("span", (r.distinct_sources || 0) + " source(s)"));
          list.appendChild(row);
        }
        body.appendChild(list);
      }
      var dissent = result.dissent || [];
      if (dissent.length) {
        var dl = el("div", null, "v3-list");
        dl.appendChild(el("h4", "Dissenting repairs"));
        for (var d = 0; d < dissent.length; d++) {
          var dr = el("div", null, "v3-list-row");
          dr.appendChild(el("span", dissent[d].repair_id, "v3-code"));
          dr.appendChild(el("span", (dissent[d].sources || []).join(", ")));
          dl.appendChild(dr);
        }
        body.appendChild(dl);
      }
    }

    run.addEventListener("click", function () {
      try {
        render();
      } catch (e) {
        clear(body);
        body.appendChild(dead("the second-opinion board failed: " + e.message));
      }
    });
    return render;
  }

  /* ---------------- 7. plugin capabilities (v5.0.0) ---------------- */

  function mountPluginCapabilities() {
    var run = $("v4-plugin-run");
    var input = $("v4-plugin-input");
    var body = $("v4-plugin-body");
    if (!run || !input || !body) return;

    var saved = store(STORE.plugin);
    if (saved && typeof saved.text === "string") input.value = saved.text;
    else input.value = EXAMPLE_MANIFEST;

    function render() {
      var api = window.beeemuuPluginCapabilityBridge;
      if (!api || typeof api.evaluateGrants !== "function") {
        return unavailable(body, "plugin_capability_bridge.js", "capability review");
      }
      store(STORE.plugin, { text: input.value });
      clear(body);
      var manifest;
      try {
        manifest = JSON.parse(input.value);
      } catch (e) {
        return body.appendChild(dead("that is not valid JSON: " + e.message));
      }
      var check = api.validateManifest(manifest);
      if (!check.ok) {
        var bad = el("div", null, "v3-card v3-danger");
        bad.appendChild(el("div", "This manifest is not installable", "v3-card-title"));
        evidenceList(bad, check.errors);
        return body.appendChild(bad);
      }
      manifest = check.manifest;
      var grants = api.evaluateGrants(manifest, {});
      var prompt = api.consentPrompt(manifest, grants);
      var head = card(
        prompt.risk === "high" ? "danger" : prompt.risk === "elevated" ? "warn" : "ok",
        prompt.title || manifest.name || manifest.id,
        null
      );
      meta(head, [
        ["id", manifest.id],
        ["version", manifest.version],
        ["risk", prompt.risk],
        ["granted", (grants.granted || []).length],
        ["refused", (grants.refused || []).length],
      ]);
      evidenceList(head, prompt.lines);
      body.appendChild(head);

      var refused = grants.refused || [];
      if (refused.length) {
        var list = el("div", null, "v3-list");
        list.appendChild(el("h4", "Refused capabilities"));
        for (var i = 0; i < refused.length; i++) {
          var row = el("div", null, "v3-list-row");
          row.appendChild(el("span", refused[i].capability, "v3-code"));
          row.appendChild(el("span", refused[i].reason, "v3-tag v3-tag-warn"));
          list.appendChild(row);
        }
        body.appendChild(list);
      }
      var audit = api.auditLines ? api.auditLines(manifest, grants) : null;
      if (audit && audit.length) {
        var ab = el("div", null, "v3-list");
        ab.appendChild(el("h4", "Audit record"));
        for (var a = 0; a < audit.length; a++) ab.appendChild(el("div", audit[a], "v3-list-row"));
        body.appendChild(ab);
      }
    }

    run.addEventListener("click", function () {
      try {
        render();
      } catch (e) {
        clear(body);
        body.appendChild(dead("the capability review failed: " + e.message));
      }
    });
    return render;
  }

  /* ---------------- mounting ---------------- */

  /* Each mount is paired with the engine it reads, so a build that is missing
   * that engine can say so on screen at startup. A panel left silently blank
   * reads exactly like a panel that ran and found nothing wrong, and that is
   * the one reading a diagnostics screen must never produce by accident. */
  var MOUNTS = [
    [mountSignalIntegrity, "beeemuuSignalQuality"],
    [mountDriveCycles, "beeemuuDriveCycle"],
    [mountFleet, "beeemuuFleetDashboard"],
    [mountProvenance, "beeemuuServiceProvenance"],
    [mountSensorCrossCheck, "beeemuuSensorPlausibility"],
    [mountOpinion, "beeemuuOpinionConsensus"],
    [mountPluginCapabilities, "beeemuuPluginCapabilityBridge"],
  ];

  var renderers = [];

  function mountAll() {
    renderers = [];
    for (var i = 0; i < MOUNTS.length; i++) {
      try {
        var r = MOUNTS[i][0]();
        if (typeof r !== "function") continue;
        renderers.push(r);
        if (!window[MOUNTS[i][1]]) r();
      } catch (e) {
        // One broken panel must not take the others down with it.
      }
    }
    return renderers.length;
  }

  // Re-render every panel whose data source changed, so a live capture keeps the
  // v4 panels current without the user pressing each button again.
  function refreshAll() {
    for (var i = 0; i < renderers.length; i++) {
      try {
        renderers[i]();
      } catch (e) {
        /* keep going: one failing panel never blocks the others */
      }
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        mountAll();
        var b = bridge();
        if (b && typeof b.onData === "function") {
          try {
            b.onData(refreshAll);
          } catch (e) {
            /* the panels still work through their own buttons */
          }
        }
      });
    } else {
      mountAll();
    }
  }

  // The parsers are exported so the test suite can pin them: a parser that
  // quietly accepts a bad record would turn into a confident wrong verdict.
  var api = {
    mountAll: mountAll,
    refreshAll: refreshAll,
    STORE: STORE,
    VERDICT_CLASS: VERDICT_CLASS,
    PILL_KIND: PILL_KIND,
    parseFleet: parseFleet,
    parseProvenance: parseProvenance,
    parseOpinions: parseOpinions,
    isIsoDate: isIsoDate,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.beeemuuV4UI = api;
})();
