// Secondary analyses for the report and the dashboard: guessing economics, difficulty
// matrix, time allocation, cohort percentile, readiness dimensions and the weekly plan.
import { COHORT_DIST, THRESHOLDS, DIFFICULTY_LABEL, DRILL } from '../config.js';
import { EMPIRICAL } from '../data/cohort.js';
import { EXPERIMENTS } from './patterns.js';
import { GROUPS } from './topics.js';
import { mean, sd, sum, clamp, plural, fix, pct, fmtDur } from '../ui.js';

// ---------- guessing and negative marking ----------
export function guessAnalysis(rows, marking) {
  const m = marking?.mcq || { correct: 4, wrong: -1 };
  const tagged = rows.filter((r) => r.tag);
  const byTag = {};
  for (const t of ['sure', 'guessed', 'panicked', 'blank']) {
    const rr = tagged.filter((r) => r.tag === t);
    byTag[t] = {
      n: rr.length,
      right: rr.filter((r) => r.correct === true).length,
      wrong: rr.filter((r) => r.correct === false).length,
      blank: rr.filter((r) => !r.attempted).length,
      net: sum(rr.map((r) => r.marks)),
      qs: rr.map((r) => r.n),
    };
  }
  const wrongRows = rows.filter((r) => r.correct === false);
  const lostToNegative = -sum(wrongRows.map((r) => Math.min(0, r.marks)));
  const g = byTag.guessed;
  const evBlind = (m.correct + 3 * m.wrong) / 4;
  const evOneOut = (m.correct + 2 * m.wrong) / 3;
  let verdict;
  if (!tagged.length) verdict = null;
  else if (!g.n) verdict = 'You tagged nothing as Guessed.';
  else if (g.net > 0) verdict = `Your ${plural(g.n, 'guess', 'guesses')} netted +${g.net}: ${g.right} right, ${g.wrong} wrong. Guessing paid off.`;
  else if (g.net < 0) verdict = `Your ${plural(g.n, 'guess', 'guesses')} cost ${-g.net} marks net (${g.right} right, ${g.wrong} wrong). Leaving them blank would have scored higher.`;
  else verdict = `Your ${plural(g.n, 'guess', 'guesses')} broke even (${g.right} right, ${g.wrong} wrong).`;
  return { tagged: tagged.length, byTag, lostToNegative, wrongCount: wrongRows.length, evBlind, evOneOut, verdict, marking: m };
}

// ---------- difficulty x result ----------
export function difficultyMatrix(rows) {
  const cells = [1, 2, 3].map((d) => {
    const rr = rows.filter((r) => r.difficulty === d);
    const seen = rr.filter((r) => r.visits);
    return {
      d, label: DIFFICULTY_LABEL[d], n: rr.length,
      right: rr.filter((r) => r.correct === true).length,
      wrong: rr.filter((r) => r.correct === false).length,
      blank: rr.filter((r) => !r.attempted).length,
      timeRatio: seen.length ? mean(seen.map((r) => r.timeRatio)) : null,
      wrongQs: rr.filter((r) => r.correct === false).map((r) => r.n),
    };
  }).filter((c) => c.n);
  const easy = cells.find((c) => c.d === 1);
  const hard = cells.find((c) => c.d === 3);
  let note = null;
  if (easy && easy.wrong) {
    note = `You missed ${plural(easy.wrong, 'easy question')}${hard && hard.right ? ` while getting ${hard.right} of ${hard.n} hard ones right` : ''}. Easy misses usually mean a misread or a rushed answer, not a knowledge gap.`;
  } else if (hard && hard.n && hard.right === 0 && hard.wrong + hard.blank === hard.n) {
    note = `Hard questions went ${hard.wrong} wrong and ${hard.blank} blank. Leaving a hard question blank costs nothing; a wrong attempt costs a mark.`;
  } else if (cells.length === 1) {
    note = `All questions in this paper were tagged ${cells[0].label.toLowerCase()}.`;
  }
  return { cells, note };
}

