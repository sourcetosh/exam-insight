// Mentor workspace data. Every synthetic student (data/roster.js) sits each batch mock through the
// real engine: the paper comes from the batch seed (so the whole batch sits the same paper), the
// sitting is simulated, the camera's per-second strain trace is drawn with the student's own face
// style, and the trace becomes question-wise struggle exactly as it does for a real student.
// On top of that sit the mentor's two questions: what does the class need re-taught, and who needs
// me, judged only against each student's own past (never against each other, no ranks).
//
// Conventions: every *Pct / *Share value is a 0..1 fraction (like summaryOf().scorePct; format with
// pct()); struggle values are 0..100; mock idx is 0-based (Mock 1 = idx 0).
// Consent: students who do not share behaviour appear with scores only. Their sessions carry no
// trace, their rows no r.bx, and they are left out of every behaviour count (quads, levels, strain).
import { BATCHES, ROSTER, batchById } from '../data/roster.js';
import { store } from '../store.js';
import { createSession, buildPaper, QMAP } from './paper.js';
import { simulateOne, simulateProctor, synthTrace, syntheticCalibration, SCENARIOS, ABILITY } from './simulate.js';
import { questionRows } from './features.js';
import { questionBehaviour, behaviourReport, hasTrace } from './behaviour.js';
import { scoreSession, isCorrect } from './scoring.js';
import { EXPRESSION, PROCTOR } from '../config.js';
import { rng, hashStr, clamp, fmtDur, OPTION_KEYS } from '../ui.js';

export { BATCHES, batchById };

/** When a student needs the mentor, always against their own earlier mocks: a score drop of this
 *  many points (fraction of max), a rise in mean struggle, blind spots in one mock. A serious
 *  proctoring flag (severity >= flagSeverity: phone, someone else, face not visible) in the latest
 *  mock, or missing it, also counts; a look-away alone does not. Mini mocks are noisy (one answer
 *  moves a NEET score ~4 points), so these aim at roughly one student in five.
 *  After changing these, clearMentorCache(). */
export const ATTENTION = { scoreDrop: 0.15, struggleRise: 15, blindSpots: 4, flagSeverity: 2 };

const QUADS = ['mastered', 'fragile', 'blind', 'gap', 'avoided', 'skipped', 'unread', 'unseen'];
const LEVELS = ['calm', 'mild', 'strained', 'high', 'none'];
const STRAINED = EXPRESSION.struggleIdx;
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const ratio = (n, d) => (d ? n / d : null);
const pc = (x) => `${Math.round(x * 100)}%`;
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

// ---------- the cohort's abilities ----------

// Batch topic profiles: [chance right on a medium question, time multiplier] for an average student.
// They carry the story the mentor should find. NEET batches labour over inheritance (gaps, and right
// answers that cost a lot) and rush photosynthesis (calm but wrong: blind spots). JEE batches labour
// over rotational dynamics and definite integrals and rush chemical equilibrium.
// A topic faster than 0.8 is one the engine treats as "rushed": wrong answers there stay calm.
const NEET_TOPICS = {
  'Projectile Motion': [0.7, 1.02],
  'Rotational Dynamics': [0.52, 1.3],
  'DC Circuits': [0.64, 1.05],
  'Mole Concept': [0.76, 1.02],
  'Chemical Equilibrium': [0.64, 1.02],
  'General Organic Chemistry': [0.62, 1.05],
  'Cell Cycle and Cell Division': [0.82, 1.02],
  'Photosynthesis': [0.5, 0.62],
  'Principles of Inheritance': [0.3, 1.95],
  'Body Fluids and Circulation': [0.76, 1.04],
  'Breathing and Exchange of Gases': [0.82, 1.02],
  'Human Reproduction': [0.72, 1.02],
};
const JEE_TOPICS = {
  'Projectile Motion': [0.74, 1.02],
  'Rotational Dynamics': [0.32, 1.95],
  'DC Circuits': [0.68, 1.04],
  'Mole Concept': [0.8, 1.02],
  'Chemical Equilibrium': [0.4, 0.6],
  'General Organic Chemistry': [0.62, 1.05],
  'Quadratic Equations': [0.74, 1.02],
  'Definite Integrals': [0.62, 1.85],
  'Probability': [0.62, 1.06],
};
// shift: the whole batch is a little stronger (droppers) or weaker (school batches); extra: a quirk.
const BATCH_TOPICS = {
  'neet-dropper-a': { base: NEET_TOPICS, shift: 0.04 },
  'neet-xii-b': { base: NEET_TOPICS, shift: -0.03, extra: { 'General Organic Chemistry': [0.48, 1.35] } },
  'jee-xii-a': { base: JEE_TOPICS, shift: -0.02 },
  'jee-dropper-b': { base: JEE_TOPICS, shift: 0.04, extra: { Probability: [0.52, 1.3] } },
};
// Change per mock on top of the engine's own practice effect (+0.035 accuracy per sitting), so a
// "flat" student edges up, an improving one climbs and a declining one slides.
const TREND = { '-1': { acc: -0.09, speed: 0.06 }, 0: { acc: -0.005, speed: 0 }, 1: { acc: 0.025, speed: -0.02 } };

