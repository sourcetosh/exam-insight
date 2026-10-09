// Coach view: cohort heatmap of topics with a per-learner drill-down. Only learners who opted in appear.
import { store } from '../store.js';
import { coachCohort } from '../data/cohort.js';
import { topicsFor } from '../data/taxonomy.js';
import { currentMap } from '../engine/report.js';
import { GROUPS } from '../engine/topics.js';
import { esc, pct, signed, mean, clamp, toast } from '../ui.js';
import { icon } from '../icons.js';

const pseudoGroup = (c) => (c.accuracy < 0.5 ? (c.friction > 0.3 ? 'struggling' : 'fast') : c.friction > 0.3 ? 'slow' : 'fluent');

export function render(root) {
  const p = store.profile;
  const st = { metric: 'friction', sel: null };
  const topics = topicsFor(p.exam);
  const cohort = coachCohort(p.exam);
  const shown = cohort.filter((l) => l.optedIn);
  const hidden = cohort.length - shown.length;

  // The student's own row, only if they opted in.
  let me = null;
  if (p.consent?.coach) {
    const map = currentMap(p.exam);
    if (map.length) {
      const cells = {};
      for (const t of map) cells[t.topic] = { accuracy: t.cum.accuracy, friction: t.cum.meanF ?? 0, n: t.cum.n, group: t.status === 'insufficient' ? null : t.group };
      me = { id: 'you', label: `${p.name || 'You'} (you)`, cells, me: true };
    }
  }
  const rows = me ? [me, ...shown] : shown;

  const step = (v) => (st.metric === 'friction' ? clamp(Math.floor((v + 1) / 0.6), 0, 5) : clamp(Math.floor(v * 6), 0, 5));
  const cellStyle = (c) => {
    if (!c) return '';
    const s = step(st.metric === 'friction' ? c.friction : c.accuracy);
    return st.metric === 'friction' ? `background:var(--f${s});color:${s >= 3 ? '#fff' : 'var(--text)'}` : `background:var(--b${s});color:${s >= 3 ? '#fff' : 'var(--text)'}`;
  };
  const fmt = (c) => (st.metric === 'friction' ? signed(c.friction, 1) : Math.round(c.accuracy * 100));

  const panel = () => {
    const r = rows.find((x) => x.id === st.sel);
    if (!r) return '';
    const list = topics.map((t) => ({ topic: t.topic, subject: t.subject, c: r.cells[t.topic] })).filter((x) => x.c)
      .map((x) => ({ ...x, group: x.c.group || pseudoGroup(x.c) }))
      .sort((a, b) => b.c.friction - a.c.friction);
    const focus = list.filter((x) => x.group === 'struggling' || x.group === 'fast').slice(0, 3);
    return `<section class="card mt learner" id="learner">
      <div class="card-head"><div><h2>${esc(r.label)}</h2><p class="small muted mb0">${r.me ? 'Your own topic map, as your coach would see it.' : 'Pseudonymous. Topic accuracy and friction only.'}</p></div>
        <div class="row">${r.me ? '<a class="btn sm" href="#/history">Open my progress</a>' : '<button class="btn sm" id="suggest">Suggest a drill</button>'}<button class="btn sm ghost" id="closep">Close</button></div></div>
      ${focus.length ? `<div class="row" style="gap:8px;margin-bottom:12px"><span class="small muted">Re-teach first:</span>${focus.map((x) => `<span class="chip warn">${esc(x.topic)}</span>`).join('')}</div>` : ''}
      <div class="table-wrap"><table class="table"><thead><tr><th>Topic</th><th>Group</th><th class="r">Accuracy</th><th class="r">Friction</th><th class="r">Questions</th></tr></thead>
        <tbody>${list.map((x) => `<tr><td><b>${esc(x.topic)}</b><div class="small faint">${esc(x.subject)}</div></td><td><span class="group-chip ${GROUPS[x.group].cls}"><i></i>${GROUPS[x.group].label}</span></td><td class="r num">${pct(x.c.accuracy)}</td><td class="r num">${signed(x.c.friction)}</td><td class="r num">${x.c.n}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
  };

  const draw = () => {
    const colMeans = topics.map((t) => {
      const v = rows.map((r) => r.cells[t.topic]).filter(Boolean);
      return { topic: t.topic, acc: mean(v.map((c) => c.accuracy)), fr: mean(v.map((c) => c.friction)) };
    });
    const reteach = [...colMeans].sort((a, b) => b.fr - a.fr).slice(0, 3);
    root.innerHTML = `<div class="container">
      <div class="page-head"><div><div class="eyebrow">For coaches · ${p.exam === 'JEE' ? 'JEE Main' : 'NEET UG'}</div><h1>Coach view</h1>
        <p class="muted">Topic accuracy and friction for learners who chose to share. Coaches never see timelines, tags or camera data. Click a learner for detail.</p></div>
        <div class="seg" role="group" aria-label="Metric"><button class="${st.metric === 'friction' ? 'on' : ''}" data-m="friction">Friction</button><button class="${st.metric === 'accuracy' ? 'on' : ''}" data-m="accuracy">Accuracy</button></div>
      </div>
      ${!p.consent?.coach ? `<div class="notice calm" style="margin-bottom:16px">${icon('info')}<div>You are not sharing with a coach, so your row is not here. <a href="#/privacy">Change this in Privacy</a>.</div></div>` : ''}
      <div class="grid three" style="margin-bottom:16px">
        <div class="card tight"><div class="stat"><span class="label">Sharing</span><span class="value">${rows.length}</span><span class="sub">${hidden} opted out, not shown</span></div></div>
        <div class="card tight" style="grid-column: span 2"><div class="eyebrow">Re-teach first (highest cohort friction)</div>
          <div class="row" style="gap:8px;margin-top:6px">${reteach.map((r, i) => `<span class="chip ${i === 0 ? 'warn' : ''}">${i + 1}. ${esc(r.topic)} · ${signed(r.fr, 1)}</span>`).join('')}</div></div>
      </div>
      <section class="card">
        <div class="table-wrap heat-wrap"><table class="heat">
          <colgroup><col class="c-name">${topics.map(() => '<col>').join('')}</colgroup>
          <thead><tr><th></th>${topics.map((t) => `<th class="h-topic"><span>${esc(t.topic)}</span><small>${esc(t.subject)}</small></th>`).join('')}</tr></thead>
          <tbody>${rows.map((r) => `<tr class="${r.me ? 'you' : ''} ${st.sel === r.id ? 'sel' : ''} learner-row" data-learner="${esc(r.id)}" tabindex="0"><th>${esc(r.label)}</th>${topics.map((t) => {
            const c = r.cells[t.topic];
            return c ? `<td class="${r.me ? 'me' : ''}" style="${cellStyle(c)}" data-tip="${esc(`<b>${esc(r.label)}</b> · ${esc(t.topic)}<div class="tip-grid"><span>Accuracy</span><b>${pct(c.accuracy)}</b><span>Friction</span><b>${signed(c.friction)}</b><span>Questions</span><b>${c.n}</b></div>`)}">${fmt(c)}</td>` : '<td class="empty-cell">·</td>';
          }).join('')}</tr>`).join('')}
          <tr class="mean-row"><th>Cohort mean</th>${colMeans.map((c) => `<td style="${cellStyle({ accuracy: c.acc, friction: c.fr })}">${st.metric === 'friction' ? signed(c.fr, 1) : Math.round(c.acc * 100)}</td>`).join('')}</tr></tbody>
        </table></div>
        <div class="tl-legend mt"><span>${st.metric === 'friction' ? 'Friction' : 'Accuracy %'}</span><span class="scale">${[0, 1, 2, 3, 4, 5].map((i) => `<i style="background:var(--${st.metric === 'friction' ? 'f' : 'b'}${i})"></i>`).join('')}</span><span>${st.metric === 'friction' ? 'smooth → costly' : 'low → high'}</span></div>
      </section>
      ${panel()}
      <p class="small faint mt">Sample cohort for the prototype. Pseudonymous IDs; in production a learner appears only after they opt in, and can withdraw at any time.</p>
    </div>`;
    if (st.sel) root.querySelector('#learner')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  draw();
  root.onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (b) { st.metric = b.dataset.m; draw(); return; }
    const lr = e.target.closest('.learner-row'); if (lr) { st.sel = st.sel === lr.dataset.learner ? null : lr.dataset.learner; draw(); return; }
    if (e.target.closest('#closep')) { st.sel = null; draw(); return; }
    if (e.target.closest('#suggest')) toast('Drill suggestion sent (simulated in the prototype)');
  };
  root.onkeydown = (e) => { const lr = e.target.closest?.('.learner-row'); if (lr && e.key === 'Enter') { st.sel = lr.dataset.learner; draw(); } };
}
