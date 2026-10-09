// Home: your desk. The next paper (a booklet), the camera room's status, what your mentor
// sent, your latest behaviour map, how your struggle has moved across your own mocks, and
// practice aimed at fragile topics, blind spots and gaps.
import { store, kindOf } from '../store.js';
import { esc, fmtClock, pct, relDay, modal, toast, plural, fmtDate } from '../ui.js';
import { questionCount, maxMarks } from '../data/templates.js';
import { bankCoverage, bankFor, estimateDurationSec, cameraAllowed } from '../engine/paper.js';
import { buildReport, summaryOf, readinessFor, planFor, collectMistakes } from '../engine/report.js';
import { hasTrace } from '../engine/behaviour.js';
import { calibrationStatus } from '../face/expression.js';
import { quadrantBoard, topicStruggle, insightCards } from './bxui.js';
import { radar } from './charts.js';
import { icon } from '../icons.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function render(root) {
  const p = store.profile;
  const bank = bankFor(p);
  const live = store.inProgress();
  const pendingReview = store.sessions({ status: 'review' }).filter((s) => s.exam === p.exam);
  const done = store.sessions({ exam: p.exam, status: 'done' });
  const mocks = done.filter((s) => kindOf(s) === 'mock');
  const traced = mocks.filter(hasTrace);
  const last = traced[traced.length - 1] || mocks[mocks.length - 1];
  const tpls = store.templates().filter((t) => t.exam === p.exam && !t.disabled);
  const examLabel = p.exam === 'JEE' ? 'JEE Main' : 'NEET UG';
  const days = p.examDate ? Math.ceil((new Date(p.examDate) - Date.now()) / 86400000) : null;
  const cs = calibrationStatus(p.calibration);
  const camOk = cameraAllowed(p);
  const first = (p.name || '').trim().split(' ')[0];

  // The next paper: the Class 10 demo first for NEET, then sprint → mini → full.
  const lastKind = last?.templateId ? store.template(last.templateId)?.kind : null;
  const order = ['demo', 'sprint', 'mini', 'full'];
  const wantKind = !mocks.length ? (tpls.some((t) => t.kind === 'demo') ? 'demo' : 'sprint') : order[Math.min(order.length - 1, order.indexOf(lastKind || 'sprint') + 1)];
  const rec = tpls.find((t) => t.kind === wantKind) || tpls.find((t) => t.kind === 'mini') || tpls[0];
  const meta = (t) => {
    const n = questionCount(t);
    const have = bankCoverage(t, bank).reduce((s, c) => s + c.have, 0);
    return { n: Math.min(n, have), mins: Math.max(1, Math.round(estimateDurationSec(t, bank) * (have < n ? have / n : 1) / 60)), subjects: t.sections.map((s) => s.name) };
  };

  // ---------- banners ----------
  const banners = [];
  if (live) {
    const answered = Object.values(live.responses).filter((r) => r.saved != null && r.saved !== '').length;
    const left = live.durationSec - live.elapsedMs / 1000;
    banners.push(`<div class="desk-note">
      <span class="dn-ic">${icon('pause', { size: 18 })}</span>
      <div class="grow"><b>${live.status === 'ready' ? 'Ready to begin' : 'Paused'}: ${esc(live.templateName)}</b><span class="small muted">${live.status === 'ready' ? `${live.paper.length} questions, ${fmtClock(live.durationSec)} on the clock.` : `${answered} of ${live.paper.length} answered · ${fmtClock(left)} left. The clock stopped while you were away.`}</span></div>
      <div class="row"><button class="btn ghost danger sm" data-act="discard" data-id="${live.id}">Discard</button><a class="btn primary sm" href="${live.status === 'ready' ? `#/room/${live.id}` : `#/test/${live.id}`}">${live.status === 'ready' ? 'Camera room' : 'Resume'}</a></div></div>`);
  }
  for (const s of pendingReview) {
    banners.push(`<div class="desk-note"><span class="dn-ic">${icon('edit', { size: 18 })}</span>
      <div class="grow"><b>One step left: tag ${plural(s.reviewSet.length, 'question')} from ${esc(s.templateName)}</b><span class="small muted">About two minutes. Your own word on how sure you were sharpens the map.</span></div>
      <a class="btn primary sm" href="#/review/${s.id}">Finish</a></div>`);
  }
  for (const a of store.assignmentsFor('you').filter((x) => !x.done?.you)) {
    const href = a.kind === 'drill' ? `#/drill/${encodeURIComponent(a.topic)}/${a.mode || 'normal'}` : a.kind === 'mistakes' ? '#/drill/mistakes/normal' : a.templateId ? `#/start/${a.templateId}` : '#/';
    banners.push(`<div class="desk-note mentor"><span class="dn-ic">${icon('users', { size: 18 })}</span>
      <div class="grow"><b>From ${esc(a.by || 'your mentor')}: ${esc(a.title)}</b><span class="small muted">${a.due ? `Due ${fmtDate(a.due)}` : 'No deadline'}${a.note ? ` · <span class="hand">${esc(a.note)}</span>` : ''}</span></div>
      <a class="btn primary sm" href="${href}">Start</a></div>`);
  }
  if (!camOk) {
    banners.push(`<div class="desk-note warn"><span class="dn-ic">${icon('camera', { size: 18 })}</span>
      <div class="grow"><b>Camera analysis is off</b><span class="small muted">${p.ageBand === 'u18' ? 'A parent needs to agree to camera-based analysis before you can take tests.' : 'Tests read your expressions, so they need your agreement first.'}</span></div>
      <a class="btn sm" href="#/privacy">Turn on</a></div>`);
  }

  // ---------- next paper ----------
  const m = rec ? meta(rec) : null;
  const shelf = tpls.filter((t) => t.id !== rec?.id).map((t) => {
    const mm = meta(t);
    return `<a class="bk-chip" href="#/start/${t.id}"><b>${esc(t.name)}</b><span>${mm.n} Q · ~${mm.mins} min</span></a>`;
  }).join('');
  const nextPaper = rec ? `<section class="booklet-card ${rec.demo ? 'is-demo' : ''}">
      <div class="bk-spine" aria-hidden="true"></div>
      <div class="bk-body">
        <div class="row between"><span class="eyebrow hl">${mocks.length ? 'Your next paper' : 'Start here'}</span>${rec.demo ? '<span class="stamp hl">Demo</span>' : ''}</div>
        <h2 class="bk-title">${esc(rec.name)}</h2>
        <p class="bk-blurb">${esc(rec.blurb || '')}</p>
        <div class="bk-meta"><span><b>${m.n}</b> questions</span><span><b>~${m.mins}</b> min</span><span><b>${maxMarks(rec)}</b> marks</span><span>${m.subjects.map(esc).join(' · ')}</span></div>
        <ol class="bk-flow">
          <li><span class="bub on">1</span>Camera room <em>${cs.ok ? '~30 s check' : '~2 min, first time'}</em></li>
          <li><span class="bub on">2</span>The paper <em>camera reads your face</em></li>
          <li><span class="bub on">3</span>Your behaviour map <em>question by question</em></li>
        </ol>
        <div class="row" style="gap:12px"><a class="btn primary lg" href="#/start/${rec.id}" ${live || !camOk ? 'aria-disabled="true"' : ''}>${icon('play', { size: 16 })} Begin</a>${live ? '<span class="small muted">Finish or discard the paused test first.</span>' : ''}</div>
      </div>
    </section>` : '';

  // ---------- side: camera room + mentor ----------
  const camCard = `<section class="card side-card">
      <div class="sc-row"><span class="sc-ic ${cs.ok ? 'ok' : ''}">${icon('camera', { size: 18 })}</span><div><b>Camera room</b>
        <span class="small muted">${cs.ok ? `Calibrated ${relDay(p.calibration.at).toLowerCase()}${p.calibration.quality != null ? ` · light ${p.calibration.quality}/100` : ''}` : cs.reason === 'stale' ? 'Calibration is old: light and seating change' : 'Not calibrated yet'}</span></div></div>
      ${p.face?.thumb ? `<img class="side-photo" src="${p.face.thumb}" alt="Your admit-card photo">` : ''}
      <a class="btn sm block mt" href="#/room?calibrate=1&next=">${cs.ok ? 'Recalibrate' : 'Calibrate now'}</a>
    </section>`;
  const mentorCard = p.mentor || p.consent?.coach ? `<section class="card side-card">
      <div class="sc-row"><span class="sc-ic">${icon('users', { size: 18 })}</span><div><b>${esc(p.mentor?.name || 'Your mentor')}</b><span class="small muted">${esc(p.mentor?.batch || 'Sharing on')}</span></div></div>
      ${store.notesFor('you').slice(0, 1).map((n) => `<p class="hand side-note">“${esc(n.text)}”</p>`).join('') || '<p class="small muted mb0">Your mentor sees your behaviour maps and can send you practice.</p>'}
    </section>` : '';

  // ---------- latest behaviour map ----------
  let mapHTML;
  if (last && hasTrace(last)) {
    const R = buildReport(last);
    mapHTML = `<section class="card desk-map">
      <div class="dm-head"><div><div class="eyebrow">Your behaviour map · ${esc(last.templateName)} · ${relDay(summaryOf(last).at).toLowerCase()}</div><h2>${R.bx.insights[0] ? esc(R.bx.insights[0].title) : 'How your last paper felt'}</h2></div>
        <a class="btn" href="#/report/${last.id}">Open the full map ${icon('arrow', { size: 14 })}</a></div>
      <div class="dm-grid">
        <div>${quadrantBoard(R.bx, { compact: true })}</div>
        <div><div class="eyebrow">Topics that strained you</div>${topicStruggle(R.bx, { drill: false, max: 4 })}</div>
      </div>
    </section>`;
  } else if (last) {
    mapHTML = `<section class="card desk-map"><div class="dm-head"><div><div class="eyebrow">Latest · ${esc(last.templateName)}</div><h2>No behaviour map for this one</h2><p class="muted mb0">It was taken before camera reading was switched on. Your next paper will have one.</p></div><a class="btn" href="#/report/${last.id}">Open the result</a></div></section>`;
  } else {
    mapHTML = `<section class="card desk-map empty-map">
      <div class="dm-head"><div><div class="eyebrow">After your first paper</div><h2>Your behaviour map appears here</h2>
        <p class="muted mb0">Every question shaded by how strained your face was, the four kinds of question, and the topics that cost you most.</p></div></div>
      <div class="em-art" aria-hidden="true">${[0, 1, 0, 3, 5, 2, 0, 1, 4, 1, 0, 2, 5, 3, 0, 1].map((w) => `<i class="w${w}"></i>`).join('')}</div>
    </section>`;
  }

  // ---------- trend across own mocks ----------
  const series = traced.map((s) => ({ s, sm: summaryOf(s) })).slice(-8);
  const trend = series.length >= 2 ? (() => {
    const W = 520, H = 120, pad = 22, bw = Math.min(46, (W - pad * 2) / series.length - 14);
    const x = (i) => pad + (i + 0.5) * ((W - pad * 2) / series.length);
    const line = series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${(H - 18 - d.sm.scorePct * (H - 34)).toFixed(1)}`).join('');
    const first = series[0].sm, lastS = series[series.length - 1].sm;
    const dS = (lastS.meanStruggle ?? 0) - (first.meanStruggle ?? 0);
    return `<section class="card desk-trend">
      <div class="dm-head"><div><div class="eyebrow">Across your own mocks</div><h2>${dS <= -5 ? 'Your struggle is coming down' : dS >= 5 ? 'Your struggle is rising' : 'Your struggle is holding steady'}</h2>
        <p class="small muted mb0">Average struggle per paper (bars) and score (line). Compared only with your own past.</p></div>
        <div class="dt-delta"><b class="display ${dS <= 0 ? 'good-t' : 'bad-t'}">${dS > 0 ? '+' : dS < 0 ? '−' : ''}${Math.abs(Math.round(dS))}</b><span class="small muted">struggle since ${fmtDate(series[0].sm.at)}</span></div></div>
      <svg class="dt-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Struggle and score across your mocks">
        ${series.map((d, i) => { const v = d.sm.meanStruggle ?? 0; const h = (v / 100) * (H - 34); return `<rect class="dt-bar" x="${(x(i) - bw / 2).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4"><title>${esc(d.s.templateName)} · struggle ${v} · score ${pct(d.sm.scorePct)}</title></rect><text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle">${fmtDate(d.sm.at)}</text><text class="dt-v" x="${x(i).toFixed(1)}" y="${(H - 22 - h).toFixed(1)}" text-anchor="middle">${v}</text>`; }).join('')}
        <path class="dt-line" d="${line}"/>${series.map((d, i) => `<circle class="dt-dot" cx="${x(i).toFixed(1)}" cy="${(H - 18 - d.sm.scorePct * (H - 34)).toFixed(1)}" r="4"/>`).join('')}
      </svg>
    </section>`;
  })() : '';

  // ---------- practise, aimed by the map ----------
  const practise = [];
  if (last && hasTrace(last)) {
    const R = buildReport(last);
    const seen = new Set();
    for (const t of R.bx.topics) {
      if (seen.has(t.key) || practise.length >= 4) continue;
      if (t.quads.blind) { practise.push({ topic: t.key, mode: 'slow', why: `${plural(t.quads.blind, 'blind spot')}: calm but wrong`, kind: 'blind' }); seen.add(t.key); }
      else if (t.quads.gap) { practise.push({ topic: t.key, mode: 'normal', why: `${plural(t.quads.gap, 'gap')}: strained and wrong`, kind: 'gap' }); seen.add(t.key); }
      else if (t.quads.fragile) { practise.push({ topic: t.key, mode: 'speed', why: `${t.quads.fragile} right but strained`, kind: 'fragile' }); seen.add(t.key); }
    }
  }
  const openMistakes = collectMistakes(p.exam).filter((x) => x.status === 'open').length;
  const practiseHTML = practise.length || openMistakes ? `<section class="desk-practise">
      <div class="eyebrow">Practise, aimed by your map</div>
      <div class="pr-grid">
        ${practise.map((t) => `<a class="pr-card pr-${t.kind}" href="#/drill/${encodeURIComponent(t.topic)}/${t.mode}"><span class="pr-kind">${t.kind === 'blind' ? 'Slow read' : t.kind === 'gap' ? 'Re-learn' : 'Speed drill'}</span><b>${esc(t.topic)}</b><small>${esc(t.why)}</small></a>`).join('')}
        ${openMistakes ? `<a class="pr-card pr-mistakes" href="#/drill/mistakes/normal"><span class="pr-kind">Re-attempt</span><b>Your mistakes</b><small>${plural(openMistakes, 'open question')}</small></a>` : ''}
      </div>
    </section>` : '';

  // ---------- folded: week + readiness + all tests ----------
  const plan = planFor(p.exam);
  const rd = readinessFor(p.exam);
  const planHTML = `<section class="card plan">
      <div class="card-head"><div><h3>This week</h3><p class="small muted mb0">${days != null && days > 0 ? `${plural(days, 'day')} to ${examLabel}` : '<a href="#/settings">Set your exam date</a> to pace the plan'} · ${plan.week}</p></div>
        <span class="chip">${plan.items.filter((x) => store.planCheck(`${plan.week}:${x.id}`)).length} of ${plan.items.length} done</span></div>
      <div class="plan-list">${plan.items.map((x) => {
        const key = `${plan.week}:${x.id}`; const checked = store.planCheck(key);
        return `<div class="plan-item ${checked ? 'done' : ''}"><label class="plan-check"><input type="checkbox" data-plan="${esc(key)}" ${checked ? 'checked' : ''} aria-label="Mark done: ${esc(x.title)}"><span class="box">${icon('check', { size: 14 })}</span></label>
          <div class="plan-ico ${x.kind}">${icon(x.icon, { size: 16 })}</div><div class="plan-txt"><b>${esc(x.title)}</b><p class="small muted mb0">${esc(x.body)}</p></div>${x.href ? `<a class="btn sm" href="${x.href}">${esc(x.cta)}</a>` : ''}</div>`;
      }).join('')}</div></section>`;
  const readinessHTML = rd.nTests ? `<section class="card readiness">
      <div class="card-head"><div><h3>Readiness</h3><p class="small muted mb0">Over your last ${plural(rd.nTests, 'mock')}. A practice gauge, not a prediction.</p></div><div class="rd-overall"><span class="rd-num display">${rd.overall ?? '—'}</span><span class="small muted">/ 100</span></div></div>
      <div class="rd-grid"><div class="chart">${radar(rd.dims, { size: 220 })}</div><div class="rd-dims">${rd.dims.map((d) => `<div class="rd-dim" data-tip="${esc(d.hint)}"><span class="rd-l">${d.label}</span><span class="rd-bar"><i style="width:${d.value ?? 0}%"></i></span><span class="rd-v num">${d.value == null ? '<span class="faint">—</span>' : d.value}</span><span></span></div>`).join('')}</div></div>
    </section>` : '';
  const recent = done.slice(-8).reverse().map((s) => {
    const sm = summaryOf(s); const isDrill = kindOf(s) === 'drill';
    return `<a class="test-row" href="${isDrill ? `#/drillresult/${s.id}` : `#/report/${s.id}`}"><div><div class="t-title">${isDrill ? icon('zap', { size: 13 }) + ' ' : ''}${esc(s.templateName)}</div><div class="t-meta"><span>${relDay(sm.at)}</span><span>${sm.attempted}/${sm.n} attempted</span>${sm.meanStruggle != null ? `<span>struggle ${sm.meanStruggle}</span>` : ''}${s.simulated ? '<span>sample data</span>' : ''}</div></div>
      <div class="t-score"><b class="num">${sm.score < 0 ? '−' + Math.abs(sm.score) : sm.score}</b><span class="faint">/${sm.max}</span><span class="t-acc">${pct(sm.accuracy)}</span></div></a>`;
  }).join('');

  root.innerHTML = `<div class="container desk">
    <header class="desk-head">
      <div><div class="eyebrow">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>${greeting()}${first ? `, <span class="hand-name">${esc(first)}</span>` : ''}.</h1>
        <p class="muted">${examLabel}${days != null && days > 0 ? ` · ${plural(days, 'day')} to go` : ''}</p></div>
      <div class="seg" role="group" aria-label="Exam"><button class="${p.exam === 'NEET' ? 'on' : ''}" data-exam="NEET">NEET</button><button class="${p.exam === 'JEE' ? 'on' : ''}" data-exam="JEE">JEE</button></div>
    </header>
    ${banners.length ? `<div class="desk-notes">${banners.join('')}</div>` : ''}
    <div class="desk-grid">
      <div class="desk-main">${nextPaper}${shelf ? `<div class="shelf"><span class="eyebrow">Or choose another paper</span><div class="shelf-row">${shelf}</div></div>` : ''}</div>
      <aside class="desk-side">${camCard}${mentorCard}</aside>
    </div>
    ${mapHTML}
    ${trend}
    ${practiseHTML}
    ${done.length ? `<details class="fold mt-lg"><summary><span>${icon('calendar', { size: 16 })} Your week and readiness</span><span class="deep-chev">${icon('chevron', { size: 16 })}</span></summary><div class="home-grid mt">${planHTML}${readinessHTML}</div></details>
    <details class="fold mt"><summary><span>${icon('list', { size: 16 })} All tests</span><span class="small muted">${done.length}</span><span class="deep-chev">${icon('chevron', { size: 16 })}</span></summary><div class="card mt" style="padding:4px 22px">${recent}</div><p class="small mt"><a href="#/history">Progress charts and topic journey ${icon('arrow', { size: 12 })}</a></p></details>` : ''}
  </div>`;

  root.onclick = async (e) => {
    const ex = e.target.closest('[data-exam]');
    if (ex) { store.updateProfile({ exam: ex.dataset.exam }); render(root); return; }
    const d = e.target.closest('[data-act=discard]');
    if (d) {
      const ok = await modal({ title: 'Discard this test?', body: '<p class="muted">Your answers for this attempt will be deleted from this device. This cannot be undone.</p>', buttons: [{ label: 'Keep it', value: false }, { label: 'Discard', value: true, cls: 'danger' }] });
      if (ok) { store.deleteSession(d.dataset.id); toast('Test discarded'); render(root); }
      return;
    }
    if (e.target.closest('[aria-disabled="true"]')) e.preventDefault();
  };
  root.onchange = (e) => {
    if (e.target.dataset.plan) { store.setPlanCheck(e.target.dataset.plan, e.target.checked); e.target.closest('.plan-item').classList.toggle('done', e.target.checked); }
  };
}
