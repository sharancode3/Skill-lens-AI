import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { 
  createSession, 
  handleTurn, 
  getSessionDoc, 
  saveSessionDoc
} from './sessionManager.js';

async function runTest() {
  console.log('=======================================');
  console.log('STARTING PHASE I8 INTEGRATION TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-phase-i8-${Date.now()}`;

  // Force offline mock mode
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  console.log('>>> 1. Creating Session...');
  await createSession(sessionId, candidate);

  // Turn 1: Simulating standard answer with hallucination
  console.log('>>> 2. Submitting Turn 1 (with hallucination flagged)...');
  
  // Set candidate response triggering hallucination
  let response = await handleTurn(sessionId, "I believe rag stores vectors inside gpt weights.");

  console.log(`  Response hallucinationFlag: ${response.hallucinationFlag} (Expected: true)`);
  console.log(`  Response hallucinationCorrection: "${response.hallucinationCorrection}" (Expected: not empty)`);
  
  const tc1Pass = response.hallucinationFlag === true;
  const tc2Pass = typeof response.hallucinationCorrection === 'string' && response.hallucinationCorrection.length > 0;

  // Turn 2: Simulating why probe with low confidence
  console.log('>>> 3. Submitting Turn 2...');
  
  // Force whyProbe true in session for the next turn
  let session = await getSessionDoc(sessionId);
  session.pendingWhyProbe = true;
  session.whyChainDepth = 1;
  await saveSessionDoc(sessionId, session);

  // Send a message with low confidence hedges
  response = await handleTurn(sessionId, "i think SQLite is probably sqlite-initial why-initial SQLite index maybe.");
  
  // Inspect questionHistory logs
  const lastHistoryEntry = response.questionHistory[response.questionHistory.length - 1];
  console.log(`  Last history item communicationConfidence: ${lastHistoryEntry.communicationConfidence} (Expected: 'low')`);
  console.log(`  Last history item whyProbe: ${lastHistoryEntry.whyProbe} (Expected: true)`);
  
  const tc3Pass = lastHistoryEntry.communicationConfidence === 'low';
  const tc4Pass = lastHistoryEntry.whyProbe === true;

  console.log(`\nTest Case 1 (hallucinationFlag): ${tc1Pass ? 'PASS' : 'FAIL'}`);
  console.log('Test Case 2 (hallucinationCorrection):', tc2Pass ? 'PASS' : 'FAIL');
  console.log('Test Case 3 (communicationConfidence):', tc3Pass ? 'PASS' : 'FAIL');
  console.log('Test Case 4 (whyProbe):', tc4Pass ? 'PASS' : 'FAIL');

  console.log('=======================================');
  console.log('PHASE I8 TESTS COMPLETE');
  console.log('=======================================');

  if (tc1Pass && tc2Pass && tc3Pass && tc4Pass) {
    console.log('\nSUCCESS: All checks passed!');
    process.exit(0);
  } else {
    console.error('\nFAILURE: One or more checks failed!');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
