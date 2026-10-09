// Face-signal quality. Pure functions over pixel data (no DOM), so they run and test in Node.
// Expression reading is only as good as the picture: a washed-out or dark face still gets
// landmarks from MediaPipe, but the blendshapes behind the struggle signal become noise.
// This module decides whether a frame is good enough, says why not, and how to fix it.
import { QUALITY } from '../config.js';

/** Brightness statistics of an RGBA face crop (w x h). */
export function cropStats(data, w, h) {
  const n = w * h;
  const L = new Float32Array(n);
  let sum = 0, hi = 0, lo = 0, left = 0, right = 0;
  const hist = new Array(16).fill(0);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    L[i] = l;
    sum += l;
    if (l >= QUALITY.clipHi) hi++;
    if (l <= QUALITY.clipLo) lo++;
    if (i % w < w / 2) left += l; else right += l;
    hist[Math.min(15, l >> 4)]++;
  }
  const mean = sum / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (L[i] - mean) ** 2;
  const sd = Math.sqrt(v / n);
  // 4-neighbour Laplacian variance over the interior: low means blurred or flat.
  let s1 = 0, s2 = 0, m = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
      s1 += lap; s2 += lap * lap; m++;
    }
  }
  const lapVar = m ? s2 / m - (s1 / m) ** 2 : 0;
  const half = n / 2;
  const balance = mean > 1 ? Math.abs(left / half - right / half) / mean : 0;
  return { mean, sd, hi: hi / n, lo: lo / n, lapVar, balance, hist: hist.map((c) => c / n) };
}

/** Mean brightness of an RGBA image. */
export function meanLuma(data) {
  let s = 0;
  const n = data.length / 4;
  for (let p = 0; p < data.length; p += 4) s += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  return n ? s / n : 0;
}

/** Inner-face crop rectangle (fractions of the frame) from the landmark box: skips hair and background. */
export function innerFace(box) {
  if (!box) return null;
  const x0 = box.cx - box.w * 0.38, x1 = box.cx + box.w * 0.38;
  const y0 = box.cy - box.h * 0.3, y1 = box.cy + box.h * 0.42;
  const c = (v) => Math.min(1, Math.max(0, v));
  return { x: c(x0), y: c(y0), w: c(x1) - c(x0), h: c(y1) - c(y0) };
}

const ISSUE = {
  noface: ['We can’t find your face', 'Sit in front of the camera with your whole face in view.'],
  multi: ['More than one face in view', 'Only you should be in the frame.'],
  far: ['You’re too far from the camera', 'Move closer until your face fills the oval.'],
  near: ['You’re too close to the camera', 'Lean back a little.'],
  left: ['Move a little to your left', 'Centre your face in the oval.'],
  right: ['Move a little to your right', 'Centre your face in the oval.'],
  up: ['Lower yourself or tilt the screen up', 'Your face is too high in the frame.'],
  down: ['Sit up a little', 'Your face is too low in the frame.'],
  washed: ['Too much light on your face', 'Your face is washed out, so expressions can’t be read. Turn the lamp away from you, move back from the window, or dim the screen.'],
  dark: ['Too dark to read your face', 'Add light in front of you: a lamp or a window facing you.'],
  backlit: ['The light is behind you', 'Turn so the window or lamp is in front of you, not behind.'],
  flat: ['Your face looks flat and grey', 'The light is too harsh or too dim to show detail. Try softer light in front of you.'],
  uneven: ['Light falls on one side of your face', 'Face the light straight on so both sides are lit.'],
  blur: ['The picture is blurry', 'Wipe the camera lens and hold still.'],
  pose: ['Face the screen straight on', 'Look at the middle of the screen, chin level.'],
  shaky: ['Hold still for a moment', 'Rest your elbows and keep your head steady.'],
};

/**
 * Assess one frame. sample: { faces, box, yaw, pitch, roll, faceStats, frameMean, jitter }.
 * mode 'room' is strict (the camera room before a test); 'test' is lenient (during a test).
 * Returns { verdict: 'good'|'fair'|'poor', score 0-100, issues: [{id, level, text, fix}], meters }.
 */