// ---------- where the time went ----------
export function timeAllocation(s, rows) {
  const total = sum(rows.map((r) => r.timeSec)) || 1;
  const score = sum(rows.map((r) => r.marks));
  const avail = sum(rows.map((r) => r.maxMarks)) || 1;
  const items = s.sections.map((sec) => {
    const rr = rows.slice(sec.start, sec.end);
    const t = sum(rr.map((r) => r.timeSec));
    const a = sum(rr.map((r) => r.maxMarks));
    const sc = sum(rr.map((r) => r.marks));
    const att = rr.filter((r) => r.attempted);
    return {
      name: sec.name, subject: sec.subject, timeSec: t, timeFrac: t / total, availFrac: a / avail,
      scoredFrac: score > 0 ? Math.max(0, sc) / score : 0, score: sc, max: a,
      accuracy: att.length ? att.filter((r) => r.correct).length / att.length : null,
      perQ: rr.length ? t / rr.length : 0, expPerQ: rr.length ? sum(rr.map((r) => r.expectedSec)) / rr.length : 0,
    };
  });
  const skew = items.length > 1 ? items.reduce((b, x) => (!b || Math.abs(x.timeFrac - x.availFrac) > Math.abs(b.timeFrac - b.availFrac) ? x : b), null) : null;
  return { items, skew: skew && Math.abs(skew.timeFrac - skew.availFrac) >= 0.1 ? skew : null };
}

// ---------- cohort percentile ----------
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

export function percentile(s, scoreFrac) {
  const tpl = s.templateId ? { sprint: 'sprint', mini: 'mini', full: 'full' } : null;
  if (!tpl) return null;
  const kind = s.templateId.includes('sprint') ? 'sprint' : s.templateId.includes('mini') ? 'mini' : 'full';
  const d = COHORT_DIST[kind];
  if (!d) return null;
  const z = (scoreFrac - d.mean) / d.sd;
  return { pct: Math.round(clamp(normCdf(z), 0.01, 0.99) * 100), n: d.n, mean: d.mean, sd: d.sd, value: scoreFrac, kind };
}

// ---------- you vs the cohort, per question ----------
export function cohortCompare(s, rows) {
  const careless = rows.filter((r) => r.correct === false && r.cohortP != null && r.cohortP >= 0.7).sort((a, b) => b.cohortP - a.cohortP);
  const hardWins = rows.filter((r) => r.correct === true && r.cohortP != null && r.cohortP <= 0.45).sort((a, b) => a.cohortP - b.cohortP);
  return { careless, hardWins };
}

// ---------- readiness: five behavioural dimensions, 0–100 ----------
export function readinessDims({ mocks, topicsTotal, topicsCovered }) {
  // mocks: [{ score: {accuracy, attempted}, n, rows }] chronological
  const dim = (set) => {
    if (!set.length) return null;
    const acc = set.map((m) => m.score.accuracy).filter((x) => x != null);
    const seen = set.flatMap((m) => m.rows.filter((r) => r.visits && r.timeRatio != null));
    const fin = set.map((m) => m.score.attempted / m.n);
    const sp = set.map((m) => m.score.scorePct);
    return {
      accuracy: acc.length ? mean(acc) * 100 : null,
      speed: seen.length ? (seen.filter((r) => r.timeRatio <= THRESHOLDS.overExpected).length / seen.length) * 100 : null,
      finish: mean(fin) * 100,
      consistency: sp.length >= 2 ? 100 - Math.min(100, 250 * sd(sp)) : null,
    };
  };
  const recent = mocks.slice(-5);
  const cur = dim(recent) || {};
  const prev = recent.length >= 2 ? dim(recent.slice(0, -1)) : null;
  cur.coverage = topicsTotal ? (topicsCovered / topicsTotal) * 100 : null;
  if (prev) prev.coverage = null;
  const DEFS = [
    ['accuracy', 'Accuracy', 'Right answers as a share of attempted, last 5 mocks.'],
    ['speed', 'Speed', `Questions finished within ${THRESHOLDS.overExpected}× their expected time.`],
    ['finish', 'Finish rate', 'Share of the paper you attempted.'],
    ['consistency', 'Consistency', 'How steady your score is from mock to mock.'],
    ['coverage', 'Coverage', `Syllabus topics with at least ${THRESHOLDS.minTopicQuestions} questions attempted.`],
  ];
  const dims = DEFS.map(([id, label, hint]) => ({
    id, label, hint,
    value: cur[id] == null ? null : Math.round(clamp(cur[id], 0, 100)),
    delta: prev && prev[id] != null && cur[id] != null ? Math.round(cur[id] - prev[id]) : null,
  }));
  const vals = dims.map((d) => d.value).filter((v) => v != null);
  return { dims, overall: vals.length ? Math.round(mean(vals)) : null, nTests: recent.length };
}

