// Expression model. Pure functions: blendshapes in, struggle signal out.
//
// The struggle signal is built from facial actions linked to mental effort and difficulty
// (brow lowering / furrow, lip press, lid tightening, lip-corner depression, inner-brow raise,
// nose wrinkle). Each is scaled between the student's own calm face and their own range, both
// learned in the camera room, so a naturally furrowed brow is not read as struggle.
// The output is a strain level from 0 (your calm face) to 1 (your strongest frown). It is a
// measure of visible effort, never an emotion label.
import { EXPRESSION } from '../config.js';

export const COMPONENTS = ['brow', 'press', 'squint', 'frown', 'inner', 'sneer'];
export const COMPONENT_LABEL = {
  brow: 'brow furrow', press: 'lip press', squint: 'eye squint', frown: 'mouth corners down', inner: 'inner brow raise', sneer: 'nose wrinkle',
};

const avg = (a, b) => ((a || 0) + (b || 0)) / 2;

/** Struggle-relevant actions from a MediaPipe blendshape map (each 0..1). */
export function componentsFrom(b) {
  return {
    brow: avg(b.browDownLeft, b.browDownRight),
    press: Math.max(avg(b.mouthPressLeft, b.mouthPressRight), 0.8 * avg(b.mouthRollLower, b.mouthRollUpper)),
    squint: avg(b.eyeSquintLeft, b.eyeSquintRight),
    frown: avg(b.mouthFrownLeft, b.mouthFrownRight),
    inner: b.browInnerUp || 0,
    sneer: avg(b.noseSneerLeft, b.noseSneerRight),
  };
}