/** A stable 0..1 trait of a student that the roster does not show (nerves, and so on). */
const trait = (st, key) => rng(hashStr(`${st.id}|${key}`))();

/** topic -> { acc, speed } for one student at one mock: batch profile + theta + the student's own
 *  lean on each topic (stable) + their trend over the mocks + this week's wobble. On a topic the
 *  batch rushes, careful students slow down instead, so their misses show as strain, not calm. */
export function abilityFor(st, idx) {
  const cfg = BATCH_TOPICS[st.batchId] || {};
  const drift = TREND[st.trend] || TREND[0];
  const careful = trait(st, 'care') < 0.55;
  const out = {};
  for (const topic of Object.keys(ABILITY)) {
    const [acc0, spd0] = cfg.extra?.[topic] || cfg.base?.[topic] || [ABILITY[topic].acc, ABILITY[topic].speed];
    const lean = rng(hashStr(`${st.id}|${topic}`));
    const week = rng(hashStr(`${st.id}|${topic}|${idx}`));
    const acc = acc0 + (cfg.shift || 0) + 0.2 * st.theta + 0.08 * gauss(lean) + drift.acc * idx + 0.02 * gauss(week);
    const base = spd0 < 0.8 && careful ? spd0 * 1.45 : spd0;
    const speed = base * Math.exp(-0.12 * st.theta + 0.1 * gauss(lean) + drift.speed * idx + 0.04 * gauss(week));
    out[topic] = { acc: clamp(acc, 0.05, 0.95), speed: clamp(speed, 0.45, 2.8) };
  }
  return out;
}

/** Mostly an ordinary sitting ({}); nervous students, and declining ones later on, hit a bad pattern. */
function scenarioFor(st, idx) {
  const r = rng(hashStr(`${st.id}|scenario|${idx}`));
  const p = 0.06 + 0.16 * trait(st, 'nerves') + (st.trend < 0 ? 0.07 * idx : 0);
  return r() < p ? SCENARIOS[Math.floor(r() * SCENARIOS.length)] : {};
}

const PROCTOR_CODES = [['look_away', 0.42], ['no_face', 0.24], ['phone', 0.2], ['multi_face', 0.14]];
function proctorCodes(r) {
  if (r() >= 0.1) return [];
  const n = r() < 0.7 ? 1 : 2;
  const codes = [];
  while (codes.length < n) {
    let x = r();
    const c = PROCTOR_CODES.find(([, w]) => (x -= w) < 0)?.[0] || 'look_away';
    if (!codes.includes(c)) codes.push(c);
  }
  return codes;
}

// About 4% of sittings are missed, more often by students who are sliding.
const absentFrom = (st, idx) => rng(hashStr(`${st.id}|absent|${idx}`))() < (st.trend < 0 ? 0.09 : 0.03);
const cohortProfile = (exam) => ({ exam, ageBand: '18plus', consent: { behaviour: true, camera: true } });

// ---------- caches ----------
// A cached sitting keeps its session and a compact per-question record (all the class views
// need). Full rows, with the per-second face trace of every question, are rebuilt on demand for
// drill-downs and kept in small LRUs, so a batch costs a few MB rather than tens.
function lru(max) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); return v; },
    clear() { m.clear(); },
  };
}
const papers = new Map();     // batchId -> [{ paper, sections, seen }] per mock
const sims = new Map();       // `${studentId}:${idx}` -> { key, s, lite } | null (absent)
const youSims = new Map();    // signature of the device student's real session -> { key, s, lite }
const rowsLru = lru(64);      // sitting key -> { s, rows, visits }
const fullLru = lru(32);      // sitting key -> studentMock() result
const entries = new Map();    // `${studentId}:${idx}` -> per-mock summary entry
const summaries = new Map();  // `${studentId}:${upto}` -> summaryAt()
const stats = new Map();      // `${batchId}:${idx}|${youKey}` -> batchQuestionStats()
const reteaches = new Map();
const batchSums = new Map();

/** Drop every cached simulation and aggregate (e.g. after a template edit). */
export function clearMentorCache() {
  for (const m of [papers, sims, youSims, rowsLru, fullLru, entries, summaries, stats, reteaches, batchSums]) m.clear();
}

