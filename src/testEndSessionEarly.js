import dotenv from 'dotenv';
dotenv.config();

import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { createSession, getSessionDoc, endSessionEarly } from './sessionManager.js';

initializeData();
precomputeConceptTerms();

async function runTest() {
  console.log('========================================================');
  console.log('RUNNING END SESSION EARLY TESTS');
  console.log('========================================================');

  const candidate = candidatesById.get('CAND-001');
  const sessionId = `early-exit-test-${Date.now()}`;

  // 1. Create Session
  await createSession(sessionId, candidate);
  let session = await getSessionDoc(sessionId);
  console.log(`[Test 1] Session created. Initial state: ${session.state}`);

  // 2. Call endSessionEarly
  console.log('[Test 2] Voluntarily ending session early...');
  const res = await endSessionEarly(sessionId);
  console.log(`Response - Done: ${res.done}`);
  
  session = await getSessionDoc(sessionId);
  console.log(`Session state after exit: ${session.state}`);
  console.log(`Feedback summary: ${session.feedback.summary}`);
  console.log(`Verdict decision: ${session.judgeVerdict.decision}`);

  if (session.state !== 'DONE') {
    console.error('FAIL: Session state is not DONE.');
    process.exit(1);
  }
  if (!session.feedback.summary.includes('voluntarily ended')) {
    console.error('FAIL: Feedback summary does not note voluntary exit.');
    process.exit(1);
  }
  if (session.judgeVerdict.decision !== 'borderline') {
    console.error('FAIL: Verdict decision should be borderline.');
    process.exit(1);
  }

  console.log('PASS: Voluntary early exit logic succeeded.');
  console.log('========================================================');
  console.log('ALL END SESSION EARLY TESTS PASSED!');
  console.log('========================================================');
}

runTest().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
