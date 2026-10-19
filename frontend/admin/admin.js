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

  function friendlyError(err) {
    const message = String(err?.message || "");
    if (/network error|failed to fetch|load failed/i.test(message)) {
      return "Could not reach Beemuu. Your changes are still here; check the connection and try again.";
    }
    if (/^HTTP \d+/.test(message)) {
      return "Beemuu could not complete that request. Your changes are still here; please try again.";
    }
    return message || "Beemuu could not complete that request. Your changes are still here; please try again.";
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
    $$(".tab").forEach((b) => {
      const selected = b.dataset.tab === name;
      b.classList.toggle("active", selected);
      b.setAttribute("aria-selected", String(selected));
      b.tabIndex = selected ? 0 : -1;
    });
    $$("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
    if (loaders[name]) loaders[name]();
  }
  $$(".tab").forEach((btn, index, tabs) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
    btn.addEventListener("keydown", (event) => {
      const current = tabs.indexOf(btn);
      let next = current;
      if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next].focus();
      activateTab(tabs[next].dataset.tab);
    });
  });

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
      toast(`Overview could not load. ${friendlyError(err)}`, "bad");
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
  const dtcPageSize = 50;
  let dtcOffset = 0;
  let dtcRequestId = 0;
  async function loadDtc() {
    const requestId = ++dtcRequestId;
    try {
      const q = $("#dtc-search").value.trim();
      const category = $("#dtc-category").value;
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      params.set("limit", String(dtcPageSize));
      params.set("offset", String(dtcOffset));
      const data = await api("GET", `/api/admin/dtc?${params}`);
      if (requestId !== dtcRequestId) return;
      const tbody = $("#dtc-table tbody");
      const rows = data.results || [];
      dtcEntries = rows;
      const total = Number(data.total ?? rows.length);
      const page = Math.floor(dtcOffset / dtcPageSize) + 1;
      const pageCount = Math.max(1, Math.ceil(total / dtcPageSize));
      $("#dtc-results-summary").textContent = total
        ? `Showing ${dtcOffset + 1}–${Math.min(dtcOffset + rows.length, total)} of ${total} DTCs`
        : "No DTCs found";
      $("#dtc-page-label").textContent = `Page ${page} of ${pageCount}`;
      $("#dtc-prev").disabled = dtcOffset === 0;
      $("#dtc-next").disabled = dtcOffset + dtcPageSize >= total;
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
      if (requestId === dtcRequestId) toast(friendlyError(err), "bad");
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
            ${r.status === "pending"
              ? `<button data-action="view-sub" data-id="${r.id}">Review</button>`
              : `<button class="ghost" data-action="view-sub" data-id="${r.id}">Details</button>
                 <button class="ghost" data-action="reopen-sub" data-id="${r.id}">Return to queue</button>`}
          </td>
        </tr>`).join("");
    } catch (err) {
      toast(`Submissions could not load. ${friendlyError(err)}`, "bad");
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
      toast(`Schematics could not load. ${friendlyError(err)}`, "bad");
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
      toast(`Diagnostic sessions could not load. ${friendlyError(err)}`, "bad");
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
      toast(`Audit log could not load. ${friendlyError(err)}`, "bad");
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
      errEl.textContent = friendlyError(err);
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
      error.textContent = friendlyError(err);
      error.hidden = false;
    }
  });

  $("#dtc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = $("#dtc-error");
    const save = $("#dtc-save");
    error.hidden = true;
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
      verified: fd.has("verified"),
      enabled: fd.has("enabled"),
    };
    save.disabled = true;
    save.textContent = editingDtcCode ? "Saving changes…" : "Saving…";
    try {
      await api("POST", "/api/admin/dtc", payload);
      toast(`${editingDtcCode ? "Updated" : "Saved"} ${payload.code.toUpperCase()}`);
      resetDtcForm();
      $("#dtc-editor").open = false;
      dtcOffset = 0;
      await loadDtc();
    } catch (err) { error.textContent = friendlyError(err); error.hidden = false; }
    finally {
      save.disabled = false;
      save.textContent = editingDtcCode ? `Update ${editingDtcCode}` : "Save DTC";
    }
  });

  function editDtc(code) {
    const row = dtcEntries.find((item) => item.code === code);
    if (!row) return;
    const form = $("#dtc-form");
    for (const name of ["code", "category", "title", "severity", "description", "likely_causes", "source", "source_url", "confidence"]) {
      if (form.elements[name]) form.elements[name].value = row[name] ?? "";
    }
    form.elements.verified.checked = Boolean(row.verified);
    form.elements.enabled.checked = Boolean(row.enabled);
    form.elements.code.disabled = true;
    editingDtcCode = row.code;
    $("#dtc-save").textContent = `Update ${row.code}`;
    $("#dtc-editor-summary").textContent = `Editing ${row.code}`;
    $("#dtc-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetDtcForm() {
    const form = $("#dtc-form");
    form.reset();
    form.elements.code.disabled = false;
    editingDtcCode = null;
    $("#dtc-save").textContent = "Save DTC";
    $("#dtc-editor-summary").textContent = "Add a DTC";
    $("#dtc-error").hidden = true;
    $("#dtc-cancel").hidden = true;
  }
  $("#dtc-cancel").addEventListener("click", resetDtcForm);

  let dtcSearchTimer = null;
  $("#dtc-search").addEventListener("input", () => {
    clearTimeout(dtcSearchTimer);
    dtcSearchTimer = setTimeout(() => { dtcOffset = 0; loadDtc(); }, 250);
  });
  $("#dtc-category").addEventListener("change", () => { dtcOffset = 0; loadDtc(); });
  $("#dtc-prev").addEventListener("click", () => {
    dtcOffset = Math.max(0, dtcOffset - dtcPageSize); loadDtc();
  });
  $("#dtc-next").addEventListener("click", () => { dtcOffset += dtcPageSize; loadDtc(); });

  $("#sub-status").addEventListener("change", () => loadSubmissions());

  $("#sch-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = $("#sch-error");
    const save = e.target.querySelector("button[type=submit]");
    error.hidden = true;
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
      width_px: fd.get("width_px") ? parseInt(fd.get("width_px"), 10) : null,
      height_px: fd.get("height_px") ? parseInt(fd.get("height_px"), 10) : null,
      source_url: fd.get("source_url") || null,
      tags: fd.get("tags") || null,
    };
    save.disabled = true;
    save.textContent = editingSchematicSlug ? "Saving changes…" : "Saving…";
    try {
      await api("POST", "/api/admin/schematics", payload);
      toast(`${editingSchematicSlug ? "Updated" : "Saved"} ${payload.slug}`);
      e.target.reset();
      editingSchematicSlug = null;
      e.target.elements.slug.disabled = false;
      e.target.querySelector("button[type=submit]").textContent = "Save schematic";
      $("#sch-cancel").hidden = true;
      $("#sch-editor-summary").textContent = "Add a schematic";
      $("#sch-editor").open = false;
      await loadSchematics();
    } catch (err) { error.textContent = friendlyError(err); error.hidden = false; }
    finally {
      save.disabled = false;
      save.textContent = editingSchematicSlug ? `Update ${editingSchematicSlug}` : "Save schematic";
    }
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
    $("#sch-editor-summary").textContent = `Editing ${row.slug}`;
    $("#sch-editor").open = true;
    $(".metadata-details", form).open = true;
    $("#sch-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetSchematicForm() {
    const form = $("#sch-form");
    form.reset();
    form.elements.slug.disabled = false;
    editingSchematicSlug = null;
    form.querySelector("button[type=submit]").textContent = "Save schematic";
    $("#sch-editor-summary").textContent = "Add a schematic";
    $("#sch-error").hidden = true;
    $("#sch-cancel").hidden = true;
  }
  $("#sch-cancel").addEventListener("click", resetSchematicForm);

  let activeSubmissionId = null;
  function showSubmission(id) {
    const row = submissionEntries.find((item) => String(item.id) === String(id));
    if (!row) return;
    activeSubmissionId = row.id;
    $("#submission-title").textContent = `${row.code || "Submission"} · #${row.id}`;
    $("#review-note").value = row.reviewer_note || "";
    $("#review-error").hidden = true;
    $("#review-approve").hidden = row.status !== "pending";
    $("#review-reject").hidden = row.status !== "pending";
    $("#review-reopen").hidden = row.status === "pending";
    $("#review-note").disabled = row.status !== "pending";
    const details = $("#submission-details");
    details.replaceChildren();
    const fields = [
      ["Status", row.status], ["Submitted", fmtTime(row.submitted_at)],
      ["Submitter", row.submitter_handle], ["VIN", row.submitter_vin],
      ["Symptoms", row.symptoms], ["Proposed description", row.proposed_description],
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

  // -------- In-app recoverable actions --------
  let actionConfig = null;
  const actionDialog = $("#action-dialog");
  function askAction(config) {
    actionConfig = config;
    $("#action-title").textContent = config.title;
    $("#action-description").textContent = config.description;
    $("#action-error").hidden = true;
    $("#action-input-label").hidden = !config.inputLabel;
    $("#action-input-label span").textContent = config.inputLabel || "";
    $("#action-input").value = "";
    $("#action-input").placeholder = config.placeholder || "";
    $("#action-input").required = Boolean(config.inputLabel);
    const submit = $("#action-submit");
    submit.textContent = config.submitLabel || "Continue";
    submit.classList.toggle("danger", Boolean(config.danger));
    actionDialog.showModal();
    if (config.inputLabel) $("#action-input").focus();
  }

  async function setSubmissionStatus(status) {
    const error = $("#review-error");
    error.hidden = true;
    const buttons = [$("#review-approve"), $("#review-reject"), $("#review-reopen")];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await api("POST", "/api/admin/submissions/review", {
        id: Number(activeSubmissionId), status,
        note: status === "pending" ? null : ($("#review-note").value.trim() || null),
      });
      $("#submission-dialog").close();
      toast(status === "pending" ? "Submission returned to the review queue." : `Submission ${status}.`);
      await loadSubmissions();
    } catch (err) {
      error.textContent = friendlyError(err);
      error.hidden = false;
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }
  $("#review-approve").addEventListener("click", () => setSubmissionStatus("approved"));
  $("#review-reject").addEventListener("click", () => setSubmissionStatus("rejected"));
  $("#review-reopen").addEventListener("click", () => setSubmissionStatus("pending"));
  $("#review-form").addEventListener("submit", (event) => event.preventDefault());

  $("#action-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!actionConfig) return;
    const submit = $("#action-submit");
    const error = $("#action-error");
    submit.disabled = true;
    error.hidden = true;
    try {
      await actionConfig.run($("#action-input").value.trim());
      actionDialog.close();
      actionConfig = null;
    } catch (err) {
      error.textContent = friendlyError(err);
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => {
    button.closest("dialog").close();
  }));

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    try {
      if (action === "disable-dtc") {
        askAction({
          title: `Disable ${t.dataset.code}?`,
          description: "This removes the code from the public catalog and preserves its record and history.",
          submitLabel: "Disable code", danger: true,
          run: async () => {
            await api("DELETE", `/api/admin/dtc/${encodeURIComponent(t.dataset.code)}`);
            toast(`Disabled ${t.dataset.code}`);
            await loadDtc();
          },
        });
      } else if (action === "enable-dtc") {
        await api("DELETE", `/api/admin/dtc/${encodeURIComponent(t.dataset.code)}/enable`);
        toast(`Enabled ${t.dataset.code}`); await loadDtc();
      } else if (action === "edit-dtc") {
        editDtc(t.dataset.code);
        $("#dtc-editor").open = true;
      } else if (action === "view-sub") {
        showSubmission(t.dataset.id);
      } else if (action === "reopen-sub") {
        const row = submissionEntries.find((item) => String(item.id) === String(t.dataset.id));
        if (!row) return;
        activeSubmissionId = row.id;
        askAction({
          title: "Return submission to review?",
          description: `This clears the previous decision for ${row.code} and adds it back to the pending review queue.`,
          submitLabel: "Return to queue",
          run: async () => {
            await api("POST", "/api/admin/submissions/review", { id: Number(row.id), status: "pending" });
            toast("Submission returned to the review queue."); await loadSubmissions();
          },
        });
      } else if (action === "link-sch") {
        askAction({
          title: `Link a DTC to ${t.dataset.slug}`,
          description: "Enter a diagnostic trouble code to connect this diagram to the catalog.",
          inputLabel: "DTC code", placeholder: "Example: P0171", submitLabel: "Create link",
          run: async (value) => {
            const code = value.toUpperCase();
            await api("POST", "/api/admin/schematic-links", { slug: t.dataset.slug, code });
            toast(`Linked ${code} to ${t.dataset.slug}`); await loadSchematics();
          },
        });
      } else if (action === "unlink-sch") {
        askAction({
          title: `Remove ${t.dataset.code} link?`,
          description: `This removes the link from schematic ${t.dataset.slug}.`,
          submitLabel: "Remove link", danger: true,
          run: async () => {
            await api("DELETE", `/api/admin/schematic-links?slug=${encodeURIComponent(t.dataset.slug)}&code=${encodeURIComponent(t.dataset.code)}`);
            toast(`Unlinked ${t.dataset.code}`); await loadSchematics();
          },
        });
      } else if (action === "edit-sch") {
        editSchematic(t.dataset.slug);
      } else if (action === "disable-sch" || action === "enable-sch") {
        const enable = action === "enable-sch";
        const perform = async () => {
          await api("DELETE", `/api/admin/schematics/${encodeURIComponent(t.dataset.slug)}${enable ? "/enable" : "/disable"}`);
          toast(`${enable ? "Enabled" : "Disabled"} ${t.dataset.slug}`); await loadSchematics();
        };
        if (enable) await perform();
        else askAction({
          title: `Disable ${t.dataset.slug}?`,
          description: "The schematic will no longer appear in the public catalog. Existing DTC links and history stay in place.",
          submitLabel: "Disable schematic", danger: true, run: perform,
        });
      }
    } catch (err) {
      toast(friendlyError(err), "bad");
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
