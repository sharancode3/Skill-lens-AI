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
  console.log('STARTING PHASE I5 INTEGRATION TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-phase-i5-${Date.now()}`;

  // Force offline mock mode for deterministic answers
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  console.log('>>> 1. Creating Session...');
  await createSession(sessionId, candidate);

  // Turn 1: Submit answer with interrupt-me trigger.
  console.log('>>> 2. Submitting first Turn with [interrupt-me] keyword...');
  let res1 = await handleTurn(sessionId, "I will explain Kafka. [interrupt-me]");
  let session = await getSessionDoc(sessionId);
  let entry1 = session.accuracyLog[session.accuracyLog.length - 1];

  console.log(`  Reaction: "${entry1.reactionClause}"`);
  console.log(`  Contains interruption prefix: ${entry1.reactionClause.includes("Sorry to interrupt")} (Expected: true)`);
  console.log(`  Logged interruptFlag: ${entry1.interruptFlag} (Expected: true)`);

  const tc1Pass = 
    entry1.reactionClause.includes("Sorry to interrupt") && 
    entry1.interruptFlag === true;

  console.log(`Test Case 1 (Successful Interruption): ${tc1Pass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Turn 2: Submit consecutive answer with interrupt-me trigger.
  // It should be blocked to prevent consecutive interrupts.
  console.log('>>> 3. Submitting consecutive Turn with [interrupt-me] keyword...');
  let res2 = await handleTurn(sessionId, "Kafka queues message partitions. [interrupt-me]");
  session = await getSessionDoc(sessionId);
  let entry2 = session.accuracyLog[session.accuracyLog.length - 1];

  console.log(`  Reaction: "${entry2.reactionClause}"`);
  console.log(`  Contains interruption prefix: ${entry2.reactionClause.includes("Sorry to interrupt")} (Expected: false)`);
  console.log(`  Logged interruptFlag: ${entry2.interruptFlag} (Expected: false)`);

  const tc2Pass = 
    !entry2.reactionClause.includes("Sorry to interrupt") && 
    entry2.interruptFlag === false;

  console.log(`Test Case 2 (Consecutive Interruption Blocked): ${tc2Pass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Turn 3: Submit third answer with interrupt-me trigger.
  // Since Turn 2 was not an interrupt, it is allowed now.
  console.log('>>> 4. Submitting Turn 3 with [interrupt-me] keyword (allowed)...');
  let res3 = await handleTurn(sessionId, "I will use Kafka database. [interrupt-me]");
  session = await getSessionDoc(sessionId);
  let entry3 = session.accuracyLog[session.accuracyLog.length - 1];

  console.log(`  Reaction: "${entry3.reactionClause}"`);
  console.log(`  Contains interruption prefix: ${entry3.reactionClause.includes("Sorry to interrupt")} (Expected: true)`);
  console.log(`  Logged interruptFlag: ${entry3.interruptFlag} (Expected: true)`);

  const tc3Pass = 
    entry3.reactionClause.includes("Sorry to interrupt") && 
    entry3.interruptFlag === true;

  console.log(`Test Case 3 (Allowed Interruption after spacing): ${tc3Pass ? 'PASS' : 'FAIL'}`);
  console.log('=======================================');
  console.log('PHASE I5 TESTS COMPLETE');
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
