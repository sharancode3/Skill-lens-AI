import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const questionBankPath = path.resolve(__dirname, './data/questionBank.json');

let questionBankData = null;

function loadQuestionBank() {
  if (questionBankData) return questionBankData;
  try {
    const raw = fs.readFileSync(questionBankPath, 'utf8');
    questionBankData = JSON.parse(raw);
    console.log(`[Question Bank] Successfully loaded pre-generated Question Bank (${questionBankData.summary?.validMCQs || 0} MCQs, ${questionBankData.summary?.validDiagrams || 0} Diagrams).`);
  } catch (err) {
    console.error('[Question Bank] Error loading questionBank.json:', err);
    questionBankData = { mcqBank: {}, diagramBank: {} };
  }
  return questionBankData;
}

/**
 * Normalizes difficulty tier for matching in the question bank.
 */
function normalizeDifficulty(tier) {
  if (!tier) return 'standard';
  const t = String(tier).toLowerCase();
  if (t === 'foundational' || t === 'easy' || t === 'conceptual') return 'foundational';
  if (t === 'applied' || t === 'hard' || t === 'expert' || t === 'deep') return 'applied';
  return 'standard';
}

/**
 * Retrieves a suitable pre-validated MCQ item for the specified day and difficulty.
 * 
 * @param {number} day - Curriculum day number (1..31).
 * @param {string} difficultyTier - Candidate's current difficulty tier.
 * @param {Array<string>} usedIds - IDs of questions already used in this session.
 * @returns {Object|null} The chosen MCQ question object, or null if exhausted.
 */
export function getMCQForDay(day, difficultyTier = 'standard', usedIds = []) {
  const bank = loadQuestionBank();
  const dayItems = bank.mcqBank?.[day] || [];
  if (dayItems.length === 0) return null;

  const targetDiff = normalizeDifficulty(difficultyTier);
  const usedSet = new Set(usedIds);

  // 1. Try matching target difficulty first
  let candidates = dayItems.filter(item => !usedSet.has(item.id) && item.difficulty === targetDiff);

  // 2. If no exact difficulty match, fall back to any unused MCQ for this day
  if (candidates.length === 0) {
    candidates = dayItems.filter(item => !usedSet.has(item.id));
  }

  if (candidates.length === 0) return null;

  // Pick a random candidate from eligible items
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return selected;
}

/**
 * Retrieves a suitable pre-validated Diagram question item for the specified day and difficulty.
 * 
 * @param {number} day - Curriculum day number (1..31).
 * @param {string} difficultyTier - Candidate's current difficulty tier.
 * @param {Array<string>} usedIds - IDs of questions already used in this session.
 * @returns {Object|null} The chosen Diagram question object, or null if exhausted.
 */
export function getDiagramForDay(day, difficultyTier = 'standard', usedIds = []) {
  const bank = loadQuestionBank();
  const dayItems = bank.diagramBank?.[day] || [];
  if (dayItems.length === 0) return null;

  const targetDiff = normalizeDifficulty(difficultyTier);
  const usedSet = new Set(usedIds);

  // 1. Try matching target difficulty first
  let candidates = dayItems.filter(item => !usedSet.has(item.id) && item.difficulty === targetDiff);

  // 2. If no exact difficulty match, fall back to any unused diagram for this day
  if (candidates.length === 0) {
    candidates = dayItems.filter(item => !usedSet.has(item.id));
  }

  if (candidates.length === 0) return null;

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return selected;
}

/**
 * Returns summary statistics for the pre-generated question bank.
 */
export function getQuestionBankStats() {
  const bank = loadQuestionBank();
  return bank.summary || { validMCQs: 0, validDiagrams: 0 };
}