// ---------- weekly plan ----------
export function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((date - y0) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

export function studyPlan({ map = [], lastPatterns = [], lastSession = null, openMistakes = 0, templates = [], examDate = null, mocksCount = 0 }) {
  const items = [];
  const enc = (t) => encodeURIComponent(t);
  const daysLeft = examDate ? Math.ceil((new Date(examDate) - Date.now()) / 86400000) : null;
  const usable = map.filter((t) => t.status !== 'insufficient');
  const order = { confirmed: 0, early: 1 };
  const struggling = usable.filter((t) => t.group === 'struggling').sort((a, b) => order[a.status] - order[b.status] || (b.cum.meanF ?? 0) - (a.cum.meanF ?? 0));
  const fast = usable.filter((t) => t.group === 'fast').sort((a, b) => a.cum.accuracy - b.cum.accuracy);
  const slow = usable.filter((t) => t.group === 'slow').sort((a, b) => b.cum.timeRatio - a.cum.timeRatio);

  for (const t of struggling.slice(0, 2)) {
    items.push({
      id: `relearn:${t.topic}`, kind: 'relearn', icon: 'book', topic: t.topic,
      title: `Re-learn ${t.topic}`,
      body: `${t.cum.correct} of ${t.cum.n} right across your tests, at ${fix(t.cum.timeRatio, 1)}× expected time. Read the chapter first, then drill ${DRILL.size}.`,
      href: `#/drill/${enc(t.topic)}/normal`, cta: 'Drill',
    });
  }
  if (openMistakes >= 3) {
    items.push({
      id: 'mistakes', kind: 'mistakes', icon: 'bookmark',
      title: `Clear ${plural(Math.min(openMistakes, DRILL.size), 'open mistake')}`,
      body: 'Re-attempt questions you got wrong, with the solutions ready for the ones that fall again.',
      href: '#/drill/mistakes/normal', cta: 'Re-attempt',
    });
  }
  for (const t of fast.slice(0, 1)) {
    items.push({
      id: `drill:${t.topic}:slow`, kind: 'slow', icon: 'eye', topic: t.topic,
      title: `Slow-read drill: ${t.topic}`,
      body: `${pct(t.cum.accuracy)} accurate at ${fix(t.cum.timeRatio, 1)}× expected time. Read every question twice; the timer is relaxed to ${DRILL.modes.slow.mult * 100}%.`,
      href: `#/drill/${enc(t.topic)}/slow`, cta: 'Drill',
    });
  }
  for (const t of slow.slice(0, 1)) {
    items.push({
      id: `drill:${t.topic}:speed`, kind: 'speed', icon: 'zap', topic: t.topic,
      title: `Speed drill: ${t.topic}`,
      body: `${pct(t.cum.accuracy)} accurate but ${fix(t.cum.timeRatio, 1)}× expected time. Timer at ${DRILL.modes.speed.mult * 100}%; aim for the same accuracy.`,
      href: `#/drill/${enc(t.topic)}/speed`, cta: 'Drill',
    });
  }
  const p0 = lastPatterns[0];
  if (p0 && EXPERIMENTS[p0.id]) {
    items.push({
      id: `habit:${p0.id}`, kind: 'habit', icon: 'target',
      title: EXPERIMENTS[p0.id].title,
      body: `${EXPERIMENTS[p0.id].body} (From "${p0.name}" in your last mock.)`,
      href: lastSession ? `#/report/${lastSession.id}` : null, cta: 'See pattern',
    });
  }
  if (!usable.length && !items.length) {
    items.push({
      id: 'first', kind: 'mock', icon: 'play',
      title: mocksCount ? 'Take a mini mock to map your topics' : 'Take your first mock',
      body: `Topics are grouped once they have ${THRESHOLDS.minTopicQuestions} attempted questions. A mini mock covers every topic once or twice.`,
      href: templates.find((t) => t.kind === 'mini') ? `#/start/${templates.find((t) => t.kind === 'mini').id}` : '#/', cta: 'Start',
    });
  } else {
    const lastKind = lastSession?.templateId?.includes('sprint') ? 'sprint' : lastSession?.templateId?.includes('mini') ? 'mini' : lastSession ? 'full' : null;
    const nextKind = lastKind === 'sprint' ? 'mini' : lastKind === 'mini' ? 'full' : 'mini';
    const tpl = templates.find((t) => t.kind === nextKind && !t.disabled) || templates.find((t) => !t.disabled);
    if (tpl) {
      items.push({
        id: `mock:${tpl.id}`, kind: 'mock', icon: 'play',
        title: `Next mock: ${tpl.name}`,
        body: `A fresh paper each week keeps the trend honest${daysLeft != null && daysLeft > 0 ? `; ${plural(daysLeft, 'day')} to the exam` : ''}.`,
        href: `#/start/${tpl.id}`, cta: 'Start',
      });
    }
  }
  // The next mock always stays on the list.
  const mock = items.find((x) => x.kind === 'mock');
  const rest = items.filter((x) => x.kind !== 'mock').slice(0, mock ? 5 : 6);
  return { items: mock ? [...rest, mock] : rest, week: weekKey(), daysLeft };
}

export const groupLabel = (g) => GROUPS[g]?.label || 'Unclassified';
export const fmtDurSafe = fmtDur;

// ---------- plain-language struggle summary: which questions, which topics ----------
export function struggleSummary(rows, full) {
  const reasons = (r) => {
    const out = [];
    if (r.correct === false) out.push('wrong');
    else if (!r.visits) out.push('never opened');
    else if (!r.attempted) out.push('skipped');
    if (r.visits && r.timeRatio >= 1.5) out.push(`slow · ${fmtDur(r.timeSec)}`);
    if (full && r.flipsRW) out.push('changed right → wrong');
    else if (full && r.changes >= 2) out.push('changed answer twice');
    if (full && r.revisits >= 2) out.push(`came back ${r.revisits} times`);
    if (full && r.idleMaxSec >= 60) out.push(`stuck ${fmtDur(r.idleMaxSec)}`);
    return out;
  };
  const cost = (r) => (r.correct === false ? 3 : 0) + (!r.attempted ? 1.5 : 0) + (r.visits ? Math.max(0, r.timeRatio - 1) : 0)
    + (full ? (r.flipsRW ? 2 : r.changes >= 2 ? 1 : 0) + (r.revisits >= 2 ? 0.5 : 0) + (r.idleMaxSec >= 60 ? 1 : 0) : 0);
  const questions = rows.map((r) => ({ n: r.n, qid: r.qid, topic: r.topic, subject: r.subject, reasons: reasons(r), cost: cost(r), correct: r.correct, attempted: r.attempted }))
    .filter((x) => x.reasons.length).sort((a, b) => b.cost - a.cost);
  const byTopic = new Map();
  for (const r of rows) {
    const t = byTopic.get(r.topic) || { topic: r.topic, subject: r.subject, n: 0, right: 0, wrong: 0, blank: 0, ratioSum: 0, seen: 0, qs: [] };
    t.n++;
    if (r.correct === true) t.right++; else if (r.correct === false) t.wrong++; else t.blank++;
    if (r.visits) { t.ratioSum += r.timeRatio; t.seen++; }
    if (r.correct !== true || (r.visits && r.timeRatio >= 1.5)) t.qs.push(r.n);
    byTopic.set(r.topic, t);
  }
  const topics = [...byTopic.values()].map((t) => {
    const ratio = t.seen ? t.ratioSum / t.seen : 0;
    const slow = ratio >= 1.5;
    const why = [];
    if (t.wrong) why.push(`${t.wrong} wrong`);
    if (t.blank) why.push(`${t.blank} blank`);
    if (slow) why.push(`slow (${fix(ratio, 1)}× expected time)`);
    return { ...t, ratio, slow, why, score: t.wrong * 2 + t.blank + Math.max(0, ratio - 1) * 2 };
  }).filter((t) => t.wrong || t.blank || t.slow).sort((a, b) => b.score - a.score);
  const good = [...byTopic.values()].filter((t) => t.right === t.n && t.n > 0).map((t) => t.topic);
  return { questions, topics, good };
}
