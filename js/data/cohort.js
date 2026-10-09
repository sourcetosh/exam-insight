// Synthetic pilot-cohort data. In production these come from aggregated,
// consented numeric summaries; here they are generated deterministically.
import { ALL_QUESTIONS, bankOf } from './bank.js';
import { EASY_TIME_FACTOR } from '../config.js';
import { topicsFor } from './taxonomy.js';
import { DIFFICULTY_MULT } from '../config.js';
import { rng, hashStr, clamp } from '../ui.js';

// Cohort distribution of per-question features. Used for z-scores until a student
// has completed THRESHOLDS.ownHistoryAfter tests.
export const COHORT_NORMS = {
  timeRatio: { mean: 1.0, sd: 0.6 },
  revisits: { mean: 0.35, sd: 0.65 },
  changes: { mean: 0.22, sd: 0.5 },
  idle: { mean: 18, sd: 22 },
  face: { mean: 0.15, sd: 0.85 },
};

// Floors keep z-scores sane when a student's own history is very uniform.
export const SD_FLOOR = { timeRatio: 0.25, revisits: 0.35, changes: 0.3, idle: 8, face: 0.3 };

const SEC_PER_Q = { JEE: (180 * 60) / 75, NEET: (180 * 60) / 180 };

/** Per-question empirical stats, keyed exam -> qid. */
export const EMPIRICAL = (() => {
  const out = { JEE: {}, NEET: {} };
  for (const q of ALL_QUESTIONS) {
    for (const exam of q.exams) {
      const r = rng(hashStr(q.id + exam));
      const easy = bankOf(q.id) !== 'standard';
      const attempts = Math.round(60 + r() * 540);
      const median = Math.max(10, Math.round(SEC_PER_Q[exam] * DIFFICULTY_MULT[q.difficulty] * (0.78 + r() * 0.44) * (easy ? EASY_TIME_FACTOR : 1)));
      const pCorrect = easy ? clamp(0.9 + (r() - 0.5) * 0.12, 0.7, 0.98) : clamp(0.86 - 0.17 * (q.difficulty - 1) + (r() - 0.5) * 0.22, 0.12, 0.96);
      const rec = { attempts, medianCorrectSec: attempts >= 200 ? median : null, pCorrect, flag: null };
      // Quality loop: a few items show odd statistics and go back to a teacher.
      if (q.type === 'mcq' && hashStr(q.id + 'flag') % 17 === 0 && attempts >= 200) {
        const wrong = [0, 1, 2, 3].filter((i) => i !== q.answer);
        const opt = wrong[Math.floor(r() * wrong.length)];
        rec.flag = {
          kind: 'distractor',
          option: opt,
          share: Math.round(34 + r() * 14),
          note: `Option ${'ABCD'[opt]} is picked by more top-quartile students than the key.`,
        };
      } else if (hashStr(q.id + 'slow') % 29 === 0 && attempts >= 200) {
        rec.flag = { kind: 'time', note: 'Median time among correct answers is over 2× the teacher estimate.' };
      }
      out[exam][q.id] = rec;
    }
  }
  return out;
})();

/** Coach view cohort: pseudonymous learners, some opted out. */
export function coachCohort(exam) {
  const topics = topicsFor(exam);
  const learners = [];
  for (let i = 0; i < 14; i++) {
    const r = rng(hashStr(`${exam}-learner-${i}`));
    const optedIn = r() > 0.28;
    const skill = 0.35 + r() * 0.45;
    const cells = {};
    for (const t of topics) {
      const tr = rng(hashStr(`${exam}-${i}-${t.topic}`));
      const topicBias = (hashStr(t.topic) % 7) / 20 - 0.15;
      const acc = clamp(skill + topicBias + (tr() - 0.5) * 0.35, 0.05, 0.98);
      const friction = clamp((0.6 - acc) * 1.8 + (tr() - 0.5) * 0.6, -1.2, 2.2);
      cells[t.topic] = { accuracy: acc, friction, n: 6 + Math.floor(tr() * 14) };
    }
    learners.push({ id: `L-${(101 + i * 7).toString()}`, label: `Learner ${String.fromCharCode(65 + i)}`, optedIn, cells });
  }
  return learners;
}
