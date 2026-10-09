// The camera room. Nothing proceeds until the picture is good enough to read expressions.
//
// First time (or when the calibration is stale) it learns this student's face:
//   light & framing → calm face → frown → lip press → screen corners → writing posture
// Before every test it checks the room again:
//   light & framing → only you, it's you, no phone → a five-second calm baseline for this sitting
// There is no "continue without camera": the camera is what the whole analysis is built on.
import { store } from '../store.js';
import { ProctorSession } from '../face/proctor.js';
import { faceLayer, cameraErrorText } from '../face/facelayer.js';
import { neutralFrom, rangeFrom, screenFrom, paperFrom, buildCalibration, sessionCalibration, calibrationStatus, COMPONENT_LABEL } from '../face/expression.js';
import { GAUGE_OF } from '../face/quality.js';
import { EXPRESSION, QUALITY, PROCTOR } from '../config.js';
import { esc, fmtClock, toast, plural } from '../ui.js';
import { icon } from '../icons.js';
import { faceArt } from './faceart.js';

const C = EXPRESSION.calib;
const STEP_META = {
  frame: { label: 'Light', short: 'Light & framing' },
  neutral: { label: 'Calm face', short: 'Your calm face' },
  frown: { label: 'Frown', short: 'A puzzled frown' },
  press: { label: 'Lips', short: 'Lips pressed' },
  corners: { label: 'Screen', short: 'Screen corners' },
  paper: { label: 'Writing', short: 'Writing posture' },
  done: { label: 'Done', short: 'Calibrated' },
  checks: { label: 'Checks', short: 'Room check' },
};
const CORNERS = [
  { id: 'tl', x: 6, y: 8, label: 'top left' }, { id: 'tr', x: 94, y: 8, label: 'top right' },
  { id: 'br', x: 94, y: 92, label: 'bottom right' }, { id: 'bl', x: 6, y: 92, label: 'bottom left' },
  { id: 'c', x: 50, y: 50, label: 'centre' },
];
const CALM_LINES = [
  'Photosynthesis turns light, water and carbon dioxide into sugar and oxygen.',
  'The heart has four chambers: two atria above and two ventricles below.',
  'Every living thing is made of cells, and every cell comes from a cell.',
];

