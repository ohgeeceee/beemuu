"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chartToSvg, histogramToSvg } = require("../../src/js/svg_export.js");

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

test("chartToSvg: returns empty string for null / empty / non-numeric inputs", () => {
  assert.equal(chartToSvg(null), "");
  assert.equal(chartToSvg(undefined), "");
  assert.equal(chartToSvg({ data: { datasets: [] } }), "");
  assert.equal(chartToSvg({ data: { datasets: [{ data: [{ x: "a", y: 1 }] }] } }), "");
});

test("chartToSvg: single-series produces valid SVG with expected primitives", () => {
  const chart = {
    data: {
      datasets: [
        {
          label: "RPM",
          borderColor: "#ff8800",
          data: [
            { x: 0, y: 800 },
            { x: 1, y: 1200 },
            { x: 2, y: 1500 },
          ],
        },
      ],
    },
  };
  const svg = chartToSvg(chart);
  assert.ok(svg.startsWith('<?xml version="1.0"'), "should start with XML decl");
  assert.ok(svg.includes('<svg '), "should contain <svg> root");
  assert.ok(svg.includes("</svg>"), "should close </svg>");
  assert.ok(svg.includes('fill="none" stroke="#ff8800"'), "should render the polyline in the series color");
  assert.ok(svg.includes("<polyline"), "should emit a polyline for the series");
  // Plot frame + white background
  assert.ok(svg.includes('fill="#ffffff"'), "should have white background");
  assert.ok(svg.includes('stroke="#cccccc"'), "should have plot frame border");
  // X/Y axis titles
  assert.ok(svg.includes(">seconds</text>"));
  assert.ok(svg.includes(">value</text>"));
});

test("chartToSvg: multi-series renders one polyline per series + legend", () => {
  const chart = {
    data: {
      datasets: [
        { label: "RPM", borderColor: "#ff0000", data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
        { label: "Load", borderColor: "#00ff00", data: [{ x: 0, y: 3 }, { x: 1, y: 4 }] },
      ],
    },
  };
  const svg = chartToSvg(chart);
  const polylines = svg.match(/<polyline/g) || [];
  assert.equal(polylines.length, 2, "one polyline per series");
  assert.ok(svg.includes("#ff0000"), "first series color present");
  assert.ok(svg.includes("#00ff00"), "second series color present");
  // Legend swatches (one rect per series) + labels
  assert.ok(svg.includes(">RPM</text>"));
  assert.ok(svg.includes(">Load</text>"));
});

test("chartToSvg: skips non-finite points but keeps the rest of the series", () => {
  const chart = {
    data: {
      datasets: [
        {
          label: "X",
          borderColor: "#000",
          data: [
            { x: 0, y: 1 },
            { x: 1, y: NaN },
            { x: 2, y: 3 },
            { x: 3, y: Infinity },
            { x: 4, y: 5 },
          ],
        },
      ],
    },
  };
  const svg = chartToSvg(chart);
  // 3 finite points -> 3 polyline vertices in the points attribute
  const m = svg.match(/<polyline[^>]*points="([^"]+)"/);
  assert.ok(m, "polyline points attribute present");
  const pts = m[1].split(/\s+/).filter(Boolean);
  assert.equal(pts.length, 3, "should keep only the 3 finite points");
});

test("histogramToSvg: empty counts still render a frame", () => {
  const svg = histogramToSvg({
    labels: ["a", "b", "c"],
    counts: [0, 0, 0],
  });
  assert.ok(svg.includes("<svg "));
  assert.ok(svg.includes("</svg>"));
  assert.ok(svg.includes('fill="#fafafa"'), "plot frame present");
  // Zero bars are skipped — no <rect> for bars, but the frame rect still exists.
  const bars = svg.match(/<rect[^>]*fill="#4da3ff"/g) || [];
  assert.equal(bars.length, 0, "no bars for zero counts");
});

test("histogramToSvg: single-series bars rendered with correct count", () => {
  const svg = histogramToSvg({
    labels: ["0", "1", "2", "3"],
    counts: [5, 12, 8, 3],
    axisLabel: "rpm",
  });
  const bars = svg.match(/<rect[^>]*fill="#4da3ff"/g) || [];
  assert.equal(bars.length, 4, "one rect per non-zero bin");
  assert.ok(svg.includes(">rpm</text>"), "axis label present");
  assert.ok(svg.includes(">samples</text>"), "y-axis title present");
});

test("histogramToSvg: rejects mismatched label/count arrays", () => {
  assert.equal(histogramToSvg({ labels: ["a", "b"], counts: [1] }), "");
  assert.equal(histogramToSvg({ labels: [], counts: [] }), "");
  assert.equal(histogramToSvg(null), "");
});

test("histogramToSvg: dense bin counts get thinned labels so they don't overlap", () => {
  // 50 bins -> labelStep = ceil(50/8) = 7 -> 8 labels visible (i=0,7,14,21,28,35,42,49)
  const labels = Array.from({ length: 50 }, (_, i) => `b${i}`);
  const counts = Array.from({ length: 50 }, () => 1);
  const svg = histogramToSvg({ labels, counts, axisLabel: "x" });
  // Pick out the bin labels (any <text> whose content matches ^b\d+$);
  // exclude the axis-title text ("x") and y-axis tick labels ("0", "0.2", ...).
  const textEls = svg.match(/<text[^>]*>[^<]*<\/text>/g) || [];
  const binLabels = textEls
    .map((t) => (t.match(/^<text[^>]*>([^<]*)<\/text>$/) || [])[1])
    .filter((s) => /^b\d+$/.test(s));
  assert.equal(binLabels.length, 8, "expected exactly 8 thinned bin labels");
  assert.deepEqual(
    binLabels,
    ["b0", "b7", "b14", "b21", "b28", "b35", "b42", "b49"],
    "labels should land on every 7th bin"
  );
});

test("XML special chars in labels are escaped", () => {
  const chart = {
    data: {
      datasets: [
        {
          label: "Fuel <trim> & air",
          borderColor: "#abc",
          data: [{ x: 0, y: 1 }, { x: 1, y: 2 }],
        },
      ],
    },
  };
  const svg = chartToSvg(chart);
  assert.ok(svg.includes("Fuel &lt;trim&gt; &amp; air"), "label should be XML-escaped");
  assert.ok(!svg.includes("Fuel <trim>"), "raw special chars should not appear");
});

test("SVG output dimensions and viewBox match requested opts", () => {
  const chart = {
    data: {
      datasets: [
        { label: "X", borderColor: "#000", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      ],
    },
  };
  const svg = chartToSvg(chart, { width: 1200, height: 400 });
  assert.ok(svg.includes('width="1200"'));
  assert.ok(svg.includes('height="400"'));
  assert.ok(svg.includes('viewBox="0 0 1200 400"'));
});
