import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { createSession, handleTurn, reportViolation } from './sessionManager.js';

console.log('====================================================');
console.log('AUDITING PHASE 7: FEEDBACK SEPARATION & ALL ENDING PATHS');
console.log('====================================================\n');

async function runAudit() {
  initializeData();
  await precomputeConceptTerms();
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  const candidate = candidatesById.get('CAND-001');

  // --- 1. Audit Mid-Interview Active Turns ---
  console.log('>>> 1. Auditing Mid-Interview Active Turn...');
  const s1Id = `audit-mid-${Date.now()}`;
  await createSession(s1Id, candidate);
  const midRes = await handleTurn(s1Id, "I used Pandas for data cleaning and loaded rows into SQLite.");

  if (midRes.done !== false) {
    console.error('❌ FAIL: Mid-interview turn did not return done: false');
    process.exit(1);
  }
  if (midRes.feedback !== undefined || midRes.judgeVerdict !== undefined) {
    console.error('❌ FAIL: Mid-interview turn leaked structured feedback or judgeVerdict!');
    process.exit(1);
  }
  console.log('  ✅ PASSED: Mid-interview turn returned pure conversational text with zero feedback leakage.\n');


  // --- 2. Path 1: Normal Interview Completion ---
  console.log('>>> 2. Auditing Ending Path 1: Normal Completion...');
  const sNormId = `audit-norm-${Date.now()}`;
  await createSession(sNormId, candidate);
  // Fast-forward turns to reach normal wrap-up
  let normRes;
  for (let i = 0; i < 10; i++) {
    normRes = await handleTurn(sNormId, `Technical answer for turn ${i + 1} detailing pandas and sqlite architecture.`);
    if (normRes.done) break;
  }
  if (!normRes.done || !normRes.feedback || !normRes.judgeVerdict) {
    console.error('❌ FAIL: Normal completion did not generate valid feedback and judgeVerdict objects!');
    process.exit(1);
  }
  console.log('  ✅ PASSED: Normal completion produced valid structured feedback & judgeVerdict.\n');


  // --- 3. Path 2: Fullscreen Exit Suspension (4 Exits) ---
  console.log('>>> 3. Auditing Ending Path 2: Fullscreen Exit Suspension...');
  const sFSId = `audit-fs-${Date.now()}`;
  await createSession(sFSId, candidate);
  await reportViolation(sFSId, 'fullscreen-exit');
  await reportViolation(sFSId, 'fullscreen-exit');
  await reportViolation(sFSId, 'fullscreen-exit');
  const fsRes = await reportViolation(sFSId, 'fullscreen-exit'); // 4th exit

  if (!fsRes.done || !fsRes.suspended || !fsRes.feedback || !fsRes.judgeVerdict) {
    console.error('❌ FAIL: Fullscreen suspension did not produce valid structured feedback!');
    process.exit(1);
  }
  console.log(`  Summary: "${fsRes.feedback.summary}"`);
  console.log('  ✅ PASSED: Fullscreen 4th exit produced valid structured suspension feedback.\n');


  // --- 4. Path 3: Tab-Switch Suspension (1st Switch) ---
  console.log('>>> 4. Auditing Ending Path 3: Tab-Switch Zero Tolerance Suspension...');
  const sTabId = `audit-tab-${Date.now()}`;
  await createSession(sTabId, candidate);
  const tabRes = await reportViolation(sTabId, 'tab-switch'); // 1st switch

  if (!tabRes.done || !tabRes.suspended || !tabRes.feedback || !tabRes.judgeVerdict) {
    console.error('❌ FAIL: Tab-switch suspension did not produce valid structured feedback!');
    process.exit(1);
  }
  console.log(`  Summary: "${tabRes.feedback.summary}"`);
  console.log('  ✅ PASSED: Tab-switch 1st attempt produced valid structured suspension feedback.\n');


  // --- 5. Path 4: Copy-Paste / Screenshot Suspension (2nd Attempt) ---
  console.log('>>> 5. Auditing Ending Path 4: Copy-Paste / Screenshot Suspension...');
  const sClipId = `audit-clip-${Date.now()}`;
  await createSession(sClipId, candidate);
  await reportViolation(sClipId, 'copy-paste');
  const clipRes = await reportViolation(sClipId, 'copy-paste'); // 2nd attempt

  if (!clipRes.done || !clipRes.suspended || !clipRes.feedback || !clipRes.judgeVerdict) {
    console.error('❌ FAIL: Copy-paste suspension did not produce valid structured feedback!');
    process.exit(1);
  }
  console.log(`  Summary: "${clipRes.feedback.summary}"`);
  console.log('  ✅ PASSED: Copy-paste 2nd attempt produced valid structured suspension feedback.\n');


  // --- 6. Path 5: Conduct Violation Suspension (Threshold >= 3) ---
  console.log('>>> 6. Auditing Ending Path 5: Conduct Violation Suspension...');
  const sCondId = `audit-cond-${Date.now()}`;
  await createSession(sCondId, candidate);
  await handleTurn(sCondId, "idk");
  await handleTurn(sCondId, "how can i know");
  const condRes = await handleTurn(sCondId, "do has u like"); // 3rd turn, disrespect = wt 2 -> total 4

  if (!condRes.done || !condRes.suspended || !condRes.feedback || !condRes.judgeVerdict) {
    console.error('❌ FAIL: Conduct suspension did not produce valid structured feedback!');
    process.exit(1);
  }
  console.log(`  Summary: "${condRes.feedback.summary}"`);
  console.log('  ✅ PASSED: Conduct violation threshold produced valid structured suspension feedback.\n');

  console.log('====================================================');
  console.log('✅ ALL PHASE 7 AUDIT CRITERIA FULLY VERIFIED PASS!');
  console.log('====================================================');
}

runAudit().catch(err => {
  console.error('Audit crashed:', err);
  process.exit(1);
});
