// On-device face layer. Video frames are processed in this tab and discarded; only numbers
// leave this module: where the face is, which way it points, how many faces, the struggle-
// relevant facial actions, blinks, and how good the picture is. Never an emotion label, never
// an image (except the small photos the student agrees to: the admit-card photo at calibration
// and, with consent, a snapshot when a proctoring flag opens). Loaded only when the camera is on.
import { FACE, QUALITY } from '../config.js';
import { clamp } from '../ui.js';
import { cropStats, meanLuma, innerFace, assessFrame } from './quality.js';
import { componentsFrom } from './expression.js';

const VER = '0.10.14';
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const avg = (...xs) => xs.reduce((s, x) => s + (x || 0), 0) / xs.length;
const deg = (rad) => (rad * 180) / Math.PI;

let visionP = null;
/** The MediaPipe vision bundle + WASM fileset, shared by every detector. */
export function getVision() {
  if (!visionP) {
    visionP = (async () => {
      const vision = await import(/* @vite-ignore */ BUNDLE);
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
      return { vision, fileset };
    })().catch((e) => { visionP = null; throw e; });
  }
  return visionP;
}

/** Friendly wording for getUserMedia failures. */
export function cameraErrorText(err) {
  const n = err?.name || '';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'Camera permission was declined. Allow the camera for this site (the camera icon in the address bar), then try again.';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No camera was found on this device.';
  if (n === 'NotReadableError' || n === 'TrackStartError') return 'The camera is being used by another app. Close it and try again.';
  if (n === 'OverconstrainedError') return 'The camera does not support the requested mode.';
  if (n === 'SecurityError') return 'The camera only works on a secure page (https) or on localhost. On a phone, use the https address.';
  return err?.message || 'The camera could not be started.';
}

class FaceLayer {
  constructor() {
    this.state = 'off'; // off | loading | running | error
    this.error = null;
    this.subs = new Set();
    this.timer = null;
    this.wasClosed = false;
    this.lastTs = 0;
    this.fps = FACE.fps;
    this.last = null;
    this.prev = null;
    this.jitter = 0;
  }

  get running() { return this.state === 'running'; }

  setFps(n) { this.fps = clamp(n || FACE.fps, 1, 15); }

