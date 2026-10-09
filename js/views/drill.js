// Drill start: a short timed set on one topic, or a re-attempt of open mistakes.
import { store } from '../store.js';
import { createDrill, bankFor, cameraAllowed } from '../engine/paper.js';
import { currentMap, collectMistakes } from '../engine/report.js';
import { GROUPS } from '../engine/topics.js';
import { DRILL, BANKS } from '../config.js';
import { BANK } from '../data/bank.js';
import { esc, pct, fix, plural, fmtDur, toast } from '../ui.js';
import { icon } from '../icons.js';

export function render(root, [topicEnc, modeIn]) {
  const p = store.profile;
  const topic = decodeURIComponent(topicEnc);
  const isMistakes = topic === 'mistakes';
  let mode = DRILL.modes[modeIn] ? modeIn : 'normal';
  const live = store.inProgress();
  const bank = bankFor(p);
  const open = isMistakes ? collectMistakes(p.exam).filter((m) => m.status === 'open') : [];
  const pool = isMistakes ? open : BANK[bank].filter((q) => q.topic === topic && q.exams.includes(p.exam));
  const t = isMistakes ? null : currentMap(p.exam).find((x) => x.topic === topic);
  const n = Math.min(pool.length, DRILL.size + (isMistakes ? 2 : 0));

  const draw = () => {
    const m = DRILL.modes[mode];
    const sample = isMistakes ? open.slice(0, n).map((x) => x.q) : pool.slice(0, n);
    const est = Math.round(sample.reduce((a, q) => a + (q.difficulty === 3 ? 1.5 : q.difficulty === 2 ? 1 : 0.7), 0) * (p.exam === 'JEE' ? 144 : 60) * (bank !== 'standard' ? 0.5 : 1) * m.mult);
    root.innerHTML = `<div class="container narrow">
      <a class="back-link" href="#/">${icon('back', { size: 14 })} Home</a>
      <div class="page-head"><div>
        <div class="eyebrow">${isMistakes ? 'Mistake re-attempt' : 'Topic drill'}</div>
        <h1>${isMistakes ? 'Re-attempt your open mistakes' : esc(topic)}</h1>
        ${t ? `<div class="row" style="gap:8px"><span class="group-chip ${t.status === 'insufficient' ? 'g-none' : GROUPS[t.group]?.cls}"><i></i>${t.status === 'insufficient' ? 'Not grouped yet' : GROUPS[t.group]?.label}</span><span class="small muted">${t.cum.correct} of ${t.cum.n} right so far · ${fix(t.cum.timeRatio, 1)}× expected time</span></div>` : isMistakes ? `<p class="muted mb0">${plural(open.length, 'open mistake')} across your tests. The oldest ones come first.</p>` : '<p class="muted mb0">No attempts on this topic yet.</p>'}
      </div></div>
      ${live ? `<div class="notice warn" style="margin-bottom:16px">${icon('pause')}<div>You have a test in progress (${esc(live.templateName)}). <a href="#/test/${live.id}">Resume it</a> or discard it from Home before starting a drill.</div></div>` : ''}
      ${!n ? `<div class="card"><p class="muted mb0">${isMistakes ? 'Nothing open in your mistake log. Nice.' : `The ${BANKS[bank].label.toLowerCase()} bank has no ${p.exam} questions on this topic.`}</p><a class="btn mt" href="#/">Back home</a></div>` : `
      <div class="card">
        <h3>Mode</h3>
        <div class="choice-grid">${Object.entries(DRILL.modes).map(([k, v]) => `<label class="choice"><input type="radio" name="mode" value="${k}" ${k === mode ? 'checked' : ''}><div><strong>${v.label}</strong><span>${v.blurb}</span></div></label>`).join('')}</div>
        <div class="summary-list mt">
          <div><span>Questions</span><b>${n}${!isMistakes && pool.length < DRILL.size ? ` <span class="faint">(all ${BANKS[bank].label.toLowerCase()} items on this topic)</span>` : ''}</b></div>
          <div><span>Time allowed</span><b>about ${fmtDur(est)}</b></div>
          <div><span>Per-question target</span><b>${Math.round(m.mult * 100)}% of expected time, shown as a bar</b></div>
          <div><span>Questions from</span><b>${BANKS[bank].label} bank</b></div>
        </div>
        <p class="small muted">Drills feed the same topic map as your mocks. Marking is the same as the exam (+4 / −1), so a blank still beats a blind guess you can’t narrow down.</p>
        <button class="btn primary lg block" id="go" ${live ? 'disabled' : ''}>${icon('camera', { size: 16 })} Camera room, then the drill</button>
      </div>`}
    </div>`;
  };
  draw();
  root.onchange = (e) => { if (e.target.name === 'mode') { mode = e.target.value; draw(); } };
  root.onclick = (e) => {
    if (e.target.closest('#go')) {
      const s = isMistakes
        ? createDrill(p, { mode, qids: open.slice(0, n).map((x) => x.qid), source: 'mistakes', faceEnabled: cameraAllowed(p) })
        : createDrill(p, { topic, mode, faceEnabled: cameraAllowed(p) });
      if (!s) { toast('Could not build this drill'); return; }
      store.putSession(s, { immediate: true });
      location.hash = s.face.enabled ? `#/room/${s.id}` : `#/test/${s.id}`;
    }
  };
}
