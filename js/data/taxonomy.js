// Syllabus taxonomy (versioned so a syllabus change never rewrites old reports).
export const TAXONOMY_VERSION = 'syllabus-2026.1';

export const SUBJECTS = {
  Physics: { code: 'PHY', exams: ['JEE', 'NEET'] },
  Chemistry: { code: 'CHE', exams: ['JEE', 'NEET'] },
  Mathematics: { code: 'MAT', exams: ['JEE'] },
  Botany: { code: 'BOT', exams: ['NEET'] },
  Zoology: { code: 'ZOO', exams: ['NEET'] },
};

export const TOPICS = [
  { subject: 'Physics', chapter: 'Kinematics', topic: 'Projectile Motion' },
  { subject: 'Physics', chapter: 'System of Particles and Rotational Motion', topic: 'Rotational Dynamics' },
  { subject: 'Physics', chapter: 'Current Electricity', topic: 'DC Circuits' },
  { subject: 'Chemistry', chapter: 'Some Basic Concepts of Chemistry', topic: 'Mole Concept' },
  { subject: 'Chemistry', chapter: 'Equilibrium', topic: 'Chemical Equilibrium' },
  { subject: 'Chemistry', chapter: 'Organic Chemistry: Some Basic Principles', topic: 'General Organic Chemistry' },
  { subject: 'Mathematics', chapter: 'Complex Numbers and Quadratic Equations', topic: 'Quadratic Equations' },
  { subject: 'Mathematics', chapter: 'Integral Calculus', topic: 'Definite Integrals' },
  { subject: 'Mathematics', chapter: 'Statistics and Probability', topic: 'Probability' },
  { subject: 'Botany', chapter: 'Cell: Structure and Function', topic: 'Cell Cycle and Cell Division' },
  { subject: 'Botany', chapter: 'Plant Physiology', topic: 'Photosynthesis' },
  { subject: 'Botany', chapter: 'Genetics and Evolution', topic: 'Principles of Inheritance' },
  { subject: 'Zoology', chapter: 'Human Physiology', topic: 'Body Fluids and Circulation' },
  { subject: 'Zoology', chapter: 'Human Physiology', topic: 'Breathing and Exchange of Gases' },
  { subject: 'Zoology', chapter: 'Human Reproduction', topic: 'Human Reproduction' },
];

export const topicsFor = (exam) => TOPICS.filter((t) => SUBJECTS[t.subject].exams.includes(exam));
export const SUBJECT_ORDER = { Physics: 0, Chemistry: 1, Mathematics: 2, Botany: 3, Zoology: 4 };
