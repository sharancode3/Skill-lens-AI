import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { createSession, handleTurn, getSessionDoc, saveSessionDoc, updateDifficulty } from './sessionManager.js';

async function runTest() {
  console.log('=======================================');
  console.log('STARTING ADAPTIVE INTELLIGENCE TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-adaptive-${Date.now()}`;

  console.log(`Candidate: ${candidate.member.name}`);
  console.log(`Session ID: ${sessionId}\n`);

  // Create session
  console.log('>>> 1. Creating Session...');
  const startResponse = await createSession(sessionId, candidate);
  let sessionDoc = await getSessionDoc(sessionId);
  console.log(`Initial Tier: ${sessionDoc.difficultyTier} (Expected: standard)`);
  console.log(`Initial Question Type: ${sessionDoc.nextQuestionType} (Expected: open)`);
  console.log(`recentScores: [${sessionDoc.recentScores.join(', ')}]`);
  console.log('-------------------------------------------------------\n');

  // We want to force specific evaluation results to test the adaptive transitions
  // Let's modify the process.env to run in offline mock mode to ensure deterministic outcomes
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  // Test 1: De-escalation triggers. Either of last 2 scores < 40 -> Tier down, set nextQuestionType to mcq.
  console.log('>>> 2. Testing De-escalation (Sending short/bad answers)...');
  // First bad turn
  let res = await handleTurn(sessionId, "no"); 
  sessionDoc = await getSessionDoc(sessionId);
  console.log(`After Turn 1 (score < 40): Tier = ${sessionDoc.difficultyTier}, Next Type = ${sessionDoc.nextQuestionType}, recentScores = [${sessionDoc.recentScores.join(', ')}]`);

  // Second bad turn
  res = await handleTurn(sessionId, "agree");
  sessionDoc = await getSessionDoc(sessionId);
  console.log(`After Turn 2 (score < 40): Tier = ${sessionDoc.difficultyTier}, Next Type = ${sessionDoc.pendingQuestionType}, recentScores = [${sessionDoc.recentScores.join(', ')}]`);
  console.log(`Is next type "mcq"? ${sessionDoc.pendingQuestionType === 'mcq' ? 'PASS' : 'FAIL'}`);
  console.log(`Is difficulty Tier de-escalated to "foundational"? ${sessionDoc.difficultyTier === 'foundational' ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Test 2: MCQ validation. Correct option yields 100, incorrect option yields 20.
  console.log('>>> 3. Testing MCQ Answer Verification...');
  // Check what the pending answer is
  const pendingAnswer = sessionDoc.pendingMCQAnswer;
  console.log(`Pending MCQ Correct Index: ${pendingAnswer}`);

  // Test Incorrect Choice
  const incorrectChoice = (pendingAnswer + 1) % 4;
  console.log(`Submitting Incorrect MCQ Choice: ${incorrectChoice}`);
  res = await handleTurn(sessionId, incorrectChoice.toString());
  sessionDoc = await getSessionDoc(sessionId);
  let lastLog = sessionDoc.accuracyLog[sessionDoc.accuracyLog.length - 1];
  console.log(`Incorrect Choice Score: ${lastLog.finalAccuracyScore} (Expected: 20) -> ${lastLog.finalAccuracyScore === 20 ? 'PASS' : 'FAIL'}`);

  // Test Correct Choice
  console.log(`Next type after incorrect MCQ: ${sessionDoc.nextQuestionType} (Expected: mcq)`);
  const correctChoice = sessionDoc.pendingMCQAnswer;
  console.log(`Submitting Correct MCQ Choice: ${correctChoice}`);
  res = await handleTurn(sessionId, correctChoice.toString());
  sessionDoc = await getSessionDoc(sessionId);
  lastLog = sessionDoc.accuracyLog[sessionDoc.accuracyLog.length - 1];
  console.log(`Correct Choice Score: ${lastLog.finalAccuracyScore} (Expected: 100) -> ${lastLog.finalAccuracyScore === 100 ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Test 3: Escalation triggers. Both of last 2 scores >= 85 -> Tier up, nextQuestionType to diagram_interpret
  console.log('>>> 4. Testing Escalation (Direct Function Testing)...');
  sessionDoc = await getSessionDoc(sessionId);
  
  // Set starting state
  sessionDoc.difficultyTier = 'standard';
  sessionDoc.recentScores = [];
  
  // Turn 1: 90
  updateDifficulty(sessionDoc, 90);
  console.log(`After Score 1 (90): Tier = ${sessionDoc.difficultyTier}, Next Type = ${sessionDoc.pendingQuestionType}, recentScores = [${sessionDoc.recentScores.join(', ')}]`);
  
  // Turn 2: 95
  updateDifficulty(sessionDoc, 95);
  console.log(`After Score 2 (95): Tier = ${sessionDoc.difficultyTier}, Next Type = ${sessionDoc.pendingQuestionType}, recentScores = [${sessionDoc.recentScores.join(', ')}]`);
  
  console.log(`Is next type "diagram_interpret"? ${sessionDoc.pendingQuestionType === 'diagram_interpret' ? 'PASS' : 'FAIL'}`);
  console.log(`Is difficulty Tier escalated to "applied"? ${sessionDoc.difficultyTier === 'applied' ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  console.log('=======================================');
  console.log('ADAPTIVE INTELLIGENCE TESTS COMPLETE');
  console.log('=======================================');
}

runTest().catch(err => {
  console.error('Test crashed:', err);
});