/** The batch's papers, oldest first. Each mock avoids questions earlier mocks used, where the bank allows. */
function batchPapers(b) {
  if (papers.has(b.id)) return papers.get(b.id);
  const tpl = store.template(b.tpl);
  const used = new Set();
  const out = b.mocks.map((m) => {
    const seen = new Set(used);
    const { paper, sections } = buildPaper(tpl, { seed: m.seed, seen, bank: tpl.bank || 'standard' });
    paper.forEach((p) => used.add(p.id));
    return { paper, sections, seen };
  });
  papers.set(b.id, out);
  return out;
}

const layoutOf = (b) => store.template(b.tpl)?.layout || 'cbt';
/** Option label as the paper prints it: (1)..(4) on an OMR paper, A..D on screen. */
export function optionLabel(batchId, i) {
  const b = batchById(batchId);
  return b && layoutOf(b) === 'omr' ? `(${Number(i) + 1})` : OPTION_KEYS[i];
}

function withRows(s) {
  const { rows, visits } = questionRows(s);
  questionBehaviour(s, rows, visits);
  return { s, rows, visits };
}

/** One sitting as the cache keeps it: the session, plus per question (by qid) what the class
 *  views read. struggle / quadrant / level are null when the student does not share behaviour. */
function sitting(key, s) {
  const { rows } = withRows(s);
  const lite = new Map(rows.map((r) => [r.qid, {
    n: r.n, topic: r.topic, attempted: r.attempted, correct: r.correct, final: r.final, visits: r.visits, timeSec: r.timeSec,
    struggle: r.bx ? r.bx.struggle : null, quadrant: r.bx ? r.bx.quadrant : null, level: r.bx ? r.bx.level : null,
  }]));
  return { key, s, lite };
}

/** One synthetic sitting, through the real engine. Null when the student was absent. */
function simulate(st, idx) {
  const b = batchById(st.batchId);
  const m = b?.mocks[idx];
  if (!m || absentFrom(st, idx)) return null;
  const tpl = store.template(b.tpl);
  const r = rng(hashStr(`${st.id}|sit|${idx}`));
  const at = m.at + Math.floor(r() * 5) * 60000; // seated within a few minutes of the start
  const s = createSession(tpl, cohortProfile(b.exam), { seed: m.seed, seen: batchPapers(b)[idx].seen, faceEnabled: true, simulated: true, createdAt: at, bank: 'standard' });
  Object.assign(s, { id: `bm-${st.id}-${idx}`, studentId: st.id, batchMock: `${b.id}:${idx}`, mockName: m.name, startedAt: at });
  const sc = scenarioFor(st, idx);
  // simulateOne would draw the trace with a random face; it is drawn just below with this
  // student's own, stable face style (and calm-face calibration) instead.
  s.face.enabled = false;
  const { plan } = simulateOne(s, idx, r, sc, abilityFor(st, idx));
  s.face.calib = syntheticCalibration(rng(hashStr(`${st.id}|calib`)), at);
  synthTrace(s, plan, sc, r, st.style);
  const pr = rng(hashStr(`${st.id}|proctor|${idx}`));
  simulateProctor(s, idx, pr, proctorCodes(pr));
  if (!st.consent.snapshots) {
    s.proctor.snaps = [];
    for (const e of s.events) if (e.type === 'proctor') e.snap = null;
  }
  s.endedAt = at + s.elapsedMs;
  s.endReason = 'submit';
  s.status = 'done';
  s.simScenario = SCENARIOS.indexOf(sc); // -1: an ordinary sitting
  if (!st.consent.behaviour) withhold(s);
  return sitting(`${st.id}:${idx}`, s);
}

/** What a mentor gets from a student who does not share behaviour: answers and timing, no face. */
function withhold(s) {
  s.face = { enabled: false, perQ: {}, withheld: true };
  s.analytics = 'basic';
  return s;
}

// ---------- the student using this device ----------
let youMemo = { p: undefined, st: null };
/** The real student on this device, placed in their mentor's batch (or the first batch of their exam). */
function youStudent() {
  const p = store.profile;
  if (!p) return null;
  if (youMemo.p === p) return youMemo.st;
  const b = BATCHES.find((x) => x.exam === p.exam && x.name === p.mentor?.batch) || BATCHES.find((x) => x.exam === p.exam);
  let st = null;
  if (b) {
    const name = String(p.name || '').trim() || 'You';
    const [first, ...rest] = name.split(/\s+/);
    const c = p.consent || {};
    st = {
      id: 'you', first, last: rest.join(' '), name, isYou: true, gender: null,
      roll: `${b.code}-${String(b.size + 1).padStart(3, '0')}`, batchId: b.id, exam: b.exam, hue: hashStr(name) % 360,
      consent: { behaviour: !!(c.coach && c.behaviour), snapshots: !!c.snapshots },
      theta: null, trend: null, style: null,
    };
  }
  youMemo = { p, st };
  return st;
}

