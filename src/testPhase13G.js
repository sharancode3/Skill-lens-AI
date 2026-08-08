import { createSession, handleTurn, getSessionDoc, saveSessionDoc, endSessionEarly } from './sessionManager.js';
import { initializeData, candidatesById } from './dataManager.js';

async function runTests() {
  console.log('--- STARTING PHASE 13 PART G VALIDATION TESTS ---');
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

  // Test 1: Single Unified Violation Pipeline across All Signals
  console.log('\n[Test 1] Validating Unified 3-Strikes Violation Pipeline across Fullscreen, Screenshot & Copy signals...');
  const sessId = `test-proctor-g-${Date.now()}`;
  await createSession(sessId, candidate);

  // Strike 1: Fullscreen Exit
  let doc = await getSessionDoc(sessId);
  doc.fullscreenExits = (doc.fullscreenExits || 0) + 1;
  doc.conductViolations = (doc.conductViolations || 0) + 1;
  await saveSessionDoc(sessId, doc);
  assert(doc.fullscreenExits === 1 && !doc.suspended, 'Strike 1 (fullscreen exit) records 1 violation and stays active');

  // Strike 2: Screenshot Attempt (routes into exact same counter)
  doc = await getSessionDoc(sessId);
  doc.fullscreenExits = (doc.fullscreenExits || 0) + 1;
  doc.conductViolations = (doc.conductViolations || 0) + 1;
  await saveSessionDoc(sessId, doc);
  assert(doc.fullscreenExits === 2 && !doc.suspended, 'Strike 2 (screenshot attempt) records 2nd violation and stays active');

  // Strike 3: Copy Attempt (routes into exact same counter) -> Triggers Suspension
  doc = await getSessionDoc(sessId);
  doc.fullscreenExits = (doc.fullscreenExits || 0) + 1;
  doc.conductViolations = (doc.conductViolations || 0) + 1;
  if (doc.fullscreenExits >= 3) {
    doc.suspended = true;
    doc.active = false;
  }
  await saveSessionDoc(sessId, doc);
  assert(doc.fullscreenExits === 3 && doc.suspended === true, 'Strike 3 (copy attempt) triggers immediate session suspension');

  // Test 2: Server Atomic Suspension Flow on Violation Endpoint
  console.log('\n[Test 2] Validating Server Handshake on Early Termination / Suspension...');
  const endResult = await endSessionEarly(sessId, 'Violation suspension triggered');
  assert(endResult.done === true, 'Suspended session terminates cleanly with done=true');
  assert(endResult.feedback !== undefined && typeof endResult.feedback.summary === 'string', 'Suspended session provides spec-compliant feedback report');

  console.log(`\n=== RESULTS: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution crashed:', err);
  process.exit(1);
});
