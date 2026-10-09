// Demo data: a simulated student who sat four mini mocks. The generator emits the same event log
// and the same per-second expression trace a live test produces, so every report is computed by
// the real engine. Also used to build full sessions for the mentor workspace's sample students.
import { store } from '../store.js';
import { createSession, createDrill, QMAP } from './paper.js';
import { analyze, clearAnalysisCache } from './report.js';
import { buildVisits } from './features.js';
import { pickReviewSet } from './review.js';
import { rng, hashStr, clamp } from '../ui.js';
import { COMPONENTS } from '../face/expression.js';

// Probability correct on a medium question, and time multiplier on expected time.
export const ABILITY = {
  'Projectile Motion': { acc: 0.86, speed: 0.8 },
  'Rotational Dynamics': { acc: 0.24, speed: 2.05 },
  'DC Circuits': { acc: 0.74, speed: 1.0 },
  'Mole Concept': { acc: 0.9, speed: 0.75 },
  'Chemical Equilibrium': { acc: 0.32, speed: 0.55 },
  'General Organic Chemistry': { acc: 0.66, speed: 1.05 },
  'Quadratic Equations': { acc: 0.82, speed: 0.9 },
  'Definite Integrals': { acc: 0.84, speed: 1.85 },
  'Probability': { acc: 0.56, speed: 1.15 },
  'Cell Cycle and Cell Division': { acc: 0.88, speed: 0.8 },
  'Photosynthesis': { acc: 0.34, speed: 0.55 },
  'Principles of Inheritance': { acc: 0.26, speed: 1.95 },
  'Body Fluids and Circulation': { acc: 0.86, speed: 1.75 },
  'Breathing and Exchange of Gases': { acc: 0.9, speed: 0.8 },
  'Human Reproduction': { acc: 0.7, speed: 1.0 },
};
const HARD_TOPICS = new Set(['Rotational Dynamics', 'Principles of Inheritance']);
// Share of time spent writing (head down) by subject: calculation-heavy subjects need rough work.
const WRITING = { Physics: 0.38, Chemistry: 0.26, Mathematics: 0.46, Botany: 0.07, Zoology: 0.07 };

export const SCENARIOS = [
  { jitters: true, switchCost: true, freeze: true },
  { lateCollapse: true, flip: true, switchCost: true },
  { panicRun: true, flip: true, lowLight: true },
  { panicRun: true, flip: true, freeze: true, switchCost: true },
];
const DAYS_AGO = [21, 14, 7, 1];

function lognormal(r, sigma) {
  const u = Math.max(1e-6, r()), v = r();
  return Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
}

/**
 * Simulate one sitting: events, responses, and a behaviour plan per question.
 * ability: topic -> {acc, speed}; k: practice index (later sittings are a little better).
 */
