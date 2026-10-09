// Behaviour renderers shared by the student's result page and the mentor workspace:
// the question strip, the four-kinds board, topic struggle, insight cards, the strain-over-time
// chart, and the per-question face detail.
import { QUADRANTS, QUADRANT_ORDER, washStep, LEVEL_LABEL } from '../engine/behaviour.js';
import { COMPONENT_LABEL } from '../face/expression.js';
import { EXPRESSION } from '../config.js';
import { esc, fmtDur, fmtClock, pct, plural, OPTION_KEYS } from '../ui.js';
import { icon } from '../icons.js';

/** The mentor reads the same findings about a student, in the third person. */
export const thirdPerson = (t) => t
  .replace(/\byou’re\b/g, 'they’re').replace(/\byou’ve\b/g, 'they’ve').replace(/\bYou’re\b/g, 'They’re')
  .replace(/\byourself\b/g, 'themselves').replace(/\byour\b/g, 'their').replace(/\bYour\b/g, 'Their')
  .replace(/\b(costs?|strains|for|to|help|helps|tells|shows|gives) you\b/g, '$1 them').replace(/\byou\b/g, 'they').replace(/\bYou\b/g, 'They');

const resultMark = (r) => (r.correct === true ? '✓' : r.correct === false ? '✗' : '–');
const qTip = (r) => {
  const x = r.bx;
  const lines = [
    ['Result', r.correct === true ? 'Correct' : r.correct === false ? 'Wrong' : r.visits ? 'Left blank' : 'Never opened'],
    ['Struggle', x?.struggle == null ? 'not enough face data' : `${x.struggle} · ${LEVEL_LABEL[x.level]}`],
    ['Time', `${fmtDur(r.timeSec)} (${fmtDur(r.expectedSec)} expected)`],
  ];
  if (x?.writing) lines.push(['Writing', fmtDur(x.writing)]);
  return `<b>Q${r.n}</b> · ${esc(r.topic)}<div class="tip-grid">${lines.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join('')}</div><div style="margin-top:4px">${esc(QUADRANTS[x?.quadrant || 'unread'].label)}</div>`;
};

/** One cell per question, shaded by struggle, ringed by outcome, grouped by section. */
export function questionStrip(s, rows, { sel = null } = {}) {
  const cell = (r) => {
    const x = r.bx;
    const st = washStep(x?.struggle);
    const cls = !r.visits ? 'unseen' : st == null ? 'noread' : `w${st}`;
    return `<button class="bxq ${cls} res-${r.correct === true ? 'ok' : r.correct === false ? 'no' : 'skip'} quad-${x?.quadrant || 'unread'} ${sel === r.n ? 'sel' : ''}" data-q="${r.n}" data-tip="${esc(qTip(r))}" aria-label="Question ${r.n}, ${esc(QUADRANTS[x?.quadrant || 'unread'].label)}">
      <span class="bxq-n">${r.n}</span><span class="bxq-m">${resultMark(r)}</span></button>`;
  };
  return `<div class="bxstrip">${s.sections.map((sec) => `<div class="bxsec"><span class="bxsec-l">${esc(sec.name)}</span><div class="bxcells">${rows.slice(sec.start, sec.end).map(cell).join('')}</div></div>`).join('')}</div>`;
}

export function stripLegend() {
  return `<div class="bxlegend">
    <span class="bxl-scale"><span>Calm</span>${[0, 1, 2, 3, 4, 5].map((i) => `<i class="w${i}"></i>`).join('')}<span>Strained</span></span>
    <span class="bxl-sep"></span>
    <span><b class="mk ok">✓</b> right</span><span><b class="mk no">✗</b> wrong</span><span><b class="mk">–</b> blank</span>
    <span class="bxl-sep"></span>
    <span><i class="bxl-noread"></i> face not readable</span>
  </div>`;
}

