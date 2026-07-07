/* Parameter Hunt frontend — score card, badges, challenges, leaderboard.
 *
 * Exposes window.Hunt:
 *   Hunt.refresh()  — re-query backend and re-render; toasts on point gain.
 *   Hunt.poke()     — cheap refresh used by explorer actions (probe / map /
 *                     schema save) so awards show up immediately.
 *
 * Loaded before main.js; main.js calls Hunt.poke() after explorer actions.
 */
(function () {
  "use strict";

  const invoke = window.__TAURI__.core.invoke;
  const $ = (id) => document.getElementById(id);

  let lastPoints = null; // null until first load — never toast on startup
  let lastBadges = new Set();

  /* ---------------- award toast ---------------- */

  function toast(html) {
    let host = $("hunt-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "hunt-toast-host";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "hunt-toast";
    el.innerHTML = html;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 400);
    }, 3500);
  }

  /* ---------------- rendering ---------------- */

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function fmtAgo(unixSecs) {
    const d = Math.max(0, Date.now() / 1000 - unixSecs);
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + " min ago";
    if (d < 86400) return Math.floor(d / 3600) + " h ago";
    return Math.floor(d / 86400) + " d ago";
  }

  const KIND_ICON = { discover: "📡", map: "🔍", schema: "🗄️" };

  function renderStatus(st) {
    $("hunt-points").textContent = st.points.toLocaleString();
    $("hunt-rank").textContent = st.rank ? `· rank #${st.rank}` : "";
    $("hunt-discovered").textContent = st.discovered;
    $("hunt-mapped").textContent = st.mapped;
    $("hunt-schemas").textContent = st.schemas;
    $("hunt-merged").textContent = st.merged;
    $("hunt-month").textContent = "— " + st.current_month;
    if (document.activeElement !== $("hunt-alias")) $("hunt-alias").value = st.alias;

    const pts = $("hunt-tab-pts");
    pts.textContent = st.points.toLocaleString();
    pts.classList.toggle("hidden", st.points === 0);

    // Badges
    const bhost = $("hunt-badges");
    bhost.innerHTML = "";
    for (const b of st.badges) {
      const el = document.createElement("div");
      el.className = "hunt-badge" + (b.earned ? " earned" : "");
      el.title = b.description;
      el.innerHTML = `<span class="hunt-badge-icon">${b.icon}</span>
        <span class="hunt-badge-title">${esc(b.title)}</span>
        <span class="hunt-badge-desc">${esc(b.description)}</span>`;
      bhost.appendChild(el);
    }

    // Challenges
    const chost = $("hunt-challenges");
    chost.innerHTML = "";
    if (!st.challenges.length) {
      chost.innerHTML = '<p class="muted">No active challenges this month.</p>';
    }
    for (const c of st.challenges) {
      const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
      const el = document.createElement("div");
      el.className = "hunt-challenge" + (c.complete ? " complete" : "");
      el.innerHTML = `
        <div class="hunt-ch-top">
          <span class="hunt-ch-title">${c.complete ? "✅" : "🎯"} ${esc(c.title)}</span>
          <span class="hunt-ch-reward">+${c.reward} pts</span>
        </div>
        <div class="hunt-ch-desc muted">${esc(c.description)}</div>
        <div class="hunt-ch-bar"><div class="hunt-ch-fill" style="width:${pct}%"></div></div>
        <div class="hunt-ch-progress muted">${c.progress} / ${c.target}</div>`;
      chost.appendChild(el);
    }

    // Activity feed
    const feed = $("hunt-feed");
    feed.innerHTML = "";
    if (!st.recent.length) {
      feed.innerHTML =
        '<li class="muted">No discoveries yet. Open the Parameter Explorer and scan a range.</li>';
    }
    for (const e of st.recent) {
      const li = document.createElement("li");
      li.className = "hunt-feed-item" + (e.practice ? " practice" : "");
      li.innerHTML = `<span class="hunt-feed-icon">${KIND_ICON[e.kind] || "•"}</span>
        <span class="hunt-feed-text">${esc(e.detail)}</span>
        <span class="hunt-feed-pts">${e.practice ? "practice" : "+" + e.points}</span>
        <span class="hunt-feed-time muted">${fmtAgo(e.at)}</span>`;
      feed.appendChild(li);
    }

    // Award toasts (skip the very first render)
    if (lastPoints !== null && st.points > lastPoints) {
      toast(`<strong>+${(st.points - lastPoints).toLocaleString()} pts</strong> — nice find, hunter! 🏆`);
    }
    if (lastPoints !== null) {
      for (const b of st.badges) {
        if (b.earned && !lastBadges.has(b.id)) {
          toast(`${b.icon} Badge unlocked: <strong>${esc(b.title)}</strong>`);
        }
      }
    }
    lastPoints = st.points;
    lastBadges = new Set(st.badges.filter((b) => b.earned).map((b) => b.id));
  }

  function renderLeaderboard(entries) {
    const tbody = $("hunt-lb-rows");
    tbody.innerHTML = "";
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Leaderboard file not found.</td></tr>';
      return;
    }
    entries.forEach((e, i) => {
      const tr = document.createElement("tr");
      if (e.you) tr.className = "hunt-lb-you";
      const medal = ["🥇", "🥈", "🥉"][i] || i + 1;
      tr.innerHTML = `<td>${medal}</td>
        <td>${esc(e.alias)}${e.you ? ' <span class="hunt-you-chip">you</span>' : ""}</td>
        <td>${e.points.toLocaleString()}</td>
        <td>${e.merged || 0}</td>
        <td class="muted">${esc(e.note || "")}</td>`;
      tbody.appendChild(tr);
    });
  }

  /* ---------------- data flow ---------------- */

  async function refresh() {
    try {
      const [st, lb] = await Promise.all([invoke("hunt_status"), invoke("hunt_leaderboard")]);
      renderStatus(st);
      renderLeaderboard(lb);
    } catch (e) {
      console.error("Hunt refresh failed:", e);
    }
  }

  // Debounced refresh for hot paths (probe loops can fire rapidly).
  let pokeTimer = null;
  function poke() {
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(refresh, 350);
  }

  /* ---------------- wiring ---------------- */

  document.addEventListener("DOMContentLoaded", () => {
    $("btn-hunt-refresh").addEventListener("click", refresh);
    $("btn-hunt-alias").addEventListener("click", async () => {
      try {
        await invoke("hunt_set_alias", { alias: $("hunt-alias").value });
        refresh();
      } catch (e) {
        toast("⚠️ " + esc(e));
      }
    });
    // Refresh whenever the Hunt tab is opened.
    document.querySelectorAll('.tab[data-view="hunt"]').forEach((t) =>
      t.addEventListener("click", refresh)
    );
    refresh();
  });

  window.Hunt = { refresh, poke };
})();
