// Topic difficulty map: accuracy x time place each topic in one of four groups.
import { THRESHOLDS } from '../config.js';
import { mean, groupBy } from '../ui.js';

export const GROUPS = {
  fluent: {
    label: 'Fluent', cls: 'g-fluent',
    pattern: 'High accuracy, time at or under expected',
    action: 'Keep light revision; no change needed.',
  },
  slow: {
    label: 'Slow but sure', cls: 'g-slow',
    pattern: 'High accuracy, time well over expected',
    action: 'Speed practice: timed sets and shortcut methods.',
  },
  fast: {
    label: 'Fast and wrong', cls: 'g-fast',
    pattern: 'Low accuracy, time under expected',
    action: 'Likely careless reading or a misconception. Slow down and recheck the concept.',
  },
  struggling: {
    label: 'Struggling', cls: 'g-struggling',
    pattern: 'Low accuracy, time over expected, high friction',
    action: 'Re-learn the concept from the textbook first. Top priority.',
  },
};
export const GROUP_ORDER = ['struggling', 'fast', 'slow', 'fluent'];

export function statsFor(rows) {
  const seen = rows.filter((r) => r.visits > 0);
  const attempted = rows.filter((r) => r.attempted);
  const correct = attempted.filter((r) => r.correct);
  const tagged = rows.filter((r) => r.tag);
  const expSum = seen.reduce((s, r) => s + r.expectedSec, 0);
  const Fs = seen.map((r) => r.F).filter((x) => x != null);
  const marksLostUnits = rows.reduce((s, r) => s + (r.maxMarks - r.marks) / r.maxMarks, 0);
  const excessTime = seen.reduce((s, r) => s + Math.max(0, r.timeRatio - 1), 0);
  return {
    n: rows.length,
    seen: seen.length,
    attempted: attempted.length,
    correct: correct.length,
    accuracy: attempted.length ? correct.length / attempted.length : 0,
    attemptRate: rows.length ? attempted.length / rows.length : 0,
    timeRatio: expSum ? seen.reduce((s, r) => s + r.timeSec, 0) / expSum : null,
    timeSec: seen.reduce((s, r) => s + r.timeSec, 0),
    expSec: expSum,
    meanF: Fs.length ? mean(Fs) : null,
    guessRate: tagged.length ? tagged.filter((r) => r.tag === 'guessed').length / tagged.length : null,
    revisitRate: seen.length ? seen.reduce((s, r) => s + r.revisits, 0) / seen.length : 0,
    marksLost: rows.reduce((s, r) => s + (r.maxMarks - r.marks), 0),
    marks: rows.reduce((s, r) => s + r.marks, 0),
    max: rows.reduce((s, r) => s + r.maxMarks, 0),
    hurt: marksLostUnits + 0.5 * excessTime + 0.25 * Fs.reduce((s, f) => s + Math.max(0, f), 0),
  };
}

export function classify(st) {
  if (st.timeRatio == null) return null;
  if (st.accuracy >= THRESHOLDS.lowAccuracy) return st.timeRatio > THRESHOLDS.overExpected ? 'slow' : 'fluent';
  return st.timeRatio <= THRESHOLDS.underExpected ? 'fast' : 'struggling';
}

/**
 * tests: [{ session, rows }] chronological, the last one being "this test".
 * Returns one entry per topic with this-test and cumulative stats, group and status.
 */
export function topicMap(tests) {
  const current = tests[tests.length - 1];
  const allRows = tests.flatMap((t) => t.rows);
  const byTopic = groupBy(allRows, (r) => r.topic);
  const out = [];
  for (const [topic, rows] of byTopic) {
    const cum = statsFor(rows);
    const curRows = current.rows.filter((r) => r.topic === topic);
    const now = curRows.length ? statsFor(curRows) : null;
    const group = classify(cum);
    const perTest = tests
      .map((t) => { const rr = t.rows.filter((r) => r.topic === topic); return rr.length ? classify(statsFor(rr)) : null; })
      .filter(Boolean);
    const last = perTest.slice(-THRESHOLDS.confirmTests);
    let status;
    if (cum.n < THRESHOLDS.minTopicQuestions) status = 'insufficient';
    else if (last.length >= THRESHOLDS.confirmTests && last.every((g) => g === group)) status = 'confirmed';
    else status = 'early';
    out.push({
      topic,
      subject: rows[0].subject,
      chapter: rows[0].chapter,
      cum, now, group, status,
      repeats: perTest.filter((g) => g === group).length,
      testsSeen: perTest.length,
      inThisTest: !!now,
      highFriction: cum.meanF != null && cum.meanF > THRESHOLDS.highFriction,
    });
  }
  return out;
}

/** The five topics that hurt most in this test (marks lost, excess time, friction). */
export function topFive(map) {
  return map
    .filter((t) => t.now && t.now.hurt >= 1)
    .sort((a, b) => b.now.hurt - a.now.hurt)
    .slice(0, 5);
}

export const STATUS_LABEL = {
  insufficient: 'Not enough data yet',
  early: 'Early signal',
  confirmed: 'Confirmed across 3 tests',
};
