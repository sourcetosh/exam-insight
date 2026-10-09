// Self-report sample: the highest-friction questions plus a random few, tagged after the test.
import { analyze } from './report.js';
import { REVIEW } from '../config.js';
import { shuffle } from '../ui.js';

export function pickReviewSet(s, r = Math.random) {
  const { rows } = analyze(s);
  const visited = rows.filter((x) => x.visits > 0);
  const byF = [...visited].sort((a, b) => (b.F ?? -9) - (a.F ?? -9));
  const top = byF.slice(0, REVIEW.topFriction);
  const topIds = new Set(top.map((x) => x.qid));
  const rest = shuffle(rows.filter((x) => !topIds.has(x.qid)), r).slice(0, REVIEW.random);
  const ids = new Set([...topIds, ...rest.map((x) => x.qid)]);
  return s.paper.map((p) => p.id).filter((id) => ids.has(id));
}
