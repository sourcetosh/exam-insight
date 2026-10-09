// The coach's read: a written account of what happened in the test, built from the data.
// Always present, even when no rule fired. Describes behaviour, never feelings.
import { GROUPS } from './topics.js';
import { esc, fmtDur, pct, fix, plural, sum } from '../ui.js';

const Q = (n) => `<button class="qlink inline" data-q="${n}">Q${n}</button>`;
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const resultWord = (r) => (r.correct === true ? 'right' : r.correct === false ? 'wrong' : 'unanswered');

export function coachRead(R) {
  const { s, rows, score: sc, tl, level } = R;
  const full = level === 'full';
  const nav = tl.nav;
  const P = [];
  const n = rows.length;
  const usedFrac = s.elapsedMs / 1000 / s.durationSec;
  const left = Math.max(0, s.durationSec - s.elapsedMs / 1000);
  const wrong = rows.filter((r) => r.correct === false);
  const unopened = rows.filter((r) => !r.visits).length;

  // 1. Result and use of time
  let p1 = `You scored <b>${sc.score < 0 ? '−' + Math.abs(sc.score) : sc.score} of ${sc.max}</b>, attempting ${sc.attempted} of ${n}`;
  if (sc.attempted) p1 += ` with ${pct(sc.accuracy)} accuracy`;
  p1 += `, and used ${pct(usedFrac)} of the time`;
  if (s.endReason === 'timeout') p1 += ` — the clock ran out${unopened ? ` with ${plural(unopened, 'question')} never opened` : sc.unattempted ? ` with ${plural(sc.unattempted, 'question')} unanswered` : ''}.`;
  else if (usedFrac < 0.5) p1 += ` — you finished with ${fmtDur(left)} to spare${wrong.length ? `, time that could have gone to re-checking the ${plural(wrong.length, 'wrong answer')}` : ''}.`;
  else if (usedFrac < 0.9) p1 += `, finishing with ${fmtDur(left)} in hand.`;
  else p1 += `, close to the full allowance.`;
  if (R.pctile) p1 += ` That puts you above ${R.pctile.pct}% of the ${R.pctile.n.toLocaleString('en-IN')} pilot attempts on this format.`;
  P.push(p1);

  // 2. How you moved through the paper
  if (nav.opened) {
    let p2;
    if (nav.seqShare >= 0.85) p2 = `You went through the paper in order`;
    else if (nav.seqShare >= 0.5) p2 = `You mostly went in order, with ${plural(nav.jumps, 'jump')} to a non-adjacent question`;
    else p2 = `You moved around a lot: ${plural(nav.jumps, 'jump')} between non-adjacent questions`;
    p2 += `, answering ${nav.firstVisitAnswered} of ${sc.attempted || 0} on first sight`;
    if (nav.secondPass.segments) p2 += `, then came back to ${plural(nav.secondPass.questions, 'question')}${nav.secondPass.answered ? ` and answered ${nav.secondPass.answered} more` : ' without adding an answer'}.`;
    else p2 += '.';
    const sk = R.alloc?.skew;
    if (sk) {
      const over = sk.timeFrac > sk.availFrac;
      p2 += ` <b>${esc(sk.name)}</b> took ${pct(sk.timeFrac)} of your time for ${pct(sk.availFrac)} of the marks${sk.accuracy != null ? ` at ${pct(sk.accuracy)} accuracy` : ''} — ${over ? 'that is where the time went' : `it got less time than its weight${sk.accuracy != null && sk.accuracy < 0.6 ? ', and the accuracy there shows it' : ', and still held up'}`}.`;
    }
    P.push(p2);
  }

  // 3. Where the time went, and what changed
  const seen = rows.filter((r) => r.visits);
  if (seen.length) {
    const sinks = seen.filter((r) => r.timeRatio > 2).sort((a, b) => b.timeRatio - a.timeRatio);
    const longest = [...seen].sort((a, b) => b.timeRatio - a.timeRatio)[0];
    let p3;
    if (sinks.length) {
      const w = sinks[0];
      p3 = `${Q(w.n)} (${esc(w.topic)}) was the longest stop: ${fmtDur(w.timeSec)} against ${fmtDur(w.expectedSec)} expected, and it ended ${resultWord(w)}.`;
      if (sinks.length > 1) p3 += ` ${list(sinks.slice(1, 4).map((r) => Q(r.n)))} also ran past twice their expected time; together these cost about ${fmtDur(sum(sinks.map((r) => r.timeSec - r.expectedSec)))} over par.`;
    } else {
      p3 = `No question ran away with your time: the longest relative stop was ${Q(longest.n)} at ${fix(longest.timeRatio, 1)}× its expected time.`;
    }
    const quick = seen.filter((r) => r.timeRatio < 0.35 && r.attempted);
    if (quick.length >= 3) {
      const quickWrong = quick.filter((r) => r.correct === false).length;
      p3 += ` ${plural(quick.length, 'question')} took under a third of expected time${quickWrong ? `, and ${quickWrong} of those went wrong` : ', all of them right'}.`;
    }
    if (full) {
      if (nav.changes) {
        p3 += ` You changed ${plural(nav.changes, 'answer')}`;
        if (nav.flips) {
          const lost = sum(rows.filter((r) => r.flipLost).map((r) => r.maxMarks - r.marks));
          p3 += `, ${nav.flips} from right to wrong (${list(rows.filter((r) => r.flipsRW).map((r) => Q(r.n)))}${lost ? `, ${lost} marks` : ''})`;
        } else p3 += ', none from right to wrong';
        p3 += '.';
      } else if (sc.attempted) p3 += ' You never changed a saved answer.';
      const idleRow = [...seen].sort((a, b) => b.idleMaxSec - a.idleMaxSec)[0];
      if (idleRow && idleRow.idleMaxSec >= 45) p3 += ` Your longest pause with no input was ${fmtDur(idleRow.idleMaxSec)} on ${Q(idleRow.n)}.`;
      if (nav.blurCount) p3 += ` The tab lost focus ${plural(nav.blurCount, 'time')} for ${fmtDur(nav.blurTotal / 1000)} in total.`;
      if (nav.fsExits) p3 += ` You left full screen ${plural(nav.fsExits, 'time')}.`;
    }
    P.push(p3);
  }

  // 4. Topic read
  if (full && R.top5?.length) {
    const parts = R.top5.slice(0, 3).map((t) => {
      const g = GROUPS[t.group];
      const grp = t.status === 'insufficient' ? 'too few questions yet to group' : g ? g.label.toLowerCase() : 'unclassified';
      return `<b>${esc(t.topic)}</b> (${grp}): ${t.now.correct} of ${t.now.n} right at ${fix(t.now.timeRatio, 1)}× expected`;
    });
    let p4 = `By topic, the costliest were ${list(parts)}.`;
    const first = R.top5[0];
    if (first.status !== 'insufficient' && GROUPS[first.group]) p4 += ` For ${esc(first.topic)}: ${esc(GROUPS[first.group].action.toLowerCase())}`;
    P.push(p4);
  } else if (!full) {
    const byTopic = new Map();
    for (const r of rows) {
      const t = byTopic.get(r.topic) || { topic: r.topic, n: 0, right: 0, time: 0, exp: 0 };
      t.n++; t.right += r.correct ? 1 : 0; t.time += r.timeSec; t.exp += r.expectedSec;
      byTopic.set(r.topic, t);
    }
    const weak = [...byTopic.values()].filter((t) => t.right < t.n).sort((a, b) => a.right / a.n - b.right / b.n).slice(0, 2);
    if (weak.length) P.push(`By topic, the weakest were ${list(weak.map((t) => `<b>${esc(t.topic)}</b> (${t.right} of ${t.n} right, ${fix(t.exp ? t.time / t.exp : 0, 1)}× expected time)`))}.`);
  }

  // 5. Tags, guesses, cohort
  if (full) {
    const g = R.guess;
    let p5 = '';
    if (g?.tagged) {
      p5 += `Of the ${plural(g.tagged, 'question')} you tagged, ${g.byTag.guessed.n} ${g.byTag.guessed.n === 1 ? 'was' : 'were'} Guessed`;
      if (g.byTag.guessed.n) p5 += ` (${g.byTag.guessed.right} right, ${g.byTag.guessed.wrong} wrong, net ${g.byTag.guessed.net >= 0 ? '+' : '−'}${Math.abs(g.byTag.guessed.net)} marks)`;
      p5 += '.';
      if (g.byTag.panicked.n) p5 += ` You tagged ${list(g.byTag.panicked.qs.map(Q))} as Panicked; ${g.byTag.panicked.n === 1 ? 'it' : 'they'} ended ${list([...new Set(rows.filter((r) => r.tag === 'panicked').map(resultWord))])}.`;
    }
    const cc = R.cohortCmp;
    if (cc?.careless.length) {
      const r = cc.careless[0];
      p5 += ` ${Q(r.n)}, which ${pct(r.cohortP)} of the pilot cohort got right, went wrong for you — worth a second look before anything hard.`;
    }
    if (cc?.hardWins.length) {
      const r = cc.hardWins[0];
      p5 += ` On the other side, you got ${Q(r.n)} right when only ${pct(r.cohortP)} of the cohort did.`;
    }
    if (p5) P.push(p5.trim());
  }

  // 6. Close
  if (R.experiments?.length) {
    const x = R.experiments[0];
    P.push(`<b>Next time:</b> ${esc(x.title)}. ${esc(x.body)}`);
  }
  return P;
}