/** The device student's own completed session for a batch mock (latest wins), never modified. */
function youSession(batchId, idx) {
  let found = null;
  for (const s of store.sessions({ status: 'done' })) if (s.batchMock === `${batchId}:${idx}`) found = s;
  return found;
}

function youSim(st, idx) {
  const s0 = youSession(st.batchId, idx);
  if (!s0) return null;
  const key = `you|${s0.id}:${s0.events?.length}:${s0.status}:${s0.elapsedMs}:${st.consent.behaviour}`;
  if (!youSims.has(key)) youSims.set(key, sitting(key, st.consent.behaviour ? s0 : withhold({ ...s0 })));
  return youSims.get(key);
}

/** Cache key part that changes when the device student's data for this batch changes. */
function youKey(batchId, idxs) {
  const me = youStudent();
  if (!me || me.batchId !== batchId) return '';
  return [me.name, me.consent.behaviour, ...idxs.map((i) => { const s = youSession(batchId, i); return s ? `${s.id}.${s.events?.length}` : '-'; })].join('|');
}

function simFor(st, idx) {
  if (st.isYou) return youSim(st, idx);
  const key = `${st.id}:${idx}`;
  if (!sims.has(key)) sims.set(key, simulate(st, idx));
  return sims.get(key);
}

/** Full rows (with r.bx) for a sitting, rebuilt from the session when not in the LRU. */
function rowsOf(st, idx) {
  const sim = simFor(st, idx);
  if (!sim) return null;
  return rowsLru.get(sim.key) || rowsLru.set(sim.key, withRows(sim.s));
}

// ---------- students ----------

/** Students of a batch in roll order, with the device student (isYou) last when they belong here. */
export function students(batchId) {
  const list = ROSTER.get(batchId) || [];
  const me = youStudent();
  return me && me.batchId === batchId ? [...list, me] : list;
}

const BY_ID = new Map([...ROSTER.values()].flat().map((st) => [st.id, st]));
export function studentById(id) {
  return id === 'you' ? youStudent() : BY_ID.get(id) || null;
}

/** Mock index as a number (route params arrive as strings); NaN when missing. */
const toIdx = (i) => (i == null || i === '' ? NaN : Number(i));
const okIdx = (st, idx) => !!st && Number.isInteger(idx) && !!batchById(st.batchId)?.mocks[idx];

/** The session behind a batch mock (cached); null if the student was absent. */
export function mockSession(studentId, idx) {
  const st = studentById(studentId);
  idx = toIdx(idx);
  return okIdx(st, idx) ? simFor(st, idx)?.s || null : null;
}

/** Rows for that session, with r.bx when the student shares behaviour (rebuilt on demand, LRU-cached). */
export function mockRows(studentId, idx) {
  const st = studentById(studentId);
  idx = toIdx(idx);
  return okIdx(st, idx) ? rowsOf(st, idx)?.rows || null : null;
}

/** { s, rows, visits, bx: behaviourReport(s, rows), score: scoreSession(s), shared, student } or null. */
export function studentMock(studentId, idx) {
  const st = studentById(studentId);
  idx = toIdx(idx);
  if (!okIdx(st, idx)) return null;
  const sim = simFor(st, idx);
  if (!sim) return null;
  const hit = fullLru.get(sim.key);
  if (hit) return hit;
  const { rows, visits } = rowsOf(st, idx);
  return fullLru.set(sim.key, { s: sim.s, rows, visits, bx: behaviourReport(sim.s, rows), score: scoreSession(sim.s), shared: hasTrace(sim.s), student: st });
}

// ---------- one student's mocks, against their own past ----------

/** Proctoring and window flags in one sitting, with the question that was open (byQ: qid -> { n, topic }). */
function flagsOf(s, byQ) {
  const snaps = s.proctor?.snaps || [];
  const out = [];
  for (const e of s.events || []) {
    const code = e.type === 'proctor' ? e.code : e.type === 'blur' || e.type === 'fs_exit' ? e.type : null;
    if (!code) continue;
    const d = PROCTOR.flags[code] || { label: code, severity: 1 };
    const r = e.q != null ? byQ.get(e.q) : null;
    out.push({ code, label: d.label, severity: d.severity || 1, t: e.t, dur: e.dur ?? null, n: r?.n ?? null, topic: r?.topic ?? null, snap: e.snap != null && !!snaps[e.snap] });
  }
  return out.sort((a, b) => a.t - b.t);
}

function coverageOf(s) {
  const S = s.face.trace.s;
  let n = 0;
  for (const ch of S) if (ch === 'r' || ch === 'w') n++;
  return S.length ? n / S.length : 0;
}

