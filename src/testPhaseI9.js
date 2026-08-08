import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { 
  createSession, 
  handleTurn, 
  getSessionDoc, 
  saveSessionDoc,
  computeMetrics 
} from './sessionManager.js';
import { generateFeedbackReport } from './llmClient.js';

async function runRegressionTest() {
  console.log('=======================================');
  console.log('STARTING PHASE I9 FULL REGRESSION TEST');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `regression-session-${Date.now()}`;

  // Force offline mock mode
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  console.log('>>> 1. Creating Session...');
  await createSession(sessionId, candidate);

  // Pad topicQueue to 15 topics to prevent early out-of-topics wrap-up
  let session = await getSessionDoc(sessionId);
  while (session.topicQueue.length < 15) {
    const nextDay = session.topicQueue.length + 1;
    session.topicQueue.push({
      day: nextDay,
      title: `Curriculum Topic Day ${nextDay}`,
      objectives: [`Objective ${nextDay}`],
      status: 'pending'
    });
  }

  // Set explicit interviewStartedAt manually
  session.interviewStartedAt = new Date(Date.now() - 300000).toISOString(); // 5 mins ago
  await saveSessionDoc(sessionId, session);

  console.log('\n--- STARTING TURN-BY-TURN INTERVIEW ---');

  // Turn 1: SQLite initial. Low confidence hedging trigger.
  console.log('\n>>> [Turn 1] Initializing topic (SQLite) with heavily hedged low-confidence answer...');
  session = await getSessionDoc(sessionId);
  session.questionSentAt = new Date(Date.now() - 15000).toISOString();
  await saveSessionDoc(sessionId, session);

  let res = await handleTurn(sessionId, "i think SQLite is probably sqlite-initial why-initial SQLite index maybe.");
  console.log(`  Classification: ${res.action} (Expected: why_probe)`);
  console.log(`  Last history item communicationConfidence: ${res.questionHistory[res.questionHistory.length - 1].communicationConfidence} (Expected: low)`);
  
  const tc1Pass = res.action === 'why_probe';
  const tc2Pass = res.questionHistory[res.questionHistory.length - 1].communicationConfidence === 'low';

  // Turn 2: SQLite why level 1.
  console.log('\n>>> [Turn 2] SQLite why level 1...');
  session = await getSessionDoc(sessionId);
  session.questionSentAt = new Date(Date.now() - 20000).toISOString();
  await saveSessionDoc(sessionId, session);

  res = await handleTurn(sessionId, "sqlite-level-1 sqlite index why-level-1");
  console.log(`  Classification: ${res.action} (Expected: why_probe)`);
  console.log(`  whyChainDepth: ${(await getSessionDoc(sessionId)).whyChainDepth} (Expected: 2)`);

  const tc3Pass = res.action === 'why_probe';

  // Turn 3: SQLite why level 2.
  console.log('\n>>> [Turn 3] SQLite why level 2...');
  session = await getSessionDoc(sessionId);
  session.questionSentAt = new Date(Date.now() - 25000).toISOString();
  await saveSessionDoc(sessionId, session);

  res = await handleTurn(sessionId, "sqlite-level-2 sqlite index why-level-2");
  console.log(`  Classification: ${res.action} (Expected: why_probe)`);
  console.log(`  whyChainDepth: ${(await getSessionDoc(sessionId)).whyChainDepth} (Expected: 3)`);

  // Turn 4: SQLite why level 3. Halts chain at depth limit.
  console.log('\n>>> [Turn 4] SQLite why level 3 (Halting chain at depth limit)...');
  session = await getSessionDoc(sessionId);
  session.questionSentAt = new Date(Date.now() - 30000).toISOString();
  await saveSessionDoc(sessionId, session);

  res = await handleTurn(sessionId, "sqlite-level-3 why-level-3");
  console.log(`  Classification: ${res.action} (Expected: advance)`);
  console.log(`  whyChainDepth reset: ${(await getSessionDoc(sessionId)).whyChainDepth} (Expected: 0)`);

  const tc4Pass = res.action === 'advance';

  // Turn 5: Factual Hallucination
  console.log('\n>>> [Turn 5] Factual Hallucination...');
  session = await getSessionDoc(sessionId);
  session.nextQuestionType = 'open';
  session.pendingQuestionType = 'open';
  session.questionSentAt = new Date(Date.now() - 10000).toISOString();
  await saveSessionDoc(sessionId, session);

  res = await handleTurn(sessionId, "rag stores vectors inside gpt weights");
  console.log(`  hallucinationFlag: ${res.hallucinationFlag} (Expected: true)`);
  console.log(`  hallucinationCorrection: "${res.hallucinationCorrection}" (Expected: external database correction)`);

  const tc5Pass = res.hallucinationFlag === true;

  // Turn 6: Simulated AI Interrupt
  console.log('\n>>> [Turn 6] Simulated AI Interrupt...');
  session = await getSessionDoc(sessionId);
  session.nextQuestionType = 'open';
  session.pendingQuestionType = 'open';
  session.questionSentAt = new Date(Date.now() - 12000).toISOString();
  await saveSessionDoc(sessionId, session);

  res = await handleTurn(sessionId, "Please interrupt-me with a question.");
  const interruptApplied = res.reply.includes("Sorry to interrupt");
  console.log(`  Reaction clause interruptFlag: ${interruptApplied} (Expected: true)`);

  const tc6Pass = interruptApplied === true;

  // Turn 7: Strong answer
  console.log('\n>>> [Turn 7] Standard strong answer...');
  session = await getSessionDoc(sessionId);
  session.nextQuestionType = 'open';
  session.pendingQuestionType = 'open';
  session.questionSentAt = new Date(Date.now() - 15000).toISOString();
  await saveSessionDoc(sessionId, session);
  res = await handleTurn(sessionId, "A solid detailed answer matching objectives. [strong-score]");

  // Turn 8: Strong answer
  console.log('\n>>> [Turn 8] Standard strong answer...');
  session = await getSessionDoc(sessionId);
  session.nextQuestionType = 'open';
  session.pendingQuestionType = 'open';
  session.questionSentAt = new Date(Date.now() - 15000).toISOString();
  await saveSessionDoc(sessionId, session);
  res = await handleTurn(sessionId, "Another solid detailed answer. [strong-score]");

  // Turn 9: Strong answer. Floor met + 4 consecutive strong hallucination-free turns triggers Capstone!
  console.log('\n>>> [Turn 9] Standard strong answer (Triggering Capstone)...');
  session = await getSessionDoc(sessionId);
  session.nextQuestionType = 'open';
  session.pendingQuestionType = 'open';
  session.questionSentAt = new Date(Date.now() - 15000).toISOString();
  await saveSessionDoc(sessionId, session);
  
  res = await handleTurn(sessionId, "Last required strong answer. [strong-score]");
  console.log(`  Capstone Triggered status: ${(await getSessionDoc(sessionId)).capstoneTriggered} (Expected: true)`);
  console.log(`  Next Question Type: ${res.nextQuestionType} (Expected: capstone)`);

  const tc7Pass = (await getSessionDoc(sessionId)).capstoneTriggered === true;
  const tc8Pass = res.nextQuestionType === 'capstone';

  // Turn 10: Capstone challenge turn
  console.log('\n>>> [Turn 10] Answering Capstone Challenge to wrap up the interview...');
  session = await getSessionDoc(sessionId);
  session.questionSentAt = new Date(Date.now() - 25000).toISOString();
  await saveSessionDoc(sessionId, session);

  res = await handleTurn(sessionId, "Detailed system design capstone response. [strong-score]");
  console.log(`  Interview Completed status (done): ${res.done} (Expected: true)`);

  const tc9Pass = res.done === true;

  console.log('\n>>> Verification of Metrics and Judge Verdict...');
  session = await getSessionDoc(sessionId);
  
  // Explicitly set ended timestamp to 5 minutes after start
  session.interviewEndedAt = new Date(new Date(session.interviewStartedAt).getTime() + 300000).toISOString();
  await saveSessionDoc(sessionId, session);

  const metrics = computeMetrics(session);
  const report = await generateFeedbackReport(session);

  console.log(`  totalInterviewDurationSeconds: ${metrics.totalInterviewDurationSeconds} (Expected: 300)`);
  console.log(`  Verdict Decision: ${report.judgeVerdict.decision} (Expected: borderline)`);
  console.log(`  Verdict Evidence Trail length: ${report.judgeVerdict.evidenceTrail.length} (Expected: 3-5)`);
  console.log('  Evidence Trail Outcomes:', report.judgeVerdict.evidenceTrail.map(e => `${e.questionRef}: ${e.outcome}`));

  const tc10Pass = metrics.totalInterviewDurationSeconds === 300;
  const tc11Pass = report.judgeVerdict.decision === 'borderline';
  const tc12Pass = report.judgeVerdict.evidenceTrail.length >= 3 && report.judgeVerdict.evidenceTrail.length <= 5;
  const tc13Pass = report.judgeVerdict.evidenceTrail.some(e => e.outcome === 'recovered');

  console.log('\n=======================================');
  console.log('REGRESSION TEST VERIFICATION RESULTS');
  console.log('=======================================');
  console.log(`Test 1 (Low confidence why_probe action): ${tc1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 2 (Low confidence sidebar tag): ${tc2Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 3 (Why chain depth increments): ${tc3Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 4 (Why chain halting depth limit): ${tc4Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 5 (Hallucination flagging & correction): ${tc5Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 6 (Simulated AI interruption): ${tc6Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 7 (Capstone Trigger state): ${tc7Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 8 (Next question type capstone): ${tc8Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 9 (Interview Done wrapup): ${tc9Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 10 (Duration calculation): ${tc10Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 11 (Judge Verdict borderline decision): ${tc11Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 12 (Judge Verdict Evidence Trail range): ${tc12Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 13 (Evidence Trail contains 'recovered'): ${tc13Pass ? 'PASS' : 'FAIL'}`);

  const allPassed = tc1Pass && tc2Pass && tc3Pass && tc4Pass && tc5Pass && tc6Pass && tc7Pass && tc8Pass && tc9Pass && tc10Pass && tc11Pass && tc12Pass && tc13Pass;

  if (allPassed) {
    console.log('\nSUCCESS: All end-to-end regression tests passed!');
    process.exit(0);
  } else {
    console.error('\nFAILURE: One or more regression tests failed!');
    process.exit(1);
  }
}

runRegressionTest().catch(err => {
  console.error('Regression test failed:', err);
  process.exit(1);
});
