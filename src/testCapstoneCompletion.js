// testCapstoneCompletion.js - Test suite for stronger Capstone/completion triggers
import { shouldWrapUp } from './sessionManager.js';
import assert from 'assert';

console.log('========================================================');
console.log('RUNNING STRONGER CAPSTONE/COMPLETION TRIGGER TESTS');
console.log('========================================================\n');

// SCENARIO 1: Strong Candidate (normal completion)
console.log('[Scenario 1] Simulating strong candidate...');
const sessionStrong = {
  difficultyTier: 'expert',
  turnCount: 10,
  questionsAsked: 10,
  distinctDaysCovered: [1, 2, 3, 4],
  capstoneTriggered: true,
  accuracyLog: [
    { day: 1, difficultyTier: 'standard', finalAccuracyScore: 90, questionType: 'open' },
    { day: 2, difficultyTier: 'applied', finalAccuracyScore: 95, questionType: 'open' },
    { day: 3, difficultyTier: 'applied', finalAccuracyScore: 95, questionType: 'open' },
    { day: 4, difficultyTier: 'expert', finalAccuracyScore: 100, questionType: 'open' },
    { day: 4, difficultyTier: 'expert', finalAccuracyScore: 90, questionType: 'capstone' }
  ]
};

// Capstone is answered and model wants to stop
assert.strictEqual(shouldWrapUp(sessionStrong, true), true, 'Strong candidate should be allowed to wrap up');
console.log(' -> PASS: Strong candidate wraps up.');

// SCENARIO 2: Strong scores, but restricted to Standard tier (e.g. no applied/expert questions asked)
console.log('\n[Scenario 2] Simulating candidate with high scores but only standard tier...');
const sessionRestricted = {
  difficultyTier: 'standard',
  turnCount: 10,
  questionsAsked: 10,
  distinctDaysCovered: [1, 2, 3, 4],
  capstoneTriggered: false,
  accuracyLog: [
    { day: 1, difficultyTier: 'standard', finalAccuracyScore: 95, questionType: 'open' },
    { day: 2, difficultyTier: 'standard', finalAccuracyScore: 95, questionType: 'open' },
    { day: 3, difficultyTier: 'standard', finalAccuracyScore: 95, questionType: 'open' },
    { day: 4, difficultyTier: 'standard', finalAccuracyScore: 95, questionType: 'open' }
  ]
};

// Even if model wants to stop, shouldWrapUp must return false because they have 0 applied/expert questions
assert.strictEqual(shouldWrapUp(sessionRestricted, true), false, 'Candidate with zero applied/expert questions should NOT wrap up');
console.log(' -> PASS: Candidate with zero applied/expert questions blocked from wrap up.');

// SCENARIO 3: Weak Candidate (Safeguard turn hard cap)
console.log('\n[Scenario 3] Simulating weak candidate hitting 14 turn cap...');
const sessionWeak = {
  difficultyTier: 'foundational',
  turnCount: 14,
  questionsAsked: 8,
  distinctDaysCovered: [1, 2, 3, 4],
  capstoneTriggered: false,
  accuracyLog: [
    { day: 1, difficultyTier: 'foundational', finalAccuracyScore: 20, questionType: 'open' },
    { day: 2, difficultyTier: 'foundational', finalAccuracyScore: 20, questionType: 'open' },
    { day: 3, difficultyTier: 'foundational', finalAccuracyScore: 20, questionType: 'open' },
    { day: 4, difficultyTier: 'foundational', finalAccuracyScore: 20, questionType: 'open' }
  ]
};

// shouldWrapUp must return true on hard cap regardless of other checks
assert.strictEqual(shouldWrapUp(sessionWeak, false), true, 'Weak candidate must wrap up on hitting 14 turns hard cap');
console.log(' -> PASS: Weak candidate wraps up due to hard cap safeguard.');

console.log('\n========================================================');
console.log('SUCCESS: All completion/capstone tests passed!');
console.log('========================================================');
