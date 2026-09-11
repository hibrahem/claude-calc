/* Claude Code spend portal — all aggregation happens here, from /api/rows. */
(() => {
  const $ = (s) => document.querySelector(s);
  const state = {
    rows: [], sessions: {}, unknown: {},
    from: null, to: null, preset: "all", gran: "day",
    openProjects: new Set(),
  };
  let timeChart = null, modelChart = null;

  // ---------- theme ----------
  const root = document.documentElement;
  function applyTheme(t) {
    root.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch (_) {}
  }
  (function initTheme() {
    let t = null;
    try { t = localStorage.getItem("theme"); } catch (_) {}
    if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.dataset.theme = t;
  })();
  $("#theme").addEventListener("click", () => {
    applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
    render();
  });
  const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();

  // ---------- formatting ----------
  const usd = (v, d = 2) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usdShort = (v) => v === 0 ? "$0" : v >= 1000 ? "$" + (v / 1000).toFixed(1) + "k" : v >= 10 ? "$" + v.toFixed(0) : "$" + v.toFixed(2);
  const tok = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n);
  const int = (n) => n.toLocaleString("en-US");
  const day = (ts) => ts.slice(0, 10);
  const shortModel = (m) => m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  const fmtDay = (d) => { const [y, m, dd] = d.split("-"); return new Date(+y, +m - 1, +dd).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const fmtMonth = (d) => { const [y, m] = d.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }); };
  const iso = (dt) => dt.toISOString().slice(0, 10);

  // ---------- date range ----------
  function presetRange(p) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const minus = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
    switch (p) {
      case "mtd": return [local(new Date(today.getFullYear(), today.getMonth(), 1)), local(today)];
      case "lastmonth": return [local(new Date(today.getFullYear(), today.getMonth() - 1, 1)), local(new Date(today.getFullYear(), today.getMonth(), 0))];
      case "30d": return [local(minus(29)), local(today)];
      case "7d": return [local(minus(6)), local(today)];
      default: return [null, null];
    }
  }
  function setRange(from, to, preset) {
    state.from = from; state.to = to; state.preset = preset;
    $("#from").value = from || ""; $("#to").value = to || "";
    document.querySelectorAll("#presets .preset").forEach((b) => b.classList.toggle("is-active", b.dataset.preset === preset));
    render();
  }
  $("#presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]"); if (!b) return;
    const [f, t] = presetRange(b.dataset.preset);
    setRange(f, t, b.dataset.preset);
  });
  $("#from").addEventListener("change", (e) => setRange(e.target.value || null, state.to, null));
  $("#to").addEventListener("change", (e) => setRange(state.from, e.target.value || null, null));

  document.querySelector(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-gran]"); if (!b) return;
    state.gran = b.dataset.gran;
    document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("is-active", x === b));
    renderTime(filtered());
  });

  // ---------- data ----------
  async function loadData() {
    $("#scan-note").textContent = "Scanning session logs…";
    const r = await fetch("/api/rows");
    const d = await r.json();
    state.rows = d.rows; state.sessions = d.sessions; state.unknown = d.unknown;
    $("#scan-note").textContent = `Scanned ${int(d.rows.length)} messages in ${d.scan_ms} ms at ${d.generated_at.slice(11, 16)}`;
    render();
  }
  $("#refresh").addEventListener("click", loadData);

  function filtered() {
    const { from, to } = state;
    if (!from && !to) return state.rows;
    return state.rows.filter((r) => { const d = day(r.ts); return (!from || d >= from) && (!to || d <= to); });
  }

  // ---------- render ----------
  function render() {
    const rows = filtered();
    renderKpis(rows);
    renderTime(rows);
    renderModels(rows);
    renderProjects(rows);
    renderFooter();
  }

  function renderKpis(rows) {
    let total = 0, cr = 0; const days = new Set();
    for (const r of rows) { total += r.cost; cr += r.c_cr; days.add(day(r.ts)); }
    $("#kpi-total").textContent = usd(total);
    $("#kpi-msgs").textContent = int(rows.length);
    $("#kpi-days").textContent = int(days.size);
    $("#kpi-perday").textContent = usd(days.size ? total / days.size : 0);
    $("#kpi-cache").textContent = total ? (cr / total * 100).toFixed(0) + "%" : "–";
  }

  function chartBase() {
    return {
      ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), hair: css("--hair"), surface: css("--surface"),
      font: { family: css("--font"), size: 12 },
    };
  }
  function tooltipStyle(c) {
    return {
      backgroundColor: c.ink, titleColor: c.surface, bodyColor: c.surface,
      titleFont: { family: c.font.family, size: 12, weight: "600" }, bodyFont: { family: c.font.family, size: 12 },
      padding: 10, cornerRadius: 6, displayColors: true, boxWidth: 8, boxHeight: 8, boxPadding: 4,
    };
  }

  function renderTime(rows) {
    const c = chartBase();
    const key = state.gran === "day" ? (r) => day(r.ts) : (r) => r.ts.slice(0, 7);
    const agg = new Map();
    for (const r of rows) {
      const k = key(r); const a = agg.get(k) || { cost: 0, msgs: 0 };
      a.cost += r.cost; a.msgs += 1; agg.set(k, a);
    }
    // Fill gaps so quiet days show as zero, not as missing bars.
    let labels = [...agg.keys()].sort();
    if (state.gran === "day" && labels.length > 1) {
      const out = []; const start = new Date(labels[0] + "T00:00:00Z"); const end = new Date(labels[labels.length - 1] + "T00:00:00Z");
      for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(iso(d));
      labels = out;
    }
    const data = labels.map((k) => (agg.get(k) || { cost: 0 }).cost);
    const fmt = state.gran === "day" ? fmtDay : fmtMonth;
    const cfg = {
      type: "bar",
      data: { labels, datasets: [{ label: "Spend", data, backgroundColor: css("--s1"), borderRadius: 4, borderSkipped: false, maxBarThickness: 28, categoryPercentage: 0.8, barPercentage: 0.9 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipStyle(c), callbacks: {
            title: (it) => fmt(it[0].label),
            label: (it) => { const a = agg.get(it.label) || { cost: 0, msgs: 0 }; return ` ${usd(a.cost)}  ·  ${int(a.msgs)} messages`; },
          } },
        },
        scales: {
          x: { grid: { display: false }, border: { color: c.hair }, ticks: { color: c.muted, font: c.font, maxRotation: 0, autoSkip: true, maxTicksLimit: 14, callback: (v, i) => fmt(labels[i]) } },
          y: { beginAtZero: true, grid: { color: c.hair, drawTicks: false }, border: { display: false }, ticks: { color: c.muted, font: c.font, padding: 8, maxTicksLimit: 6, callback: (v) => usdShort(v) } },
        },
      },
    };
    if (timeChart) timeChart.destroy();
    timeChart = new Chart($("#time-chart"), cfg);
  }

  function renderModels(rows) {
    const c = chartBase();
    const agg = new Map();
    for (const r of rows) {
      const a = agg.get(r.model) || { msgs: 0, out: 0, cr: 0, w: 0, c_in: 0, c_out: 0, c_cr: 0, c_w: 0, cost: 0 };
      a.msgs++; a.out += r.out; a.cr += r.cr; a.w += r.w5 + r.w1;
      a.c_in += r.c_in; a.c_out += r.c_out; a.c_cr += r.c_cr; a.c_w += r.c_w; a.cost += r.cost;
      agg.set(r.model, a);
    }
    const models = [...agg.entries()].sort((a, b) => b[1].cost - a[1].cost);
    const labels = models.map(([m]) => shortModel(m));
    const series = [
      { label: "Output", key: "c_out", color: css("--s1") },
      { label: "Cache reads", key: "c_cr", color: css("--s2") },
      { label: "Cache writes", key: "c_w", color: css("--s3") },
      { label: "Uncached input", key: "c_in", color: css("--s4") },
    ];
    const cfg = {
      type: "bar",
      data: { labels, datasets: series.map((s) => ({
        label: s.label, data: models.map(([, a]) => a[s.key]), backgroundColor: s.color,
        borderColor: c.surface, borderWidth: 1, borderSkipped: false, borderRadius: 2, maxBarThickness: 22,
      })) },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", align: "start", labels: { color: c.ink2, font: c.font, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: "rectRounded", padding: 14 } },
          tooltip: { ...tooltipStyle(c), callbacks: {
            label: (it) => ` ${it.dataset.label}: ${usd(it.raw)}`,
            footer: (its) => "Total " + usd(its.reduce((s, i) => s + i.raw, 0)),
          }, footerColor: c.surface, footerFont: { family: c.font.family, size: 12, weight: "600" } },
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: c.hair, drawTicks: false }, border: { display: false }, ticks: { color: c.muted, font: c.font, maxTicksLimit: 6, callback: (v) => usdShort(v) } },
          y: { stacked: true, grid: { display: false }, border: { color: c.hair }, ticks: { color: c.ink, font: { ...c.font, size: 12.5 } } },
        },
      },
    };
    $("#model-chart-wrap").style.height = Math.max(200, 60 + models.length * 38) + "px";
    if (modelChart) modelChart.destroy();
    modelChart = new Chart($("#model-chart"), cfg);

    const tb = $("#model-table tbody"); tb.innerHTML = "";
    if (!models.length) { tb.innerHTML = `<tr><td colspan="6" class="empty">No messages in this range.</td></tr>`; return; }
    for (const [m, a] of models) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${shortModel(m)}</td><td class="num">${int(a.msgs)}</td><td class="num">${tok(a.out)}</td><td class="num">${tok(a.cr)}</td><td class="num">${tok(a.w)}</td><td class="num cost">${usd(a.cost)}</td>`;
      tb.appendChild(tr);
    }
  }

  function renderProjects(rows) {
    const proj = new Map();
    for (const r of rows) {
      const meta = state.sessions[r.session] || { project: "unknown" };
      const p = proj.get(meta.project) || { cost: 0, msgs: 0, sessions: new Map() };
      p.cost += r.cost; p.msgs++;
      const s = p.sessions.get(r.session) || { cost: 0, msgs: 0, models: new Map() };
      s.cost += r.cost; s.msgs++; s.models.set(r.model, (s.models.get(r.model) || 0) + r.cost);
      p.sessions.set(r.session, s);
      proj.set(meta.project, p);
    }
    const list = [...proj.entries()].sort((a, b) => b[1].cost - a[1].cost);
    const total = list.reduce((s, [, p]) => s + p.cost, 0);
    const maxCost = list.length ? list[0][1].cost : 1;
    $("#proj-note").textContent = list.length ? `${list.length} projects · ${int([...proj.values()].reduce((s, p) => s + p.sessions.size, 0))} sessions` : "";
    const tb = $("#proj-table tbody"); tb.innerHTML = "";
    if (!list.length) { tb.innerHTML = `<tr><td colspan="6" class="empty">No messages in this range.</td></tr>`; return; }
    for (const [name, p] of list) {
      const tr = document.createElement("tr");
      tr.className = "proj" + (state.openProjects.has(name) ? " is-open" : "");
      const parts = name.split("/"); const leaf = parts.pop(); const dir = parts.length ? parts.join("/") + "/" : "";
      tr.innerHTML = `<td class="tog"></td><td><span class="path-dim">${esc(dir)}</span>${esc(leaf)}</td><td class="num">${int(p.sessions.size)}</td><td class="num">${int(p.msgs)}</td><td class="num cost">${usd(p.cost)}</td><td class="share"><div class="bar"><i style="width:${(p.cost / maxCost * 100).toFixed(1)}%"></i></div></td>`;
      tr.title = name;
      tr.addEventListener("click", () => {
        if (state.openProjects.has(name)) state.openProjects.delete(name); else state.openProjects.add(name);
        renderProjects(filtered());
      });
      tb.appendChild(tr);
      if (state.openProjects.has(name)) tb.appendChild(sessionRows(p.sessions));
    }
    void total;
  }

  function sessionRows(sessions) {
    const frag = document.importNode($("#session-rows").content, true);
    const tb = frag.querySelector("tbody");
    const list = [...sessions.entries()].sort((a, b) => b[1].cost - a[1].cost);
    for (const [sid, s] of list) {
      const meta = state.sessions[sid] || {};
      const models = [...s.models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => `<span class="chip">${shortModel(m)}</span>`).join("");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${(meta.started || "").slice(0, 10)}</td><td class="title"><span class="ttl" title="${esc(meta.title || "")}">${esc(meta.title || "(no prompt recorded)")}</span><span class="sid">${sid.slice(0, 8)}</span></td><td class="models">${models}</td><td class="num">${int(s.msgs)}</td><td class="num cost">${usd(s.cost)}</td>`;
      tb.appendChild(tr);
    }
    return frag;
  }

  function renderFooter() {
    const u = Object.entries(state.unknown);
    $("#unknown-note").textContent = u.length
      ? "Not priced (no rate in costlib.py): " + u.map(([m, t]) => `${m} (${tok(t)} tokens)`).join(", ")
      : "";
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  loadData().catch((e) => { $("#scan-note").textContent = "Could not load data: " + e.message; });
})();