// ---------- small stats ----------
export const meanOf = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export function sdOf(a) {
  if (a.length < 2) return 0;
  const m = meanOf(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export const medianOf = (a) => quantile(a, 0.5);

// ---------- calibration builders ----------
/** Calm baseline from good-quality frames: per-component mean and SD, blink rate, pose, motion. */
export function neutralFrom(frames, fps = 8) {
  const ok = frames.filter((f) => f.comp);
  if (ok.length < 6) return null;
  const mean = {}, sd = {};
  for (const c of COMPONENTS) {
    const v = ok.map((f) => f.comp[c]);
    mean[c] = meanOf(v);
    sd[c] = sdOf(v);
  }
  const blinks = ok.filter((f) => f.blink).length;
  return {
    mean, sd, n: ok.length,
    blinkPerMin: blinks / Math.max(0.05, ok.length / fps / 60),
    yaw: medianOf(ok.map((f) => f.yaw || 0)), pitch: medianOf(ok.map((f) => f.pitch || 0)),
    lookDown: medianOf(ok.map((f) => f.lookDown || 0)),
    motion: meanOf(ok.map((f) => f.motion || 0)),
  };
}

/** Personal range: the 85th percentile of each component while frowning or pressing the lips. */
export function rangeFrom(neutral, frownFrames, pressFrames) {
  if (!neutral) return null;
  const all = [...frownFrames, ...pressFrames].filter((f) => f.comp);
  const max = {};
  for (const c of COMPONENTS) {
    const pool = (c === 'press' ? pressFrames : c === 'brow' || c === 'squint' || c === 'inner' || c === 'sneer' ? frownFrames : all).filter((f) => f.comp);
    max[c] = pool.length ? quantile(pool.map((f) => f.comp[c]), 0.85) : neutral.mean[c];
  }
  const G = EXPRESSION.rangeMinGain;
  return {
    max,
    ok: { brow: max.brow - neutral.mean.brow >= G.brow, press: max.press - neutral.mean.press >= G.press },
    gain: { brow: max.brow - neutral.mean.brow, press: max.press - neutral.mean.press },
  };
}

/** Screen envelope from looking at the four corners (and the centre). */
export function screenFrom(points) {
  const f = points.flatMap((p) => p.frames).filter((x) => x.yaw != null);
  if (f.length < 4) return null;
  const yaws = f.map((x) => x.yaw), pitches = f.map((x) => x.pitch), side = f.map((x) => x.sideways || 0);
  // Many students look at corners with their eyes only, so the head barely moves. Keep a
  // minimum envelope, or every small head turn during the test would read as looking away.
  const widen = (lo, hi, half) => { const mid = (lo + hi) / 2; return [Math.min(lo, mid - half), Math.max(hi, mid + half)]; };
  return {
    yaw: widen(quantile(yaws, 0.05), quantile(yaws, 0.95), EXPRESSION.away.minHalfYaw),
    pitch: widen(quantile(pitches, 0.05), quantile(pitches, 0.95), EXPRESSION.away.minHalfPitch),
    sideways: quantile(side, 0.9),
    corners: points.map((p) => ({ id: p.id, n: p.frames.length, yaw: medianOf(p.frames.map((x) => x.yaw)), pitch: medianOf(p.frames.map((x) => x.pitch)) })),
  };
}

/** Writing posture: head and eyes down at the rough sheet. Records whether the face stays visible. */
export function paperFrom(frames, total) {
  const seen = frames.filter((f) => f.faces > 0 && f.yaw != null);
  const visible = total ? seen.length / total : 0;
  if (!seen.length) return { visible: 0, pitch: null, lookDown: null, hidesFace: true };
  return {
    visible,
    pitch: medianOf(seen.map((f) => f.pitch)),
    lookDown: medianOf(seen.map((f) => f.lookDown || 0)),
    hidesFace: visible < 0.5,
  };
}

/** Assemble the stored calibration. */
export function buildCalibration({ neutral, range, screen, paper, lighting, quality, kind = 'full' }) {
  return { v: 2, at: Date.now(), kind, neutral, range, screen, paper, lighting, quality };
}

/** A session-level re-baseline (5 s at the room check) shifts the calm point, keeps the learned range. */
export function sessionCalibration(calib, settle) {
  if (!calib && !settle) return null;
  if (!settle) return calib;
  if (!calib) return { v: 2, kind: 'settle', neutral: settle, range: null, screen: null, paper: null };
  return { ...calib, neutral: { ...calib.neutral, mean: settle.mean, sd: settle.sd, settledAt: Date.now() }, baseNeutral: calib.neutral };
}

// ---------- per frame ----------
/** Each component scaled to the student's own face: 0 = calm, 1 = their strongest. */
export function scaledComponents(comp, calib) {
  if (!comp || !calib?.neutral) return null;
  const F = EXPRESSION.floor;
  const N = calib.neutral, base = calib.baseNeutral || N, R = calib.range;
  const out = {};
  for (const c of COMPONENTS) {
    const sd = N.sd?.[c] ?? 0.02;
    const scaleFromRange = R?.max ? R.max[c] - base.mean[c] : 0;
    const scale = Math.max(scaleFromRange, F[c], 4 * sd);
    out[c] = Math.max(0, Math.min(1.25, (comp[c] - N.mean[c] - EXPRESSION.deadbandSd * sd) / scale));
  }
  return out;
}

/** Strain 0..1 for one frame. People show effort in different channels (one furrows, another
 *  presses the lips), so the strongest single channel leads and the weighted blend adds breadth. */
export function strainOf(comp, calib) {
  const n = scaledComponents(comp, calib);
  if (!n) return null;
  const W = EXPRESSION.weights, K = EXPRESSION.peakWeight;
  let blend = 0, w = 0, peak = 0;
  for (const c of COMPONENTS) {
    blend += W[c] * n[c];
    w += W[c];
    peak = Math.max(peak, K[c] * n[c]);
  }
  return Math.max(0, Math.min(1, 0.6 * peak + 0.4 * (blend / w)));
}

/** What the student is doing in this frame. */
export function frameState(sample, quality, calib) {
  if (!sample || !sample.faces) return 'absent';
  if (quality && quality.verdict === 'poor' && !quality.blocks?.every((b) => b.id === 'multi')) return 'poor';
  const A = EXPRESSION.away, Wr = EXPRESSION.writing;
  const S = calib?.screen, P = calib?.paper;
  const yaw = sample.yaw ?? 0, pitch = sample.pitch ?? 0, down = sample.lookDown ?? 0;

  // Writing: head/eyes towards the learned paper posture (sign-agnostic: whichever side the paper was).
  // If the paper posture barely differed from the screen, fall back to the eyes looking down.
  const paperDistinct = P && P.pitch != null && S && Math.abs(P.pitch - (S.pitch[0] + S.pitch[1]) / 2) >= 6;
  if (paperDistinct) {
    const mid = (S.pitch[0] + S.pitch[1]) / 2;
    const towardPaper = Math.sign(P.pitch - mid) || 1;
    const edge = towardPaper > 0 ? S.pitch[1] : S.pitch[0];
    const beyond = (pitch - edge) * towardPaper;
    if (beyond > Wr.pitchMargin || (down > Math.max(Wr.lookDown, (P.lookDown || 0) * 0.7) && beyond > 0)) return 'writing';
  } else if (down > Wr.lookDown + 0.08) {
    return 'writing';
  }

  // Away: outside the learned screen envelope (or a generic one), sideways.
  const yawLo = S ? S.yaw[0] - A.yawMargin : -28, yawHi = S ? S.yaw[1] + A.yawMargin : 28;
  const side = Math.max(A.sideways, S?.sideways ? S.sideways + 0.15 : 0);
  if (yaw < yawLo || yaw > yawHi || (sample.sideways ?? 0) > side) return 'away';
  if (S) {
    const pLo = S.pitch[0] - A.pitchMargin, pHi = S.pitch[1] + A.pitchMargin;
    if (pitch < pLo || pitch > pHi) return 'away';
  }
  return 'reading';
}

export const STATE_CHAR = { reading: 'r', writing: 'w', away: 'a', absent: 'n', poor: 'p', none: 'x' };
export const CHAR_STATE = Object.fromEntries(Object.entries(STATE_CHAR).map(([k, v]) => [v, k]));
export const STATE_LABEL = { reading: 'Reading / thinking', writing: 'Writing (rough work)', away: 'Looking away', absent: 'Face not in view', poor: 'Picture too poor to read', none: 'No camera data' };

/** Calibration age and completeness, for "is it time to recalibrate?" */
export function calibrationStatus(calib, now = Date.now()) {
  if (!calib || calib.v !== 2) return { ok: false, reason: 'missing' };
  const days = (now - calib.at) / 86400000;
  if (!calib.neutral) return { ok: false, reason: 'missing' };
  if (days > EXPRESSION.calib.staleDays) return { ok: false, reason: 'stale', days };
  return { ok: true, days, hasRange: !!calib.range, hasScreen: !!calib.screen, hasPaper: !!calib.paper };
}