  async start({ fps } = {}) {
    if (fps) this.setFps(fps);
    if (this.state === 'running') return this.ready;
    if (this.state === 'loading') return this.ready;
    this.state = 'loading';
    this.error = null;
    this.ready = (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          const e = new Error('This browser cannot open the camera.'); e.name = 'SecurityError'; throw e;
        }
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
        const track = this.stream.getVideoTracks()[0];
        if (track) track.onended = () => { if (this.state === 'running') { this.stop(); this.state = 'error'; this.error = Object.assign(new Error('Camera disconnected'), { name: 'NotReadableError' }); this.emit({ valid: false, reason: 'noface', faces: 0 }); } };
        this.video = document.createElement('video');
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.srcObject = this.stream;
        await this.video.play();
        if (!this.landmarker) {
          const { vision, fileset } = await getVision();
          const opts = (delegate) => ({
            baseOptions: { modelAssetPath: MODEL, delegate },
            runningMode: 'VIDEO',
            numFaces: 2,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          try {
            this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, opts('GPU'));
          } catch {
            this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, opts('CPU'));
          }
        }
        const C = QUALITY.crop;
        this.crop = document.createElement('canvas');
        this.crop.width = C; this.crop.height = C;
        this.cropCtx = this.crop.getContext('2d', { willReadFrequently: true });
        this.small = document.createElement('canvas');
        this.small.width = 32; this.small.height = 24;
        this.smallCtx = this.small.getContext('2d', { willReadFrequently: true });
        this.prev = null;
        this.jitter = 0;
        this.state = 'running';
        this.loop();
      } catch (err) {
        this.error = err;
        this.stop();
        this.state = 'error';
        throw err;
      }
    })();
    return this.ready;
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (this.state !== 'error') this.state = 'off';
    this.last = null;
    this.prev = null;
    this.subs.forEach((fn) => fn({ type: 'stopped' }));
  }

  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }

  /** Attach the live stream to a visible <video> for the student's own preview. */
  attachPreview(el) {
    if (el && this.stream) { el.srcObject = this.stream; el.muted = true; el.playsInline = true; el.play().catch(() => {}); }
  }

  loop() {
    if (this.state !== 'running') return;
    try { this.sample(); } catch (e) { console.warn('face sample failed', e); }
    this.timer = setTimeout(() => this.loop(), 1000 / this.fps);
  }

  /** Brightness of the whole frame (32x24) and statistics of the inner face (96x96). */
  measure(box) {
    const v = this.video;
    this.smallCtx.drawImage(v, 0, 0, 32, 24);
    const frameMean = meanLuma(this.smallCtx.getImageData(0, 0, 32, 24).data);
    let faceStats = null;
    const r = innerFace(box);
    if (r && r.w > 0.02 && r.h > 0.02) {
      const vw = v.videoWidth, vh = v.videoHeight, C = QUALITY.crop;
      this.cropCtx.drawImage(v, r.x * vw, r.y * vh, r.w * vw, r.h * vh, 0, 0, C, C);
      faceStats = cropStats(this.cropCtx.getImageData(0, 0, C, C).data, C, C);
    }
    return { frameMean, faceStats };
  }

  sample() {
    const v = this.video;
    if (!v || v.readyState < 2) return;
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(v, ts);
    const faces = res.faceLandmarks?.length || 0;

    // Largest face is the student; a second one is a proctoring observation.
    let box = null, pi = 0, best = -1;
    const boxes = [];
    for (let i = 0; i < faces; i++) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of res.faceLandmarks[i]) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      const b = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
      boxes.push(b);
      if (b.w > best) { best = b.w; box = b; pi = i; }
    }
    const { frameMean, faceStats } = this.measure(box);

    if (!faces) {
      this.prev = null;
      const s = { ts, faces: 0, box: null, boxes, frameMean, faceStats: null, luma: frameMean, faceLuma: null, jitter: this.jitter };
      s.quality = assessFrame(s, 'test');
      s.valid = false;
      s.reason = frameMean < FACE.lowLuma ? 'dark' : 'noface';
      return this.emit(s);
    }

    const cats = res.faceBlendshapes?.[pi]?.categories;
    const b = {};
    if (cats) for (const c of cats) b[c.categoryName] = c.score;
    const comp = componentsFrom(b);
    // Legacy single tension value (v1 sessions and charts).
    const tension = 0.4 * comp.brow + 0.3 * avg(b.mouthPressLeft, b.mouthPressRight) + 0.2 * comp.squint + 0.1 * avg(b.mouthRollLower, b.mouthRollUpper);
    const eyesClosed = avg(b.eyeBlinkLeft, b.eyeBlinkRight) > 0.5;
    const blink = eyesClosed && !this.wasClosed;
    this.wasClosed = eyesClosed;

    let yaw = 0, pitch = 0;
    const m = res.facialTransformationMatrixes?.[pi]?.data;
    if (m) {
      yaw = deg(Math.atan2(m[8], m[10]));
      pitch = deg(Math.asin(clamp(-m[9], -1, 1)));
    }
    const lm = res.faceLandmarks[pi];
    const roll = lm?.length > 263 ? deg(Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x)) : 0;
    const sideways = Math.max(avg(b.eyeLookOutLeft, b.eyeLookInRight), avg(b.eyeLookInLeft, b.eyeLookOutRight));
    const lookDown = avg(b.eyeLookDownLeft, b.eyeLookDownRight);

    // Motion between frames (head position + pose), smoothed into a jitter level.
    let motion = 0;
    if (this.prev) {
      const p = this.prev;
      motion = (Math.abs(box.cx - p.cx) + Math.abs(box.cy - p.cy)) / Math.max(0.05, box.w) * 0.5
        + (Math.abs(yaw - p.yaw) + Math.abs(pitch - p.pitch)) / 90;
    }
    this.prev = { cx: box.cx, cy: box.cy, yaw, pitch };
    this.jitter = this.jitter * 0.7 + motion * 0.3;

    const s = {
      ts, faces, box, boxes, yaw, pitch, roll, sideways, lookDown, comp, tension, blink, eyesClosed,
      gazeAway: Math.abs(yaw) > FACE.gazeYawDeg || sideways > 0.55,
      frameMean, faceStats, luma: frameMean, faceLuma: faceStats?.mean ?? null, motion, jitter: this.jitter,
    };
    s.quality = assessFrame(s, 'test');
    s.valid = s.quality.verdict !== 'poor';
    s.reason = s.quality.blocks[0]?.id || null;
    this.emit(s);
  }

  emit(sample) {
    const ev = { type: 'sample', ...sample };
    this.last = ev;
    this.subs.forEach((fn) => fn(ev));
  }

  /** Small mirrored JPEG of the face box (the admit-card photo). Taken only during calibration. */
  snapshot({ size = 112, box = null } = {}) {
    const v = this.video;
    if (!v || v.readyState < 2) return null;
    const vw = v.videoWidth, vh = v.videoHeight;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    let sx = 0, sy = 0, sw = Math.min(vw, vh), sh = sw;
    if (box) {
      const side = clamp(Math.max(box.w * vw, box.h * vh) * 1.6, 48, Math.min(vw, vh));
      sx = clamp(box.cx * vw - side / 2, 0, vw - side);
      sy = clamp(box.cy * vh - side / 2, 0, vh - side);
      sw = sh = side;
    } else { sx = (vw - sw) / 2; sy = (vh - sh) / 2; }
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.82);
  }

  /** Small mirrored full-frame JPEG, for a proctoring flag (only with the student's consent). */
  snapshotFrame({ w = 168, h = 126, quality = 0.7 } = {}) {
    const v = this.video;
    if (!v || v.readyState < 2) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  }
}

