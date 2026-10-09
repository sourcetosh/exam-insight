// Replay data: what was open at every moment of the test, plus pacing and navigation stats.
import { isCorrect } from './scoring.js';

export function buildTimeline(s, rows, visits) {
  const byId = new Map(rows.map((r) => [r.qid, r]));
  const allowed = s.durationSec * 1000;
  const elapsed = Math.max(1, s.elapsedMs || 0);
  const visitCount = {};
  const segments = [];

  for (const v of visits) {
    const r = byId.get(v.q);
    if (!r) continue;
    const k = (visitCount[v.q] = (visitCount[v.q] || 0) + 1);
    const idle = v.events.filter((e) => e.type === 'idle').map((e) => ({ start: Math.max(v.start, e.t - e.dur), end: e.t }));
    const blur = v.events.filter((e) => e.type === 'focus').map((e) => ({ start: Math.max(v.start, e.t - e.dur), end: e.t }));
    const marks = [];
    for (const e of v.events) {
      if (e.type === 'save') marks.push({ t: e.t, type: 'save', correct: isCorrect(r.q, e.v), v: e.v });
      else if (e.type === 'select' && e.prev != null && String(e.prev) !== String(e.v)) {
        const flip = isCorrect(r.q, e.prev) === true && isCorrect(r.q, e.v) === false;
        marks.push({ t: e.t, type: flip ? 'flip' : 'change', from: e.prev, to: e.v });
      } else if (e.type === 'clear') marks.push({ t: e.t, type: 'clear' });
      else if (e.type === 'mark') marks.push({ t: e.t, type: e.on ? 'mark' : 'unmark' });
      else if (e.type === 'fs_exit') marks.push({ t: e.t, type: 'fs' });
      else if (e.type === 'proctor') marks.push({ t: e.t, type: 'proctor', code: e.code, dur: e.dur ?? null });
    }
    segments.push({
      q: v.q, n: r.n, subject: r.subject, topic: r.topic, start: v.start, end: v.end, dur: v.dur,
      visit: k, saved: marks.some((m) => m.type === 'save'), result: r.correct, idle, blur, marks,
    });
  }

  // Pace: distinct answered questions over time (saves add, clears remove).
  const ev = [...s.events].sort((a, b) => a.t - b.t);
  const answered = new Set();
  const pace = [{ t: 0, answered: 0 }];
  for (const e of ev) {
    if (e.type === 'save') answered.add(e.q);
    else if (e.type === 'clear') answered.delete(e.q);
    else continue;
    pace.push({ t: e.t, answered: answered.size });
  }
  pace.push({ t: elapsed, answered: answered.size });

  // Navigation: order of first visits, jumps, second pass.
  const firsts = segments.filter((x) => x.visit === 1);
  let seq = 0, jumps = 0;
  for (let i = 1; i < firsts.length; i++) {
    const d = firsts[i].n - firsts[i - 1].n;
    if (d === 1) seq++; else if (Math.abs(d) > 1) jumps++;
  }
  const revisits = segments.filter((x) => x.visit > 1);
  const nav = {
    opened: firsts.length,
    seqShare: firsts.length > 1 ? seq / (firsts.length - 1) : 1,
    jumps,
    firstVisitAnswered: firsts.filter((x) => x.saved).length,
    secondPass: { segments: revisits.length, answered: revisits.filter((x) => x.saved).length, questions: new Set(revisits.map((x) => x.n)).size },
    longest: segments.reduce((best, x) => (!best || x.dur > best.dur ? x : best), null),
    idleTotal: segments.reduce((a, x) => a + x.idle.reduce((b, i) => b + (i.end - i.start), 0), 0),
    blurCount: segments.reduce((a, x) => a + x.blur.length, 0),
    blurTotal: segments.reduce((a, x) => a + x.blur.reduce((b, i) => b + (i.end - i.start), 0), 0),
    changes: segments.reduce((a, x) => a + x.marks.filter((m) => m.type === 'change' || m.type === 'flip').length, 0),
    flips: segments.reduce((a, x) => a + x.marks.filter((m) => m.type === 'flip').length, 0),
    fsExits: segments.reduce((a, x) => a + x.marks.filter((m) => m.type === 'fs').length, 0),
  };

  const lanes = [...new Set(s.sections.map((x) => x.subject))];
  for (const x of segments) if (!lanes.includes(x.subject)) lanes.push(x.subject);

  return { allowed, elapsed, n: rows.length, segments, pace, nav, lanes, finalAnswered: answered.size };
}
