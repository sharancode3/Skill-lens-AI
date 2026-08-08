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

async function runTests() {
  console.log('=======================================');
  console.log('STARTING PHASE I7 INTEGRATION TESTS');
  console.log('=======================================\n');

  // Initialize data
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  console.log('>>> 1. Simulating STRONG Candidate (Should result in "would_hire")...');
  const sessionStrongId = `test-i7-strong-${Date.now()}`;
  await createSession(sessionStrongId, candidate);
  
  // Pad queue
  let sessionStrong = await getSessionDoc(sessionStrongId);
  while (sessionStrong.topicQueue.length < 5) {
    sessionStrong.topicQueue.push({ day: sessionStrong.topicQueue.length + 1, title: `Topic ${sessionStrong.topicQueue.length + 1}`, status: 'pending' });
  }
  await saveSessionDoc(sessionStrongId, sessionStrong);

  // Turn 1 (Day 29): strong
  await handleTurn(sessionStrongId, "Detailed response with high correctness. [strong-score]");
  // Turn 2 (Day 12): strong
  await handleTurn(sessionStrongId, "Excellent prompt design mechanisms. [strong-score]");
  
  // Check feedback report
  sessionStrong = await getSessionDoc(sessionStrongId);
  let reportStrong = await generateFeedbackReport(sessionStrong);
  console.log('  STRONG Verdict Decision:', reportStrong.judgeVerdict.decision);
  console.log('  STRONG Verdict Reasoning:', reportStrong.judgeVerdict.reasoning);
  console.log('  STRONG Evidence Trail:', JSON.stringify(reportStrong.judgeVerdict.evidenceTrail, null, 2));

  const tc1Pass = reportStrong.judgeVerdict.decision === 'would_hire';


  console.log('\n>>> 2. Simulating WEAK Candidate (Should result in "would_reject")...');
  const sessionWeakId = `test-i7-weak-${Date.now()}`;
  await createSession(sessionWeakId, candidate);
  
  let sessionWeak = await getSessionDoc(sessionWeakId);
  while (sessionWeak.topicQueue.length < 5) {
    sessionWeak.topicQueue.push({ day: sessionWeak.topicQueue.length + 1, title: `Topic ${sessionWeak.topicQueue.length + 1}`, status: 'pending' });
  }
  await saveSessionDoc(sessionWeakId, sessionWeak);

  // Turn 1: shallow/weak response
  await handleTurn(sessionWeakId, "i dont know much. [shallow-score]");
  // Turn 2: triggers hallucination (force a weak score and hallucination Flag)
  sessionWeak = await getSessionDoc(sessionWeakId);
  sessionWeak.hallucinationCount = 2; // trigger reject threshold
  await saveSessionDoc(sessionWeakId, sessionWeak);
  await handleTurn(sessionWeakId, "Vectors are stored directly in GPT weights. [hallucinate-keyword]");

  sessionWeak = await getSessionDoc(sessionWeakId);
  // Add a hallucination flag to accuracyLog manually to simulate detector hit
  if (sessionWeak.accuracyLog.length > 0) {
    sessionWeak.accuracyLog[sessionWeak.accuracyLog.length - 1].hallucinationFlag = true;
    await saveSessionDoc(sessionWeakId, sessionWeak);
  }

  let reportWeak = await generateFeedbackReport(sessionWeak);
  console.log('  WEAK Verdict Decision:', reportWeak.judgeVerdict.decision);
  console.log('  WEAK Verdict Reasoning:', reportWeak.judgeVerdict.reasoning);
  console.log('  WEAK Evidence Trail:', JSON.stringify(reportWeak.judgeVerdict.evidenceTrail, null, 2));

  const tc2Pass = reportWeak.judgeVerdict.decision === 'would_reject';
  const tc3Pass = reportWeak.judgeVerdict.evidenceTrail.some(e => e.outcome === 'weak');


  console.log('\n>>> 3. Simulating MIXED-WITH-RECOVERY Candidate (Should result in "recovered" events)...');
  const sessionRecoverId = `test-i7-recover-${Date.now()}`;
  await createSession(sessionRecoverId, candidate);
  
  let sessionRecover = await getSessionDoc(sessionRecoverId);
  while (sessionRecover.topicQueue.length < 6) {
    sessionRecover.topicQueue.push({ day: sessionRecover.topicQueue.length + 1, title: `Topic ${sessionRecover.topicQueue.length + 1}`, status: 'pending' });
  }
  await saveSessionDoc(sessionRecoverId, sessionRecover);

  // Turn 1 (Day 29): weak score
  await handleTurn(sessionRecoverId, "i am not too sure about this. [shallow-score]");
  
  // Turn 2 (Day 12): strong score
  await handleTurn(sessionRecoverId, "Detailed response with high correctness. [strong-score]");
  // Turn 3 (Day 13): strong score
  await handleTurn(sessionRecoverId, "Perfect application logic here. [strong-score]");
  
  sessionRecover = await getSessionDoc(sessionRecoverId);
  let reportRecover = await generateFeedbackReport(sessionRecover);
  console.log('  RECOVERED Verdict Decision:', reportRecover.judgeVerdict.decision);
  console.log('  RECOVERED Verdict Reasoning:', reportRecover.judgeVerdict.reasoning);
  console.log('  RECOVERED Evidence Trail:', JSON.stringify(reportRecover.judgeVerdict.evidenceTrail, null, 2));

  const tc4Pass = reportRecover.judgeVerdict.evidenceTrail.some(e => e.outcome === 'recovered');

  console.log('\n=======================================');
  console.log('PHASE I7 INTEGRATION TEST RESULTS');
  console.log('=======================================');
  console.log(`Test Case 1 (Strong -> would_hire): ${tc1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test Case 2 (Weak -> would_reject): ${tc2Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test Case 3 (Weak evidence trail has 'weak' outcome): ${tc3Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test Case 4 (Recovered candidate has 'recovered' outcome): ${tc4Pass ? 'PASS' : 'FAIL'}`);

  if (tc1Pass && tc2Pass && tc3Pass && tc4Pass) {
    console.log('\nSUCCESS: All Judge Mode checks passed!');
    process.exit(0);
  } else {
    console.error('\nFAILURE: One or more Judge Mode checks failed!');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
