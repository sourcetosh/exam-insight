// Friction index: how much a question cost this student versus their own usual behaviour.
// F = 0.35 z(t/t̂) + 0.20 z(r) + 0.15 z(c) + 0.15 z(i) + 0.15 z(f)
// z is against the student's own history (cohort for the first three tests).
// Without a camera the face weight is spread proportionally over the other four.
import { WEIGHTS, THRESHOLDS } from '../config.js';
import { COHORT_NORMS, SD_FLOOR } from '../data/cohort.js';
import { mean, sd, clamp } from '../ui.js';

export const FEATURES = ['timeRatio', 'revisits', 'changes', 'idle', 'face'];
const WKEY = { timeRatio: 'time', revisits: 'revisits', changes: 'changes', idle: 'idle', face: 'face' };
export const FEATURE_LABEL = {
  timeRatio: 'Time vs expected', revisits: 'Revisits', changes: 'Answer changes', idle: 'Longest idle gap', face: 'Tension marker',
};

export function featureValues(r) {
  return {
    timeRatio: r.timeRatio,
    revisits: r.revisits,
    changes: r.changes,
    idle: r.idleMaxSec,
    face: r.face?.ok ? r.face.marker : null,
  };
}

/** priorRowSets: arrays of question rows from earlier full-analytics tests. */
export function baselineFrom(priorRowSets) {
  const tests = priorRowSets.length;
  if (tests < THRESHOLDS.ownHistoryAfter) return { source: 'cohort', tests, stats: COHORT_NORMS };
  const pooled = priorRowSets.flat().filter((r) => r.visits > 0);
  const stats = {};
  for (const f of FEATURES) {
    const vals = pooled.map((r) => featureValues(r)[f]).filter((v) => v != null && !isNaN(v));
    stats[f] = vals.length >= 10 ? { mean: mean(vals), sd: sd(vals) } : COHORT_NORMS[f];
  }
  return { source: 'own', tests, stats };
}

export function applyFriction(rows, baseline) {
  for (const r of rows) {
    if (!r.visits) { r.z = null; r.F = null; continue; }
    const vals = featureValues(r);
    const z = {};
    for (const f of FEATURES) {
      const v = vals[f];
      if (v == null || isNaN(v)) { z[f] = null; continue; }
      const st = baseline.stats[f];
      z[f] = clamp((v - st.mean) / Math.max(st.sd || 0, SD_FLOOR[f]), -2.5, 3.5);
    }
    const active = FEATURES.filter((f) => z[f] != null);
    const wsum = active.reduce((s, f) => s + WEIGHTS[WKEY[f]], 0);
    // Face weight never exceeds its base 0.15; others are renormalised when it is absent.
    let F = 0;
    const w = {};
    for (const f of active) {
      w[f] = WEIGHTS[WKEY[f]] / wsum;
      F += w[f] * z[f];
    }
    r.z = z;
    r.w = w;
    r.F = F;
  }
  return rows;
}

/** Which feature contributed most to F (for plain-language explanations). */
export function topDriver(r) {
  if (!r.z) return null;
  let best = null;
  for (const f of FEATURES) {
    if (r.z[f] == null) continue;
    const c = r.w[f] * r.z[f];
    if (!best || c > best.c) best = { f, c };
  }
  return best && best.c > 0.15 ? best.f : null;
}
