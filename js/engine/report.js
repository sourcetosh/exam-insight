// Assembles everything the report, dashboard and mistake log need.
import { store, kindOf } from '../store.js';
import { questionRows } from './features.js';
import { baselineFrom, applyFriction } from './friction.js';
import { topicMap, topFive, GROUPS } from './topics.js';
import { analyzePatterns, EXPERIMENTS } from './patterns.js';
import { scoreSession } from './scoring.js';
import { buildTimeline } from './timeline.js';
import { guessAnalysis, difficultyMatrix, timeAllocation, percentile, cohortCompare, readinessDims, studyPlan } from './insights.js';
import { coachRead } from './narrative.js';
import { questionBehaviour, behaviourReport, hasTrace } from './behaviour.js';
import { topicsFor } from '../data/taxonomy.js';
import { FACE, THRESHOLDS, PROCTOR } from '../config.js';
import { mean, sum } from '../ui.js';

/** What the proctoring layer noted during a test, with the question that was open each time.
 *  Window events (tab switches, leaving full screen) count even when the camera was off. */
export function proctorSummary(s, rows) {
  const pr = s.proctor || { enabled: false };
  const byQ = new Map(rows.map((r) => [r.qid, r]));
  const ev = [...(s.events || [])].sort((a, b) => a.t - b.t);
  const items = [];
  const item = (e, code, dur) => {
    const d = PROCTOR.flags[code] || { label: code, severity: 1 };
    const r = e.q != null ? byQ.get(e.q) : null;
    items.push({ t: e.t, code, label: d.label, severity: d.severity || 1, dur: dur ?? null, n: r?.n ?? null, topic: r?.topic ?? null });
  };
  ev.forEach((e, i) => {
    if (e.type === 'proctor') item(e, e.code, e.dur);
    else if (e.type === 'blur') { const f = ev.slice(i + 1).find((x) => x.type === 'focus'); item(e, 'blur', f?.dur ?? null); }
    else if (e.type === 'fs_exit') item(e, 'fs_exit', null);
  });
  const byCode = new Map();
  for (const x of items) {
    const c = byCode.get(x.code) || { code: x.code, label: x.label, severity: x.severity, n: 0, ms: 0 };
    c.n++; c.ms += x.dur || 0;
    byCode.set(x.code, c);
  }
  const counts = [...byCode.values()].sort((a, b) => b.severity - a.severity || b.n - a.n);
  const severe = items.filter((x) => x.severity >= 2).length;
  const level = !pr.enabled ? 'unproctored' : !items.length ? 'clean' : severe === 0 && items.length <= 3 ? 'minor' : 'review';
  return {
    enabled: !!pr.enabled, reason: pr.reason || null, enrolled: !!pr.enrolled, identityAtStart: pr.identityAtStart || null,
    overrides: pr.overrides || [], precheck: pr.precheck || null, cameraLost: !!pr.cameraLost,
    items, counts, total: items.length, level,
  };
}

const cache = new Map();
const keyOf = (s) => `${s.id}:${s.events.length}:${Object.keys(s.tags || {}).length}:${s.status}:${s.elapsedMs}:${s.face?.trace?.s?.length || 0}`;

const doneSessions = (exam) => store.sessions({ status: 'done', exam });
const endOf = (s) => s.endedAt || s.startedAt || s.createdAt;

/** Rows with friction for one session, using only tests completed before it as baseline. */
export function analyze(s) {
  const k = keyOf(s);
  if (cache.has(k)) return cache.get(k);
  const { rows, visits } = questionRows(s);
  questionBehaviour(s, rows, visits);
  let baseline = null;
  if (s.analytics === 'full') {
    const prior = doneSessions().filter((x) => x.id !== s.id && x.analytics === 'full' && endOf(x) < endOf(s));
    baseline = baselineFrom(prior.map((x) => questionRows(x).rows));
    applyFriction(rows, baseline);
  }
  const res = { rows, visits, baseline };
  cache.set(k, res);
  return res;
}