/** The four kinds of question: calm/strained x correct/wrong, plus skips. */
export function quadrantBoard(B, { compact = false } = {}) {
  const chips = (list, max = compact ? 6 : 12) => list.length
    ? `<div class="qd-chips">${list.slice(0, max).map((r) => `<button class="qlink" data-q="${r.n}">Q${r.n}</button>`).join('')}${list.length > max ? `<span class="faint small">+${list.length - max}</span>` : ''}</div>`
    : '<p class="small faint mb0">None</p>';
  const cell = (k, act) => {
    const list = B.quads[k] || [];
    return `<div class="qd qd-${k}">
      <div class="qd-head"><span class="qd-n display">${list.length}</span><div><b>${QUADRANTS[k].short}</b><span class="small muted">${QUADRANTS[k].label}</span></div></div>
      ${compact ? '' : `<p class="small qd-what">${act}</p>`}
      ${chips(list)}
    </div>`;
  };
  const sk = [...(B.quads.avoided || []), ...(B.quads.skipped || [])];
  return `<div class="qboard ${compact ? 'compact' : ''}">
    <div class="qb-axis qb-x"><span>Your face stayed calm</span><span>Your face showed strain</span></div>
    <div class="qb-axis qb-y"><span>Correct</span><span>Wrong</span></div>
    <div class="qb-grid">
      ${cell('mastered', 'Secure. Spend less time here.')}
      ${cell('fragile', 'You know it, but it costs. Practise until it feels easy.')}
      ${cell('blind', 'A misconception you can’t feel. Read these solutions first.')}
      ${cell('gap', 'Hard and wrong. Re-learn the idea, then drill it.')}
    </div>
    ${sk.length ? `<div class="qb-skips"><span class="small muted">Skipped:</span> ${(B.quads.avoided || []).length ? `<span class="chip">${(B.quads.avoided || []).length} after straining</span>` : ''} ${(B.quads.skipped || []).length ? `<span class="chip">${(B.quads.skipped || []).length} calmly</span>` : ''} ${sk.map((r) => `<button class="qlink" data-q="${r.n}">Q${r.n}</button>`).join('')}</div>` : ''}
  </div>`;
}

/** Topic rows: struggle wash bar, accuracy, the mix of kinds, questions, practise. */
export function topicStruggle(B, { drill = true, max = 99 } = {}) {
  const rows = B.topics.filter((t) => t.struggle != null).slice(0, max);
  if (!rows.length) return '<p class="muted small mb0">Not enough face data to rank topics.</p>';
  const mix = (t) => {
    const total = Object.values(t.quads).reduce((a, b) => a + b, 0) || 1;
    return `<span class="tmix">${QUADRANT_ORDER.filter((k) => t.quads[k]).map((k) => `<i class="qc-${k}" style="flex:${t.quads[k]}" data-tip="${esc(`${t.quads[k]} ${QUADRANTS[k].short.toLowerCase()}`)}"></i>`).join('')}</span>`;
  };
  return `<div class="tstrain">${rows.map((t) => `<div class="ts-row">
      <div class="ts-name"><b>${esc(t.key)}</b><span class="small faint">${esc(t.subject || '')}</span></div>
      <div class="ts-bar" data-tip="${esc(`Struggle ${t.struggle} · ${LEVEL_LABEL[t.level]}`)}"><i class="w${washStep(t.struggle)}" style="width:${Math.max(4, t.struggle)}%"></i><span class="ts-v num">${t.struggle}</span></div>
      <div class="ts-acc small">${t.accuracy == null ? '—' : `${t.correct}/${t.attempted} right`}</div>
      ${mix(t)}
      <div class="ts-qs">${t.qs.map((r) => `<button class="qlink" data-q="${r.n}">Q${r.n}</button>`).join('')}</div>
      ${drill ? `<a class="btn sm" href="#/drill/${encodeURIComponent(t.key)}/${t.quads.blind ? 'slow' : t.quads.fragile && !t.quads.gap ? 'speed' : 'normal'}">${icon('zap', { size: 13 })} Practise</a>` : ''}
    </div>`).join('')}</div>`;
}

