// Pre-test check: the student lines up with the camera and every proctoring check has to
// pass (and stay passed for a moment) before the Start button unlocks. The camera keeps
// running into the test. If the camera cannot start, the test can go ahead unproctored.
import { store } from '../store.js';
import { mountCamCheck } from './camsetup.js';
import { PROCTOR } from '../config.js';
import { esc, fmtClock, toast } from '../ui.js';
import { icon } from '../icons.js';

export function render(root, [sid]) {
  const s = store.session(sid);
  if (!s) { location.replace('#/'); return; }
  if (s.status !== 'ready') { location.replace(`#/test/${sid}`); return; }
  if (!s.face?.enabled) { location.replace(`#/test/${sid}`); return; }
  const p = store.profile;
  const enrolled = p.face?.descriptors?.length ? p.face.descriptors : null;
  const st = { ev: null, override: false };

  root.innerHTML = `<div class="pc-page"><div class="container narrow-wide">
    <a class="back-link" href="#/">${icon('back', { size: 14 })} Home</a>
    <div class="pc">
      <div class="pc-side"><div id="cam"></div>
        <p class="small muted" style="margin-top:10px">Video stays in this tab. During the test the camera watches for the same things and notes them in your report; it never records.</p></div>
      <div class="pc-main">
        <div class="eyebrow">Before you start</div>
        <h1>${esc(s.templateName)}</h1>
        <p class="muted">${s.paper.length} questions · ${fmtClock(s.durationSec)} on the clock. Line up with the camera and the checks tick themselves off.</p>
        <div id="checks"></div>
        <div class="pc-actions">
          <button class="btn primary lg" id="go" disabled>Start test</button>
          <span class="small muted" id="hint">Waiting for the checks…</span>
        </div>
        <div class="row mt" id="alt"></div>
      </div>
    </div>
  </div></div>`;

  const goBtn = root.querySelector('#go');
  const hint = root.querySelector('#hint');
  const alt = root.querySelector('#alt');

  const altHTML = (ev) => {
    const parts = [];
    if (ev.cam.state === 'error') parts.push('<button class="btn" id="nocam">Continue without camera (unproctored)</button>');
    const idBad = ev.checks.find((c) => c.id === 'identity')?.state === 'bad';
    const othersOk = ev.checks.filter((c) => c.required && c.id !== 'identity' && c.state !== 'skip' && c.state !== 'info').every((c) => c.state === 'ok');
    if (idBad && othersOk && !st.override) parts.push('<button class="btn" id="itsme">It’s me, continue anyway</button><span class="small muted">This is noted in the report.</span>');
    if (enrolled) parts.push(`<a class="linkish small" href="#/enrol?next=precheck/${sid}">Re-enrol my face</a>`);
    return parts.join('');
  };

  const cc = mountCamCheck(root.querySelector('#cam'), {
    mode: 'precheck', enrolled, fullscreen: !!s.fullscreen, listHost: root.querySelector('#checks'),
    enrolHref: `#/enrol?next=precheck/${sid}`,
    onTick: (ev) => {
      st.ev = ev;
      const idBad = ev.checks.find((c) => c.id === 'identity')?.state === 'bad';
      const othersOk = ev.checks.filter((c) => c.required && c.id !== 'identity' && c.state !== 'skip' && c.state !== 'info').every((c) => c.state === 'ok');
      const ready = ev.ready || (st.override && idBad && othersOk);
      const steady = ready && (st.override || ev.steadyMs >= PROCTOR.steadyMs);
      goBtn.disabled = !steady;
      hint.textContent = steady ? 'All checks passed. The clock starts on the next screen.' : ready ? 'Hold still…' : ev.cam.state === 'error' ? 'The camera could not start.' : ev.guidance || 'Waiting for the checks…';
      const html = altHTML(ev);
      if (alt.dataset.html !== html) { alt.innerHTML = html; alt.dataset.html = html; }
    },
  });

  const begin = () => {
    const ev = st.ev;
    const verdict = ev?.identity?.verdict || null;
    s.proctor = {
      ...(s.proctor || {}),
      enabled: true,
      enrolled: !!enrolled,
      identityAtStart: !enrolled ? 'not-enrolled' : st.override ? 'override' : verdict === 'match' ? 'match' : ev?.checks.find((c) => c.id === 'identity')?.state === 'skip' ? 'skipped' : verdict || 'skipped',
      precheck: { at: Date.now(), checks: (ev?.checks || []).map((c) => ({ id: c.id, state: c.state, detail: c.detail })), mic: cc.proctor.micState === 'running' },
      flags: {}, overrides: st.override ? ['identity'] : [],
    };
    if (!p.calibration) { const b = cc.proctor.baseline(); if (b) store.updateProfile({ calibration: b }); }
    store.putSession(s, { immediate: true });
    cc.destroy({ camera: false });
    location.hash = `#/test/${sid}`;
  };

  root.onclick = (e) => {
    if (e.target.closest('#go') && !goBtn.disabled) return begin();
    if (e.target.closest('#itsme')) { st.override = true; toast('Noted. Continuing with your word for it.'); return; }
    if (e.target.closest('#nocam')) {
      s.face.enabled = false;
      s.proctor = { enabled: false, reason: 'camera-unavailable' };
      store.putSession(s, { immediate: true });
      cc.destroy();
      location.hash = `#/test/${sid}`;
    }
  };

  return () => cc.destroy({ camera: !location.hash.startsWith('#/test/') });
}