export function render(root, params, query) {
  const sid = params?.[0] || null;
  const q = new URLSearchParams(query || '');
  const p = store.profile;
  const s = sid ? store.session(sid) : null;
  if (sid && !s) { location.replace('#/'); return; }
  if (s && s.status !== 'ready') { location.replace(`#/test/${sid}`); return; }
  const forceCalib = q.get('calibrate') === '1';
  const next = q.get('next') ? `#/${q.get('next').replace(/^#?\/?/, '')}` : '#/';
  const cs = calibrationStatus(p.calibration);
  const needCalib = forceCalib || !cs.ok || !p.face?.thumb;
  const steps = s
    ? (needCalib ? ['frame', 'neutral', 'frown', 'press', 'corners', 'paper', 'checks'] : ['frame', 'checks'])
    : ['frame', 'neutral', 'frown', 'press', 'corners', 'paper', 'done'];

  const st = {
    i: 0, ev: null, holdFrom: null,
    neutral: [], frown: [], press: [], corners: CORNERS.map((c) => ({ id: c.id, frames: [] })), paper: [], paperTotal: 0,
    cornerIdx: 0, cornerAt: 0, stepAt: performance.now(), goodMs: 0, lastT: performance.now(),
    identity: null, identityBusy: false, settle: [], settleMs: 0, override: false, mismatchSince: null,
    result: null, saved: false, line: CALM_LINES[Math.floor(Math.random() * CALM_LINES.length)],
  };
  const stepId = () => steps[st.i];
  const enrolled = () => (st.identity?.descriptors?.length ? st.identity.descriptors : p.face?.descriptors?.length ? p.face.descriptors : null);

  // ---------- frame ----------
  root.innerHTML = `<div class="room" id="room">
    <header class="room-top">
      <a class="back-link" href="${s ? '#/' : next}">${icon('back', { size: 14 })} ${s ? 'Leave' : 'Back'}</a>
      <div class="room-title"><span class="eyebrow">Camera room</span><b>${s ? esc(s.templateName) : needCalib && p.calibration ? 'Recalibrate your face' : 'Learn your face'}</b></div>
      <ol class="room-steps" id="rsteps" aria-label="Steps"></ol>
    </header>
    <div class="room-body">
      <section class="admit" aria-label="Camera">
        <div class="admit-head"><span>Admit card</span><span class="mono">${esc(rollNo(p))}</span></div>
        <div class="admit-photo" id="photo">
          <video class="admit-video" id="rv" muted playsinline aria-label="Your camera"></video>
          <svg class="admit-guide" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
            <defs><mask id="ovalHole"><rect width="400" height="300" fill="#fff"/><ellipse cx="200" cy="150" rx="88" ry="118" fill="#000"/></mask></defs>
            <rect width="400" height="300" fill="rgb(10 14 26 / 34%)" mask="url(#ovalHole)"/>
            <ellipse class="oval" id="oval" cx="200" cy="150" rx="88" ry="118"/>
          </svg>
          <div class="photo-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <div class="admit-caption" id="cap"><span class="dot"></span><span id="captxt">Starting the camera…</span></div>
          <div class="admit-stamp" id="pstamp"></div>
          <div class="cam-off" id="camoff" hidden></div>
        </div>
        <div class="admit-meta">
          <div><span class="k">Candidate</span><b>${esc(p.name || 'Student')}</b></div>
          <div><span class="k">Exam</span><b>${p.exam === 'JEE' ? 'JEE Main' : 'NEET UG'}</b></div>
          <div class="sig"><span class="k">Signature</span><span class="hand">${esc((p.name || 'Student').split(' ')[0])}</span></div>
        </div>
        <div class="gauges" id="gauges"></div>
      </section>
      <section class="room-panel" id="panel" aria-live="polite"></section>
    </div>
    <div class="corner-stage" id="corners" hidden></div>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const video = $('#rv');
  const panel = $('#panel');

  // ---------- step bubbles ----------
  const paintSteps = () => {
    $('#rsteps').innerHTML = steps.map((id, k) => `<li class="${k < st.i ? 'done' : k === st.i ? 'cur' : ''}"><span class="bub ${k < st.i ? 'on' : k === st.i ? 'cur' : ''}">${k < st.i ? '' : k + 1}</span><span class="lbl">${STEP_META[id].label}</span></li>`).join('');
  };

  // ---------- gauges ----------
  const gauge = (id, label, value, state, word, extra = '') => {
    const filled = value == null ? -1 : Math.round(value * 4);
    const bubbles = [0, 1, 2, 3, 4].map((k) => {
      const on = id === 'light' ? k === filled : k <= filled;
      return `<i class="${on ? 'on' : ''} ${id === 'light' && k >= 1 && k <= 3 ? 'zone' : ''}"></i>`;
    }).join('');
    return `<div class="gauge g-${state}" data-g="${id}"><span class="g-l">${label}</span><span class="g-b">${bubbles}</span><span class="g-w">${word}</span>${extra}</div>`;
  };
  const histo = (h) => {
    if (!h) return '';
    const max = Math.max(...h, 0.01);
    return `<svg class="g-hist" viewBox="0 0 64 18" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" width="6" height="18" class="clip"/><rect x="58" y="0" width="6" height="18" class="clip"/>${h.map((v, k) => `<rect x="${k * 4}" y="${18 - (v / max) * 17}" width="3.2" height="${(v / max) * 17}"/>`).join('')}</svg>`;
  };
  const paintGauges = (ev) => {
    const qy = ev?.quality;
    const m = qy?.meters || {};
    const has = (g) => qy?.issues.filter((x) => GAUGE_OF[x.id] === g) || [];
    const stOf = (g) => { const l = has(g); return !qy || !ev.sample?.faces ? 'idle' : l.some((x) => x.level === 'block') ? 'bad' : l.length ? 'warn' : 'ok'; };
    const lightWord = !qy || !ev.sample?.faces ? '—' : m.lightZone === 'bright' ? 'Too bright' : m.lightZone === 'dark' ? (has('light').some((x) => x.id === 'backlit') ? 'Back-lit' : 'Too dark') : has('light').some((x) => x.id === 'uneven') ? 'One-sided' : 'Good';
    const word = (g, okW) => { const s2 = stOf(g); return s2 === 'idle' ? '—' : s2 === 'ok' ? okW : has(g)[0]?.id === 'blur' ? 'Blurry' : has(g)[0]?.id === 'shaky' ? 'Moving' : s2 === 'bad' ? 'Adjust' : 'Nearly'; };
    // Bad light hides detail, so clarity can't be judged until the light is fixed.
    const lightBlocks = has('light').some((x) => x.level === 'block');
    $('#gauges').innerHTML = [
      gauge('light', 'Light', m.light, stOf('light'), lightWord, histo(ev?.sample?.faceStats?.hist)),
      lightBlocks ? gauge('clarity', 'Clarity', m.clarity, 'warn', 'Low detail') : gauge('clarity', 'Clarity', m.clarity, stOf('clarity'), word('clarity', 'Sharp')),
      gauge('framing', 'Framing', m.framing, stOf('framing'), word('framing', 'Centred')),
      gauge('still', 'Stillness', m.still, stOf('still'), word('still', 'Steady')),
    ].join('');
  };

  // ---------- panel per step ----------
  const ring = (frac, txt) => {
    const R = 2 * Math.PI * 26;
    return `<div class="ring"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="26"/><circle class="fg" cx="32" cy="32" r="26" style="stroke-dasharray:${R.toFixed(1)};stroke-dashoffset:${(R * (1 - Math.min(1, frac))).toFixed(1)}"/></svg><span>${txt}</span></div>`;
  };
  const head = (n, title, body) => `<div class="eyebrow hl">Step ${st.i + 1} of ${steps.length} · ${STEP_META[n].short}</div><h1>${title}</h1>${body ? `<p class="lead">${body}</p>` : ''}`;

  const drawPanel = () => {
    const id = stepId();
    paintSteps();
    if (id === 'frame') {
      panel.innerHTML = `${head('frame', 'Light and framing', 'Your expressions are the whole analysis, so the picture has to be clear. Fit your face in the oval with soft light in front of you.')}
        <div class="fixbox" id="fixbox"><div class="fix-t" id="fixt">Looking for your face…</div><div class="fix-d" id="fixd"></div></div>
        <ul class="tips">
          <li>${icon('sun', { size: 15 })}<span><b>Light in front, not behind.</b> A window or lamp facing you. Never a bright window at your back.</span></li>
          <li>${icon('eye', { size: 15 })}<span><b>Whole face visible.</b> No cap, no hand on your chin. Glasses are fine.</span></li>
          <li>${icon('monitor', { size: 15 })}<span><b>Camera at eye level</b>, about an arm’s length away.</span></li>
        </ul>
        <div class="hold" id="hold">${ring(0, '')}<span class="small muted" id="holdtxt">Hold good light for ${QUALITY.holdMs / 1000} seconds to continue.</span></div>`;
    } else if (id === 'neutral') {
      panel.innerHTML = `${head('neutral', 'Your calm face', 'Relax and read this line slowly, the way you read a question. This is the face everything is measured against, so don’t pose.')}
        <blockquote class="calm-line">${esc(st.line)}</blockquote>
        <div class="task">${faceArt('calm')}<div>${ring(0, '')}<p class="small muted" id="tasktxt">Recording only while the picture stays good.</p></div></div>`;
    } else if (id === 'frown') {
      panel.innerHTML = `${head('frown', 'Now frown, as if a question has you stuck', 'Pull your eyebrows down and together and hold it. This teaches us how strong your own frown is, so a small furrow on your face is read at its true size.')}
        <div class="task">${faceArt('frown')}<div>${ring(0, '')}<div class="meter"><span>Brow</span><i><b id="mbar"></b></i></div><p class="small muted" id="tasktxt">Hold it for ${C.frownSec} seconds.</p></div></div>`;
    } else if (id === 'press') {
      panel.innerHTML = `${head('press', 'Press your lips together', 'Firmly, as people do when they’re concentrating hard. Hold it.')}
        <div class="task">${faceArt('press')}<div>${ring(0, '')}<div class="meter"><span>Lips</span><i><b id="mbar"></b></i></div><p class="small muted" id="tasktxt">Hold it for ${C.pressSec} seconds.</p></div></div>`;
    } else if (id === 'corners') {
      panel.innerHTML = `${head('corners', 'Look at the dots', 'Five dots will appear on your screen, one at a time. Look at each one, moving your eyes and head naturally. This maps where your screen is, so glancing at a corner is never mistaken for looking away.')}
        <button class="btn primary lg" id="gocorners">${icon('target', { size: 16 })} Show the dots</button>`;
    } else if (id === 'paper') {
      panel.innerHTML = `${head('paper', 'Look down at your rough sheet', 'As if you were working out an answer on paper. Rough work is normal in these exams, so we learn what it looks like for you and never count it as looking away.')}
        <div class="task">${faceArt('down')}<div>${ring(0, '')}<p class="small muted" id="tasktxt">Hold for ${C.paperSec} seconds, then look back up.</p></div></div>`;
    } else if (id === 'done') {
      panel.innerHTML = doneHTML();
    } else if (id === 'checks') {
      panel.innerHTML = `${head('checks', s ? 'Room check' : 'Checks', `Last checks before ${esc(s?.templateName || 'the test')}. Sit as you will for the whole paper.`)}
        <ul class="cc-list" id="clist"></ul>
        <div class="settle" id="settle">${ring(0, '')}<div><b>Settling in</b><p class="small muted mb0" id="settletxt">Relax for ${C.settleSec} seconds. This sets today’s calm baseline, because light and posture change day to day.</p></div></div>
        <div class="pc-actions"><button class="btn primary lg" id="begin" disabled>${icon('play', { size: 16 })} Begin the test</button><span class="small muted" id="beginhint">Waiting for the checks…</span></div>
        <div class="row mt" id="alt"></div>`;
    }
  };

  const doneHTML = () => {
    const r = st.result;
    const gain = (c) => (r.range?.gain?.[c] != null ? `+${Math.round(r.range.gain[c] * 100)}` : '—');
    return `<div class="eyebrow hl">Calibration complete</div><h1>We’ve learned your face</h1>
      <div class="done-card">
        ${p.face?.thumb || st.identity?.thumb ? `<img class="done-photo" src="${st.identity?.thumb || p.face.thumb}" alt="Your admit-card photo">` : ''}
        <div class="summary-list">
          <div><span>Light and framing</span><b>${r.lightScore}/100</b></div>
          <div><span>Calm face</span><b>${plural(r.neutral.n, 'frame')}</b></div>
          <div><span>Your frown range</span><b>${r.range?.ok?.brow ? `brow ${gain('brow')}` : 'not clear: a safe default is used'}</b></div>
          <div><span>Lip press range</span><b>${r.range?.ok?.press ? `lips ${gain('press')}` : 'not clear: a safe default is used'}</b></div>
          <div><span>Screen mapped</span><b>${r.screen ? `${Math.round(r.screen.yaw[1] - r.screen.yaw[0])}° wide · ${Math.round(r.screen.pitch[1] - r.screen.pitch[0])}° tall` : 'not enough frames'}</b></div>
          <div><span>Writing posture</span><b>${r.paper?.hidesFace ? 'face leaves the frame: treated as writing' : 'face stays visible'}</b></div>
          <div><span>Identity</span><b>${st.identity?.descriptors?.length ? `${st.identity.descriptors.length} face signatures` : 'photo only (model offline)'}</b></div>
        </div>
      </div>
      <span class="stamp good big in">Calibrated</span>
      <div class="pc-actions"><a class="btn primary lg" href="${next}" id="finish">${icon('check', { size: 16 })} Continue</a><button class="btn ghost" id="redo">Start over</button></div>`;
  };

  // ---------- frame processing ----------
  let ps = null;
  const startCamera = () => {
    ps?.stop({ camera: false });
    ps = new ProctorSession({ mode: s ? 'room' : 'calibrate', enrolled: enrolled(), fullscreen: !!s?.fullscreen, wantObjects: !!s, wantIdentity: true });
    ps.subscribe(onEv);
    ps.start().then((ok) => { if (ok) ps.attach(video); });
  };

  const setCap = (cls, txt) => { const c = $('#cap'); c.className = `admit-caption ${cls}`; $('#captxt').textContent = txt; };
  const setOval = (cls) => { $('#oval').setAttribute('class', `oval ${cls}`); };
  const ringSet = (sel, frac) => {
    const el = root.querySelector(`${sel} .ring .fg`);
    if (!el) return;
    const R = 2 * Math.PI * 26;
    el.style.strokeDashoffset = (R * (1 - Math.min(1, frac))).toFixed(1);
  };

  function onEv(ev) {
    st.ev = ev;
    const now = performance.now();
    const dt = Math.min(250, now - st.lastT);
    st.lastT = now;
    const camErr = ev.cam.state === 'error';
    const off = $('#camoff');
    off.hidden = !camErr;
    if (camErr) {
      off.innerHTML = `<div>${icon('camera', { size: 30 })}<p><b>The camera is needed</b></p><p class="small">${esc(cameraErrorText(ev.cam.error))}</p><button class="btn sm hl" id="retry">Try again</button></div>`;
      setCap('bad', 'Camera unavailable');
      if (stepId() === 'checks') { const b = $('#begin'); if (b) b.disabled = true; }
      return;
    }
    paintGauges(ev);
    const smp = ev.sample;
    const qy = ev.quality;
    const good = qy && qy.verdict !== 'poor' && smp?.faces === 1;
    const id = stepId();
    if (id !== 'corners' && id !== 'paper') {
      setOval(!smp ? '' : good ? 'ok' : 'bad');
      if (!smp) setCap('', ev.cam.state === 'running' ? 'Looking for your face…' : 'Starting the camera…');
      else if (!good) setCap('bad', qy?.first?.text || ev.guidance || 'Adjust');
      else if (qy.verdict === 'fair') setCap('warn', `${qy.first.text} (OK to continue)`);
      else setCap('ok', 'Good. Expressions readable.');
    }

    if (id === 'frame') {
      const fx = $('#fixt');
      if (fx) {
        fx.textContent = !smp ? 'Looking for your face…' : good ? (qy.verdict === 'fair' ? qy.first.text : 'Good light, clear face') : qy?.first?.text || 'Adjust';
        $('#fixd').textContent = !smp ? '' : good ? (qy.verdict === 'fair' ? `${qy.first.fix} You can still continue.` : 'Hold still a moment…') : qy?.first?.fix || '';
        $('#fixbox').className = `fixbox ${!smp ? '' : good ? (qy.verdict === 'fair' ? 'warn' : 'ok') : 'bad'}`;
      }
      const frac = Math.min(1, ev.goodMs / QUALITY.holdMs);
      ringSet('#hold', frac);
      if (ev.goodMs >= QUALITY.holdMs) { st.lightScore = qy.score; stampPhoto('Light OK'); advance(); }
      return;
    }
    if (id === 'neutral') {
      if (good) { st.goodMs += dt; st.neutral.push(frameOf(smp)); }
      const frac = st.goodMs / (C.neutralSec * 1000);
      ringSet('.task', frac);
      const t = $('#tasktxt');
      if (t) t.textContent = good ? `${Math.max(0, Math.ceil(C.neutralSec - st.goodMs / 1000))} s…` : `Paused: ${qy?.first?.text?.toLowerCase() || 'face not clear'}`;
      if (!st.identity && !st.identityBusy && st.goodMs > 1500 && good) captureIdentity();
      if (frac >= 1 && (st.identity || !st.identityBusy)) { st.neutralStats = neutralFrom(st.neutral, ps.fps); advance(); }
      return;
    }
    if (id === 'frown' || id === 'press') {
      const comp = id === 'frown' ? 'brow' : 'press';
      const base = st.neutralStats || neutralFrom(st.neutral, ps.fps);
      const gain = good && smp.comp && base ? smp.comp[comp] - base.mean[comp] : 0;
      const need = EXPRESSION.rangeMinGain[comp];
      const bar = $('#mbar');
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, (gain / (need * 6)) * 100))}%`;
      if (good) (id === 'frown' ? st.frown : st.press).push(frameOf(smp));
      if (good && gain >= need) st.goodMs += dt;
      const secs = id === 'frown' ? C.frownSec : C.pressSec;
      ringSet('.task', st.goodMs / (secs * 1000));
      const t = $('#tasktxt');
      const waited = (now - st.stepAt) / 1000;
      if (t) t.textContent = !good ? `Paused: ${qy?.first?.text?.toLowerCase() || 'face not clear'}` : gain >= need ? `Hold it… ${Math.max(0, Math.ceil(secs - st.goodMs / 1000))} s` : waited > 7 ? (id === 'frown' ? 'A little stronger: eyebrows down and together.' : 'A little firmer: lips pressed tight.') : `Hold it for ${secs} seconds.`;
      if (st.goodMs >= secs * 1000 || waited > 16) advance();
      return;
    }
    if (id === 'corners') { cornerFrame(smp, now); return; }
    if (id === 'paper') {
      st.paperTotal++;
      if (smp?.faces) st.paper.push(frameOf(smp));
      st.goodMs += dt;
      ringSet('.task', st.goodMs / (C.paperSec * 1000));
      setOval(smp?.faces ? 'ok' : '');
      setCap(smp?.faces ? 'ok' : 'warn', smp?.faces ? 'Writing posture: face visible' : 'Face out of view: that’s fine for writing');
      if (st.goodMs >= C.paperSec * 1000) finishCalibration();
      return;
    }
    if (id === 'checks') { checksFrame(ev, good, dt); }
  }

  const frameOf = (smp) => ({ comp: smp.comp, yaw: smp.yaw, pitch: smp.pitch, roll: smp.roll, lookDown: smp.lookDown, sideways: smp.sideways, blink: smp.blink, motion: smp.motion, faces: smp.faces });

  const captureIdentity = async () => {
    st.identityBusy = true;
    try { st.identity = await ps.captureIdentity(st.ev?.sample?.box); } catch (e) { console.warn(e); st.identity = { descriptors: [], thumb: faceLayer.snapshot({ size: 160, box: st.ev?.sample?.box }) }; }
    st.identityBusy = false;
  };

  const stampPhoto = (txt) => {
    const el = $('#pstamp');
    el.innerHTML = `<span class="stamp good in">${esc(txt)}</span>`;
    clearTimeout(stampPhoto.t);
    stampPhoto.t = setTimeout(() => { el.innerHTML = ''; }, 1600);
  };

  // ---------- screen corners ----------
  const cornerStage = $('#corners');
  const showCorner = () => {
    const c = CORNERS[st.cornerIdx];
    cornerStage.innerHTML = `<div class="cs-dot" style="left:${c.x}%;top:${c.y}%"><i></i></div>
      <div class="cs-mid"><div class="cs-cam"><video id="csv" muted playsinline></video></div><b>Look at the dot</b><span class="small">${st.cornerIdx + 1} of ${CORNERS.length} · ${c.label}</span><span class="small cs-warn" id="cswarn"></span></div>`;
    faceLayer.attachPreview(cornerStage.querySelector('#csv'));
    st.cornerAt = performance.now();
  };
  const cornerFrame = (smp, now) => {
    if (cornerStage.hidden) return;
    const since = now - st.cornerAt;
    const w = cornerStage.querySelector('#cswarn');
    if (w) w.textContent = smp?.faces ? '' : 'We lost your face. Turn your eyes more than your head.';
    if (since > 450 && smp?.faces === 1) st.corners[st.cornerIdx].frames.push(frameOf(smp));
    if (since >= 450 + C.cornerSec * 1000) {
      st.cornerIdx++;
      if (st.cornerIdx >= CORNERS.length) { cornerStage.hidden = true; document.body.classList.remove('room-corners'); advance(); }
      else showCorner();
    }
  };

  // ---------- finish calibration ----------
  const finishCalibration = () => {
    const neutral = st.neutralStats || neutralFrom(st.neutral, ps.fps);
    const range = rangeFrom(neutral, st.frown, st.press);
    const screen = screenFrom(st.corners);
    const paper = paperFrom(st.paper, st.paperTotal);
    const fs = st.neutral.length ? st.ev?.sample?.faceStats : null;
    const calib = buildCalibration({ neutral, range, screen, paper, lighting: fs ? { faceMean: fs.mean, faceSd: fs.sd } : null, quality: st.lightScore ?? null });
    st.result = { neutral, range, screen, paper, lightScore: st.lightScore ?? '—' };
    const patch = { calibration: calib };
    if (st.identity) patch.face = { at: Date.now(), descriptors: st.identity.descriptors || [], thumb: st.identity.thumb || null, model: st.identity.model || null };
    store.updateProfile(patch);
    st.saved = true;
    if (ps) ps.enrolled = enrolled();
    toast('Calibration saved on this device');
    advance();
  };

  // ---------- room checks (before a test) ----------
  const checksFrame = (ev, good, dt) => {
    const list = $('#clist');
    if (!list) return;
    const rows = ev.checks.filter((c) => c.id !== 'camera');
    const html = rows.map((c) => `<li class="${c.state}" data-check="${c.id}"><span class="cc-ic">${c.state === 'ok' ? icon('check', { size: 14 }) : c.state === 'bad' ? icon('x', { size: 14 }) : c.state === 'warn' ? '!' : c.state === 'skip' ? '<i class="dash"></i>' : '<i class="spin"></i>'}</span><div class="cc-txt"><b>${esc(c.label)}</b><span class="cc-d">${esc(c.detail)}${c.state === 'bad' && c.fix ? ` <em>${esc(c.fix)}</em>` : ''}</span></div>${c.id === 'mic' && c.state === 'skip' && /allow/i.test(c.detail) ? '<button class="btn sm cc-act" data-mic>Allow</button>' : ''}</li>`).join('');
    if (list.dataset.h !== html) { list.innerHTML = html; list.dataset.h = html; }
    // Today's calm baseline: good frames only.
    if (good && st.settleMs < C.settleSec * 1000) { st.settleMs += dt; st.settle.push(frameOf(ev.sample)); }
    ringSet('#settle', st.settleMs / (C.settleSec * 1000));
    const settled = st.settleMs >= C.settleSec * 1000;
    const stt = $('#settletxt');
    if (stt) stt.textContent = settled ? 'Baseline set for this sitting.' : good ? `Relax… ${Math.max(0, Math.ceil(C.settleSec - st.settleMs / 1000))} s` : 'Paused until the picture is good again.';
    const idc = ev.checks.find((c) => c.id === 'identity');
    if (idc?.state === 'bad') st.mismatchSince ??= performance.now(); else st.mismatchSince = null;
    const othersOk = ev.checks.filter((c) => c.required && c.id !== 'identity' && !['skip', 'info'].includes(c.state)).every((c) => c.state === 'ok' || c.state === 'warn');
    const ready = (ev.ready || (st.override && idc?.state === 'bad' && othersOk)) && settled;
    const steady = ready && (st.override || ev.steadyMs >= PROCTOR.steadyMs);
    const b = $('#begin');
    if (b) b.disabled = !steady;
    const hint = $('#beginhint');
    if (hint) hint.textContent = steady ? 'All set. The clock starts on the next screen.' : !settled ? 'Settling your baseline…' : ev.guidance || 'Waiting for the checks…';
    const alt = $('#alt');
    const altH = idc?.state === 'bad' && othersOk && !st.override && st.mismatchSince && performance.now() - st.mismatchSince > 3000
      ? '<button class="btn" id="itsme">It’s me, continue</button><span class="small muted">Noted in the report.</span>' : '';
    if (alt && alt.dataset.h !== altH) { alt.innerHTML = altH; alt.dataset.h = altH; }
  };

  const begin = () => {
    const ev = st.ev;
    const settle = neutralFrom(st.settle, ps.fps);
    const calib = sessionCalibration(store.profile.calibration, settle);
    const idc = ev?.checks.find((c) => c.id === 'identity');
    s.face = { ...(s.face || {}), enabled: true, v: 2, calib, settle: settle ? { mean: settle.mean, sd: settle.sd, n: settle.n } : null };
    s.proctor = {
      ...(s.proctor || {}), enabled: true, enrolled: !!enrolled(),
      identityAtStart: !enrolled() ? 'not-enrolled' : st.override ? 'override' : ev?.identity?.verdict === 'match' ? 'match' : idc?.state === 'skip' ? 'skipped' : ev?.identity?.verdict || 'skipped',
      precheck: { at: Date.now(), checks: (ev?.checks || []).map((c) => ({ id: c.id, state: c.state, detail: c.detail })), mic: ps.micState === 'running', quality: ev?.quality?.score ?? null },
      flags: {}, overrides: st.override ? ['identity'] : [], snaps: [],
    };
    store.putSession(s, { immediate: true });
    ps.stop({ camera: false });
    ps = null;
    location.hash = `#/test/${sid}`;
  };

  // ---------- step transitions ----------
  const advance = () => {
    st.i = Math.min(steps.length - 1, st.i + 1);
    st.goodMs = 0;
    st.stepAt = performance.now();
    drawPanel();
    if (stepId() === 'checks' && ps) {
      // After a first-time calibration inside a test room, the new face signatures become the identity reference.
      ps.enrolled = enrolled();
      ps.idn = { verdict: null, distance: null, history: [], lastAt: 0, busy: false, misses: 0 };
    }
  };

  root.onclick = (e) => {
    if (e.target.closest('#retry')) { startCamera(); return; }
    if (e.target.closest('#gocorners')) {
      st.cornerIdx = 0;
      cornerStage.hidden = false;
      document.body.classList.add('room-corners');
      showCorner();
      return;
    }
    if (e.target.closest('#redo')) {
      Object.assign(st, { i: 0, neutral: [], frown: [], press: [], corners: CORNERS.map((c) => ({ id: c.id, frames: [] })), paper: [], paperTotal: 0, goodMs: 0, identity: null, result: null });
      drawPanel();
      return;
    }
    if (e.target.closest('[data-mic]')) { e.target.disabled = true; ps?.allowMic(); return; }
    if (e.target.closest('#itsme')) { st.override = true; toast('Noted. Continuing on your word.'); return; }
    if (e.target.closest('#begin') && !$('#begin').disabled) begin();
  };

  drawPanel();
  paintGauges(null);
  startCamera();

  return () => {
    document.body.classList.remove('room-corners');
    const toTest = location.hash.startsWith('#/test/');
    ps?.stop({ camera: !toTest });
  };
}

function rollNo(p) {
  const seed = String(p.id || p.name || 'x').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `EI-${new Date(p.createdAt || Date.now()).getFullYear()}-${String(seed % 100000).padStart(5, '0')}`;
}
