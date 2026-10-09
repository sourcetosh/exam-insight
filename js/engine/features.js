// Turns a session's event log into visits and per-question behaviour features.
import { QMAP } from './paper.js';
import { isAnswered, isCorrect, marksFor } from './scoring.js';
import { FACE } from '../config.js';
import { EMPIRICAL } from '../data/cohort.js';

/** Reconstruct question visits (enter -> leave) from the event log.
 *  Event times are test-clock ms, so time while a tab was closed never counts. */
export function buildVisits(s) {
  const ev = [...s.events].sort((a, b) => a.t - b.t);
  const endT = Math.max(s.elapsedMs || 0, ev.length ? ev[ev.length - 1].t : 0);
  const visits = [];
  let cur = null;
  const close = (t) => {
    if (!cur) return;
    cur.end = Math.max(t, cur.start);
    cur.dur = cur.end - cur.start;
    visits.push(cur);
    cur = null;
  };
  for (const e of ev) {
    if (e.type === 'enter') {
      close(e.t);
      cur = { q: e.q, start: e.t, events: [] };
    } else if (e.type === 'leave') {
      if (cur && cur.q === e.q) close(e.t);
    } else if (e.type === 'end') {
      close(e.t);
    } else if (cur && (e.q == null || e.q === cur.q)) {
      cur.events.push(e);
    }
  }
  close(endT);
  return visits;
}

/** One row per paper question with everything the analytics need. */
export function questionRows(s) {
  const visits = buildVisits(s);
  const rows = s.paper.map((p, i) => {
    const q = QMAP.get(p.id);
    const saved = s.responses[p.id]?.saved ?? null;
    const m = s.marking[q.type] || s.marking.mcq;
    return {
      qid: p.id, n: p.n ?? i + 1, idx: i, q,
      section: p.section, subject: q.subject, chapter: q.chapter, topic: q.topic, difficulty: q.difficulty, type: q.type,
      expectedSec: p.expectedSec, expSource: p.expSource,
      timeMs: 0, visits: 0, revisits: 0, changes: 0, flipsRW: 0, idleMaxSec: 0, blurCount: 0, fsExits: 0,
      firstDwellSec: null, firstVisitAt: null, firstAnswerAt: null, lastAnswerAt: null,
      selections: [], hadRight: false,
      final: saved, attempted: isAnswered(saved), correct: isCorrect(q, saved), marks: marksFor(q, saved, s.marking),
      maxMarks: m.correct, wrongMarks: m.wrong,
      face: null, tag: s.tags?.[p.id] ?? null,
      cohortP: EMPIRICAL[s.exam]?.[p.id]?.pCorrect ?? null, solution: q.solution || null,
      timeRatio: null, z: null, F: null,
    };
  });
  const byId = new Map(rows.map((r) => [r.qid, r]));

  for (const v of visits) {
    const r = byId.get(v.q);
    if (!r) continue;
    r.timeMs += v.dur;
    r.visits += 1;
    if (r.firstDwellSec == null) { r.firstDwellSec = v.dur / 1000; r.firstVisitAt = v.start; }
    for (const e of v.events) {
      switch (e.type) {
        case 'select': {
          if (isAnswered(e.prev) && String(e.prev) !== String(e.v)) {
            r.changes += 1;
            if (isCorrect(r.q, e.prev) && !isCorrect(r.q, e.v)) r.flipsRW += 1;
          }
          if (isCorrect(r.q, e.v)) r.hadRight = true;
          r.selections.push(e.v);
          break;
        }
        case 'save':
          if (r.firstAnswerAt == null) r.firstAnswerAt = e.t;
          r.lastAnswerAt = e.t;
          break;
        case 'clear':
          if (isAnswered(e.prev)) r.changes += 1;
          break;
        case 'idle':
          r.idleMaxSec = Math.max(r.idleMaxSec, e.dur / 1000);
          break;
        case 'blur':
          r.blurCount += 1;
          break;
        case 'fs_exit':
          r.fsExits += 1;
          break;
        default:
      }
    }
  }

  for (const r of rows) {
    r.timeSec = r.timeMs / 1000;
    r.revisits = Math.max(0, r.visits - 1);
    r.timeRatio = r.visits ? r.timeSec / r.expectedSec : null;
    r.flipLost = r.flipsRW && r.attempted && !r.correct && r.hadRight;
    const f = s.face?.enabled ? s.face.perQ?.[r.qid] : null;
    if (f && f.n) {
      const validFrac = f.valid / f.n;
      const ok = f.valid >= FACE.minSamples && validFrac >= FACE.minValidFrac;
      r.face = {
        ok,
        validFrac,
        marker: ok ? f.sumM / f.valid : null,
        gazeAway: f.valid ? f.gaze / f.valid : null,
        blinkPerMin: f.valid ? f.blinks / (f.valid / FACE.fps / 60) : null,
        dropped: f.n - f.valid,
      };
    }
  }
  return { rows, visits };
}

export function visitedRows(rows) {
  return rows.filter((r) => r.visits > 0);
}
