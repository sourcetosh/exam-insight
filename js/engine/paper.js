// Builds a test paper from a template (or a drill from a topic) and creates a session record.
import { BANK, ALL_QUESTIONS, bankOf, isEasyBank } from '../data/bank.js';
import { EMPIRICAL } from '../data/cohort.js';
import { DIFFICULTY_MULT, THRESHOLDS, POLICY, EASY_TIME_FACTOR, EASY_DURATION_MULT, DRILL } from '../config.js';
import { secPerQ, DEFAULT_TEMPLATES } from '../data/templates.js';
import { store } from '../store.js';
import { rng, shuffle, uid, groupBy, sum } from '../ui.js';

export const QMAP = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));

export const bankFor = (profile) => (profile?.prefs?.bank === 'standard' ? 'standard' : 'easy');

/** Expected time: template rate x difficulty multiplier, replaced by the empirical
 *  median correct time once a question has enough attempts. Test-drive items are scaled. */
export function expectedFor(q, tpl) {
  const emp = EMPIRICAL[tpl.exam]?.[q.id];
  if (emp?.medianCorrectSec && emp.attempts >= THRESHOLDS.empiricalAttempts) {
    return { sec: emp.medianCorrectSec, source: 'empirical', attempts: emp.attempts };
  }
  const easy = isEasyBank(bankOf(q.id)) ? EASY_TIME_FACTOR : 1;
  return { sec: Math.max(10, Math.round(secPerQ(tpl) * DIFFICULTY_MULT[q.difficulty] * easy)), source: 'template', attempts: emp?.attempts ?? 0 };
}

function pickBalanced(cands, n, r, seen) {
  if (n <= 0) return [];
  const lists = [...groupBy(shuffle(cands, r), (q) => q.topic).values()]
    .map((l) => l.sort((a, b) => (seen.has(a.id) ? 1 : 0) - (seen.has(b.id) ? 1 : 0)));
  const order = shuffle(lists, r);
  const out = [];
  while (out.length < n && order.some((l) => l.length)) {
    for (const l of order) {
      if (out.length >= n) break;
      if (l.length) out.push(l.shift());
    }
  }
  return out;
}

export function buildPaper(tpl, { seed = Date.now(), seen = new Set(), bank = 'standard' } = {}) {
  const r = rng(seed);
  const src = BANK[bank] || BANK.standard;
  const paper = [];
  const sections = [];
  const shortfall = [];
  for (const sec of tpl.sections) {
    const pool = src.filter((q) => q.subject === sec.subject && q.exams.includes(tpl.exam));
    const mcq = pickBalanced(pool.filter((q) => q.type === 'mcq'), sec.mcq, r, seen);
    const num = pickBalanced(pool.filter((q) => q.type === 'numerical'), sec.numerical, r, seen);
    const wanted = sec.mcq + sec.numerical;
    const got = mcq.length + num.length;
    if (got < wanted) shortfall.push({ section: sec.name, wanted, got });
    const start = paper.length;
    for (const q of [...mcq, ...num]) {
      const e = expectedFor(q, tpl);
      paper.push({ id: q.id, section: sec.name, subject: sec.subject, expectedSec: e.sec, expSource: e.source });
    }
    sections.push({ name: sec.name, subject: sec.subject, start, end: paper.length });
  }
  paper.forEach((p, i) => { p.n = i + 1; });
  return { paper, sections, shortfall };
}

export function bankCoverage(tpl, bank = 'standard') {
  const src = BANK[tpl.bank || bank] || BANK.standard;
  return tpl.sections.map((sec) => {
    const pool = src.filter((q) => q.subject === sec.subject && q.exams.includes(tpl.exam));
    const mcq = pool.filter((q) => q.type === 'mcq').length;
    const num = pool.filter((q) => q.type === 'numerical').length;
    return { section: sec.name, wanted: sec.mcq + sec.numerical, have: Math.min(mcq, sec.mcq) + Math.min(num, sec.numerical) };
  });
}

/** Rough time allowed for a template with the test-drive bank (shown before the paper exists). */
export function estimateDurationSec(tpl, bank) {
  bank = tpl.bank || bank;
  if (!isEasyBank(bank)) return tpl.totalMin * 60;
  const n = tpl.sections.reduce((s, x) => s + x.mcq + x.numerical, 0);
  return Math.round(n * secPerQ(tpl) * 0.9 * EASY_TIME_FACTOR * EASY_DURATION_MULT);
}

export function analyticsLevel(profile) {
  if (!profile) return 'basic';
  if (profile.ageBand === 'u18' && (!POLICY.UNDER18_BEHAVIOUR_LAYER || !profile.parental)) return 'basic';
  return profile.consent?.behaviour ? 'full' : 'basic';
}