/** Insight cards: what the face showed, with the evidence and the questions. */
export function insightCards(B, { max = 6, who = 'you' } = {}) {
  const list = B.insights.slice(0, max);
  if (!list.length) return '<p class="muted small mb0">Nothing unusual stood out in how your face responded this time.</p>';
  const tag = { warn: 'Watch', bad: 'Fix first', good: 'Keep', info: 'Notice' };
  const third = (t) => (who === 'you' ? t : thirdPerson(t));
  return `<div class="insights">${list.map((x, i) => `<article class="ins ins-${x.kind}">
      <span class="ins-tag hand">${tag[x.kind] || 'Notice'}</span>
      <h3>${i === 0 ? '<span class="ins-first">1</span>' : `<span class="ins-n">${i + 1}</span>`}${esc(third(x.title))}</h3>
      <p>${third(x.body)}</p>
    </article>`).join('')}</div>`;
}

/** Strain over the whole test: an ink-wash area with question boundaries and a states ribbon. */
export function strainChart(R, { sel = null, height = 150 } = {}) {
  const B = R.bx;
  const bins = B.fine;
  if (!bins?.length) return '';
  const T = B.seconds;
  const W = 1000, H = height, top = 8, base = H - 18;
  const X = (sec) => (sec / T) * W;
  const Y = (v) => base - v * (base - top);
  let d = '', line = '';
  let open = false;
  bins.forEach((b) => {
    const x0 = X(b.t0), x1 = X(b.t1);
    if (b.strain == null) { if (open) { d += `L${x0.toFixed(1)},${base}Z`; open = false; } return; }
    const y = Y(Math.min(1, b.strain));
    if (!open) { d += `M${x0.toFixed(1)},${base}L${x0.toFixed(1)},${y.toFixed(1)}`; line += `M${x0.toFixed(1)},${y.toFixed(1)}`; open = true; }
    d += `L${x1.toFixed(1)},${y.toFixed(1)}`;
    line += `L${x1.toFixed(1)},${y.toFixed(1)}`;
  });
  if (open) d += `L${X(bins[bins.length - 1].t1).toFixed(1)},${base}Z`;
  const ribbon = bins.map((b) => {
    const k = b.gap > 0.5 ? 'gap' : b.writing > 0.5 ? 'writing' : b.away > 0.35 ? 'away' : 'reading';
    return k === 'reading' ? '' : `<rect class="rb-${k}" x="${X(b.t0).toFixed(1)}" y="${base + 6}" width="${Math.max(1, X(b.t1) - X(b.t0)).toFixed(1)}" height="8"/>`;
  }).join('');
  const segs = R.visits.map((v) => {
    const r = R.rows.find((x) => x.qid === v.q);
    if (!r) return '';
    const x0 = X(v.start / 1000), x1 = X(v.end / 1000);
    return `<rect class="sc-seg ${sel === r.n ? 'on' : ''}" x="${x0.toFixed(1)}" y="${top}" width="${Math.max(1.5, x1 - x0).toFixed(1)}" height="${base - top}" data-q="${r.n}" data-tip="${esc(`<b>Q${r.n}</b> · ${esc(r.topic)} · ${fmtClock(v.start / 1000)}–${fmtClock(v.end / 1000)}`)}"/>`;
  }).join('');
  const thr = Y(EXPRESSION.strained);
  const ticks = [];
  const step = T > 3600 ? 1800 : T > 1200 ? 600 : T > 300 ? 120 : 60;
  for (let t = 0; t <= T; t += step) ticks.push(`<span style="left:${((t / T) * 100).toFixed(2)}%">${fmtClock(t)}</span>`);
  return `<div class="schart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Strain over the test">
      <defs><linearGradient id="wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--f4)" stop-opacity=".9"/><stop offset=".55" stop-color="var(--f2)" stop-opacity=".55"/><stop offset="1" stop-color="var(--f1)" stop-opacity=".15"/></linearGradient>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="6" fill="var(--faint)"/></pattern></defs>
      <line class="sc-thr" x1="0" x2="${W}" y1="${thr.toFixed(1)}" y2="${thr.toFixed(1)}"/>
      <path class="sc-area" d="${d}" fill="url(#wash)"/>
      <path class="sc-line" d="${line}"/>
      ${segs}
      <line class="sc-base" x1="0" x2="${W}" y1="${base}" y2="${base}"/>
      ${ribbon}
    </svg>
    <div class="sc-axis">${ticks.join('')}</div>
    <div class="sc-legend"><span><i class="lg-wash"></i>strain (your face vs your calm face)</span><span><i class="lg-thr"></i>strained above this line</span><span><i class="rb-writing"></i>writing</span><span><i class="rb-away"></i>looking away</span><span><i class="rb-gap"></i>face not readable</span></div>
  </div>`;
}