export const faceLayer = new FaceLayer();

/** v1: convert a raw tension value into a marker relative to the student's own baseline. */
export function toMarker(raw, calibration) {
  if (!calibration?.calm) return null;
  return clamp((raw - calibration.calm.mean) / calibration.scale, -FACE.markerCap, FACE.markerCap);
}

/** v1 calibration (kept so old sessions still open). */
export function calibrationFrom(calm, effort) {
  const stats = (arr) => {
    const v = arr.map((x) => x.tension);
    const m = v.reduce((s, x) => s + x, 0) / (v.length || 1);
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
    return { mean: m, sd };
  };
  const c = stats(calm.valid), e = stats(effort.valid);
  const minutes = (n) => n / FACE.fps / 60;
  const scale = Math.max(c.sd, (e.mean - c.mean) / 2, 0.03);
  const validFrac = (calm.valid.length + effort.valid.length) / Math.max(1, calm.total + effort.total);
  return {
    at: Date.now(),
    kind: 'full',
    calm: { ...c, blinkPerMin: calm.valid.filter((x) => x.blink).length / Math.max(0.1, minutes(calm.valid.length)) },
    effort: { ...e, blinkPerMin: effort.valid.filter((x) => x.blink).length / Math.max(0.1, minutes(effort.valid.length)) },
    scale,
    validFrac,
    quality: validFrac >= 0.6 ? 'ok' : 'poor',
  };
}

/** v1 quick baseline (kept for old callers). */
export function quickBaseline(samples) {
  const v = samples.filter((x) => x.valid && x.tension != null).map((x) => x.tension);
  if (v.length < 4) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, v.length - 1));
  return { at: Date.now(), kind: 'quick', calm: { mean, sd, blinkPerMin: null }, effort: null, scale: Math.max(sd * 2, 0.06), validFrac: v.length / samples.length, quality: 'quick' };
}
