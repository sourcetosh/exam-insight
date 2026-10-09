// Mentor workspace. Laptop-first, for a counsellor with a few hundred students in batches.
//   Re-teach (home): the questions and topics to take back to class after the latest mock,
//     with the trap answer and how many faces strained.
//   Teach: one question, ready for class, with who missed it and who strained.
//   Students: the roster with each student against their own past (never ranked).
//   Student: one student's mocks, behaviour map, flags with snapshots, notes, practice.
//   Assignments: what was sent, to whom, and what's done.
import { store } from '../store.js';
import * as M from '../engine/mentor.js';
import { QUADRANTS, QUADRANT_ORDER } from '../engine/behaviour.js';
import { PROCTOR } from '../config.js';
import { esc, plain, pct, fmtDate, fmtDur, relDay, plural, modal, toast, OPTION_KEYS, clamp } from '../ui.js';
import { questionStrip, stripLegend, quadrantBoard, topicStruggle, insightCards, strainChart, questionDetail, coverageNote } from './bxui.js';
import { icon } from '../icons.js';

export const MENTOR_NAME = 'Ms. Kavita Rao';
const q = (sel, root) => root.querySelector(sel);
const params = (query) => new URLSearchParams(query || '');
const optLabel = (b, i) => (b.exam === 'NEET' ? `(${i + 1})` : OPTION_KEYS[i]);

export function avatar(st, size = 34) {
  const ini = (st.first?.[0] || st.name?.[0] || '?') + (st.last?.[0] || '');
  return `<span class="av ${st.isYou ? 'you' : ''}" style="--h:${st.hue ?? 210};--s:${size}px" aria-hidden="true">${esc(ini.toUpperCase())}</span>`;
}

function batchPicker(batchId, idx, base) {
  const B = M.BATCHES.find((b) => b.id === batchId) || M.BATCHES[0];
  return `<div class="m-pickers">
    <label class="m-select"><span class="eyebrow">Batch</span><select id="bpick">${M.BATCHES.map((b) => `<option value="${b.id}" ${b.id === B.id ? 'selected' : ''}>${esc(b.name)} · ${b.size}</option>`).join('')}</select></label>
    ${idx != null ? `<div class="m-mock"><span class="eyebrow">Mock</span><div class="seg">${B.mocks.map((m) => `<button class="${m.idx === idx ? 'on' : ''}" data-mock="${m.idx}" data-tip="${esc(`${m.name} · ${fmtDate(m.at)}`)}">${m.idx + 1}</button>`).join('')}</div></div>` : ''}
  </div>`;
}

function pickState(query) {
  const P = params(query);
  const batch = M.BATCHES.find((b) => b.id === P.get('b')) || M.BATCHES.find((b) => b.exam === store.profile?.exam) || M.BATCHES[0];
  const idx = P.get('m') != null ? clamp(Number(P.get('m')), 0, batch.mocks.length - 1) : batch.mocks.length - 1;
  return { batch, idx };
}