function entryOf(st, idx) {
  const key = st.isYou ? null : `${st.id}:${idx}`;
  if (key && entries.has(key)) return entries.get(key);
  const m = batchById(st.batchId).mocks[idx];
  const sim = simFor(st, idx);
  let e = { idx, name: m.name, at: m.at, sat: !!sim };
  if (!sim) {
    e = { ...e, shared: null, score: null, max: null, scorePct: null, accuracy: null, attempted: null, correct: null, wrong: null, blank: null, meanStruggle: null, readable: null, mastered: null, fragile: null, blind: null, gaps: null, avoided: null, flags: [], coverage: null };
  } else {
    const sc = scoreSession(sim.s);
    const shared = hasTrace(sim.s);
    const q = zeros(QUADS);
    let readable = 0, sum = 0;
    for (const r of sim.lite.values()) {
      if (r.quadrant == null) continue;
      q[r.quadrant]++;
      if (r.struggle != null) { readable++; sum += r.struggle; }
    }
    const b = (x) => (shared ? x : null);
    e = {
      ...e, shared, at: sim.s.startedAt || m.at,
      score: sc.score, max: sc.max, scorePct: sc.max ? sc.score / sc.max : 0, accuracy: sc.accuracy,
      attempted: sc.attempted, correct: sc.correct, wrong: sc.wrong, blank: sc.unattempted,
      meanStruggle: shared && readable ? Math.round(sum / readable) : null, readable: b(readable),
      mastered: b(q.mastered), fragile: b(q.fragile), blind: b(q.blind), gaps: b(q.gap), avoided: b(q.avoided),
      flags: flagsOf(sim.s, sim.lite), coverage: shared ? coverageOf(sim.s) : null,
    };
  }
  if (key) entries.set(key, e);
  return e;
}

const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const joinAnd = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** The summary as it stood right after mock `upto`: that mock against the student's earlier ones. */
function summaryAt(st, upto) {
  const key = st.isYou ? null : `${st.id}:${upto}`;
  if (key && summaries.has(key)) return summaries.get(key);
  const b = batchById(st.batchId);
  const mocks = b.mocks.slice(0, upto + 1).map((m) => entryOf(st, m.idx));
  const last = mocks[mocks.length - 1];
  const earlier = mocks.slice(0, -1).filter((m) => m.sat);
  const strs = earlier.map((m) => m.meanStruggle).filter((x) => x != null);
  const avgScore = avg(earlier.map((m) => m.scorePct));
  const avgStr = avg(strs);
  const ownAvg = { scorePct: avgScore, meanStruggle: avgStr == null ? null : Math.round(avgStr), n: earlier.length };
  const dScore = last.sat && avgScore != null ? last.scorePct - avgScore : null;
  const dStr = last.meanStruggle != null && avgStr != null ? last.meanStruggle - avgStr : null;
  const delta = { scorePct: dScore, struggle: dStr == null ? null : Math.round(dStr) };

  // Reasons to look, each measured against this student's own earlier mocks only.
  const reasons = [];
  const at = last.name;
  if (!last.sat) reasons.push({ code: 'absent', text: `Absent from ${at}` });
  else {
    if (dScore != null && dScore <= -ATTENTION.scoreDrop + 1e-9) reasons.push({ code: 'drop', text: `Scored ${pc(last.scorePct)} in ${at}, ${Math.round(-dScore * 100)} points below their own average of ${pc(avgScore)}` });
    if (dStr != null && dStr >= ATTENTION.struggleRise) reasons.push({ code: 'struggle', text: `Struggle rose to ${last.meanStruggle} in ${at}, ${Math.round(dStr)} above their usual ${ownAvg.meanStruggle}` });
    if (last.blind != null && last.blind >= ATTENTION.blindSpots) reasons.push({ code: 'blind', text: `${last.blind} blind spots in ${at}: calm, sure and wrong, so they won’t know to fix them` });
    const serious = last.flags.filter((f) => (f.severity || 1) >= ATTENTION.flagSeverity);
    if (serious.length) {
      const labels = [...new Set(serious.map((f) => lc(f.label)))];
      const snaps = serious.filter((f) => f.snap).length;
      reasons.push({ code: 'flags', text: `Proctoring flags in ${at}: ${joinAnd(labels)}${snaps ? ` (${snaps === 1 ? 'a snapshot' : `${snaps} snapshots`} to review)` : ''}` });
    }
  }
  const flags = mocks.flatMap((m) => m.flags.map((f) => ({ ...f, idx: m.idx, mock: m.name })));
  const res = { student: st, mocks, last, ownAvg, delta, attention: reasons.map((x) => x.text), reasons, flags };
  if (key) summaries.set(key, res);
  return res;
}

