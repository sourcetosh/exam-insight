// Behaviour analysis: the per-second expression trace becomes question-wise and topic-wise
// struggle, and the patterns behind it.
//
// Struggle is read from the face (strain against the student's own calm face), and set against
// the outcome. That gives four kinds of question, each with a different fix:
//   calm + correct = mastered      strained + correct = fragile (knows it, but it costs)
//   calm + wrong   = blind spot    strained + wrong   = gap (hard, and it went wrong)
// plus strained-then-skipped (avoided) and calm skips.
import { EXPRESSION } from '../config.js';
import { CHAR_STATE, COMPONENTS, COMPONENT_LABEL } from '../face/expression.js';

export const QUADRANTS = {
  mastered: { label: 'Calm and correct', short: 'Mastered', tip: 'You knew it and your face stayed calm.' },
  fragile: { label: 'Correct, but strained', short: 'Fragile', tip: 'Right answer, but your face showed real effort. Under exam pressure this can crack.' },
  blind: { label: 'Calm, but wrong', short: 'Blind spot', tip: 'No strain at all, yet wrong: a confident misconception, the hardest kind to notice.' },
  gap: { label: 'Strained and wrong', short: 'Gap', tip: 'It was hard and it went wrong: a gap to re-learn.' },
  avoided: { label: 'Strained, then skipped', short: 'Avoided', tip: 'It looked hard and you left it.' },
  skipped: { label: 'Skipped calmly', short: 'Skipped', tip: 'Left without strain, probably on purpose.' },
  unread: { label: 'Face not readable', short: 'No read', tip: 'The camera could not read your face long enough on this question.' },
  unseen: { label: 'Never opened', short: 'Unseen', tip: 'You never reached this question.' },
};
export const QUADRANT_ORDER = ['gap', 'blind', 'fragile', 'avoided', 'mastered', 'skipped', 'unread', 'unseen'];

export const STRUGGLE_LEVEL = (x) => (x == null ? 'none' : x >= 60 ? 'high' : x >= EXPRESSION.struggleIdx ? 'strained' : x >= 25 ? 'mild' : 'calm');
export const LEVEL_LABEL = { none: 'No read', calm: 'Calm', mild: 'Mild', strained: 'Strained', high: 'High strain' };
/** 0..5 wash step for a struggle index (reuses the strain wash palette). */
export const washStep = (x) => (x == null ? null : x < 12 ? 0 : x < 25 ? 1 : x < 40 ? 2 : x < 55 ? 3 : x < 70 ? 4 : 5);

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const q = (n) => `<button class="qlink" data-q="${n}">Q${n}</button>`;
const qs = (list, max = 6) => list.slice(0, max).map((r) => q(r.n)).join(' ') + (list.length > max ? ` <span class="faint">+${list.length - max}</span>` : '');
const sec = (x) => (x < 60 ? `${Math.round(x)} s` : `${Math.floor(x / 60)} min ${Math.round(x % 60)} s`);

/** True when a session carries a v2 expression trace. */
export const hasTrace = (s) => !!(s?.face?.enabled && s.face.v === 2 && s.face.trace?.s?.length);

