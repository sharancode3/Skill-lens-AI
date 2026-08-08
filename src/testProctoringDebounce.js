import assert from 'assert';
import { createSession, reportViolation, getSessionDoc } from './sessionManager.js';
import { initializeData } from './dataManager.js';

async function runTests() {
  console.log("========================================================");
  console.log("RUNNING PROCTORING RELIABILITY & LOCKOUT TESTS");
  console.log("========================================================");

  // Initialize data Manager
  initializeData();

  const sessionId = `test-reliability-${Date.now()}`;
  const candidateMock = {
    id: "CAND-001",
    member: { id: "CAND-001", name: "Test Candidate", jobRole: "Software Engineer", yearsExperience: 2 },
    missions: []
  };

  // Test 1: Session initialization has warningLockoutUntil: null
  console.log("[Test 1] Verifying session init warningLockoutUntil...");
  await createSession(sessionId, candidateMock);
  const sessionDoc = await getSessionDoc(sessionId);
  assert.strictEqual(sessionDoc.warningLockoutUntil, null, "Initially warningLockoutUntil must be null");
  console.log(" -> PASS: Init warningLockoutUntil is null");

  // Test 2: Reporting 1st fullscreen-exit sets warningLockoutUntil and increments exits
  console.log("[Test 2] Reporting 1st fullscreen-exit...");
  const res1 = await reportViolation(sessionId, 'fullscreen-exit');
  assert.strictEqual(res1.fullscreenExits, 1, "fullscreenExits count should be 1");
  assert.ok(res1.warningLockoutUntil, "warningLockoutUntil should be populated");
  const lockoutTime1 = new Date(res1.warningLockoutUntil).getTime();
  assert.ok(lockoutTime1 > Date.now(), "warningLockoutUntil must be in the future");
  console.log(" -> PASS: Lockout timestamp generated correctly");

  // Test 3: Reporting 2nd exit increments exits and updates warningLockoutUntil
  console.log("[Test 3] Reporting 2nd fullscreen-exit...");
  const res2 = await reportViolation(sessionId, 'fullscreen-exit');
  assert.strictEqual(res2.fullscreenExits, 2, "fullscreenExits count should be 2");
  assert.ok(res2.warningLockoutUntil, "warningLockoutUntil should be updated");
  console.log(" -> PASS: 2nd lockout registered and incremented");

  // Test 4: Reporting 3rd exit triggers suspension
  console.log("[Test 4] Reporting 3rd fullscreen-exit...");
  const res3 = await reportViolation(sessionId, 'fullscreen-exit');
  assert.strictEqual(res3.fullscreenExits, 3, "fullscreenExits count should be 3");
  assert.strictEqual(res3.suspended, true, "Should be suspended on 3rd exit");
  assert.strictEqual(res3.warningLockoutUntil, null, "Warning lockout is null once suspended");
  console.log(" -> PASS: Suspended on 3rd exit successfully");

  console.log("\n========================================================");
  console.log("SUCCESS: All reliability and lockout tests passed!");
  console.log("========================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
