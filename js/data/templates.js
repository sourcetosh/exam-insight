// Exam formats live in editable templates, not code: official patterns change and
// published sources disagree. Each template is checked against the current NTA
// bulletin before an exam cycle (verification.status).

const JEE_MARKING = {
  mcq: { correct: 4, wrong: -1, unattempted: 0 },
  numerical: { correct: 4, wrong: -1, unattempted: 0 },
};
const NEET_MARKING = {
  mcq: { correct: 4, wrong: -1, unattempted: 0 },
  numerical: { correct: 4, wrong: 0, unattempted: 0 },
};

const JEE_NOTES = [
  'Sources agree: 75 compulsory questions, 300 marks, 3 hours, computer-based, MCQ + numerical-value.',
  'Sources disagree on whether numerical-value questions carry negative marking. Set to −1 here; confirm in the NTA bulletin.',
];
const NEET_NOTES = [
  'Sources agree: 180 compulsory MCQs, 720 marks, +4 / −1, 45 per subject, pen-and-paper.',
  'Duration reported as 180 min by some sources, 200 by another, 195 for the re-exam. Confirm in the NTA bulletin.',
  'One source still shows an optional Section B. Not modelled here.',
];

export const DEFAULT_TEMPLATES = [
  {
    id: 'jee-sprint',
    name: 'JEE Main · Sprint',
    blurb: 'Nine questions, about 20 minutes. Fastest way to see the full report.',
    exam: 'JEE', layout: 'cbt', kind: 'sprint',
    basis: { minutes: 180, questions: 75 },
    totalMin: 22,
    sections: [
      { name: 'Physics', subject: 'Physics', mcq: 2, numerical: 1 },
      { name: 'Chemistry', subject: 'Chemistry', mcq: 2, numerical: 1 },
      { name: 'Mathematics', subject: 'Mathematics', mcq: 2, numerical: 1 },
    ],
    marking: JEE_MARKING, partialMarking: null,
    palette: { states: 5, saveRequired: true, fullscreen: true },
    verification: { status: 'derived', checkedOn: null, notes: ['Practice format derived from JEE Main Paper 1. Time per question follows the full paper.'] },
  },
  {
    id: 'jee-mini',
    name: 'JEE Main · Mini mock',
    blurb: 'Twenty-four questions across all three subjects, timed like the real paper.',
    exam: 'JEE', layout: 'cbt', kind: 'mini',
    basis: { minutes: 180, questions: 75 },
    totalMin: 58,
    sections: [
      { name: 'Physics', subject: 'Physics', mcq: 6, numerical: 2 },
      { name: 'Chemistry', subject: 'Chemistry', mcq: 6, numerical: 2 },
      { name: 'Mathematics', subject: 'Mathematics', mcq: 6, numerical: 2 },
    ],
    marking: JEE_MARKING, partialMarking: null,
    palette: { states: 5, saveRequired: true, fullscreen: true },
    verification: { status: 'derived', checkedOn: null, notes: ['Practice format derived from JEE Main Paper 1.'] },
  },
  {
    id: 'jee-main-p1',
    name: 'JEE Main Paper 1 (B.E./B.Tech)',
    blurb: 'Full paper: 75 questions, 300 marks, 3 hours.',
    exam: 'JEE', layout: 'cbt', kind: 'full',
    basis: { minutes: 180, questions: 75 },
    totalMin: 180,
    sections: [
      { name: 'Physics', subject: 'Physics', mcq: 20, numerical: 5 },
      { name: 'Chemistry', subject: 'Chemistry', mcq: 20, numerical: 5 },
      { name: 'Mathematics', subject: 'Mathematics', mcq: 20, numerical: 5 },
    ],
    marking: JEE_MARKING, partialMarking: null,
    palette: { states: 5, saveRequired: true, fullscreen: true },
    verification: { status: 'needs-check', checkedOn: null, notes: JEE_NOTES },
  },
  {
    id: 'neet-sprint',
    name: 'NEET UG · Sprint',
    blurb: 'Twelve questions on a paper-style booklet with an OMR sheet.',
    exam: 'NEET', layout: 'omr', kind: 'sprint',
    basis: { minutes: 180, questions: 180 },
    totalMin: 12,
    sections: [
      { name: 'Physics', subject: 'Physics', mcq: 3, numerical: 0 },
      { name: 'Chemistry', subject: 'Chemistry', mcq: 3, numerical: 0 },
      { name: 'Botany', subject: 'Botany', mcq: 3, numerical: 0 },
      { name: 'Zoology', subject: 'Zoology', mcq: 3, numerical: 0 },
    ],
    marking: NEET_MARKING, partialMarking: null,
    palette: { states: 0, saveRequired: false, fullscreen: true },
    verification: { status: 'derived', checkedOn: null, notes: ['Practice format derived from NEET UG.'] },
  },
  {
    id: 'neet-bio-class10',
    name: 'Biology · Class 10 demo',
    blurb: 'Twelve simple Class 10 Biology questions. Anyone can take it in about five minutes: the quickest way to see your behaviour map.',
    exam: 'NEET', layout: 'cbt', kind: 'demo', bank: 'class10', demo: true,
    basis: { minutes: 180, questions: 180 },
    totalMin: 8,
    sections: [
      { name: 'Botany', subject: 'Botany', mcq: 6, numerical: 0 },
      { name: 'Zoology', subject: 'Zoology', mcq: 6, numerical: 0 },
    ],
    marking: NEET_MARKING, partialMarking: null,
    palette: { states: 5, saveRequired: true, fullscreen: false },
    verification: { status: 'derived', checkedOn: null, notes: ['Demo format: Class 10 NCERT Science (Biology) questions mapped onto the NEET Biology topics. Not a NEET paper.'] },
  },
  {
    id: 'neet-bio-sprint',
    name: 'Biology · Sprint',
    blurb: 'Twelve basic Botany and Zoology questions, computer-based. The quickest way to try the analytics.',
    exam: 'NEET', layout: 'cbt', kind: 'sprint',
    basis: { minutes: 180, questions: 180 },
    totalMin: 12,
    sections: [
      { name: 'Botany', subject: 'Botany', mcq: 6, numerical: 0 },
      { name: 'Zoology', subject: 'Zoology', mcq: 6, numerical: 0 },
    ],
    marking: NEET_MARKING, partialMarking: null,
    palette: { states: 5, saveRequired: true, fullscreen: false },
    verification: { status: 'derived', checkedOn: null, notes: ['Practice format: the Biology half of NEET UG, shortened and run on a computer-based screen. The real NEET is pen-and-paper; use the NEET UG papers for that layout.'] },
  },
  {
    id: 'neet-mini',
    name: 'NEET UG · Mini mock',
    blurb: 'Thirty-two questions, eight per subject, paper-style.',
    exam: 'NEET', layout: 'omr', kind: 'mini',
    basis: { minutes: 180, questions: 180 },
    totalMin: 32,
    sections: [
      { name: 'Physics', subject: 'Physics', mcq: 8, numerical: 0 },
      { name: 'Chemistry', subject: 'Chemistry', mcq: 8, numerical: 0 },
      { name: 'Botany', subject: 'Botany', mcq: 8, numerical: 0 },
      { name: 'Zoology', subject: 'Zoology', mcq: 8, numerical: 0 },
    ],
    marking: NEET_MARKING, partialMarking: null,
    palette: { states: 0, saveRequired: false, fullscreen: true },
    verification: { status: 'derived', checkedOn: null, notes: ['Practice format derived from NEET UG.'] },
  },
  {
    id: 'neet-ug',
    name: 'NEET UG',
    blurb: 'Full paper: 180 MCQs, 720 marks.',
    exam: 'NEET', layout: 'omr', kind: 'full',
    basis: { minutes: 180, questions: 180 },
    totalMin: 180,
    sections: [
      { name: 'Physics', subject: 'Physics', mcq: 45, numerical: 0 },
      { name: 'Chemistry', subject: 'Chemistry', mcq: 45, numerical: 0 },
      { name: 'Botany', subject: 'Botany', mcq: 45, numerical: 0 },
      { name: 'Zoology', subject: 'Zoology', mcq: 45, numerical: 0 },
    ],
    marking: NEET_MARKING, partialMarking: null,
    palette: { states: 0, saveRequired: false, fullscreen: true },
    verification: { status: 'needs-check', checkedOn: null, notes: NEET_NOTES },
  },
  {
    id: 'jee-advanced',
    name: 'JEE Advanced',
    blurb: 'Not configured in v1. Paper structure and marking change year to year.',
    exam: 'JEE', layout: 'cbt', kind: 'full', disabled: true,
    basis: { minutes: 180, questions: 54 },
    totalMin: 180,
    sections: [],
    marking: JEE_MARKING,
    partialMarking: 'Multiple-correct items: partial marks per correct option chosen, negative if any wrong option chosen. Rules vary by year — configure per paper.',
    palette: { states: 5, saveRequired: true, fullscreen: true },
    verification: { status: 'not-configured', checkedOn: null, notes: ['Not researched for v1. Handled through the template editor after v1.'] },
  },
];

export const secPerQ = (tpl) => (tpl.basis.minutes * 60) / tpl.basis.questions;
export const questionCount = (tpl) => tpl.sections.reduce((s, x) => s + x.mcq + x.numerical, 0);
export const maxMarks = (tpl) => tpl.sections.reduce((s, x) => s + x.mcq * tpl.marking.mcq.correct + x.numerical * tpl.marking.numerical.correct, 0);
