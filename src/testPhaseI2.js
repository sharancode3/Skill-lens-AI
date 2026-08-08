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
  console.log('STARTING PHASE I2 INTEGRATION TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-phase-i2-${Date.now()}`;

  // Force offline mock mode for deterministic answers
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  console.log('>>> 1. Creating fresh Session...');
  await createSession(sessionId, candidate);
  let session = await getSessionDoc(sessionId);
  console.log(`  Initial hedgeEventCount: ${session.hedgeEventCount} (Expected: 0)`);
  console.log('-------------------------------------------------------\n');

  // Test Case 1: Technically Correct but Low Confidence (Hedging)
  console.log('>>> 2. Submitting Correct Answer with Hedging (low confidence)...');
  const answer1 = "I think maybe Pandas is used to read CSV, and probably we write it to SQLite, but I am not sure.";
  const res1 = await handleTurn(sessionId, answer1);

  session = await getSessionDoc(sessionId);
  const entry1 = session.accuracyLog[session.accuracyLog.length - 1];

  console.log(`  Classification: ${entry1.classification} (Expected: partial/strong)`);
  console.log(`  finalAccuracyScore: ${entry1.finalAccuracyScore} (Expected: 65/95)`);
  console.log(`  communicationConfidence: ${entry1.communicationConfidence} (Expected: low)`);
  console.log(`  Running hedgeEventCount: ${session.hedgeEventCount} (Expected: 1)`);
  console.log(`  Interviewer reaction clause: "${res1.reply}"`);

  const tc1Pass = 
    entry1.communicationConfidence === 'low' && 
    entry1.finalAccuracyScore >= 60 && 
    session.hedgeEventCount === 1;

  console.log(`Test Case 1 (Correct/Low Confidence): ${tc1Pass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Test Case 2: Confident Answer (High Confidence)
  console.log('>>> 3. Submitting Answer without Hedging (high confidence)...');
  const answer2 = "We load the CSV using Pandas and clean nulls based on column semantics.";
  await handleTurn(sessionId, answer2);

  session = await getSessionDoc(sessionId);
  const entry2 = session.accuracyLog[session.accuracyLog.length - 1];

  console.log(`  Classification: ${entry2.classification} (Expected: partial/strong)`);
  console.log(`  communicationConfidence: ${entry2.communicationConfidence} (Expected: high)`);
  console.log(`  Running hedgeEventCount: ${session.hedgeEventCount} (Expected: 1 - unchanged)`);

  const tc2Pass = 
    entry2.communicationConfidence === 'high' && 
    session.hedgeEventCount === 1;

  console.log(`Test Case 2 (Confident High Confidence): ${tc2Pass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Test Case 3: Probing Hook (hedgeEventCount >= 3)
  console.log('>>> 4. Testing Probing reaction note hook (hedgeEventCount >= 3)...');
  
  // Set hedge count manually to 3 to trigger the situational hook
  session.hedgeEventCount = 3;
  await saveSessionDoc(sessionId, session);

  console.log(`  Simulating correct answer with hedges when hedgeEventCount is ${session.hedgeEventCount}...`);
  const answer3 = "I think probably SQLite via SQLAlchemy is standard.";
  const res3 = await handleTurn(sessionId, answer3);

  session = await getSessionDoc(sessionId);
  const entry3 = session.accuracyLog[session.accuracyLog.length - 1];

  console.log(`  Interviewer reply: "${res3.reply}"`);
  const containsProbingNote = res3.reply.includes("You said 'probably' there, but that was actually right");
  console.log(`  Interviewer reply contains probing note: ${containsProbingNote} (Expected: true)`);
  console.log(`  communicationConfidence: ${entry3.communicationConfidence} (Expected: low)`);

  const tc3Pass = 
    containsProbingNote && 
    entry3.communicationConfidence === 'low';

  console.log(`Test Case 3 (Confidence Probing Note Hook): ${tc3Pass ? 'PASS' : 'FAIL'}`);
  console.log('=======================================');
  console.log('PHASE I2 TESTS COMPLETE');
  console.log('=======================================');

  if (tc1Pass && tc2Pass && tc3Pass) {
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