export function simulateOne(s, k, r, scOverride = null, ability = ABILITY) {
  const sc = scOverride || SCENARIOS[k % SCENARIOS.length];
  const ev = [];
  let t = 0;
  const push = (type, data = {}) => ev.push({ t: Math.round(t), type, ...data });
  const saved = {};
  const marked = new Set();
  const plan = {};
  const n = s.paper.length;
  const sectionStarts = new Set(s.sections.slice(1).map((x) => x.start));
  let flipBudget = sc.flip ? 2 : 0;
  let panicLeft = 0, panicDone = false, freezeDone = false;
  const panicQs = new Set();
  let panicTrigger = null;
  const ab = (q) => ability[q.topic] || { acc: 0.6, speed: 1 };
  const writingFor = (q) => clamp((WRITING[q.subject] ?? 0.15) + (q.type === 'numerical' ? 0.15 : 0) + (r() - 0.5) * 0.12, 0, 0.7);

  push('start');
  for (let i = 0; i < n; i++) {
    const p = s.paper[i];
    const q = QMAP.get(p.id);
    const a = ab(q);
    const exp = p.expectedSec;
    let accP = clamp(a.acc + 0.035 * k - 0.13 * (q.difficulty - 2), 0.05, 0.97);
    let speed = a.speed * lognormal(r, 0.22) * (1 + 0.2 * (q.difficulty - 2));
    if (sc.jitters && i < 5) speed *= 1.7;
    if (sc.switchCost && [...sectionStarts].some((st) => i >= st && i < st + 3)) speed *= 2.1;
    if (sc.lateCollapse && i >= n * 0.78) { accP *= 0.35; speed *= 0.6; }

    push('enter', { q: p.id });
    if (panicLeft > 0) {
      t += (3 + r() * 5) * 1000;
      panicQs.add(p.id);
      marked.add(i);
      panicLeft--;
      plan[p.id] = { kind: 'avoid', level: 0.45 + r() * 0.2, onset: 'early', writing: 0 };
      push('leave', { q: p.id });
      continue;
    }
    const hardQ = HARD_TOPICS.has(q.topic) || (q.difficulty === 3 && a.acc < 0.7);
    if (sc.freeze && !freezeDone && hardQ && i > 2 && (panicDone || !sc.panicRun)) {
      freezeDone = true;
      t += 20000;
      push('idle', { q: p.id, dur: 118000 });
      t += 118000;
      t += 12000;
      marked.add(i);
      plan[p.id] = { kind: 'avoid', level: 0.6 + r() * 0.15, onset: 'late', writing: writingFor(q) * 0.5 };
      push('leave', { q: p.id });
      continue;
    }
    const triggerPanic = sc.panicRun && !panicDone && hardQ && i < n - 4;
    const skipP = (q.difficulty === 3 ? 0.3 : 0.08) * (a.acc < 0.5 ? 1.5 : 1);
    if (r() < skipP && !triggerPanic) {
      const dwell = 12 + r() * 22;
      t += dwell * 1000;
      marked.add(i);
      plan[p.id] = hardQ || a.acc < 0.5 ? { kind: 'avoid', level: 0.38 + r() * 0.18, onset: 'early', writing: 0 } : { kind: 'calm', level: 0.12, writing: 0 };
      push('leave', { q: p.id });
      continue;
    }
    let dwell = exp * speed * 0.82;
    if (triggerPanic) dwell = Math.max(dwell, exp * 2.4);
    const correct = r() < accP;
    let finalSel, firstSel;
    if (q.type === 'mcq') {
      const wrongs = [0, 1, 2, 3].filter((x) => x !== q.answer);
      // Some wrong options are traps: the first distractor is picked more often.
      const wrong = r() < 0.55 ? wrongs[0] : wrongs[1 + Math.floor(r() * 2)];
      if (correct) {
        finalSel = q.answer;
        firstSel = r() < 0.12 ? wrong : q.answer;
      } else {
        finalSel = wrong;
        firstSel = flipBudget > 0 && r() < 0.55 ? (flipBudget--, q.answer) : wrong;
      }
    } else {
      const off = q.answer >= 10 ? Math.round(1 + r() * 4) : 1;
      finalSel = String(correct ? q.answer : q.answer + off);
      firstSel = finalSel;
    }
    if (dwell > 60) {
      const idle = dwell * (0.18 + r() * 0.2);
      t += (dwell * 0.3) * 1000;
      push('idle', { q: p.id, dur: Math.round(idle * 1000) });
      t += idle * 1000;
      t += (dwell * 0.2) * 1000;
    } else {
      t += dwell * 0.5 * 1000;
    }
    push('select', { q: p.id, v: firstSel, prev: null });
    if (String(firstSel) !== String(finalSel)) {
      t += dwell * 0.15 * 1000;
      push('select', { q: p.id, v: finalSel, prev: firstSel });
    }
    t += Math.max(1, dwell * 0.12) * 1000;
    push('save', { q: p.id, v: finalSel });
    saved[p.id] = finalSel;
    // The face: slow topics strain even when right (fragile); fast-and-wrong topics stay calm (blind spots).
    const slow = speed >= 1.3, fast = a.speed <= 0.8;
    let kind, level, onset;
    if (triggerPanic) { kind = 'panic'; level = 0.72 + r() * 0.12; onset = 'early'; }
    else if (correct) {
      if (slow || (q.difficulty === 3 && r() < 0.5)) { kind = 'fragile'; level = 0.34 + r() * 0.26; onset = r() < 0.5 ? 'late' : 'early'; }
      else { kind = 'calm'; level = 0.06 + r() * 0.12; }
    } else if (fast) { kind = 'blind'; level = 0.08 + r() * 0.12; }
    else { kind = 'gap'; level = 0.4 + r() * 0.3; onset = hardQ ? 'early' : r() < 0.6 ? 'late' : 'early'; }
    plan[p.id] = { kind, level, onset, writing: writingFor(q), answered: true };
    if (!correct && r() < 0.35) { marked.add(i); push('mark', { q: p.id, on: true }); }
    push('leave', { q: p.id });
    if (triggerPanic) { panicDone = true; panicLeft = 3; panicTrigger = p.id; }
  }

  // Second pass over marked / skipped questions.
  for (const i of [...marked].sort((x, y) => x - y)) {
    const p = s.paper[i];
    const q = QMAP.get(p.id);
    const a = ab(q);
    const dwell = p.expectedSec * (0.5 + r() * 0.6) * (HARD_TOPICS.has(q.topic) ? 1.4 : 1);
    push('enter', { q: p.id });
    t += dwell * 0.7 * 1000;
    if (r() < 0.65) {
      const correct = r() < clamp(a.acc + 0.03 * k - 0.1, 0.05, 0.95);
      const wrongs = [0, 1, 2, 3].filter((x) => x !== q.answer);
      const v = q.type === 'mcq' ? (correct ? q.answer : r() < 0.55 ? wrongs[0] : wrongs[1 + Math.floor(r() * 2)]) : String(correct ? q.answer : q.answer + 2);
      const prev = saved[p.id] ?? null;
      push('select', { q: p.id, v, prev });
      t += dwell * 0.3 * 1000;
      push('save', { q: p.id, v });
      saved[p.id] = v;
      const pl = plan[p.id];
      if (pl && !pl.answered) Object.assign(pl, correct ? { kind: pl.level > 0.4 ? 'fragile' : 'calm' } : { kind: pl.level > 0.4 ? 'gap' : 'blind' }, { answered: true });
    } else {
      t += dwell * 0.3 * 1000;
    }
    if (r() < 0.25 || !(p.id in saved)) push('mark', { q: p.id, on: false });
    push('leave', { q: p.id });
  }

  const limit = s.durationSec * 1000 * 0.96;
  if (t > limit) {
    const f = limit / t;
    for (const e of ev) { e.t = Math.round(e.t * f); if (e.dur) e.dur = Math.round(e.dur * f); }
    t = limit;
  }
  push('end', { reason: 'submit' });
  s.events = ev;
  s.elapsedMs = Math.round(t);
  for (const p of s.paper) {
    s.responses[p.id] = { saved: saved[p.id] ?? null, marked: marked.has(s.paper.indexOf(p)) && !(p.id in saved), visited: true };
  }
  if (s.face?.enabled) synthTrace(s, plan, sc, r);
  return { panicQs, trigger: panicTrigger, plan };
}

