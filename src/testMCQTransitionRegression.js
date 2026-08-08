import assert from 'assert';
import { handleTurn, getSessionDoc, saveSessionDoc, SessionState } from './sessionManager.js';

// Setup Mock Environment Variables
process.env.SIMULATE_LLM_OUTAGE = 'true';
process.env.NODE_ENV = 'test';

async function setupMockSession(sessionId) {
  const mockCandidate = {
    id: "CAND-001",
    member: {
      name: "Jane Doe",
      jobRole: "Software Engineer"
    },
    curriculumProgress: {
      completedDays: [3, 4]
    }
  };

  const initialSession = {
    id: sessionId,
    candidateSnapshot: mockCandidate,
    state: SessionState.ASKING,
    cursor: 0,
    turnCount: 2,
    questionsAsked: 1,
    distinctDaysCovered: [3],
    topicQueue: [
      { day: 3, title: "Pandas SQLite Fundamentals", status: "asked", objectives: ["Use pandas", "Query sqlite"] },
      { day: 4, title: "Data Cleaning Strategies", status: "pending", objectives: ["Handle nulls", "Filter noise"] },
      { day: 5, title: "Feature Engineering Techniques", status: "pending", objectives: ["One hot encoding", "Normalization"] },
      { day: 6, title: "Topic 6", status: "pending", objectives: ["Objective 6"] },
      { day: 7, title: "Topic 7", status: "pending", objectives: ["Objective 7"] },
      { day: 8, title: "Topic 8", status: "pending", objectives: ["Objective 8"] },
      { day: 9, title: "Topic 9", status: "pending", objectives: ["Objective 9"] },
      { day: 10, title: "Topic 10", status: "pending", objectives: ["Objective 10"] }
    ],
    transcript: [
      { role: 'interviewer', day: 3, text: "Let's start the interview.", turn: 1 },
      { role: 'candidate', text: "Ready to start.", turn: 2 }
    ],
    emptyRetryCount: 0,
    whyChainDepth: 0,
    hallucinationCount: 0,
    hallucinationCountForCurrentTopic: 0,
    recentScores: [85, 90],
    recentDiagrams: [],
    recentReactions: [],
    difficultyTier: "standard",
    nextQuestionType: "open",
    pendingQuestionType: "open",
    pendingMCQAnswer: null,
    accuracyLog: [],
    createdAt: new Date().toISOString(),
    questionSentAt: new Date().toISOString()
  };

  await saveSessionDoc(sessionId, initialSession);
}

