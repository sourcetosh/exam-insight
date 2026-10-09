// Test runner. JEE: NTA-style computer-based layout with a five-state palette.
// NEET: continuous paper booklet with an OMR sheet. Both log the same events,
// autosave on every action, and resume where they stopped (clock paused while closed).
import { store } from '../store.js';
import { QMAP } from '../engine/paper.js';
import { isAnswered } from '../engine/scoring.js';
import { pickReviewSet } from '../engine/review.js';
import { summaryOf } from '../engine/report.js';
import { faceLayer } from '../face/facelayer.js';
import { ProctorSession, FlagTracker } from '../face/proctor.js';
import { frameState, strainOf, scaledComponents, sessionCalibration, STATE_CHAR, COMPONENTS } from '../face/expression.js';
import { THRESHOLDS, DRILL, BANKS, PROCTOR, EXPRESSION } from '../config.js';
import { esc, fmtClock, toast, modal, OPTION_KEYS } from '../ui.js';
import { icon } from '../icons.js';

const BASIC_EVENTS = new Set(['start', 'end', 'enter', 'leave', 'save', 'clear', 'pause', 'resume']);

export function render(root, [sid]) {
  const s = store.session(sid);
  if (!s) { location.replace('#/'); return; }
  if (s.status === 'review') { location.replace(`#/review/${sid}`); return; }
  if (s.status === 'done') { location.replace(`#/report/${sid}`); return; }

  const p = store.profile;
  const full = s.analytics === 'full';
  const cbt = s.layout === 'cbt';
  const drill = s.kind === 'drill';
  const paceHint = !drill && !!store.prefs.paceHint;
  const Q = s.paper.map((x) => ({ ...x, q: QMAP.get(x.id) }));
  const proctorOn = !!(s.face.enabled && s.proctor?.enabled);

  // ---------- clock (test time, paused while the page is closed) ----------
  let base = s.elapsedMs || 0;
  let mark = null;
  const now = () => (mark == null ? base : base + (performance.now() - mark));
  const running = () => mark != null;
  const startClock = () => { if (mark == null) mark = performance.now(); };
  const stopClock = () => { if (mark != null) { base = now(); mark = null; } };
  const remaining = () => s.durationSec - now() / 1000;

  // ---------- persistence ----------
  let savedFlash = null;
  const persist = (immediate = false) => {
    s.elapsedMs = Math.round(now());
    s.lastSavedAt = Date.now();
    store.putSession(s, { immediate });
    const el = root.querySelector('#saved');
    if (el) {
      el.classList.add('pulse');
      clearTimeout(savedFlash);
      savedFlash = setTimeout(() => el.classList.remove('pulse'), 600);
      el.querySelector('.saved-txt').textContent = navigator.onLine ? 'Saved on device' : 'Offline · saved on device';
    }
  };
  const log = (type, data = {}) => {
    if (!full && !BASIC_EVENTS.has(type)) return;
    s.events.push({ t: Math.round(now()), type, ...data });
    persist();
  };

  // ---------- current question + visits ----------
  const curId = () => Q[s.cur]?.id ?? null;
  let idleFrom = null;
  let lastInput = 0;
  const flushIdle = () => {
    if (idleFrom != null) {
      const dur = Math.round(now() - idleFrom);
      if (dur >= THRESHOLDS.idleMinSec * 1000) log('idle', { q: curId(), dur });
      idleFrom = null;
    }
    lastInput = now();
  };
  const activity = () => { if (!running()) return; flushIdle(); };

  let visitOpen = false;
  let visitStart = 0;
  const enter = (idx) => {
    if (visitOpen && idx === s.cur) return;
    leave();
    s.cur = idx;
    s.responses[Q[idx].id].visited = true;
    visitOpen = true;
    lastInput = now();
    visitStart = now();
    log('enter', { q: Q[idx].id });
  };
  const leave = () => {
    if (!visitOpen) return;
    flushIdle();
    const id = curId();
    if (cbt && s.pending[id] !== undefined && String(s.pending[id]) !== String(s.responses[id].saved ?? '')) {
      toast(`Question ${s.cur + 1}: your choice wasn’t saved`);
    }
    delete s.pending[id];
    log('leave', { q: id });
    visitOpen = false;
  };

  // ---------- answering ----------
  const select = (v) => {
    const id = curId();
    const prev = s.pending[id] !== undefined ? s.pending[id] : s.responses[id].saved;
    if (String(prev ?? '') === String(v)) return;
    s.pending[id] = v;
    log('select', { q: id, v, prev: prev ?? null });
    if (!cbt) commitSave();
    else updateQ();
  };
  const commitSave = () => {
    const id = curId();
    const v = s.pending[id];
    if (v === undefined) return false;
    delete s.pending[id];
    if (!isAnswered(v)) return false;
    s.responses[id].saved = v;
    log('save', { q: id, v });
    return true;
  };
  const clearResponse = () => {
    const id = curId();
    const prev = s.pending[id] ?? s.responses[id].saved;
    delete s.pending[id];
    if (isAnswered(s.responses[id].saved) || isAnswered(prev)) {
      s.responses[id].saved = null;
      log('clear', { q: id, prev: prev ?? null });
    }
    refresh();
  };
  const setMark = (idx, on) => {
    const id = Q[idx].id;
    if (s.responses[id].marked === on) return;
    s.responses[id].marked = on;
    log('mark', { q: id, on });
  };

  // ---------- palette state ----------
  const stateOf = (id) => {
    const r = s.responses[id];
    const ans = isAnswered(r.saved);
    if (!r.visited) return 'notvisited';
    if (r.marked) return ans ? 'answeredmarked' : 'marked';
    return ans ? 'answered' : 'notanswered';
  };
  const counts = () => {
    const c = { notvisited: 0, notanswered: 0, answered: 0, marked: 0, answeredmarked: 0 };
    for (const x of Q) c[stateOf(x.id)]++;
    return c;
  };
  const secOf = (idx) => s.sections.findIndex((x) => idx >= x.start && idx < x.end);

  // ---------- face: the expression trace ----------
  // Every second of test time gets one state (reading, writing, away, face absent, picture too
  // poor, no camera data) and, while reading, a strain level against today's calm baseline.
  // Per question we also keep which facial actions carried the strain, blinks and head motion.
  let unsubFace = null;
  let fcalib = null;
  let liveState = null;
  let liveIssue = null;
  let liveAt = 0;
  let lastVisible = { state: null, at: -1e9 };
  let poorSince = null;
  let bucket = null;
  const blankComp = () => Object.fromEntries(COMPONENTS.map((c) => [c, 0]));
  if (s.face.enabled) {
    s.face.v = 2;
    fcalib = s.face.calib || sessionCalibration(p.calibration, null);
    s.face.calib ||= fcalib;
    s.face.trace ||= { hz: 1, s: '', v: [] };
    s.face.perQ ||= {};
    s.face.quality ||= { frames: 0, good: 0, fair: 0, poor: 0, none: 0, reasons: {} };
  }
  const pushSec = (ch, val) => { s.face.trace.s += ch; s.face.trace.v.push(val); };
  const fillTo = (sec) => { while (s.face.trace.s.length < sec) pushSec(STATE_CHAR.none, -1); };
  const PRIORITY = ['reading', 'writing', 'away', 'poor', 'absent'];
  const finalize = (b) => {
    if (!b || !s.face.trace) return;
    fillTo(b.sec);
    if (s.face.trace.s.length !== b.sec) return;
    let best = null, bestN = -1;
    for (const k of PRIORITY) if ((b.counts[k] || 0) > bestN) { best = k; bestN = b.counts[k] || 0; }
    pushSec(STATE_CHAR[best] || STATE_CHAR.none, b.n ? Math.round((b.sum / b.n) * 100) : -1);
  };
  const flushTrace = () => {
    if (!s.face.enabled || !s.face.trace) return;
    finalize(bucket);
    bucket = null;
    fillTo(Math.floor(now() / 1000));
  };
  if (s.face.enabled) {
    unsubFace = faceLayer.subscribe((ev) => {
      if (ev.type === 'stopped') { if (faceLayer.state === 'error' && running() && !ending) cameraLost(); return; }
      if (ev.type !== 'sample' || !running() || document.hidden) return;
      const t = now();
      const sec = Math.floor(t / 1000);
      const q = ev.quality;
      let state = frameState(ev, q, fcalib);
      if (state !== 'absent' && state !== 'poor') lastVisible = { state, at: t };
      // Rough work can take the face out of the camera's view; that's writing, not absence.
      const grace = (fcalib?.paper?.hidesFace ? EXPRESSION.writing.hiddenMaxSec : 6) * 1000;
      if (state === 'absent' && lastVisible.state === 'writing' && t - lastVisible.at < grace) state = 'writing';
      liveState = state;
      liveIssue = state === 'poor' ? q?.blocks?.[0] || null : null;
      liveAt = performance.now();
      if (state === 'poor' || state === 'absent') poorSince ??= t; else poorSince = null;

      const strain = state === 'reading' ? strainOf(ev.comp, fcalib) : null;
      if (!bucket || bucket.sec !== sec) { finalize(bucket); bucket = { sec, counts: {}, sum: 0, n: 0 }; }
      bucket.counts[state] = (bucket.counts[state] || 0) + 1;
      if (strain != null) { bucket.sum += strain; bucket.n++; }

      const fq = s.face.quality;
      fq.frames++;
      fq[q?.verdict || 'none'] = (fq[q?.verdict || 'none'] || 0) + 1;
      for (const b of q?.blocks || []) fq.reasons[b.id] = (fq.reasons[b.id] || 0) + 1;

      const id = visitOpen ? curId() : null;
      if (!id) return;
      const f = (s.face.perQ[id] ||= { n: 0, read: 0, comp: blankComp(), blinks: 0, motion: 0 });
      f.n++;
      if (state === 'reading') {
        f.read++;
        const sc = scaledComponents(ev.comp, fcalib);
        if (sc) for (const c of COMPONENTS) f.comp[c] += sc[c];
        if (ev.blink) f.blinks++;
        f.motion += ev.motion || 0;
      }
    });
  }

  // Camera lost mid-test: pause, and let the student reconnect or carry on without analysis.
  let lostOpen = false;
  const cameraLost = async () => {
    if (lostOpen) return;
    lostOpen = true;
    flushTrace();
    stopClock();
    log('pause', { reason: 'camera' });
    persist(true);
    const again = await modal({
      title: 'The camera stopped',
      body: '<p class="muted">The clock is paused. Your answers are saved. Reconnect the camera to keep the behaviour analysis going, or continue without it: the minutes without the camera are marked as a gap in your report.</p>',
      buttons: [{ label: 'Continue without camera', value: false }, { label: 'Reconnect camera', value: true, cls: 'primary' }],
      dismissValue: true,
    });
    lostOpen = false;
    if (again) {
      try { await faceLayer.start({ fps: 5 }); faceLayer.attachPreview(root.querySelector('#camv')); } catch { toast('Still no camera. Continuing without it.'); }
    }
    startClock();
    log('resume', { reason: 'camera' });
    refresh();
  };

  // ---------- proctoring ----------
  // Conditions from the camera are turned into flags on the test clock: each must hold for a
  // moment before it is logged (so a glance or a passing shadow does not count), and the
  // student sees the same wording that lands in the report. Nothing is recorded.
  let proctor = null;
  let tracker = null;
  let lastPro = null;
  let lastProAt = 0;
  const openFlags = new Map();
  const flagLabel = (code) => PROCTOR.flags[code]?.label || code;
  // The camera pill shows what the face layer sees right now, in plain words. A proctoring flag
  // takes over the pill and the banner; a long unreadable stretch gets its own quiet banner.
  const SIG = {
    reading: ['ok', 'Reading your face'], writing: ['ink', 'Writing'], away: ['warn', 'Looking away'],
    absent: ['bad', 'Can’t see you'], poor: ['bad', 'Can’t read your face'],
  };
  const paintProctor = () => {
    const open = tracker?.open || [];
    const ban = root.querySelector('#proban');
    if (ban) { ban.classList.toggle('hidden', !open.length); ban.querySelector('.pro-ban-txt').textContent = open.map(flagLabel).join(' · '); }
    const pill = root.querySelector('#sigpill');
    if (pill) {
      const fresh = liveAt && performance.now() - liveAt < 3000;
      const [cls, txt] = open.length ? ['bad', flagLabel(open[0])] : fresh && liveState ? SIG[liveState] || ['', 'Camera on'] : ['', 'Camera starting…'];
      pill.className = `status-pill sig ${cls}`;
      pill.querySelector('.sig-txt').textContent = txt;
    }
    const sb = root.querySelector('#sigban');
    if (sb) {
      const long = poorSince != null && now() - poorSince > 8000 && (liveState === 'poor' || liveState === 'absent');
      sb.classList.toggle('hidden', !long || open.length > 0);
      if (long) sb.querySelector('.sig-ban-txt').textContent = liveIssue ? `${liveIssue.text}. ${liveIssue.fix}` : 'We can’t see your face. Sit back in front of the camera.';
    }
  };
  const applyFlags = () => {
    if (s.face.enabled) paintProctor();
    if (!tracker || !lastPro || !running() || document.hidden) return;
    const t = now();
    const ev = lastPro;
    const camOk = ev.cam.state === 'running';
    const stale = camOk && performance.now() - lastProAt > 3000; // frames stopped arriving
    const live = camOk && !stale && liveAt && performance.now() - liveAt < 3000;
    const smp = ev.sample;
    const freshObj = ev.objects && performance.now() - ev.objects.at < 5000 ? ev.objects : null;
    tracker.update('camera_lost', ev.cam.state === 'error' || stale, t);
    tracker.update('no_face', live && liveState === 'absent', t);
    tracker.update('multi_face', live && !!smp && (smp.faces >= 2 || freshObj?.persons >= 2), t);
    tracker.update('look_away', live && liveState === 'away', t);
    tracker.update('phone', live && !!freshObj && freshObj.phone > 0, t);
    tracker.update('identity', live && ev.identity?.verdict === 'mismatch', t);
    tracker.update('noise', live && !!ev.checks?.some((c) => c.id === 'mic' && c.state === 'bad'), t);
  };
  const startProctor = () => {
    if (!proctorOn || proctor) return;
    s.proctor.flags ||= {};
    s.proctor.snaps ||= [];
    tracker = new FlagTracker(PROCTOR.flags, {
      onOpen: (code, t) => {
        const ev = { t: Math.round(t), type: 'proctor', code, q: curId() };
        s.events.push(ev);
        openFlags.set(code, ev);
        const f = (s.proctor.flags[code] ||= { n: 0, ms: 0 });
        f.n++;
        // With the student's consent, one small photo per flag for their mentor to judge.
        if (p.consent?.snapshots === true && s.proctor.snaps.length < 12 && code !== 'camera_lost' && code !== 'noise') {
          const img = faceLayer.snapshotFrame();
          if (img) { s.proctor.snaps.push({ t: Math.round(t), code, q: curId(), img }); ev.snap = s.proctor.snaps.length - 1; }
        }
        persist();
        toast(`${flagLabel(code)}: noted in your report`);
        paintProctor();
      },
      onClose: (code, t, dur) => {
        const ev = openFlags.get(code);
        if (ev) ev.dur = Math.round(dur);
        openFlags.delete(code);
        const f = (s.proctor.flags[code] ||= { n: 0, ms: 0 });
        f.ms += Math.round(dur);
        persist();
        paintProctor();
      },
    });
    proctor = new ProctorSession({ mode: 'test', enrolled: p.face?.descriptors?.length ? p.face.descriptors : null, fullscreen: s.fullscreen });
    proctor.subscribe((ev) => { lastPro = ev; lastProAt = performance.now(); });
    proctor.start().then((ok) => {
      if (ok) proctor.attach(root.querySelector('#camv'));
      else { s.proctor.cameraLost = true; persist(); cameraLost(); }
    }).catch(() => {});
  };

  // ---------- layout ----------
  const camPill = () => (s.face.enabled
    ? `<div class="cam-mini ${camHidden ? 'hidden-feed' : ''}" title="Camera on. Processed on this device."><video id="camv" muted playsinline></video><span class="cam-label">● on-device</span></div>`
    : '');
  let camHidden = false;

  const bar = () => `<header class="run-bar">
      <div class="title">${esc(s.templateName)}<small>${drill ? `${DRILL.modes[s.drill.mode]?.label || 'Normal'} drill · ` : ''}${esc(p.name || 'Student')} · ${s.paper.length} questions · ${BANKS[s.bank || 'standard'].short}${s.simulated ? ' · sample' : ''}</small></div>
      <div class="spacer"></div>
      ${paceHint ? '<span class="status-pill pace" id="pace" data-tip="Pace hint (not in the real exam): answers saved against an even pace across the allowed time.">On pace</span>' : ''}
      <span class="status-pill on" id="saved" data-tip="Every action is written to this device immediately. If you lose connection or close the tab, the test resumes here."><span class="dot"></span><span class="saved-txt">Saved on device</span></span>
      ${s.face.enabled ? `<button class="status-pill sig" id="sigpill" data-tip="What the camera sees right now. Your expressions are read on this device, second by second, and only numbers are kept. Click to ${camHidden ? 'show' : 'hide'} your preview."><span class="dot"></span><span class="sig-txt">Camera starting…</span></button>` : ''}
      ${camPill()}
      <div class="timer" id="timer" aria-live="off" aria-label="Time left">${fmtClock(remaining())}</div>
      <button class="btn primary" id="submit">Submit</button>
    </header>
    <div class="fs-banner hidden" id="fsban"><span>You left full screen. It has been noted in your log.</span><button class="btn sm" id="refs">Return to full screen</button></div>
    ${s.face.enabled ? `<div class="fs-banner sig-banner hidden" id="sigban">${icon('camera', { size: 16 })}<span class="sig-ban-txt"></span><em class="small">This stretch will show as a gap in your behaviour map</em></div>` : ''}
    ${proctorOn ? `<div class="fs-banner pro-banner hidden" id="proban">${icon('alert', { size: 16 })}<span class="pro-ban-txt"></span><em class="small">Noted in your report</em></div>` : ''}`;

  // ---------- CBT ----------
  const cbtBody = () => {
    const x = Q[s.cur];
    const q = x.q;
    const id = x.id;
    const shown = s.pending[id] !== undefined ? s.pending[id] : s.responses[id].saved;
    const unsaved = s.pending[id] !== undefined && String(s.pending[id]) !== String(s.responses[id].saved ?? '');
    const mk = s.marking[q.type] || s.marking.mcq;
    const si = secOf(s.cur);
    const tabs = s.sections.map((sec, i) => {
      const done = Q.slice(sec.start, sec.end).filter((z) => isAnswered(s.responses[z.id].saved)).length;
      return `<button class="sec-tab ${i === si ? 'on' : ''}" data-sec="${i}">${esc(sec.name)} <span class="sec-count">${done}/${sec.end - sec.start}</span></button>`;
    }).join('');
    const answerUI = q.type === 'mcq'
      ? `<div class="opts" role="radiogroup" aria-label="Options">${q.options.map((o, i) => `<button class="opt ${String(shown) === String(i) ? 'sel' : ''}" data-opt="${i}" role="radio" aria-checked="${String(shown) === String(i)}"><span class="key">${OPTION_KEYS[i]}</span><span>${o}</span></button>`).join('')}</div>`
      : `<div class="nv-input"><input id="nv" type="text" inputmode="decimal" autocomplete="off" placeholder="Type your answer" value="${esc(shown ?? '')}" aria-label="Numerical answer"></div>
         <p class="small muted" style="margin-top:8px">Enter a number. Press <kbd>Enter</kbd> to save and go to the next question.</p>`;
    return `<div class="cbt">
      <section class="cbt-main">
        <div class="sec-tabs" role="tablist">${tabs}</div>
        <article class="q-card" aria-labelledby="qn">
          <div class="q-head">
            <div class="row" style="gap:12px"><span class="qn" id="qn">Question ${s.cur + 1}</span>
              <span class="chip">${q.type === 'mcq' ? 'Single correct' : 'Numerical value'}</span></div>
            <div class="row small muted" style="gap:10px"><span class="good-t">+${mk.correct}</span><span class="bad-t">${mk.wrong}</span>
              ${s.responses[id].marked ? '<span class="chip violet">Marked for review</span>' : ''}</div>
          </div>
          ${drill ? `<div class="qtimer" id="qtimer" data-tip="Target time for this question in ${DRILL.modes[s.drill.mode]?.label.toLowerCase() || 'normal'} mode. The bar fills as you go."><div class="qt-bar"><i id="qtfill"></i></div><span id="qtlabel" class="small mono">0:00 / ${fmtClock(x.expectedSec * s.drill.mult)}</span></div>` : ''}
          <div class="q-text">${q.text}</div>
          ${answerUI}
        </article>
        <div class="q-actions">
          <button class="btn mark" id="marknext" data-tip="Shortcut: M">Mark for Review &amp; Next</button>
          <button class="btn" id="clear" data-tip="Shortcut: C">Clear Response</button>
          <span class="unsaved ${unsaved ? '' : 'hidden'}" id="unsaved">● Not saved yet</span>
          <div class="spacer"></div>
          <button class="btn" id="prev" ${s.cur === 0 ? 'disabled' : ''} data-tip="Shortcut: ←">← Back</button>
          <button class="btn save" id="savenext" data-tip="Shortcut: S">Save &amp; Next →</button>
        </div>
      </section>
      <aside class="cbt-side" aria-label="Question palette">${paletteHTML()}</aside>
    </div>`;
  };

  const paletteHTML = () => {
    const c = counts();
    const legend = [
      ['notvisited', 'Not visited'], ['notanswered', 'Not answered'], ['answered', 'Answered'],
      ['marked', 'Marked for review'], ['answeredmarked', 'Answered &amp; marked'],
    ].map(([k, l]) => `<span><i class="pal-ico s-${k}"></i><b class="num">${c[k]}</b> ${l}</span>`).join('');
    const grids = s.sections.map((sec) => `<div class="sec-label">${esc(sec.name)}</div><div class="pal-grid">${Q.slice(sec.start, sec.end).map((x, k) => {
      const i = sec.start + k;
      return `<button class="pal s-${stateOf(x.id)} ${i === s.cur ? 'cur' : ''}" data-go="${i}" aria-label="Question ${i + 1}, ${stateOf(x.id)}">${i + 1}</button>`;
    }).join('')}</div>`).join('');
    return `<div class="legend">${legend}</div><div>${grids}</div>
      <p class="small faint" style="margin-top:auto">Answered-and-marked questions are evaluated. Marked-only are not.</p>`;
  };

  const updateQ = () => {
    // Light update for selection without re-rendering the whole screen.
    const id = curId();
    const shown = s.pending[id] !== undefined ? s.pending[id] : s.responses[id].saved;
    root.querySelectorAll('.opt').forEach((b) => {
      const on = String(shown) === b.dataset.opt;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-checked', on);
    });
    const un = root.querySelector('#unsaved');
    if (un) un.classList.toggle('hidden', !(s.pending[id] !== undefined && String(s.pending[id]) !== String(s.responses[id].saved ?? '')));
  };

  // ---------- OMR ----------
  let omrOpen = false; // phones: show only the active row unless expanded
  const omrBody = () => {
    const booklet = s.sections.map((sec) => `<h2 class="sec">${esc(sec.name)}</h2>${Q.slice(sec.start, sec.end).map((x, k) => {
      const i = sec.start + k;
      return `<div class="pq ${i === s.cur ? 'active' : ''}" id="pq${i}" data-i="${i}">
        <div class="pn"><button class="${s.responses[x.id].marked ? 'circled' : ''}" data-circle="${i}" aria-label="Circle question ${i + 1} for review" data-tip="Circle for review">${i + 1}.</button></div>
        <div><div class="ptext">${x.q.text}</div>
        <ol class="popts">${x.q.options.map((o, j) => `<li><b>(${j + 1})</b><span>${o}</span></li>`).join('')}</ol></div></div>`;
    }).join('')}`).join('');
    const answered = Q.filter((x) => isAnswered(s.responses[x.id].saved)).length;
    const sheet = s.sections.map((sec) => `<div class="omr-sec">${esc(sec.name)}</div>${Q.slice(sec.start, sec.end).map((x, k) => omrRow(x, sec.start + k)).join('')}`).join('');
    return `<div class="paper-wrap">
      <div class="booklet" id="booklet"><div class="booklet-inner">
        <div class="booklet-cover"><b>${esc(s.templateName)}</b><span>Read each question here. Mark your answers on the OMR sheet.</span></div>
        ${booklet}
        <div class="booklet-end">End of booklet. Check your OMR sheet, then submit.</div>
      </div></div>
      <aside class="omr ${omrOpen ? '' : 'collapsed'}" aria-label="OMR answer sheet">
        <div class="omr-head"><div class="row between"><b>OMR answer sheet</b><span class="row" style="gap:8px"><span class="small muted"><b id="omrcount">${answered}</b> / ${Q.length}</span><button class="btn sm omr-toggle" id="omrtoggle" aria-expanded="${omrOpen}">${omrOpen ? 'Collapse' : 'Full sheet'}</button></span></div>
          <p class="small faint mb0">Keys <kbd>1</kbd>–<kbd>4</kbd> fill the highlighted row.</p></div>
        <div class="omr-body" id="omrbody">${sheet}</div>
      </aside>
    </div>`;
  };
  const omrRow = (x, i) => {
    const v = s.responses[x.id].saved;
    return `<div class="omr-row ${i === s.cur ? 'active' : ''}" id="or${i}">
      <button class="on" data-scroll="${i}" aria-label="Go to question ${i + 1}">${i + 1}</button>
      ${[0, 1, 2, 3].map((j) => `<button class="bubble ${String(v) === String(j) ? 'filled' : ''}" data-bub="${i}:${j}" aria-label="Question ${i + 1}, option ${j + 1}" aria-pressed="${String(v) === String(j)}">${j + 1}</button>`).join('')}
    </div>`;
  };
  const refreshOmrRow = (i) => {
    const el = root.querySelector(`#or${i}`);
    if (el) el.outerHTML = omrRow(Q[i], i);
    const c = root.querySelector('#omrcount');
    if (c) c.textContent = Q.filter((x) => isAnswered(s.responses[x.id].saved)).length;
  };
  const setActiveUI = (i) => {
    root.querySelectorAll('.pq.active, .omr-row.active').forEach((el) => el.classList.remove('active'));
    root.querySelector(`#pq${i}`)?.classList.add('active');
    const row = root.querySelector(`#or${i}`);
    row?.classList.add('active');
    const body = root.querySelector('#omrbody');
    if (row && body) {
      const rt = row.offsetTop - body.offsetTop;
      if (rt < body.scrollTop + 30 || rt > body.scrollTop + body.clientHeight - 60) body.scrollTo({ top: rt - body.clientHeight / 3, behavior: 'smooth' });
    }
  };

  // Paper mode: the question crossing the reading line becomes active after a short dwell.
  let candidate = null, candTimer = null, rafPending = false;
  const readingLine = () => {
    const bk = root.querySelector('#booklet');
    const scrollsSelf = bk && bk.scrollHeight > bk.clientHeight + 4 && getComputedStyle(bk).overflowY !== 'visible';
    const top = scrollsSelf ? bk.getBoundingClientRect().top : 0;
    const h = scrollsSelf ? bk.clientHeight : window.innerHeight;
    return top + h * 0.38;
  };
  const detectActive = () => {
    rafPending = false;
    if (!running()) return;
    const y = readingLine();
    let found = null;
    for (const el of root.querySelectorAll('.pq')) {
      const r = el.getBoundingClientRect();
      if (r.top <= y && r.bottom >= y) { found = +el.dataset.i; break; }
    }
    if (found == null || found === s.cur) { candidate = null; clearTimeout(candTimer); return; }
    if (candidate === found) return;
    candidate = found;
    clearTimeout(candTimer);
    candTimer = setTimeout(() => {
      if (candidate === found && running()) { enter(found); setActiveUI(found); }
      candidate = null;
    }, THRESHOLDS.minVisitMs);
  };
  const onScroll = () => { activity(); if (!rafPending) { rafPending = true; requestAnimationFrame(detectActive); } };

  // ---------- render ----------
  const refresh = () => {
    const keepScroll = root.querySelector('#booklet')?.scrollTop;
    root.innerHTML = `<div class="runner ${cbt ? 'is-cbt' : 'is-omr'}">${bar()}${cbt ? cbtBody() : omrBody()}</div>${overlay()}`;
    if (s.face.enabled) faceLayer.attachPreview(root.querySelector('#camv'));
    paintProctor();
    if (!cbt) {
      const bk = root.querySelector('#booklet');
      if (keepScroll != null && bk) bk.scrollTop = keepScroll;
      bk?.addEventListener('scroll', onScroll, { passive: true });
    }
    if (cbt && Q[s.cur]?.q.type === 'numerical' && running()) root.querySelector('#nv')?.focus();
  };

  // ---------- start / resume overlay ----------
  const overlay = () => {
    if (running()) return '';
    const resuming = s.status === 'in-progress';
    const answered = Q.filter((x) => isAnswered(s.responses[x.id].saved)).length;
    return `<div class="overlay-start"><div class="modal start-modal">
      <div class="eyebrow">${resuming ? 'Paused' : drill ? 'Drill' : 'Ready when you are'}</div>
      <h2>${resuming ? 'Pick up where you stopped' : esc(s.templateName)}</h2>
      <div class="summary-list">
        <div><span>${resuming ? 'Answered' : 'Questions'}</span><b>${resuming ? `${answered} of ${Q.length}` : Q.length}</b></div>
        <div><span>Time ${resuming ? 'left' : 'allowed'}</span><b>${fmtClock(remaining())}</b></div>
        ${drill ? `<div><span>Mode</span><b>${DRILL.modes[s.drill.mode]?.label || 'Normal'} · ${Math.round(s.drill.mult * 100)}% of expected time</b></div>` : `<div><span>Layout</span><b>${cbt ? 'Computer-based' : 'Booklet + OMR'}</b></div>`}
        <div><span>Questions from</span><b>${BANKS[s.bank || 'standard'].label} bank</b></div>
        ${s.face.enabled ? '<div><span>Camera</span><b>Reading your expressions, on this device</b></div>' : ''}
      </div>
      ${resuming ? '<p class="small muted">The clock stopped while you were away. Nothing was lost.</p>' : '<p class="small muted">The clock starts when you press Start. Good luck.</p>'}
      <div class="actions"><a class="btn ghost" href="#/">Not now</a><button class="btn primary lg" id="go">${resuming ? 'Resume' : 'Start test'}</button></div>
    </div></div>`;
  };

  const go = async () => {
    if (s.fullscreen && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* not allowed: carry on */ }
    }
    const resuming = s.status === 'in-progress';
    startClock();
    if (!resuming) {
      s.status = 'in-progress';
      s.startedAt = Date.now();
      log('start');
      enter(0);
    } else {
      log('resume', { gapMs: s.lastSavedAt ? Date.now() - s.lastSavedAt : null });
      visitOpen = true; // the visit open at pause continues; paused time never counts
      visitStart = now();
      if (!s.events.some((e) => e.type === 'enter')) enter(s.cur);
    }
    lastInput = now();
    persist(true);
    if (proctorOn) startProctor();
    else if (s.face.enabled && !faceLayer.running) {
      faceLayer.start().then(() => faceLayer.attachPreview(root.querySelector('#camv'))).catch(() => {
        toast('Camera unavailable. Continuing with behaviour analytics only.');
      });
    }
    refresh();
    if (!cbt) setTimeout(() => { root.querySelector(`#pq${s.cur}`)?.scrollIntoView({ block: 'start' }); }, 30);
  };

  // ---------- navigation ----------
  const goto = (i) => {
    if (i < 0 || i >= Q.length) return;
    enter(i);
    refresh();
  };
  const saveNext = () => {
    const id = curId();
    if (s.pending[id] !== undefined) commitSave();
    if (s.responses[id].marked && isAnswered(s.responses[id].saved)) setMark(s.cur, false);
    if (s.cur < Q.length - 1) goto(s.cur + 1);
    else { refresh(); toast('Last question. Review the palette or submit.'); }
  };
  const markNext = () => {
    const id = curId();
    if (s.pending[id] !== undefined) commitSave();
    setMark(s.cur, true);
    if (s.cur < Q.length - 1) goto(s.cur + 1);
    else refresh();
  };

  // ---------- submit ----------
  let ending = false;
  const finish = async (reason) => {
    if (ending) return;
    if (reason === 'submit') {
      const c = counts();
      const answered = c.answered + c.answeredmarked;
      const ok = await modal({
        title: 'Submit your test?',
        body: `<div class="summary-list">
          <div><span>Answered</span><b>${answered} of ${Q.length}</b></div>
          <div><span>Marked for review</span><b>${c.marked + c.answeredmarked}</b></div>
          <div><span>Not answered</span><b>${c.notanswered}</b></div>
          <div><span>Not visited</span><b>${c.notvisited}</b></div>
          <div><span>Time left</span><b>${fmtClock(remaining())}</b></div></div>
          <p class="small muted">You can’t change answers after submitting.</p>`,
        buttons: [{ label: 'Keep working', value: false }, { label: 'Submit test', value: true, cls: 'primary' }],
      });
      if (!ok) return;
    }
    ending = true;
    if (cbt) delete s.pending[curId()];
    tracker?.closeAll(now());
    flushTrace();
    leave();
    log('end', { reason });
    stopClock();
    s.endReason = reason;
    s.endedAt = Date.now();
    s.elapsedMs = Math.round(base);
    const review = full && !drill;
    s.status = review ? 'review' : 'done';
    store.putSession(s, { immediate: true });
    if (review) { s.reviewSet = pickReviewSet(s); }
    store.putSession(s, { immediate: true });
    // A drill or re-attempt your mentor assigned counts as done once you finish it.
    if (drill) for (const a of store.assignmentsFor('you')) if (!a.done?.you && ((a.kind === 'drill' && a.topic === s.drill?.topic) || (a.kind === 'mistakes' && s.drill?.source === 'mistakes'))) store.updateAssignment(a.id, { done: { ...(a.done || {}), you: Date.now() } });
    const sm = summaryOf(s);
    store.queueSummary({ sessionId: s.id, exam: s.exam, scorePct: sm.scorePct, accuracy: sm.accuracy, n: sm.n });
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    proctor?.stop();
    faceLayer.stop();
    if (reason === 'timeout') await modal({ title: 'Time’s up', body: `<p class="muted">Your answers were saved and the ${drill ? 'drill' : 'test'} has been submitted.</p>`, buttons: [{ label: review ? 'Continue to tagging' : 'See my results', value: true, cls: 'primary' }] });
    location.hash = drill ? `#/drillresult/${s.id}` : review ? `#/review/${s.id}` : `#/report/${s.id}`;
  };

  // ---------- events ----------
  root.onclick = (e) => {
    const t = e.target.closest('button, a');
    if (!t) {
      // A click anywhere on the question card puts the cursor back in the answer box.
      if (cbt && running() && e.target.closest('.q-card')) root.querySelector('#nv')?.focus();
      return;
    }
    activity();
    if (t.id === 'go') return go();
    if (!running()) return;
    if (t.id === 'submit') return finish('submit');
    if (t.id === 'refs') { document.documentElement.requestFullscreen?.().catch(() => {}); return; }
    if (t.id === 'sigpill') { camHidden = !camHidden; refresh(); return; }
    if (t.id === 'omrtoggle') {
      omrOpen = !omrOpen;
      root.querySelector('.omr')?.classList.toggle('collapsed', !omrOpen);
      t.textContent = omrOpen ? 'Collapse' : 'Full sheet';
      t.setAttribute('aria-expanded', omrOpen);
      return;
    }
    if (cbt) {
      if (t.dataset.opt != null) return select(Number(t.dataset.opt));
      if (t.dataset.go != null) return goto(Number(t.dataset.go));
      if (t.dataset.sec != null) {
        const sec = s.sections[Number(t.dataset.sec)];
        const firstOpen = Q.slice(sec.start, sec.end).findIndex((x) => !isAnswered(s.responses[x.id].saved));
        return goto(sec.start + Math.max(0, firstOpen));
      }
      if (t.id === 'savenext') return saveNextTyped();
      if (t.id === 'marknext') { if (Q[s.cur].q.type === 'numerical' && full) commitTyped(); return markNext(); }
      if (t.id === 'clear') return clearResponse();
      if (t.id === 'prev') return goto(s.cur - 1);
    } else {
      if (t.dataset.bub) {
        const [i, j] = t.dataset.bub.split(':').map(Number);
        if (i !== s.cur) { enter(i); setActiveUI(i); }
        select(j);
        refreshOmrRow(i);
        return;
      }
      if (t.dataset.scroll != null) {
        const i = Number(t.dataset.scroll);
        root.querySelector(`#pq${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (t.dataset.circle != null) {
        const i = Number(t.dataset.circle);
        if (i !== s.cur) { enter(i); setActiveUI(i); }
        setMark(i, !s.responses[Q[i].id].marked);
        t.classList.toggle('circled', s.responses[Q[i].id].marked);
      }
    }
  };
  root.oninput = (e) => {
    if (e.target.id === 'nv') {
      activity();
      const v = e.target.value.trim();
      if (v && !/^-?\d*\.?\d*$/.test(v)) { e.target.value = v.replace(/[^\d.-]/g, ''); return; }
      // Typed numbers are logged as one selection when saved, not per keystroke.
      const id = curId();
      if (v === '' && s.pending[id] === undefined) return;
      s.pending[id] = v;
      const un = root.querySelector('#unsaved');
      if (un) un.classList.toggle('hidden', String(v) === String(s.responses[id].saved ?? ''));
    }
  };
  const commitTyped = () => {
    const id = curId();
    const v = s.pending[id];
    if (v === undefined || !isAnswered(v)) return;
    const prev = s.responses[id].saved;
    if (String(prev ?? '') !== String(v)) {
      s.events.push({ t: Math.round(now()), type: 'select', q: id, v, prev: prev ?? null });
    }
  };
  const saveNextTyped = () => { if (Q[s.cur].q.type === 'numerical' && full) commitTyped(); saveNext(); };

  const onKey = (e) => {
    if (!running() || document.querySelector('.modal-back')) return;
    activity();
    const typing = e.target.tagName === 'INPUT';
    if (cbt) {
      if (typing) {
        if (e.key === 'Enter') { e.preventDefault(); saveNextTyped(); }
        return;
      }
      const k = e.key.toLowerCase();
      const q = Q[s.cur].q;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (q.type === 'numerical' && /^[0-9.\-]$/.test(e.key)) {
        // Typing a digit anywhere on the page goes into the answer box.
        const inp = root.querySelector('#nv');
        if (inp) {
          e.preventDefault();
          inp.focus();
          inp.value += e.key;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }
      if (q.type === 'mcq' && ['1', '2', '3', '4', 'a', 'b', 'c', 'd'].includes(k)) { select('1234'.includes(k) ? Number(k) - 1 : 'abcd'.indexOf(k)); return; }
      if (k === 's' || (k === 'enter' && !e.target.closest('button'))) { e.preventDefault(); saveNextTyped(); return; }
      if (k === 'm') { markNext(); return; }
      if (k === 'c') { clearResponse(); return; }
      if (e.key === 'ArrowRight') { goto(s.cur + 1); return; }
      if (e.key === 'ArrowLeft') { goto(s.cur - 1); return; }
    } else if (!typing && ['1', '2', '3', '4'].includes(e.key)) {
      select(Number(e.key) - 1);
      refreshOmrRow(s.cur);
    }
  };
  let moveThrottle = 0;
  const onMove = () => { const t = performance.now(); if (t - moveThrottle > 800) { moveThrottle = t; activity(); } };
  const onVis = () => {
    if (!running()) return;
    if (document.hidden) { hiddenAt = now(); log('blur', { q: curId() }); persist(true); }
    else if (hiddenAt != null) { log('focus', { q: curId(), dur: Math.round(now() - hiddenAt) }); hiddenAt = null; lastInput = now(); }
  };
  let hiddenAt = null;
  let wasFs = !!document.fullscreenElement;
  const onFs = () => {
    const fsNow = !!document.fullscreenElement;
    if (wasFs && !fsNow && running() && !ending) {
      log('fs_exit', { q: curId() });
      root.querySelector('#fsban')?.classList.remove('hidden');
    }
    if (fsNow) root.querySelector('#fsban')?.classList.add('hidden');
    wasFs = fsNow;
  };
  const onWinScroll = () => { if (!cbt) onScroll(); };
  const onOnline = () => persist();

  document.addEventListener('keydown', onKey);
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('visibilitychange', onVis);
  document.addEventListener('fullscreenchange', onFs);
  window.addEventListener('scroll', onWinScroll, { passive: true });
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOnline);
  const onHide = () => { if (running()) { s.elapsedMs = Math.round(now()); store.putSession(s, { immediate: true }); } };
  window.addEventListener('pagehide', onHide);

  // ---------- tick ----------
  let warned5 = false;
  const tick = setInterval(() => {
    if (!running()) return;
    const rem = remaining();
    const el = root.querySelector('#timer');
    if (el) { el.textContent = fmtClock(rem); el.classList.toggle('low', rem <= Math.min(300, s.durationSec * 0.2)); }
    if (!warned5 && rem <= 300 && s.durationSec > 600) { warned5 = true; toast('5 minutes left'); }
    applyFlags();
    if (full && idleFrom == null && now() - lastInput >= THRESHOLDS.idleMinSec * 1000) idleFrom = lastInput;
    if (drill && visitOpen) {
      const target = Q[s.cur].expectedSec * s.drill.mult;
      const spent = (now() - visitStart) / 1000;
      const fill = root.querySelector('#qtfill');
      if (fill) {
        fill.style.width = `${Math.min(100, (spent / target) * 100)}%`;
        fill.className = spent > target ? 'over' : spent > target * 0.8 ? 'warn' : '';
        const lab = root.querySelector('#qtlabel');
        if (lab) lab.textContent = `${fmtClock(spent)} / ${fmtClock(target)}`;
      }
    }
    if (paceHint) {
      const pill = root.querySelector('#pace');
      if (pill) {
        const answered = Q.filter((x) => isAnswered(s.responses[x.id].saved)).length;
        const ideal = (now() / 1000 / s.durationSec) * Q.length;
        const diff = answered - ideal;
        pill.textContent = Math.abs(diff) < 1 ? 'On pace' : diff > 0 ? `${Math.round(diff)} ahead` : `${Math.round(-diff)} behind`;
        pill.className = `status-pill pace ${diff < -1 ? 'off' : 'on'}`;
      }
    }
    if (rem <= 0) finish('timeout');
  }, 250);
  const autosave = setInterval(() => { if (running()) persist(); }, 3000);

  refresh();

  return () => {
    clearInterval(tick);
    clearInterval(autosave);
    clearTimeout(candTimer);
    if (running() && !ending) { flushTrace(); log('pause'); stopClock(); s.elapsedMs = Math.round(base); store.putSession(s, { immediate: true }); }
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('fullscreenchange', onFs);
    window.removeEventListener('scroll', onWinScroll);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOnline);
    window.removeEventListener('pagehide', onHide);
    unsubFace?.();
    proctor?.stop({ camera: !ending });
    if (!ending) faceLayer.stop();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
}