/** A calibration like the camera room would save, for simulated students. */
export function syntheticCalibration(r = Math.random, at = Date.now()) {
  const mean = { brow: 0.04 + r() * 0.04, press: 0.05 + r() * 0.03, squint: 0.08 + r() * 0.06, frown: 0.02, inner: 0.05, sneer: 0.01 };
  const sd = Object.fromEntries(COMPONENTS.map((c) => [c, 0.012 + r() * 0.01]));
  return {
    v: 2, at, kind: 'full', quality: 92,
    neutral: { mean, sd, n: 48, blinkPerMin: 14 + r() * 8, yaw: 0, pitch: 0, lookDown: 0.12, motion: 0.01 },
    range: { max: { brow: 0.55, press: 0.5, squint: 0.4, frown: 0.25, inner: 0.35, sneer: 0.2 }, ok: { brow: true, press: true }, gain: { brow: 0.5, press: 0.43 } },
    screen: { yaw: [-14, 14], pitch: [-8, 9], sideways: 0.35, corners: [] },
    paper: { visible: 0.9, pitch: -26, lookDown: 0.68, hidesFace: false },
    lighting: { faceMean: 138, faceSd: 37 },
  };
}

/**
 * Per-second expression trace from a behaviour plan, aligned with the event log:
 * reading with strain (onset, ramp, plateau, relief), writing stretches, brief look-aways,
 * poor-light patches, spillover after hard questions, fatigue late in the paper.
 */