/**
 * One student across the batch mocks: { student, mocks: [{ idx, name, at, sat, shared, score, max,
 * scorePct, accuracy, attempted, correct, wrong, blank, meanStruggle, readable, mastered, fragile,
 * blind, gaps, avoided, flags: [{ code, label, severity, n, topic, dur, snap }], coverage }], last
 * (the latest batch mock, sat or not), ownAvg: { scorePct, meanStruggle, n } over their earlier mocks,
 * delta: { scorePct, struggle } (last minus ownAvg), attention: [plain-English reasons],
 * reasons: [{ code: absent|drop|struggle|blind|flags, text }], flags: every flag with idx and mock }.
 */
export function studentSummary(studentId) {
  const st = studentById(studentId);
  if (!st) return null;
  return summaryAt(st, batchById(st.batchId).mocks.length - 1);
}

/** studentSummary for every student in the batch (cached). */
export function batchSummaries(batchId) {
  const b = batchById(batchId);
  if (!b) return [];
  const key = `${batchId}|${youKey(batchId, b.mocks.map((m) => m.idx))}`;
  if (!batchSums.has(key)) batchSums.set(key, students(batchId).map((st) => summaryAt(st, b.mocks.length - 1)));
  return batchSums.get(key);
}

// ---------- the class, question by question ----------

/** Re-teach score 0..100 from the shares of the class that got it wrong, strained, were calm but
 *  wrong, or left it blank (weights 0.45 / 0.25 / 0.15 / 0.15), normalised so that "everyone wrong
 *  and strained" scores 100. */
const reteachScore = (wrong, strained, blind, blank) => Math.min(100, Math.round((100 * (0.45 * wrong + 0.25 * strained + 0.15 * blind + 0.15 * blank)) / 0.7));

function shareWords(x) {
  if (x >= 0.9) return 'Nearly the whole class';
  if (x >= 0.7) return 'Most of the class';
  if (x >= 0.62) return 'Two in three';
  if (x >= 0.55) return 'Over half the class';
  if (x >= 0.45) return 'Half the class';
  if (x >= 0.38) return 'Two in five';
  if (x >= 0.3) return 'A third of the class';
  return `${pc(x)} of the class`;
}

/** Plain-English reasons a question needs re-teaching, strongest first (up to three). */
function whyOf(o, lab) {
  if (!o.sat) return [];
  const out = [];
  const add = (w, text) => out.push({ w, text });
  const right = o.quads.mastered + o.quads.fragile;
  const wrongRead = o.quads.blind + o.quads.gap;
  const mw = o.modalWrong;
  if (mw && mw.n >= 3) {
    if (mw.opt != null && mw.share >= 0.2 && mw.ofWrong >= 0.45) {
      if (mw.n > o.correct) add(70 + 100 * mw.share, `More chose ${lab(mw.opt)} than the right answer: ${pc(mw.share)} against ${pc(o.correct / o.sat)}`);
      else add(60 + 100 * mw.share, `${pc(mw.share)} chose ${lab(mw.opt)}: a common trap`);
    } else if (mw.opt == null && mw.share >= 0.2 && mw.ofWrong >= 0.6) add(55 + 100 * mw.share, `${pc(mw.share)} entered ${mw.value}: the same slip`);
  }
  if (o.readable >= 5 && o.strainedPct >= 0.38) {
    const tail = o.quads.fragile >= 3 && o.quads.fragile >= 0.4 * right ? ', even many who got it right' : '';
    add(40 + 80 * o.strainedPct, `${shareWords(o.strainedPct)} strained on it${tail}`);
  } else if (o.quads.fragile >= 4 && o.quads.fragile >= 0.45 * right) {
    add(45, `Strained even when right: ${o.quads.fragile} of ${right} right answers came with strain`);
  }
  if (o.quads.blind >= 3 && o.quads.blind >= 0.35 * wrongRead) add(50 + (200 * o.quads.blind) / Math.max(1, o.readable), `Calm but wrong for ${o.quads.blind} students: a misconception`);
  if (o.quads.gap >= 4 && o.quads.gap >= 0.5 * wrongRead) add(30 + (100 * o.quads.gap) / Math.max(1, o.readable), `Strained and wrong for ${o.quads.gap} students: the idea itself needs re-teaching`);
  const blankS = o.blank / o.sat;
  if (o.blank >= 3 && blankS >= 0.15) add(35 + 100 * blankS, `${o.blank} left it blank${o.quads.avoided >= 3 ? `, ${o.quads.avoided} of them after straining on it` : ''}`);
  if (o.meanTimeSec != null && o.meanTimeSec >= 1.5 * o.expectedSec) add(20 + (10 * o.meanTimeSec) / o.expectedSec, `Took ${fmtDur(o.meanTimeSec)} on average, against ${fmtDur(o.expectedSec)} expected`);
  if (!out.length && o.wrong / o.sat >= 0.3) add(10, `${pc(o.wrong / o.sat)} got it wrong`);
  return out.sort((a, b) => b.w - a.w).slice(0, 3).map((x) => x.text);
}

