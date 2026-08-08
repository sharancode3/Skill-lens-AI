import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { 
  createSession, 
  handleTurn, 
  getSessionDoc, 
  saveSessionDoc,
  computeMetrics 
} from './sessionManager.js';

async function runTest() {
  console.log('=======================================');
  console.log('STARTING PHASE I6 INTEGRATION TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-phase-i6-${Date.now()}`;

  // Force offline mock mode
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  console.log('>>> 1. Creating Session...');
  await createSession(sessionId, candidate);

  // Pad topicQueue to 15 entries to prevent early wrap-up during testing
  let session = await getSessionDoc(sessionId);
  while (session.topicQueue.length < 15) {
    const nextDay = session.topicQueue.length + 1;
    session.topicQueue.push({
      day: nextDay,
      title: `Extra Topic Day ${nextDay}`,
      objectives: [`Objective ${nextDay}`],
      difficulty: "standard"
    });
  }
  // Set explicit interviewStartedAt manually to 60 seconds ago
  const interviewStartedAt = new Date(Date.now() - 60000).toISOString();
  session.interviewStartedAt = interviewStartedAt;
  await saveSessionDoc(sessionId, session);

  // Turn 1: Standard Open question (standard difficulty).
  // Set questionSentAt to 15 seconds ago
  console.log('>>> 2. Submitting Turn 1 (Standard difficulty)...');
  session = await getSessionDoc(sessionId);
  session.questionSentAt = new Date(Date.now() - 15000).toISOString();
  await saveSessionDoc(sessionId, session);

  await handleTurn(sessionId, "This is a strong answer with standard difficulty concepts. [strong-score]");

  // Turn 2: Escalates to applied difficulty.
  // Set questionSentAt to 25 seconds ago
  console.log('>>> 3. Submitting Turn 2 (Applied difficulty)...');
  session = await getSessionDoc(sessionId);
  session.questionSentAt = new Date(Date.now() - 25000).toISOString();
  await saveSessionDoc(sessionId, session);

  await handleTurn(sessionId, "This is a strong answer with applied difficulty concepts. [strong-score]");

  // Fetch final session and check metrics
  console.log('>>> 4. Computing Metrics & Verifying Timing Logs...');
  session = await getSessionDoc(sessionId);
  
  // Set interviewEndedAt manually to simulate final completion duration of exactly 75 seconds
  session.interviewEndedAt = new Date(new Date(session.interviewStartedAt).getTime() + 75000).toISOString();
  await saveSessionDoc(sessionId, session);

  const metrics = computeMetrics(session);

  console.log(`  totalInterviewDurationSeconds: ${metrics.totalInterviewDurationSeconds} (Expected: 75)`);
  console.log(`  Turn 1 responseTimeSeconds: ${metrics.perQuestionTimes[0].responseTimeSeconds} (Expected: ~15)`);
  console.log(`  Turn 1 expectedRangeSeconds: [${metrics.perQuestionTimes[0].expectedRangeSeconds.join(', ')}] (Expected: [40, 70])`);
  console.log(`  Turn 2 responseTimeSeconds: ${metrics.perQuestionTimes[1].responseTimeSeconds} (Expected: ~25)`);
  console.log(`  Turn 2 expectedRangeSeconds: [${metrics.perQuestionTimes[1].expectedRangeSeconds.join(', ')}] (Expected: [70, 120])`);

  const tc1Pass = metrics.totalInterviewDurationSeconds === 75;
  const tc2Pass = Math.abs(metrics.perQuestionTimes[0].responseTimeSeconds - 15) <= 2;
  const tc3Pass = metrics.perQuestionTimes[0].expectedRangeSeconds[0] === 40 && metrics.perQuestionTimes[0].expectedRangeSeconds[1] === 70;
  const tc4Pass = Math.abs(metrics.perQuestionTimes[1].responseTimeSeconds - 25) <= 2;
  const tc5Pass = metrics.perQuestionTimes[1].expectedRangeSeconds[0] === 70 && metrics.perQuestionTimes[1].expectedRangeSeconds[1] === 120;

  console.log(`\nTest Case 1 (totalInterviewDurationSeconds): ${tc1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test Case 2 (Turn 1 responseTimeSeconds): ${tc2Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test Case 3 (Turn 1 expectedRange): ${tc3Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test Case 4 (Turn 2 responseTimeSeconds): ${tc4Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test Case 5 (Turn 2 expectedRange): ${tc5Pass ? 'PASS' : 'FAIL'}`);

  console.log('=======================================');
  console.log('PHASE I6 TESTS COMPLETE');
  console.log('=======================================');

  if (tc1Pass && tc2Pass && tc3Pass && tc4Pass && tc5Pass) {
    console.log('\nSUCCESS: All checks passed!');
    process.exit(0);
  } else {
    console.error('\nFAILURE: One or more checks failed!');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