// ---------- assign / note dialogs ----------
export async function assignDialog({ studentIds, batch, topic = null, title = null }) {
  const topics = [...new Set(M.reteach(batch.id, batch.mocks.length - 1).topics.map((t) => t.topic))];
  const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const names = studentIds.slice(0, 4).map((id) => M.studentById(id)?.first || id).join(', ') + (studentIds.length > 4 ? ` and ${studentIds.length - 4} more` : '');
  assignDialog.last = { kind: 'drill', topic: topic || topics[0], mode: 'normal', due, note: '' };
  const ok = await modal({
    title: title || 'Assign practice',
    body: `<p class="muted small">To ${plural(studentIds.length, 'student')}: ${esc(names)}</p>
      <div class="stack" style="gap:12px">
        <label class="field"><span class="label">What</span><select id="as-kind"><option value="drill">Topic drill (8 questions)</option><option value="mistakes">Re-attempt their mistakes</option></select></label>
        <label class="field" id="as-topic-f"><span class="label">Topic</span><select id="as-topic">${topics.map((t) => `<option ${t === topic ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Mode</span><select id="as-mode"><option value="normal">Normal timing</option><option value="slow">Slow read (blind spots: read twice)</option><option value="speed">Speed (fragile: make it automatic)</option></select></label>
        <label class="field"><span class="label">Due</span><input type="date" id="as-due" value="${due}"></label>
        <label class="field"><span class="label">Note to the student (optional)</span><input type="text" id="as-note" maxlength="120" placeholder="e.g. Read each question twice before choosing"></label>
      </div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Assign', value: true, cls: 'primary' }],
    dismissValue: false,
  });
  if (!ok) return null;
  // modal() resolves after removing the dialog, so read the values it leaves in a stash
  const v = assignDialog.last || {};
  const kind = v.kind || 'drill';
  const rec = store.addAssignment({
    by: MENTOR_NAME, studentIds, batchId: batch.id, kind,
    topic: kind === 'drill' ? v.topic || topic || topics[0] : null, mode: v.mode || 'normal',
    title: kind === 'drill' ? `Drill · ${v.topic || topic || topics[0]}` : 'Re-attempt your mistakes',
    due: v.due ? new Date(v.due).getTime() : null, note: v.note || '',
  });
  toast(`Assigned to ${plural(studentIds.length, 'student')}`);
  return rec;
}
// Keep the dialog's field values as the student types (the modal removes its DOM on close).
document.addEventListener('input', (e) => { if (e.target.id?.startsWith('as-')) stash(); });
document.addEventListener('change', (e) => { if (e.target.id?.startsWith('as-')) stash(); });
function stash() {
  const g = (id) => document.getElementById(id)?.value;
  assignDialog.last = { kind: g('as-kind'), topic: g('as-topic'), mode: g('as-mode'), due: g('as-due'), note: g('as-note') };
  const tf = document.getElementById('as-topic-f');
  if (tf) tf.hidden = g('as-kind') === 'mistakes';
}

async function noteDialog(student, sessionId = null) {
  noteDialog.text = '';
  const ok = await modal({
    title: `Note for ${esc(student.first || student.name)}`,
    body: `<p class="muted small">They see this on their home page${sessionId ? ' and on that test’s result' : ''}.</p><textarea id="mnote-t" maxlength="240" placeholder="e.g. Great recovery on Genetics. Next: read the question twice before you commit."></textarea>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save note', value: true, cls: 'primary' }],
    dismissValue: false,
  });
  if (!ok || !noteDialog.text.trim()) return false;
  store.addNote({ studentId: student.id, sessionId, text: noteDialog.text.trim(), by: MENTOR_NAME });
  toast('Note saved');
  return true;
}
document.addEventListener('input', (e) => { if (e.target.id === 'mnote-t') noteDialog.text = e.target.value; });

/** Numerical-value questions have no options: show the most-entered values, the key marked. */
function valueBars(x, total = x.sat || 1, max = 4) {
  const vals = [...(x.valueCounts || [])].sort((a, b) => b.n - a.n);
  const top = vals.slice(0, max);
  const rest = vals.slice(max).reduce((a, v) => a + v.n, 0);
  const isTrap = (v) => !v.correct && x.modalWrong && String(x.modalWrong.value) === String(v.value) && x.modalWrong.share >= 0.2;
  return `<div class="dist">${top.map((v) => `<div class="dist-row ${v.correct ? 'key' : ''} ${isTrap(v) ? 'trap' : ''}"><span class="dist-l mono">${esc(String(v.value))}</span><span class="dist-b"><i style="width:${(v.n / total) * 100}%"></i></span><span class="dist-v num">${Math.round((v.n / total) * 100)}%</span><span class="dist-tag">${v.correct ? '✓ key' : isTrap(v) ? 'trap' : ''}</span></div>`).join('')}
    ${rest ? `<div class="dist-row"><span class="dist-l small faint">other</span><span class="dist-b"><i style="width:${(rest / total) * 100}%"></i></span><span class="dist-v num">${Math.round((rest / total) * 100)}%</span><span class="dist-tag"></span></div>` : ''}
    ${x.blank ? `<div class="dist-row blank"><span class="dist-l">–</span><span class="dist-b"><i style="width:${(x.blank / total) * 100}%"></i></span><span class="dist-v num">${Math.round((x.blank / total) * 100)}%</span><span class="dist-tag">blank</span></div>` : ''}
    ${top.some((v) => v.correct) ? '' : `<p class="small faint mb0">Key: <b class="mono">${esc(String(x.q.answer))}</b></p>`}</div>`;
}

// ---------- re-teach ----------
export function renderReteach(root, _p, query) {
  const { batch, idx } = pickState(query);
  const t0 = performance.now();
  const RT = M.reteach(batch.id, idx);
  const K = M.batchKpis(batch.id, idx);
  const mock = batch.mocks[idx];
  const top = RT.questions.slice(0, 6);

  const distBars = (x) => {
    const total = x.sat || 1;
    if (!x.optCounts?.length) return valueBars(x, total);
    return `<div class="dist">${x.optCounts.map((c, i) => {
      const isKey = i === x.answer, isTrap = x.modalWrong && i === x.modalWrong.opt && x.modalWrong.share >= 0.25;
      return `<div class="dist-row ${isKey ? 'key' : ''} ${isTrap ? 'trap' : ''}"><span class="dist-l">${optLabel(batch, i)}</span><span class="dist-b"><i style="width:${(c / total) * 100}%"></i></span><span class="dist-v num">${Math.round((c / total) * 100)}%</span><span class="dist-tag">${isKey ? '✓ key' : isTrap ? 'trap' : ''}</span></div>`;
    }).join('')}${x.blank ? `<div class="dist-row blank"><span class="dist-l">–</span><span class="dist-b"><i style="width:${(x.blank / total) * 100}%"></i></span><span class="dist-v num">${Math.round((x.blank / total) * 100)}%</span><span class="dist-tag">blank</span></div>` : ''}</div>`;
  };
  const levels = (x) => {
    const L = x.levels, tot = (L.calm + L.mild + L.strained + L.high) || 1;
    return `<div class="lvl" data-tip="${esc(`Faces on this question: ${L.calm} calm · ${L.mild} mild · ${L.strained} strained · ${L.high} high strain${L.none ? ` · ${L.none} not readable` : ''}`)}">${['calm', 'mild', 'strained', 'high'].map((k) => (L[k] ? `<i class="lv-${k}" style="flex:${L[k] / tot}"></i>` : '')).join('')}</div>
      <div class="lvl-k small"><span>${Math.round(x.strainedPct * 100)}% strained</span><span class="faint">calm → high</span></div>`;
  };
  const card = (x, i) => `<article class="rt-card">
      <div class="rt-rank display">${i + 1}</div>
      <div class="rt-body">
        <div class="rt-top"><span class="rt-q">Q${x.n}</span><span class="chip">${esc(x.topic)}</span><span class="small faint">${esc(x.subject)}</span>
          <span class="rt-score" data-tip="Re-teach score: wrong answers, strain, calm-but-wrong and blanks across the batch">${x.reteach}</span></div>
        <p class="rt-text">${esc(plain(x.q.text).slice(0, 180))}${plain(x.q.text).length > 180 ? '…' : ''}</p>
        <div class="rt-cols"><div>${distBars(x)}</div><div>${levels(x)}
          <ul class="rt-why">${x.why.slice(0, 3).map((w) => `<li class="hand">${esc(w)}</li>`).join('')}</ul></div></div>
        <div class="rt-actions"><a class="btn sm primary" href="#/mentor/q/${batch.id}/${idx}/${encodeURIComponent(x.qid)}">${icon('monitor', { size: 14 })} Teach this</a>
          ${x.wrongIds.length ? `<button class="btn sm" data-assign-q="${esc(x.qid)}">${icon('zap', { size: 14 })} Drill for the ${x.wrongIds.length} who missed it</button>` : ''}</div>
      </div>
    </article>`;
  const topicRow = (t) => `<div class="rtt-row">
      <div class="rtt-name"><b>${esc(t.topic)}</b><span class="small faint">${esc(t.subject)} · ${t.qs.map((n) => `Q${n}`).join(' ')}</span></div>
      <div class="rtt-bar"><i style="width:${t.score}%"></i><span class="num">${t.score}</span></div>
      <div class="rtt-stats small"><span data-tip="Wrong answers">${pct(t.wrongPct)} wrong</span><span data-tip="Readable faces that strained">${pct(t.strainedPct)} strained</span>${t.blindPct >= 0.08 ? `<span class="q-blind-t" data-tip="Calm but wrong">${pct(t.blindPct)} blind</span>` : ''}</div>
      <button class="btn sm ghost" data-assign-topic="${esc(t.topic)}" data-tip="Assign a drill to everyone who missed a question on this topic">${icon('zap', { size: 13 })}</button>
    </div>`;
  const heat = RT.all || [...RT.questions].sort((a, b) => a.n - b.n);
  root.innerHTML = `<div class="container mentor">
    <div class="m-head">
      <div><div class="eyebrow">Mentor · ${esc(MENTOR_NAME)}</div><h1>Re-teach before the next mock</h1>
        <p class="muted mb0">${esc(batch.name)} · ${esc(mock.name)} · ${fmtDate(mock.at)} · ${K.sat} of ${batch.size} sat</p></div>
      ${batchPicker(batch.id, idx)}
    </div>
    <div class="kpis">
      <div><span class="k">Average score</span><b class="display">${pct(K.avgScorePct)}</b></div>
      <div><span class="k">Average struggle</span><b class="display">${K.avgStruggle ?? '—'}</b></div>
      <div><span class="k">Fragile answers</span><b class="display q-fragile-t">${pct(K.fragileShare)}</b><span class="small faint">right, but strained</span></div>
      <div><span class="k">Blind spots</span><b class="display q-blind-t">${pct(K.blindShare)}</b><span class="small faint">calm, but wrong</span></div>
      <a class="kpi-link" href="#/mentor/students?b=${batch.id}&f=needs"><span class="k">Needs you</span><b class="display">${K.needsYou}</b><span class="small">see who ${icon('arrow', { size: 12 })}</span></a>
    </div>
    <div class="rt-grid">
      <section class="rt-list"><div class="eyebrow">Take these back to class, in this order</div>${top.map(card).join('')}</section>
      <aside class="rt-side">
        <section class="card"><div class="eyebrow">Topics, re-teach first</div>${RT.topics.slice(0, 8).map(topicRow).join('')}</section>
        <section class="card"><div class="eyebrow">Every question in ${esc(mock.name)}</div>
          <div class="qheat">${heat.map((x) => `<a class="qh" href="#/mentor/q/${batch.id}/${idx}/${encodeURIComponent(x.qid)}" style="--r:${x.reteach}" data-tip="${esc(`<b>Q${x.n}</b> · ${esc(x.topic)}<div class="tip-grid"><span>Wrong</span><b>${pct(x.wrong / Math.max(1, x.sat))}</b><span>Strained</span><b>${pct(x.strainedPct)}</b><span>Re-teach</span><b>${x.reteach}</b></div>`)}"><span>${x.n}</span></a>`).join('')}</div>
          <p class="small faint mb0" style="margin-top:8px">Darker = more to re-teach.</p></section>
      </aside>
    </div>
    <p class="small faint mt">Sample batches for the prototype: names and results are simulated through the same engine as real tests. Built in ${Math.round(performance.now() - t0)} ms.</p>
  </div>`;

  root.onchange = (e) => { if (e.target.id === 'bpick') location.hash = `#/mentor?b=${e.target.value}`; };
  root.onclick = async (e) => {
    const mb = e.target.closest('[data-mock]');
    if (mb) { location.hash = `#/mentor?b=${batch.id}&m=${mb.dataset.mock}`; return; }
    const aq = e.target.closest('[data-assign-q]');
    if (aq) { const x = RT.questions.find((z) => z.qid === aq.dataset.assignQ); await assignDialog({ studentIds: x.wrongIds, batch, topic: x.topic, title: `Drill for the ${x.wrongIds.length} who missed Q${x.n}` }); return; }
    const at = e.target.closest('[data-assign-topic]');
    if (at) {
      const ids = [...new Set(RT.questions.filter((x) => x.topic === at.dataset.assignTopic).flatMap((x) => x.wrongIds))];
      if (!ids.length) { toast('Nobody missed a question on this topic'); return; }
      await assignDialog({ studentIds: ids, batch, topic: at.dataset.assignTopic, title: `${at.dataset.assignTopic}: drill for ${plural(ids.length, 'student')}` });
    }
  };
}

// ---------- teach one question ----------
export function renderTeach(root, [batchId, idxS, qid]) {
  const batch = M.BATCHES.find((b) => b.id === batchId) || M.BATCHES[0];
  const idx = Number(idxS);
  const x = M.batchQuestionStats(batch.id, idx).find((z) => z.qid === decodeURIComponent(qid));
  if (!x) { location.replace('#/mentor'); return; }
  const total = x.sat || 1;
  const names = (ids, max = 14) => ids.slice(0, max).map((id) => { const s = M.studentById(id); return s ? `<a class="name-chip" href="#/mentor/student/${s.id}?m=${idx}">${avatar(s, 22)}${esc(s.first)} ${esc(s.last?.[0] || '')}.</a>` : ''; }).join('') + (ids.length > max ? `<span class="small faint">+${ids.length - max}</span>` : '');
  const L = x.levels;
  root.innerHTML = `<div class="container mentor teach">
    <a class="back-link" href="#/mentor?b=${batch.id}&m=${idx}">${icon('back', { size: 14 })} Re-teach · ${esc(batch.name)} · ${esc(batch.mocks[idx].name)}</a>
    <div class="teach-grid">
      <section class="card teach-q margin">
        <div class="row between"><div class="row" style="gap:10px"><span class="display teach-n">Q${x.n}</span><span class="chip">${esc(x.topic)}</span><span class="small faint">${esc(x.subject)}</span></div>
          <button class="btn sm ghost" id="present">${icon('monitor', { size: 14 })} Present</button></div>
        <div class="q-text teach-text">${x.q.text}</div>
        ${x.q.options?.length ? `<ol class="teach-opts">${x.q.options.map((o, i) => {
          const c = x.optCounts[i] || 0; const isKey = i === x.answer; const isTrap = x.modalWrong && i === x.modalWrong.opt;
          return `<li class="${isKey ? 'key' : ''} ${isTrap ? 'trap' : ''}"><b>${optLabel(batch, i)}</b><span class="to-txt">${o}</span><span class="to-bar"><i style="width:${(c / total) * 100}%"></i></span><span class="to-v num">${Math.round((c / total) * 100)}%</span>${isKey ? '<em>key</em>' : isTrap ? '<em class="hand">trap</em>' : ''}</li>`;
        }).join('')}</ol>` : `<div class="teach-num"><p class="muted">Numerical answer. Key: <b class="mono">${esc(String(x.q.answer))}</b>. What the class entered:</p>${valueBars(x, total, 6)}</div>`}
        ${x.q.solution ? `<details class="qd-text" open><summary>Solution</summary><div class="solution"><div>${x.q.solution}</div></div></details>` : ''}
      </section>
      <aside class="teach-side">
        <section class="card"><div class="eyebrow">Faces on this question</div>
          <div class="lvl big">${['calm', 'mild', 'strained', 'high'].map((k) => (L[k] ? `<i class="lv-${k}" style="flex:${L[k]}"></i>` : '')).join('')}</div>
          <div class="lvl-legend small"><span><i class="lv-calm"></i>${L.calm} calm</span><span><i class="lv-mild"></i>${L.mild} mild</span><span><i class="lv-strained"></i>${L.strained} strained</span><span><i class="lv-high"></i>${L.high} high</span></div>
          <p class="small muted">Average time ${fmtDur(x.meanTimeSec)} against ${fmtDur(x.expectedSec)} expected. ${x.why.map(esc).join(' ')}</p></section>
        <section class="card"><div class="eyebrow">Who to follow up with</div>
          ${['gap', 'blind', 'fragile', 'avoided'].filter((k) => x.byQuad[k]?.length).map((k) => `<div class="who"><div class="who-h"><span class="qchip qc-${k}">${QUADRANTS[k].short}</span><span class="small muted">${QUADRANTS[k].label} · ${x.byQuad[k].length}</span></div><div class="names">${names(x.byQuad[k])}</div></div>`).join('') || '<p class="small muted mb0">Everyone was calm and correct.</p>'}
          ${x.wrongIds.length ? `<button class="btn primary block mt" data-assign>${icon('zap', { size: 14 })} Drill for the ${x.wrongIds.length} who missed it</button>` : ''}
        </section>
      </aside>
    </div>
  </div>`;
  root.onclick = async (e) => {
    if (e.target.closest('[data-assign]')) { await assignDialog({ studentIds: x.wrongIds, batch, topic: x.topic, title: `Drill for the ${x.wrongIds.length} who missed Q${x.n}` }); return; }
    if (e.target.closest('#present')) { document.body.classList.toggle('present'); root.querySelector('#present').classList.toggle('on'); }
  };
  return () => document.body.classList.remove('present');
}

// ---------- students ----------
const ATTN_ICON = { drop: 'trend', struggle: 'pulse', blind: 'eye', flags: 'flag', absent: 'clock' };
/** A short chip label (and icon) for a plain-English attention reason; the full sentence becomes the tooltip. */
function attn(a) {
  const text = typeof a === 'string' ? a : a.text || '';
  const m = (re) => text.match(re);
  let kind = a.kind, short = a.short;
  if (!short) {
    let x;
    if ((x = m(/(\d+) points? below/i))) { kind = 'drop'; short = `Score −${x[1]} pts`; }
    else if ((x = m(/(\d+) above their usual/i))) { kind = 'struggle'; short = `Struggle +${x[1]}`; }
    else if ((x = m(/(\d+) blind/i))) { kind = 'blind'; short = `${x[1]} blind spots`; }
    else if (/proctoring|phone|another person|face not/i.test(text)) { kind = 'flags'; short = /phone/i.test(text) ? 'Phone seen' : /another person/i.test(text) ? 'Someone else' : 'Flagged'; }
    else if (/absent|did not sit|missed/i.test(text)) { kind = 'absent'; short = 'Absent'; }
    else short = text.length > 22 ? `${text.slice(0, 20)}…` : text;
  }
  return `<span class="attn-chip" data-tip="${esc(text)}">${icon(ATTN_ICON[kind] || 'alert', { size: 12 })}${esc(short)}</span>`;
}
export function renderStudents(root, _p, query) {
  const { batch } = pickState(query);
  const P = params(query);
  const st = { q: P.get('q') || '', sort: P.get('s') || 'needs', needs: P.get('f') === 'needs' };
  const all = M.batchSummaries(batch.id);
  const spark = (vals, w = 86, h = 24) => {
    const v = vals.filter((x) => x != null);
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), rng = hi - lo || 1;
    const pts = vals.map((x, i) => (x == null ? null : `${((i / (vals.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((x - lo) / rng) * (h - 6)).toFixed(1)}`)).filter(Boolean);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts.join(' ')}"/></svg>`;
  };
  const delta = (d, unit = '', inverse = false) => (d == null ? '<span class="faint">—</span>' : `<span class="${(inverse ? -d : d) >= 0 ? 'delta-up' : 'delta-down'}">${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(Math.round(d))}${unit}</span>`);
  const draw = () => {
    let rows = all.filter((r) => !st.q || r.student.name.toLowerCase().includes(st.q.toLowerCase()) || r.student.roll?.toLowerCase().includes(st.q.toLowerCase()));
    if (st.needs) rows = rows.filter((r) => r.attention.length);
    rows = [...rows].sort((a, b) => (st.sort === 'name' ? a.student.name.localeCompare(b.student.name)
      : st.sort === 'drop' ? (a.delta.scorePct ?? 0) - (b.delta.scorePct ?? 0)
      : st.sort === 'struggle' ? (b.delta.struggle ?? -99) - (a.delta.struggle ?? -99)
      : (b.attention.length - a.attention.length) || a.student.name.localeCompare(b.student.name)));
    const spokenAt = (id) => store.spokenTo(id)[0]?.at;
    q('#roster', root).innerHTML = rows.map((r) => {
      const s = r.student, last = r.last;
      const shared = s.consent?.behaviour !== false;
      return `<a class="ro-row ${r.attention.length ? 'attn' : ''}" href="#/mentor/student/${s.id}">
        <span class="ro-who">${avatar(s)}<span><b>${esc(s.name)}</b>${s.isYou ? ' <span class="chip accent">this device</span>' : ''}<span class="small faint">${esc(s.roll || '')}</span></span></span>
        <span class="ro-score">${last?.sat ? `<b class="num">${pct(last.scorePct)}</b> ${delta(r.delta.scorePct != null ? r.delta.scorePct * 100 : null, ' pts')}` : '<span class="faint">absent</span>'}</span>
        <span class="ro-str">${shared && last?.meanStruggle != null ? `<b class="num">${last.meanStruggle}</b> ${delta(r.delta.struggle, '', true)}` : `<span class="faint small">${shared ? '—' : 'scores only'}</span>`}</span>
        <span class="ro-spark">${spark(r.mocks.map((m) => (m.sat ? m.scorePct : null)))}</span>
        <span class="ro-attn">${r.attention.slice(0, 2).map(attn).join('')}</span>
        <span class="ro-spoke small faint">${spokenAt(s.id) ? `spoke ${relDay(spokenAt(s.id)).toLowerCase()}` : ''}</span>
      </a>`;
    }).join('') || '<p class="muted">Nobody matches.</p>';
    q('#count', root).textContent = `${rows.length} of ${all.length}`;
  };
  root.innerHTML = `<div class="container mentor">
    <div class="m-head">
      <div><div class="eyebrow">Mentor · ${esc(MENTOR_NAME)}</div><h1>Students</h1>
        <p class="muted mb0">Each student against their own past mocks. No ranks, no leaderboard.</p></div>
      ${batchPicker(batch.id, null)}
    </div>
    <div class="ro-tools">
      <input type="search" id="rq" placeholder="Search by name or roll number" value="${esc(st.q)}">
      <div class="seg" role="group" aria-label="Sort">${[['needs', 'Needs you first'], ['drop', 'Biggest drop'], ['struggle', 'Struggle rising'], ['name', 'Name']].map(([k, l]) => `<button class="${st.sort === k ? 'on' : ''}" data-sort="${k}">${l}</button>`).join('')}</div>
      <label class="check-inline"><input type="checkbox" id="needs" ${st.needs ? 'checked' : ''}> Only who needs you</label>
      <span class="small muted" id="count"></span>
    </div>
    <div class="ro-head small"><span>Student</span><span>Last mock vs own average</span><span>Struggle vs own</span><span>Score trend</span><span>Why look</span><span></span></div>
    <div class="roster card" id="roster"></div>
  </div>`;
  draw();
  root.onchange = (e) => {
    if (e.target.id === 'bpick') location.hash = `#/mentor/students?b=${e.target.value}`;
    if (e.target.id === 'needs') { st.needs = e.target.checked; draw(); }
  };
  root.oninput = (e) => { if (e.target.id === 'rq') { st.q = e.target.value; draw(); } };
  root.onclick = (e) => { const b = e.target.closest('[data-sort]'); if (b) { st.sort = b.dataset.sort; root.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b)); draw(); } };
}