/**
 * Per paper question, in paper order: { qid, n, q, topic, subject, chapter, type, difficulty, sat,
 * shared, readable, correct, wrong, blank, optCounts: [a,b,c,d] (MCQ; [] for a numerical question,
 * which has no options), valueCounts (numerical only: [{ value, n, correct }]), answer, optLabels
 * ((1)..(4) on OMR papers, A..D on screen; [] for numerical), modalWrong: { opt (null for numerical),
 * value (numerical), n, share (of sat), ofWrong } | null, meanTimeSec, expectedSec, levels, quads,
 * strained, strainedPct (of readable), meanStruggle, byQuad: { quadrant: [studentIds] }, wrongIds,
 * blankIds, reteach (0..100), why: [plain-English lines] }.
 * correct + wrong + blank = sat; MCQ: sum(optCounts) + blank = sat; quads and levels sum to shared.
 */
export function batchQuestionStats(batchId, idx) {
  const b = batchById(batchId);
  idx = toIdx(idx);
  if (!Number.isInteger(idx) || !b?.mocks[idx]) return [];
  const key = `${batchId}:${idx}|${youKey(batchId, [idx])}`;
  if (stats.has(key)) return stats.get(key);
  const { paper } = batchPapers(b)[idx];
  const omr = layoutOf(b) === 'omr';
  const lab = (i) => (omr ? `(${Number(i) + 1})` : OPTION_KEYS[i]);
  const takers = students(batchId).map((st) => ({ st, sim: simFor(st, idx) })).filter((x) => x.sim);
  const out = paper.map((p) => {
    const q = QMAP.get(p.id);
    const mcq = q.type === 'mcq';
    const o = {
      qid: p.id, n: p.n, q, topic: q.topic, subject: q.subject, chapter: q.chapter, type: q.type, difficulty: q.difficulty,
      sat: 0, shared: 0, readable: 0, correct: 0, wrong: 0, blank: 0,
      optCounts: mcq ? [0, 0, 0, 0] : [], valueCounts: null, answer: q.answer, optLabels: mcq ? [0, 1, 2, 3].map(lab) : [], modalWrong: null,
      meanTimeSec: null, expectedSec: p.expectedSec,
      levels: zeros(LEVELS), quads: zeros(QUADS), strained: 0, strainedPct: null, meanStruggle: null,
      byQuad: Object.fromEntries(QUADS.map((k) => [k, []])), wrongIds: [], blankIds: [], reteach: 0, why: [],
    };
    const times = [], strs = [], values = new Map();
    for (const { st, sim } of takers) {
      const r = sim.lite.get(p.id);
      if (!r) continue;
      o.sat++;
      if (!r.attempted) { o.blank++; o.blankIds.push(st.id); }
      else {
        if (r.correct) o.correct++; else { o.wrong++; o.wrongIds.push(st.id); }
        if (mcq) { const k = Number(r.final); if (k >= 0 && k < 4) o.optCounts[k]++; }
        else { const v = String(r.final).trim(); values.set(v, (values.get(v) || 0) + 1); }
      }
      if (r.visits) times.push(r.timeSec);
      if (r.quadrant == null) continue; // this student does not share behaviour
      o.shared++;
      o.quads[r.quadrant]++;
      o.byQuad[r.quadrant].push(st.id);
      o.levels[r.level]++;
      if (r.struggle != null) {
        o.readable++;
        strs.push(r.struggle);
        if (r.struggle >= STRAINED) o.strained++;
      }
    }
    if (mcq) {
      let best = -1;
      for (let k = 0; k < 4; k++) if (k !== q.answer && o.optCounts[k] > 0 && (best < 0 || o.optCounts[k] > o.optCounts[best])) best = k;
      if (best >= 0) o.modalWrong = { opt: best, value: null, n: o.optCounts[best], share: o.optCounts[best] / o.sat, ofWrong: o.optCounts[best] / o.wrong };
    } else {
      o.valueCounts = [...values].map(([value, n]) => ({ value, n, correct: !!isCorrect(q, value) })).sort((a, c) => c.n - a.n);
      const w = o.valueCounts.find((x) => !x.correct);
      if (w) o.modalWrong = { opt: null, value: w.value, n: w.n, share: w.n / o.sat, ofWrong: w.n / o.wrong };
    }
    o.meanTimeSec = avg(times);
    o.strainedPct = ratio(o.strained, o.readable);
    o.meanStruggle = strs.length ? Math.round(avg(strs)) : null;
    o.reteach = o.sat ? reteachScore(o.wrong / o.sat, o.strainedPct ?? 0, ratio(o.quads.blind, o.readable) ?? 0, o.blank / o.sat) : 0;
    o.why = whyOf(o, lab);
    return o;
  });
  stats.set(key, out);
  return out;
}

