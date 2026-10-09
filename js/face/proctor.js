// Camera checks. Pure check logic (testable without a browser) plus a session object that
// drives the face layer, the object detector, the identity model and the mic, and turns their
// numbers into a checklist before a test (the camera room) and into flags during it.
import { PROCTOR, FACE, QUALITY } from '../config.js';
import { faceLayer, cameraErrorText } from './facelayer.js';
import { assessFrame } from './quality.js';
import { identity } from './identity.js';
import { objects } from './objects.js';
import { mic } from './mic.js';

export const FLAG_LABEL = Object.fromEntries(Object.entries(PROCTOR.flags).map(([k, v]) => [k, v.label]));

const FRAMING = new Set(['noface', 'far', 'near', 'left', 'right', 'up', 'down', 'pose']);
const LIGHT = new Set(['washed', 'dark', 'backlit', 'flat', 'uneven']);
const CLARITY = new Set(['blur', 'shaky']);

/** During a test: sideways only, since looking down at rough work is normal. (v1 helper) */
export const lookingAway = (s) => !!s && s.faces >= 1 && (Math.abs(s.yaw) > PROCTOR.lookAway.yaw || s.sideways > PROCTOR.lookAway.sideways);

/**
 * Turn the latest observations into a checklist.
 * ctx: { mode: 'room'|'calibrate'|'test', cam, sample, quality, objects, identity, mic, enrolled, fullscreen, now }
 * Each check: { id, label, state: 'ok'|'bad'|'warn'|'wait'|'skip'|'info', detail, fix, required }
 */
