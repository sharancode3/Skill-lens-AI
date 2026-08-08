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
  console.log('STARTING PHASE I4 INTEGRATION TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-phase-i4-${Date.now()}`;

  // Force offline mock mode for deterministic answers
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  console.log('>>> 1. Initializing Session...');
  await createSession(sessionId, candidate);
  let session = await getSessionDoc(sessionId);
  // Pad topicQueue to 15 entries to prevent early wrap-ups
  while (session.topicQueue.length < 15) {
    const nextDay = session.topicQueue.length + 1;
    session.topicQueue.push({
      day: nextDay,
      title: `Extra Topic Day ${nextDay}`,
      objectives: [`Objective ${nextDay}`],
      difficulty: "standard"
    });
  }
  await saveSessionDoc(sessionId, session);
  console.log(`  Initial capstoneTriggered: ${session.capstoneTriggered} (Expected: false)`);
  console.log('-------------------------------------------------------\n');

  // Simulate 8 turns to meet the floor (8 questions / 4 days covered)
  // Let's alternate between answering standard open questions to reach 8 questions.
  // We want to score 95 on each turn to guarantee an average >= 80 and zero hallucinations.
  console.log('>>> 2. Simulating 8 strong, hallucination-free turns to meet floor...');
  for (let i = 1; i <= 8; i++) {
    console.log(`  Submitting Turn ${i}...`);
    // Ensure strong score mock answers
    const messageText = `This is a strong technical explanation for question ${i} [strong-score].`;
    const res = await handleTurn(sessionId, messageText);
    session = await getSessionDoc(sessionId);
    console.log(`    Questions asked: ${session.questionsAsked}, Days covered: ${session.distinctDaysCovered.length}, Last Score: ${session.accuracyLog[session.accuracyLog.length - 1].finalAccuracyScore}`);
  }

  console.log('-------------------------------------------------------\n');
  console.log('>>> 3. Verifying Capstone Trigger conditions...');
  console.log(`  floorMet: ${session.questionsAsked >= 8 && session.distinctDaysCovered.length >= 4} (Expected: true)`);
  console.log(`  capstoneTriggered status: ${session.capstoneTriggered} (Expected: true)`);
  console.log(`  pendingQuestionType: ${session.pendingQuestionType} (Expected: capstone)`);
  console.log(`  Computed strongestTopic: ${JSON.stringify(session.strongestTopic)}`);

  const triggerPass = 
    session.capstoneTriggered === true && 
    session.pendingQuestionType === 'capstone' && 
    session.strongestTopic !== undefined;

  console.log(`Trigger Checks: ${triggerPass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Turn 9: The interviewer generates the Capstone System Design challenge
  console.log('>>> 4. Verifying Capstone Question Generation...');
  const res9 = await handleTurn(sessionId, "Ready for the capstone challenge.");
  session = await getSessionDoc(sessionId);
  console.log(`  Interviewer reply: "${res9.reply}"`);
  console.log(`  Reply contains Capstone prefix: ${res9.reply.includes("Capstone Challenge:")} (Expected: true)`);
  console.log(`  Logged turn 9 questionType: ${session.accuracyLog[session.accuracyLog.length - 1].questionType} (Expected: diagram_interpret)`);

  const genPass = res9.reply.includes("Capstone Challenge:");

  console.log(`Generation Checks: ${genPass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Turn 10: Candidate responds to the Capstone challenge.
  // The system should convert followup to why_probe and start why-probing.
  console.log('>>> 5. Verifying Capstone Follow-up Why-Loop redirection...');
  const res10 = await handleTurn(sessionId, "Here is my architecture. I will use Kafka and Cassandra.");
  session = await getSessionDoc(sessionId);
  console.log(`  Action chosen: ${res10.action} (Expected: why_probe)`);
  console.log(`  whyChainDepth: ${session.whyChainDepth} (Expected: 1)`);
  console.log(`  Logged turn 10 questionType: ${session.accuracyLog[session.accuracyLog.length - 1].questionType} (Expected: capstone)`);
  console.log(`  Interviewer reply: "${res10.reply}"`);

  const loopPass = 
    res10.action === 'why_probe' && 
    session.whyChainDepth === 1 &&
    session.accuracyLog[session.accuracyLog.length - 1].questionType === 'capstone';

  console.log(`Follow-up Redirection Checks: ${loopPass ? 'PASS' : 'FAIL'}`);
  console.log('=======================================');
  console.log('PHASE I4 TESTS COMPLETE');
  console.log('=======================================');

  if (triggerPass && genPass && loopPass) {
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