/** One question's face, second by second, with the outcome. */
export function questionFace(r) {
  const x = r.bx;
  if (!x || !x.secs) return '<p class="small faint mb0">No camera data for this question.</p>';
  const W = 320, H = 70, base = 54, top = 4;
  const n = x.trace.length || 1;
  const X = (i) => (i / n) * W;
  const Y = (v) => base - Math.min(1, v) * (base - top);
  let d = '', line = '', open = false;
  x.trace.forEach((v, i) => {
    if (v == null) { if (open) { d += `L${X(i).toFixed(1)},${base}Z`; open = false; } return; }
    if (!open) { d += `M${X(i).toFixed(1)},${base}L${X(i).toFixed(1)},${Y(v).toFixed(1)}`; line += `M${X(i).toFixed(1)},${Y(v).toFixed(1)}`; open = true; }
    d += `L${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`;
    line += `L${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`;
  });
  if (open) d += `L${W},${base}Z`;
  const rib = [...x.states].map((c, i) => (c === 'r' ? '' : `<rect class="rb-${c === 'w' ? 'writing' : c === 'a' ? 'away' : 'gap'}" x="${X(i).toFixed(1)}" y="${base + 5}" width="${Math.max(1, W / n).toFixed(1)}" height="7"/>`)).join('');
  const thr = Y(EXPRESSION.strained);
  const onset = x.onset != null ? `<line class="qf-onset" x1="${X(x.onset).toFixed(1)}" x2="${X(x.onset).toFixed(1)}" y1="${top}" y2="${base}"/>` : '';
  const comps = x.comp ? Object.entries(x.comp).filter(([, v]) => v > 0.08).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  return `<div class="qface">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="qf-svg" aria-hidden="true"><defs><linearGradient id="wash2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--f4)" stop-opacity=".9"/><stop offset="1" stop-color="var(--f1)" stop-opacity=".2"/></linearGradient></defs>
      <line class="sc-thr" x1="0" x2="${W}" y1="${thr.toFixed(1)}" y2="${thr.toFixed(1)}"/>${onset}<path d="${d}" fill="url(#wash2)"/><path class="sc-line" d="${line}"/><line class="sc-base" x1="0" x2="${W}" y1="${base}" y2="${base}"/>${rib}</svg>
    <div class="qf-kv">
      <div><span class="k">Struggle</span><b>${x.struggle == null ? '—' : x.struggle}</b><span class="small faint">${LEVEL_LABEL[x.level]}</span></div>
      <div><span class="k">Strained</span><b>${fmtDur(x.strained)}</b><span class="small faint">of ${fmtDur(x.reading)} reading</span></div>
      <div><span class="k">Strain began</span><b>${x.onset == null ? '—' : x.onset <= 2 ? 'at once' : `after ${fmtDur(x.onset)}`}</b></div>
      <div><span class="k">Writing</span><b>${x.writing ? fmtDur(x.writing) : '—'}</b></div>
      ${comps.length ? `<div class="qf-comp"><span class="k">Showed as</span><b>${comps.map(([c, v]) => `${COMPONENT_LABEL[c]} <span class="faint">${Math.round(v * 100)}%</span>`).join(' · ')}</b></div>` : ''}
    </div>
  </div>`;
}

