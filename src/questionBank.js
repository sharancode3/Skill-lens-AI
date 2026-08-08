import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const questionBankPath = path.resolve(__dirname, './data/questionBank.json');

/**
 * Nested In-Memory Index:
 * bankByDay[dayNumber][questionType][difficultyTag] -> Array<QuestionObject>
 */
export const bankByDay = {};
let isInitialized = false;

/**
 * Normalizes difficulty tier for matching in the question bank.
 */
export function normalizeDifficulty(tier) {
  if (!tier) return 'standard';
  const t = String(tier).toLowerCase();
  if (t === 'foundational' || t === 'easy' || t === 'conceptual') return 'foundational';
  if (t === 'applied' || t === 'hard' || t === 'expert' || t === 'deep') return 'applied';
  return 'standard';
}

/**
 * Initializes and builds the nested in-memory index for O(1) retrieval.
 */
export function initQuestionBank() {
  if (isInitialized) return bankByDay;

  try {
    const raw = fs.readFileSync(questionBankPath, 'utf8');
    const data = JSON.parse(raw);

    // Initialize 31 curriculum day buckets
    for (let d = 1; d <= 31; d++) {
      bankByDay[d] = {
        mcq: {
          foundational: [],
          standard: [],
          applied: []
        },
        diagram_interpret: {
          foundational: [],
          standard: [],
          applied: []
        }
      };
    }

    // Populate MCQs into nested index
    if (data.mcqBank) {
      for (const [dayStr, items] of Object.entries(data.mcqBank)) {
        const day = parseInt(dayStr, 10);
        if (!bankByDay[day]) {
          bankByDay[day] = {
            mcq: { foundational: [], standard: [], applied: [] },
            diagram_interpret: { foundational: [], standard: [], applied: [] }
          };
        }
        for (const item of items) {
          const diff = normalizeDifficulty(item.difficulty);
          if (!bankByDay[day].mcq[diff]) bankByDay[day].mcq[diff] = [];
          bankByDay[day].mcq[diff].push(item);
        }
      }
    }

    // Populate Diagrams into nested index
    if (data.diagramBank) {
      for (const [dayStr, items] of Object.entries(data.diagramBank)) {
        const day = parseInt(dayStr, 10);
        if (!bankByDay[day]) {
          bankByDay[day] = {
            mcq: { foundational: [], standard: [], applied: [] },
            diagram_interpret: { foundational: [], standard: [], applied: [] }
          };
        }
        for (const item of items) {
          const diff = normalizeDifficulty(item.difficulty);
          if (!bankByDay[day].diagram_interpret[diff]) bankByDay[day].diagram_interpret[diff] = [];
          bankByDay[day].diagram_interpret[diff].push(item);
        }
      }
    }

    isInitialized = true;
    console.log(`[Question Bank] In-memory nested index initialized across ${Object.keys(bankByDay).length} days (${data.summary?.validMCQs || 0} MCQs, ${data.summary?.validDiagrams || 0} Diagrams).`);
  } catch (err) {
    console.error('[Question Bank] Error initializing questionBank.json:', err);
  }
  return bankByDay;
}

// Auto-initialize on module load
initQuestionBank();

/**
 * Retrieves a suitable pre-validated MCQ item for the specified day and difficulty.
 * Direct O(1) nested index lookup: bankByDay[day]['mcq'][difficulty]
 * 
 * @param {number} day - Curriculum day number (1..31).
 * @param {string} difficultyTier - Candidate's current difficulty tier.
 * @param {Array<string>} usedIds - IDs of questions already used in this session.
 * @returns {Object|null} The chosen MCQ question object, or null if exhausted.
 */
export function getMCQForDay(day, difficultyTier = 'standard', usedIds = []) {
  initQuestionBank();
  const dayStore = bankByDay[day];
  if (!dayStore || !dayStore.mcq) return null;

  const targetDiff = normalizeDifficulty(difficultyTier);
  const usedSet = new Set(usedIds);

  // 1. Direct O(1) nested index lookup
  let candidates = (dayStore.mcq[targetDiff] || []).filter(item => !usedSet.has(item.id));

  // 2. If no unused items at target difficulty, fall back to other difficulty tiers for this day
  if (candidates.length === 0) {
    const allTiers = ['standard', 'foundational', 'applied'];
    for (const tier of allTiers) {
      if (tier !== targetDiff) {
        const tierItems = (dayStore.mcq[tier] || []).filter(item => !usedSet.has(item.id));
        if (tierItems.length > 0) {
          candidates = tierItems;
          break;
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick a random candidate from eligible items to ensure variety across demo runs
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return selected;
}

/**
 * Retrieves a suitable pre-validated Diagram question item for the specified day and difficulty.
 * Direct O(1) nested index lookup: bankByDay[day]['diagram_interpret'][difficulty]
 * 
 * @param {number} day - Curriculum day number (1..31).
 * @param {string} difficultyTier - Candidate's current difficulty tier.
 * @param {Array<string>} usedIds - IDs of questions already used in this session.
 * @returns {Object|null} The chosen Diagram question object, or null if exhausted.
 */
export function getDiagramForDay(day, difficultyTier = 'standard', usedIds = []) {
  initQuestionBank();
  const dayStore = bankByDay[day];
  if (!dayStore || !dayStore.diagram_interpret) return null;

  const targetDiff = normalizeDifficulty(difficultyTier);
  const usedSet = new Set(usedIds);

  // 1. Direct O(1) nested index lookup
  let candidates = (dayStore.diagram_interpret[targetDiff] || []).filter(item => !usedSet.has(item.id));

  // 2. If no unused items at target difficulty, fall back to other difficulty tiers for this day
  if (candidates.length === 0) {
    const allTiers = ['standard', 'applied', 'foundational'];
    for (const tier of allTiers) {
      if (tier !== targetDiff) {
        const tierItems = (dayStore.diagram_interpret[tier] || []).filter(item => !usedSet.has(item.id));
        if (tierItems.length > 0) {
          candidates = tierItems;
          break;
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick a random candidate from eligible items to ensure variety across demo runs
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return selected;
}

/**
 * Returns summary statistics for the pre-generated question bank.
 */
export function getQuestionBankStats() {
  initQuestionBank();
  let totalMCQs = 0;
  let totalDiagrams = 0;

  for (const day in bankByDay) {
    const d = bankByDay[day];
    if (d.mcq) {
      totalMCQs += (d.mcq.foundational?.length || 0) + (d.mcq.standard?.length || 0) + (d.mcq.applied?.length || 0);
    }
    if (d.diagram_interpret) {
      totalDiagrams += (d.diagram_interpret.foundational?.length || 0) + (d.diagram_interpret.standard?.length || 0) + (d.diagram_interpret.applied?.length || 0);
    }
  }

  return {
    totalDaysIndexed: Object.keys(bankByDay).length,
    validMCQs: totalMCQs,
    validDiagrams: totalDiagrams
  };
}