/** Per-question behaviour from the trace. Adds r.bx to every row; returns null without a trace. */
export function questionBehaviour(s, rows, visits) {
  if (!hasTrace(s)) return null;
  const S = s.face.trace.s, V = s.face.trace.v, T = S.length;
  const thr = EXPRESSION.strained;
  const byQ = new Map(rows.map((r) => [r.qid, r]));
  for (const r of rows) {
    r.bx = { secs: 0, reading: 0, writing: 0, away: 0, absent: 0, poor: 0, none: 0, strained: 0, sum: 0, trace: [], states: '', onset: null, peak: 0, preAnswer: null, struggle: null, quadrant: null, comp: null, topComp: null, blinkPerMin: null, segments: [] };
  }
  for (const v of visits) {
    const r = byQ.get(v.q);
    if (!r) continue;
    const x = r.bx;
    const a = Math.max(0, Math.round(v.start / 1000)), b = Math.min(T, Math.round(v.end / 1000));
    if (b > a) x.segments.push([a, b]);
    for (let k = a; k < b; k++) {
      const st = CHAR_STATE[S[k]] || 'none';
      x[st]++;
      x.secs++;
      x.states += S[k];
      const val = V[k];
      if (st === 'reading' && val >= 0) {
        const v01 = val / 100;
        x.sum += v01;
        x.trace.push(v01);
        if (v01 >= thr) { x.strained++; if (x.onset == null) x.onset = x.secs - 1; }
      } else x.trace.push(null);
    }
  }
  // answer moments: the last save on each question
  const lastSave = new Map();
  for (const e of s.events) if (e.type === 'save' && e.q) lastSave.set(e.q, e.t);

  for (const r of rows) {
    const x = r.bx;
    const vals = x.trace.filter((v) => v != null);
    x.mean = vals.length ? x.sum / vals.length : null;
    // peak: highest 3-second rolling mean of readable seconds
    let peak = 0;
    for (let i = 0; i < x.trace.length; i++) {
      const w = x.trace.slice(Math.max(0, i - 1), i + 2).filter((v) => v != null);
      if (w.length >= 2) peak = Math.max(peak, w.reduce((a, b) => a + b, 0) / w.length);
    }
    x.peak = peak;
    const ts = lastSave.get(r.qid);
    if (ts != null) {
      const end = Math.round(ts / 1000);
      const pre = [];
      for (let k = Math.max(0, end - 10); k < Math.min(T, end); k++) if (S[k] === 'r' && V[k] >= 0) pre.push(V[k] / 100);
      x.preAnswer = pre.length >= 3 ? mean(pre) : null;
    }
    if (x.reading >= EXPRESSION.minReadSec && x.mean != null) {
      const share = x.strained / x.reading;
      x.struggle = Math.round(100 * clamp01(0.4 * share + 0.4 * Math.min(1, x.mean / 0.6) + 0.2 * Math.min(1, x.peak / 0.85)));
    }
    x.coverage = x.secs ? (x.reading + x.writing) / x.secs : 0;
    x.level = STRUGGLE_LEVEL(x.struggle);
    // which facial actions carried it
    const f = s.face.perQ?.[r.qid];
    if (f?.read && f.comp) {
      const tot = COMPONENTS.reduce((a, c) => a + (f.comp[c] || 0), 0);
      if (tot > 0) {
        x.comp = Object.fromEntries(COMPONENTS.map((c) => [c, (f.comp[c] || 0) / tot]));
        x.topComp = COMPONENTS.reduce((best, c) => (x.comp[c] > (x.comp[best] || 0) ? c : best), COMPONENTS[0]);
      }
      x.blinkPerMin = x.reading ? f.blinks / (x.reading / 60) : null;
    }
    x.quadrant = quadrantOf(r);
  }
  return rows;
}

export function quadrantOf(r) {
  if (!r.visits) return 'unseen';
  const x = r.bx;
  if (!x || x.struggle == null) return 'unread';
  const strained = x.struggle >= EXPRESSION.struggleIdx;
  if (r.attempted) return r.correct ? (strained ? 'fragile' : 'mastered') : strained ? 'gap' : 'blind';
  return strained ? 'avoided' : 'skipped';
}

/** Strain over the whole test, in bins (for the replay lane and charts). */
export function strainCurve(s, binSec = 30) {
  if (!hasTrace(s)) return null;
  const S = s.face.trace.s, V = s.face.trace.v;
  const bins = [];
  for (let a = 0; a < S.length; a += binSec) {
    const b = Math.min(S.length, a + binSec);
    const vals = [];
    const cnt = { r: 0, w: 0, a: 0, n: 0, p: 0, x: 0 };
    for (let k = a; k < b; k++) { cnt[S[k]] = (cnt[S[k]] || 0) + 1; if (S[k] === 'r' && V[k] >= 0) vals.push(V[k] / 100); }
    const n = b - a;
    bins.push({ t0: a, t1: b, strain: vals.length >= 3 ? mean(vals) : null, reading: cnt.r / n, writing: cnt.w / n, away: cnt.a / n, gap: (cnt.n + cnt.p + cnt.x) / n });
  }
  return bins;
}

/** Topic- and subject-level behaviour for one session's rows. */
export function groupBehaviour(rows, key = 'topic') {
  const m = new Map();
  for (const r of rows) {
    if (!r.bx) continue;
    const k = r[key];
    const g = m.get(k) || { key: k, subject: r.subject, chapter: r.chapter, n: 0, seen: 0, read: 0, wsum: 0, strainedQs: [], quads: {}, qs: [], correct: 0, attempted: 0, writing: 0, secs: 0 };
    g.n++;
    if (r.visits) g.seen++;
    if (r.attempted) g.attempted++;
    if (r.correct) g.correct++;
    g.secs += r.bx.secs;
    g.writing += r.bx.writing;
    if (r.bx.struggle != null) { g.read += r.bx.reading; g.wsum += r.bx.struggle * r.bx.reading; }
    if (r.bx.struggle != null && r.bx.struggle >= EXPRESSION.struggleIdx) g.strainedQs.push(r);
    g.quads[r.bx.quadrant] = (g.quads[r.bx.quadrant] || 0) + 1;
    g.qs.push(r);
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({
    ...g,
    struggle: g.read ? Math.round(g.wsum / g.read) : null,
    level: STRUGGLE_LEVEL(g.read ? g.wsum / g.read : null),
    accuracy: g.attempted ? g.correct / g.attempted : null,
    writingShare: g.secs ? g.writing / g.secs : 0,
  })).sort((a, b) => (b.struggle ?? -1) - (a.struggle ?? -1));
}