/** Full detail for one question: the face, what happened, the question and the solution. */
export function questionDetail(s, r, { closable = true, mistakesLink = true, who = 'you' } = {}) {
  const tp = (t) => (who === 'you' ? t : thirdPerson(t));
  const lab = (i) => (s.layout === 'omr' ? `(${i + 1})` : OPTION_KEYS[i]);
  const opts = r.type === 'mcq'
    ? `<ol class="detail-opts">${r.q.options.map((o, i) => `<li class="${i === r.q.answer ? 'key' : ''} ${String(r.final) === String(i) && i !== r.q.answer ? 'mine' : ''}"><b>${lab(i)}</b><span>${o}</span>${i === r.q.answer ? '<em>Answer key</em>' : String(r.final) === String(i) ? `<em>${who === 'you' ? 'Your' : 'Their'} answer</em>` : ''}</li>`).join('')}</ol>`
    : `<p class="small">Answer key: <b class="mono">${esc(String(r.q.answer))}</b> · Your answer: <b class="mono">${r.attempted ? esc(String(r.final)) : 'blank'}</b></p>`;
  const quad = r.bx?.quadrant || 'unread';
  const happened = [
    `${fmtDur(r.timeSec)} on it (${fmtDur(r.expectedSec)} expected)`,
    r.visits > 1 ? `opened ${r.visits} times` : null,
    r.changes ? `${plural(r.changes, 'answer change')}${r.flipsRW ? `, ${r.flipsRW} from right to wrong` : ''}` : null,
    r.idleMaxSec >= 30 ? `${fmtDur(r.idleMaxSec)} without touching anything` : null,
  ].filter(Boolean).join(' · ');
  return `<div class="bxdetail">
    <div class="bxd-head">
      <div><span class="bxd-q display">Q${r.n}</span><span class="muted">${esc(r.subject)} · ${esc(r.topic)}</span></div>
      <div class="row" style="gap:6px"><span class="qchip qc-${quad}">${QUADRANTS[quad].short}</span>
        ${mistakesLink && r.correct === false ? `<a class="btn sm ghost" href="#/mistakes?q=${encodeURIComponent(r.qid)}">${icon('bookmark', { size: 14 })} Mistake log</a>` : ''}
        ${closable ? '<button class="btn sm ghost" data-close>Close</button>' : ''}</div>
    </div>
    <p class="bxd-what"><b>${esc(QUADRANTS[quad].label)}.</b> ${esc(tp(QUADRANTS[quad].tip))}</p>
    ${questionFace(r)}
    <p class="small muted">${esc(happened)}</p>
    <details class="qd-text" ${r.correct === false ? 'open' : ''}><summary>Question, answer key${r.solution ? ' and solution' : ''}</summary><div class="q-text small-q">${r.q.text}</div>${opts}
      ${r.solution ? `<div class="solution"><div class="eyebrow">Solution</div><div>${r.solution}</div></div>` : ''}</details>
  </div>`;
}

/** How much of the test the camera could read, and why not. */
export function coverageNote(B) {
  const reasonLabel = { washed: 'too much light', dark: 'too dark', backlit: 'light behind you', flat: 'flat light', uneven: 'one-sided light', blur: 'blurry picture', far: 'too far away', near: 'too close', multi: 'another face', noface: 'face out of view' };
  const sh = B.shares;
  const why = B.qualityReasons?.length ? ` Unreadable stretches were mostly ${B.qualityReasons.slice(0, 2).map(([k]) => reasonLabel[k] || k).join(' and ')}.` : '';
  return `<div class="coverage">
    <div class="cov-bar"><i class="cov-r" style="flex:${sh.reading}" data-tip="Reading or thinking: ${pct(sh.reading)}"></i><i class="cov-w" style="flex:${sh.writing}" data-tip="Writing: ${pct(sh.writing)}"></i><i class="cov-a" style="flex:${sh.away}" data-tip="Looking away: ${pct(sh.away)}"></i><i class="cov-g" style="flex:${sh.absent + sh.poor + sh.none}" data-tip="Not readable: ${pct(sh.absent + sh.poor + sh.none)}"></i></div>
    <p class="small muted mb0">Your face was readable for <b>${pct(B.coverage)}</b> of the test: reading ${pct(sh.reading)}, writing ${pct(sh.writing)}, looking away ${pct(sh.away)}.${why} ${B.calib?.settled ? 'Measured against today’s calm baseline from the camera room.' : 'Measured against your calibrated calm face.'}</p>
  </div>`;
}