export function evaluateChecks(ctx) {
  const { mode = 'test', cam = { state: 'off' }, sample = null, now = 0 } = ctx;
  const q = ctx.quality || (sample ? assessFrame(sample, mode === 'test' ? 'test' : 'room') : null);
  const ob = ctx.objects || { state: 'idle', last: null, lastAt: 0 };
  const idn = ctx.identity || { state: 'idle', verdict: null, distance: null };
  const mc = ctx.mic || { state: 'idle', level: -100, loud: false };
  const camOn = cam.state === 'running';
  const faces = sample?.faces ?? 0;
  const checks = [];
  const push = (id, label, state, detail, required = true, fix = '') => checks.push({ id, label, state, detail, required, fix });
  const issueIn = (set) => q?.issues.filter((x) => set.has(x.id)) || [];

  // 1. camera
  if (camOn) push('camera', 'Camera', 'ok', 'On. Video stays in this tab.');
  else if (cam.state === 'loading') push('camera', 'Camera', 'wait', 'Starting the camera…');
  else if (cam.state === 'error') push('camera', 'Camera', 'bad', cameraErrorText(cam.error));
  else push('camera', 'Camera', 'wait', 'Off');

  // 2. one face
  const objFresh = ob.last && now - ob.lastAt < 5000;
  const extraPerson = objFresh && ob.last.persons >= 2;
  if (!camOn) push('face', 'Only you in view', 'wait', '');
  else if (!sample) push('face', 'Only you in view', 'wait', 'Looking for your face…');
  else if (faces === 0) push('face', 'Only you in view', 'bad', 'We can’t find your face', true, 'Sit in front of the camera with your whole face in view.');
  else if (faces >= 2 || extraPerson) push('face', 'Only you in view', 'bad', 'Someone else is in the frame', true, 'Only you should be in view during a test.');
  else push('face', 'Only you in view', 'ok', 'Just you');

  // 3. framing (distance, centring, facing the screen)
  if (!camOn || !sample || faces === 0) push('framing', 'Framing', 'wait', '');
  else { const f = issueIn(FRAMING).find((x) => x.level === 'block'); push('framing', 'Framing', f ? 'bad' : 'ok', f ? f.text : 'Centred, good distance, facing the screen', true, f?.fix || ''); }

  // 4. light on the face
  if (!camOn || !sample || faces === 0) push('light', 'Light on your face', 'wait', '');
  else {
    const l = issueIn(LIGHT);
    const blk = l.find((x) => x.level === 'block');
    const wrn = l.find((x) => x.level === 'warn');
    push('light', 'Light on your face', blk ? 'bad' : wrn ? 'warn' : 'ok', blk ? blk.text : wrn ? wrn.text : 'Even light, expressions readable', true, (blk || wrn)?.fix || '');
  }

  // 5. clarity (sharpness, steadiness)
  if (!camOn || !sample || faces === 0) push('clarity', 'Sharp, steady picture', 'wait', '');
  else {
    const c = issueIn(CLARITY);
    const blk = c.find((x) => x.level === 'block');
    const wrn = c.find((x) => x.level === 'warn');
    push('clarity', 'Sharp, steady picture', blk ? 'bad' : wrn ? 'warn' : 'ok', blk ? blk.text : wrn ? wrn.text : 'Sharp and steady', true, (blk || wrn)?.fix || '');
  }

  // 6. identity (only before a test, once a face is saved)
  if (mode === 'room' || mode === 'test') {
    if (!ctx.enrolled) push('identity', 'It’s you', 'skip', 'No face saved yet', false);
    else if (idn.state === 'error') push('identity', 'It’s you', 'skip', 'Identity model unavailable (offline?), check skipped', false);
    else if (idn.state !== 'ready') push('identity', 'It’s you', 'wait', 'Loading the identity model…');
    else if (idn.verdict === 'match') push('identity', 'It’s you', 'ok', 'Matches your admit-card photo');
    else if (!camOn || faces !== 1) push('identity', 'It’s you', 'wait', 'Waiting for a clear view of your face');
    else if (idn.verdict === 'mismatch') push('identity', 'It’s you', 'bad', 'Doesn’t match the face saved on this device', true, 'If this is a different student, use their own profile.');
    else if (idn.verdict === 'unsure') push('identity', 'It’s you', 'wait', 'Not sure yet. Hold still and face the camera…');
    else push('identity', 'It’s you', 'wait', 'Checking it’s you…');
  }

  // 7. phone / objects
  if (mode === 'room' || mode === 'test') {
    if (ob.state === 'error') push('phone', 'No phone in view', 'skip', 'Object model unavailable (offline?), check skipped', false);
    else if (ob.state !== 'ready') push('phone', 'No phone in view', 'wait', 'Loading the object model (about 4 MB, once)…');
    else if (!camOn || !objFresh) push('phone', 'No phone in view', 'wait', 'Looking…');
    else if (ob.last.phone > 0) push('phone', 'No phone in view', 'bad', 'A phone is in view', true, 'Put your phone away, out of the camera’s sight.');
    else push('phone', 'No phone in view', 'ok', 'None seen');
  }

  // 8. microphone (optional)
  if (mode === 'room' || mode === 'test') {
    if (mc.state === 'running') push('mic', 'Quiet room', mc.loud ? 'bad' : 'ok', mc.loud ? 'Too loud right now' : `Quiet (${Math.round(mc.level)} dB)`, false);
    else if (mc.state === 'denied') push('mic', 'Quiet room', 'skip', 'Microphone not allowed. Optional.', false);
    else if (mc.state === 'error') push('mic', 'Quiet room', 'skip', 'Microphone unavailable. Optional.', false);
    else if (mc.state === 'loading') push('mic', 'Quiet room', 'wait', 'Starting the microphone…', false);
    else push('mic', 'Quiet room', 'skip', 'Optional: allow the microphone to check for noise', false);
  }

  const required = checks.filter((c) => c.required && c.state !== 'skip' && c.state !== 'info');
  const ready = camOn && required.length > 0 && required.every((c) => c.state === 'ok' || c.state === 'warn');
  const firstBad = required.find((c) => c.state === 'bad');
  const firstWarn = required.find((c) => c.state === 'warn');
  const firstWait = required.find((c) => c.state === 'wait' && c.detail);
  const lead = firstBad || firstWait || firstWarn || null;
  const guidance = lead ? lead.detail : ready ? 'Hold still…' : '';
  return { checks, ready, guidance, fix: lead?.fix || '', quality: q };
}

