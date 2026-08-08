/**
 * Phase E2: Timed Suspension Engine — Regression Test
 *
 * Validates:
 * 1. First violation triggers timed suspension (session stays ASKING, suspension.active = true)
 * 2. checkSuspensionResume returns canResume=false while lockout is active
 * 3. Second violation re-triggers timed suspension (suspensionCount=2)
 * 4. Third violation hits escalation ceiling and permanently terminates (state=DONE)
 * 5. Camera high-severity violation (multi_face) bypasses timed suspension and terminates immediately
 */
import dotenv from 'dotenv';
dotenv.config();

import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { createSession, getSessionDoc, triggerSuspension, checkSuspensionResume, reportViolation, SessionState, endSessionEarly } from './sessionManager.js';

initializeData();
precomputeConceptTerms();

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('PHASE E2 — TIMED SUSPENSION ENGINE TESTS');
  console.log('========================================================');

  const candidate = candidatesById.get('CAND-003');
  const sessionId = `e2-susp-test-${Date.now()}`;

  await createSession(sessionId, candidate);
  let session = await getSessionDoc(sessionId);
  assert(session.state === SessionState.ASKING, 'Session created in ASKING state');
  assert(session.suspension !== undefined, 'Session has suspension object');
  assert(session.suspension.suspensionCount === 0, 'Initial suspensionCount is 0');

  // ── Test 1: First violation → timed suspension ──────────────────────────
  console.log('\n[Test 1] First violation — should trigger timed suspension...');
  const r1 = await triggerSuspension(sessionId, 'You exited fullscreen mode.');
  assert(r1.suspended === true, 'Response has suspended=true');
  assert(r1.terminated === false, 'Response has terminated=false');
  assert(typeof r1.resumeAt === 'string', 'Response contains resumeAt ISO string');
  assert(r1.suspensionCount === 1, 'suspensionCount is 1');
  assert(r1.warningsRemaining === 2, 'warningsRemaining is 2 (2 strikes left)');

  session = await getSessionDoc(sessionId);
  assert(session.state === SessionState.ASKING, 'Session state still ASKING after 1st suspension');
  assert(session.suspension.active === true, 'suspension.active is true');
  assert(session.suspension.suspensionCount === 1, 'Persisted suspensionCount = 1');
  assert(session.suspension.resumeAt !== null, 'resumeAt is set in session doc');

  // Verify resumeAt is ~5 minutes in the future (within 10s tolerance for test speed)
  const resumeAtMs = new Date(session.suspension.resumeAt).getTime();
  const expectedMs = Date.now() + (5 * 60 * 1000);
  assert(Math.abs(resumeAtMs - expectedMs) < 10000, 'resumeAt is approximately 5 minutes from now');

  // ── Test 2: checkSuspensionResume while lockout is active ─────────────────
  console.log('\n[Test 2] Server resume-check while lockout active — should deny...');
  const resumeCheck = await checkSuspensionResume(sessionId);
  assert(resumeCheck.canResume === false, 'canResume=false when lockout is active');
  assert(typeof resumeCheck.msRemaining === 'number', 'msRemaining is provided');
  assert(resumeCheck.msRemaining > 0, 'msRemaining is positive');
  assert(resumeCheck.msRemaining < 5 * 60 * 1000 + 500, 'msRemaining is under 5 minutes');

  // ── Test 3: Second violation → timed suspension again ─────────────────────
  console.log('\n[Test 3] Second violation — should timed-suspend again (count=2)...');
  const r2 = await triggerSuspension(sessionId, 'Tab switch detected.');
  assert(r2.suspended === true, 'Second violation: suspended=true');
  assert(r2.terminated === false, 'Second violation: terminated=false');
  assert(r2.suspensionCount === 2, 'suspensionCount is 2');
  assert(r2.warningsRemaining === 1, 'warningsRemaining is 1');

  session = await getSessionDoc(sessionId);
  assert(session.state === SessionState.ASKING, 'Session still ASKING after 2nd suspension');
  assert(session.suspension.suspensionCount === 2, 'Persisted suspensionCount = 2');

  // ── Test 4: Third violation → escalation ceiling → permanent termination ──
  console.log('\n[Test 4] Third violation — should hit escalation ceiling and terminate...');
  const r3 = await triggerSuspension(sessionId, 'Copy attempt detected.');
  assert(r3.terminated === true, 'Third violation: terminated=true');
  assert(r3.terminatedForRepeatedViolations === true, 'terminatedForRepeatedViolations=true');
  assert(r3.done === true, 'done=true on termination');
  assert(r3.suspensionCount === 3, 'suspensionCount is 3 (ceiling)');

  session = await getSessionDoc(sessionId);
  assert(session.state === SessionState.DONE, 'Session state is DONE after escalation termination');
  assert(session.feedback !== null, 'Feedback generated on termination');

  // ── Test 5: reportViolation for fullscreen-exit (Phase E3 Warning & Escalating) ──
  console.log('\n[Test 5] reportViolation(fullscreen-exit) — should warn twice and suspend on 3rd...');
  const sessionId2 = `e2-repviol-test-${Date.now()}`;
  await createSession(sessionId2, candidate);

  // Exit 1: warning
  const vr1 = await reportViolation(sessionId2, 'fullscreen-exit');
  assert(vr1.suspended === false, '1st fullscreen exit: suspended=false');
  assert(vr1.warningsRemaining === 2, '1st fullscreen exit: warningsRemaining=2');

  // Exit 2: warning
  const vr2 = await reportViolation(sessionId2, 'fullscreen-exit');
  assert(vr2.suspended === false, '2nd fullscreen exit: suspended=false');
  assert(vr2.warningsRemaining === 1, '2nd fullscreen exit: warningsRemaining=1');

  // Exit 3: suspension
  const vr3 = await reportViolation(sessionId2, 'fullscreen-exit');
  assert(vr3.suspended === true, '3rd fullscreen exit: suspended=true');
  assert(vr3.warningsRemaining === 0, '3rd fullscreen exit: warningsRemaining=0');

  const s2 = await getSessionDoc(sessionId2);
  assert(s2.state === SessionState.ASKING, 'Session2 still ASKING after 3rd fullscreen exit (suspension is temporary)');

  // ── Test 6: Camera high-severity → immediate permanent termination ─────────
  console.log('\n[Test 6] reportViolation(multi_face_violation) — should immediately terminate...');
  const sessionId3 = `e2-camera-test-${Date.now()}`;
  await createSession(sessionId3, candidate);
  const cr = await reportViolation(sessionId3, 'multi_face_violation');
  assert(cr.done === true, 'Camera high-severity: done=true');
  assert(cr.terminated === true, 'Camera high-severity: terminated=true');

  const s3 = await getSessionDoc(sessionId3);
  assert(s3.state === SessionState.DONE, 'Session3 DONE after camera termination');

  // ── Test 7: Spec Compliance & Honest Content (Phase E7) ───────────────────
  console.log('\n[Test 7] Validating technical-spec feedback shape & honest summary framing...');
  
  // 7a. Check forced violation termination summary content
  const termSession = await getSessionDoc(sessionId); // From Test 4
  assert(termSession.feedback !== null, 'Forced termination has feedback object');
  assert(typeof termSession.feedback.summary === 'string', 'feedback.summary is string');
  assert(Array.isArray(termSession.feedback.strengths), 'feedback.strengths is string array');
  assert(Array.isArray(termSession.feedback.gaps), 'feedback.gaps is string array');
  assert(Array.isArray(termSession.feedback.next), 'feedback.next is string array');
  assert(termSession.feedback.summary.includes('permanently terminated due to repeated proctoring or conduct violations'), 'Forced termination summary honestly notes violations exit');

  // 7b. Check manual early exit summary content
  const sessionId4 = `e2-early-exit-test-${Date.now()}`;
  await createSession(sessionId4, candidate);
  const earlyExitRes = await endSessionEarly(sessionId4);
  assert(earlyExitRes.feedback !== null, 'Manual early exit returns feedback');
  assert(earlyExitRes.feedback.summary.includes('voluntarily ended the interview session early'), 'Early exit summary honestly notes early voluntary completion');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n========================================================');
  if (failed === 0) {
    console.log(`ALL TESTS PASSED: ${passed} passed, 0 failed`);
  } else {
    console.error(`TESTS FAILED: ${passed} passed, ${failed} failed`);
  }
  console.log('========================================================');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