/** The deep insights: each a finding with its evidence and the questions behind it. */
export function behaviourInsights(s, rows) {
  const out = [];
  const read = rows.filter((r) => r.bx?.struggle != null);
  if (read.length < 3) return out;
  const thr = EXPRESSION.struggleIdx;
  const by = (k) => rows.filter((r) => r.bx?.quadrant === k);
  const medStruggle = median(read.map((r) => r.bx.struggle)) ?? 0;

  // 1. the hardest moment
  const hardest = [...read].sort((a, b) => b.bx.struggle - a.bx.struggle)[0];
  if (hardest && hardest.bx.struggle >= thr) {
    const x = hardest.bx;
    const what = [];
    if (x.onset != null) what.push(`strain began ${x.onset <= 2 ? 'almost as soon as you opened it' : `${sec(x.onset)} after you opened it`}`);
    what.push(`you were strained for ${sec(x.strained)} of ${sec(x.reading)} spent reading it`);
    if (hardest.changes) what.push(`changed your answer ${hardest.changes === 1 ? 'once' : `${hardest.changes} times`}`);
    const end = !hardest.attempted ? 'and left it blank' : hardest.correct ? 'and still got it right' : 'and got it wrong';
    out.push({
      id: 'hardest', kind: 'warn', weight: 90,
      title: `Your hardest moment: ${hardest.topic}`,
      body: `On ${q(hardest.n)} ${what.join(', ')}, ${end}.${x.topComp ? ` It showed mostly as <b>${COMPONENT_LABEL[x.topComp]}</b>.` : ''}`,
      qs: [hardest.n],
    });
  }

  // 2. fragile knowledge
  const fragile = by('fragile');
  if (fragile.length) {
    out.push({
      id: 'fragile', kind: 'warn', weight: 80 + fragile.length,
      title: fragile.length === 1 ? 'One right answer cost you a lot' : `${fragile.length} right answers cost you a lot`,
      body: `You got ${qs(fragile)} right while your face showed real strain. Knowledge that costs this much tends to crack under exam pressure. Practise these until they feel calm, not just correct.`,
      qs: fragile.map((r) => r.n),
    });
  }

  // 3. blind spots
  const blind = by('blind');
  if (blind.length) {
    out.push({
      id: 'blind', kind: 'bad', weight: 85 + blind.length * 2,
      title: blind.length === 1 ? 'A blind spot: calm, and wrong' : `${blind.length} blind spots: calm, and wrong`,
      body: `On ${qs(blind)} your face stayed calm and the answer was wrong. That isn’t nerves, it’s a misconception you don’t know you have. Read these solutions before anything else.`,
      qs: blind.map((r) => r.n),
    });
  }

  // 4. spillover: strain on the next two questions after a hard one
  const order = [];
  for (const e of [...s.events].sort((a, b) => a.t - b.t)) if (e.type === 'enter' && e.q && order[order.length - 1] !== e.q) order.push(e.q);
  const rowBy = new Map(rows.map((r) => [r.qid, r]));
  const after = [];
  const triggers = [];
  order.forEach((qid, i) => {
    const r = rowBy.get(qid);
    if (!r?.bx || r.bx.struggle == null || r.bx.struggle < 55) return;
    const nexts = order.slice(i + 1, i + 3).map((id) => rowBy.get(id)).filter((x) => x?.bx?.struggle != null && x.qid !== qid);
    if (nexts.length) { after.push(...nexts.map((x) => x.bx.struggle)); triggers.push(r); }
  });
  const baseAvg = mean(read.map((r) => r.bx.struggle)) || 1;
  const afterAvg = mean(after);
  if (triggers.length >= 2 && afterAvg != null && afterAvg >= baseAvg * 1.35 && afterAvg - baseAvg >= 8) {
    out.push({
      id: 'spillover', kind: 'warn', weight: 75,
      title: 'Strain carries over to the next questions',
      body: `After a hard question (${qs(triggers, 4)}), your next two questions ran <b>${Math.round((afterAvg / baseAvg - 1) * 100)}% more strained</b> than your average. One hard question is quietly costing you three. Before the next question: one slow breath, then read it twice.`,
      qs: triggers.map((r) => r.n),
    });
  }

  // 5. onset: does strain start on reading, or mid-solve?
  const strained = read.filter((r) => r.bx.struggle >= thr && r.bx.onset != null);
  if (strained.length >= 3) {
    const early = strained.filter((r) => r.bx.onset <= 10);
    const late = strained.filter((r) => r.bx.onset > 30);
    if (early.length / strained.length >= 0.6) {
      out.push({ id: 'onset-early', kind: 'info', weight: 60, title: 'Strain starts before you’ve tried anything', body: `On ${early.length} of ${strained.length} hard questions the strain began within 10 seconds, while you were still reading (${qs(early, 4)}). The question <i>looked</i> hard. Write the first line of working before you judge it.`, qs: early.map((r) => r.n) });
    } else if (late.length / strained.length >= 0.5) {
      out.push({ id: 'onset-late', kind: 'info', weight: 60, title: 'You start calm, then get stuck mid-solve', body: `On ${late.length} of ${strained.length} hard questions you were calm for the first 30 seconds and the strain came later (${qs(late, 4)}). You understand the question; one step in the method is failing. Practise that step, not the whole topic.`, qs: late.map((r) => r.n) });
    }
  }

  // 6. pressure answers: committing while strained
  const wrong = rows.filter((r) => r.attempted && r.correct === false && r.bx?.preAnswer != null);
  const right = rows.filter((r) => r.correct === true && r.bx?.preAnswer != null);
  if (wrong.length >= 3) {
    const wP = wrong.filter((r) => r.bx.preAnswer >= EXPRESSION.strained);
    const rP = right.filter((r) => r.bx.preAnswer >= EXPRESSION.strained);
    const wShare = wP.length / wrong.length, rShare = right.length ? rP.length / right.length : 0;
    if (wP.length >= 2 && wShare >= 0.5 && wShare >= rShare + 0.25) {
      out.push({ id: 'pressure', kind: 'warn', weight: 70, title: 'Wrong answers were committed under strain', body: `${wP.length} of your ${wrong.length} wrong answers were marked while your face was strained (${qs(wP, 4)}), against ${rP.length} of ${right.length} right ones. When you notice the frown, that’s the moment to mark for review instead of committing.`, qs: wP.map((r) => r.n) });
    }
  }

  // 7. stamina: first third vs last third
  const curve = strainCurve(s, 30);
  if (curve && curve.length >= 6) {
    const third = Math.floor(curve.length / 3);
    const first = curve.slice(0, third), last = curve.slice(-third);
    const fS = mean(first.map((b) => b.strain).filter((v) => v != null)), lS = mean(last.map((b) => b.strain).filter((v) => v != null));
    const fA = mean(first.map((b) => b.away)), lA = mean(last.map((b) => b.away));
    if (fS != null && lS != null && lS >= fS * 1.35 && lS - fS >= 0.05) {
      out.push({ id: 'stamina', kind: 'warn', weight: 65, title: 'Strain builds through the paper', body: `Your resting strain in the last third was <b>${Math.round((lS / fS - 1) * 100)}% higher</b> than in the first third${lA > fA * 1.8 && lA > 0.05 ? `, and you looked away ${(lA / Math.max(0.01, fA)).toFixed(1)}× as often` : ''}. That is fatigue, not difficulty. Full-length practice papers build the stamina.`, qs: [] });
    } else if (fS != null && lS != null && fS >= lS * 1.35 && fS - lS >= 0.05) {
      out.push({ id: 'warmup', kind: 'info', weight: 50, title: 'You settle in as the paper goes on', body: `You were noticeably more strained in the first third than the last. A two-minute warm-up (two easy questions) before a mock may help you start calmer.`, qs: [] });
    }
  }

  // 8. recovery after a strained stretch
  const recov = recoveryTimes(s);
  if (recov.length >= 3) {
    const med = median(recov);
    out.push({ id: 'recovery', kind: med > 20 ? 'warn' : 'good', weight: 40, title: med > 20 ? 'Strain lingers after a hard moment' : 'You recover quickly', body: `After a strained stretch it takes you about <b>${sec(med)}</b> to settle back to your calm face${med > 20 ? '. Moving on to a fresh question sooner, rather than staring, shortens this.' : '. That resilience is worth keeping.'}`, qs: [] });
  }

  // 9. subjects
  const subj = groupBehaviour(rows, 'subject').filter((g) => g.struggle != null && g.read >= 20);
  if (subj.length >= 2) {
    const hi = subj[0], lo = subj[subj.length - 1];
    if (hi.struggle - lo.struggle >= 15) {
      out.push({ id: 'subject', kind: 'info', weight: 45, title: `${hi.key} strains you most`, body: `${hi.key} questions averaged a struggle of <b>${hi.struggle}</b>, against <b>${lo.struggle}</b> in ${lo.key}${hi.accuracy != null && lo.accuracy != null ? `, with accuracy ${Math.round(hi.accuracy * 100)}% vs ${Math.round(lo.accuracy * 100)}%` : ''}.`, qs: hi.strainedQs.map((r) => r.n) });
    }
  }

  // 10. avoidance
  const avoided = by('avoided');
  if (avoided.length >= 2) {
    out.push({ id: 'avoided', kind: 'info', weight: 55, title: 'Skipped after straining', body: `You left ${qs(avoided)} blank after straining on them. That’s avoidance, not strategy: a quick elimination on those might have earned marks.`, qs: avoided.map((r) => r.n) });
  }

  // calm and correct overall
  const mastered = by('mastered');
  if (mastered.length >= Math.max(3, read.length * 0.5)) {
    out.push({ id: 'mastered', kind: 'good', weight: 30, title: `${mastered.length} questions were calm and correct`, body: `These are genuinely secure: ${qs(mastered, 8)}. Spend less time on these topics and more on the ones above.`, qs: mastered.map((r) => r.n) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Seconds from the end of each strained run (>= 4 s) back to calm (3 calm seconds in a row). */
export function recoveryTimes(s) {
  if (!hasTrace(s)) return [];
  const S = s.face.trace.s, V = s.face.trace.v, thr = EXPRESSION.strained;
  const out = [];
  let run = 0;
  for (let k = 0; k < S.length; k++) {
    const v = S[k] === 'r' && V[k] >= 0 ? V[k] / 100 : null;
    if (v != null && v >= thr) { run++; continue; }
    if (run >= 4) {
      let calm = 0, j = k;
      for (; j < Math.min(S.length, k + 120); j++) {
        const w = S[j] === 'r' && V[j] >= 0 ? V[j] / 100 : null;
        if (w != null && w < thr - 0.1) { calm++; if (calm >= 3) break; } else if (w != null) calm = 0;
      }
      if (calm >= 3) out.push(j - 2 - k);
    }
    run = 0;
  }
  return out;
}

/** Everything the report needs about behaviour for one session. */
export function behaviourReport(s, rows) {
  if (!hasTrace(s)) return { enabled: !!s.face?.enabled, legacy: !!s.face?.enabled && s.face.v !== 2, rows: [] };
  const S = s.face.trace.s;
  const cnt = { r: 0, w: 0, a: 0, n: 0, p: 0, x: 0 };
  for (const ch of S) cnt[ch] = (cnt[ch] || 0) + 1;
  const total = S.length || 1;
  const quads = Object.fromEntries(QUADRANT_ORDER.map((k) => [k, rows.filter((r) => r.bx?.quadrant === k)]));
  const read = rows.filter((r) => r.bx?.struggle != null);
  const fq = s.face.quality || {};
  const reasons = Object.entries(fq.reasons || {}).sort((a, b) => b[1] - a[1]);
  return {
    enabled: true,
    seconds: total,
    shares: { reading: cnt.r / total, writing: cnt.w / total, away: cnt.a / total, absent: cnt.n / total, poor: cnt.p / total, none: (cnt.x || 0) / total },
    coverage: (cnt.r + cnt.w) / total,
    readable: read.length,
    visited: rows.filter((r) => r.visits).length,
    meanStruggle: read.length ? Math.round(mean(read.map((r) => r.bx.struggle))) : null,
    quads,
    topics: groupBehaviour(rows, 'topic'),
    subjects: groupBehaviour(rows, 'subject'),
    curve: strainCurve(s, 30),
    fine: strainCurve(s, 5),
    insights: behaviourInsights(s, rows),
    calib: s.face.calib ? { kind: s.face.calib.kind, at: s.face.calib.at, range: !!s.face.calib.range?.ok?.brow, settled: !!s.face.settle } : null,
    qualityReasons: reasons,
  };
}
