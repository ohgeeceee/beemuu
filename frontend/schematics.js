// schematics.js — viewer for the schematics catalog.
// Depends on svg-pan-zoom (vendored at /vendor/svg-pan-zoom.min.js).
// Talks to:
//   GET /api/schematics?series=&system=&q=&limit=
//   GET /api/schematics/<slug>

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const VIEW_LIST = "list";
  const VIEW_DETAIL = "detail";

  const state = {
    view: VIEW_LIST,
    filters: { series: "", system: "", q: "" },
    activeSlug: null,
    panZoom: null,
  };

  /* ---------------- routing (hash-based, no server config needed) ---------------- */
  function parseRoute() {
    const hash = window.location.hash || "#/";
    const detail = hash.match(/^#\/s\/(.+)$/);
    if (detail) {
      state.view = VIEW_DETAIL;
      state.activeSlug = decodeURIComponent(detail[1]);
    } else {
      state.view = VIEW_LIST;
      state.activeSlug = null;
    }
  }
  function navigate(hash) {
    if (window.location.hash === hash) {
      render();
    } else {
      window.location.hash = hash;
    }
  }
  window.addEventListener("hashchange", render);

  /* ---------------- API ---------------- */
  async function apiList(params) {
    const qs = new URLSearchParams();
    if (params.series) qs.set("series", params.series);
    if (params.system) qs.set("system", params.system);
    if (params.q) qs.set("q", params.q);
    qs.set("limit", "200");
    const res = await fetch("/api/schematics?" + qs.toString(), {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("list HTTP " + res.status);
    return (await res.json()).results || [];
  }
  async function apiOne(slug) {
    const res = await fetch(
      "/api/schematics/" + encodeURIComponent(slug),
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error("detail HTTP " + res.status);
    return res.json();
  }

  /* ---------------- list view ---------------- */
  function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort();
  }

  function renderFilters(items) {
    const seriesSel = $("filter-series");
    const systemSel = $("filter-system");
    const series = uniqueSorted(items.map((it) => it.series));
    const systems = uniqueSorted(items.map((it) => it.system));
    fillSelect(seriesSel, series, state.filters.series);
    fillSelect(systemSel, systems, state.filters.system);
  }

  function fillSelect(sel, values, current) {
    const cur = current || "";
    sel.innerHTML = '<option value="">all</option>' +
      values.map((v) =>
        '<option value="' + escapeAttr(v) + '"' +
        (v === cur ? ' selected' : '') +
        '>' + escapeText(v) + '</option>'
      ).join("");
  }

  function applyFilters(items) {
    const series = state.filters.series;
    const system = state.filters.system;
    const ql = (state.filters.q || "").toLowerCase();
    return items.filter((it) => {
      if (series && it.series !== series) return false;
      if (system && it.system !== system) return false;
      if (ql) {
        const hay = (it.title + " " + (it.tags || []).join(" ")).toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }

  function renderList(items) {
    const grid = $("grid");
    if (!items.length) {
      grid.innerHTML = '<p class="sch-empty">No schematics match your filters.</p>';
      return;
    }
    grid.innerHTML = items.map(cardHtml).join("");
    grid.querySelectorAll("[data-slug]").forEach((el) => {
      el.addEventListener("click", () => {
        navigate("#/s/" + encodeURIComponent(el.getAttribute("data-slug")));
      });
    });
  }

  function cardHtml(item) {
    const tags = (item.tags || []).slice(0, 5).map((t) =>
      '<span class="tag">' + escapeText(t) + '</span>'
    ).join("");
    const years = item.year_from && item.year_to
      ? item.year_from + "–" + item.year_to
      : (item.year_from || "");
    const meta = [item.series, item.system, years].filter(Boolean).join(" · ");
    return (
      '<button class="sch-card" type="button" data-slug="' +
      escapeAttr(item.slug) + '">' +
      '<p class="title">' + escapeText(item.title) + '</p>' +
      '<p class="meta">' + escapeText(meta) + '</p>' +
      '<div class="tags">' + tags + '</div>' +
      '</button>'
    );
  }

  /* ---------------- detail view ---------------- */
  async function renderDetail(slug) {
    showView("view-detail");
    $("detail-title").textContent = "Loading…";
    $("stage").innerHTML = '<div class="sch-stage-placeholder">Loading…</div>';
    destroyPanZoom();
    let item;
    try {
      item = await apiOne(slug);
    } catch (err) {
      showStageError("Could not load schematic: " + err.message);
      return;
    }
    $("detail-title").textContent = item.title || item.slug;
    $("detail-link").setAttribute("href", item.url);
    renderMeta(item);
    try {
      await loadSvgIntoStage(item.url);
    } catch (err) {
      showStageError("Could not load SVG: " + err.message);
    }
  }

  function renderMeta(item) {
    const tagsHtml = (item.tags && item.tags.length)
      ? '<span class="tags-pills">' +
        item.tags.map((t) =>
          '<span class="pill">' + escapeText(t) + '</span>'
        ).join("") +
        '</span>'
      : "";
    const dims = item.width_px
      ? item.width_px + "×" + (item.height_px || "?") + " px"
      : "";
    const sourceHtml = item.source_url
      ? '<a class="sch-link" href="' + escapeAttr(item.source_url) +
        '" target="_blank" rel="noopener">' +
        escapeText(item.source_url) + '</a>'
      : "";
    const rows = [
      ["Slug", escapeText(item.slug)],
      ["Series", escapeText(item.series)],
      ["System", escapeText(item.system)],
      ["Subsystem", escapeText(item.subsys || "")],
      ["Model", escapeText(item.model || "")],
      ["Years", escapeText(
        (item.year_from || "") +
        (item.year_to ? "–" + item.year_to : "")
      )],
      ["MIME", escapeText(item.mime)],
      ["Dimensions", escapeText(dims)],
      ["License", escapeText(item.license)],
      ["Tags", tagsHtml],
      ["Source", sourceHtml],
    ];
    $("detail-meta").innerHTML = rows
      .filter(([, v]) => v !== "" && v !== null && v !== undefined)
      .map(([k, v]) => "<dt>" + escapeText(k) + "</dt><dd>" + v + "</dd>")
      .join("");
  }

  async function loadSvgIntoStage(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    const text = await res.text();
    if (!/<svg[\s>]/i.test(text)) {
      throw new Error("response is not an SVG document");
    }
    const stage = $("stage");
    stage.innerHTML = text;
    const svg = stage.querySelector("svg");
    if (!svg) throw new Error("no <svg> element in document");
    // svg-pan-zoom needs the svg to be sized; the SVG declares viewBox so
    // a 100% fill is fine. Strip explicit width/height so it scales.
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = "100%";
    svg.style.height = "100%";
    try {
      state.panZoom = svgPanZoom(svg, {
        zoomEnabled: true,
        controlIconsEnabled: true,
        fit: true,
        center: true,
        minZoom: 0.2,
        maxZoom: 20,
        zoomScaleSensitivity: 0.3,
        dblClickZoomEnabled: true,
        mouseWheelZoomEnabled: true,
      });
    } catch (err) {
      showStageError("Pan/zoom unavailable: " + err.message);
      return;
    }
    stage.addEventListener("keydown", onStageKey);
    stage.focus();
  }

  function destroyPanZoom() {
    if (state.panZoom && typeof state.panZoom.destroy === "function") {
      try { state.panZoom.destroy(); } catch (_) {}
    }
    state.panZoom = null;
    const stage = $("stage");
    if (stage) stage.removeEventListener("keydown", onStageKey);
  }

  function onStageKey(e) {
    if (!state.panZoom) return;
    const pz = state.panZoom;
    const pan = 60;
    switch (e.key) {
      case "ArrowUp":    pz.panBy({ x: 0, y: pan }); e.preventDefault(); break;
      case "ArrowDown":  pz.panBy({ x: 0, y: -pan }); e.preventDefault(); break;
      case "ArrowLeft":  pz.panBy({ x: pan, y: 0 }); e.preventDefault(); break;
      case "ArrowRight": pz.panBy({ x: -pan, y: 0 }); e.preventDefault(); break;
      case "+": case "=": pz.zoomIn(); e.preventDefault(); break;
      case "-": case "_": pz.zoomOut(); e.preventDefault(); break;
      case "0":          pz.reset(); e.preventDefault(); break;
      case "f": case "F": pz.fit(); pz.center(); e.preventDefault(); break;
    }
  }

  function showStageError(msg) {
    $("stage").innerHTML = '<div class="sch-stage-placeholder sch-error">' +
      escapeText(msg) + '</div>';
  }

  /* ---------------- view switching ---------------- */
  function showView(id) {
    $("view-list").classList.toggle("hidden", id !== "view-list");
    $("view-detail").classList.toggle("hidden", id !== "view-detail");
  }

  async function render() {
    parseRoute();
    if (state.view === VIEW_DETAIL) {
      showView("view-detail");
      await renderDetail(state.activeSlug);
      return;
    }
    destroyPanZoom();
    showView("view-list");
    await refreshList();
  }

  /* ---------------- list refresh ---------------- */
  let _listCache = null;
  async function refreshList(force) {
    if (force) _listCache = null;
    if (!_listCache) {
      $("grid").innerHTML = '<p class="sch-empty">Loading…</p>';
      try {
        _listCache = await apiList({});
      } catch (err) {
        $("grid").innerHTML = '<p class="sch-error">Could not load schematic list: ' +
          escapeText(err.message) + '</p>';
        return;
      }
    }
    renderFilters(_listCache);
    renderList(applyFilters(_listCache));
  }

  /* ---------------- helpers ---------------- */
  function escapeText(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeText(s).replace(/"/g, "&quot;");
  }

  /* ---------------- wire-up ---------------- */
  document.addEventListener("DOMContentLoaded", () => {
    $("filter-series").addEventListener("change", (e) => {
      state.filters.series = e.target.value;
      renderList(applyFilters(_listCache || []));
    });
    $("filter-system").addEventListener("change", (e) => {
      state.filters.system = e.target.value;
      renderList(applyFilters(_listCache || []));
    });
    let qTimer = null;
    $("filter-q").addEventListener("input", (e) => {
      const v = e.target.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        state.filters.q = v;
        renderList(applyFilters(_listCache || []));
      }, 120);
    });
    $("btn-refresh").addEventListener("click", () => refreshList(true));
    $("btn-back").addEventListener("click", () => navigate("#/"));
    render();
  });
})();
