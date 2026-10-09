// Three question banks share one taxonomy: the standard bank (NCERT / JEE Main / NEET level),
// the test-drive bank (very easy items for trying the analytics quickly) and a small Class 10
// Biology bank for a first demo anyone can attempt.
import { QUESTIONS } from './questions.js';
import { QUESTIONS_EASY } from './questions-easy.js';
import { QUESTIONS_CLASS10 } from './questions-class10.js';

export const BANK = { standard: QUESTIONS, easy: QUESTIONS_EASY, class10: QUESTIONS_CLASS10 };
export const ALL_QUESTIONS = [...QUESTIONS, ...QUESTIONS_EASY, ...QUESTIONS_CLASS10];
export const bankOf = (id) => (String(id).startsWith('C10-') ? 'class10' : String(id).startsWith('E-') ? 'easy' : 'standard');
/** Banks whose items are trivially easy, so expected time is scaled down. */
export const isEasyBank = (b) => b === 'easy' || b === 'class10';
