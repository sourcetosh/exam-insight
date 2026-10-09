// Mistake log: every wrong (or lucky-guess) attempt with the solution, your note, and a re-attempt path.
import { store } from '../store.js';
import { collectMistakes } from '../engine/report.js';
import { SUBJECTS } from '../data/taxonomy.js';
import { TAGS, DRILL } from '../config.js';
import { esc, plain, fmtDate, relDay, OPTION_KEYS, plural, toast, fmtDur } from '../ui.js';
import { icon } from '../icons.js';

const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.id, t.label]));
const STATUS = { open: ['Open', 'warn'], resolved: ['Marked resolved', 'good'], fixed: ['Got it right since', 'good'] };

export function render(root, params, query = '') {
  const p = store.profile;
  const focus = new URLSearchParams(query).get('q');
  const st = { subject: 'All', status: 'open', open: new Set(focus ? [focus] : []) };
  let noteTimer = null;

  const draw = () => {
    const all = collectMistakes(p.exam);
    const counts = { open: all.filter((m) => m.status === 'open').length, resolved: all.filter((m) => m.status === 'resolved').length, fixed: all.filter((m) => m.status === 'fixed').length };
    const list = all.filter((m) => (st.subject === 'All' || m.subject === st.subject) && (st.status === 'all' || m.status === st.status));
    const subjects = ['All', ...Object.keys(SUBJECTS).filter((x) => SUBJECTS[x].exams.includes(p.exam))];
    const byTopic = new Map();
    for (const m of list) { if (!byTopic.has(m.topic)) byTopic.set(m.topic, []); byTopic.get(m.topic).push(m); }

    const entry = (m) => {
      const q = m.q;
      const last = m.last;
      const isOpen = st.open.has(m.qid);
      const ans = (v) => (v == null || v === '' ? 'blank' : q.type === 'mcq' ? OPTION_KEYS[v] : String(v));
      const [sl, sc] = STATUS[m.status];
      return `<article class="mist ${isOpen ? 'open' : ''} ${focus === m.qid ? 'focus' : ''}" id="m-${esc(m.qid)}">
        <div class="mist-head" data-toggle="${esc(m.qid)}">
          <div class="mist-q">${esc(plain(q.text))}</div>
          <div class="mist-meta">
            <span class="chip ${sc}">${sl}</span>
            ${m.wrongs > 1 ? `<span class="chip bad">Wrong ${m.wrongs}×</span>` : ''}
            ${last.lucky ? '<span class="chip warn">Lucky guess</span>' : ''}
            ${last.tag ? `<span class="chip">${TAG_LABEL[last.tag]}</span>` : ''}
            <span class="small muted">${esc(last.session.templateName)} · ${relDay(last.at)}</span>
            <span class="mist-chev">${icon('chevron', { size: 16 })}</span>
          </div>
        </div>
        ${isOpen ? `<div class="mist-body">
          <div class="q-text small-q">${q.text}</div>
          ${q.type === 'mcq' ? `<ol class="detail-opts">${q.options.map((o, i) => `<li class="${i === q.answer ? 'key' : ''} ${String(last.final) === String(i) && i !== q.answer ? 'mine' : ''}"><b>${OPTION_KEYS[i]}</b><span>${o}</span>${i === q.answer ? '<em>Answer key</em>' : String(last.final) === String(i) ? '<em>Your answer</em>' : ''}</li>`).join('')}</ol>` : `<p class="small">Key <b class="mono">${esc(String(q.answer))}</b> · your answer <b class="mono">${esc(ans(last.final))}</b></p>`}
          ${q.solution ? `<div class="solution"><div class="eyebrow">Solution</div><div>${q.solution}</div></div>` : ''}
          <div class="mist-attempts small muted">${m.attempts.map((a) => `<span>${fmtDate(a.at)}: ${a.correct ? (a.lucky ? 'right (guessed)' : 'right') : 'wrong'}${a.timeSec != null ? ` in ${fmtDur(a.timeSec)}` : ''}</span>`).join(' → ')}</div>
          <div class="field mt"><label for="note-${esc(m.qid)}">Why did this go wrong? <span class="faint">(your note, saved as you type)</span></label>
            <textarea id="note-${esc(m.qid)}" data-note="${esc(m.qid)}" placeholder="e.g. read ‘maximum’ as ‘minimum’; forgot the negative sign; didn’t know the formula">${esc(m.note)}</textarea></div>
          <div class="row between mt">
            <label class="check-row" style="margin:0"><input type="checkbox" data-resolve="${esc(m.qid)}" ${m.status === 'resolved' ? 'checked' : ''} ${m.status === 'fixed' ? 'disabled' : ''}><span>${m.status === 'fixed' ? 'Resolved by a later correct attempt' : 'I understand this now'}</span></label>
            <a class="btn sm" href="#/report/${last.session.id}">Open that test</a>
          </div>
        </div>` : ''}
      </article>`;
    };

    root.innerHTML = `<div class="container narrow-wide">
      <div class="page-head"><div><div class="eyebrow">${p.exam === 'JEE' ? 'JEE Main' : 'NEET UG'}</div><h1>Mistake log</h1>
        <p class="muted">Every question you got wrong, with the solution and room for your own note. Top rankers keep one of these by hand.</p></div>
        <a class="btn primary" href="#/drill/mistakes/normal" ${counts.open ? '' : 'aria-disabled="true" style="pointer-events:none;opacity:.5"'}>${icon('refresh', { size: 14 })} Re-attempt ${Math.min(counts.open, DRILL.size + 2) || ''} open</a></div>
      <div class="grid three" style="margin-bottom:16px">
        <div class="card tight"><div class="stat"><span class="label">Open</span><span class="value">${counts.open}</span><span class="sub">not yet understood</span></div></div>
        <div class="card tight"><div class="stat"><span class="label">Resolved</span><span class="value">${counts.resolved}</span><span class="sub">marked by you</span></div></div>
        <div class="card tight"><div class="stat"><span class="label">Fixed</span><span class="value">${counts.fixed}</span><span class="sub">right on a later attempt</span></div></div>
      </div>
      <div class="bank-filters" style="margin-bottom:14px">
        <div class="seg">${subjects.map((x) => `<button class="${st.subject === x ? 'on' : ''}" data-subj="${x}">${x}</button>`).join('')}</div>
        <div class="seg">${[['open', 'Open'], ['resolved', 'Resolved'], ['fixed', 'Fixed'], ['all', 'All']].map(([k, l]) => `<button class="${st.status === k ? 'on' : ''}" data-status="${k}">${l}</button>`).join('')}</div>
      </div>
      ${list.length ? [...byTopic.entries()].map(([topic, ms]) => `<section class="mist-group"><div class="row between"><h3>${esc(topic)} <span class="faint" style="font-weight:500">· ${plural(ms.length, 'question')}</span></h3><a class="btn sm ghost" href="#/drill/${encodeURIComponent(topic)}/normal">Drill topic</a></div>${ms.map(entry).join('')}</section>`).join('')
        : `<div class="empty card"><div class="empty-art" aria-hidden="true">${[0, 0, 1, 0, 0, 2, 0, 1, 0, 0].map((x) => `<i class="f${x}"></i>`).join('')}</div><div><h2>${st.status === 'open' ? 'Nothing open' : 'Nothing here'}</h2><p class="muted mb0">${all.length ? 'Try another filter.' : 'Wrong answers from your tests and drills will collect here with their solutions.'}</p></div></div>`}
    </div>`;
    if (focus) { const el = root.querySelector(`#m-${CSS.escape(focus)}`); el?.scrollIntoView({ block: 'center' }); }
  };
  draw();

  root.onclick = (e) => {
    const sb = e.target.closest('[data-subj]'); if (sb) { st.subject = sb.dataset.subj; draw(); return; }
    const sx = e.target.closest('[data-status]'); if (sx) { st.status = sx.dataset.status; draw(); return; }
    const tg = e.target.closest('[data-toggle]');
    if (tg) { const id = tg.dataset.toggle; if (st.open.has(id)) st.open.delete(id); else st.open.add(id); draw(); }
  };
  root.onchange = (e) => {
    if (e.target.dataset.resolve) { store.setResolved(e.target.dataset.resolve, e.target.checked); toast(e.target.checked ? 'Marked resolved' : 'Reopened'); draw(); }
  };
  root.oninput = (e) => {
    if (e.target.dataset.note != null) {
      const id = e.target.dataset.note, v = e.target.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => store.setNote(id, v.trim()), 400);
    }
  };
  return () => { clearTimeout(noteTimer); };
}
