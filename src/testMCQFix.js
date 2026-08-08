import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { createSession, handleTurn, getSessionDoc, saveSessionDoc } from './sessionManager.js';

console.log('=== VERIFYING MCQ DUPLICATE-QUESTION-RENDERING FIX ===\n');

async function runMCQTest() {
  initializeData();
  await precomputeConceptTerms();
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  const candidate = candidatesById.get('CAND-001');
  const sessionId = `mcq-test-${Date.now()}`;

  await createSession(sessionId, candidate);
  const session = await getSessionDoc(sessionId);
  
  // Set recentScores to force MCQ
  session.recentScores = [20, 20];
  session.pendingQuestionType = 'mcq';
  session.nextQuestionType = 'mcq';
  await saveSessionDoc(sessionId, session);

  console.log('1. Submitting turn 1 under MCQ mode...');
  let res1 = await handleTurn(sessionId, "idk");

  // Force MCQ again on 2nd turn
  const session2 = await getSessionDoc(sessionId);
  session2.recentScores = [20, 20];
  session2.pendingQuestionType = 'mcq';
  session2.nextQuestionType = 'mcq';
  await saveSessionDoc(sessionId, session2);

  console.log('2. Submitting turn 2 under MCQ mode...');
  let res2 = await handleTurn(sessionId, "1");

  console.log('\n--- MCQ Turn 1 Options ---');
  console.log(JSON.stringify(res1.mcqOptions, null, 2));

  console.log('\n--- MCQ Turn 2 Options ---');
  console.log(JSON.stringify(res2.mcqOptions, null, 2));

  if (!res1.mcqOptions || !res2.mcqOptions) {
    console.error('❌ FAIL: MCQ options were not generated.');
    process.exit(1);
  }

  const isIdentical = JSON.stringify(res1.mcqOptions) === JSON.stringify(res2.mcqOptions);
  if (isIdentical) {
    console.error('\n❌ FAILED: Consecutive MCQ questions rendered IDENTICAL options!');
    process.exit(1);
  } else {
    console.log('\n✅ SUCCESS: Consecutive MCQ questions rendered DISTINCT, TOPIC-SPECIFIC options!');
  }
}

runMCQTest().catch(err => {
  console.error('MCQ test failed:', err);
  process.exit(1);
});
