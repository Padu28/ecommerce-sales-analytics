/* BasketLens dashboard application. Plain script, no build step. */
(function () {
  "use strict";
  const C = window.Charts, D = window.BASKETLENS_DATA;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const gbp = C.gbp, num = C.num, pct = C.pct;

  if (!D) {
    $("#main").innerHTML = `<div class="card"><h1>No data yet</h1><p style="margin-top:8px">Run <code>basketlens run</code> to create <code>dashboard/data/basketlens_data.js</code>, then reload this page.</p></div>`;
    return;
  }

  /* ---------------- data ---------------- */
  const DAY = 86400000;
  const start = Date.parse(D.meta.start + "T00:00:00Z");
  const nDays = Math.round((Date.parse(D.meta.end + "T00:00:00Z") - start) / DAY) + 1;
  const dateOf = i => new Date(start + i * DAY);
  const fmtDate = i => dateOf(i).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const fmtShort = i => dateOf(i).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const dayIdx = s => Math.round((Date.parse(s + "T00:00:00Z") - start) / DAY);
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const wd = i => (dateOf(i).getUTCDay() + 6) % 7;

  const COUNTRIES = D.countries;
  const HOME = COUNTRIES.includes("United Kingdom") ? "United Kingdom" : COUNTRIES[0];
  const INV = D.invoices; // [day, country, customer, revenue, units, hour, lines]
  const CANC = D.cancellations; // [day, country, value]
  const obj = (fields, row) => Object.fromEntries(fields.map((f, i) => [f, row[i]]));
  const PRODUCTS = D.products.map(r => obj(D.product_fields, r));
  const PBY = new Map(PRODUCTS.map(p => [p.code, p]));
  const SEGS = D.segments;
  const SEG_COLORS = { "Champions": "#5A2A82", "Loyal Customers": "#1C8C84", "New/Promising": "#E9A23B", "Need Attention": "#8C7BB8", "At Risk": "#D64566", "Hibernating": "#9A97A8" };
  const CUSTOMERS = D.customers.map(r => { const o = obj(D.customer_fields, r); o.segName = SEGS[o.segment]; o.countryName = COUNTRIES[o.country]; o.firstIdx = dayIdx(o.first); return o; });
  const CBY = new Map(CUSTOMERS.map(c => [c.id, c]));
  const RULES = D.rules.map(r => ({ a: r[0], b: r[1], count: r[2], support: r[3], conf: r[4], lift: r[5] }));
  const ABC_COL = { A: "var(--plum)", B: "var(--marigold)", C: "var(--ink-3)" };
  const ABC_HEX = { A: "#5A2A82", B: "#E9A23B", C: "#9A97A8" };
  const pname = code => (PBY.get(code) || { name: code }).name;
  const cap = s => s.charAt(0) + s.slice(1).toLowerCase();
  const nice = s => s.split(" ").map(w => (w.length <= 2 && /\d/.test(w)) ? w : cap(w)).join(" ");

  /* ---------------- persistence (best effort) ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bl:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bl:" + k, JSON.stringify(v)); } catch (e) { /* unavailable */ } }
  };

  /* ---------------- state ---------------- */
  const state = { view: "overview", sel: null, country: "", seg: null, abc: "", prodQ: "", custQ: "",
    prodSort: { k: "revenue", d: -1 }, custSort: { k: "monetary", d: -1 }, mktSort: { k: "revenue", d: -1 }, liftMin: 3, reco: null };
  const VIEWS = ["overview", "products", "baskets", "customers", "markets", "operations"];

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (VIEWS.includes(p.get("view"))) state.view = p.get("view");
    if (p.get("from") && p.get("to")) { const a = dayIdx(p.get("from")), b = dayIdx(p.get("to")); if (a >= 0 && b < nDays && b > a) state.sel = [a, b]; }
    if (p.get("country") && COUNTRIES.includes(p.get("country"))) state.country = p.get("country");
    if (p.get("seg") && SEGS.includes(p.get("seg"))) state.seg = p.get("seg");
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (state.view !== "overview") p.set("view", state.view);
    if (state.sel) { p.set("from", dateOf(state.sel[0]).toISOString().slice(0, 10)); p.set("to", dateOf(state.sel[1]).toISOString().slice(0, 10)); }
    if (state.country) p.set("country", state.country);
    if (state.seg) p.set("seg", state.seg);
    const h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  /* ---------------- aggregation over invoices ---------------- */
  function range() { return state.sel || [0, nDays - 1]; }
  function prevRange([a, b]) { const len = b - a + 1; return a - len >= 0 ? [a - len, a - 1] : (a > 0 ? [0, a - 1] : null); }
  const cIdx = () => state.country ? COUNTRIES.indexOf(state.country) : -1;

  function agg([a, b], countryIdx) {
    const out = { revenue: 0, orders: 0, units: 0, cust: new Map(), byCountry: new Map(), heat: WEEKDAYS.map(() => new Array(24).fill(0)), cancelled: 0, days: new Map() };
    for (const r of INV) {
      if (r[0] < a || r[0] > b || (countryIdx >= 0 && r[1] !== countryIdx)) continue;
      out.revenue += r[3]; out.orders++; out.units += r[4];
      if (r[2] >= 0) { const c = out.cust.get(r[2]) || { n: 0, v: 0 }; c.n++; c.v += r[3]; out.cust.set(r[2], c); }
      const bc = out.byCountry.get(r[1]) || { revenue: 0, orders: 0, cust: new Set() };
      bc.revenue += r[3]; bc.orders++; if (r[2] >= 0) bc.cust.add(r[2]); out.byCountry.set(r[1], bc);
      out.heat[wd(r[0])][r[5]]++;
      out.days.set(r[0], (out.days.get(r[0]) || 0) + r[3]);
    }
    for (const c of CANC) if (c[0] >= a && c[0] <= b && (countryIdx < 0 || c[1] === countryIdx)) out.cancelled += c[2];
    out.customers = out.cust.size;
    out.repeat = out.customers ? [...out.cust.values()].filter(c => c.n > 1).length / out.customers : 0;
    out.aov = out.orders ? out.revenue / out.orders : 0;
    out.cancelRate = out.revenue + out.cancelled ? out.cancelled / (out.revenue + out.cancelled) : 0;
    return out;
  }
  function dailySeries(countryIdx) {
    const v = new Array(nDays).fill(0);
    for (const r of INV) if (countryIdx < 0 || r[1] === countryIdx) v[r[0]] += r[3];
    return v.map((x, i) => ({ v: x, date: dateOf(i) }));
  }

  /* ---------------- ui helpers ---------------- */
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function countTo(node, to, f) {
    const from = +(node.dataset.v || 0); node.dataset.v = to;
    if (reduce) { node.textContent = f(to); return; }
    const t0 = performance.now(); cancelAnimationFrame(node._r);
    const step = t => { const k = Math.min(1, (t - t0) / 850), e = 1 - Math.pow(1 - k, 3); node.textContent = f(from + (to - from) * e); if (k < 1) node._r = requestAnimationFrame(step); };
    node._r = requestAnimationFrame(step);
  }
  function deltaHtml(cur, prev, invert, isRate) {
    if (prev == null) return `<span class="delta flat">No earlier period to compare</span>`;
    if (isRate) {
      const d = cur - prev, good = invert ? d < 0 : d > 0;
      if (Math.abs(d) < 0.0005) return `<span class="delta flat">No change <small>vs previous</small></span>`;
      return `<span class="delta ${good ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${(Math.abs(d) * 100).toFixed(1)} pts <small>vs previous</small></span>`;
    }
    if (!prev) return `<span class="delta flat">New activity</span>`;
    const ch = cur / prev - 1, good = invert ? ch < 0 : ch > 0;
    if (Math.abs(ch) < 0.005) return `<span class="delta flat">No change <small>vs previous</small></span>`;
    return `<span class="delta ${good ? "up" : "down"}">${ch > 0 ? "▲" : "▼"} ${pct(Math.abs(ch), 1)} <small>vs previous</small></span>`;
  }
  function exportCsv(name, head, rows) {
    const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    const blob = new Blob([[head.join(",")].concat(rows.map(r => r.map(q).join(","))).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `basketlens-${name}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Downloaded ${rows.length.toLocaleString()} rows`);
  }
  function sortTable(table, sortState, render) {
    $$("th[data-sort]", table).forEach(th => th.addEventListener("click", () => {
      const k = th.dataset.sort;
      sortState.d = sortState.k === k ? -sortState.d : (th.dataset.type === "text" ? 1 : -1);
      sortState.k = k; render();
    }));
  }
  const th = (k, label, st, cls, type) => `<th ${k ? `data-sort="${k}"` : ""} ${type ? `data-type="${type}"` : ""} class="${cls || ""}" ${st && st.k === k ? `aria-sort="${st.d < 0 ? "descending" : "ascending"}"` : ""}>${label}</th>`;
  const cmp = (st) => (x, y) => { const a = x[st.k], b = y[st.k]; return (typeof a === "string" ? a.localeCompare(b) : a - b) * st.d; };

  /* ---------------- header ---------------- */
  function initHeader() {
    $("#country").insertAdjacentHTML("beforeend", COUNTRIES.slice().sort().map(c => `<option>${esc(c)}</option>`).join(""));
    $("#country").value = state.country;
    $("#country").addEventListener("change", e => { state.country = e.target.value; pulseCache = null; renderAll(); });
    $$(".quick button").forEach(b => b.addEventListener("click", () => {
      const r = b.dataset.range;
      if (r === "all") state.sel = null;
      else if (r === "q4") { const a = dayIdx(dateOf(nDays - 1).getUTCFullYear() + "-10-01"); state.sel = [Math.max(0, a), nDays - 1]; }
      else state.sel = [Math.max(0, nDays - +r), nDays - 1];
      renderAll();
    }));
    $$(".nav button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    $("#themeBtn").addEventListener("click", toggleTheme);
    $("#printBtn").addEventListener("click", printReport);
    $("#sideFoot").innerHTML = `<b>${num(D.kpis.orders)}</b> orders, <b>${num(D.kpis.customers)}</b> customers<br>${fmtDate(0)} to ${fmtDate(nDays - 1)}`;
    $("#footMeta").textContent = `BasketLens v${D.meta.version}. Data ${D.meta.start} to ${D.meta.end}. Generated ${D.meta.generated.slice(0, 10)}. Amounts in GBP.`;
  }
  function updateRangeUi() {
    const [a, b] = range();
    $("#rangeText").textContent = (state.sel ? `${fmtShort(a)} to ${fmtDate(b)}` : "Full period") + (state.country ? `, ${state.country}` : "");
    const q4 = dayIdx(dateOf(nDays - 1).getUTCFullYear() + "-10-01");
    const which = !state.sel ? "all" : (state.sel[1] === nDays - 1 ? (state.sel[0] === q4 ? "q4" : state.sel[0] === nDays - 90 ? "90" : state.sel[0] === nDays - 30 ? "30" : "") : "");
    $$(".quick button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.range === which)));
  }
  function toggleTheme() {
    const h = document.documentElement; h.dataset.theme = h.dataset.theme === "dark" ? "light" : "dark";
    store.set("theme", h.dataset.theme); renderView(state.view);
  }
  function setView(v) {
    state.view = v;
    $$(".nav button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    $$(".view").forEach(s => { s.hidden = s.id !== "view-" + v; });
    renderView(v); writeHash();
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  /* ---------------- overview ---------------- */
  let pulseCache = null;
  function renderPulse() {
    const ci = cIdx();
    if (!pulseCache) pulseCache = dailySeries(ci);
    const global = ci < 0;
    C.pulse($("#pulseChart"), {
      days: pulseCache, sel: state.sel, fmtDate,
      forecast: global ? D.forecast.map(f => [f[0], f[1], f[2], f[3]]) : null,
      anomalies: global ? D.anomalies : [],
      onSelect: s => { state.sel = s; renderAll(true); },
      onPin: i => { state.sel = [Math.max(0, i - 10), Math.min(nDays - 1, i + 10)]; renderAll(); }
    });
    $("#pulseLegend").innerHTML = `<span><i style="--c:var(--plum)"></i>7-day average</span>` +
      (global ? `<span><i style="--c:var(--marigold)"></i>Forecast</span><span><i class="dot" style="--c:var(--teal)"></i>Spike</span><span><i class="dot" style="--c:var(--rose)"></i>Drop</span>` : `<span>Forecast and unusual days cover all markets</span>`);
  }

  function weeklySpark(r, field) {
    const [a, b] = r, ci = cIdx(), buckets = Math.min(12, Math.max(4, Math.round((b - a + 1) / 7)));
    const size = (b - a + 1) / buckets, v = new Array(buckets).fill(0), o = new Array(buckets).fill(0), cs = [...Array(buckets)].map(() => new Set());
    for (const x of INV) {
      if (x[0] < a || x[0] > b || (ci >= 0 && x[1] !== ci)) continue;
      const k = Math.min(buckets - 1, Math.floor((x[0] - a) / size));
      v[k] += x[3]; o[k]++; if (x[2] >= 0) cs[k].add(x[2]);
    }
    if (field === "orders") return o;
    if (field === "customers") return cs.map(s => s.size);
    if (field === "aov") return v.map((x, i) => o[i] ? x / o[i] : 0);
    return v;
  }

  function renderKpis(cur, prev) {
    const r = range();
    const items = [
      ["revenue", "Revenue", cur.revenue, prev && prev.revenue, v => gbp(v), false, false],
      ["orders", "Orders", cur.orders, prev && prev.orders, v => num(v), false, false],
      ["customers", "Active customers", cur.customers, prev && prev.customers, v => num(v), false, false],
      ["aov", "Average order value", cur.aov, prev && prev.aov, v => gbp(v), false, false],
      ["repeat", "Repeat customer rate", cur.repeat, prev && prev.repeat, v => pct(v, 1), false, true],
      ["cancel", "Cancelled value", cur.cancelled, prev && prev.cancelled, v => gbp(v), true, false],
    ];
    const box = $("#kpis");
    if (!box.children.length) box.innerHTML = items.map(i => `<div class="kpi" id="k-${i[0]}"><span class="lab">${i[1]}</span><div class="vrow"><span class="val">0</span><svg class="spark" viewBox="0 0 70 26" aria-hidden="true"><path/></svg></div><span class="d"></span></div>`).join("");
    items.forEach(([k, , v, p, f, inv, rate]) => {
      const node = $(`#k-${k}`);
      countTo($(".val", node), v, f);
      $(".d", node).innerHTML = deltaHtml(v, prev ? p : null, inv, rate);
      const sp = ["revenue", "orders", "customers", "aov"].includes(k) ? weeklySpark(r, k) : null;
      $(".spark", node).style.display = sp ? "" : "none";
      if (sp) $(".spark path", node).setAttribute("d", C.sparkPath(sp, 70, 26));
    });
  }

  function renderInsights(cur, prev, r) {
    const out = [];
    const len = r[1] - r[0] + 1;
    if (prev) {
      const ch = prev.revenue ? cur.revenue / prev.revenue - 1 : 0;
      out.push({ ic: ch >= 0 ? "▲" : "▼", c: ch >= 0 ? "teal" : "rose", t: `Revenue ${ch >= 0 ? "up" : "down"} ${pct(Math.abs(ch), 1)}`, s: `${gbp(cur.revenue)} against ${gbp(prev.revenue)} in the previous ${len} days.` });
      if (!state.country) {
        let best = null;
        for (const [ci, v] of cur.byCountry) { const pv = (prev.byCountry.get(ci) || { revenue: 0 }).revenue, d = v.revenue - pv; if (!best || Math.abs(d) > Math.abs(best.d)) best = { ci, d }; }
        if (best) out.push({ ic: "◎", c: "plum", t: `${COUNTRIES[best.ci]} moved revenue most`, s: `${best.d >= 0 ? "Added" : "Lost"} ${gbp(Math.abs(best.d))} compared with the previous period.` });
      }
    } else {
      out.push({ ic: "£", c: "plum", t: `${gbp(cur.revenue)} from ${num(cur.orders)} orders`, s: `Across ${num(cur.customers)} known customers in ${len} days.` });
    }
    let bd = 0, bh = 0, bv = -1;
    cur.heat.forEach((row, d) => row.forEach((v, h) => { if (v > bv) { bv = v; bd = d; bh = h; } }));
    if (bv > 0) out.push({ ic: "◷", c: "marigold", t: `Busiest slot: ${WEEKDAYS[bd]} ${bh}:00`, s: `${num(bv)} orders were placed in that hour. Schedule campaigns and stock checks around it.` });
    const vals = [...cur.cust.values()].map(c => c.v).sort((x, y) => y - x);
    if (vals.length > 9) {
      const top = vals.slice(0, Math.ceil(vals.length * 0.1)), share = sum(top, x => x) / (sum(vals, x => x) || 1);
      out.push({ ic: "★", c: "plum", t: `Top 10% of customers bring ${pct(share)} of revenue`, s: `${num(top.length)} accounts. Protect them with account management and early access.` });
    }
    const newC = CUSTOMERS.filter(c => c.firstIdx >= r[0] && c.firstIdx <= r[1] && (!state.country || c.countryName === state.country)).length;
    if (state.sel && newC) out.push({ ic: "+", c: "teal", t: `${num(newC)} new customers`, s: `First purchase in this period: ${pct(newC / Math.max(cur.customers, 1))} of active customers.` });
    const an = D.anomalies.filter(x => x[0] >= r[0] && x[0] <= r[1]);
    if (an.length && !state.country) {
      const big = an.reduce((m, x) => Math.abs(x[1] - x[2]) > Math.abs(m[1] - m[2]) ? x : m, an[0]);
      out.push({ ic: "!", c: big[3] === "spike" ? "teal" : "rose", t: `${an.length} unusual trading day${an.length > 1 ? "s" : ""}`, s: `Largest: ${fmtDate(big[0])}, ${gbp(big[1])} against a typical ${gbp(big[2])}.` });
    }
    $("#insightSub").textContent = prev ? `Compared with the previous ${len} days.` : "Select a later or shorter period to compare with the one before.";
    $("#insights").innerHTML = out.slice(0, 5).map((x, i) => `<li style="--c:var(--${x.c});--c-soft:var(--${x.c}-soft);animation-delay:${i * 70}ms"><span class="ic">${x.ic}</span><div><b>${esc(x.t)}</b><br><span>${esc(x.s)}</span></div></li>`).join("");
  }

  function renderForecast() {
    const f = D.forecast, tot = sum(f, x => x[1]), lo = sum(f, x => x[2]), hi = sum(f, x => x[3]);
    const last30 = pulseCache && !state.country ? sum(pulseCache.slice(-30), d => d.v) : sum(dailySeries(-1).slice(-30), d => d.v);
    const ch = last30 ? tot / last30 - 1 : 0;
    $("#forecastBox").innerHTML = `<div class="fc-total">${gbp(tot)}</div>
      <p class="fc-sub">Expected revenue ${fmtShort(f[0][0])} to ${fmtDate(f[f.length - 1][0])}. <span class="${ch >= 0 ? "up-t" : "down-t"}">${ch >= 0 ? "▲" : "▼"} ${pct(Math.abs(ch), 1)}</span> on the last 30 days.</p>
      <div id="fcCols" class="chart"></div>
      <p class="fc-note">80% range ${gbp(lo)} to ${gbp(hi)}. Covers all markets.</p>`;
    const weeks = [];
    for (let i = 0; i < f.length; i += 7) weeks.push(f.slice(i, i + 7));
    if (weeks.length > 1 && weeks[weeks.length - 1].length < 4) weeks[weeks.length - 2] = weeks[weeks.length - 2].concat(weeks.pop());
    C.columns($("#fcCols"), weeks.map((w, i) => ({ label: `${fmtShort(w[0][0])} to ${fmtShort(w[w.length - 1][0])}`, short: `Week ${i + 1}`, v: sum(w, x => x[1]), color: "var(--marigold)" })), { fmt: v => gbp(v, 0) });
  }

  function renderHeat(cur) {
    let hmin = 23, hmax = 0;
    cur.heat.forEach(r => r.forEach((v, h) => { if (v) { hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); } }));
    if (hmin > hmax) { hmin = 7; hmax = 20; }
    const hours = []; for (let h = hmin; h <= hmax; h++) hours.push(h);
    C.heatmap($("#heatmap"), WEEKDAYS.map(d => d.slice(0, 3)), hours, cur.heat.map(r => hours.map(h => r[h])), v => `${num(v)} orders`);
  }

  function renderTopMarkets(cur) {
    const rows = [...cur.byCountry.entries()].map(([ci, v]) => ({ k: COUNTRIES[ci], label: COUNTRIES[ci], v: v.revenue, color: COUNTRIES[ci] === HOME ? "var(--plum)" : "var(--teal)" }))
      .sort((a, b) => b.v - a.v).slice(0, 8);
    C.barList($("#topMarkets"), rows, { fmt: v => gbp(v), onClick: k => { state.country = state.country === k ? "" : k; $("#country").value = state.country; pulseCache = null; renderAll(); } });
  }

  function renderOverview(fromBrush) {
    const r = range(), ci = cIdx(), cur = agg(r, ci), p = prevRange(r), prev = p ? agg(p, ci) : null;
    if (!fromBrush) renderPulse();
    renderKpis(cur, prev); renderInsights(cur, prev, r); renderForecast(); renderHeat(cur); renderTopMarkets(cur);
  }

  /* ---------------- products ---------------- */
  function scopeNote(view) {
    const id = "note-" + view, sec = $("#view-" + view);
    let n = $("#" + id);
    const active = state.sel || state.country;
    if (!active) { if (n) n.remove(); return; }
    if (!n) { n = document.createElement("p"); n.id = id; n.className = "hint"; n.style.margin = "-6px 0 14px"; $(".view-head", sec).appendChild(n); }
    n.textContent = "This page covers the full period and all markets. The date range and country filter apply to Overview and Markets.";
  }

  function renderProducts() {
    scopeNote("products");
    C.pareto($("#pareto"), PRODUCTS.map(p => p.revenue), PRODUCTS.map(p => ABC_HEX[p.abc]));
    const tot = sum(PRODUCTS, p => p.revenue);
    const cls = ["A", "B", "C"].map(k => { const g = PRODUCTS.filter(p => p.abc === k); return { k, n: g.length, rev: sum(g, p => p.revenue) }; });
    $("#abcNote").textContent = `${cls[0].n} A products (${pct(cls[0].n / PRODUCTS.length)} of the range) bring ${pct(cls[0].rev / tot)} of revenue.`;
    $("#abcMix").innerHTML = cls.map((c, i) => `<div class="mix-row"><span class="abc" style="--c:${ABC_COL[c.k]}">${c.k}</span><div class="mix-bars">
      <div class="mix-bar"><span>Products</span><span class="track"><span class="fill" style="--c:${ABC_COL[c.k]};width:${(c.n / PRODUCTS.length * 100).toFixed(1)}%;opacity:.5;animation-delay:${i * 120}ms"></span></span><b>${num(c.n)}</b></div>
      <div class="mix-bar"><span>Revenue</span><span class="track"><span class="fill" style="--c:${ABC_COL[c.k]};width:${(c.rev / tot * 100).toFixed(1)}%;animation-delay:${i * 120 + 60}ms"></span></span><b>${pct(c.rev / tot)}</b></div>
      </div></div>`).join("") + `<p class="hint" style="margin:4px 0 0">Keep A products always in stock and review C products for range rationalisation.</p>`;
    renderProdTable();
  }
  function prodRows() {
    const q = state.prodQ.toLowerCase();
    return PRODUCTS.filter(p => (!state.abc || p.abc === state.abc) && (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))).sort(cmp(state.prodSort));
  }
  function renderProdTable() {
    const st = state.prodSort, rows = prodRows();
    const t = $("#prodTable");
    t.innerHTML = `<thead><tr>${th("name", "Product", st, "", "text")}${th("abc", "Class", st, "", "text")}${th("revenue", "Revenue", st, "num")}${th("units", "Units", st, "num")}${th("orders", "Orders", st, "num")}${th("customers", "Customers", st, "num")}${th("price", "Avg price", st, "num")}${th("returnRate", "Returned", st)}<th>Monthly trend</th></tr></thead>
      <tbody>${rows.slice(0, 200).map(p => `<tr data-code="${esc(p.code)}"><td><span class="prod-name" title="${esc(p.name)}">${esc(nice(p.name))}</span> <span class="code">${esc(p.code)}</span></td>
      <td><span class="abc" style="--c:${ABC_COL[p.abc]}">${p.abc}</span></td><td class="num">${gbp(p.revenue)}</td><td class="num">${num(p.units)}</td><td class="num">${num(p.orders)}</td><td class="num">${num(p.customers)}</td><td class="num">${gbp(p.price)}</td>
      <td><span class="meter"><i style="width:${Math.min(100, p.returnRate * 1000).toFixed(0)}%"></i></span>${pct(p.returnRate, 1)}</td><td>${C.mini(p.monthly)}</td></tr>`).join("")}</tbody>`;
    sortTable(t, st, renderProdTable);
    $$("tbody tr", t).forEach(tr => tr.addEventListener("click", () => openProduct(tr.dataset.code)));
  }

  /* ---------------- baskets ---------------- */
  let net = null;
  function renderBaskets() {
    scopeNote("baskets");
    const pairs = new Map();
    RULES.forEach(r => { const k = r.a < r.b ? r.a + "|" + r.b : r.b + "|" + r.a; const p = pairs.get(k); if (!p || r.conf > p.conf) pairs.set(k, { a: r.a < r.b ? r.a : r.b, b: r.a < r.b ? r.b : r.a, lift: r.lift, count: r.count, conf: r.conf }); });
    const top = [...pairs.values()].sort((x, y) => y.lift * Math.sqrt(y.count) - x.lift * Math.sqrt(x.count)).slice(0, 60);
    const ids = [...new Set(top.flatMap(e => [e.a, e.b]))];
    const maxRev = Math.max(...ids.map(i => (PBY.get(i) || { revenue: 1 }).revenue));
    const nodes = ids.map(id => { const p = PBY.get(id) || { name: id, revenue: 0, abc: "C" }; return { id, label: nice(p.name), short: nice(p.name).slice(0, 18) + (p.name.length > 18 ? "…" : ""), r: 5 + 14 * Math.sqrt(p.revenue / maxRev), color: ABC_HEX[p.abc] }; });
    net = C.network($("#network"), nodes, top, {
      nodeTip: n => { const p = PBY.get(n.id); return p ? `${gbp(p.revenue)} revenue, class ${p.abc}` : ""; },
      onSelect: id => { state.reco = id; $("#recoSelect").value = id; renderReco(); }
    });
    const sel = $("#recoSelect");
    if (!sel.options.length) {
      const ants = [...new Set(RULES.map(r => r.a))].map(c => [c, nice(pname(c))]).sort((a, b) => a[1].localeCompare(b[1]));
      sel.innerHTML = `<option value="">Choose a product</option>` + ants.map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join("");
      sel.addEventListener("change", () => { state.reco = sel.value || null; renderReco(); });
      $("#liftMin").addEventListener("input", e => { state.liftMin = +e.target.value; $("#liftOut").textContent = e.target.value; renderRules(); });
    }
    if (!state.reco && top.length) { state.reco = top[0].a; state.recoQuiet = true; }
    sel.value = state.reco || "";
    renderReco(); renderRules();
  }
  function recoHtml(code, limit) {
    const list = RULES.filter(r => r.a === code).sort((x, y) => y.lift - x.lift).slice(0, limit || 6);
    if (!list.length) return `<p class="empty">No strong pairings found for this product yet.</p>`;
    const maxL = Math.max(...list.map(r => r.lift));
    return `<div class="reco">${list.map((r, i) => `<div class="reco-item" data-code="${esc(r.b)}"><b>${esc(nice(pname(r.b)))}</b><span class="lift">${r.lift.toFixed(1)}×</span>
      <span class="sub">${pct(r.conf)} of baskets with it also contain this. Seen together on ${num(r.count)} invoices.</span>
      <span class="track"><i style="width:${(r.lift / maxL * 100).toFixed(0)}%;animation-delay:${i * 60}ms"></i></span></div>`).join("")}</div>`;
  }
  function renderReco() {
    const code = state.reco;
    if (net) net.focus(state.recoQuiet ? null : code);
    state.recoQuiet = false;
    $("#recoList").innerHTML = code ? `<p class="hint" style="margin:0 0 10px">Customers who buy <b>${esc(nice(pname(code)))}</b> also buy:</p>` + recoHtml(code, 7) : `<p class="empty">Select a product in the map.</p>`;
    $$("#recoList .reco-item").forEach(x => x.addEventListener("click", () => openProduct(x.dataset.code)));
  }
  function renderRules() {
    const rows = RULES.filter(r => r.lift >= state.liftMin).slice(0, 200);
    $("#ruleTable").innerHTML = `<thead><tr><th>If a basket contains</th><th>It often also contains</th><th class="num">Invoices</th><th class="num">Support</th><th class="num">Confidence</th><th class="num">Lift</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-code="${esc(r.a)}"><td>${esc(nice(pname(r.a)))}</td><td>${esc(nice(pname(r.b)))}</td><td class="num">${num(r.count)}</td><td class="num">${pct(r.support, 2)}</td><td class="num">${pct(r.conf)}</td><td class="num"><b>${r.lift.toFixed(1)}</b></td></tr>`).join("")}</tbody>`;
    $$("#ruleTable tbody tr").forEach(tr => tr.addEventListener("click", () => { state.reco = tr.dataset.code; $("#recoSelect").value = state.reco; renderReco(); $("#recoPanel").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); }));
  }

  /* ---------------- customers ---------------- */
  function renderCustomers() {
    scopeNote("customers");
    const tot = sum(CUSTOMERS, c => c.monetary);
    $("#segTiles").innerHTML = SEGS.map(s => { const g = CUSTOMERS.filter(c => c.segName === s); return `<button class="seg" style="--c:${SEG_COLORS[s]}" data-seg="${esc(s)}" aria-pressed="${state.seg === s}"><span class="t">${esc(s)}</span><span class="n">${num(g.length)}</span><span class="s">${pct(sum(g, c => c.monetary) / tot, 1)} of revenue</span></button>`; }).join("");
    $$("#segTiles .seg").forEach(b => b.addEventListener("click", () => { state.seg = state.seg === b.dataset.seg ? null : b.dataset.seg; writeHash(); renderCustomers(); }));
    C.scatter($("#scatter"), CUSTOMERS.map(c => ({ x: c.frequency, y: c.monetary, color: SEG_COLORS[c.segName], on: !state.seg || c.segName === state.seg, c })), {
      tip: p => `<b>Customer ${esc(p.c.id)}</b><br>${esc(p.c.segName)}, ${esc(p.c.countryName)}<br>${num(p.c.frequency)} orders, ${gbp(p.c.monetary)}`,
      onClick: p => openCustomer(p.c.id)
    });
    renderCohort(); renderCustTable();
  }
  function renderCohort() {
    const co = D.cohorts, n = co.values[0] ? co.values[0].length : 0, g = $("#cohort");
    g.classList.remove("in");
    g.style.gridTemplateColumns = `70px 52px repeat(${n}, minmax(30px, 1fr))`;
    let h = `<div></div><div class="h">Size</div>` + [...Array(n)].map((_, k) => `<div class="h">${k === 0 ? "M0" : "+" + k}</div>`).join("");
    co.labels.forEach((lab, i) => {
      h += `<div class="rl">${lab}</div><div class="rl" style="text-align:right">${co.size[i]}</div>`;
      co.values[i].forEach((v, k) => {
        if (v < 0) { h += "<div></div>"; return; }
        const a = k === 0 ? 1 : Math.min(1, v / .6);
        h += `<div class="c ${a > .55 ? "dk" : ""}" style="background:color-mix(in srgb, var(--teal) ${(a * 100).toFixed(0)}%, var(--panel-2));transition-delay:${(i + k) * 12}ms" title="${lab} cohort, month ${k}: ${pct(v, 1)}">${k === 0 ? "" : pct(v)}</div>`;
      });
    });
    g.innerHTML = h;
    requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add("in")));
  }
  function custRows() {
    const q = state.custQ.trim();
    return CUSTOMERS.filter(c => (!state.seg || c.segName === state.seg) && (!q || c.id.includes(q))).sort(cmp(state.custSort));
  }
  function renderCustTable() {
    const st = state.custSort, rows = custRows(), t = $("#custTable");
    t.innerHTML = `<thead><tr>${th("id", "Customer", st, "", "text")}${th("countryName", "Country", st, "", "text")}${th("segName", "Segment", st, "", "text")}${th("frequency", "Orders", st, "num")}${th("monetary", "Revenue", st, "num")}${th("aov", "Avg order", st, "num")}${th("recency", "Days since order", st, "num")}${th("clv", "Next 12 months", st, "num")}${th("active", "Still active", st)}<th>Monthly spend</th></tr></thead>
      <tbody>${rows.slice(0, 200).map(c => `<tr data-id="${esc(c.id)}"><td><b>${esc(c.id)}</b></td><td>${esc(c.countryName)}</td><td><span class="pill" style="--c:${SEG_COLORS[c.segName]}">${esc(c.segName)}</span></td>
      <td class="num">${num(c.frequency)}</td><td class="num">${gbp(c.monetary)}</td><td class="num">${gbp(c.aov)}</td><td class="num">${num(c.recency)}</td><td class="num">${gbp(c.clv)}</td>
      <td><span class="meter" style="--c:${c.active > .6 ? "var(--teal)" : c.active > .3 ? "var(--marigold)" : "var(--rose)"}"><i style="width:${(c.active * 100).toFixed(0)}%"></i></span>${pct(c.active)}</td><td>${C.mini(c.monthly)}</td></tr>`).join("")}</tbody>`;
    sortTable(t, st, renderCustTable);
    $$("tbody tr", t).forEach(tr => tr.addEventListener("click", () => openCustomer(tr.dataset.id)));
  }

  /* ---------------- markets ---------------- */
  function marketRows() {
    const r = range(), cur = agg(r, -1), p = prevRange(r), prev = p ? agg(p, -1) : null;
    const rows = [...cur.byCountry.entries()].map(([ci, v]) => {
      const pv = prev ? (prev.byCountry.get(ci) || { revenue: 0 }).revenue : null;
      let canc = 0; for (const c of CANC) if (c[1] === ci && c[0] >= r[0] && c[0] <= r[1]) canc += c[2];
      return { country: COUNTRIES[ci], revenue: v.revenue, share: v.revenue / (cur.revenue || 1), orders: v.orders, customers: v.cust.size, aov: v.revenue / v.orders, growth: pv ? v.revenue / pv - 1 : null, cancelled: canc };
    });
    return { rows, cur };
  }
  function renderMarkets() {
    const { rows, cur } = marketRows();
    const home = rows.find(r => r.country === HOME) || { revenue: 0 }, intl = cur.revenue - home.revenue;
    $("#intlNote").textContent = `${pct(intl / (cur.revenue || 1), 1)} of revenue comes from ${rows.length - 1} international markets.`;
    C.donut($("#donut"), [{ label: HOME, v: home.revenue, color: "var(--plum)" }, { label: "International", v: intl, color: "var(--teal)" }], [gbp(cur.revenue), "total revenue"]);
    const topA = rows.filter(r => r.orders >= 5).sort((a, b) => b.revenue - a.revenue).slice(0, 14).sort((a, b) => b.aov - a.aov);
    C.columns($("#aovBars"), topA.map(r => ({ label: r.country, short: r.country.length > 12 ? r.country.slice(0, 11) + "…" : r.country, v: r.aov, note: `${num(r.orders)} orders`, color: r.country === HOME ? "var(--plum)" : "var(--teal)" })), { fmt: (v, d) => gbp(v, d) });
    const st = state.mktSort, t = $("#marketTable");
    const sorted = rows.slice().sort((a, b) => { const x = a[st.k] == null ? -Infinity : a[st.k], y = b[st.k] == null ? -Infinity : b[st.k]; return (typeof x === "string" ? x.localeCompare(y) : x - y) * st.d; });
    t.innerHTML = `<thead><tr>${th("country", "Market", st, "", "text")}${th("revenue", "Revenue", st, "num")}${th("share", "Share", st, "num")}${th("orders", "Orders", st, "num")}${th("customers", "Customers", st, "num")}${th("aov", "Avg order", st, "num")}${th("growth", "Growth", st, "num")}${th("cancelled", "Cancelled", st, "num")}</tr></thead>
      <tbody>${sorted.map(r => `<tr data-c="${esc(r.country)}"><td><b>${esc(r.country)}</b></td><td class="num">${gbp(r.revenue)}</td><td class="num">${pct(r.share, 1)}</td><td class="num">${num(r.orders)}</td><td class="num">${num(r.customers)}</td><td class="num">${gbp(r.aov)}</td>
      <td class="num ${r.growth == null ? "" : r.growth >= 0 ? "up-t" : "down-t"}">${r.growth == null ? "–" : (r.growth >= 0 ? "▲ " : "▼ ") + pct(Math.abs(r.growth), 0)}</td><td class="num">${gbp(r.cancelled)}</td></tr>`).join("")}</tbody>`;
    sortTable(t, st, renderMarkets);
    $$("tbody tr", t).forEach(tr => tr.addEventListener("click", () => { state.country = tr.dataset.c; $("#country").value = state.country; pulseCache = null; setView("overview"); updateRangeUi(); }));
  }

  /* ---------------- operations ---------------- */
  function renderOperations() {
    const q = D.quality, raw = q[0].remaining;
    $("#funnel").innerHTML = `<div class="funnel">${q.map((s, i) => `<div class="fstep"><span class="lab">${esc(s.rule)}</span><span class="rm">${i && s.removed ? "−" + num(s.removed) : ""}</span>
      <span class="bar" style="width:${Math.max(18, s.remaining / raw * 100).toFixed(1)}%;animation-delay:${i * 110}ms;${i === q.length - 1 ? "background:var(--teal)" : ""}">${num(s.remaining)} rows</span>
      ${s.detail ? `<span class="det">${esc(s.detail)}</span>` : ""}</div>`).join("")}</div>
      <p class="hint" style="margin:12px 0 0">${pct(q[q.length - 1].remaining / raw, 1)} of raw lines feed customer analytics. Guest checkouts still count towards revenue.</p>`;
    const months = D.meta.months, byM = months.map(() => 0);
    CANC.forEach(c => { const m = dateOf(c[0]).toISOString().slice(0, 7), k = months.indexOf(m); if (k >= 0) byM[k] += c[2]; });
    $("#cancelNote").textContent = `${gbp(D.kpis.cancelled_value)} cancelled in total, ${pct(D.kpis.cancellation_rate, 1)} of gross sales.`;
    C.columns($("#cancelChart"), months.map((m, i) => ({ label: m, short: new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }), v: byM[i], color: "var(--rose)" })), { fmt: (v, d) => gbp(v, d) });
    const ret = PRODUCTS.filter(p => p.units >= 100 && p.returnRate > 0).sort((a, b) => b.returnRate - a.returnRate).slice(0, 12);
    $("#returnTable").innerHTML = `<thead><tr><th>Product</th><th class="num">Units sold</th><th>Returned</th></tr></thead><tbody>${ret.map(p => `<tr data-code="${esc(p.code)}"><td><span class="prod-name">${esc(nice(p.name))}</span></td><td class="num">${num(p.units)}</td><td><span class="meter"><i style="width:${Math.min(100, p.returnRate / ret[0].returnRate * 100).toFixed(0)}%"></i></span>${pct(p.returnRate, 1)}</td></tr>`).join("")}</tbody>`;
    $$("#returnTable tbody tr").forEach(tr => tr.addEventListener("click", () => openProduct(tr.dataset.code)));
    $("#anomList").innerHTML = D.anomalies.length ? D.anomalies.map(a => `<li data-i="${a[0]}" style="--c:var(--${a[3] === "spike" ? "teal" : "rose"})"><i></i><div><b>${fmtDate(a[0])}, ${WEEKDAYS[wd(a[0])]}</b><span>${a[3] === "spike" ? "Spike" : "Drop"}: ${gbp(a[1])} against a typical ${gbp(a[2])}</span></div><b class="${a[3] === "spike" ? "up-t" : "down-t"}">${a[2] ? (a[1] >= a[2] ? "+" : "") + pct(a[1] / a[2] - 1) : ""}</b></li>`).join("") : `<li>No unusual days detected.</li>`;
    $$("#anomList li[data-i]").forEach(li => li.addEventListener("click", () => { const i = +li.dataset.i; state.sel = [Math.max(0, i - 10), Math.min(nDays - 1, i + 10)]; state.country = ""; $("#country").value = ""; pulseCache = null; setView("overview"); updateRangeUi(); }));
  }

  /* ---------------- drawer ---------------- */
  let lastFocus = null;
  function openDrawer(html, after) {
    lastFocus = document.activeElement;
    $("#drawerBody").innerHTML = html;
    $("#scrim").hidden = false;
    const d = $("#drawer"); d.classList.add("open"); d.setAttribute("aria-hidden", "false");
    if (after) after();
    $("#drawerClose").focus();
  }
  function closeDrawer() {
    const d = $("#drawer"); if (!d.classList.contains("open")) return;
    d.classList.remove("open"); d.setAttribute("aria-hidden", "true"); $("#scrim").hidden = true;
    if (lastFocus) lastFocus.focus();
  }
  function openProduct(code) {
    const p = PBY.get(code); if (!p) return;
    openDrawer(`<div class="d-eyebrow">Stock code ${esc(p.code)} <span class="abc" style="--c:${ABC_COL[p.abc]};width:20px;height:20px;font-size:.7rem;margin-left:6px">${p.abc}</span></div>
      <h2 class="d-title" id="drawerTitle">${esc(nice(p.name))}</h2>
      <div class="d-grid"><div class="d-stat"><span>Revenue</span><b>${gbp(p.revenue)}</b></div><div class="d-stat"><span>Units</span><b>${num(p.units)}</b></div><div class="d-stat"><span>Orders</span><b>${num(p.orders)}</b></div>
      <div class="d-stat"><span>Customers</span><b>${num(p.customers)}</b></div><div class="d-stat"><span>Avg price</span><b>${gbp(p.price)}</b></div><div class="d-stat"><span>Returned</span><b>${pct(p.returnRate, 1)}</b></div></div>
      <div class="d-sec"><h3>Revenue by month</h3><div id="dChart" class="chart"></div></div>
      <div class="d-sec"><h3>Frequently bought together</h3>${recoHtml(code, 5)}</div>
      <div class="d-btns"><button class="btn" id="dMap">Show in basket map</button></div>`, () => {
      C.columns($("#dChart"), D.meta.months.map((m, i) => ({ label: m, short: m.slice(2), v: p.monthly[i], color: "var(--plum)" })), { fmt: (v, d) => gbp(v, d) });
      $$("#drawerBody .reco-item").forEach(x => x.addEventListener("click", () => openProduct(x.dataset.code)));
      $("#dMap").addEventListener("click", () => { closeDrawer(); state.reco = code; setView("baskets"); });
    });
  }
  function openCustomer(id) {
    const c = CBY.get(id); if (!c) return;
    const action = D.segment_actions[c.segName];
    const summary = [`Customer ${c.id} (${c.countryName})`, `Segment: ${c.segName}`, `${c.frequency} orders, ${gbp(c.monetary)} revenue, average order ${gbp(c.aov)}`,
      `Customer since ${c.first}; last order ${c.last} (${c.recency} days ago); orders every ~${Math.round(c.interval)} days`,
      `Chance still active: ${pct(c.active)}; expected next 12 months: ${gbp(c.clv)}`, `Favourite products: ${c.favourites.map(nice).join(", ")}`, `Recommended action: ${action}`].join("\n");
    openDrawer(`<div class="d-eyebrow">${esc(c.countryName)}, customer since ${esc(c.first)}</div>
      <h2 class="d-title" id="drawerTitle">Customer ${esc(c.id)}</h2>
      <span class="pill" style="--c:${SEG_COLORS[c.segName]}">${esc(c.segName)}</span>
      <div class="d-grid"><div class="d-stat"><span>Revenue</span><b>${gbp(c.monetary)}</b></div><div class="d-stat"><span>Orders</span><b>${num(c.frequency)}</b></div><div class="d-stat"><span>Avg order</span><b>${gbp(c.aov)}</b></div>
      <div class="d-stat"><span>Last order</span><b>${num(c.recency)} days</b></div><div class="d-stat"><span>Still active</span><b>${pct(c.active)}</b></div><div class="d-stat"><span>Next 12 months</span><b>${gbp(c.clv)}</b></div></div>
      <div class="d-sec"><h3>Spend by month</h3><div id="dChart" class="chart"></div></div>
      <div class="d-sec"><h3>Favourite products</h3><ol class="d-list">${c.favourites.map(f => `<li>${esc(nice(f))}</li>`).join("")}</ol></div>
      <div class="d-sec d-action"><h3>Recommended action</h3><p>${esc(action)}</p></div>
      <div class="d-btns"><button class="btn" id="dCopy">Copy account summary</button></div>`, () => {
      C.columns($("#dChart"), D.meta.months.map((m, i) => ({ label: m, short: m.slice(2), v: c.monthly[i], color: SEG_COLORS[c.segName] })), { fmt: (v, d) => gbp(v, d) });
      $("#dCopy").addEventListener("click", () => copyText(summary, "Account summary copied"));
    });
  }
  function copyText(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Copy is blocked in this browser"); } ta.remove(); }
  }

  /* ---------------- command palette ---------------- */
  let palItems = [], palSel = 0;
  const PAGE_LABELS = { overview: "Overview", products: "Products", baskets: "Basket analysis", customers: "Customers", markets: "Markets", operations: "Data and returns" };
  function openPalette() { $("#palette").hidden = false; const i = $("#paletteInput"); i.value = ""; filterPalette(""); i.focus(); }
  function closePalette() { $("#palette").hidden = true; }
  function filterPalette(q) {
    q = q.toLowerCase().trim();
    const all = [].concat(
      VIEWS.map(v => ({ t: PAGE_LABELS[v], s: "Page", go: () => setView(v) })),
      COUNTRIES.map(c => ({ t: c, s: "Market filter", go: () => { state.country = c; $("#country").value = c; pulseCache = null; setView("overview"); updateRangeUi(); } })),
      PRODUCTS.map(p => ({ t: nice(p.name), s: "Product " + p.code, k: p.code.toLowerCase(), go: () => openProduct(p.code) })),
      CUSTOMERS.map(c => ({ t: "Customer " + c.id, s: c.segName + ", " + c.countryName, k: c.id, go: () => openCustomer(c.id) }))
    );
    palItems = (q ? all.filter(x => x.t.toLowerCase().includes(q) || (x.k && x.k.includes(q))) : all.slice(0, 6 + 4)).slice(0, 40);
    palSel = 0; paintPalette();
  }
  function paintPalette() {
    $("#paletteList").innerHTML = palItems.length ? palItems.map((x, i) => `<li role="option" aria-selected="${i === palSel}" data-i="${i}"><span>${esc(x.t)}</span><small>${esc(x.s)}</small></li>`).join("") : `<li><span>No matches</span></li>`;
    $$("#paletteList li[data-i]").forEach(li => li.addEventListener("click", () => runPalette(+li.dataset.i)));
    const on = $("#paletteList li[aria-selected=true]"); if (on) on.scrollIntoView({ block: "nearest" });
  }
  function runPalette(i) { const x = palItems[i]; if (!x) return; closePalette(); x.go(); }

  /* ---------------- print ---------------- */
  function printReport() {
    const [a, b] = range();
    $("#printRange").textContent = `${fmtDate(a)} to ${fmtDate(b)}${state.country ? ", " + state.country : ""}. Generated ${new Date().toLocaleDateString("en-GB")}`;
    VIEWS.forEach(v => { try { renderView(v); } catch (e) { /* keep printing */ } });
    setTimeout(() => window.print(), 400);
  }

  /* ---------------- orchestration ---------------- */
  function renderView(v, fromBrush) {
    if (v === "overview") renderOverview(fromBrush);
    else if (v === "products") renderProducts();
    else if (v === "baskets") renderBaskets();
    else if (v === "customers") renderCustomers();
    else if (v === "markets") renderMarkets();
    else if (v === "operations") renderOperations();
  }
  function renderAll(fromBrush) { updateRangeUi(); renderView(state.view, fromBrush); writeHash(); }

  function bindStatic() {
    $("#prodSearch").addEventListener("input", e => { state.prodQ = e.target.value; renderProdTable(); });
    $$("#abcChips button").forEach(b => b.addEventListener("click", () => { state.abc = b.dataset.abc; $$("#abcChips button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderProdTable(); }));
    $("#custSearch").addEventListener("input", e => { state.custQ = e.target.value; renderCustTable(); });
    $$("[data-export]").forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.export;
      if (k === "products") exportCsv("products", ["stock_code", "description", "abc_class", "revenue", "units", "orders", "customers", "avg_price", "return_rate"], prodRows().map(p => [p.code, p.name, p.abc, p.revenue, p.units, p.orders, p.customers, p.price, p.returnRate]));
      if (k === "rules") exportCsv("basket-rules", ["antecedent_code", "antecedent", "consequent_code", "consequent", "invoices", "support", "confidence", "lift"], RULES.filter(r => r.lift >= state.liftMin).map(r => [r.a, pname(r.a), r.b, pname(r.b), r.count, r.support, r.conf, r.lift]));
      if (k === "customers") exportCsv("customers", ["customer_id", "country", "segment", "orders", "revenue", "avg_order", "recency_days", "clv_12m", "active_probability", "first_purchase", "last_purchase", "action"], custRows().map(c => [c.id, c.countryName, c.segName, c.frequency, c.monetary, c.aov, c.recency, c.clv, c.active, c.first, c.last, D.segment_actions[c.segName]]));
      if (k === "markets") exportCsv("markets", ["country", "revenue", "share", "orders", "customers", "avg_order", "growth", "cancelled"], marketRows().rows.map(r => [r.country, r.revenue.toFixed(2), r.share.toFixed(4), r.orders, r.customers, r.aov.toFixed(2), r.growth == null ? "" : r.growth.toFixed(4), r.cancelled.toFixed(2)]));
    }));
    $("#drawerClose").addEventListener("click", closeDrawer);
    $("#scrim").addEventListener("click", closeDrawer);
    $("#cmdOpen").addEventListener("click", openPalette);
    $("#palette").addEventListener("click", e => { if (e.target.id === "palette") closePalette(); });
    $("#paletteInput").addEventListener("input", e => filterPalette(e.target.value));
    $("#paletteInput").addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { palSel = Math.min(palItems.length - 1, palSel + 1); paintPalette(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { palSel = Math.max(0, palSel - 1); paintPalette(); e.preventDefault(); }
      else if (e.key === "Enter") runPalette(palSel);
    });
    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#palette").hidden ? openPalette() : closePalette(); return; }
      if (e.key === "Escape") { closePalette(); closeDrawer(); return; }
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$("#palette").hidden) return;
      if (/^[1-6]$/.test(e.key)) setView(VIEWS[+e.key - 1]);
      else if (e.key === "d" || e.key === "D") toggleTheme();
      else if (e.key === "/") { e.preventDefault(); openPalette(); }
    });
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state.view === "overview") renderPulse(); }, 250); });
  }

  const savedTheme = store.get("theme", null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";

  readHash();
  initHeader();
  bindStatic();
  updateRangeUi();
  setView(state.view);
})();
