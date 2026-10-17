// beemuu admin SPA — vanilla, no build step.
// The admin UI and API are served by the same Beemuu application origin.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const apiUrl = (path) => path;
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
    const opts = {
      method,
      headers: { "Accept": "application/json" },
      credentials: "same-origin",
    };
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

  let dtcEntries = [];
  let editingDtcCode = null;
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
      dtcEntries = rows;
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="muted">No DTCs match.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td><code>${escapeHtml(r.code)}</code></td>
          <td>${escapeHtml(r.category)}</td>
          <td>${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.severity || "—")}</td>
          <td>${r.enabled ? "enabled" : "disabled"}${r.verified ? " · verified" : ""}</td>
          <td>
            <button class="ghost" data-action="edit-dtc" data-code="${escapeHtml(r.code)}">Edit</button>
            ${r.enabled
              ? `<button class="danger" data-action="disable-dtc" data-code="${escapeHtml(r.code)}">Disable</button>`
              : `<button class="ghost" data-action="enable-dtc" data-code="${escapeHtml(r.code)}">Enable</button>`}
          </td>
        </tr>`).join("");
    } catch (err) {
      toast(`DTC load failed: ${err.message}`, "bad");
    }
  }

  let submissionEntries = [];
  async function loadSubmissions() {
    try {
      const status = $("#sub-status").value;
      const data = await api("GET", `/api/admin/submissions?status=${encodeURIComponent(status)}&limit=200`);
      const tbody = $("#sub-table tbody");
      const rows = data.results || [];
      submissionEntries = rows;
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
            <button class="ghost" data-action="view-sub" data-id="${r.id}">Details</button>
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

  let schematicEntries = [];
  let editingSchematicSlug = null;
  async function loadSchematics() {
    try {
      const data = await api("GET", "/api/admin/schematics?include_disabled=1");
      const tbody = $("#sch-table tbody");
      const rows = data.results || [];
      schematicEntries = rows;
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted">No schematics yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td><code>${escapeHtml(r.slug)}</code></td>
          <td>${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.series)}${r.model ? ` · ${escapeHtml(r.model)}` : ""}</td>
          <td>${escapeHtml(r.system)}</td>
          <td>${(r.linked_codes || []).map((code) => `<span class="linked-code"><code>${escapeHtml(code)}</code><button class="icon-button" aria-label="Unlink ${escapeHtml(code)}" data-action="unlink-sch" data-slug="${escapeHtml(r.slug)}" data-code="${escapeHtml(code)}">×</button></span>`).join("") || "—"}</td>
          <td>${r.enabled ? "enabled" : "disabled"}</td>
          <td>
            <button class="ghost" data-action="edit-sch" data-slug="${escapeHtml(r.slug)}">Edit</button>
            <button data-action="link-sch" data-slug="${escapeHtml(r.slug)}">Link DTC</button>
            ${r.enabled
              ? `<button class="danger" data-action="disable-sch" data-slug="${escapeHtml(r.slug)}">Disable</button>`
              : `<button class="ghost" data-action="enable-sch" data-slug="${escapeHtml(r.slug)}">Enable</button>`}
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

  $("#password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const error = $("#password-error");
    error.hidden = true;
    if (form.elements.new_password.value !== form.elements.confirm_password.value) {
      error.textContent = "The new passwords do not match.";
      error.hidden = false;
      return;
    }
    try {
      await api("POST", "/api/admin/password", {
        current_password: form.elements.current_password.value,
        new_password: form.elements.new_password.value,
      });
      form.reset();
      toast("Password changed. Sign in again with the new password.");
      setTimeout(() => location.reload(), 1400);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });

  $("#dtc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      code: editingDtcCode || fd.get("code"),
      category: fd.get("category"),
      title: fd.get("title"),
      severity: fd.get("severity") || null,
      description: fd.get("description") || null,
      likely_causes: fd.get("likely_causes") || null,
      source: fd.get("source") || "admin",
      source_url: fd.get("source_url") || null,
      confidence: fd.get("confidence"),
      verified: fd.get("confidence") === "verified",
    };
    try {
      await api("POST", "/api/admin/dtc", payload);
      toast(`${editingDtcCode ? "Updated" : "Saved"} ${payload.code.toUpperCase()}`);
      e.target.reset();
      editingDtcCode = null;
      e.target.elements.code.disabled = false;
      $("#dtc-save").textContent = "Save DTC";
      $("#dtc-cancel").hidden = true;
      loadDtc();
    } catch (err) { toast(`DTC upsert failed: ${err.message}`, "bad"); }
  });

  function editDtc(code) {
    const row = dtcEntries.find((item) => item.code === code);
    if (!row) return;
    const form = $("#dtc-form");
    for (const name of ["code", "category", "title", "severity", "description", "likely_causes", "source", "source_url", "confidence"]) {
      if (form.elements[name]) form.elements[name].value = row[name] ?? "";
    }
    form.elements.code.disabled = true;
    editingDtcCode = row.code;
    $("#dtc-save").textContent = `Update ${row.code}`;
    $("#dtc-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetDtcForm() {
    const form = $("#dtc-form");
    form.reset();
    form.elements.code.disabled = false;
    editingDtcCode = null;
    $("#dtc-save").textContent = "Save DTC";
    $("#dtc-cancel").hidden = true;
  }
  $("#dtc-cancel").addEventListener("click", resetDtcForm);

  $("#dtc-search").addEventListener("input", () => loadDtc());
  $("#dtc-category").addEventListener("change", () => loadDtc());

  $("#sub-status").addEventListener("change", () => loadSubmissions());

  $("#sch-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      slug: editingSchematicSlug || fd.get("slug"),
      title: fd.get("title"),
      series: fd.get("series"),
      system: fd.get("system"),
      file_path: fd.get("file_path"),
      mime: fd.get("mime"),
      license: fd.get("license"),
      subsys: fd.get("subsys") || null,
      model: fd.get("model") || null,
      year_from: fd.get("year_from") ? parseInt(fd.get("year_from"), 10) : null,
      year_to: fd.get("year_to") ? parseInt(fd.get("year_to"), 10) : null,
      source_url: fd.get("source_url") || null,
      tags: fd.get("tags") || null,
    };
    try {
      await api("POST", "/api/admin/schematics", payload);
      toast(`${editingSchematicSlug ? "Updated" : "Saved"} ${payload.slug}`);
      e.target.reset();
      editingSchematicSlug = null;
      e.target.elements.slug.disabled = false;
      e.target.querySelector("button[type=submit]").textContent = "Save schematic";
      $("#sch-cancel").hidden = true;
      loadSchematics();
    } catch (err) { toast(`Schematic upsert failed: ${err.message}`, "bad"); }
  });

  function editSchematic(slug) {
    const row = schematicEntries.find((item) => item.slug === slug);
    if (!row) return;
    const form = $("#sch-form");
    const values = { ...row, tags: Array.isArray(row.tags) ? row.tags.join(", ") : row.tags };
    for (const [name, value] of Object.entries(values)) {
      if (form.elements[name]) form.elements[name].value = value ?? "";
    }
    form.elements.slug.disabled = true;
    editingSchematicSlug = row.slug;
    form.querySelector("button[type=submit]").textContent = `Update ${row.slug}`;
    $("#sch-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetSchematicForm() {
    const form = $("#sch-form");
    form.reset();
    form.elements.slug.disabled = false;
    editingSchematicSlug = null;
    form.querySelector("button[type=submit]").textContent = "Save schematic";
    $("#sch-cancel").hidden = true;
  }
  $("#sch-cancel").addEventListener("click", resetSchematicForm);

  function showSubmission(id) {
    const row = submissionEntries.find((item) => String(item.id) === String(id));
    if (!row) return;
    $("#submission-title").textContent = `${row.code || "Submission"} · #${row.id}`;
    const details = $("#submission-details");
    details.replaceChildren();
    const fields = [
      ["Status", row.status],
      ["Submitted", fmtTime(row.submitted_at)],
      ["Submitter", row.submitter_handle],
      ["VIN", row.submitter_vin],
      ["Symptoms", row.symptoms],
      ["Proposed description", row.proposed_description],
      ["Reviewer note", row.reviewer_note],
    ];
    for (const [label, value] of fields) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value || "—";
      details.append(dt, dd);
    }
    $("#submission-dialog").showModal();
  }

  // -------- Delegated clicks for table actions --------
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    try {
      if (action === "disable-dtc") {
        if (!confirm(`Disable ${t.dataset.code}? This hides it from the public catalog but preserves its record.`)) return;
        await api("DELETE", `/api/admin/dtc/${encodeURIComponent(t.dataset.code)}`);
        toast(`Disabled ${t.dataset.code}`);
        loadDtc();
      } else if (action === "enable-dtc") {
        await api("DELETE", `/api/admin/dtc/${encodeURIComponent(t.dataset.code)}/enable`);
        toast(`Enabled ${t.dataset.code}`);
        loadDtc();
      } else if (action === "edit-dtc") {
        editDtc(t.dataset.code);
      } else if (action === "approve-sub") {
        await api("POST", "/api/admin/submissions/review", { id: parseInt(t.dataset.id, 10), status: "approved" });
        toast(`Approved submission ${t.dataset.id}`);
        loadSubmissions();
      } else if (action === "reject-sub") {
        const note = prompt("Reviewer note (optional):") || null;
        await api("POST", "/api/admin/submissions/review", { id: parseInt(t.dataset.id, 10), status: "rejected", note });
        toast(`Rejected submission ${t.dataset.id}`);
        loadSubmissions();
      } else if (action === "view-sub") {
        showSubmission(t.dataset.id);
      } else if (action === "link-sch") {
        const code = prompt("DTC code to link (e.g. P0171):");
        if (!code) return;
        await api("POST", "/api/admin/schematic-links", { slug: t.dataset.slug, code: code.toUpperCase() });
        toast(`Linked ${code.toUpperCase()} ↔ ${t.dataset.slug}`);
        loadSchematics();
      } else if (action === "unlink-sch") {
        if (!confirm(`Remove the ${t.dataset.code} link from ${t.dataset.slug}?`)) return;
        await api("DELETE", `/api/admin/schematic-links?slug=${encodeURIComponent(t.dataset.slug)}&code=${encodeURIComponent(t.dataset.code)}`);
        toast(`Unlinked ${t.dataset.code}`);
        loadSchematics();
      } else if (action === "edit-sch") {
        editSchematic(t.dataset.slug);
      } else if (action === "disable-sch" || action === "enable-sch") {
        const enable = action === "enable-sch";
        if (!enable && !confirm(`Disable ${t.dataset.slug}? It will no longer appear in the public catalog.`)) return;
        const suffix = enable ? "/enable" : "/disable";
        await api("DELETE", `/api/admin/schematics/${encodeURIComponent(t.dataset.slug)}${suffix}`);
        toast(`${enable ? "Enabled" : "Disabled"} ${t.dataset.slug}`);
        loadSchematics();
      }
    } catch (err) {
      toast(`${action} failed: ${err.message}`, "bad");
    }
  });

  // -------- Boot --------
  (async function boot() {
    try {
      const health = await fetch("/api/health", {
        headers: { "Accept": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!health.ok) throw new Error(`HTTP ${health.status}`);
    } catch {
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
