// testDifficultyHysteresis.js - Test suite for Difficulty Hysteresis rules
import { updateDifficulty } from './sessionManager.js';
import assert from 'assert';

console.log('========================================================');
console.log('RUNNING DIFFICULTY HYSTERESIS & TRANSITION TESTS');
console.log('========================================================\n');

// 1. Setup mock session
const session = {
  difficultyTier: 'standard',
  recentScores: [],
  accuracyLog: [],
  turnCount: 0,
  questionsAsked: 1,
  cursor: 0,
  topicQueue: [
    { day: 1, title: 'Python Foundations', objectives: [] },
    { day: 2, title: 'SQL & Database Indexing', objectives: [] },
    { day: 3, title: 'Concurrency & Async', objectives: [] },
    { day: 4, title: 'Caching & Redis', objectives: [] },
    { day: 5, title: 'Docker Deployments', objectives: [] }
  ],
  tiersReached: ['foundational', 'standard']
};

// Turn 1: Score 90
session.turnCount = 1;
updateDifficulty(session, 90, false);
assert.strictEqual(session.difficultyTier, 'standard', 'Should stay at standard on 1st score');
console.log('PASS: Stayed standard after score 1.');

// Turn 2: Score 90 -> Should escalate to Applied
session.turnCount = 2;
updateDifficulty(session, 90, false);
assert.strictEqual(session.difficultyTier, 'applied', 'Should escalate to applied after 2 consecutive 90s');
assert.strictEqual(session.lastTierChangeTurnCount, 2, 'Should set lastTierChangeTurnCount to 2');
console.log('PASS: Escalated to applied after score 2.');

// Turn 3: Score 30 (Newly escalated question) -> Should NOT de-escalate (Hysteresis safety check)
session.turnCount = 3;
// Push a mock entry to accuracyLog representing the turn response being evaluated
session.accuracyLog.push({ day: 2, difficultyTier: 'applied', finalAccuracyScore: 30, hallucinationFlag: false });
updateDifficulty(session, 30, false);
assert.strictEqual(session.difficultyTier, 'applied', 'Should NOT de-escalate on the very first question after escalation');
console.log('PASS: Prevented immediate de-escalation on first question at new tier.');

// Turn 4: Score 30 -> Should now de-escalate back to standard
session.turnCount = 4;
session.accuracyLog.push({ day: 3, difficultyTier: 'applied', finalAccuracyScore: 30, hallucinationFlag: false });
updateDifficulty(session, 30, false);
assert.strictEqual(session.difficultyTier, 'standard', 'Should de-escalate to standard on sustained weak performance');
assert.strictEqual(session.lastTierChangeTurnCount, 4, 'Should update lastTierChangeTurnCount to 4');
console.log('PASS: De-escalated after sustained weak performance.');

// 2. Setup mock session to test Hallucination block
console.log('\nTesting Hallucination safety blocks...');
const sessionHal = {
  difficultyTier: 'standard',
  recentScores: [],
  accuracyLog: [],
  turnCount: 0,
  questionsAsked: 1,
  cursor: 0,
  topicQueue: [
    { day: 1, title: 'Python Foundations', objectives: [] },
    { day: 2, title: 'SQL & Database Indexing', objectives: [] }
  ],
  tiersReached: ['foundational', 'standard']
};

// Turn 1: Score 90, with Hallucination
sessionHal.turnCount = 1;
updateDifficulty(sessionHal, 90, true); // hallucinationFlag = true
assert.strictEqual(sessionHal.difficultyTier, 'standard');

// Turn 2: Score 90, no hallucination
sessionHal.turnCount = 2;
// Push the previous turn's hallucination flag
sessionHal.accuracyLog.push({ day: 1, difficultyTier: 'standard', finalAccuracyScore: 90, hallucinationFlag: true });
updateDifficulty(sessionHal, 90, false); // hallucinationFlag = false, but prev was true
assert.strictEqual(sessionHal.difficultyTier, 'standard', 'Should NOT escalate because of recent hallucination');
console.log('PASS: Prevented escalation when hallucination was active.');

console.log('\n========================================================');
console.log('SUCCESS: All difficulty hysteresis tests passed!');
console.log('========================================================');
