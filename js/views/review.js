// Self-report after the test: the highest-friction questions plus a random sample.
// One tap each. Tags are ground truth and overrule anything the app infers.
import { store } from '../store.js';
import { QMAP } from '../engine/paper.js';
import { isAnswered } from '../engine/scoring.js';
import { TAGS, REVIEW } from '../config.js';
import { esc, plain, OPTION_KEYS, fmtClock } from '../ui.js';

export function render(root, [sid]) {
  const s = store.session(sid);
  if (!s) { location.replace('#/'); return; }
  if (s.status === 'done') { location.replace(`#/report/${sid}`); return; }
  if (s.status !== 'review') { location.replace(`#/test/${sid}`); return; }
  const t0 = Date.now();
  const items = s.reviewSet.map((id) => ({ id, p: s.paper.find((x) => x.id === id), q: QMAP.get(id) }));

  const answerText = (it) => {
    const v = s.responses[it.id]?.saved;
    if (!isAnswered(v)) return '<span class="faint">Left blank</span>';
    return it.q.type === 'mcq' ? `Option ${s.layout === 'omr' ? Number(v) + 1 : OPTION_KEYS[v]}` : `<span class="mono">${esc(v)}</span>`;
  };

  const draw = () => {
    const tagged = items.filter((it) => s.tags[it.id]).length;
    root.innerHTML = `<div class="container narrow">
      <div class="eyebrow">Test submitted · last step</div>
      <h1>How did these questions feel?</h1>
      <p class="muted">One tap each, about five minutes. There are no wrong answers here, and the app takes your word over anything it measured. ${items.length >= s.paper.length ? `This short test has ${items.length} questions, so you see all of them.` : `These are the ${Math.min(REVIEW.topFriction, items.length)} questions that took the most out of you, plus a few picked at random.`}</p>
      <div class="tag-legend">${TAGS.map((t) => `<span><b>${t.label}</b> ${t.hint}</span>`).join('')}</div>
      <div class="review-progress card tight">
        <div class="row between"><b><span id="tcount">${tagged}</span> of ${items.length} tagged</b><span class="small faint" id="rtime"></span></div>
        <div class="progress"><div id="tbar" style="width:${(tagged / items.length) * 100}%"></div></div>
      </div>
      <div class="card" style="padding:4px 20px">
        ${items.map((it) => `<div class="tag-q ${s.tags[it.id] ? 'done' : ''}" id="tq-${it.id}">
          <div>
            <div class="row" style="gap:8px;margin-bottom:4px"><b>Q${it.p.n}</b><span class="chip">${esc(it.p.section)}</span><span class="small muted">Your answer: ${answerText(it)}</span></div>
            <div class="qprev">${esc(plain(it.q.text))}</div>
          </div>
          <div class="tag-btns" role="radiogroup" aria-label="Tag for question ${it.p.n}">${TAGS.map((t) => `<button class="tag-btn ${s.tags[it.id] === t.id ? 'on' : ''}" data-q="${it.id}" data-tag="${t.id}" role="radio" aria-checked="${s.tags[it.id] === t.id}">${t.label}</button>`).join('')}</div>
        </div>`).join('')}
      </div>
      <div class="review-foot">
        <button class="btn ghost" id="skip">Skip tagging</button>
        <button class="btn primary lg" id="finish">See my report →</button>
      </div>
    </div>`;
  };
  draw();

  const timer = setInterval(() => {
    const el = root.querySelector('#rtime');
    if (!el) return;
    const left = REVIEW.softLimitSec - (Date.now() - t0) / 1000;
    el.textContent = left > 0 ? `About ${fmtClock(left)} suggested` : 'Take your time';
  }, 1000);

  const done = () => {
    s.status = 'done';
    s.reviewedAt = Date.now();
    store.putSession(s, { immediate: true });
    location.hash = `#/report/${sid}`;
  };

  root.onclick = (e) => {
    const b = e.target.closest('.tag-btn');
    if (b) {
      s.tags[b.dataset.q] = b.dataset.tag;
      store.putSession(s);
      const row = root.querySelector(`#tq-${CSS.escape(b.dataset.q)}`);
      row.classList.add('done');
      row.querySelectorAll('.tag-btn').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
      const tagged = items.filter((it) => s.tags[it.id]).length;
      root.querySelector('#tcount').textContent = tagged;
      root.querySelector('#tbar').style.width = `${(tagged / items.length) * 100}%`;
      const next = items.find((it) => !s.tags[it.id]);
      if (next) {
        const el = root.querySelector(`#tq-${CSS.escape(next.id)}`);
        const r = el.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.75) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    if (e.target.id === 'finish' || e.target.id === 'skip') done();
  };

  return () => clearInterval(timer);
}