export function summaryOf(s) {
  const sc = scoreSession(s);
  const out = {
    id: s.id, kind: kindOf(s), at: endOf(s), name: s.templateName, topic: s.drill?.topic || null, mode: s.drill?.mode || null,
    scorePct: sc.max ? sc.score / sc.max : 0, score: sc.score, max: sc.max, accuracy: sc.accuracy, attempted: sc.attempted, n: s.paper.length,
    timeUsed: s.elapsedMs / 1000 / s.durationSec, bank: s.bank || 'standard',
  };
  if (s.analytics === 'full' && s.status === 'done') {
    const { rows } = analyze(s);
    const Fs = rows.map((r) => r.F).filter((x) => x != null);
    out.meanF = Fs.length ? mean(Fs) : null;
    out.timeSinks = rows.filter((r) => r.visits && r.timeSec > THRESHOLDS.timeSink * r.expectedSec).length;
    out.panicked = rows.filter((r) => r.tag === 'panicked').length;
  }
  if (s.status === 'done' && hasTrace(s)) {
    const { rows } = analyze(s);
    const rd = rows.filter((r) => r.bx?.struggle != null);
    out.meanStruggle = rd.length ? Math.round(mean(rd.map((r) => r.bx.struggle))) : null;
    out.fragile = rows.filter((r) => r.bx?.quadrant === 'fragile').length;
    out.blind = rows.filter((r) => r.bx?.quadrant === 'blind').length;
    out.gaps = rows.filter((r) => r.bx?.quadrant === 'gap').length;
    out.mastered = rows.filter((r) => r.bx?.quadrant === 'mastered').length;
  }
  return out;
}

export function buildReport(s) {
  const score = scoreSession(s);
  const { rows, visits, baseline } = analyze(s);
  const level = s.analytics;
  const kind = kindOf(s);
  const tl = buildTimeline(s, rows, visits);
  const alloc = timeAllocation(s, rows);
  const diff = difficultyMatrix(rows);
  const pctile = kind === 'mock' ? percentile(s, score.max ? Math.max(0, score.score) / score.max : 0) : null;

  const priorSame = doneSessions(s.exam).filter((x) => x.id !== s.id && endOf(x) < endOf(s) && kindOf(x) === kind && (kind !== 'drill' || x.drill?.topic === s.drill?.topic));
  const trend = { current: summaryOf(s), prior: priorSame.slice(-3).map(summaryOf) };

  const base = { s, level, kind, score, rows, visits, tl, alloc, diff, pctile, trend, proctor: proctorSummary(s, rows), bx: behaviourReport(s, rows) };
  if (level !== 'full') {
    return { ...base, narrative: coachRead({ ...base, patterns: [], top5: [], experiments: [] }) };
  }

  const fullHistory = doneSessions(s.exam).filter((x) => x.id !== s.id && x.analytics === 'full' && endOf(x) < endOf(s));
  const tests = [...fullHistory.map((x) => ({ session: x, rows: analyze(x).rows })), { session: s, rows }];
  const map = topicMap(tests);
  const top5 = topFive(map);
  const { found: patterns, checks } = analyzePatterns(s, rows, visits);

  // Next-test experiments: one or two, from the strongest patterns, else from topics.
  const experiments = patterns.slice(0, 2).map((p) => ({ ...EXPERIMENTS[p.id], from: p.name }));
  if (experiments.length < 2) {
    const fast = top5.find((t) => t.group === 'fast' && t.status !== 'insufficient');
    const slow = top5.find((t) => t.group === 'slow' && t.status !== 'insufficient');
    if (fast) experiments.push({ title: `Read the ask twice in ${fast.topic}`, body: 'Underline exactly what the question asks before you look at the options. Fast-and-wrong usually means a misread or a half-remembered rule.', from: GROUPS.fast.label });
    else if (slow && experiments.length < 2) experiments.push({ title: `Timed set: ${slow.topic}`, body: `Do ten ${slow.topic} questions with a strict per-question timer before your next mock.`, from: GROUPS.slow.label });
  }
  if (!experiments.length) experiments.push({ title: 'Keep your approach, raise the stakes', body: 'Nothing stood out as costly. Next time try a longer paper to test pacing over the full duration.', from: 'No costly pattern' });

  // Tension markers: shown only where they coincide with a behaviour signal,
  // and the student's own tag overrules any inference.
  let face = null;
  if (s.face?.enabled) {
    const withFace = rows.filter((r) => r.face);
    const ok = withFace.filter((r) => r.face.ok);
    const coinciding = ok
      .filter((r) => r.face.marker >= FACE.insightMarker)
      .filter((r) => r.timeRatio >= 1.5 || r.revisits >= 2 || r.idleMaxSec >= 60)
      .filter((r) => r.tag !== 'sure')
      .sort((a, b) => b.F - a.F);
    const totalSamples = s.face.samples || sum(withFace.map((r) => s.face.perQ[r.qid]?.n || 0));
    const validSamples = s.face.valid || sum(withFace.map((r) => s.face.perQ[r.qid]?.valid || 0));
    face = {
      coinciding,
      usable: ok.length,
      visited: rows.filter((r) => r.visits).length,
      validFrac: totalSamples ? validSamples / totalSamples : 0,
      dropped: s.face.dropped || {},
      overruled: ok.filter((r) => r.face.marker >= FACE.insightMarker && r.tag === 'sure').map((r) => r.n),
    };
  }

  // Wellbeing: repeated "Panicked" self-tags across tests.
  const recent = [...fullHistory.slice(-2), s];
  const panickedPerTest = recent.map((x) => Object.values(x.tags || {}).filter((t) => t === 'panicked').length);
  const wellbeing = panickedPerTest.filter((n) => n > 0).length >= 2 && sum(panickedPerTest) >= 3;

  // Signal check: does friction line up with the student's own tags?
  const tagged = rows.filter((r) => r.tag && r.F != null);
  const tagF = {};
  for (const t of ['sure', 'guessed', 'panicked', 'blank']) {
    const v = tagged.filter((r) => r.tag === t).map((r) => r.F);
    tagF[t] = v.length ? { mean: mean(v), n: v.length } : null;
  }

  const guess = guessAnalysis(rows, s.marking);
  const cohortCmp = cohortCompare(s, rows);
  const R = { ...base, baseline, map, top5, patterns, checks, experiments, face, wellbeing, tagF, guess, cohortCmp };
  R.narrative = coachRead(R);
  return R;
}

