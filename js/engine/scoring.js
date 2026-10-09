// Correctness and marks, including negative marking.
import { QMAP } from './paper.js';

export const isAnswered = (v) => v !== null && v !== undefined && v !== '';

export function isCorrect(q, ans) {
  if (!isAnswered(ans)) return null;
  if (q.type === 'mcq') return Number(ans) === q.answer;
  const v = parseFloat(ans);
  return !isNaN(v) && Math.abs(v - q.answer) <= (q.tolerance ?? 0) + 1e-9;
}

export function marksFor(q, ans, marking) {
  const m = marking[q.type] || marking.mcq;
  const c = isCorrect(q, ans);
  return c == null ? m.unattempted : c ? m.correct : m.wrong;
}

export function scoreSession(s) {
  let score = 0, max = 0, correct = 0, wrong = 0, unattempted = 0;
  const bySection = s.sections.map((sec) => ({ name: sec.name, score: 0, max: 0, correct: 0, wrong: 0, unattempted: 0 }));
  s.paper.forEach((p, i) => {
    const q = QMAP.get(p.id);
    const ans = s.responses[p.id]?.saved;
    const m = s.marking[q.type] || s.marking.mcq;
    const c = isCorrect(q, ans);
    const mk = marksFor(q, ans, s.marking);
    const sec = bySection[s.sections.findIndex((x) => i >= x.start && i < x.end)];
    score += mk; max += m.correct;
    sec.score += mk; sec.max += m.correct;
    if (c == null) { unattempted++; sec.unattempted++; } else if (c) { correct++; sec.correct++; } else { wrong++; sec.wrong++; }
  });
  const attempted = correct + wrong;
  return { score, max, correct, wrong, unattempted, attempted, accuracy: attempted ? correct / attempted : null, bySection };
}
