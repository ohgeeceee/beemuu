// DTC catalog admin page (PR 3). Vanilla JS, no framework, no inline scripts.
// Talks to /admin/api/dtc and /admin/api/dtc/<code>.

(function () {
    "use strict";

    const $ = (sel) => document.querySelector(sel);
    const tbody = $("#dtc-table tbody");
    const meta = $("#dtc-meta");
    const pageInfo = $("#dtc-page-info");
    const prevBtn = $("#dtc-prev");
    const nextBtn = $("#dtc-next");

    const dialog = $("#dtc-edit-dialog");
    const editForm = $("#dtc-edit-form");
    const editCode = $("#dtc-edit-code");
    const editTitle = $("#dtc-edit-title-input");
    const editSeverity = $("#dtc-edit-severity");
    const editDescription = $("#dtc-edit-description");
    const editEnabled = $("#dtc-edit-enabled");
    const editVerified = $("#dtc-edit-verified");
    const editStatus = $("#dtc-edit-status");
    const editCancel = $("#dtc-edit-cancel");

    let currentPage = 1;
    let totalPages = 1;
    let lastQuery = "";

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function buildQuery(page) {
        const params = new URLSearchParams();
        const prefix = $("#dtc-prefix").value.trim().toUpperCase();
        const severity = $("#dtc-severity").value;
        const enabled = $("#dtc-enabled").value;
        const verified = $("#dtc-verified").value;
        if (prefix) params.set("prefix", prefix);
        if (severity) params.set("severity", severity);
        if (enabled) params.set("enabled", enabled);
        if (verified) params.set("verified", verified);
        params.set("page", String(page));
        params.set("page_size", "50");
        return params.toString();
    }

    async function loadPage(page) {
        lastQuery = buildQuery(page);
        tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Loading…</td></tr>`;
        meta.textContent = "";
        try {
            const resp = await fetch(`/admin/api/dtc?${lastQuery}`, { credentials: "same-origin" });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            renderRows(data);
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    function renderRows(data) {
        currentPage = data.page || 1;
        const total = data.total || 0;
        const pageSize = data.page_size || 50;
        totalPages = Math.max(1, Math.ceil(total / pageSize));
        meta.textContent = total === 0 ? "No matches" : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= totalPages;

        const items = data.items || [];
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">No DTC rows match the current filter.</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map((row) => `
            <tr data-code="${escapeHtml(row.code)}" class="admin-row-clickable">
                <td class="col-code">${escapeHtml(row.code)}</td>
                <td>${escapeHtml(row.title)}</td>
                <td><span class="admin-pill admin-pill-${escapeHtml(row.severity || "")}">${escapeHtml(row.severity || "")}</span></td>
                <td class="col-source">${escapeHtml(row.source || "")}</td>
                <td>${row.enabled ? "✓" : "—"}</td>
                <td>${row.verified ? "✓" : "—"}</td>
            </tr>
        `).join("");

        // Wire row click → open edit dialog.
        tbody.querySelectorAll("tr.admin-row-clickable").forEach((tr) => {
            tr.addEventListener("click", () => openEditDialog(tr.getAttribute("data-code")));
        });
    }

    async function openEditDialog(code) {
        editStatus.textContent = "Loading…";
        try {
            const resp = await fetch(`/admin/api/dtc/${encodeURIComponent(code)}`, { credentials: "same-origin" });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const row = await resp.json();
            editCode.value = row.code;
            editTitle.value = row.title || "";
            editSeverity.value = row.severity || "warn";
            editDescription.value = row.description || "";
            editEnabled.checked = !!row.enabled;
            editVerified.checked = !!row.verified;
            editStatus.textContent = "";
            dialog.showModal();
        } catch (err) {
            alert(`Failed to load DTC ${code}: ${err.message}`);
        }
    }

    editCancel.addEventListener("click", (e) => {
        e.preventDefault();
        dialog.close();
    });

    editForm.addEventListener("submit", async (e) => {
        // The form is method="dialog" so submit will close it; we override
        // here to do an AJAX save and re-open on error.
        e.preventDefault();
        const code = editCode.value;
        editStatus.textContent = "Saving…";
        const body = JSON.stringify({
            title: editTitle.value,
            severity: editSeverity.value,
            description: editDescription.value,
            enabled: editEnabled.checked,
            verified: editVerified.checked,
        });
        try {
            const resp = await fetch(`/admin/api/dtc/${encodeURIComponent(code)}`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body,
            });
            if (!resp.ok) {
                const errBody = await resp.json().catch(() => ({}));
                throw new Error(errBody.error || `HTTP ${resp.status}`);
            }
            dialog.close();
            await loadPage(currentPage);
        } catch (err) {
            editStatus.textContent = `Save failed: ${err.message}`;
        }
    });

    $("#dtc-apply").addEventListener("click", () => loadPage(1));
    prevBtn.addEventListener("click", () => { if (!prevBtn.disabled) loadPage(currentPage - 1); });
    nextBtn.addEventListener("click", () => { if (!nextBtn.disabled) loadPage(currentPage + 1); });
    $("#dtc-prefix").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); loadPage(1); }
    });

    document.addEventListener("DOMContentLoaded", () => loadPage(1));
})();
