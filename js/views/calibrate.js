// Two-minute baseline: a calm passage, then a deliberately hard puzzle.
// Sets this student's neutral and effortful ranges for the tension marker.
import { store } from '../store.js';
import { faceLayer, calibrationFrom } from '../face/facelayer.js';
import { FACE } from '../config.js';
import { esc } from '../ui.js';

const PASSAGE = `The river did not hurry. It moved past the old banyan at the edge of the village the way it always had,
carrying a few leaves and the reflection of the afternoon sky. On the far bank, a farmer led two buffaloes down to the water,
and they stood there, knee-deep, unbothered by anything at all. A kingfisher sat on a low branch, watching. Nothing here needs
an answer. Read slowly, at your normal pace, and let your eyes rest on each line. When the bar fills, the next part begins.`;

export function render(root, [sid]) {
  const standalone = sid === 'standalone';
  const s = standalone ? null : store.session(sid);
  if (!s && !standalone) { location.replace('#/'); return; }
  // Tests go through the proctoring pre-check now; this page is the optional full calibration only.
  if (s) { location.replace(`#/precheck/${sid}`); return; }
  const st = { phase: 'intro', status: 'Starting camera…', ok: false, secs: FACE.calibrationSec, t0: 0, puzzle: null, solved: 0, tried: 0 };
  const bins = { calm: { total: 0, valid: [] }, effort: { total: 0, valid: [] } };
  let tick = null;
  let unsub = null;

  const newPuzzle = () => {
    const a = 23 + Math.floor(Math.random() * 67), b = 13 + Math.floor(Math.random() * 76);
    st.puzzle = { text: `${a} × ${b}`, answer: a * b };
  };

  const camBox = () => `<div class="calib-cam"><video id="pv" muted playsinline></video><div class="guide"></div>
      <div class="cam-status ${st.ok ? 'ok' : ''}" id="cstat"><span class="dot"></span><span>${esc(st.status)}</span></div></div>
    <p class="small muted" style="margin-top:10px">Video stays in this tab. Only numbers are kept: a tension value, blinks and whether you look away, compared with this baseline.</p>`;

  function draw() {
    let main = '';
    if (st.phase === 'intro') {
      main = `<div class="eyebrow">Camera calibration · 2 minutes</div>
        <h1>Let’s learn your calm and your effort</h1>
        <p class="muted">Everyone’s face is different, so the app never compares you with anyone else. First you read a calm passage for a minute, then work on hard mental arithmetic for a minute. That sets your own baseline.</p>
        <ul class="ticks small">
          <li>Sit where your face is evenly lit, about an arm’s length from the screen.</li>
          <li>Looking down at rough work is fine and is never counted against you.</li>
          <li>Poor light or your face out of view just drops those frames and shows a camera-quality note.</li>
        </ul>
        <div class="row mt">
          <button class="btn primary lg" id="begin" ${st.ok ? '' : 'disabled'}>Start calibration</button>
          <button class="btn ghost" id="nocam">${standalone ? 'Cancel' : 'Continue without camera'}</button>
        </div>
        <button class="linkish small mt" id="short">Demo: use 15-second phases</button>`;
    } else if (st.phase === 'calm' || st.phase === 'effort') {
      const left = Math.max(0, st.secs - Math.floor((performance.now() - st.t0) / 1000));
      main = `<div class="eyebrow">Part ${st.phase === 'calm' ? '1 of 2 · Calm reading' : '2 of 2 · Effort'}</div>
        <div class="progress"><div id="bar" style="width:${(1 - left / st.secs) * 100}%"></div></div>
        <p class="small faint" id="left">${left}s left</p>
        ${st.phase === 'calm'
          ? `<p class="passage">${PASSAGE}</p>`
          : `<h2>Work these out in your head</h2><p class="muted small">They are meant to be hard. Keep trying until the bar fills; the score does not matter.</p>
             <div class="puzzle"><span class="pz-q mono">${st.puzzle.text} =</span><input id="pz" type="text" inputmode="numeric" autocomplete="off" aria-label="Your answer"><button class="btn" id="pzgo">Check</button></div>
             <p class="small muted" id="pzfb">${st.tried ? `${st.solved} of ${st.tried} right so far` : 'Press Enter to check'}</p>`}`;
    } else if (st.phase === 'done') {
      const c = st.calib;
      main = `<div class="eyebrow">Calibration complete</div>
        <h1>${c.quality === 'ok' ? 'Baseline set' : 'Baseline set, with a camera-quality note'}</h1>
        <p class="muted">${c.quality === 'ok'
          ? 'Your tension marker will be measured against this baseline. It carries a capped, low weight and is only shown when it lines up with what you did on a question.'
          : `Only ${Math.round(c.validFrac * 100)}% of frames were usable (light or framing). Markers will still work, with more frames dropped. You can recalibrate any time from Privacy.`}</p>
        <div class="summary-list">
          <div><span>Usable frames</span><b>${Math.round(c.validFrac * 100)}%</b></div>
          <div><span>Calm blink rate</span><b>${Math.round(c.calm.blinkPerMin)} / min</b></div>
          <div><span>Effort vs calm</span><b>${c.effort.mean > c.calm.mean ? 'Higher, as expected' : 'No clear change'}</b></div>
        </div>
        <button class="btn primary lg mt" id="totest">${standalone ? 'Done' : 'Begin test'}</button>`;
    }
    root.innerHTML = `<div class="calib-page"><div class="container narrow-wide"><div class="calib">
      <div>${camBox()}</div><div class="calib-main">${main}</div></div></div></div>`;
    faceLayer.attachPreview(root.querySelector('#pv'));
    if (st.phase === 'effort') root.querySelector('#pz')?.focus();
  }

  const setStatus = (txt, ok) => {
    st.status = txt; st.ok = ok;
    const el = root.querySelector('#cstat');
    if (el) { el.className = `cam-status ${ok ? 'ok' : ''}`; el.lastElementChild.textContent = txt; }
    const b = root.querySelector('#begin');
    if (b) b.disabled = !ok;
  };

  let recent = [];
  unsub = faceLayer.subscribe((ev) => {
    if (ev.type !== 'sample') return;
    recent.push(ev.valid);
    if (recent.length > 10) recent.shift();
    if (st.phase === 'intro') {
      const okShare = recent.filter(Boolean).length / recent.length;
      if (ev.valid) setStatus('Face found · light OK', true);
      else if (okShare < 0.3) setStatus(ev.reason === 'lowLight' ? 'Too dark: add some light' : 'Face not in view', false);
    }
    const bin = bins[st.phase];
    if (bin) { bin.total++; if (ev.valid) bin.valid.push(ev); }
  });

  const startPhase = (phase) => {
    st.phase = phase;
    st.t0 = performance.now();
    if (phase === 'effort') newPuzzle();
    draw();
    clearInterval(tick);
    tick = setInterval(() => {
      const el = performance.now() - st.t0;
      const left = Math.max(0, st.secs - Math.floor(el / 1000));
      const bar = root.querySelector('#bar');
      if (bar) bar.style.width = `${Math.min(100, (el / 1000 / st.secs) * 100)}%`;
      const l = root.querySelector('#left');
      if (l) l.textContent = `${left}s left`;
      if (el / 1000 >= st.secs) {
        clearInterval(tick);
        if (phase === 'calm') startPhase('effort');
        else finish();
      }
    }, 250);
  };

  const finish = () => {
    const c = calibrationFrom(bins.calm, bins.effort);
    st.calib = c;
    store.updateProfile({ calibration: c });
    st.phase = 'done';
    draw();
  };

  const checkPuzzle = () => {
    const inp = root.querySelector('#pz');
    if (!inp || inp.value.trim() === '') return;
    st.tried++;
    if (Number(inp.value) === st.puzzle.answer) st.solved++;
    newPuzzle();
    draw();
  };

  root.onclick = (e) => {
    const id = e.target.id;
    if (id === 'begin') startPhase('calm');
    if (id === 'short') { st.secs = 15; e.target.textContent = 'Using 15-second phases'; e.target.disabled = true; }
    if (id === 'pzgo') checkPuzzle();
    if (id === 'totest') location.hash = standalone ? '#/privacy' : `#/test/${sid}`;
    if (id === 'nocam' && standalone) { location.hash = '#/privacy'; return; }
    if (id === 'nocam') {
      s.face.enabled = false;
      store.putSession(s, { immediate: true });
      faceLayer.stop();
      location.hash = `#/test/${sid}`;
    }
  };
  root.onkeydown = (e) => { if (e.target.id === 'pz' && e.key === 'Enter') checkPuzzle(); };

  draw();
  faceLayer.start().then(() => {
    faceLayer.attachPreview(root.querySelector('#pv'));
    setStatus('Looking for your face…', false);
  }).catch((err) => {
    setStatus(err?.name === 'NotAllowedError' ? 'Camera permission was declined' : 'Camera layer unavailable on this device', false);
  });

  return () => {
    clearInterval(tick);
    unsub?.();
    if (!location.hash.startsWith('#/test/')) faceLayer.stop();
  };
}
