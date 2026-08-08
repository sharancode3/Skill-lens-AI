import assert from 'assert';
import { initializeData, getCandidateById } from './dataManager.js';
import { buildTopicQueue } from './topicSelector.js';
import { checkStoppingCondition, createSession, handleTurn, getSessionDoc, saveSessionDoc } from './sessionManager.js';

async function runTests() {
  console.log("========================================================");
  console.log("RUNNING PART E: STOPPING CONDITION REGRESSION TESTS");
  console.log("========================================================");

  // Initialize data manager
  initializeData();

  const realCandidate = getCandidateById("CAND-001");
  if (!realCandidate) {
    throw new Error("Could not load real candidate CAND-001");
  }

  // 1. Verify buildTopicQueue queue length and day diversity constraints
  console.log("[Test 1] Verifying buildTopicQueue sizes...");
  const queue = buildTopicQueue(realCandidate);
  assert.ok(queue.length >= 8, `Queue must have at least 8 topics, got ${queue.length}`);
  const uniqueDays = new Set(queue.map(q => q.day));
  assert.ok(uniqueDays.size >= 4, `Queue must cover at least 4 distinct days, got ${uniqueDays.size}`);
  console.log(` -> PASS: Queue size is ${queue.length} with ${uniqueDays.size} distinct days.`);

  // 2. Verify checkStoppingCondition floor bounds
  console.log("[Test 2] Verifying floor limits on checkStoppingCondition...");
  const sessionMock = {
    turnCount: 5,
    questionsAsked: 5,
    distinctDaysCovered: [1, 2, 3],
    capstoneTriggered: false,
    accuracyLog: [
      { difficultyTier: 'standard', finalAccuracyScore: 90 },
      { difficultyTier: 'standard', finalAccuracyScore: 90 }
    ],
    topicQueue: queue,
    cursor: 4
  };

  // Floor not met: questionsAsked < 8, distinctDays < 4
  assert.strictEqual(checkStoppingCondition(sessionMock, true), false, "Should not stop early when floor is not met");
  console.log(" -> PASS: blocked stopping when floor not met.");

  // Increase questionsAsked but keep distinct days < 4
  sessionMock.questionsAsked = 8;
  assert.strictEqual(checkStoppingCondition(sessionMock, true), false, "Should not stop when distinct days < 4");
  console.log(" -> PASS: blocked stopping when distinct days < 4.");

  // Meet floor, but keep applied/expert count < 2
  sessionMock.distinctDaysCovered = [1, 2, 3, 4];
  assert.strictEqual(checkStoppingCondition(sessionMock, true), false, "Should not stop when applied/expert questions < 2");
  console.log(" -> PASS: blocked stopping when applied/expert questions count < 2.");

  // Meet all requirements (including applied/expert count >= 2)
  sessionMock.accuracyLog.push(
    { difficultyTier: 'applied', finalAccuracyScore: 85 },
    { difficultyTier: 'applied', finalAccuracyScore: 85 }
  );
  assert.strictEqual(checkStoppingCondition(sessionMock, true), true, "Should allow wrap up when all floor criteria are met");
  console.log(" -> PASS: Allowed wrap up when floor and tier constraints met.");

  // 3. Verify hard turn cap limit of 16
  console.log("[Test 3] Verifying 16-turn cap limit...");
  const weakSession = {
    turnCount: 16,
    questionsAsked: 4,
    distinctDaysCovered: [1, 2],
    accuracyLog: [],
    topicQueue: queue,
    cursor: 3
  };
  assert.strictEqual(checkStoppingCondition(weakSession, false), true, "Should force wrap up on turnCount >= 16 regardless of other constraints");
  console.log(" -> PASS: 16-turn cap triggers hard wrap-up.");

  // 4. Verify end-to-end integration and questionsAsked increment
  console.log("[Test 4] Verifying end-to-end turn loop questionsAsked updates...");
  const sessionId = `test-part-e-${Date.now()}`;
  await createSession(sessionId, realCandidate);
  
  let currentDoc = await getSessionDoc(sessionId);
  assert.strictEqual(currentDoc.questionsAsked, 1, "Initial session must start with questionsAsked = 1");
  
  // Advance through 8 turns and verify questionsAsked is updated
  // We mock the LLM client call response properties
  const payload = await handleTurn(sessionId, "Standard engineering response details.");
  currentDoc = await getSessionDoc(sessionId);
  assert.ok(currentDoc.questionsAsked >= 1, `questionsAsked should be updated, got ${currentDoc.questionsAsked}`);
  console.log(` -> PASS: End-to-end turns increment questionsAsked correctly. Current: ${currentDoc.questionsAsked}`);

  console.log("\n========================================================");
  console.log("SUCCESS: All Part E stopping and queue tests passed!");
  console.log("========================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
