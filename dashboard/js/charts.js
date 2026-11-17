/* BasketLens: dependency-free SVG charts. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svg(container, w, h) {
    container.innerHTML = "";
    return el("svg", { viewBox: `0 0 ${w} ${h}`, role: "img" }, container);
  }
  const gbp = (n, d) => {
    const a = Math.abs(n), s = n < 0 ? "-" : "";
    if (a >= 1e6) return s + "£" + (a / 1e6).toFixed(d == null ? 2 : d) + "m";
    if (a >= 1e4) return s + "£" + (a / 1e3).toFixed(d == null ? 1 : d) + "k";
    if (a >= 1e3) return s + "£" + (a / 1e3).toFixed(d == null ? 2 : d) + "k";
    return s + "£" + a.toFixed(a < 10 ? 2 : 0);
  };
  const num = n => Math.round(n).toLocaleString("en-GB");
  const pct = (x, d) => (x * 100).toFixed(d == null ? 0 : d) + "%";
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function niceTicks(max, n) {
    const raw = Math.max(max, 1e-9) / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(c => c * n >= max);
    return [step, step * Math.ceil(max / step)];
  }
  function setLen(path) { if (path.getTotalLength) path.style.setProperty("--len", Math.ceil(path.getTotalLength() + 4)); }

  /* tooltip */
  let tipEl;
  function tip(html, e) {
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; document.body.appendChild(tipEl); }
    if (!html) { tipEl.classList.remove("show"); return; }
    tipEl.innerHTML = html;
    const x = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8);
    const y = Math.min(e.clientY + 14, innerHeight - tipEl.offsetHeight - 8);
    tipEl.style.left = x + "px"; tipEl.style.top = y + "px"; tipEl.classList.add("show");
  }
  function bindTip(node, html) {
    node.addEventListener("mousemove", e => tip(typeof html === "function" ? html(e) : html, e));
    node.addEventListener("mouseleave", () => tip(null));
  }

  /* ---------- pulse: daily bars + 7-day avg + forecast + anomalies + brush ---------- */
  function pulse(container, o) {
    const narrow = container.clientWidth && container.clientWidth < 700;
    const W = narrow ? 720 : 1200, H = narrow ? 400 : 300, L = 54, R = 14, T = 16, B = 30;
    const s = svg(container, W, H);
    const n = o.days.length, total = n + (o.forecast ? o.forecast.length : 0);
    const x = i => L + (i + 0.5) * (W - L - R) / total;
    const bw = Math.max(1, (W - L - R) / total * 0.8);
    const fcMax = o.forecast ? Math.max(0, ...o.forecast.map(f => f[3])) : 0;
    const [step, maxV] = niceTicks(Math.max(fcMax, ...o.days.map(d => d.v)) * 1.03, 5);
    const y = v => T + (H - T - B) * (1 - v / maxV);
    const grid = el("g", { class: "grid" }, s);
    for (let v = 0; v <= maxV + 1e-6; v += step) {
      el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }, grid);
      el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end" }, s).textContent = gbp(v, 0);
    }
    // month ticks
    let lastM = -1;
    o.days.forEach((d, i) => {
      const m = d.date.getUTCMonth();
      if (m !== lastM) {
        lastM = m;
        el("text", { x: x(i), y: H - 8 }, s).textContent = d.date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) + (m === 0 ? " " + d.date.getUTCFullYear() : "");
      }
    });
    const bars = el("g", {}, s);
    const barEls = o.days.map((d, i) => el("rect", { x: x(i) - bw / 2, y: y(d.v), width: bw, height: Math.max(0, y(0) - y(d.v)), class: "bar grow-y", style: `animation-delay:${Math.min(i * 2, 700)}ms` }, bars));
    // 7-day average
    const avg = o.days.map((d, i) => { let a = 0, c = 0; for (let j = Math.max(0, i - 6); j <= i; j++) { a += o.days[j].v; c++; } return a / c; });
    const ap = el("path", { d: avg.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join(""), class: "avg draw" }, s);
    setLen(ap);
    // forecast
    if (o.forecast && o.forecast.length) {
      const fx = i => x(n + i);
      const band = o.forecast.map((f, i) => fx(i).toFixed(1) + "," + y(f[3]).toFixed(1)).join("L") + "L" +
        o.forecast.map((f, i) => fx(i).toFixed(1) + "," + y(f[2]).toFixed(1)).reverse().join("L");
      el("path", { d: "M" + band + "Z", class: "band" }, s);
      const fcSmooth = o.forecast.map((f, i) => { let a = 0, c = 0; for (let j = Math.max(0, i - 6); j <= i; j++) { a += o.forecast[j][1]; c++; } return a / c; });
      const fp = el("path", { d: `M${x(n - 1)},${y(avg[n - 1])}` + fcSmooth.map((v, i) => "L" + fx(i).toFixed(1) + "," + y(v).toFixed(1)).join(""), class: "fc draw" }, s);
      setLen(fp);
      el("line", { x1: x(n - 0.5), x2: x(n - 0.5), y1: T, y2: H - B, stroke: "var(--line)", "stroke-dasharray": "4 4" }, s);
      el("text", { x: x(n) + 4, y: T + 10, class: "strong" }, s).textContent = "Forecast";
    }
    // anomalies
    (o.anomalies || []).forEach(a => {
      const i = a[0]; if (i >= n) return;
      const g = el("g", { class: "pin" }, s);
      const yy = Math.min(y(a[1]), y(0) - 6) - 8;
      el("line", { x1: x(i), x2: x(i), y1: yy, y2: y(a[1]), stroke: a[3] === "spike" ? "var(--teal)" : "var(--rose)", "stroke-width": 1.5 }, g);
      el("circle", { cx: x(i), cy: yy, r: 5.5, fill: a[3] === "spike" ? "var(--teal)" : "var(--rose)" }, g);
      bindTip(g, `<b>${o.fmtDate(i)}: unusual ${a[3]}</b><br>Revenue ${gbp(a[1])}<br>Typical for this weekday ${gbp(a[2])}`);
      g.addEventListener("click", ev => { ev.stopPropagation(); o.onPin && o.onPin(i); });
    });
    // selection
    const sel = el("rect", { class: "sel-rect", y: T, height: H - T - B, x: 0, width: 0 }, s);
    const hover = el("line", { class: "hover-line", y1: T, y2: H - B, x1: -10, x2: -10 }, s);
    function paintSel(a, b) {
      if (a == null) { sel.setAttribute("width", 0); barEls.forEach(r => r.classList.add("in")); return; }
      sel.setAttribute("x", x(a) - bw); sel.setAttribute("width", x(b) - x(a) + bw * 2);
      barEls.forEach((r, i) => r.classList.toggle("in", i >= a && i <= b));
    }
    paintSel(o.sel ? o.sel[0] : null, o.sel ? o.sel[1] : null);
    const toIdx = e => {
      const r = s.getBoundingClientRect();
      const vx = (e.clientX - r.left) / r.width * W;
      return Math.max(0, Math.min(n - 1, Math.floor((vx - L) / ((W - L - R) / total))));
    };
    let drag = null;
    s.addEventListener("pointerdown", e => { if (e.target.closest(".pin")) return; drag = toIdx(e); s.setPointerCapture(e.pointerId); paintSel(drag, drag); });
    s.addEventListener("pointermove", e => {
      const i = toIdx(e);
      hover.setAttribute("x1", x(i)); hover.setAttribute("x2", x(i));
      if (drag != null) { paintSel(Math.min(drag, i), Math.max(drag, i)); tip(null); }
      else if (!e.target.closest(".pin")) tip(`<b>${o.fmtDate(i)}</b><br>Revenue ${gbp(o.days[i].v)}<br>7-day average ${gbp(avg[i])}`, e);
    });
    s.addEventListener("pointerleave", () => { tip(null); hover.setAttribute("x1", -10); hover.setAttribute("x2", -10); });
    s.addEventListener("pointerup", e => {
      if (drag == null) return;
      const i = toIdx(e), a = Math.min(drag, i), b = Math.max(drag, i);
      drag = null;
      if (b - a < 2) { o.onSelect(null); paintSel(null); } else o.onSelect([a, b]);
    });
    s.addEventListener("dblclick", () => { o.onSelect(null); paintSel(null); });
    return { paintSel };
  }

  /* ---------- small sparkline path ---------- */
  function sparkPath(values, w, h, area) {
    const max = Math.max(1e-9, ...values), min = Math.min(0, ...values);
    const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * w, h - 2 - ((v - min) / (max - min || 1)) * (h - 4)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
    return area ? d + `L${w},${h}L0,${h}Z` : d;
  }
  function mini(values) {
    return `<svg class="mini" viewBox="0 0 90 24" aria-hidden="true"><path class="area" d="${sparkPath(values, 90, 24, true)}"/><path d="${sparkPath(values, 90, 24)}"/></svg>`;
  }

  /* ---------- heatmap (HTML grid) ---------- */
  function heatmap(container, rows, cols, matrix, fmt) {
    const max = Math.max(1, ...matrix.flat());
    let h = `<div class="heat" style="grid-template-columns:90px repeat(${cols.length}, 1fr)"><div></div>` + cols.map(c => `<div class="h">${c}</div>`).join("");
    rows.forEach((r, i) => {
      h += `<div class="d">${r}</div>` + matrix[i].map((v, j) => `<div class="c" style="--p:${Math.round(Math.sqrt(v / max) * 100)}%" data-tip="${r} ${cols[j]}:00, ${fmt(v)}"></div>`).join("");
    });
    container.innerHTML = h + "</div>";
    container.querySelectorAll(".c").forEach(c => bindTip(c, () => `<b>${c.dataset.tip}</b>`));
  }

  /* ---------- horizontal bars (HTML) ---------- */
  function barList(container, rows, opts) {
    const max = Math.max(1e-9, ...rows.map(r => r.v));
    container.innerHTML = `<div class="bars">${rows.map((r, i) => `
      <div class="row" data-k="${r.k}"><span class="name" title="${r.label}">${r.label}</span>
      <span class="track"><span class="fill" style="width:${(r.v / max * 100).toFixed(1)}%;--c:${r.color || "var(--plum)"};animation-delay:${i * 50}ms"></span></span>
      <span class="v">${opts.fmt(r.v)}</span></div>`).join("")}</div>`;
    if (opts.onClick) container.querySelectorAll(".row").forEach(rw => rw.addEventListener("click", () => opts.onClick(rw.dataset.k)));
  }

  /* ---------- pareto: product revenue bars + cumulative line ---------- */
  function pareto(container, values, colors) {
    const W = 640, H = 260, L = 44, R = 40, T = 12, B = 28;
    const s = svg(container, W, H);
    const n = values.length, tot = values.reduce((a, b) => a + b, 0) || 1;
    const max = niceMax(Math.max(...values));
    const bw = (W - L - R) / n;
    const y = v => T + (H - T - B) * (1 - v / max), y2 = v => T + (H - T - B) * (1 - v);
    const grid = el("g", { class: "grid" }, s);
    [0, .25, .5, .75, 1].forEach(v => {
      el("line", { x1: L, x2: W - R, y1: y2(v), y2: y2(v) }, grid);
      el("text", { x: W - R + 6, y: y2(v) + 4 }, s).textContent = pct(v);
      el("text", { x: L - 6, y: y(max * v) + 4, "text-anchor": "end" }, s).textContent = gbp(max * v, 0);
    });
    let cum = 0;
    const pts = [];
    values.forEach((v, i) => {
      el("rect", { x: L + i * bw + .5, y: y(v), width: Math.max(bw - 1, .6), height: y(0) - y(v), fill: colors[i], class: "grow-y", style: `animation-delay:${Math.min(i * 6, 600)}ms` }, s);
      cum += v; pts.push([L + (i + .5) * bw, y2(cum / tot)]);
    });
    const p = el("path", { d: pts.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1)).join(""), fill: "none", stroke: "var(--marigold)", "stroke-width": 2.5, class: "draw" }, s);
    setLen(p);
    el("line", { x1: L, x2: W - R, y1: y2(.8), y2: y2(.8), stroke: "var(--marigold)", "stroke-dasharray": "3 4" }, s);
    el("text", { x: L + 6, y: y2(.8) - 6, class: "strong" }, s).textContent = "80% of revenue";
    el("text", { x: (W + L - R) / 2, y: H - 6, "text-anchor": "middle" }, s).textContent = "Products ranked by revenue";
  }

  /* ---------- donut ---------- */
  function donut(container, parts, centre) {
    const W = 300, H = 230, cx = 150, cy = 112, r = 86, rin = 56;
    const s = svg(container, W, H);
    const tot = parts.reduce((a, p) => a + p.v, 0) || 1;
    let a0 = -Math.PI / 2;
    parts.forEach((p, i) => {
      const a1 = a0 + (p.v / tot) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const pt = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1 - 0.0001, r), [x2, y2] = pt(a1 - 0.0001, rin), [x3, y3] = pt(a0, rin);
      const path = el("path", { d: `M${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${rin},${rin} 0 ${large} 0 ${x3},${y3}Z`, fill: p.color, style: `opacity:0;transition:opacity .5s ${i * 150}ms` }, s);
      requestAnimationFrame(() => requestAnimationFrame(() => { path.style.opacity = 1; }));
      bindTip(path, `<b>${p.label}</b><br>${gbp(p.v)} (${pct(p.v / tot, 1)})`);
      a0 = a1;
    });
    el("text", { x: cx, y: cy, "text-anchor": "middle", style: "font:700 22px var(--display);fill:var(--ink)" }, s).textContent = centre[0];
    el("text", { x: cx, y: cy + 18, "text-anchor": "middle" }, s).textContent = centre[1];
    const lg = el("g", {}, s);
    parts.forEach((p, i) => {
      el("rect", { x: 20 + i * 140, y: H - 14, width: 10, height: 10, rx: 2, fill: p.color }, lg);
      el("text", { x: 36 + i * 140, y: H - 5 }, lg).textContent = `${p.label} ${pct(p.v / tot)}`;
    });
  }

  /* ---------- vertical bars ---------- */
  function columns(container, rows, opts) {
    const W = 640, H = 240, L = 50, R = 10, T = 12, B = 52;
    const s = svg(container, W, H);
    const max = niceMax(Math.max(1e-9, ...rows.map(r => r.v)));
    const bw = (W - L - R) / rows.length;
    const y = v => T + (H - T - B) * (1 - v / max);
    const grid = el("g", { class: "grid" }, s);
    for (let k = 0; k <= 4; k++) {
      el("line", { x1: L, x2: W - R, y1: y(max * k / 4), y2: y(max * k / 4) }, grid);
      el("text", { x: L - 6, y: y(max * k / 4) + 4, "text-anchor": "end" }, s).textContent = opts.fmt(max * k / 4, 0);
    }
    rows.forEach((r, i) => {
      const rect = el("rect", { x: L + i * bw + bw * .15, y: y(r.v), width: bw * .7, height: y(0) - y(r.v), rx: 4, fill: r.color || "var(--plum)", class: "grow-y", style: `animation-delay:${i * 40}ms` }, s);
      bindTip(rect, `<b>${r.label}</b><br>${opts.fmt(r.v)}${r.note ? "<br>" + r.note : ""}`);
      const t = el("text", { x: L + (i + .5) * bw, y: H - B + 14, "text-anchor": "end", transform: `rotate(-35 ${L + (i + .5) * bw} ${H - B + 14})` }, s);
      t.textContent = r.short || r.label;
    });
  }

  /* ---------- scatter (log-log) ---------- */
  function scatter(container, pts, opts) {
    const W = 640, H = 320, L = 52, R = 12, T = 12, B = 36;
    const s = svg(container, W, H);
    s.classList.add("scatter");
    const lx = v => Math.log10(Math.max(v, 1)), ly = v => Math.log10(Math.max(v, 1));
    const xmax = Math.ceil(lx(Math.max(...pts.map(p => p.x)))), ymax = Math.ceil(ly(Math.max(...pts.map(p => p.y))));
    const ymin = Math.floor(ly(Math.min(...pts.map(p => p.y))));
    const X = v => L + (lx(v) / Math.max(xmax, 1)) * (W - L - R);
    const Y = v => T + (1 - (ly(v) - ymin) / Math.max(ymax - ymin, 1)) * (H - T - B);
    const grid = el("g", { class: "grid" }, s);
    for (let e = 0; e <= xmax; e++) { el("line", { x1: X(10 ** e), x2: X(10 ** e), y1: T, y2: H - B }, grid); el("text", { x: X(10 ** e), y: H - B + 14, "text-anchor": "middle" }, s).textContent = num(10 ** e); }
    for (let e = ymin; e <= ymax; e++) { el("line", { x1: L, x2: W - R, y1: Y(10 ** e), y2: Y(10 ** e) }, grid); el("text", { x: L - 6, y: Y(10 ** e) + 4, "text-anchor": "end" }, s).textContent = gbp(10 ** e, 0); }
    el("text", { x: (W + L) / 2, y: H - 4, "text-anchor": "middle" }, s).textContent = "Orders (log scale)";
    const g = el("g", {}, s);
    pts.forEach((p, i) => {
      const jitter = ((i * 9301 + 49297) % 233280) / 233280 - .5;
      const c = el("circle", { cx: X(p.x) + jitter * 6, cy: Y(p.y), r: 3.2, fill: p.color, class: "dot" + (p.on ? " on" : "") }, g);
      c.style.opacity = 0; c.style.transition = `opacity .4s ${Math.min(i, 600) * 1.2}ms, r .2s`;
      requestAnimationFrame(() => requestAnimationFrame(() => { c.style.opacity = ""; }));
      bindTip(c, opts.tip(p));
      c.addEventListener("click", () => opts.onClick && opts.onClick(p));
    });
    s.classList.toggle("dim", pts.some(p => p.on) && pts.some(p => !p.on));
  }

  /* ---------- force-directed network ---------- */
  function network(container, nodes, edges, opts) {
    const W = 900, H = 560;
    const s = svg(container, W, H);
    // deterministic start on a circle, then simple force simulation
    nodes.forEach((n, i) => { const a = (i / nodes.length) * Math.PI * 2; n.x = W / 2 + Math.cos(a) * 200; n.y = H / 2 + Math.sin(a) * 160; n.vx = 0; n.vy = 0; });
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    for (let it = 0; it < 420; it++) {
      const alpha = 1 - it / 420;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
        const f = 2600 / d2 * alpha;
        const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      edges.forEach(e => {
        const a = nodes[idx.get(e.a)], b = nodes[idx.get(e.b)];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 70) * 0.02 * alpha;
        a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
      });
      nodes.forEach(n => {
        n.vx += (W / 2 - n.x) * 0.004 * alpha; n.vy += (H / 2 - n.y) * 0.006 * alpha;
        n.x += Math.max(-12, Math.min(12, n.vx)); n.y += Math.max(-12, Math.min(12, n.vy));
        n.vx *= 0.6; n.vy *= 0.6;
        n.x = Math.max(30, Math.min(W - 30, n.x)); n.y = Math.max(24, Math.min(H - 24, n.y));
      });
    }
    const maxLift = Math.max(...edges.map(e => e.lift));
    const eg = el("g", {}, s), ng = el("g", {}, s);
    const edgeEls = edges.map(e => {
      const a = nodes[idx.get(e.a)], b = nodes[idx.get(e.b)];
      const line = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "edge", "stroke-width": 1 + 5 * e.lift / maxLift, "stroke-opacity": 0 }, eg);
      line.style.transition = "stroke-opacity .8s .6s";
      requestAnimationFrame(() => requestAnimationFrame(() => line.setAttribute("stroke-opacity", .18 + .45 * e.lift / maxLift)));
      bindTip(line, `<b>${a.label}</b> + <b>${b.label}</b><br>Lift ${e.lift.toFixed(1)}, bought together on ${num(e.count)} invoices`);
      line._e = e;
      return line;
    });
    const nodeEls = nodes.map(n => {
      const g = el("g", { class: "node", transform: `translate(${W / 2},${H / 2})` }, ng);
      el("circle", { r: n.r, fill: n.color }, g);
      if (n.r > 8) el("text", { y: n.r + 11, "text-anchor": "middle" }, g).textContent = n.short;
      requestAnimationFrame(() => requestAnimationFrame(() => g.setAttribute("transform", `translate(${n.x},${n.y})`)));
      bindTip(g, `<b>${n.label}</b><br>${opts.nodeTip(n)}`);
      g.addEventListener("click", () => opts.onSelect(n.id));
      g._n = n;
      return g;
    });
    function focus(id) {
      s.parentNode.classList.toggle("focus", !!id);
      const linked = new Set([id]);
      edgeEls.forEach(l => { const on = !!id && (l._e.a === id || l._e.b === id); l.classList.toggle("on", on); if (on) { linked.add(l._e.a); linked.add(l._e.b); } });
      nodeEls.forEach(g => g.classList.toggle("on", linked.has(g._n.id)));
    }
    return { focus };
  }

  window.Charts = { el, svg, gbp, num, pct, niceMax, tip, bindTip, pulse, sparkPath, mini, heatmap, barList, pareto, donut, columns, scatter, network };
})();