/** Camera checks need full analytics, the student's (or the parent's) consent, and for a child the policy flag. */
export function cameraAllowed(profile) {
  if (analyticsLevel(profile) !== 'full') return false;
  if (profile.ageBand === 'u18' && (!POLICY.UNDER18_CAMERA || !profile.parental)) return false;
  return !!profile.consent?.camera;
}

export const faceEnrolled = (profile) => !!(profile?.face?.descriptors?.length || profile?.face?.thumb);

function baseSession(tpl, profile, paper, sections, { faceEnabled = false, fullscreen = true, simulated = false, createdAt = Date.now(), durationSec, bank }) {
  const responses = {};
  for (const p of paper) responses[p.id] = { saved: null, marked: false, visited: false };
  const analytics = analyticsLevel(profile);
  return {
    id: uid('t'),
    kind: 'mock',
    templateId: tpl.id,
    templateName: tpl.name,
    exam: tpl.exam,
    layout: tpl.layout,
    marking: tpl.marking,
    saveRequired: !!tpl.palette?.saveRequired,
    bank,
    durationSec,
    paper,
    sections,
    shortfall: [],
    analytics,
    face: { enabled: analytics === 'full' && faceEnabled, perQ: {}, dropped: { noFace: 0, lowLight: 0 }, samples: 0, valid: 0 },
    // Filled in at the pre-test check: identity verdict, the checklist at start, flags during the test.
    proctor: analytics === 'full' && faceEnabled ? { enabled: true, enrolled: faceEnrolled(profile), identityAtStart: null, precheck: null, flags: {}, overrides: [] } : { enabled: false },
    fullscreen,
    status: 'ready',
    createdAt,
    startedAt: null,
    endedAt: null,
    elapsedMs: 0,
    lastSavedAt: null,
    responses,
    pending: {},
    cur: 0,
    events: [],
    reviewSet: [],
    tags: {},
    simulated,
    endReason: null,
  };
}

export function createSession(tpl, profile, { seed = Date.now(), seen = new Set(), faceEnabled = false, fullscreen = true, simulated = false, createdAt = Date.now(), bank = bankFor(profile) } = {}) {
  bank = tpl.bank || bank; // a template can fix its bank (the Class 10 demo)
  const { paper, sections, shortfall } = buildPaper(tpl, { seed, seen, bank });
  const wanted = tpl.sections.reduce((s, x) => s + x.mcq + x.numerical, 0);
  let durationSec = Math.round(tpl.totalMin * 60 * (wanted ? paper.length / wanted : 1));
  if (isEasyBank(bank)) durationSec = Math.max(60, Math.round(sum(paper.map((p) => p.expectedSec)) * EASY_DURATION_MULT));
  const s = baseSession(tpl, profile, paper, sections, { faceEnabled, fullscreen, simulated, createdAt, durationSec, bank });
  s.shortfall = shortfall;
  return s;
}

/** A drill: a short timed set on one topic (or a re-attempt of listed questions). */
export function createDrill(profile, { topic = null, mode = 'normal', qids = null, source = 'topic', createdAt = Date.now(), bank = bankFor(profile), faceEnabled = false } = {}) {
  const exam = profile.exam;
  const tpl = DEFAULT_TEMPLATES.find((t) => t.exam === exam && t.kind === 'full');
  const m = DRILL.modes[mode] || DRILL.modes.normal;
  let pool;
  if (qids) {
    pool = qids.map((id) => QMAP.get(id)).filter(Boolean).slice(0, DRILL.size + 2);
  } else {
    const lastSeen = {};
    for (const x of store.sessions({ exam })) for (const p of x.paper) lastSeen[p.id] = Math.max(lastSeen[p.id] || 0, x.createdAt || 0);
    pool = shuffle(BANK[bank].filter((q) => q.topic === topic && q.exams.includes(exam)))
      .sort((a, b) => (lastSeen[a.id] || 0) - (lastSeen[b.id] || 0))
      .slice(0, DRILL.size);
  }
  if (!pool.length) return null;
  const name = source === 'mistakes' ? 'Mistakes' : topic;
  const paper = pool.map((q, i) => {
    const e = expectedFor(q, tpl);
    return { id: q.id, n: i + 1, section: name, subject: q.subject, expectedSec: e.sec, expSource: e.source };
  });
  const sections = [{ name, subject: pool[0].subject, start: 0, end: paper.length }];
  const durationSec = Math.max(45, Math.round(sum(paper.map((p) => p.expectedSec)) * m.mult));
  const s = baseSession(tpl, profile, paper, sections, { fullscreen: false, createdAt, durationSec, bank, faceEnabled });
  s.kind = 'drill';
  s.templateId = null;
  s.templateName = source === 'mistakes' ? 'Mistake re-attempt' : `Drill · ${topic}`;
  s.layout = 'cbt';
  s.saveRequired = true;
  s.drill = { topic: source === 'mistakes' ? null : topic, mode, mult: m.mult, source };
  return s;
}