export function synthTrace(s, plan, sc = {}, r = Math.random, style = null) {
  const visits = buildVisits(s).sort((a, b) => a.start - b.start);
  const T = Math.max(1, Math.round(s.elapsedMs / 1000));
  const S = new Array(T).fill('x'), V = new Array(T).fill(-1);
  const perQ = {};
  const st = style || { brow: 0.55 + r() * 0.2, press: 0.15 + r() * 0.2, squint: 0.1 + r() * 0.1 };
  const seen = new Set();
  let spill = 0, awayLeft = 0, poorLeft = 0;
  for (const v of visits) {
    const p = plan[v.q] || { kind: 'calm', level: 0.1, writing: 0.1 };
    const a = Math.max(0, Math.round(v.start / 1000)), b = Math.min(T, Math.round(v.end / 1000));
    const dur = b - a;
    if (dur <= 0) continue;
    const revisit = seen.has(v.q);
    seen.add(v.q);
    const strainedKind = ['fragile', 'gap', 'avoid', 'panic'].includes(p.kind);
    const lvl = p.level * (revisit ? 0.72 : 1);
    const onsetSec = p.onset === 'late' ? Math.max(12, dur * (0.4 + r() * 0.15)) : 1 + r() * 7;
    const wLen = Math.floor(dur * (p.writing || 0));
    const ws = a + Math.floor(dur * 0.25), we = ws + wLen;
    const f = (perQ[v.q] ||= { n: 0, read: 0, comp: Object.fromEntries(COMPONENTS.map((c) => [c, 0])), blinks: 0, motion: 0 });
    for (let k = a; k < b; k++) {
      const rel = k - a;
      const fatigue = sc.lateCollapse && k > T * 0.72 ? 0.09 : (k / T) * 0.03;
      f.n += 5;
      if (k >= ws && k < we) { S[k] = 'w'; continue; }
      if (poorLeft > 0) { S[k] = 'p'; poorLeft--; continue; }
      if (sc.lowLight && r() < 0.05) { poorLeft = 2 + Math.floor(r() * 6); S[k] = 'p'; continue; }
      if (awayLeft > 0) { S[k] = 'a'; awayLeft--; continue; }
      if (r() < 0.006 + (strainedKind && rel > onsetSec ? 0.012 : 0) + fatigue * 0.15) { awayLeft = 1 + Math.floor(r() * 3); S[k] = 'a'; continue; }
      if (r() < 0.002) { S[k] = 'n'; continue; }
      S[k] = 'r';
      const base = 0.05 + r() * 0.05 + fatigue + spill;
      let val;
      if (strainedKind && rel >= onsetSec) {
        const ramp = Math.min(1, (rel - onsetSec) / 5);
        val = base + ramp * (lvl - base) + (r() - 0.5) * 0.14;
        if (p.answered && rel > dur * 0.9) val *= 0.6;
      } else {
        val = base + (r() - 0.5) * 0.06 + (r() < 0.03 ? 0.14 : 0) + (p.kind === 'blind' ? 0 : p.level * 0.15);
      }
      val = clamp(val, 0, 1);
      V[k] = Math.round(val * 100);
      f.read += 5;
      f.comp.brow += val * st.brow * 5;
      f.comp.press += val * st.press * 5;
      f.comp.squint += val * st.squint * 5;
      f.comp.frown += val * 0.05 * 5;
      if (r() < 0.3) f.blinks++;
      f.motion += 0.01 + val * 0.02;
    }
    spill = strainedKind && lvl >= 0.55 ? 0.13 : spill * 0.45;
  }
  const str = S.join('');
  s.face = {
    ...(s.face || {}), enabled: true, v: 2,
    trace: { hz: 1, s: str, v: V },
    perQ,
    calib: s.face?.calib || syntheticCalibration(r, s.startedAt || s.createdAt),
    settle: { mean: null, sd: null, n: 40 },
    quality: { frames: T * 5, good: (str.length - (str.match(/p/g) || []).length) * 5, fair: 0, poor: (str.match(/p/g) || []).length * 5, none: 0, reasons: sc.lowLight ? { dark: (str.match(/p/g) || []).length * 5 } : {} },
  };
  return s.face;
}

// Sample proctoring: the demo student was enrolled and checked; a few things got noted.
const PROCTOR_SIM = [['look_away'], [], ['look_away', 'no_face'], ['phone', 'look_away']];
export function simulateProctor(s, k, r, codes = PROCTOR_SIM[k % PROCTOR_SIM.length]) {
  const enters = s.events.filter((e) => e.type === 'enter');
  s.proctor = {
    enabled: true, enrolled: true, identityAtStart: 'match',
    precheck: { at: s.startedAt, mic: false, checks: ['camera', 'face', 'framing', 'light', 'clarity', 'identity', 'phone'].map((id) => ({ id, state: 'ok', detail: '' })) },
    flags: {}, overrides: [], snaps: [],
  };
  codes.forEach((code, i) => {
    const e = enters[Math.floor((0.2 + 0.6 * ((i + 1) / (codes.length + 1))) * enters.length)];
    if (!e) return;
    const dur = Math.round(4000 + r() * 30000);
    s.events.push({ t: e.t + 3000, type: 'proctor', code, q: e.q, dur, snap: code === 'look_away' ? null : s.proctor.snaps.length });
    if (code !== 'look_away') s.proctor.snaps.push({ t: e.t + 3000, code, q: e.q, img: null, sample: true });
    const f = (s.proctor.flags[code] ||= { n: 0, ms: 0 });
    f.n++; f.ms += dur;
  });
  s.events.sort((a, b) => a.t - b.t);
}

