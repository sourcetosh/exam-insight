// Progress across tests: score / accuracy / friction trends and each topic's group over time.
import { store, kindOf } from '../store.js';
import { summaryOf, analyze } from '../engine/report.js';
import { statsFor, classify, GROUPS, topicMap, STATUS_LABEL } from '../engine/topics.js';
import { topicsFor } from '../data/taxonomy.js';
import { DRILL } from '../config.js';
import { esc, pct, fmtDate, signed, fix, relDay, plural } from '../ui.js';
import { lineChart } from './charts.js';
import { icon } from '../icons.js';
import { hasTrace, groupBehaviour, washStep, QUADRANTS, QUADRANT_ORDER } from '../engine/behaviour.js';

export function render(root) {
  const p = store.profile;
  const done = store.sessions({ exam: p.exam, status: 'done' });
  const mocks = done.filter((s) => kindOf(s) === 'mock');
  const drills = done.filter((s) => kindOf(s) === 'drill');
  const sums = mocks.map(summaryOf);
  const full = done.filter((s) => s.analytics === 'full');

  if (!done.length) {
    root.innerHTML = `<div class="container"><div class="page-head"><div><div class="eyebrow">${p.exam}</div><h1>Progress</h1></div></div>
      <div class="empty card"><div class="empty-art" aria-hidden="true">${[0, 1, 2, 0, 3, 1, 0, 2, 4, 1].map((x) => `<i class="f${x}"></i>`).join('')}</div>
      <div><h2>No finished tests yet</h2><p class="muted mb0">Once you finish a test, your score, accuracy and topic groups are tracked here across attempts.</p><a class="btn primary mt" href="#/">Start a mock</a></div></div></div>`;
    return;
  }

  const pts = (k) => sums.map((x, i) => ({ v: x[k] ?? null, label: `${fmtDate(x.at)} · ${x.name}`, short: `M${i + 1}` }));

  // Topic journey: group per test (mocks and drills) for each topic.
  const tests = full.map((s) => ({ session: s, rows: analyze(s).rows }));
  const map = tests.length ? topicMap(tests) : [];
  const topics = topicsFor(p.exam);
  let mi = 0;
  const cols = tests.map((x) => ({ ...x, label: kindOf(x.session) === 'drill' ? 'D' : `M${++mi}` }));
  const journey = topics.map((t) => {
    const cells = cols.map((x) => {
      const rr = x.rows.filter((r) => r.topic === t.topic);
      if (!rr.length) return null;
      const st = statsFor(rr);
      return { g: classify(st), st, n: rr.length };
    });
    const m = map.find((x) => x.topic === t.topic);
    return { ...t, cells, m };
  }).filter((t) => t.cells.some(Boolean));

  // Struggle journey: each topic's struggle (from the face) in every test that had the camera on.
  const traced = done.filter(hasTrace);
  let tk = 0;
  const tcols = traced.map((s) => ({ s, label: kindOf(s) === 'drill' ? 'D' : `M${++tk}`, groups: new Map(groupBehaviour(analyze(s).rows, 'topic').map((g) => [g.key, g])) }));
  const tnames = [...new Set(tcols.flatMap((c) => [...c.groups.keys()]))];
  const strain = tnames.map((name) => {
    const cells = tcols.map((c) => c.groups.get(name) || null);
    const vals = cells.filter((c) => c?.struggle != null).map((c) => c.struggle);
    const subject = cells.find(Boolean)?.subject || '';
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const trend = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : null;
    const quads = {};
    for (const c of cells) if (c) for (const [k, v] of Object.entries(c.quads)) quads[k] = (quads[k] || 0) + v;
    return { name, subject, cells, avg, trend, quads, tests: vals.length };
  }).filter((t) => t.avg != null).sort((a, b) => b.avg - a.avg);
  const strainHTML = strain.length ? `<section class="card sj">
      <div class="card-head"><div><h2>Struggle by topic, test by test</h2><p class="small muted mb0">How strained your face was on each topic in every test with the camera on. A topic that stays dark is a habit, not a bad day.</p></div></div>
      <div class="table-wrap"><table class="table sj-table">
        <thead><tr><th>Topic</th>${tcols.map((c) => `<th class="c">${c.label}<div class="faint small">${fmtDate(c.s.endedAt || c.s.startedAt)}</div></th>`).join('')}<th class="r">Average</th><th class="r">Trend</th><th>Kinds so far</th><th></th></tr></thead>
        <tbody>${strain.map((t) => `<tr><td><b>${esc(t.name)}</b><div class="small faint">${esc(t.subject)}</div></td>
          ${t.cells.map((c) => `<td class="c">${c?.struggle != null ? `<span class="sj-cell w${washStep(c.struggle)}" data-tip="${esc(`<b>${esc(t.name)}</b> · struggle ${c.struggle}<div class="tip-grid">${QUADRANT_ORDER.filter((k) => c.quads[k]).map((k) => `<span>${QUADRANTS[k].short}</span><b>${c.quads[k]}</b>`).join('')}</div>`)}">${c.struggle}</span>` : '<span class="faint">·</span>'}</td>`).join('')}
          <td class="r num"><b>${t.avg}</b></td>
          <td class="r num">${t.trend == null ? '<span class="faint">—</span>' : `<span class="${t.trend <= 0 ? 'delta-up' : 'delta-down'}">${t.trend > 0 ? '+' : t.trend < 0 ? '−' : ''}${Math.abs(t.trend)}</span>`}</td>
          <td><span class="tmix" style="min-width:110px">${QUADRANT_ORDER.filter((k) => t.quads[k] && k !== 'unseen').map((k) => `<i class="qc-${k}" style="flex:${t.quads[k]}" data-tip="${esc(`${t.quads[k]} ${QUADRANTS[k].short.toLowerCase()}`)}"></i>`).join('')}</span></td>
          <td class="r"><a class="btn sm ghost" href="#/drill/${encodeURIComponent(t.name)}/${t.quads.blind ? 'slow' : t.quads.fragile && !t.quads.gap ? 'speed' : 'normal'}">Practise</a></td></tr>`).join('')}</tbody>
      </table></div>
    </section>` : '';

  const row = (s) => {
    const m = summaryOf(s);
    const isDrill = kindOf(s) === 'drill';
    return `<a class="test-row" href="${isDrill ? `#/drillresult/${s.id}` : `#/report/${s.id}`}">
      <div><div class="t-title">${isDrill ? icon('zap', { size: 13 }) + ' ' : ''}${esc(s.templateName)}</div><div class="t-meta"><span>${relDay(m.at)}</span><span>${m.attempted}/${m.n} attempted</span>${m.meanF != null ? `<span>mean friction ${signed(m.meanF)}</span>` : ''}${s.analytics !== 'full' ? '<span>scores + time</span>' : ''}${isDrill && m.mode ? `<span>${DRILL.modes[m.mode]?.label.toLowerCase()} mode</span>` : ''}${s.simulated ? '<span>sample data</span>' : ''}</div></div>
      <div class="t-score"><b class="num">${m.score < 0 ? '−' + Math.abs(m.score) : m.score}</b><span class="faint">/${m.max}</span><span class="t-acc">${pct(m.accuracy)}</span></div></a>`;
  };

  root.innerHTML = `<div class="container">
    <div class="page-head"><div><div class="eyebrow">${p.exam === 'JEE' ? 'JEE Main' : 'NEET UG'} · ${plural(mocks.length, 'mock')}${drills.length ? ` · ${plural(drills.length, 'drill')}` : ''}</div><h1>Progress</h1>
      <p class="muted">How your results and habits move from test to test.</p></div></div>

    ${mocks.length ? `<div class="grid three">
      <section class="card chart"><div class="card-head"><h3>Score</h3><span class="small muted">% of marks</span></div>${lineChart(pts('scorePct'), { fmt: (v) => pct(v), label: 'Score', yMin: Math.min(0, ...sums.map((x) => x.scorePct)), yMax: 1 })}</section>
      <section class="card chart"><div class="card-head"><h3>Accuracy</h3><span class="small muted">of attempted</span></div>${lineChart(pts('accuracy'), { fmt: (v) => pct(v), label: 'Accuracy', yMin: 0, yMax: 1 })}</section>
      <section class="card chart"><div class="card-head"><h3>Average struggle</h3><span class="small muted">from your face · lower is calmer</span></div>${sums.some((x) => x.meanStruggle != null) ? lineChart(pts('meanStruggle'), { fmt: (v) => String(Math.round(v)), label: 'Average struggle', yMin: 0, yMax: 100 }) : '<p class="small faint">Appears once a mock has a camera trace</p>'}</section>
    </div>` : '<div class="notice calm">Mock charts appear after your first full mock. Drills show in the topic journey below.</div>'}

    ${strainHTML ? `<div class="mt">${strainHTML}</div>` : ''}
    ${journey.length ? `<details class="card mt fold-card"><summary><span>Topic groups by accuracy and time (older view)</span><span class="deep-chev">${icon('chevron', { size: 14 })}</span></summary><section>
      <div class="card-head"><div><h2>Topic journey</h2><p class="small muted mb0">Each topic’s group in each mock (M) and drill (D). A pattern is confirmed once it holds for three tests in a row.</p></div></div>
      <div class="table-wrap"><table class="table journey">
        <thead><tr><th>Topic</th>${cols.map((x) => `<th class="c">${x.label}<div class="faint small">${fmtDate(x.session.endedAt || x.session.startedAt)}</div></th>`).join('')}<th>Overall</th><th></th></tr></thead>
        <tbody>${journey.map((t) => `<tr><td><b>${esc(t.topic)}</b><div class="small faint">${esc(t.subject)}</div></td>
          ${t.cells.map((c) => `<td class="c">${c ? `<span class="jdot ${GROUPS[c.g]?.cls || 'g-none'}" data-tip="${esc(`<b>${esc(t.topic)}</b><br>${GROUPS[c.g]?.label || '—'} · ${c.n} Q<div class="tip-grid"><span>Accuracy</span><b>${pct(c.st.accuracy)}</b><span>Time</span><b>${fix(c.st.timeRatio, 2)}×</b></div>`)}"></span>` : '<span class="faint">·</span>'}</td>`).join('')}
          <td>${t.m ? `<span class="group-chip ${t.m.status === 'insufficient' ? 'g-none' : GROUPS[t.m.group]?.cls}"><i></i>${t.m.status === 'insufficient' ? 'Not enough data' : GROUPS[t.m.group]?.label}</span> <span class="small faint">${t.m.status === 'early' ? 'early' : t.m.status === 'confirmed' ? 'confirmed' : ''}</span>` : ''}</td>
          <td class="r"><a class="btn sm ghost" href="#/drill/${encodeURIComponent(t.topic)}/normal">Drill</a></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="tl-legend mt">${Object.values(GROUPS).map((g) => `<span class="row" style="gap:6px"><span class="jdot ${g.cls}"></span>${g.label}</span>`).join('')}</div>
    </section></details>` : ''}

    <div class="section-head mt-lg"><h2>All tests</h2><span class="small muted">${done.length} total</span></div>
    <section class="card" style="padding:4px 20px">${[...done].reverse().map(row).join('')}</section>
  </div>`;
}