export function assessFrame(sample, mode = 'room') {
  const T = QUALITY[mode === 'test' ? 'test' : 'room'];
  const issues = [];
  const add = (id, level) => issues.push({ id, level, text: ISSUE[id][0], fix: ISSUE[id][1] });
  const meters = { light: null, clarity: null, framing: null, still: null, lightZone: null };

  if (!sample || !sample.faces) {
    add('noface', 'block');
    return pack(issues, meters);
  }
  if (sample.faces > 1) add('multi', 'block');

  const b = sample.box;
  if (b) {
    if (b.w < T.minW) add('far', 'block');
    else if (b.w > T.maxW) add('near', 'block');
    if (mode !== 'test') {
      // Raw frames are not mirrored: the student's left is the frame's right.
      if (b.cx < T.cx[0]) add('left', 'block');
      else if (b.cx > T.cx[1]) add('right', 'block');
      if (b.cy < T.cy[0]) add('up', 'block');
      else if (b.cy > T.cy[1]) add('down', 'block');
    }
    const target = (QUALITY.room.minW + QUALITY.room.maxW) / 2;
    const off = Math.hypot(b.cx - 0.5, (b.cy - 0.5) * 0.8) / 0.25;
    const size = Math.abs(b.w - target) / (target - QUALITY.room.minW);
    meters.framing = clamp01(1 - 0.6 * Math.min(1, off) - 0.4 * Math.min(1, size));
  }

  const st = sample.faceStats;
  if (st) {
    // Washed out: clipped whites, or bright with the detail gone (low spread of brightness).
    const washed = st.hi > T.hiMax || st.mean > T.veryBright
      || (st.mean > T.brightMean && st.sd < T.washedSd);
    // Too dark: dim with crushed blacks or no detail. Brightness alone never decides it,
    // so a darker skin tone in good light is not flagged.
    const dark = st.mean < T.veryDark || st.lo > T.loMax
      || (st.mean < T.darkMean && (st.lo > T.darkLo || st.sd < T.flatWarn));
    const backlit = sample.frameMean != null && sample.frameMean - st.mean > T.backlitGap && st.mean < T.backlitMean;
    if (washed) add('washed', 'block');
    else if (dark) add('dark', 'block');
    else if (backlit) add('backlit', 'block');
    else if (st.sd < T.flatBlock) add('flat', 'block');
    else if (st.sd < T.flatWarn) add('flat', 'warn');
    if (!washed && !dark) {
      if (st.balance > T.unevenBlock) add('uneven', 'block');
      else if (st.balance > T.unevenWarn) add('uneven', 'warn');
    }
    if (!washed && !dark && st.sd >= T.flatBlock) {
      if (st.lapVar < T.blurBlock) add('blur', 'block');
      else if (st.lapVar < T.blurWarn) add('blur', 'warn');
    }
    meters.light = clamp01(st.mean / 255);
    meters.lightZone = washed ? 'bright' : dark || backlit ? 'dark' : 'good';
    // Clarity blends contrast and sharpness (log scale), each saturating at a healthy level.
    const c = Math.min(1, st.sd / 52);
    const s = Math.min(1, Math.log10(1 + Math.max(0, st.lapVar)) / Math.log10(1 + 220));
    meters.clarity = clamp01(washed || dark ? Math.min(0.25, 0.5 * c + 0.5 * s) : 0.5 * c + 0.5 * s);
  }

  if (mode !== 'test' && sample.yaw != null) {
    if (Math.abs(sample.yaw) > T.yaw || Math.abs(sample.pitch) > T.pitch || Math.abs(sample.roll) > T.roll) add('pose', 'block');
  }
  if (sample.jitter != null) {
    meters.still = clamp01(1 - sample.jitter / 0.09);
    if (mode !== 'test' && sample.jitter > (T.jitterWarn || 1)) add('shaky', 'warn');
  }
  return pack(issues, meters);
}

function pack(issues, meters) {
  const blocks = issues.filter((x) => x.level === 'block');
  const warns = issues.filter((x) => x.level === 'warn');
  const score = Math.max(0, Math.round(100 - 38 * blocks.length - 10 * warns.length));
  const verdict = blocks.length ? 'poor' : warns.length ? 'fair' : 'good';
  return { verdict, score, issues, blocks, warns, first: blocks[0] || warns[0] || null, meters };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Group issue ids for the room's four gauges. */
export const GAUGE_OF = {
  noface: 'framing', multi: 'framing', far: 'framing', near: 'framing', left: 'framing', right: 'framing', up: 'framing', down: 'framing', pose: 'framing',
  washed: 'light', dark: 'light', backlit: 'light', flat: 'light', uneven: 'light',
  blur: 'clarity', shaky: 'still',
};