function simulatedTags(s, { panicQs, trigger }, r) {
  const { rows } = analyze(s);
  const tags = {};
  for (const qid of s.reviewSet) {
    const row = rows.find((x) => x.qid === qid);
    if (!row) continue;
    let tag;
    if (qid === trigger) tag = 'panicked';
    else if (!row.attempted) tag = panicQs.has(qid) && r() < 0.5 ? 'panicked' : 'blank';
    else if (row.correct) tag = (row.bx?.struggle ?? 0) < 35 ? 'sure' : r() < 0.5 ? 'guessed' : 'sure';
    else if ((row.bx?.struggle ?? 0) > 50) tag = r() < 0.3 ? 'panicked' : 'guessed';
    else tag = r() < 0.6 ? 'sure' : 'guessed';
    tags[qid] = tag;
  }
  return tags;
}

export function loadDemo(exam) {
  store.reset();
  clearAnalysisCache();
  const now = Date.now();
  const profile = {
    id: 'demo',
    name: 'Demo student',
    exam,
    ageBand: '18plus',
    demo: true,
    createdAt: now - 25 * 86400000,
    consent: { behaviour: true, camera: true, coach: true, snapshots: true, sync: false, at: now - 25 * 86400000 },
    prefs: { bank: 'easy', theme: 'system', paceHint: false, fullscreen: true, motion: 'system' },
    examDate: new Date(now + 207 * 86400000).toISOString().slice(0, 10),
    targetScore: 70,
    mentor: { name: 'Ms. Kavita Rao', batch: exam === 'JEE' ? 'JEE XII · A' : 'NEET Dropper · A' },
    // Left unset so the demo student goes through the real camera room (calibration) on their first test.
    calibration: null,
    face: null,
  };
  store.setProfile(profile);
  const tpl = store.template(exam === 'JEE' ? 'jee-mini' : 'neet-mini');
  const seen = new Set();
  for (let k = 0; k < 4; k++) {
    const r = rng(hashStr(`${exam}-demo-${k}`));
    const day = new Date(now - DAYS_AGO[k] * 86400000);
    day.setHours(18, 10 + k * 7, 0, 0);
    const s = createSession(tpl, profile, { seed: hashStr(`${exam}-paper-${k}`), seen, faceEnabled: true, simulated: true, createdAt: day.getTime(), bank: 'standard' });
    s.paper.forEach((p) => seen.add(p.id));
    s.startedAt = day.getTime();
    const panic = simulateOne(s, k, r);
    simulateProctor(s, k, r);
    s.endedAt = s.startedAt + s.elapsedMs;
    s.status = 'review';
    store.putSession(s);
    s.reviewSet = pickReviewSet(s, r);
    s.tags = simulatedTags(s, panic, r);
    s.status = 'done';
    store.putSession(s);
    if (k === 2) {
      const topic = exam === 'JEE' ? 'Rotational Dynamics' : 'Principles of Inheritance';
      const dday = new Date(day.getTime() + 2 * 86400000);
      dday.setHours(19, 30, 0, 0);
      const d = createDrill(profile, { topic, mode: 'normal', createdAt: dday.getTime(), bank: 'standard' });
      if (d) {
        d.simulated = true;
        d.startedAt = dday.getTime();
        d.face.enabled = true;
        const dr = rng(hashStr(`${exam}-drill`));
        const panicD = simulateOne(d, k, dr, { flip: true });
        d.endedAt = d.startedAt + d.elapsedMs;
        d.reviewSet = d.paper.map((p) => p.id);
        d.status = 'done';
        store.putSession(d);
        d.tags = simulatedTags(d, panicD, dr);
        store.putSession(d);
      }
    }
  }
  store.save({ immediate: true });
  clearAnalysisCache();
}
