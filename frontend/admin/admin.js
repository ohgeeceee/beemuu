// beemuu admin SPA — vanilla, no build step.
// API origin is configured by /site-config.js so the static UI can live on
// GitHub Pages while the admin API moves off the VPS.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const config = {
    adminApiBaseUrl: "",
    ...((typeof window !== "undefined" && window.BEEMUU_CONFIG) || {}),
  };
  const adminApiBaseUrl = String(config.adminApiBaseUrl || "").replace(/\/+$/, "");
  const apiUrl = (path) => adminApiBaseUrl
    ? adminApiBaseUrl + "/" + String(path).replace(/^\/+/, "")
    : path;
  const fmtTime = (epoch) => {
    if (!epoch) return "—";
    const d = new Date(epoch * 1000);
    return d.toISOString().replace("T", " ").slice(0, 19);
  };
  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  // -------- HTTP helpers --------
  async function api(method, path, body) {
    const opts = { method, headers: { "Accept": "application/json" } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(apiUrl(path), opts);
    } catch (err) {
      throw new Error(`network error: ${err.message}`);
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { error: text }; }
    }
    if (!res.ok) {
      const msg = (data && data.error) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  // -------- Toast --------
  let toastTimer = null;
  function toast(msg, kind = "ok") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast ${kind}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // -------- Auth gate --------
  async function whoami() {
    try {
      const me = await api("GET", "/api/admin/whoami");
      return me;
    } catch (err) {
      return null;
    }
  }

  async function login(username, password) {
    return api("POST", "/api/admin/login", { username, password });
  }

  async function logout() {
    try {
      await api("POST", "/api/admin/logout");
    } catch (err) { /* swallow */ }
    location.reload();
  }

  function showLogin() {
    $("#login-screen").hidden = false;
    $("#offline-screen").hidden = true;
    $("#app-screen").hidden = true;
    setTimeout(() => $("input[name=username]").focus(), 50);
  }
  function showOffline() {
    $("#login-screen").hidden = true;
    $("#offline-screen").hidden = false;
    $("#app-screen").hidden = true;
  }
  function showApp(me) {
    $("#login-screen").hidden = true;
    $("#offline-screen").hidden = true;
    $("#app-screen").hidden = false;
    $("#who-name").textContent = me.username || `id=${me.id}`;
  }

  // -------- Tabs --------
  function activateTab(name) {
    $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $$("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
    if (loaders[name]) loaders[name]();
  }
  $$(".tab").forEach((btn) =>
    btn.addEventListener("click", () => activateTab(btn.dataset.tab)));

  // -------- Loaders per tab --------
  const loaders = {
    overview: loadOverview,
    dtc: loadDtc,
    submissions: loadSubmissions,
    schematics: loadSchematics,
    sessions: loadSessions,
    audit: loadAudit,
  };

  async function loadOverview() {
    try {
      const data = await api("GET", "/api/admin/dashboard");
      const c = data.counts || {};
      $("#count-dtc").textContent = c.dtc ?? "0";
      $("#count-dtc-enabled").textContent = c.dtc_enabled ?? "0";
      $("#count-submissions").textContent = `${c.dtc_submissions_pending ?? 0} / ${c.dtc_submissions ?? 0}`;
      $("#count-schematics").textContent = c.schematics ?? "0";
      $("#count-links").textContent = c.schematic_links ?? "0";
      $("#count-sessions").textContent = c.diag_sessions ?? "0";
      $("#count-audit").textContent = c.audit_log ?? "0";
      const list = $("#recent-activity");
      const rows = data.recent_audit || [];
      if (!rows.length) { list.innerHTML = `<li class="muted">No activity yet.</li>`; return; }
      list.innerHTML = rows.map(renderAuditRow).join("");
    } catch (err) {
      toast(`Overview failed: ${err.message}`, "bad");
    }
  }

  function renderAuditRow(r) {
    return `<li>
      <span class="when">${escapeHtml(fmtTime(r.at))}</span>
      <span class="admin">${escapeHtml(r.username || "—")}</span>
      <span class="action">${escapeHtml(r.action)}</span>
      <span class="target">${escapeHtml(r.target || "")}</span>
    </li>`;
  }

  async function loadDtc() {
    try {
      const q = $("#dtc-search").value.trim();
      const category = $("#dtc-category").value;
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      params.set("limit", "200");
      const data = await api("GET", `/api/admin/dtc?${params}`);
      const tbody = $("#dtc-table tbody");
      const rows = data.results || [];
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="muted">No DTCs match.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td><code>${escapeHtml(r.code)}</code></td>
          <td>${escapeHtml(r.category)}</td>
          <td>${escapeHtml(r.title)}</td>
          <td>${r.enabled ? "enabled" : "disabled"}${r.verified ? " · verified" : ""}</td>
          <td>
            ${r.enabled
              ? `<button class="danger" data-action="disable-dtc" data-code="${escapeHtml(r.code)}">Disable</button>`
              : `<button class="ghost" data-action="enable-dtc" data-code="${escapeHtml(r.code)}">Enable</button>`}
          </td>
        </tr>`).join("");
    } catch (err) {
      toast(`DTC load failed: ${err.message}`, "bad");
    }
  }

  async function loadSubmissions() {
    try {
      const status = $("#sub-status").value;
      const data = await api("GET", `/api/admin/submissions?status=${encodeURIComponent(status)}&limit=200`);
      const tbody = $("#sub-table tbody");
      const rows = data.results || [];
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted">No submissions.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.id)}</td>
          <td><code>${escapeHtml(r.code)}</code></td>
          <td>${escapeHtml(r.submitter_handle || "—")}</td>
          <td>${escapeHtml((r.symptoms || "").slice(0, 80))}</td>
          <td>${escapeHtml(fmtTime(r.submitted_at))}</td>
          <td>${escapeHtml(r.status)}</td>
          <td>
            ${r.status === "pending" ? `
              <button data-action="approve-sub" data-id="${r.id}">Approve</button>
              <button class="danger" data-action="reject-sub" data-id="${r.id}">Reject</button>
            ` : `<span class="muted">${escapeHtml(r.reviewer_note || "")}</span>`}
          </td>
        </tr>`).join("");
    } catch (err) {
      toast(`Submissions load failed: ${err.message}`, "bad");
    }
  }

  async function loadSchematics() {
    try {
      const data = await api("GET", "/api/admin/schematics?include_disabled=1");
      const tbody = $("#sch-table tbody");
      const rows = data.results || [];
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="muted">No schematics yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td><code>${escapeHtml(r.slug)}</code></td>
          <td>${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.series)}</td>
          <td>${escapeHtml(r.system)}</td>
          <td>${escapeHtml(r.license)}</td>
          <td>
            <button data-action="link-sch" data-slug="${escapeHtml(r.slug)}">Link DTC</button>
          </td>
        </tr>`).join("");
    } catch (err) {
      toast(`Schematics load failed: ${err.message}`, "bad");
    }
  }

  async function loadSessions() {
    try {
      const data = await api("GET", "/api/admin/sessions?limit=100");
      const tbody = $("#session-table tbody");
      const rows = data.results || [];
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted">No diag sessions yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => {
        const codes = Array.isArray(r.dtc_codes) ? r.dtc_codes.join(", ") : (r.dtc_codes || "");
        return `
        <tr>
          <td>${escapeHtml(r.id)}</td>
          <td>${escapeHtml(fmtTime(r.submitted_at))}</td>
          <td>${escapeHtml((r.client_id || "—") + " " + (r.client_version || ""))}</td>
          <td>${escapeHtml(r.vin || "—")}</td>
          <td>${escapeHtml(r.profile || "—")}</td>
          <td>${escapeHtml(r.transport || "—")}</td>
          <td><code>${escapeHtml(codes)}</code></td>
        </tr>`;
      }).join("");
    } catch (err) {
      toast(`Sessions load failed: ${err.message}`, "bad");
    }
  }

  async function loadAudit() {
    try {
      const data = await api("GET", "/api/admin/audit?limit=200");
      const list = $("#audit-list");
      const rows = data.results || [];
      if (!rows.length) { list.innerHTML = `<li class="muted">No audit events yet.</li>`; return; }
      list.innerHTML = rows.map(renderAuditRow).join("");
    } catch (err) {
      toast(`Audit load failed: ${err.message}`, "bad");
    }
  }

  // -------- Form handlers --------
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $("#login-error");
    errEl.hidden = true;
    try {
      await login(fd.get("username"), fd.get("password"));
      const me = await whoami();
      if (me) showApp(me);
      else { errEl.textContent = "login succeeded but session not found"; errEl.hidden = false; }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $("#logout-link").addEventListener("click", async (e) => {
    e.preventDefault(); await logout();
  });

  $("#dtc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      code: fd.get("code"),
      category: fd.get("category"),
      title: fd.get("title"),
    };
    try {
      await api("POST", "/api/admin/dtc", payload);
      toast(`Upserted ${payload.code.toUpperCase()}`);
      e.target.reset();
      loadDtc();
    } catch (err) { toast(`DTC upsert failed: ${err.message}`, "bad"); }
  });

  $("#dtc-search").addEventListener("input", () => loadDtc());
  $("#dtc-category").addEventListener("change", () => loadDtc());

  $("#sub-status").addEventListener("change", () => loadSubmissions());

  $("#sch-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      slug: fd.get("slug"),
      title: fd.get("title"),
      series: fd.get("series"),
      system: fd.get("system"),
      file_path: fd.get("file_path"),
      mime: fd.get("mime"),
      license: fd.get("license"),
    };
    try {
      await api("POST", "/api/admin/schematics", payload);
      toast(`Upserted ${payload.slug}`);
      e.target.reset();
      loadSchematics();
    } catch (err) { toast(`Schematic upsert failed: ${err.message}`, "bad"); }
  });

  // -------- Delegated clicks for table actions --------
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    try {
      if (action === "disable-dtc") {
        await api("DELETE", `/api/admin/dtc/${encodeURIComponent(t.dataset.code)}`);
        toast(`Disabled ${t.dataset.code}`);
        loadDtc();
      } else if (action === "enable-dtc") {
        await api("DELETE", `/api/admin/dtc/${encodeURIComponent(t.dataset.code)}/enable`);
        toast(`Enabled ${t.dataset.code}`);
        loadDtc();
      } else if (action === "approve-sub") {
        await api("POST", "/api/admin/submissions/review", { id: parseInt(t.dataset.id, 10), status: "approved" });
        toast(`Approved submission ${t.dataset.id}`);
        loadSubmissions();
      } else if (action === "reject-sub") {
        const note = prompt("Reviewer note (optional):") || null;
        await api("POST", "/api/admin/submissions/review", { id: parseInt(t.dataset.id, 10), status: "rejected", note });
        toast(`Rejected submission ${t.dataset.id}`);
        loadSubmissions();
      } else if (action === "link-sch") {
        const code = prompt("DTC code to link (e.g. P0171):");
        if (!code) return;
        await api("POST", "/api/admin/schematic-links", { slug: t.dataset.slug, code: code.toUpperCase() });
        toast(`Linked ${code.toUpperCase()} ↔ ${t.dataset.slug}`);
      }
    } catch (err) {
      toast(`${action} failed: ${err.message}`, "bad");
    }
  });

  // -------- Boot --------
  (async function boot() {
    if (!adminApiBaseUrl) {
      showOffline();
      return;
    }
    const me = await whoami();
    if (me) {
      showApp(me);
      activateTab("overview");
    } else {
      showLogin();
    }
  })();
})();
