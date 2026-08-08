import assert from 'assert';
import { createSession, handleTurn, getSessionDoc, saveSessionDoc } from './sessionManager.js';
import { initializeData, getCandidateById } from './dataManager.js';
import * as llmClient from './llmClient.js';

async function runTests() {
  console.log("========================================================");
  console.log("RUNNING MCQ DEAD-END FALLBACK REGRESSION TESTS");
  console.log("========================================================");

  // Initialize data manager
  initializeData();

  const realCandidate = getCandidateById("CAND-001");
  if (!realCandidate) {
    throw new Error("Could not load real candidate CAND-001");
  }

  const candidateMalformed = {
    ...realCandidate,
    member: {
      ...realCandidate.member,
      name: "MockMalformedMCQ"
    }
  };

  const candidateSingle = {
    ...realCandidate,
    member: {
      ...realCandidate.member,
      name: "MockSingleMCQ"
    }
  };

  const candidateValid = {
    ...realCandidate,
    member: {
      ...realCandidate.member,
      name: "Valid Candidate"
    }
  };

  // Test 1: Technical question understandability verification helper
  console.log("[Test 1] Verifying checkQuestionUnderstandability returns expected boolean...");
  const u1 = await llmClient.checkQuestionUnderstandability("Suppose you are optimizing Pandas vectorization across DataFrame columns - how does it work?");
  assert.strictEqual(u1, true, "Valid spoken scenario should pass understandability check");
  console.log(" -> PASS: Valid question passed self-check.");

  // Test 2: Server-side MCQ check with empty options array
  console.log("[Test 2] Testing server-side MCQ fallback with empty options...");
  const session1Id = `test-fallback-empty-${Date.now()}`;
  await createSession(session1Id, candidateMalformed);
  
  const session1 = await getSessionDoc(session1Id);
  session1.nextQuestionType = 'open';
  session1.pendingQuestionType = 'mcq';
  session1.recentScores = [90, 90];
  await saveSessionDoc(session1Id, session1);

  // Trigger turn evaluation
  const payload1 = await handleTurn(session1Id, "My response to the current question.");

  // Assert fallback to open question
  assert.strictEqual(payload1.nextQuestionType, 'open', "Should fall back to 'open' when options are empty");
  assert.strictEqual(payload1.mcqOptions, null, "mcqOptions payload should be null");
  
  const sessionDoc1 = await getSessionDoc(session1Id);
  assert.strictEqual(sessionDoc1.nextQuestionType, 'open', "Stored nextQuestionType should be 'open'");
  assert.strictEqual(sessionDoc1.pendingMCQAnswer, null, "Stored pendingMCQAnswer should be null");
  
  console.log(" -> PASS: Auto-fallback to free-text occurred successfully on empty options.");

  // Test 3: Server-side MCQ check with single option array
  console.log("[Test 3] Testing server-side MCQ fallback with single option...");
  const session2Id = `test-fallback-single-${Date.now()}`;
  await createSession(session2Id, candidateSingle);
  
  const session2 = await getSessionDoc(session2Id);
  session2.nextQuestionType = 'open';
  session2.pendingQuestionType = 'mcq';
  session2.recentScores = [90, 90];
  await saveSessionDoc(session2Id, session2);

  const payload2 = await handleTurn(session2Id, "Candidate response text.");
  assert.strictEqual(payload2.nextQuestionType, 'open', "Should fall back to 'open' when options count is < 2");
  assert.strictEqual(payload2.mcqOptions, null, "mcqOptions payload should be null");
  console.log(" -> PASS: Auto-fallback occurred for single-choice option.");

  // Test 4: Verify normal MCQ with 4 options is NOT interfered with
  console.log("[Test 4] Verifying normal MCQ options function correctly...");
  const session3Id = `test-valid-mcq-${Date.now()}`;
  await createSession(session3Id, candidateValid);
  
  const session3 = await getSessionDoc(session3Id);
  session3.nextQuestionType = 'open';
  session3.pendingQuestionType = 'mcq';
  session3.recentScores = [90, 90];
  await saveSessionDoc(session3Id, session3);

  const payload3 = await handleTurn(session3Id, "Another valid text reply.");
  assert.strictEqual(payload3.nextQuestionType, 'mcq', "Should keep MCQ type when options are valid");
  assert.ok(Array.isArray(payload3.mcqOptions) && payload3.mcqOptions.length === 4, "Should have exactly 4 choices");
  console.log(" -> PASS: Valid MCQ questions preserved.");

  console.log("\n========================================================");
  console.log("SUCCESS: All MCQ dead-end fallback checks passed!");
  console.log("========================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
