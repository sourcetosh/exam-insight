// The student report. Describes what happened, never how the student felt.
import { store, kindOf } from '../store.js';
import { buildReport } from '../engine/report.js';
import { GROUPS, GROUP_ORDER, STATUS_LABEL, classify } from '../engine/topics.js';
import { topDriver, FEATURE_LABEL } from '../engine/friction.js';
import { isAnswered } from '../engine/scoring.js';
import { POLICY, DIFFICULTY_LABEL, TAGS, THRESHOLDS, BANKS } from '../config.js';
import { esc, plain, pct, fix, signed, fmtDur, fmtDate, fmtClock, fStep, F_STEPS, OPTION_KEYS, plural, toast } from '../ui.js';
import { topicScatter, fatigueBars, timeBars, sparkline, miniDist, allocBars } from './charts.js';
import { struggleSummary } from '../engine/insights.js';
import { replayHTML, mountReplay } from './replay.js';
import { icon } from '../icons.js';
import { questionStrip, stripLegend, quadrantBoard, topicStruggle, insightCards, strainChart, questionDetail, coverageNote } from './bxui.js';

const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.id, t.label]));
const mk = (v) => (v < 0 ? `−${Math.abs(v)}` : String(v));

export function render(root, [sid]) {
  const s = store.session(sid);
  if (!s) { location.replace('#/'); return; }
  if (s.status === 'review') { location.replace(`#/review/${sid}`); return; }
  if (s.status !== 'done') { location.replace(`#/test/${sid}`); return; }
  if (kindOf(s) === 'drill') { location.replace(`#/drillresult/${sid}`); return; }
  const R = buildReport(s);
  const full = R.level === 'full';
  const st = { sel: null, hl: new Set() };

  const ansLabel = (r, v) => {
    if (!isAnswered(v)) return 'blank';
    if (r.type !== 'mcq') return String(v);
    return s.layout === 'omr' ? `(${Number(v) + 1})` : OPTION_KEYS[v];
  };
  const keyLabel = (r) => (r.type === 'mcq' ? (s.layout === 'omr' ? `(${r.q.answer + 1})` : OPTION_KEYS[r.q.answer]) : String(r.q.answer));
  const resultWord = (r) => (r.correct === true ? 'Correct' : r.correct === false ? 'Wrong' : 'Not answered');

  // ---------- header ----------
  const sc = R.score;
  const usedFrac = s.elapsedMs / 1000 / s.durationSec;
  const baselineNote = full && R.baseline
    ? (R.baseline.source === 'own' ? `Friction is measured against your own last ${R.baseline.tests} tests.` : `Friction is measured against the pilot cohort until you have ${THRESHOLDS.ownHistoryAfter} tests (you have ${R.baseline.tests} before this one).`)
    : '';

  const B = R.bx;
  const hasBx = !!B?.enabled && !!B.quads;
  const ink = (n) => `<svg class="ink-circle" viewBox="0 0 220 120" aria-hidden="true"><path d="M30 64c-6-30 40-52 92-50 52 1 86 20 82 48-4 30-52 46-104 44C48 104 12 92 18 62c3-16 22-30 52-38"/></svg>`;
  const header = `<div class="report-top">
    <a class="back-link" href="#/history">${icon('back', { size: 14 })} Progress</a>
    <div class="result-sheet card">
      <div class="rs-main">
        <div class="eyebrow">${esc(s.templateName)} · ${fmtDate(s.endedAt || s.startedAt, { year: true })}${s.simulated ? ' · sample data' : ''}</div>
        <h1>Your result</h1>
        <p class="muted mb0">${sc.correct} right · ${sc.wrong} wrong · ${sc.unattempted} blank · ${fmtDur(s.elapsedMs / 1000)} of ${fmtDur(s.durationSec)}${s.endReason === 'timeout' ? ' · time ran out' : ''}</p>
        ${hasBx ? `<div class="rs-bx">
          <div><span class="k">Struggle</span><b class="display">${B.meanStruggle ?? '—'}</b><span class="small faint">average, of 100</span></div>
          <div><span class="k">Fragile</span><b class="display q-fragile-t">${B.quads.fragile.length}</b><span class="small faint">right, but strained</span></div>
          <div><span class="k">Blind spots</span><b class="display q-blind-t">${B.quads.blind.length}</b><span class="small faint">calm, but wrong</span></div>
          <div><span class="k">Face readable</span><b class="display">${Math.round(B.coverage * 100)}%</b><span class="small faint">of the test</span></div>
        </div>` : ''}
      </div>
      <div class="rs-score">
        <div class="rs-mark">${ink()}<span class="score-big">${mk(sc.score)}</span><small>/ ${sc.max}</small></div>
        ${R.pctile ? `<div class="pctile small muted" data-tip="${esc(`Pilot cohort for this format: ${R.pctile.n.toLocaleString('en-IN')} attempts. Synthetic in the prototype.`)}">${pct(sc.accuracy)} accuracy · above ${R.pctile.pct}% of pilot attempts</div>` : `<div class="small muted">${pct(sc.accuracy)} accuracy</div>`}
      </div>
    </div>
  </div>`;

  const SECTIONS = [
    ['overview', 'Overview'], ['replay', 'Replay'], ['timeline', 'Timeline'], ['topics', 'Topics'],
    ...(full ? [['patterns', 'Patterns']] : []), ['economics', 'Marks & time'], ...(full ? [['map', 'Map']] : []), ['proctor', 'Proctoring'], ['questions', 'Questions'],
  ];
  const PS = R.proctor;
  const identityText = () => ({
    match: 'Identity matched at the start.', override: 'Identity check overridden at the start (“it’s me”).', mismatch: 'Identity did not match at the start.',
    unsure: 'Identity could not be confirmed at the start.', skipped: 'Identity check skipped (model unavailable).', 'not-enrolled': 'No face enrolled, so identity was not checked.',
  })[PS.identityAtStart] || '';
  const integrityBlock = () => {
    const chips = PS.counts.map((c) => `<span class="chip ${c.severity >= 2 ? 'bad' : 'warn'}">${esc(c.label)} ×${c.n}</span>`).join('');
    if (!PS.enabled) {
      return `<div class="sum-block integrity off"><div class="eyebrow">Proctoring</div>
        <p class="mb0">${PS.reason === 'camera-unavailable' ? 'The camera could not start, so this test ran unproctored' : 'No camera for this test'}${PS.items.length ? `. Window checks only:` : '.'}</p>
        ${PS.items.length ? `<div class="row" style="gap:6px;margin-top:8px">${chips}</div>` : ''}</div>`;
    }
    if (PS.level === 'clean') return `<div class="sum-block integrity clean"><div class="eyebrow">Proctoring</div><p class="mb0"><b class="good-t">Clean.</b> Your face stayed in view, nobody else and no phone were seen. ${esc(identityText())}</p></div>`;
    return `<div class="sum-block integrity ${PS.level}"><div class="eyebrow">Proctoring</div>
      <div class="row" style="gap:6px">${chips}</div>
      <p class="small muted mb0" style="margin-top:8px">${esc(identityText())} <button class="linkish small" data-deep="proctor">See when, and on which question</button></p></div>`;
  };
  const proctorHTML = () => {
    const pre = PS.precheck;
    const okIds = pre ? pre.checks.filter((c) => c.state === 'ok').map((c) => c.id) : [];
    const LAB = { camera: 'camera', face: 'one face', align: 'aligned', light: 'lighting', pose: 'looking at the screen', identity: 'identity', phone: 'no phone', mic: 'quiet room' };
    const levelChip = { clean: '<span class="chip good">Clean</span>', minor: '<span class="chip warn">Minor notes</span>', review: '<span class="chip bad">Worth a look</span>', unproctored: '<span class="chip">Unproctored</span>' }[PS.level];
    return `<section class="card mt" id="proctor">
      <div class="card-head"><h2>${icon('eye', { size: 18, cls: 'h-ico' })} Proctoring log</h2>${levelChip}</div>
      <p class="muted small">${PS.enabled
        ? 'Checks ran on this device throughout: face in view, one person, no phone, looking at the screen, identity. Nothing was recorded; the list below is all that was kept. Window events are logged even without the camera.'
        : 'The camera was off for this test, so only window events (switching tabs, leaving full screen) were logged.'}</p>
      ${PS.enabled && pre ? `<div class="summary-list">
        <div><span>At the start</span><b>${okIds.length ? okIds.map((k) => LAB[k] || k).join(' · ') : '—'}${pre.mic ? '' : ' · microphone off'}</b></div>
        <div><span>Identity</span><b>${esc(identityText()) || '—'}</b></div>
        ${PS.cameraLost ? '<div><span>Camera</span><b>Lost during the test: the rest ran unproctored</b></div>' : ''}
      </div>` : ''}
      ${PS.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Question</th><th>What was noted</th><th class="r">For</th></tr></thead><tbody>
        ${PS.items.map((x) => `<tr><td class="mono">${fmtClock(x.t / 1000)}</td><td>${x.n ? `<button class="qlink" data-q="${x.n}">Q${x.n}</button> <span class="faint">${esc(x.topic || '')}</span>` : '—'}</td><td><span class="res-dot ${x.severity >= 2 ? 'no' : 'skip'}"></span>${esc(x.label)}</td><td class="r">${x.dur ? fmtDur(x.dur / 1000) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="small mb0 good-t">Nothing was noted.</p>'}
    </section>`;
  };
  const secNav = `<nav class="sec-nav" id="secnav" aria-label="Report sections">${SECTIONS.map(([id, l]) => `<a href="#${id}" data-sec="${id}">${l}</a>`).join('')}
    <span class="spacer"></span>
    <button class="btn sm ghost" id="copysum" data-tip="Copy a text summary">${icon('copy', { size: 14 })} Copy</button>
    <button class="btn sm ghost" id="printrep" data-tip="Print or save as PDF">${icon('printer', { size: 14 })} Print</button></nav>`;

  // ---------- coach's read + glance ----------
  const nav = R.tl.nav;
  const glance = () => {
    const items = [
      ['Opened', `${nav.opened}/${R.rows.length}`],
      ['Answered on first sight', `${nav.firstVisitAnswered}`],
      ['Came back to', plural(nav.secondPass.questions, 'question')],
      ['Longest stop', nav.longest ? `Q${nav.longest.n} · ${fmtDur(nav.longest.dur / 1000)}` : '—'],
    ];
    if (full) {
      items.push(['Answer changes', `${nav.changes}${nav.flips ? ` (${nav.flips} right→wrong)` : ''}`]);
      items.push(['No-input gaps', nav.idleTotal ? fmtDur(nav.idleTotal / 1000) : 'none over 15s']);
      items.push(['Tab switches', `${nav.blurCount}`]);
    }
    const diff = R.tl.finalAnswered - Math.min(R.tl.n, (R.tl.elapsed / R.tl.allowed) * R.tl.n);
    items.push(['Pace at the end', s.endReason === 'timeout' ? 'ran out of time' : diff >= 0 ? `${Math.round(diff)} ahead of even pace` : `${Math.round(-diff)} behind even pace`]);
    return `<div class="glance">${items.map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>`;
  };
  const overview = `<section class="card" id="overview">
    <div class="card-head"><div><h2>${icon('sparkles', { size: 18, cls: 'h-ico' })} The written read</h2><p class="small muted mb0">Written from your event log. Click a question number to open it on the timeline.</p></div></div>
    <div class="coach">${R.narrative.map((p) => `<p>${p}</p>`).join('')}</div>
    ${glance()}
  </section>`;

  // ---------- replay ----------
  const replay = `<section class="card mt" id="replay">
    <div class="card-head"><div><h2>${icon('replay', { size: 18, cls: 'h-ico' })} Minute by minute</h2><p class="small muted mb0">Which question was open at each moment, by subject lane. Below it, how many answers you had saved against the even pace the clock allowed.</p></div></div>
    ${replayHTML(R.tl, { rows: R.rows })}
  </section>`;

  // ---------- timeline ----------
  const cellTip = (r) => {
    const lines = [
      ['Result', `${resultWord(r)}${r.attempted ? ` (${r.marks > 0 ? '+' : ''}${r.marks})` : ''}`],
      ['Time', `${fmtDur(r.timeSec)} / ${fmtDur(r.expectedSec)} exp.`],
    ];
    if (full) {
      lines.push(['Revisits', r.revisits], ['Changes', r.changes]);
      if (r.idleMaxSec >= 15) lines.push(['Longest idle', fmtDur(r.idleMaxSec)]);
      lines.push(['Friction', r.F == null ? '—' : signed(r.F)]);
      if (r.tag) lines.push(['Your tag', TAG_LABEL[r.tag]]);
    }
    return `<b>Q${r.n}</b> · ${esc(r.topic)}<div class="tip-grid">${lines.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join('')}</div>`;
  };
  const cell = (r) => {
    const step = full ? fStep(r.F) : null;
    const cls = r.visits === 0 ? 'unseen' : step != null ? `f${step}` : 'f0';
    const res = r.correct === true ? 'ok' : r.correct === false ? 'no' : 'skip';
    return `<button class="tl-cell ${cls} ${st.hl.has(r.n) ? 'hl' : ''} ${st.sel === r.n ? 'sel' : ''}" data-n="${r.n}" data-tip="${esc(cellTip(r))}" aria-label="Question ${r.n}: ${resultWord(r)}">${r.n}<span class="res ${res}"></span></button>`;
  };
  const timeline = () => `<div class="timeline">${s.sections.map((sec) => `<div class="tl-sec"><span class="lbl">${esc(sec.name)}</span><div class="tl-cells">${R.rows.slice(sec.start, sec.end).map(cell).join('')}</div></div>`).join('')}</div>`;
  const tlLegend = `<div class="tl-legend">
      ${full ? `<span>Friction</span><span class="scale" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((i) => `<i style="background:var(--f${i})" data-tip="${F_STEPS[i]}"></i>`).join('')}</span><span>low → high</span><span class="sep"></span>` : ''}
      <span class="lg-res"><i class="ok"></i>Right</span><span class="lg-res"><i class="no"></i>Wrong</span><span class="lg-res"><i class="skip"></i>Blank</span>
      <span class="lg-res"><i class="unseen"></i>Never opened</span>
    </div>`;

  const detail = () => {
    if (st.sel == null) return `<div class="q-detail empty-detail">Select a question above, in the replay, or from the written read to see what happened on it.</div>`;
    const r = R.rows[st.sel - 1];
    const drv = full ? topDriver(r) : null;
    const opts = r.type === 'mcq' ? `<ol class="detail-opts">${r.q.options.map((o, i) => `<li class="${i === r.q.answer ? 'key' : ''} ${String(r.final) === String(i) && i !== r.q.answer ? 'mine' : ''}"><b>${s.layout === 'omr' ? `(${i + 1})` : OPTION_KEYS[i]}</b><span>${o}</span>${i === r.q.answer ? '<em>Answer key</em>' : String(r.final) === String(i) ? '<em>Your answer</em>' : ''}</li>`).join('')}</ol>` : `<p class="small">Answer key: <b class="mono">${esc(keyLabel(r))}</b> · Your answer: <b class="mono">${esc(ansLabel(r, r.final))}</b></p>`;
    const kv = [
      ['Result', `${resultWord(r)} · ${r.marks > 0 ? '+' : ''}${r.marks}`],
      ['Time spent', fmtDur(r.timeSec)],
      ['Expected', `${fmtDur(r.expectedSec)} <span class="faint">(${r.expSource === 'empirical' ? 'median of correct attempts' : `${DIFFICULTY_LABEL[r.difficulty].toLowerCase()} estimate`})</span>`],
      ['Visits', r.visits],
    ];
    if (r.cohortP != null) kv.push(['Pilot cohort', `${pct(r.cohortP)} got it right`]);
    if (full) {
      kv.push(['Answer changes', `${r.changes}${r.flipsRW ? ` · ${r.flipsRW} right→wrong` : ''}`]);
      kv.push(['Longest idle', r.idleMaxSec >= 15 ? fmtDur(r.idleMaxSec) : 'under 15s']);
      if (r.blurCount) kv.push(['Left the tab', plural(r.blurCount, 'time')]);
      if (r.face) kv.push(['Tension marker', r.face.ok ? `${signed(r.face.marker, 1)} vs your baseline${r.tag === 'sure' ? ' <span class="faint">(you tagged Sure, so it is set aside)</span>' : ''}` : '<span class="faint">camera quality too low</span>']);
      kv.push(['Friction', r.F == null ? '—' : `<b>${signed(r.F)}</b>${drv ? ` <span class="faint">mostly ${FEATURE_LABEL[drv].toLowerCase()}</span>` : ''}`]);
      kv.push(['Your tag', r.tag ? TAG_LABEL[r.tag] : '<span class="faint">not in review sample</span>']);
    }
    return `<div class="q-detail">
      <div class="row between"><div><b>Question ${r.n}</b> <span class="muted">· ${esc(r.subject)} · ${esc(r.topic)} · ${esc(r.q.subtopic || '')}</span></div>
        <div class="row" style="gap:6px">${r.correct === false ? `<a class="btn sm ghost" href="#/mistakes?q=${encodeURIComponent(r.qid)}">${icon('bookmark', { size: 14 })} In mistake log</a>` : ''}<button class="btn sm ghost" data-close>Close</button></div></div>
      <div class="kv">${kv.map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
      <details class="qd-text" ${r.correct === false ? 'open' : ''}><summary>Question, answer key${r.solution ? ' and solution' : ''}</summary><div class="q-text small-q">${r.q.text}</div>${opts}
        ${r.solution ? `<div class="solution"><div class="eyebrow">Solution</div><div>${r.solution}</div></div>` : ''}</details>
    </div>`;
  };

  // ---------- topics ----------
  const groupChip = (g) => (g ? `<span class="group-chip ${GROUPS[g].cls}"><i></i>${GROUPS[g].label}</span>` : '<span class="group-chip g-none"><i></i>Unclassified</span>');
  const statusChip = (t) => `<span class="status-chip st-${t.status}" data-tip="${esc(t.status === 'insufficient' ? `Flagged only after ${THRESHOLDS.minTopicQuestions} questions. ${t.cum.n} so far.` : t.status === 'early' ? `Same group in ${t.repeats} of ${t.testsSeen} tests. Confirmed once it repeats across ${THRESHOLDS.confirmTests} tests in a row.` : 'This pattern held in each of your last 3 tests.')}">${STATUS_LABEL[t.status]}</span>`;
  const drillHref = (t) => {
    const mode = t.group === 'fast' ? 'slow' : t.group === 'slow' ? 'speed' : 'normal';
    return `#/drill/${encodeURIComponent(t.topic)}/${mode}`;
  };
  const topicAction = (t) => {
    if (t.status === 'insufficient') return `<b>Watch this:</b> only ${t.cum.n} questions on this topic so far, too early to call a pattern.`;
    const nowG = classify(t.now);
    if (nowG && nowG !== t.group && t.group === 'fluent') {
      return `<b>Likely a one-off:</b> this test looked ${GROUPS[nowG].label.toLowerCase()}, but across your tests this topic is fluent. Recheck the questions below and act only if it repeats.`;
    }
    return `<b>Next step:</b> ${esc(GROUPS[t.group].action)}`;
  };
  const topCard = (t, i) => {
    const qs = R.rows.filter((r) => r.topic === t.topic).map((r) => r.n);
    return `<div class="topic-card">
      <div class="rank">${i + 1}</div>
      <div>
        <div class="row between" style="align-items:flex-start"><div><h4>${esc(t.topic)}</h4><div class="small muted">${esc(t.subject)} · ${esc(t.chapter)}</div></div>
          <div class="row" style="gap:6px">${groupChip(t.status === 'insufficient' ? null : t.group)}</div></div>
        <div class="tstats">
          <span>This test <b>${t.now.correct}/${t.now.n}</b> right</span>
          <span>Marks <b>${mk(t.now.marks)} / ${t.now.max}</b></span>
          <span>Time <b>${fix(t.now.timeRatio, 1)}×</b> expected</span>
          ${t.now.meanF != null ? `<span>Friction <b>${signed(t.now.meanF)}</b></span>` : ''}
          ${t.now.guessRate != null ? `<span>Guessed <b>${pct(t.now.guessRate)}</b> of tagged</span>` : ''}
        </div>
        <p class="action">${topicAction(t)}</p>
        <div class="row between"><div class="qlinks">${qs.map((n) => `<button class="qlink" data-q="${n}">Q${n}</button>`).join('')}</div>
          <div class="row" style="gap:8px">${statusChip(t)}<a class="btn sm" href="${drillHref(t)}">${icon('zap', { size: 13 })} Drill</a></div></div>
      </div>
    </div>`;
  };

  const topicTable = () => {
    const rows = [...R.map].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (b.cum.meanF ?? 0) - (a.cum.meanF ?? 0));
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Topic</th><th>Group</th><th class="r">Questions</th><th class="r">Accuracy</th><th class="r">Time vs exp.</th><th class="r">Friction</th><th class="r">Guess rate</th><th class="r">Revisits / Q</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((t) => `<tr data-topic="${esc(t.topic)}"><td><b>${esc(t.topic)}</b><div class="small faint">${esc(t.subject)}</div></td><td>${groupChip(t.status === 'insufficient' ? null : t.group)}</td>
        <td class="r num">${t.cum.n}</td><td class="r num">${pct(t.cum.accuracy)}</td><td class="r num">${fix(t.cum.timeRatio, 2)}×</td><td class="r num">${signed(t.cum.meanF)}</td>
        <td class="r num">${pct(t.cum.guessRate)}</td><td class="r num">${fix(t.cum.revisitRate, 2)}</td><td>${statusChip(t)}</td><td class="r"><a class="btn sm ghost" href="${drillHref(t)}">Drill</a></td></tr>`).join('')}</tbody></table></div>`;
  };

  // ---------- patterns ----------
  const patternsHTML = () => {
    const found = R.patterns.length
      ? R.patterns.map((p) => `<div class="pattern p-${p.id}">
        <h4>${esc(p.name)}<span class="chip">${plural(p.qs.length, 'question')}</span></h4>
        <p>${esc(p.headline)}</p>
        ${p.detail ? `<p class="small muted">${esc(p.detail)}</p>` : ''}
        ${p.curve ? `<div class="chart fatigue">${fatigueBars(p.curve)}</div>` : ''}
        <div class="row between"><div class="qlinks">${p.qs.map((n) => `<button class="qlink" data-q="${n}">Q${n}</button>`).join('')}</div>
          <button class="btn sm ghost" data-hl="${p.qs.join(',')}">Show on timeline</button></div>
      </div>`).join('')
      : `<div class="notice good">${icon('check')}<div><b>No costly pattern fired this time.</b> The checks below show how close each one came.</div></div>`;
    const checks = `<div class="checks">${R.checks.map((c) => `<div class="check-row ${c.found ? 'hit' : ''}">
        <span class="check-ico">${icon(c.found ? 'alert' : 'check', { size: 15 })}</span>
        <div><div class="row" style="gap:8px"><b>${esc(c.name)}</b><span class="small faint">${esc(c.rule)}</span></div>
          <div class="small">${esc(c.evidence)}${c.qs?.length && !c.found ? ` <span class="qlinks inline">${c.qs.slice(0, 4).map((n) => `<button class="qlink" data-q="${n}">Q${n}</button>`).join('')}</span>` : ''}</div></div>
      </div>`).join('')}</div>`;
    return `${found}<h3 class="mt">All seven checks</h3><p class="small muted">Every rule runs on every test. Here is what each one saw.</p>${checks}`;
  };

  // ---------- marks & time ----------
  const guessHTML = () => {
    const g = R.guess;
    const m = g.marking;
    const evLine = `<p class="small muted mb0">With +${m.correct} / ${m.wrong}: a blind guess is worth ${signed(g.evBlind)} on average; with one option ruled out, ${signed(g.evOneOut)}. Guess when you can eliminate, leave it when you can’t.</p>`;
    if (!g.tagged) return `<p class="muted small">Tag questions after a test to see how your guesses pay. ${g.wrongCount ? `Wrong answers cost you ${g.lostToNegative} marks in negatives this time.` : 'No negative marks this time.'}</p>${evLine}`;
    const rows = TAGS.map((t) => g.byTag[t.id]).map((x, i) => ({ ...x, label: TAGS[i].label })).filter((x) => x.n);
    return `<table class="table mini"><thead><tr><th>Tag</th><th class="r">Q</th><th class="r">Right</th><th class="r">Wrong</th><th class="r">Net</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${x.label}</td><td class="r num">${x.n}</td><td class="r num">${x.right}</td><td class="r num">${x.wrong}</td><td class="r num ${x.net > 0 ? 'good-t' : x.net < 0 ? 'bad-t' : ''}">${signed(x.net, 0)}</td></tr>`).join('')}</tbody></table>
      <p class="mt" style="margin-bottom:8px">${esc(g.verdict)}${g.lostToNegative ? ` Negative marking cost ${g.lostToNegative} marks overall.` : ''}</p>${evLine}`;
  };
  const diffHTML = () => `<div class="dmatrix">${R.diff.cells.map((c) => `<div class="dm-row">
      <span class="dm-l">${c.label}<small>${c.n} Q · ${c.timeRatio == null ? '—' : fix(c.timeRatio, 1) + '×'}</small></span>
      <span class="dm-bar">${['right', 'wrong', 'blank'].map((k) => (c[k] ? `<i class="${k}" style="flex:${c[k]}" data-tip="${c[k]} ${k}">${c[k]}</i>` : '')).join('')}</span>
    </div>`).join('')}</div>
    <div class="tl-legend" style="margin-top:8px"><span class="lg-res"><i class="ok"></i>Right</span><span class="lg-res"><i class="no"></i>Wrong</span><span class="lg-res"><i class="skip"></i>Blank</span></div>
    ${R.diff.note ? `<p class="small mt mb0">${esc(R.diff.note)}${R.diff.cells.find((c) => c.d === 1)?.wrongQs?.length ? ` <span class="qlinks inline">${R.diff.cells.find((c) => c.d === 1).wrongQs.map((n) => `<button class="qlink" data-q="${n}">Q${n}</button>`).join('')}</span>` : ''}</p>` : ''}`;
  const allocHTML = () => `<div class="alloc-legend"><span><i class="time"></i>share of your time</span><span><i class="marks"></i>share of marks</span></div>${allocBars(R.alloc.items)}<p class="small muted mt mb0">${R.alloc.skew ? `${esc(R.alloc.skew.name)} is the biggest mismatch: ${pct(R.alloc.skew.timeFrac)} of your time for ${pct(R.alloc.skew.availFrac)} of the marks.` : 'Your time was spread roughly in proportion to the marks on offer.'}</p>`;
  const economics = `<div class="grid three mt" id="economics">
    <section class="card"><div class="card-head"><h3>Guessing &amp; negative marks</h3></div>${full ? guessHTML() : `<p class="small muted">${R.guess ? '' : ''}Wrong answers cost ${R.rows.filter((r) => r.correct === false).length} negative marks.</p>`}</section>
    <section class="card"><div class="card-head"><h3>By difficulty</h3></div>${diffHTML()}</section>
    <section class="card"><div class="card-head"><h3>Time vs marks</h3><span class="small muted">per section</span></div>${allocHTML()}</section>
  </div>`;

  // ---------- trend ----------
  const trendHTML = () => {
    const pr = R.trend.prior;
    const cur = R.trend.current;
    if (!pr.length) return `<p class="muted small mb0">Your trend appears after your second mock.</p>`;
    const metrics = [
      { k: 'scorePct', label: 'Score', fmt: (v) => pct(v), better: 1 },
      { k: 'accuracy', label: 'Accuracy', fmt: (v) => pct(v), better: 1 },
      ...(full ? [
        { k: 'meanF', label: 'Mean friction', fmt: (v) => signed(v), better: -1 },
        { k: 'timeSinks', label: 'Time sinks', fmt: (v) => (v == null ? '—' : v), better: -1 },
      ] : []),
      { k: 'attempted', label: 'Attempted', fmt: (v) => v, better: 1, rel: 'n' },
    ];
    const avg = (k) => { const v = pr.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return `<div class="table-scroll"><table class="table trend-table"><thead><tr><th></th>${pr.map((x) => `<th class="r">${fmtDate(x.at)}</th>`).join('')}<th class="r">This test</th><th class="r">vs avg</th></tr></thead>
      <tbody>${metrics.map((m) => {
        const a = avg(m.k);
        const c = cur[m.k];
        let delta = '';
        if (a != null && c != null) {
          const d = c - a;
          const good = d * m.better > 0;
          const shown = m.k === 'scorePct' || m.k === 'accuracy' ? `${signed(d * 100, 0)} pts` : m.k === 'meanF' ? signed(d) : signed(d, 0);
          delta = Math.abs(d) < 1e-9 ? '<span class="faint">same</span>' : `<span class="${good ? 'delta-up' : 'delta-down'}">${shown}</span>`;
        }
        return `<tr><th>${m.label}</th>${pr.map((x) => `<td class="r num">${m.fmt(x[m.k])}</td>`).join('')}<td class="r num"><b>${m.fmt(c)}</b></td><td class="r num">${delta}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="spark-row">${sparkline([...pr.map((x) => x.scorePct), cur.scorePct], { w: 180, h: 36 })}<span class="small faint">Score %, last ${pr.length + 1} mocks</span></div>`;
  };

  // ---------- face / wellbeing / tags ----------
  const faceHTML = () => {
    const f = R.face;
    if (!f) return '';
    const dropped = Object.entries(f.dropped || {}).filter(([, n]) => n > 0);
    const reasonLabel = { lowLight: 'low light', noFace: 'face out of view' };
    const quality = f.validFrac < 0.75
      ? `<div class="notice warn">${icon('camera')}<div><b>Camera-quality note.</b> ${pct(1 - f.validFrac)} of frames were dropped (${dropped.map(([k, n]) => `${reasonLabel[k] || k}: ${n}`).join(', ') || 'mixed reasons'}). Dropped frames are never counted against you; those questions use behaviour signals only.</div></div>`
      : `<p class="small muted">${pct(f.validFrac)} of frames usable. ${f.usable} of ${f.visited} questions had enough frames for a marker.</p>`;
    return `<section class="card mt" id="face">
      <div class="card-head"><h2>Tension markers</h2><span class="chip">Low weight · camera</span></div>
      <p class="muted small">A tension marker compares brow, lip and eye-muscle activity with your own calm baseline. Faces don’t map reliably onto feelings, so this is never read as fear or anxiety, and it only appears where it lines up with what you did.</p>
      ${quality}
      ${f.coinciding.length ? `<ul class="list-plain">${f.coinciding.slice(0, 6).map((r) => `<li class="row between"><span><button class="qlink" data-q="${r.n}">Q${r.n}</button> ${esc(r.topic)}: ${[r.timeRatio >= 1.5 ? `${fix(r.timeRatio, 1)}× expected time` : '', r.revisits >= 2 ? `${r.revisits} revisits` : '', r.idleMaxSec >= 60 ? `${fmtDur(r.idleMaxSec)} idle` : ''].filter(Boolean).join(', ')}, and a tension marker above your baseline${r.tag === 'panicked' ? ' <span class="chip violet">You tagged: Panicked</span>' : ''}</span></li>`).join('')}</ul>`
        : '<p class="small mb0">No question had both a raised tension marker and a behaviour signal.</p>'}
      ${f.overruled.length ? `<p class="small faint mb0" style="margin-top:8px">Set aside because you tagged them Sure: ${f.overruled.map((n) => `Q${n}`).join(', ')}.</p>` : ''}
    </section>`;
  };
  const wellbeingHTML = () => (R.wellbeing ? `<section class="wellbeing mt">
      <h3>A note from us</h3>
      <p>You’ve tagged a few questions “Panicked” across your recent tests. That happens to a lot of people preparing for these exams, and it’s worth talking about with someone you trust: a friend, a family member, a teacher or a counsellor.</p>
      <p class="mb0">If you’d like to talk to a trained counsellor, <b>${POLICY.HELPLINE.name}</b> is free and available all day: call <b>${POLICY.HELPLINE.number}</b> or ${POLICY.HELPLINE.alt}.</p>
    </section>` : '');
  const signalHTML = () => {
    const t = R.tagF;
    if (!t) return '';
    const cells = TAGS.filter((x) => t[x.id]).map((x) => `<div class="sig"><span class="k">${x.label}</span><span class="v num">${signed(t[x.id].mean)}</span><span class="faint small">${plural(t[x.id].n, 'question')}</span></div>`);
    if (!cells.length) return '';
    return `<div class="signal-check"><div class="eyebrow">Friction vs your tags</div><div class="sig-row">${cells.join('')}</div>
      <p class="small faint mb0">If friction is working, questions you tagged Guessed or Panicked should sit higher than ones you tagged Sure. Your tags tune the weights in the pilot.</p></div>`;
  };

  const questionTable = () => `<details class="card mt qtable" id="questions"><summary><h2>Every question</h2><span class="small muted">${s.paper.length} rows</span></summary>
    <div class="table-wrap mt"><table class="table">
      <thead><tr><th>Q</th><th>Topic</th><th>Result</th><th class="r">Time</th><th class="r">Expected</th><th class="r">Cohort</th>${full ? '<th class="r">Revisits</th><th class="r">Changes</th><th class="r">Idle</th><th class="r">Friction</th><th>Tag</th>' : ''}</tr></thead>
      <tbody>${R.rows.map((r) => `<tr data-qrow="${r.n}"><td class="num"><button class="qlink" data-q="${r.n}">Q${r.n}</button></td><td>${esc(r.topic)}<div class="small faint">${DIFFICULTY_LABEL[r.difficulty]} · ${r.type === 'mcq' ? 'MCQ' : 'Numerical'}</div></td>
        <td><span class="res-dot ${r.correct === true ? 'ok' : r.correct === false ? 'no' : 'skip'}"></span>${resultWord(r)} <span class="faint">${r.attempted ? `(${r.marks > 0 ? '+' : ''}${r.marks})` : ''}</span></td>
        <td class="r num">${r.visits ? fmtDur(r.timeSec) : '—'}</td><td class="r num">${fmtDur(r.expectedSec)}</td><td class="r num">${r.cohortP == null ? '—' : pct(r.cohortP)}</td>
        ${full ? `<td class="r num">${r.revisits}</td><td class="r num">${r.changes}${r.flipsRW ? '<span class="bad-t">*</span>' : ''}</td><td class="r num">${r.idleMaxSec >= 15 ? fmtDur(r.idleMaxSec) : '–'}</td><td class="r num">${signed(r.F)}</td><td>${r.tag ? TAG_LABEL[r.tag] : '<span class="faint">–</span>'}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div>${full ? '<p class="small faint">* includes a change from a right answer to a wrong one.</p>' : ''}</details>`;

  // ---------- the simple summary: which questions, which topics, what next ----------
  const SS = struggleSummary(R.rows, full);
  const groupOf = (topic) => (full ? R.map.find((t) => t.topic === topic) : null);
  const drillModeFor = (t) => { const g = groupOf(t.topic); return g && g.status !== 'insufficient' ? (g.group === 'fast' ? 'slow' : g.group === 'slow' ? 'speed' : 'normal') : t.slow && !t.wrong ? 'speed' : 'normal'; };
  const nextStep = () => {
    if (full && R.experiments?.length) return R.experiments[0];
    const easyMiss = R.diff.cells.find((c) => c.d === 1)?.wrong || 0;
    if (easyMiss) return { title: 'Read each question twice', body: `You missed ${plural(easyMiss, 'easy question')}. A second read before answering catches most of those.` };
    if (sc.unattempted >= 2) return { title: 'Attempt what you can narrow down', body: 'With +4 / −1, a guess between two options is worth it; a blind guess is not.' };
    return { title: 'Take a longer test next', body: 'Nothing stood out as costly here. A longer paper tests your pacing properly.' };
  };
  const sqChip = (x) => `<button class="sq ${x.correct === false ? 'no' : !x.attempted ? 'skip' : 'slow'} ${st.sel === x.n ? 'sel' : ''}" data-q="${x.n}" aria-pressed="${st.sel === x.n}"><b>Q${x.n}</b><span class="sq-t">${esc(x.topic)}</span><span class="sq-r">${esc(x.reasons.join(' · '))}</span></button>`;
  const summary = () => {
    const ns = nextStep();
    return `<section class="card summary" id="summary">
      <div class="sum-block">
        <div class="eyebrow">Questions to look at</div>
        ${SS.questions.length ? `<div class="sq-row" id="sqrow">${SS.questions.slice(0, 8).map(sqChip).join('')}</div><p class="small muted">Tap a question to see it with the answer and solution.</p>`
          : '<p class="good-t">Every question right, none slow. Nothing to fix here.</p>'}
        <div id="sdetail"></div>
      </div>
      <div class="sum-block">
        <div class="eyebrow">Topics to work on</div>
        ${SS.topics.length ? `<div class="wk-list">${SS.topics.slice(0, 3).map((t) => {
          const g = groupOf(t.topic);
          const longTerm = g && g.status !== 'insufficient' ? ` · across your tests: ${GROUPS[g.group].label.toLowerCase()}` : '';
          return `<div class="wk"><div><b>${esc(t.topic)}</b><div class="small muted">${t.right} of ${t.n} right · ${esc(t.why.join(', '))}${longTerm}</div></div>
            <a class="btn sm primary" href="#/drill/${encodeURIComponent(t.topic)}/${drillModeFor(t)}">${icon('zap', { size: 13 })} Practise</a></div>`;
        }).join('')}</div>` : '<p class="good-t">No topic let you down in this test.</p>'}
        ${SS.good.length ? `<p class="small muted mb0" style="margin-top:8px">Solid: ${SS.good.map(esc).join(', ')}.</p>` : ''}
      </div>
      ${integrityBlock()}
      <div class="sum-block next">
        <div class="eyebrow">One thing to try next time</div>
        <b>${esc(ns.title)}</b>
        <p class="small muted mb0">${esc(ns.body)}</p>
      </div>
    </section>`;
  };

  // ---------- page ----------
  const timelineSec = `<section class="card mt" id="timeline">
      <div class="card-head"><div><h2>Question timeline</h2><p class="small muted mb0">One cell per question${full ? `, shaded by how much it cost you compared with your usual behaviour. ${esc(baselineNote)}` : '.'}</p></div></div>
      ${tlLegend}
      <div class="mt">${timeline()}</div>
      <div id="detail">${detail()}</div>
    </section>`;

  const fullPage = () => `
    ${overview}${replay}${timelineSec}
    <div class="report-grid mt" id="topics">
      <section class="card">
        <div class="card-head"><h2>Topics that hurt most</h2><span class="small muted">ranked by marks lost, extra time and friction</span></div>
        ${R.top5.length ? `<div class="stack">${R.top5.map(topCard).join('')}</div>` : '<p class="muted mb0">No topic cost you much in this test.</p>'}
      </section>
      <div class="stack" style="gap:16px">
        <section class="card next-test">
          <div class="card-head"><h2>Try next test</h2></div>
          ${R.experiments.slice(0, 2).map((x, i) => `<div class="experiment"><span class="n">${i + 1}</span><div><b>${esc(x.title)}</b><p class="small muted mb0">${esc(x.body)}</p><span class="small faint">From: ${esc(x.from)}</span></div></div>`).join('')}
        </section>
        <section class="card">
          <div class="card-head"><h2>Trend</h2><span class="small muted">vs your last ${R.trend.prior.length || 'few'} mocks</span></div>
          ${trendHTML()}
        </section>
      </div>
    </div>
    <section class="card mt" id="patterns">
      <div class="card-head"><h2>Behaviour patterns</h2><span class="small muted">rules on your event log · each linked to the questions behind it</span></div>
      ${patternsHTML()}
    </section>
    ${economics}
    ${wellbeingHTML()}
    <section class="card mt" id="map">
      <div class="card-head"><div><h2>Topic difficulty map</h2><p class="small muted mb0">All your ${s.exam} tests so far. Accuracy against time; quadrant lines are the classification thresholds.</p></div></div>
      <div class="map-grid">
        <div class="chart scatter">${topicScatter(R.map)}</div>
        <div class="group-key">${GROUP_ORDER.map((g) => `<div>${groupChip(g)}<p class="small muted">${GROUPS[g].pattern}.<br><b style="color:var(--text)">${GROUPS[g].action}</b></p></div>`).join('')}</div>
      </div>
      <div class="mt">${topicTable()}</div>
    </section>
    ${proctorHTML()}
    ${faceHTML()}
    <section class="card mt" id="tags"><div class="card-head"><h2>Your tags</h2></div>${signalHTML() || '<p class="small muted mb0">You skipped tagging for this test.</p>'}</section>
    ${questionTable()}
    <p class="small faint mt" style="text-align:center">Reports describe what happened, not how you felt. Your own tag always wins over anything inferred.</p>`;

  const basicPage = () => {
    const topics = new Map();
    for (const r of R.rows) {
      const t = topics.get(r.topic) || { topic: r.topic, subject: r.subject, n: 0, correct: 0, attempted: 0, time: 0, exp: 0 };
      t.n++; t.correct += r.correct ? 1 : 0; t.attempted += r.attempted ? 1 : 0; t.time += r.timeSec; t.exp += r.expectedSec;
      topics.set(r.topic, t);
    }
    return `
    ${overview}${replay}${timelineSec}
    <div class="report-grid mt" id="topics">
      <section class="card"><div class="card-head"><h2>Time per question</h2><span class="small muted">bar = your time · tick = expected</span></div>${timeBars(R.rows)}</section>
      <div class="stack" style="gap:16px">
        <section class="card"><div class="card-head"><h2>By topic</h2></div>
          <table class="table"><thead><tr><th>Topic</th><th class="r">Right</th><th class="r">Avg time</th><th></th></tr></thead><tbody>
          ${[...topics.values()].map((t) => `<tr><td>${esc(t.topic)}<div class="small faint">${esc(t.subject)}</div></td><td class="r num">${t.correct}/${t.n}</td><td class="r num">${fmtDur(t.time / t.n)}</td><td class="r"><a class="btn sm ghost" href="#/drill/${encodeURIComponent(t.topic)}/normal">Drill</a></td></tr>`).join('')}</tbody></table></section>
        <section class="card"><div class="card-head"><h2>Trend</h2></div>${trendHTML()}</section>
      </div>
    </div>
    ${economics}
    ${store.profile.ageBand === 'u18' ? `<div class="notice calm mt">${icon('info')}<div>This account shows scores and time per question. A parent can switch on behaviour analytics and camera checks in <a href="#/privacy">Privacy</a>.</div></div>` : `<div class="notice calm mt">${icon('info')}<div>Behaviour analytics is off, so this report shows scores and time only. <a href="#/privacy">Turn it on in Privacy</a> to see friction, patterns and the topic map from your next test.</div></div>`}
    ${proctorHTML()}
    ${questionTable()}`;
  };

  // ---------- behaviour: the heart of the report ----------
  const partHead = (n, title, sub) => `<div class="part-head"><span class="part-n display">§${n}</span><div><h2>${title}</h2><p class="small muted mb0">${sub}</p></div></div>`;
  const mentorNotes = store.mentorNotesFor ? store.mentorNotesFor(s.id) : [];
  const bxSection = () => `<section class="bxsheet card" id="behaviour">
    ${mentorNotes.length ? `<aside class="mnote">${mentorNotes.map((m) => `<div><span class="hand">${esc(m.text)}</span><span class="small faint">${esc(m.by)} · ${fmtDate(m.at)}</span></div>`).join('')}</aside>` : ''}
    <div class="bx-part" id="where">
      ${partHead(1, 'Where you struggled', 'Each square is a question, shaded by how strained your face was while you worked on it, against your own calm face. Tap one to see it second by second.')}
      ${stripLegend()}
      ${questionStrip(s, R.rows, { sel: st.sel })}
      <div id="bxdetail">${st.sel ? questionDetail(s, R.rows[st.sel - 1]) : ''}</div>
    </div>
    <div class="bx-part" id="kinds">
      ${partHead(2, 'Four kinds of question', 'Your face against the outcome. Each kind needs a different fix.')}
      ${quadrantBoard(B)}
    </div>
    <div class="bx-part" id="tstrain">
      ${partHead(3, 'Topics that strained you', 'Average struggle per topic, and how the questions in it went.')}
      ${topicStruggle(B)}
    </div>
    <div class="bx-part" id="told">
      ${partHead(4, 'What your face showed', 'When and how the strain came, each finding with the questions behind it.')}
      ${insightCards(B)}
    </div>
    <div class="bx-part" id="overtime">
      ${partHead(5, 'Minute by minute', 'Your strain across the whole paper. Tap a stretch to open that question.')}
      ${strainChart(R, { sel: st.sel })}
      ${coverageNote(B)}
    </div>
  </section>`;
  const noBx = () => `<div class="notice calm mt">${icon('camera')}<div>${B?.legacy
    ? 'This test was taken before expression tracing, so it has an older, simpler camera summary in the full analysis below.'
    : 'This test ran without the camera, so there is no behaviour map. Marks and timing are below.'}</div></div>`;

  let deepOpen = false;
  try { deepOpen = localStorage.getItem('ei-deep') === '1'; } catch { /* ignore */ }
  root.innerHTML = `<div class="container report">${header}
    ${hasBx ? bxSection() : noBx()}
    <details class="deep" id="deep" ${deepOpen || !hasBx ? 'open' : ''}>
      <summary><span>${icon('chart', { size: 16 })} Marks, timing and the full log</span><span class="small muted">questions to look at · written read · replay · timeline · patterns · marks &amp; time${full ? ' · topic map' : ''} · proctoring</span><span class="deep-chev">${icon('chevron', { size: 16 })}</span></summary>
      <div class="mt">${summary()}</div>
      <div class="deep-meta row" style="gap:8px;margin-top:10px">
        <span class="chip ${full ? 'accent' : ''}">${full ? 'Full analytics' : 'Scores + time per question'}</span>
        <span class="chip" data-tip="${esc(BANKS[s.bank || 'standard'].blurb)}">${BANKS[s.bank || 'standard'].label} questions</span>
        ${PS.enabled ? `<span class="chip ${PS.level === 'clean' ? 'good' : PS.level === 'review' ? 'bad' : 'warn'}">${PS.level === 'clean' ? 'Proctored · clean' : `Proctored · ${PS.total} noted`}</span>` : '<span class="chip">Unproctored</span>'}
      </div>
      ${secNav}<div class="mt">${full ? fullPage() : basicPage()}</div>
    </details>
  </div>`;
  root.querySelector('#deep').addEventListener('toggle', (e) => { try { localStorage.setItem('ei-deep', e.target.open ? '1' : '0'); } catch { /* ignore */ } });
  const unmountReplay = mountReplay(root, R.tl, { rows: R.rows, onSelect: (n) => selectQ(n) });

  // ---------- interactions ----------
  const redrawTimeline = () => {
    const tl = root.querySelector('#timeline .timeline');
    if (tl) tl.outerHTML = timeline();
    const d = root.querySelector('#detail');
    if (d) d.innerHTML = detail();
    const sd = root.querySelector('#sdetail');
    if (sd) sd.innerHTML = st.sel == null ? '' : detail();
    root.querySelectorAll('.sq').forEach((b) => { const on = Number(b.dataset.q) === st.sel; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
    root.querySelectorAll('.bxq').forEach((b) => b.classList.toggle('sel', Number(b.dataset.q) === st.sel));
    root.querySelectorAll('.sc-seg').forEach((b) => b.classList.toggle('on', Number(b.dataset.q) === st.sel));
    const bd = root.querySelector('#bxdetail');
    if (bd) bd.innerHTML = st.sel == null ? '' : questionDetail(s, R.rows[st.sel - 1]);
  };
  const selectQ = (n, scroll = true, from = null) => {
    st.sel = n;
    if (!st.hl.has(n)) st.hl = new Set();
    redrawTimeline();
    if (scroll) {
      const deep = root.querySelector('#deep');
      const inBx = hasBx && (!from || from.closest('#behaviour'));
      const target = inBx ? root.querySelector('#bxdetail') : deep?.open && root.querySelector('#detail') ? root.querySelector('#detail') : root.querySelector('#sdetail');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  const summaryText = () => {
    const lines = [`${s.templateName} · ${fmtDate(s.endedAt || s.startedAt, { year: true })}`, `Score ${mk(sc.score)}/${sc.max} · accuracy ${pct(sc.accuracy)} · ${sc.attempted}/${s.paper.length} attempted · ${fmtDur(s.elapsedMs / 1000)} used`, ''];
    for (const p of R.narrative) lines.push(plain(p.replace(/<\/?b>/g, '')), '');
    if (R.top5?.length) lines.push('Costliest topics: ' + R.top5.map((t) => `${t.topic} (${GROUPS[t.group]?.label || '—'})`).join('; '));
    if (R.patterns?.length) lines.push('Patterns: ' + R.patterns.map((p) => p.name).join(', '));
    return lines.join('\n');
  };
  root.onclick = async (e) => {
    const c = e.target.closest('.tl-cell');
    if (c) { const n = Number(c.dataset.n); st.sel = st.sel === n ? null : n; redrawTimeline(); return; }
    const sq = e.target.closest('.sq');
    if (sq) { const n = Number(sq.dataset.q); st.sel = st.sel === n ? null : n; redrawTimeline(); return; }
    const bq = e.target.closest('.bxq');
    if (bq) { const n = Number(bq.dataset.q); if (st.sel === n) { st.sel = null; redrawTimeline(); } else selectQ(n, true, bq); return; }
    const seg = e.target.closest('.sc-seg');
    if (seg) { selectQ(Number(seg.dataset.q), true, seg); return; }
    const q = e.target.closest('.qlink');
    if (q) { selectQ(Number(q.dataset.q), true, q); return; }
    const dp = e.target.closest('[data-deep]');
    if (dp) {
      const deep = root.querySelector('#deep');
      if (deep && !deep.open) deep.open = true;
      setTimeout(() => root.querySelector(`#${dp.dataset.deep}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
      return;
    }
    const hl = e.target.closest('[data-hl]');
    if (hl) {
      st.hl = new Set(hl.dataset.hl.split(',').map(Number));
      st.sel = [...st.hl][0];
      redrawTimeline();
      root.querySelector('#timeline').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (e.target.closest('[data-close]')) { st.sel = null; st.hl = new Set(); redrawTimeline(); return; }
    if (e.target.closest('#copysum')) {
      try { await navigator.clipboard.writeText(summaryText()); toast('Summary copied'); } catch { toast('Could not copy on this browser'); }
      return;
    }
    if (e.target.closest('#printrep')) { root.querySelectorAll('details').forEach((d) => { d.open = true; }); window.print(); return; }
    const a = e.target.closest('.sec-nav a');
    if (a) { e.preventDefault(); root.querySelector(`#${a.dataset.sec}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };

  // Section nav highlight
  const links = [...root.querySelectorAll('.sec-nav a')];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) links.forEach((l) => l.classList.toggle('on', l.dataset.sec === en.target.id));
  }, { rootMargin: '-120px 0px -70% 0px', threshold: 0 });
  SECTIONS.forEach(([id]) => { const el = root.querySelector(`#${id}`); if (el) io.observe(el); });

  return () => { io.disconnect(); unmountReplay(); };
}
