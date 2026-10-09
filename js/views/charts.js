// Small hand-rolled SVG charts. Colours come from CSS tokens so light/dark both work.
import { esc, pct, fix, clamp, fmtDur } from '../ui.js';
import { GROUPS } from '../engine/topics.js';
import { THRESHOLDS } from '../config.js';

export function sparkline(values, { w = 120, h = 32, pad = 3 } = {}) {
  const v = values.filter((x) => x != null && !isNaN(x));
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => [pad + (i * (w - pad * 2)) / (v.length - 1), h - pad - ((x - lo) / span) * (h - pad * 2)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></svg>`;
}

/** Topic difficulty map: x = time vs expected, y = accuracy. Quadrant lines follow the
 *  classification exactly: 50% accuracy; 1.3x for accurate topics, 1.0x for inaccurate ones. */
export function topicScatter(topics, { selected = null } = {}) {
  const W = 640, H = 380, L = 48, R = 20, T = 20, B = 44;
  const xs = topics.map((t) => t.cum.timeRatio).filter((x) => x != null);
  const xMax = Math.max(2.4, Math.ceil(Math.max(...xs, 0) * 5) / 5 + 0.2);
  const X = (x) => L + (clamp(x, 0, xMax) / xMax) * (W - L - R);
  const Y = (y) => T + (1 - y) * (H - T - B);
  const ticksX = [];
  for (let x = 0; x <= xMax + 1e-9; x += 0.5) ticksX.push(x);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((y) => `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}"/><text x="${L - 8}" y="${Y(y) + 4}" text-anchor="end">${y * 100}%</text>`).join('');
  const xt = ticksX.map((x) => `<text x="${X(x)}" y="${H - B + 18}" text-anchor="middle">${x.toFixed(1)}×</text>`).join('');
  const lowA = THRESHOLDS.lowAccuracy, over = THRESHOLDS.overExpected, under = THRESHOLDS.underExpected;
  const quad = `
    <rect x="${L}" y="${Y(1)}" width="${X(over) - L}" height="${Y(lowA) - Y(1)}" fill="var(--g-fluent)" opacity=".05"/>
    <rect x="${X(over)}" y="${Y(1)}" width="${W - R - X(over)}" height="${Y(lowA) - Y(1)}" fill="var(--g-slow)" opacity=".05"/>
    <rect x="${L}" y="${Y(lowA)}" width="${X(under) - L}" height="${Y(0) - Y(lowA)}" fill="var(--g-fast)" opacity=".05"/>
    <rect x="${X(under)}" y="${Y(lowA)}" width="${W - R - X(under)}" height="${Y(0) - Y(lowA)}" fill="var(--g-struggling)" opacity=".05"/>
    <line class="quad-l" x1="${L}" x2="${W - R}" y1="${Y(lowA)}" y2="${Y(lowA)}"/>
    <line class="quad-l" x1="${X(over)}" x2="${X(over)}" y1="${Y(1)}" y2="${Y(lowA)}"/>
    <line class="quad-l" x1="${X(under)}" x2="${X(under)}" y1="${Y(lowA)}" y2="${Y(0)}"/>
    <text class="quad-t" x="${L + 8}" y="${Y(1) + 16}">Fluent</text>
    <text class="quad-t" x="${W - R - 8}" y="${Y(1) + 16}" text-anchor="end">Slow but sure</text>
    <text class="quad-t" x="${L + 8}" y="${Y(0) - 10}">Fast and wrong</text>
    <text class="quad-t" x="${W - R - 8}" y="${Y(0) - 10}" text-anchor="end">Struggling</text>`;
  // Big bubbles first so small ones stay visible; labels avoid dots, other labels and the frame.
  const pts = topics.filter((t) => t.cum.timeRatio != null).sort((a, b) => b.cum.n - a.cum.n)
    .map((t) => ({ t, cx: X(t.cum.timeRatio), cy: Y(t.cum.accuracy), r: 5 + Math.sqrt(t.cum.n) * 1.6 }));
  const boxes = [];
  const hit = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  const place = (p) => {
    const w = p.t.topic.length * 6.3 + 6, h = 14, g = p.r + 5;
    const cands = [
      { a: 'start', x: p.cx + g, y: p.cy + 4 }, { a: 'end', x: p.cx - g, y: p.cy + 4 },
      { a: 'middle', x: p.cx, y: p.cy - g - 1 }, { a: 'middle', x: p.cx, y: p.cy + g + 11 },
      { a: 'start', x: p.cx + g, y: p.cy - 9 }, { a: 'start', x: p.cx + g, y: p.cy + 17 },
      { a: 'end', x: p.cx - g, y: p.cy - 9 }, { a: 'end', x: p.cx - g, y: p.cy + 17 },
    ];
    let best = null;
    for (const c of cands) {
      const x1 = c.a === 'start' ? c.x : c.a === 'end' ? c.x - w : c.x - w / 2;
      const box = { x1, x2: x1 + w, y1: c.y - 11, y2: c.y - 11 + h };
      let cost = boxes.filter((bx) => hit(bx, box)).length * 3;
      cost += pts.filter((o) => o !== p && hit({ x1: o.cx - o.r, x2: o.cx + o.r, y1: o.cy - o.r, y2: o.cy + o.r }, box)).length * 2;
      if (box.x1 < L || box.x2 > W - R || box.y1 < T || box.y2 > Y(0)) cost += 5;
      if (!best || cost < best.cost) best = { ...c, box, cost };
      if (cost === 0) break;
    }
    boxes.push(best.box);
    return best;
  };
  const labels = pts.map(place);
  const dots = pts.map((p, i) => {
    const { t, cx, cy, r } = p;
    const lab = labels[i];
    const g = GROUPS[t.group];
    const insufficient = t.status === 'insufficient';
    const tip = `<b>${esc(t.topic)}</b><br>${esc(g?.label || '—')} · ${esc(t.status === 'confirmed' ? 'confirmed' : t.status === 'early' ? 'early signal' : 'not enough data')}<div class="tip-grid"><span>Accuracy</span><b>${pct(t.cum.accuracy)}</b><span>Time vs expected</span><b>${fix(t.cum.timeRatio, 2)}×</b><span>Mean friction</span><b>${fix(t.cum.meanF, 2)}</b><span>Questions</span><b>${t.cum.n}</b></div>`;
    return `<g class="sc-pt ${selected === t.topic ? 'sel' : ''}" data-topic="${esc(t.topic)}" data-tip="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(`${t.topic}: ${g?.label}, accuracy ${pct(t.cum.accuracy)}, time ${fix(t.cum.timeRatio, 2)} times expected`)}">
      <circle cx="${cx}" cy="${cy}" r="${r + 8}" fill="transparent"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--${g ? g.cls : 'g-none'})" fill-opacity="${insufficient ? 0.25 : 0.9}" stroke="var(--surface)" stroke-width="2" ${insufficient ? 'stroke-dasharray="3 2"' : ''}/>
      <text x="${lab.x}" y="${lab.y}" text-anchor="${lab.a}" class="sc-label">${esc(t.topic)}</text>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Topic difficulty map">
    ${grid}${quad}
    <line class="axis" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>
    ${xt}
    <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="ax-title">Time vs expected →</text>
    <text x="14" y="${(T + H - B) / 2}" text-anchor="middle" class="ax-title" transform="rotate(-90 14 ${(T + H - B) / 2})">Accuracy →</text>
    ${dots}
  </svg>`;
}

/** Accuracy per fifth of the test, with answer counts. */
export function fatigueBars(curve) {
  const W = 320, H = 120, L = 6, R = 6, T = 14, B = 30;
  const bw = (W - L - R) / curve.length;
  const bars = curve.map((c, i) => {
    const x = L + i * bw + 6, w = bw - 12;
    const h = c.accuracy == null ? 0 : c.accuracy * (H - T - B);
    const y = H - B - h;
    return `<g data-tip="${esc(`<b>Fifth ${i + 1}</b><br>${c.answered} answered · ${c.accuracy == null ? 'no answers' : `${pct(c.accuracy)} right`}`)}">
      <rect x="${x}" y="${T}" width="${w}" height="${H - T - B}" fill="transparent"/>
      ${h > 0 ? `<path d="M${x},${H - B} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + w - 4} Q${x + w},${y} ${x + w},${y + 4} V${H - B} Z" fill="${i === curve.length - 1 ? 'var(--f4)' : 'var(--accent)'}" opacity="${i === curve.length - 1 ? 1 : 0.75}"/>` : ''}
      <text x="${x + w / 2}" y="${Math.max(T + 10, y - 4)}" text-anchor="middle" class="bar-v">${c.accuracy == null ? '–' : pct(c.accuracy)}</text>
      <text x="${x + w / 2}" y="${H - B + 14}" text-anchor="middle">${i * 20}–${(i + 1) * 20}%</text>
      <text x="${x + w / 2}" y="${H - B + 26}" text-anchor="middle" class="faint-t">${c.answered} answered</text>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Accuracy per fifth of the test">
    <line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>${bars}</svg>`;
}

/** Single-series line with labelled points and per-point tooltips. */
export function lineChart(points, { fmt = (v) => v, yMin = null, yMax = null, label = '' } = {}) {
  const W = 340, H = 150, L = 40, R = 14, T = 14, B = 26;
  const vals = points.map((p) => p.v).filter((v) => v != null);
  if (!vals.length) return '<p class="small faint">No data yet</p>';
  let lo = yMin ?? Math.min(...vals), hi = yMax ?? Math.max(...vals);
  if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
  const X = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  const path = points.map((p, i) => (p.v == null ? null : `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`)).filter(Boolean);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${ticks.map((t) => `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
    ${path.length > 1 ? `<polyline points="${path.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${points.map((p, i) => (p.v == null ? '' : `<g data-tip="${esc(`<b>${esc(p.label)}</b><br>${esc(label)}: ${esc(fmt(p.v))}`)}"><circle cx="${X(i)}" cy="${Y(p.v)}" r="12" fill="transparent"/><circle cx="${X(i)}" cy="${Y(p.v)}" r="${i === points.length - 1 ? 5 : 4}" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></g>`)).join('')}
    ${points.map((p, i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(p.short || '')}</text>`).join('')}
  </svg>`;
}

/** Horizontal time bars for the basic (under-18) report: time vs expected per question. */
export function timeBars(rows) {
  const max = Math.max(...rows.map((r) => Math.max(r.timeSec, r.expectedSec)), 1);
  return `<div class="tbars">${rows.map((r) => `<div class="tbar" data-tip="${esc(`<b>Q${r.n}</b> · ${esc(r.topic)}<br>${Math.round(r.timeSec)}s spent · ${r.expectedSec}s expected`)}">
      <span class="tb-n mono">Q${r.n}</span>
      <span class="tb-track"><span class="tb-fill ${r.correct === true ? 'ok' : r.correct === false ? 'no' : 'skip'}" style="width:${(r.timeSec / max) * 100}%"></span><span class="tb-exp" style="left:${(r.expectedSec / max) * 100}%"></span></span>
      <span class="tb-v mono">${Math.round(r.timeSec)}s</span></div>`).join('')}</div>`;
}

/** Bell curve of the cohort score distribution with the student's value marked. */
export function miniDist({ mean: mu, sd, value, pct: p }) {
  const W = 220, H = 64, L = 4, R = 4, T = 6, B = 16;
  const lo = Math.max(0, mu - 3 * sd), hi = Math.min(1, mu + 3 * sd);
  const X = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const pdf = (v) => Math.exp(-0.5 * ((v - mu) / sd) ** 2);
  const pts = [];
  for (let i = 0; i <= 60; i++) { const v = lo + ((hi - lo) * i) / 60; pts.push([X(v), T + (1 - pdf(v)) * (H - T - B)]); }
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('');
  const vx = X(clamp(value, lo, hi));
  const fillPts = pts.filter((q) => q[0] <= vx);
  const fill = fillPts.length ? `M${L},${H - B} ${fillPts.map((q) => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('')} L${vx.toFixed(1)},${H - B} Z` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Score distribution: above ${p}% of pilot attempts">
    ${fill ? `<path d="${fill}" fill="var(--accent)" opacity=".18"/>` : ''}
    <path d="${line}" fill="none" stroke="var(--border-strong)" stroke-width="1.5"/>
    <line x1="${vx}" x2="${vx}" y1="${T}" y2="${H - B}" stroke="var(--accent)" stroke-width="2"/>
    ${vx > 60 ? `<text x="${L}" y="${H - 3}" class="faint-t">${Math.round(lo * 100)}%</text>` : ''}
    ${vx < W - 60 ? `<text x="${W - R}" y="${H - 3}" text-anchor="end" class="faint-t">${Math.round(hi * 100)}%</text>` : ''}
    <text x="${clamp(vx, 24, W - 24)}" y="${H - 3}" text-anchor="middle" class="bar-v">you · ${Math.round(value * 100)}%</text>
  </svg>`;
}

/** Five-axis readiness radar. One series, so no categorical colour is needed. */
export function radar(dims, { size = 220 } = {}) {
  const c = size / 2, r = size / 2 - 34;
  const n = dims.length;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, f) => [c + Math.cos(ang(i)) * r * f, c + Math.sin(ang(i)) * r * f];
  const ring = (f) => dims.map((_, i) => pt(i, f).map((v) => v.toFixed(1)).join(',')).join(' ');
  const poly = dims.map((d, i) => pt(i, (d.value ?? 0) / 100).map((v) => v.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Readiness: ${dims.map((d) => `${d.label} ${d.value ?? 'n/a'}`).join(', ')}">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}" fill="none" class="radar-ring"/>`).join('')}
    ${dims.map((_, i) => `<line x1="${c}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" class="radar-ring"/>`).join('')}
    <polygon points="${poly}" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    ${dims.map((d, i) => { const [x, y] = pt(i, (d.value ?? 0) / 100); return d.value == null ? '' : `<circle cx="${x}" cy="${y}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`; }).join('')}
    ${dims.map((d, i) => { const [x, y] = pt(i, 1.22); const a = ang(i); const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end'; return `<text x="${x}" y="${y + 4}" text-anchor="${anchor}" class="radar-lab">${esc(d.label)}</text>`; }).join('')}
  </svg>`;
}

/** Stacked comparison bars: share of time vs share of marks, per section. */
export function allocBars(items) {
  return `<div class="alloc">${items.map((x) => `<div class="alloc-row" data-tip="${esc(`<b>${esc(x.name)}</b><div class="tip-grid"><span>Time</span><b>${pct(x.timeFrac)} (${fmtDur(x.timeSec)})</b><span>Marks available</span><b>${pct(x.availFrac)}</b><span>Scored</span><b>${x.score} / ${x.max}</b><span>Accuracy</span><b>${x.accuracy == null ? '—' : pct(x.accuracy)}</b></div>`)}">
      <span class="alloc-name">${esc(x.name)}</span>
      <span class="alloc-bars"><span class="alloc-bar time" style="width:${(x.timeFrac * 100).toFixed(1)}%"><i>${pct(x.timeFrac)} of time</i></span><span class="alloc-bar marks" style="width:${(x.availFrac * 100).toFixed(1)}%"><i>${pct(x.availFrac)} of marks</i></span></span>
      <span class="alloc-acc num">${x.accuracy == null ? '—' : pct(x.accuracy)}</span>
    </div>`).join('')}</div>`;
}
