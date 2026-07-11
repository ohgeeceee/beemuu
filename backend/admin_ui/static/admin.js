// Beemuu admin shell — fetch JSON stats + recent audit log, no framework.
// Kept deliberately small so a future PR can swap to a real SPA without
// touching the server contract: every tile reads from a `/admin/api/stats/*`
// endpoint and the recent-activity table reads `/admin/api/audit/recent`.

(function () {
    "use strict";

    async function fetchJSON(url) {
        const resp = await fetch(url, { credentials: "same-origin" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
        return await resp.json();
    }

    function fmtTime(epoch) {
        if (!epoch) return "—";
        const d = new Date(epoch * 1000);
        return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
    }

    async function loadTiles() {
        const tiles = document.querySelectorAll(".admin-tile-value[data-source]");
        await Promise.all(Array.from(tiles).map(async (el) => {
            const url = el.getAttribute("data-source");
            try {
                const data = await fetchJSON(url);
                el.textContent = (data && typeof data.value === "number")
                    ? data.value.toLocaleString()
                    : "?";
            } catch (err) {
                el.textContent = "—";
                console.warn("tile failed:", url, err);
            }
        }));
    }

    async function loadRecent() {
        const tbody = document.querySelector("#admin-recent-table tbody");
        if (!tbody) return;
        let entries = [];
        try {
            const data = await fetchJSON("/admin/api/audit/recent?limit=20");
            entries = (data && data.entries) || [];
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="4" class="admin-empty">Failed to load audit log: ${err.message}</td></tr>`;
            return;
        }
        if (entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="admin-empty">No admin activity yet.</td></tr>`;
            return;
        }
        tbody.innerHTML = entries.map((row) => `
            <tr>
                <td class="col-time">${fmtTime(row.at)}</td>
                <td class="col-action">${escapeHtml(row.action || "")}</td>
                <td>${escapeHtml(row.target || "")}</td>
                <td class="col-ip">${escapeHtml(row.ip || "")}</td>
            </tr>
        `).join("");
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    document.addEventListener("DOMContentLoaded", function () {
        loadTiles();
        loadRecent();
    });
})();