/**
 * What to re-teach after a batch mock: { questions: stats sorted by reteach (highest first),
 * topics: [{ topic, subject, chapter, qs: [question numbers], wrongPct, blankPct, strainedPct,
 * fragilePct, blindPct, meanStruggle, score }] sorted by score }. Topic shares pool the topic's
 * questions; strained / fragile / blind are shares of readable answers.
 */
export function reteach(batchId, idx) {
  const b = batchById(batchId);
  idx = toIdx(idx);
  if (!Number.isInteger(idx) || !b?.mocks[idx]) return { questions: [], topics: [] };
  const key = `${batchId}:${idx}|${youKey(batchId, [idx])}`;
  if (reteaches.has(key)) return reteaches.get(key);
  const qs = batchQuestionStats(batchId, idx);
  const questions = [...qs].sort((a, c) => c.reteach - a.reteach || c.wrong - a.wrong || a.n - c.n);
  const byTopic = new Map();
  for (const o of qs) {
    const t = byTopic.get(o.topic) || { topic: o.topic, subject: o.subject, chapter: o.chapter, qs: [], sat: 0, wrong: 0, blank: 0, readable: 0, strained: 0, fragile: 0, blind: 0, strSum: 0 };
    t.qs.push(o.n);
    t.sat += o.sat; t.wrong += o.wrong; t.blank += o.blank; t.readable += o.readable; t.strained += o.strained;
    t.fragile += o.quads.fragile; t.blind += o.quads.blind;
    t.strSum += (o.meanStruggle ?? 0) * o.readable;
    byTopic.set(o.topic, t);
  }
  const topics = [...byTopic.values()].map((t) => {
    const wrongPct = ratio(t.wrong, t.sat), blankPct = ratio(t.blank, t.sat);
    const strainedPct = ratio(t.strained, t.readable), fragilePct = ratio(t.fragile, t.readable), blindPct = ratio(t.blind, t.readable);
    return {
      topic: t.topic, subject: t.subject, chapter: t.chapter, qs: t.qs,
      wrongPct, blankPct, strainedPct, fragilePct, blindPct,
      meanStruggle: t.readable ? Math.round(t.strSum / t.readable) : null,
      score: t.sat ? reteachScore(wrongPct, strainedPct ?? 0, blindPct ?? 0, blankPct) : 0,
    };
  }).sort((a, c) => c.score - a.score || (c.wrongPct ?? 0) - (a.wrongPct ?? 0));
  const res = { questions, topics };
  reteaches.set(key, res);
  return res;
}

/**
 * The batch at one mock: { n, sat, absent, avgScorePct, avgStruggle, fragileShare, blindShare,
 * fragileOfRight, blindOfWrong, shared, flagged, needsYou }. fragileShare / blindShare are shares of
 * readable answers; fragileOfRight / blindOfWrong condition on the outcome. needsYou counts students
 * with an attention reason as of this mock (each against their own earlier mocks).
 */
export function batchKpis(batchId, idx) {
  const b = batchById(batchId);
  idx = toIdx(idx);
  if (!Number.isInteger(idx) || !b?.mocks[idx]) return null;
  const list = students(batchId);
  const es = list.map((st) => entryOf(st, idx));
  const sat = es.filter((e) => e.sat);
  let readable = 0, fragile = 0, blind = 0, mastered = 0, gaps = 0;
  for (const e of sat) if (e.shared) { readable += e.readable; fragile += e.fragile; blind += e.blind; mastered += e.mastered; gaps += e.gaps; }
  const strs = sat.map((e) => e.meanStruggle).filter((x) => x != null);
  return {
    n: list.length, sat: sat.length, absent: list.length - sat.length,
    avgScorePct: avg(sat.map((e) => e.scorePct)),
    avgStruggle: strs.length ? Math.round(avg(strs)) : null,
    fragileShare: ratio(fragile, readable), blindShare: ratio(blind, readable),
    fragileOfRight: ratio(fragile, fragile + mastered), blindOfWrong: ratio(blind, blind + gaps),
    shared: sat.filter((e) => e.shared).length,
    flagged: sat.filter((e) => e.flags.length).length,
    needsYou: list.filter((st) => summaryAt(st, idx).attention.length).length,
  };
}
