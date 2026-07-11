// Submissions admin page (PR 3). Vanilla JS. Approve promotes to the DTC
// catalog; reject keeps the submission with a reviewer note.

(function () {
    "use strict";

    const $ = (sel) => document.querySelector(sel);
    const tbody = $("#sub-table tbody");
    const meta = $("#sub-meta");
    const pageInfo = $("#sub-page-info");
    const prevBtn = $("#sub-prev");
    const nextBtn = $("#sub-next");

    const approveDialog = $("#sub-approve-dialog");
    const approveForm = $("#sub-approve-form");
    const approveId = $("#sub-approve-id");
    const approveCode = $("#sub-approve-code");
    const approveTitle = $("#sub-approve-title-input");
    const approveSeverity = $("#sub-approve-severity");
    const approveNote = $("#sub-approve-note");
    const approveStatus = $("#sub-approve-status");
    const approveCancel = $("#sub-approve-cancel");

    const rejectDialog = $("#sub-reject-dialog");
    const rejectForm = $("#sub-reject-form");
    const rejectId = $("#sub-reject-id");
    const rejectCode = $("#sub-reject-code");
    const rejectNote = $("#sub-reject-note");
    const rejectStatus = $("#sub-reject-status");
    const rejectCancel = $("#sub-reject-cancel");

    let currentPage = 1;
    let totalPages = 1;

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function fmtTime(epoch) {
        if (!epoch) return "—";
        const d = new Date(epoch * 1000);
        return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
    }

    function buildQuery(page) {
        const params = new URLSearchParams();
        params.set("status", $("#sub-status").value || "pending");
        params.set("page", String(page));
        params.set("page_size", "50");
        return params.toString();
    }

    async function loadPage(page) {
        tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Loading…</td></tr>`;
        meta.textContent = "";
        try {
            const resp = await fetch(`/admin/api/submissions?${buildQuery(page)}`, { credentials: "same-origin" });
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
        meta.textContent = total === 0 ? "No submissions" : `${total.toLocaleString()} submission${total === 1 ? "" : "s"}`;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= totalPages;

        const items = data.items || [];
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">No submissions match the current filter.</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map((row) => {
            const actions = row.status === "pending"
                ? `<button type="button" data-action="approve" data-id="${row.id}" data-code="${escapeHtml(row.code)}">Approve</button>
                   <button type="button" data-action="reject" data-id="${row.id}" data-code="${escapeHtml(row.code)}">Reject</button>`
                : `<span class="admin-meta-note">${escapeHtml(row.reviewer_note || "")}</span>`;
            return `
                <tr data-id="${row.id}">
                    <td class="col-time">${fmtTime(row.submitted_at)}</td>
                    <td class="col-code">${escapeHtml(row.code)}</td>
                    <td>${escapeHtml(row.submitter_handle || "—")}</td>
                    <td>${escapeHtml(row.symptoms || "—")}</td>
                    <td><span class="admin-pill admin-pill-status-${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td>
                    <td class="col-actions">${actions}</td>
                </tr>
            `;
        }).join("");

        tbody.querySelectorAll("button[data-action]").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const action = btn.getAttribute("data-action");
                const id = btn.getAttribute("data-id");
                const code = btn.getAttribute("data-code");
                if (action === "approve") openApprove(id, code);
                else openReject(id, code);
            });
        });
    }

    function openApprove(id, code) {
        approveId.value = id;
        approveCode.textContent = code;
        approveTitle.value = "";
        approveSeverity.value = "";
        approveNote.value = "";
        approveStatus.textContent = "";
        approveDialog.showModal();
    }

    function openReject(id, code) {
        rejectId.value = id;
        rejectCode.textContent = code;
        rejectNote.value = "";
        rejectStatus.textContent = "";
        rejectDialog.showModal();
    }

    approveCancel.addEventListener("click", (e) => { e.preventDefault(); approveDialog.close(); });
    rejectCancel.addEventListener("click", (e) => { e.preventDefault(); rejectDialog.close(); });

    approveForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = approveId.value;
        approveStatus.textContent = "Approving…";
        const body = {};
        if (approveTitle.value.trim()) body.title = approveTitle.value.trim();
        if (approveSeverity.value) body.severity = approveSeverity.value;
        if (approveNote.value.trim()) body.note = approveNote.value.trim();
        try {
            const resp = await fetch(`/admin/api/submissions/${encodeURIComponent(id)}/approve`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const errBody = await resp.json().catch(() => ({}));
                throw new Error(errBody.error || `HTTP ${resp.status}`);
            }
            approveDialog.close();
            await loadPage(currentPage);
        } catch (err) {
            approveStatus.textContent = `Approve failed: ${err.message}`;
        }
    });

    rejectForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = rejectId.value;
        const note = rejectNote.value.trim();
        if (!note) {
            rejectStatus.textContent = "Note is required.";
            return;
        }
        rejectStatus.textContent = "Rejecting…";
        try {
            const resp = await fetch(`/admin/api/submissions/${encodeURIComponent(id)}/reject`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note }),
            });
            if (!resp.ok) {
                const errBody = await resp.json().catch(() => ({}));
                throw new Error(errBody.error || `HTTP ${resp.status}`);
            }
            rejectDialog.close();
            await loadPage(currentPage);
        } catch (err) {
            rejectStatus.textContent = `Reject failed: ${err.message}`;
        }
    });

    $("#sub-apply").addEventListener("click", () => loadPage(1));
    prevBtn.addEventListener("click", () => { if (!prevBtn.disabled) loadPage(currentPage - 1); });
    nextBtn.addEventListener("click", () => { if (!nextBtn.disabled) loadPage(currentPage + 1); });

    document.addEventListener("DOMContentLoaded", () => loadPage(1));
})();
