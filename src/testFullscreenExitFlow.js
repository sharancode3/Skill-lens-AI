import dotenv from 'dotenv';
dotenv.config();

import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { createSession, getSessionDoc } from './sessionManager.js';
import { reportViolation } from './sessionManager.js';

initializeData();
precomputeConceptTerms();

async function runTest() {
  console.log('========================================================');
  console.log('RUNNING FULLSCREEN EXIT & SUSPENSION FLOW TESTS');
  console.log('========================================================');

  const candidate = candidatesById.get('CAND-001');
  const sessionId = `fs-exit-test-${Date.now()}`;

  // 1. Create Session
  await createSession(sessionId, candidate);
  let session = await getSessionDoc(sessionId);
  console.log(`[Test 1] Session created. Initial exits: ${session.fullscreenExits}`);

  // 2. Report First Fullscreen Exit
  console.log('[Test 2] Reporting 1st fullscreen exit...');
  let res = await reportViolation(sessionId, 'fullscreen-exit');
  console.log(`Exits count: ${res.fullscreenExits}, Suspended: ${res.suspended}`);
  if (res.fullscreenExits !== 1 || res.suspended) {
    console.error('FAIL: 1st exit failed checks.');
    process.exit(1);
  } else {
    console.log('PASS: 1st exit registered correctly.');
  }

  // 3. Report Second Fullscreen Exit
  console.log('[Test 3] Reporting 2nd fullscreen exit...');
  res = await reportViolation(sessionId, 'fullscreen-exit');
  console.log(`Exits count: ${res.fullscreenExits}, Suspended: ${res.suspended}`);
  if (res.fullscreenExits !== 2 || res.suspended) {
    console.error('FAIL: 2nd exit failed checks.');
    process.exit(1);
  } else {
    console.log('PASS: 2nd exit registered correctly.');
  }

  // 4. Report Third Fullscreen Exit (should suspend)
  console.log('[Test 4] Reporting 3rd fullscreen exit...');
  res = await reportViolation(sessionId, 'fullscreen-exit');
  console.log(`Exits count: ${res.fullscreenExits}, Suspended: ${res.suspended}, State: ${res.done ? 'DONE' : 'ACTIVE'}`);
  if (res.fullscreenExits !== 3 || !res.suspended) {
    console.error('FAIL: 3rd exit did not trigger suspension.');
    process.exit(1);
  } else {
    console.log('PASS: 3rd exit triggered suspension successfully.');
  }

  console.log('========================================================');
  console.log('ALL FULLSCREEN EXIT PROCTORING TESTS PASSED!');
  console.log('========================================================');
}

runTest().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
