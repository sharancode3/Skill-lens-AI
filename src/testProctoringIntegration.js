// testProctoringIntegration.js - Integration Test for Camera & Object Proctoring Engine (Phases C3-C7)
import { createSession, reportViolation, getSessionDoc } from './sessionManager.js';
import { candidatesById, initializeData } from './dataManager.js';

initializeData();

async function runTests() {
  console.log('========================================================');
  console.log('RUNNING PROCTORING SCHEMA & VIOLATION INTEGRATION TESTS');
  console.log('========================================================\n');

  const sessionId = 'test-proctor-session-' + Date.now();
  const candidate = Array.from(candidatesById.values())[0];

  // 1. Initialize session
  console.log('[Test 1] Initializing new session...');
  await createSession(sessionId, candidate);
  let session = await getSessionDoc(sessionId);

  if (!session.proctoring || session.proctoring.totalViolationCount !== 0) {
    console.error('FAIL: proctoring block not initialized correctly.');
    process.exit(1);
  }
  console.log(' -> PASS: Proctoring schema initialized to zero state.');

  // 2. Log first violation (Presence - Medium severity)
  console.log('\n[Test 2] Reporting 1st violation (presence_violation)...');
  let result = await reportViolation(sessionId, 'presence_violation');
  session = await getSessionDoc(sessionId);

  if (result.violationCount !== 1 || session.proctoring.violations[0].type !== 'presence' || session.proctoring.violations[0].severity !== 'medium') {
    console.error('FAIL: presence violation severity/mapping mismatch.');
    process.exit(1);
  }
  if (result.suspended || session.state === 'DONE') {
    console.error('FAIL: camera presence violation triggered suspension.');
    process.exit(1);
  }
  console.log(' -> PASS: 1st violation successfully mapped to presence with medium severity.');

  // 3. Log 2nd violation (Gaze - Medium severity)
  console.log('\n[Test 3] Reporting 2nd violation (gaze_violation)...');
  result = await reportViolation(sessionId, 'gaze_violation');
  session = await getSessionDoc(sessionId);

  if (result.violationCount !== 2 || session.proctoring.violations[1].type !== 'gaze') {
    console.error('FAIL: gaze violation mapping mismatch.');
    process.exit(1);
  }
  console.log(' -> PASS: 2nd violation mapped correctly.');

  // 4. Log 3rd violation (Phone - High severity)
  console.log('\n[Test 4] Reporting 3rd violation (phone_violation)...');
  result = await reportViolation(sessionId, 'phone_violation');
  session = await getSessionDoc(sessionId);

  if (result.violationCount !== 3 || session.proctoring.violations[2].type !== 'phone' || session.proctoring.violations[2].severity !== 'high') {
    console.error('FAIL: phone violation mapping/severity mismatch.');
    process.exit(1);
  }
  console.log(' -> PASS: 3rd violation mapped to phone with high severity.');

  // 5. Log 4th violation (Multi-face - High severity) - Trigger Flagged
  console.log('\n[Test 5] Reporting 4th violation (multi_face_violation)...');
  result = await reportViolation(sessionId, 'multi_face_violation');
  session = await getSessionDoc(sessionId);

  if (result.violationCount !== 4 || !result.flaggedForReview || !session.flaggedForReview) {
    console.error('FAIL: flaggedForReview threshold not met at 4 violations.');
    process.exit(1);
  }
  if (result.suspended || session.state === 'DONE') {
    console.error('FAIL: camera violations caused automatic suspension at count 4.');
    process.exit(1);
  }
  console.log(' -> PASS: flaggedForReview successfully set to true, candidate NOT suspended.');

  // 6. Log 5th violation (Camera lost fallback)
  console.log('\n[Test 6] Reporting 5th violation (camera_lost)...');
  result = await reportViolation(sessionId, 'camera_lost');
  session = await getSessionDoc(sessionId);

  if (result.violationCount !== 5 || session.proctoring.violations[4].type !== 'camera_lost') {
    console.error('FAIL: camera_lost mapping mismatch.');
    process.exit(1);
  }
  console.log(' -> PASS: camera_lost registered correctly.');

  // 7. Verify Final proctoringSummary Breakdown values
  console.log('\n[Test 7] Verifying final proctoringSummary breakdown payloads...');
  if (!result.proctoringSummary) {
    console.error('FAIL: proctoringSummary payload not returned in response.');
    process.exit(1);
  }
  const summary = result.proctoringSummary;
  const expectedBreakdown = { presence: 1, gaze: 1, phone: 1, multi_face: 1, camera_lost: 1 };

  for (const key in expectedBreakdown) {
    if (summary.breakdown[key] !== expectedBreakdown[key]) {
      console.error(`FAIL: breakdown count mismatch for key "${key}". Expected ${expectedBreakdown[key]}, got ${summary.breakdown[key]}`);
      process.exit(1);
    }
  }
  console.log(' -> PASS: proctoringSummary breakdown counts match logged violations.');

  // 8. Verify Zero-tolerance Tab Switch suspension triggers
  console.log('\n[Test 8] Reporting interface violation (tab-switch)...');
  result = await reportViolation(sessionId, 'tab-switch');
  session = await getSessionDoc(sessionId);

  if (!result.suspended || session.state !== 'DONE') {
    console.error('FAIL: tab switch did not cause immediate suspension.');
    process.exit(1);
  }
  console.log(' -> PASS: Tab-switch correctly overrides camera immunity and suspends candidate.');

  console.log('\n========================================================');
  console.log('SUCCESS: All proctoring integration checks passed!');
  console.log('========================================================');
}

runTests().catch(e => {
  console.error('Unhandled test exception:', e);
  process.exit(1);
});