// ---------- one student ----------
const SNAP_ART = {
  phone: '<rect x="96" y="54" width="18" height="30" rx="3" fill="#e9a23b"/><rect x="99" y="58" width="12" height="20" rx="1" fill="#14213d"/>',
  multi_face: '<circle cx="104" cy="42" r="11" fill="#8a93ab"/><path d="M86 86c2-14 10-22 18-22s16 8 18 22z" fill="#8a93ab"/>',
  no_face: '',
  look_away: '',
};
function snapArt(code) {
  const body = code === 'no_face' ? '' : '<circle cx="64" cy="44" r="15" fill="#c9cfdd"/><path d="M38 96c3-20 14-30 26-30s23 10 26 30z" fill="#c9cfdd"/>';
  return `<svg viewBox="0 0 128 96" class="snap-art" aria-hidden="true"><rect width="128" height="96" fill="#1c2438"/>${body}${SNAP_ART[code] || ''}<text x="6" y="90" fill="#8a93ab" font-size="8" font-family="monospace">SAMPLE</text></svg>`;
}

export function renderStudent(root, [id], query) {
  const s = M.studentById(id);
  if (!s) { location.replace('#/mentor/students'); return; }
  const batch = M.BATCHES.find((b) => b.id === s.batchId) || M.BATCHES[0];
  const sum = M.studentSummary(s.id);
  const sat = sum.mocks.filter((m) => m.sat);
  const P = params(query);
  let idx = P.get('m') != null ? Number(P.get('m')) : (sat[sat.length - 1]?.idx ?? batch.mocks.length - 1);
  const shared = s.consent?.behaviour !== false;
  const st = { sel: null };

  const trendChart = () => {
    const W = 520, H = 130, pad = 24;
    const n = sum.mocks.length;
    const x = (i) => pad + (i + 0.5) * ((W - pad * 2) / n);
    const pts = sum.mocks.map((m, i) => (m.sat ? `${x(i).toFixed(1)},${(H - 20 - m.scorePct * (H - 40)).toFixed(1)}` : null)).filter(Boolean);
    return `<svg class="dt-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score and struggle across this student's mocks">
      ${sum.mocks.map((m, i) => { const v = shared && m.sat ? m.meanStruggle ?? 0 : 0; const h = (v / 100) * (H - 40); return `${m.sat ? `<rect class="dt-bar ${i === idx ? 'on' : ''}" x="${(x(i) - 16).toFixed(1)}" y="${(H - 20 - h).toFixed(1)}" width="32" height="${h.toFixed(1)}" rx="4"/>` : `<text x="${x(i).toFixed(1)}" y="${H - 30}" text-anchor="middle" class="faint-t">absent</text>`}<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="middle">Mock ${i + 1}</text>${m.sat && shared ? `<text class="dt-v" x="${x(i).toFixed(1)}" y="${(H - 24 - h).toFixed(1)}" text-anchor="middle">${m.meanStruggle ?? ''}</text>` : ''}`; }).join('')}
      <polyline class="dt-line" points="${pts.join(' ')}"/>${sum.mocks.map((m, i) => (m.sat ? `<circle class="dt-dot" cx="${x(i).toFixed(1)}" cy="${(H - 20 - m.scorePct * (H - 40)).toFixed(1)}" r="4"><title>${pct(m.scorePct)}</title></circle>` : '')).join('')}
    </svg>`;
  };

  const draw = () => {
    const SM = M.studentMock(s.id, idx);
    const R = SM ? { ...SM, visits: SM.visits, rows: SM.rows, bx: SM.bx } : null;
    const flags = SM ? SM.s.events.filter((e) => e.type === 'proctor') : [];
    const snaps = SM?.s.proctor?.snaps || [];
    const notes = store.notesFor(s.id);
    const spoken = store.spokenTo(s.id);
    const assigns = store.assignmentsFor(s.id);
    root.innerHTML = `<div class="container mentor student">
      <a class="back-link" href="#/mentor/students?b=${batch.id}">${icon('back', { size: 14 })} Students · ${esc(batch.name)}</a>
      <div class="st-head card">
        <div class="st-id">${avatar(s, 64)}<div><h1>${esc(s.name)}</h1><p class="muted mb0">${esc(s.roll || '')} · ${esc(batch.name)}${s.isYou ? ' · the student on this device' : ''}</p>
          <div class="row" style="gap:6px;margin-top:8px">${shared ? '<span class="chip good">Shares behaviour maps</span>' : '<span class="chip">Shares scores only</span>'}${s.consent?.snapshots ? '<span class="chip">Snapshots on</span>' : ''}${sum.attention.map(attn).join('')}</div></div></div>
        <div class="st-actions">
          <button class="btn primary" data-act="assign">${icon('zap', { size: 14 })} Assign practice</button>
          <button class="btn" data-act="note">${icon('edit', { size: 14 })} Leave a note</button>
          <button class="btn" data-act="spoke">${icon('check', { size: 14 })} Mark spoken to</button>
        </div>
      </div>
      <div class="st-grid">
        <section class="card"><div class="dm-head"><div><div class="eyebrow">Against their own past</div><h2>${sum.delta.scorePct == null ? 'Not enough mocks yet' : sum.delta.scorePct * 100 <= -10 ? 'Below their usual' : sum.delta.scorePct * 100 >= 10 ? 'Above their usual' : 'Around their usual'}</h2>
          <p class="small muted mb0">Score (line) and average struggle (bars) per mock.</p></div>
          <div class="dt-delta"><b class="display ${(sum.delta.scorePct ?? 0) >= 0 ? 'good-t' : 'bad-t'}">${sum.delta.scorePct == null ? '—' : `${sum.delta.scorePct > 0 ? '+' : sum.delta.scorePct < 0 ? '−' : ''}${Math.abs(Math.round(sum.delta.scorePct * 100))}`}</b><span class="small muted">points vs own average</span></div></div>
          ${trendChart()}</section>
        <section class="card st-log"><div class="eyebrow">Notes and calls</div>
          ${[...notes.map((n) => ({ at: n.at, html: `<span class="hand">“${esc(n.text)}”</span>` })), ...spoken.map((x) => ({ at: x.at, html: '<span>Spoke to them</span>' })), ...assigns.map((a) => ({ at: a.createdAt, html: `<span>Assigned: ${esc(a.title)}${a.due ? ` · due ${fmtDate(a.due)}` : ''}</span>` }))].sort((a, b) => b.at - a.at).slice(0, 8).map((x) => `<div class="log-row">${x.html}<span class="small faint">${relDay(x.at)}</span></div>`).join('') || '<p class="small muted mb0">Nothing yet.</p>'}
        </section>
      </div>
      <div class="st-mockbar"><span class="eyebrow">Mock</span><div class="seg">${batch.mocks.map((m) => `<button class="${m.idx === idx ? 'on' : ''}" data-mock="${m.idx}" ${sum.mocks[m.idx]?.sat ? '' : 'disabled'}>${m.idx + 1}</button>`).join('')}</div>
        ${SM ? `<span class="small muted">${esc(batch.mocks[idx].name)} · ${fmtDate(batch.mocks[idx].at)} · ${SM.score.correct} right, ${SM.score.wrong} wrong, ${SM.score.unattempted} blank · ${pct(SM.score.max ? Math.max(0, SM.score.score) / SM.score.max : 0)}</span>` : '<span class="small muted">Absent</span>'}</div>
      ${!SM ? '<div class="notice calm">This student did not sit this mock.</div>' : !shared ? '<div class="notice calm">This student shares scores only, so their behaviour map is private.</div>' : `
      <section class="bxsheet card">
        <div class="bx-part"><div class="part-head"><span class="part-n display">§1</span><div><h2>Where they struggled</h2><p class="small muted mb0">Each square a question, shaded by how strained their face was against their own calm face.</p></div></div>
          ${stripLegend()}${questionStrip(SM.s, SM.rows, { sel: st.sel })}<div id="bxdetail">${st.sel ? questionDetail(SM.s, SM.rows[st.sel - 1], { mistakesLink: false, who: 'they' }) : ''}</div></div>
        <div class="bx-part"><div class="part-head"><span class="part-n display">§2</span><div><h2>Four kinds of question</h2></div></div>${quadrantBoard(SM.bx)}</div>
        <div class="bx-part"><div class="part-head"><span class="part-n display">§3</span><div><h2>Topics that strained them</h2></div></div>${topicStruggle(SM.bx, { drill: false })}</div>
        <div class="bx-part"><div class="part-head"><span class="part-n display">§4</span><div><h2>What their face showed</h2></div></div>${insightCards(SM.bx, { who: 'they' })}</div>
        <div class="bx-part"><div class="part-head"><span class="part-n display">§5</span><div><h2>Minute by minute</h2></div></div>${strainChart({ ...SM, bx: SM.bx }, { sel: st.sel })}${coverageNote(SM.bx).replace(/Your face/, 'Their face').replace(/today’s/, 'that day’s')}</div>
      </section>`}
      ${SM ? `<section class="card mt"><div class="card-head"><h2>Proctoring</h2><span class="small muted">${flags.length ? plural(flags.length, 'flag') : 'clean'}</span></div>
        ${flags.length ? `<div class="snaps">${flags.map((f) => { const sn = f.snap != null ? snaps[f.snap] : null; return `<figure class="snap">${sn?.img ? `<img src="${sn.img}" alt="Snapshot: ${esc(PROCTOR.flags[f.code]?.label || f.code)}">` : snapArt(f.code)}<figcaption><b>${esc(PROCTOR.flags[f.code]?.label || f.code)}</b><span class="faint">${f.dur ? fmtDur(f.dur / 1000) : ''} · Q${SM.rows.find((r) => r.qid === f.q)?.n ?? '–'}</span></figcaption></figure>`; }).join('')}</div>
          ${s.consent?.snapshots ? '' : '<p class="small faint mb0" style="margin-top:8px">No photos: this student hasn’t agreed to snapshots.</p>'}` : '<p class="small good-t mb0">Nothing was flagged in this mock.</p>'}</section>` : ''}
    </div>`;
  };
  draw();
  root.onclick = async (e) => {
    const mb = e.target.closest('[data-mock]');
    if (mb && !mb.disabled) { idx = Number(mb.dataset.mock); st.sel = null; draw(); return; }
    const bq = e.target.closest('.bxq, .sc-seg, .qlink');
    if (bq && bq.dataset.q) {
      const n = Number(bq.dataset.q);
      st.sel = st.sel === n && bq.classList.contains('bxq') ? null : n;
      draw();
      root.querySelector('#bxdetail')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (e.target.closest('[data-close]')) { st.sel = null; draw(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'assign') { await assignDialog({ studentIds: [s.id], batch, title: `Assign practice to ${s.first}` }); draw(); }
    if (act === 'note') { if (await noteDialog(s, s.isYou ? M.studentMock(s.id, idx)?.s.id : null)) draw(); }
    if (act === 'spoke') { store.markSpoken(s.id); toast(`Marked: spoke to ${s.first}`); draw(); }
  };
}

// ---------- assignments ----------
export function renderAssignments(root) {
  const list = store.mentor.assignments;
  const progress = (a) => {
    const n = a.studentIds.length;
    // Sample students finish over a few days; the student on this device has a real status.
    const days = (Date.now() - a.createdAt) / 86400000;
    let done = 0;
    for (const id of a.studentIds) {
      if (id === 'you') done += a.done?.you ? 1 : 0;
      else { const h = [...`${a.id}${id}`].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 7) % 100; if (h < Math.min(85, 20 + days * 30)) done++; }
    }
    return { n, done };
  };
  root.innerHTML = `<div class="container mentor">
    <div class="m-head"><div><div class="eyebrow">Mentor · ${esc(MENTOR_NAME)}</div><h1>Assignments</h1><p class="muted mb0">Practice you sent, and how far each group has got.</p></div></div>
    ${list.length ? `<div class="card as-list">${list.map((a) => {
      const pr = progress(a);
      const b = M.BATCHES.find((x) => x.id === a.batchId);
      return `<div class="as-row"><div><b>${esc(a.title)}</b><span class="small muted">${b ? esc(b.name) + ' · ' : ''}${plural(pr.n, 'student')}${a.due ? ` · due ${fmtDate(a.due)}` : ''}${a.note ? ` · <span class="hand">${esc(a.note)}</span>` : ''}</span></div>
        <div class="as-prog"><span class="as-bar"><i style="width:${(pr.done / pr.n) * 100}%"></i></span><span class="small num">${pr.done}/${pr.n} done</span></div>
        <span class="small faint">${relDay(a.createdAt)}</span></div>`;
    }).join('')}</div>` : `<div class="card empty-as"><p class="muted mb0">Nothing assigned yet. From <a href="#/mentor">Re-teach</a>, send a drill to everyone who missed a question, or assign practice from a student’s page.</p></div>`}
  </div>`;
}