/** Topic map over every full-analytics test for an exam (mocks and drills). */
export function currentMap(exam) {
  const tests = doneSessions(exam).filter((x) => x.analytics === 'full').map((x) => ({ session: x, rows: analyze(x).rows }));
  return tests.length ? topicMap(tests) : [];
}

export function readinessFor(exam) {
  const mocks = doneSessions(exam).filter((x) => kindOf(x) === 'mock').map((x) => {
    const sc = scoreSession(x);
    return { score: { ...sc, scorePct: sc.max ? sc.score / sc.max : 0 }, n: x.paper.length, rows: analyze(x).rows };
  });
  const map = currentMap(exam);
  return readinessDims({ mocks, topicsTotal: topicsFor(exam).length, topicsCovered: map.filter((t) => t.cum.n >= THRESHOLDS.minTopicQuestions).length });
}

/** Every wrong (or lucky-guess) attempt, grouped by question, latest attempt first. */
export function collectMistakes(exam) {
  const byQ = new Map();
  for (const s of doneSessions(exam)) {
    const { rows } = analyze(s);
    for (const r of rows) {
      if (!r.attempted) continue;
      const lucky = r.correct === true && r.tag === 'guessed';
      if (r.correct !== false && !lucky) {
        const prev = byQ.get(r.qid);
        if (prev) prev.attempts.push({ at: endOf(s), session: s, correct: true, final: r.final, tag: r.tag, lucky: false });
        continue;
      }
      const e = byQ.get(r.qid) || { qid: r.qid, q: r.q, topic: r.topic, subject: r.subject, attempts: [] };
      e.attempts.push({ at: endOf(s), session: s, correct: r.correct, final: r.final, tag: r.tag, lucky, F: r.F, timeSec: r.timeSec, expectedSec: r.expectedSec, n: r.n });
      byQ.set(r.qid, e);
    }
  }
  const out = [];
  for (const e of byQ.values()) {
    e.attempts.sort((a, b) => a.at - b.at);
    const last = e.attempts[e.attempts.length - 1];
    const wrongs = e.attempts.filter((a) => a.correct === false).length;
    let status;
    if (last.correct === true && !last.lucky) status = 'fixed';
    else if ((store.resolvedAt(e.qid) || 0) > last.at) status = 'resolved';
    else status = 'open';
    out.push({ ...e, last, wrongs, status, note: store.note(e.qid) });
  }
  return out.sort((a, b) => b.last.at - a.last.at);
}

export function planFor(exam) {
  const p = store.profile;
  const map = currentMap(exam);
  const mocks = doneSessions(exam).filter((x) => kindOf(x) === 'mock');
  const last = mocks[mocks.length - 1] || null;
  const lastPatterns = last && last.analytics === 'full' ? buildReport(last).patterns : [];
  const openMistakes = collectMistakes(exam).filter((m) => m.status === 'open').length;
  return studyPlan({
    map, lastPatterns, lastSession: last, openMistakes,
    templates: store.templates().filter((t) => t.exam === exam && !t.disabled), examDate: p?.examDate || null, mocksCount: mocks.length,
  });
}

export function clearAnalysisCache() { cache.clear(); }