// Function to simulate the frontend's updateInputArea logic in JS assertions
function getDerivedInputMode(nextQuestionType, mcqOptions) {
  const isMCQ = nextQuestionType === 'mcq';
  const hasOptions = Array.isArray(mcqOptions) && mcqOptions.length > 0;
  if (isMCQ && hasOptions) {
    return 'MCQ_MODE';
  } else {
    return 'FREE_TEXT_MODE';
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('RUNNING QUESTION TYPE TRANSITION REGRESSION TESTS');
  console.log('========================================================');

  const sessionId = `test-regression-${Date.now()}`;
  await setupMockSession(sessionId);

  // ----------------------------------------------------
  // Test 1: Open -> MCQ Transition
  // ----------------------------------------------------
  console.log('\n[Test 1] Transition: Open Question -> MCQ Question');
  let session = await getSessionDoc(sessionId);
  
  // Set next turn's scheduled type to MCQ
  session.nextQuestionType = 'open';
  session.pendingQuestionType = 'mcq';
  await saveSessionDoc(sessionId, session);

  let response = await handleTurn(sessionId, "Some technical response here");
  assert.strictEqual(response.nextQuestionType, 'mcq', 'Should transition to mcq type');
  assert.ok(Array.isArray(response.mcqOptions) && response.mcqOptions.length > 0, 'Should return non-empty mcq options');
  
  let derivedMode = getDerivedInputMode(response.nextQuestionType, response.mcqOptions);
  assert.strictEqual(derivedMode, 'MCQ_MODE', 'Derived UI input state should be MCQ_MODE');
  console.log('  -> PASS: Open to MCQ transition successfully derived MCQ_MODE');

  // ----------------------------------------------------
  // Test 2: MCQ -> Open Transition
  // ----------------------------------------------------
  console.log('\n[Test 2] Transition: MCQ Question -> Open Question');
  session = await getSessionDoc(sessionId);
  // Set next turn's scheduled type to Open
  session.nextQuestionType = 'mcq';
  session.pendingQuestionType = 'open';
  await saveSessionDoc(sessionId, session);

  // Submit MCQ answer index "0"
  response = await handleTurn(sessionId, "0");
  assert.strictEqual(response.nextQuestionType, 'open', 'Should transition back to open type');
  assert.strictEqual(response.mcqOptions, null, 'Should clear mcqOptions to null');

  derivedMode = getDerivedInputMode(response.nextQuestionType, response.mcqOptions);
  assert.strictEqual(derivedMode, 'FREE_TEXT_MODE', 'Derived UI input state should be FREE_TEXT_MODE');
  console.log('  -> PASS: MCQ to Open transition successfully derived FREE_TEXT_MODE');

  // ----------------------------------------------------
  // Test 3: MCQ -> MCQ Transition (Back-to-Back MCQs)
  // ----------------------------------------------------
  console.log('\n[Test 3] Transition: MCQ Question -> MCQ Question (Back-to-Back)');
  session = await getSessionDoc(sessionId);
  session.nextQuestionType = 'mcq';
  session.pendingQuestionType = 'mcq';
  await saveSessionDoc(sessionId, session);

  response = await handleTurn(sessionId, "1");
  assert.strictEqual(response.nextQuestionType, 'mcq', 'Should stay in mcq type');
  assert.ok(Array.isArray(response.mcqOptions) && response.mcqOptions.length > 0, 'Should return new mcq options');

  derivedMode = getDerivedInputMode(response.nextQuestionType, response.mcqOptions);
  assert.strictEqual(derivedMode, 'MCQ_MODE', 'Derived UI input state should be MCQ_MODE');
  console.log('  -> PASS: MCQ to MCQ transition successfully derived MCQ_MODE');

  // ----------------------------------------------------
  // Test 4: Open -> Open Transition (Back-to-Back Open text)
  // ----------------------------------------------------
  console.log('\n[Test 4] Transition: Open Question -> Open Question (Back-to-Back)');
  session = await getSessionDoc(sessionId);
  session.nextQuestionType = 'open';
  session.pendingQuestionType = 'open';
  await saveSessionDoc(sessionId, session);

  response = await handleTurn(sessionId, "Standard engineering response");
  assert.strictEqual(response.nextQuestionType, 'open', 'Should stay in open type');
  assert.strictEqual(response.mcqOptions, null, 'Should keep mcqOptions as null');

  derivedMode = getDerivedInputMode(response.nextQuestionType, response.mcqOptions);
  assert.strictEqual(derivedMode, 'FREE_TEXT_MODE', 'Derived UI input state should be FREE_TEXT_MODE');
  console.log('  -> PASS: Open to Open transition successfully derived FREE_TEXT_MODE');

  // ----------------------------------------------------
  // Test 5: Defensive Fallback for Malformed MCQ Options
  // ----------------------------------------------------
  console.log('\n[Test 5] Defensive Fallback: MCQ type with empty/missing options');
  // If nextQuestionType is mcq but choices array is missing/empty, it must fallback to FREE_TEXT_MODE
  derivedMode = getDerivedInputMode('mcq', []);
  assert.strictEqual(derivedMode, 'FREE_TEXT_MODE', 'Empty mcqOptions must resolve to FREE_TEXT_MODE');
  derivedMode = getDerivedInputMode('mcq', null);
  assert.strictEqual(derivedMode, 'FREE_TEXT_MODE', 'Null mcqOptions must resolve to FREE_TEXT_MODE');
  console.log('  -> PASS: Malformed options successfully triggered FREE_TEXT_MODE fallback');

  console.log('\n========================================================');
  console.log('SUCCESS: All question transition regression tests passed!');
  console.log('========================================================\n');
}

runTests().catch(err => {
  console.error('\nTEST FAILURE:', err);
  process.exit(1);
});