/** Opens a flag after a condition holds for `onset` ms and closes it after it clears for `release` ms. */
export class FlagTracker {
  constructor(defs = PROCTOR.flags, { onOpen, onClose } = {}) {
    this.defs = defs;
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
    this.st = {};
  }
  state(code) { return (this.st[code] ||= { since: null, open: false, openedAt: null, clearSince: null }); }
  update(code, active, t, onsetOverride = null) {
    const d = this.defs[code] || { onset: 0, release: 0 };
    const s = this.state(code);
    const onset = onsetOverride ?? d.onset ?? 0;
    if (active) {
      s.clearSince = null;
      if (!s.open) {
        if (s.since == null) s.since = t;
        if (t - s.since >= onset) { s.open = true; s.openedAt = s.since; this.onOpen(code, s.since); }
      }
    } else {
      s.since = null;
      if (s.open) {
        if (s.clearSince == null) s.clearSince = t;
        if (t - s.clearSince >= (d.release || 0)) { const dur = s.clearSince - s.openedAt; s.open = false; s.openedAt = null; s.clearSince = null; this.onClose(code, t, dur); }
      }
    }
  }
  get open() { return Object.entries(this.st).filter(([, s]) => s.open).map(([c]) => c); }
  closeAll(t) {
    for (const [code, s] of Object.entries(this.st)) if (s.open) { const dur = t - s.openedAt; s.open = false; s.openedAt = null; s.clearSince = null; s.since = null; this.onClose(code, t, dur); }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

/**
 * Drives the detectors and emits a checklist on every camera frame.
 * mode: 'calibrate' (camera room, first time), 'room' (before a test) or 'test' (during one).
 */
export class ProctorSession {
  constructor({ mode = 'test', enrolled = null, wantObjects = true, wantIdentity = true, fullscreen = false, fps = null } = {}) {
    this.mode = mode;
    this.enrolled = enrolled;
    this.wantObjects = mode !== 'calibrate' && wantObjects;
    // The room loads the identity model even before a face is saved, so a first-time calibration can enrol.
    this.wantIdentity = mode === 'test' ? wantIdentity && !!enrolled?.length : wantIdentity;
    this.fullscreen = fullscreen;
    this.fps = fps || (mode === 'test' ? FACE.fps : 10);
    this.subs = new Set();
    this.sample = null;
    this.readySince = null;
    this.goodSince = null;
    this.badRun = 0;
    this.lastObjAt = 0;
    this.cam = { state: 'off', error: null };
    this.idn = { verdict: null, distance: null, history: [], lastAt: 0, busy: false, misses: 0 };
    this.unsub = null;
  }

  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }

  async start() {
    this.cam = { state: faceLayer.running ? 'running' : 'loading', error: null };
    this.unsub = faceLayer.subscribe((ev) => this.onSample(ev));
    this.emit();
    try {
      await faceLayer.start({ fps: this.fps });
      faceLayer.setFps(this.fps);
      this.cam = { state: 'running', error: null };
    } catch (e) {
      this.cam = { state: 'error', error: e };
      this.emit();
      return false;
    }
    if (this.wantObjects) objects.load().then(() => this.emit()).catch(() => this.emit());
    if (this.wantIdentity) identity.load().then(() => this.emit()).catch(() => this.emit());
    this.emit();
    return true;
  }

  onSample(ev) {
    if (ev.type === 'stopped') {
      this.cam = faceLayer.state === 'error' ? { state: 'error', error: faceLayer.error } : { state: 'off', error: null };
      this.sample = null;
      this.emit();
      return;
    }
    if (ev.type !== 'sample') return;
    this.sample = ev;
    const t = performance.now();
    if (this.wantObjects && objects.state === 'ready' && t - this.lastObjAt >= PROCTOR.objects.everyMs) {
      this.lastObjAt = t;
      try { objects.detect(faceLayer.video); } catch (e) { console.warn('object detection failed', e); }
    }
    this.maybeVerify(ev, t);
    this.emit();
  }

  /** Identity: quick checks before a test until the verdict settles; periodic rechecks during it. */
  maybeVerify(ev, t) {
    if (!this.wantIdentity || this.mode === 'calibrate' || !this.enrolled?.length || identity.state !== 'ready' || this.idn.busy) return;
    if (ev.faces !== 1) return;
    const settled = this.idn.verdict === 'match';
    const interval = this.mode === 'test' ? PROCTOR.identity.recheckSec * 1000 : settled ? 8000 : 1200;
    if (t - this.idn.lastAt < interval) return;
    if (this.mode !== 'test' && assessFrame(ev, 'room').verdict === 'poor') return;
    this.idn.lastAt = t;
    this.idn.busy = true;
    identity.describe(faceLayer.video).then((d) => {
      if (!d) return;
      const { distance } = identity.compare(d, this.enrolled);
      this.idn.distance = distance;
      this.idn.history.push(distance);
      if (this.idn.history.length > 3) this.idn.history.shift();
      const T = PROCTOR.identity;
      const med = median(this.idn.history);
      const v = med < T.match ? 'match' : med < T.unsure ? 'unsure' : 'mismatch';
      if (this.mode === 'test') {
        this.idn.misses = v === 'mismatch' ? this.idn.misses + 1 : 0;
        this.idn.verdict = this.idn.misses >= 2 ? 'mismatch' : v === 'mismatch' ? 'unsure' : v;
      } else {
        this.idn.verdict = v === 'mismatch' && this.idn.history.length < 2 ? 'unsure' : v;
      }
    }).catch((e) => console.warn('identity check failed', e)).finally(() => { this.idn.busy = false; this.emit(); });
  }

  evaluate() {
    const now = performance.now();
    const roomMode = this.mode === 'test' ? 'test' : 'room';
    const quality = this.sample ? assessFrame(this.sample, roomMode) : null;
    return evaluateChecks({
      mode: this.mode, now, cam: this.cam, sample: this.sample, quality,
      objects: this.wantObjects ? { state: objects.state, last: objects.last, lastAt: objects.lastAt } : { state: 'error', last: null, lastAt: 0 },
      identity: { state: identity.state, verdict: this.idn.verdict, distance: this.idn.distance },
      mic: { state: mic.state, level: mic.level, loud: mic.loud },
      enrolled: !!this.enrolled?.length, fullscreen: this.fullscreen,
    });
  }

  emit() {
    const ev = this.evaluate();
    const now = performance.now();
    if (ev.ready) { if (this.readySince == null) this.readySince = now; } else this.readySince = null;
    const good = ev.quality && ev.quality.verdict !== 'poor' && ev.checks.find((c) => c.id === 'face')?.state === 'ok';
    // One or two borderline frames don't reset the hold; three in a row do.
    if (good) { this.badRun = 0; if (this.goodSince == null) this.goodSince = now; } else if (++this.badRun >= 3) this.goodSince = null;
    ev.steadyMs = this.readySince == null ? 0 : now - this.readySince;
    ev.goodMs = this.goodSince == null ? 0 : now - this.goodSince;
    ev.holdMs = QUALITY.holdMs;
    ev.sample = this.sample;
    ev.objects = objects.last;
    ev.identity = { ...this.idn, state: identity.state };
    ev.cam = this.cam;
    this.subs.forEach((fn) => fn(ev));
  }

  async allowMic() { await mic.start(); this.emit(); }
  get micState() { return mic.state; }
  /** Show the live stream in a visible <video>. */
  attach(el) { faceLayer.attachPreview(el); }

  /** Face signatures + the admit-card photo, from the current (good) view. */
  async captureIdentity(box = this.sample?.box) {
    const descriptors = [];
    if (identity.state === 'ready') {
      for (let i = 0; i < PROCTOR.identity.samples; i++) {
        try { const d = await identity.describe(faceLayer.video); if (d) descriptors.push(d); } catch (e) { console.warn('descriptor failed', e); }
        if (i < PROCTOR.identity.samples - 1) await sleep(300);
      }
    }
    const thumb = faceLayer.snapshot({ size: 160, box });
    return { at: Date.now(), descriptors, thumb, model: identity.state === 'ready' ? 'face-api 1.7 (on-device)' : null };
  }

  /** Detach. With camera:false the stream and the mic keep running for the next screen (room → test). */
  stop({ camera = true } = {}) {
    this.unsub?.();
    this.unsub = null;
    if (camera) { faceLayer.stop(); mic.stop(); }
  }
}
