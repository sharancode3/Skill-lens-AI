import { createSession, checkStoppingCondition } from './sessionManager.js';
import { initializeData, candidatesById } from './dataManager.js';
import { buildTopicQueue } from './topicSelector.js';

async function runTests() {
  console.log('--- STARTING PHASE 13 PART B VALIDATION TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  initializeData();
  const candidates = Array.from(candidatesById.values());
  const candidate = candidates[0];

  // Test 1: Random Target Selection between 8 and 12 inclusive
  console.log('\n[Test 1] Validating targetQuestionCount distribution (8-12 inclusive)...');
  const targetCounts = new Set();
  for (let i = 0; i < 30; i++) {
    const sessId = `test-target-${i}-${Date.now()}`;
    const sessRes = await createSession(sessId, candidate);
    assert(sessRes.targetQuestionCount >= 8 && sessRes.targetQuestionCount <= 12, `Session ${i} targetQuestionCount is within [8, 12]: ${sessRes.targetQuestionCount}`);
    targetCounts.add(sessRes.targetQuestionCount);
  }
  assert(targetCounts.size > 1, `Observed randomized variety of target counts across sessions: ${Array.from(targetCounts).join(', ')}`);

  // Test 2: Topic Queue Sizing (At least 14 topics covering >= 4 distinct days)
  console.log('\n[Test 2] Validating Topic Queue sizing across all candidates...');
  for (const cand of candidates) {
    const queue = buildTopicQueue(cand);
    const distinctDays = new Set(queue.map(q => q.day));
    assert(queue.length >= 14, `Candidate ${cand.member.id} queue length >= 14 (actual: ${queue.length})`);
    assert(distinctDays.size >= 4, `Candidate ${cand.member.id} distinct days >= 4 (actual: ${distinctDays.size})`);
  }

  // Test 3: Single Source of Truth Stopping Condition Logic
  console.log('\n[Test 3] Validating Stopping Condition dual-gate enforcement...');
  
  // Case A: 4 questions asked, 4 days covered, target = 10 -> MUST NOT STOP!
  const sessionA = {
    sessionId: 'test-stop-a',
    targetQuestionCount: 10,
    questionsAsked: 4,
    distinctDaysCovered: [1, 2, 3, 4],
    turnCount: 4
  };
  assert(checkStoppingCondition(sessionA, false) === false, '4 questions asked with target 10 does NOT stop (fixes 4-question bug)');

  // Case B: 8 questions asked, only 3 days covered, target = 8 -> MUST NOT STOP!
  const sessionB = {
    sessionId: 'test-stop-b',
    targetQuestionCount: 8,
    questionsAsked: 8,
    distinctDaysCovered: [1, 2, 3],
    turnCount: 8
  };
  assert(checkStoppingCondition(sessionB, false) === false, '8 questions asked with only 3 distinct days does NOT stop');

  // Case C: 8 questions asked, 4 days covered, target = 11 -> MUST NOT STOP!
  const sessionC = {
    sessionId: 'test-stop-c',
    targetQuestionCount: 11,
    questionsAsked: 8,
    distinctDaysCovered: [1, 2, 3, 4],
    turnCount: 8
  };
  assert(checkStoppingCondition(sessionC, false) === false, '8 questions asked with target 11 does NOT stop');

  // Case D: 11 questions asked, 4 days covered, target = 11 -> MUST STOP!
  const sessionD = {
    sessionId: 'test-stop-d',
    targetQuestionCount: 11,
    questionsAsked: 11,
    distinctDaysCovered: [1, 2, 3, 4],
    turnCount: 11
  };
  assert(checkStoppingCondition(sessionD, false) === true, '11 questions asked with 4 days and target 11 correctly triggers wrap-up');

  // Case E: 8 questions asked, 5 days covered, target = 8 -> MUST STOP!
  const sessionE = {
    sessionId: 'test-stop-e',
    targetQuestionCount: 8,
    questionsAsked: 8,
    distinctDaysCovered: [1, 2, 3, 4, 5],
    turnCount: 8
  };
  assert(checkStoppingCondition(sessionE, false) === true, '8 questions asked with 5 days and target 8 correctly triggers wrap-up');

  console.log(`\n=== RESULTS: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution crashed:', err);
  process.exit(1);
});
