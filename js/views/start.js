// The paper: its cover sheet (what's in it, marking, the few rules that matter) and one way in:
// the camera room. Options (question bank, full screen, pace hint) are folded away.
import { store } from '../store.js';
import { esc, fmtDur, relDay } from '../ui.js';
import { questionCount, maxMarks } from '../data/templates.js';
import { createSession, cameraAllowed, bankCoverage, bankFor, estimateDurationSec } from '../engine/paper.js';
import { calibrationStatus } from '../face/expression.js';
import { BANKS } from '../config.js';
import { icon } from '../icons.js';

export function render(root, [tplId]) {
  const p = store.profile;
  const t = store.template(tplId);
  if (!t || t.disabled) { location.replace('#/'); return; }
  const live = store.inProgress();
  const camOk = cameraAllowed(p);
  const cs = calibrationStatus(p.calibration);
  const n = questionCount(t);
  const st = { fullscreen: !!t.palette?.fullscreen && store.prefs.fullscreen !== false, bank: t.bank || bankFor(p), paceHint: !!store.prefs.paceHint };
  const cbt = t.layout === 'cbt';
  const isEasy = (b) => b === 'easy' || b === 'class10';

  const rules = cbt
    ? ['<b>Choose, then save.</b> Click an option (or press <kbd>1</kbd>–<kbd>4</kbd>), then <b>Save &amp; Next</b> (<kbd>S</kbd>). A choice you don’t save is dropped, as on the NTA screen.',
      '<b>Mark for review</b> (<kbd>M</kbd>) keeps a question purple in the palette. Answered-and-marked questions still count.',
      'Move freely with the palette or the arrow keys.']
    : ['<b>Read in the booklet, answer on the OMR sheet.</b> Click a bubble, or press <kbd>1</kbd>–<kbd>4</kbd> for the highlighted question.',
      'On the real sheet a filled bubble is final. Here you can change it, but every change is noted.',
      'Circle a question number to come back to it.'];

  const draw = () => {
    const have = bankCoverage(t, st.bank).reduce((s, c) => s + c.have, 0);
    const est = estimateDurationSec(t, st.bank) * (have < n ? have / n : 1);
    const qn = Math.min(n, have);
    const marking = ['mcq', ...(t.sections.some((s) => s.numerical) ? ['numerical'] : [])].map((k) => {
      const m = t.marking[k];
      return `<tr><td>${k === 'mcq' ? 'Multiple choice' : 'Numerical value'}</td><td class="r good-t">+${m.correct}</td><td class="r bad-t">${m.wrong}</td><td class="r">${m.unattempted}</td></tr>`;
    }).join('');
    root.innerHTML = `<div class="container paper-page">
      <a class="back-link" href="#/">${icon('back', { size: 14 })} Home</a>
      <div class="paper-grid">
        <section class="cover card stacked">
          <div class="cover-band"><span>Exam Insight · practice paper</span><span class="mono">${esc(t.exam)} · ${cbt ? 'CBT' : 'OMR'}</span></div>
          <h1 class="cover-title">${esc(t.name)}</h1>
          ${t.blurb ? `<p class="lead">${esc(t.blurb)}</p>` : ''}
          <div class="cover-fields">
            <div><span>Questions</span><b class="display">${qn}</b></div>
            <div><span>Time allowed</span><b class="display">${isEasy(st.bank) ? `~${Math.max(1, Math.round(est / 60))} min` : `${t.totalMin} min`}</b></div>
            <div><span>Maximum marks</span><b class="display">${maxMarks(t)}</b></div>
            <div><span>Format</span><b class="display">${cbt ? 'On screen' : 'Booklet + OMR'}</b></div>
          </div>
          <div class="cover-cols">
            <div><div class="eyebrow">Sections</div>
              <table class="table mini"><tbody>${t.sections.map((s) => `<tr><td>${esc(s.name)}</td><td class="r num">${s.mcq + s.numerical}</td></tr>`).join('')}</tbody></table></div>
            <div><div class="eyebrow">Marking</div>
              <table class="table mini"><thead><tr><th></th><th class="r">Right</th><th class="r">Wrong</th><th class="r">Blank</th></tr></thead><tbody>${marking}</tbody></table></div>
          </div>
          <div class="eyebrow mt">Instructions</div>
          <ol class="rules">${rules.map((r) => `<li>${r}</li>`).join('')}</ol>
        </section>
        <aside class="paper-side">
          ${live ? `<div class="notice warn">${icon('pause')}<div>You have a test in progress (${esc(live.templateName)}). <a href="#/">Resume or discard it</a> first.</div></div>` : ''}
          ${!camOk ? `<div class="notice bad">${icon('camera')}<div><b>Camera analysis is off.</b> The paper reads your expressions, so it needs your agreement first. <a href="#/privacy">Turn it on</a>.</div></div>` : ''}
          <section class="card run-card">
            <div class="eyebrow">How it runs</div>
            <ol class="run-steps">
              <li><span class="bub on">1</span><div><b>Camera room</b><span>${cs.ok ? `A quick room check: light, it’s you, a five-second calm baseline. Calibrated ${relDay(p.calibration.at).toLowerCase()}.` : 'First time: it learns your face (about two minutes). The paper waits until your face is clearly readable.'}</span></div></li>
              <li><span class="bub on">2</span><div><b>The paper</b><span>Your face is read on this device, second by second. Look down to write whenever you need to.</span></div></li>
              <li><span class="bub on">3</span><div><b>Your behaviour map</b><span>Every question shaded by strain, the four kinds of question, and what to practise.</span></div></li>
            </ol>
            <button class="btn primary lg block" id="go" ${live || !camOk ? 'disabled' : ''}>${icon('camera', { size: 16 })} Go to the camera room</button>
            <p class="small faint mb0" style="text-align:center;margin-top:8px">The clock starts only after the room check.</p>
          </section>
          <details class="card fold-card">
            <summary><span>${icon('settings', { size: 15 })} Options</span><span class="deep-chev">${icon('chevron', { size: 14 })}</span></summary>
            ${t.bank ? `<div class="toggle-row"><div class="txt"><strong>Questions</strong><p>${esc(BANKS[t.bank].blurb)}</p></div></div>` : `<div class="toggle-row"><div class="txt"><strong>Questions</strong><p>${esc(BANKS[st.bank].blurb)}</p></div>
              <div class="seg"><button class="${st.bank === 'easy' ? 'on' : ''}" data-bank="easy">${BANKS.easy.label}</button><button class="${st.bank === 'standard' ? 'on' : ''}" data-bank="standard">${BANKS.standard.label}</button></div></div>`}
            <div class="toggle-row"><div class="txt"><strong>Full screen</strong><p>Fewer distractions. Leaving it is noted.</p></div>
              <label class="switch"><input type="checkbox" id="fs" ${st.fullscreen ? 'checked' : ''}><span class="track"></span></label></div>
            <div class="toggle-row"><div class="txt"><strong>Pace hint</strong><p>An “ahead / behind” pill in the test bar. Not in the real exam.</p></div>
              <label class="switch"><input type="checkbox" id="pace" ${st.paceHint ? 'checked' : ''}><span class="track"></span></label></div>
          </details>
        </aside>
      </div>
    </div>`;
  };
  draw();

  root.onchange = (e) => {
    if (e.target.id === 'fs') st.fullscreen = e.target.checked;
    if (e.target.id === 'pace') { st.paceHint = e.target.checked; store.setPref('paceHint', st.paceHint); }
  };
  root.onclick = (e) => {
    const b = e.target.closest('[data-bank]');
    if (b) { st.bank = b.dataset.bank; store.setPref('bank', st.bank); draw(); root.querySelector('.fold-card').open = true; return; }
    if (!e.target.closest('#go') || live || !camOk) return;
    const seen = new Set(store.sessions({ exam: t.exam }).flatMap((s) => s.paper.map((x) => x.id)));
    const s = createSession(t, p, { seen, faceEnabled: true, fullscreen: st.fullscreen, bank: st.bank });
    store.putSession(s, { immediate: true });
    location.hash = `#/room/${s.id}`;
  };
}
