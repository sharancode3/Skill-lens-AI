import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { 
  createSession, 
  handleTurn, 
  getSessionDoc, 
  saveSessionDoc, 
  detectHedging, 
  RESPONSE_TIME_BOUNDS 
} from './sessionManager.js';

async function runTest() {
  console.log('=======================================');
  console.log('STARTING PHASE I0 INTEGRATION TESTS');
  console.log('=======================================\n');

  // 1. Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-phase-i0-${Date.now()}`;

  // 2. Create session and verify new fields
  console.log('>>> 1. Creating Session & Verifying Schema Additions...');
  const startResponse = await createSession(sessionId, candidate);
  const session = await getSessionDoc(sessionId);

  const expectedFields = [
    'interviewStartedAt',
    'interviewEndedAt',
    'whyChainDepth',
    'capstoneTriggered',
    'hallucinationCount',
    'hedgeEventCount',
    'questionSentAt',
    'pendingWhyProbe'
  ];

  let allSchemaFieldsExist = true;
  for (const field of expectedFields) {
    const exists = session[field] !== undefined;
    console.log(`  Field "${field}" exists: ${exists} (Value: ${JSON.stringify(session[field])})`);
    if (!exists) allSchemaFieldsExist = false;
  }
  console.log(`Schema compliance: ${allSchemaFieldsExist ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // 3. Verify detectHedging function
  console.log('>>> 2. Verifying Hedging-Detection Function...');
  const hedgeAnswer = "I think maybe it's related to index retrieval, but I am not sure.";
  const confidentAnswer = "We deploy the application using Docker containers on Kubernetes pods.";

  const hedgeMatches = detectHedging(hedgeAnswer);
  const confidentMatches = detectHedging(confidentAnswer);

  console.log(`  Hedging answer matched: [${hedgeMatches.join(', ')}] (Expected: 'i think', 'maybe', 'not sure')`);
  console.log(`  Confident answer matched: [${confidentMatches.join(', ')}] (Expected: empty array)`);

  const hedgePass = hedgeMatches.includes('i think') && hedgeMatches.includes('maybe') && hedgeMatches.includes('not sure');
  const confidentPass = confidentMatches.length === 0;

  console.log(`Hedging detection accuracy: ${hedgePass && confidentPass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // 4. Verify expected response times lookup table
  console.log('>>> 3. Verifying RESPONSE_TIME_BOUNDS Table...');
  console.log('  RESPONSE_TIME_BOUNDS bounds:');
  console.log(`  Foundational: [${RESPONSE_TIME_BOUNDS.foundational.join(', ')}] (Expected: 20, 40)`);
  console.log(`  Standard: [${RESPONSE_TIME_BOUNDS.standard.join(', ')}] (Expected: 40, 70)`);
  console.log(`  Applied: [${RESPONSE_TIME_BOUNDS.applied.join(', ')}] (Expected: 70, 120)`);
  console.log(`  Expert: [${RESPONSE_TIME_BOUNDS.expert.join(', ')}] (Expected: 120, 200)`);
  console.log(`  Capstone: [${RESPONSE_TIME_BOUNDS.capstone.join(', ')}] (Expected: 180, 400)`);

  const boundsPass = 
    RESPONSE_TIME_BOUNDS.foundational[0] === 20 &&
    RESPONSE_TIME_BOUNDS.standard[1] === 70 &&
    RESPONSE_TIME_BOUNDS.applied[0] === 70 &&
    RESPONSE_TIME_BOUNDS.expert[1] === 200 &&
    RESPONSE_TIME_BOUNDS.capstone[0] === 180;
  console.log(`Response times configuration: ${boundsPass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // 5. Verify responseTimeSeconds server-side computation & hedge increment tallies
  console.log('>>> 4. Testing Turn Response Time & Hedging Increment Tallies...');
  
  // Set questionSentAt manually to 15 seconds ago to simulate delay
  const simulatedDelayMs = 15000;
  const simulatedQuestionTime = new Date(Date.now() - simulatedDelayMs).toISOString();
  session.questionSentAt = simulatedQuestionTime;
  await saveSessionDoc(sessionId, session);

  // Submit response with hedges
  console.log('  Submitting answer with hedging and simulated 15-second response time...');
  process.env.SIMULATE_LLM_OUTAGE = 'true';
  const turnResult = await handleTurn(sessionId, "I think maybe SQL is better than Pandas here.");
  
  const updatedDoc = await getSessionDoc(sessionId);
  const loggedEntry = updatedDoc.accuracyLog[updatedDoc.accuracyLog.length - 1];

  console.log(`  Logged Entry details:`);
  console.log(`    questionSentAt: ${loggedEntry.questionSentAt}`);
  console.log(`    answerReceivedAt: ${loggedEntry.answerReceivedAt}`);
  console.log(`    responseTimeSeconds: ${loggedEntry.responseTimeSeconds} (Expected: ~15)`);
  console.log(`    hedgeMarkers: [${loggedEntry.hedgeMarkers.join(', ')}]`);
  console.log(`    hedgeEventCount tally: ${updatedDoc.hedgeEventCount} (Expected: 1)`);
  console.log(`    hallucinationFlag: ${loggedEntry.hallucinationFlag} (Expected: false)`);
  console.log(`    whyProbe: ${loggedEntry.whyProbe}`);

  const timingVerification = Math.abs(loggedEntry.responseTimeSeconds - 15) <= 2;
  const countVerification = updatedDoc.hedgeEventCount === 1;

  console.log(`Server-side response verification: ${timingVerification && countVerification ? 'PASS' : 'FAIL'}`);
  console.log('=======================================');
  console.log('PHASE I0 TESTS COMPLETE');
  console.log('=======================================');

  if (allSchemaFieldsExist && hedgePass && confidentPass && boundsPass && timingVerification && countVerification) {
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
