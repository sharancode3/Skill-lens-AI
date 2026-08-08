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
  console.log('STARTING PHASE I1 INTEGRATION TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-phase-i1-${Date.now()}`;

  // Force offline mock mode for deterministic answers
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  console.log('>>> 1. Creating fresh Session...');
  await createSession(sessionId, candidate);
  let session = await getSessionDoc(sessionId);
  console.log(`  Initial hallucinationCount: ${session.hallucinationCount} (Expected: 0)`);
  console.log(`  Initial hallucinationCountForCurrentTopic: ${session.hallucinationCountForCurrentTopic} (Expected: 0)`);
  console.log('-------------------------------------------------------\n');

  // Test Case 1: Confidently Incorrect response (Hallucination)
  console.log('>>> 2. Submitting Confidently Incorrect Answer (Hallucination)...');
  const answer1 = "RAG stores vectors inside GPT's weights.";
  const res1 = await handleTurn(sessionId, answer1);
  
  session = await getSessionDoc(sessionId);
  const entry1 = session.accuracyLog[session.accuracyLog.length - 1];

  console.log(`  Classification: ${entry1.classification} (Expected: shallow)`);
  console.log(`  finalAccuracyScore: ${entry1.finalAccuracyScore} (Expected: 20)`);
  console.log(`  hallucinationFlag: ${entry1.hallucinationFlag} (Expected: true)`);
  console.log(`  hallucinationCorrection: "${entry1.hallucinationCorrection}"`);
  console.log(`  Interviewer reply: "${res1.reply}"`);
  
  const hasWarningPrefix = res1.reply.startsWith('⚠️');
  console.log(`  Interviewer reply starts with ⚠️ warning: ${hasWarningPrefix} (Expected: true)`);
  console.log(`  Running hallucinationCount tally: ${session.hallucinationCount} (Expected: 1)`);
  console.log(`  hallucinationCountForCurrentTopic: ${session.hallucinationCountForCurrentTopic} (Expected: 1)`);

  const tc1Pass = 
    entry1.hallucinationFlag === true && 
    entry1.finalAccuracyScore === 20 && 
    hasWarningPrefix && 
    session.hallucinationCount === 1 && 
    session.hallucinationCountForCurrentTopic === 1;

  console.log(`Test Case 1 (Hallucination Check): ${tc1Pass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Test Case 2: Vague but honest response (No Hallucination)
  console.log('>>> 3. Submitting Vague but Honest Answer (No Hallucination)...');
  const answer2 = "I don't know much, probably vectors are used to search things.";
  const res2 = await handleTurn(sessionId, answer2);

  session = await getSessionDoc(sessionId);
  const entry2 = session.accuracyLog[session.accuracyLog.length - 1];

  console.log(`  Classification: ${entry2.classification} (Expected: shallow or partial)`);
  console.log(`  hallucinationFlag: ${entry2.hallucinationFlag} (Expected: false)`);
  console.log(`  hallucinationCorrection: "${entry2.hallucinationCorrection}" (Expected: empty string)`);
  console.log(`  Interviewer reply starts with ⚠️: ${res2.reply.startsWith('⚠️')} (Expected: false)`);
  console.log(`  Running hallucinationCount tally: ${session.hallucinationCount} (Expected: 1)`);

  const tc2Pass = 
    entry2.hallucinationFlag === false && 
    entry2.hallucinationCorrection === "" && 
    !res2.reply.startsWith('⚠️') && 
    session.hallucinationCount === 1;

  console.log(`Test Case 2 (Honest Vague Check): ${tc2Pass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Test Case 3: Repeated Hallucinations in same topic -> Forced Advance
  console.log('>>> 4. Testing Repeated Hallucinations (Forced Advance Override)...');
  
  // Clean session for topic testing
  const sessionId2 = `test-phase-i1-repeat-${Date.now()}`;
  await createSession(sessionId2, candidate);

  console.log('  [Turn 1] Submitting first hallucination for topic 1...');
  const t1 = await handleTurn(sessionId2, "RAG stores vectors inside GPT's weights.");
  session = await getSessionDoc(sessionId2);
  console.log(`    hallucinationCountForCurrentTopic: ${session.hallucinationCountForCurrentTopic} (Expected: 1)`);
  console.log(`    Action: ${t1.action} (Expected: followup)`);
  
  console.log('  [Turn 2] Submitting second hallucination for same topic...');
  const t2 = await handleTurn(sessionId2, "RAG stores vectors inside weights of GPT.");
  session = await getSessionDoc(sessionId2);
  console.log(`    hallucinationCountForCurrentTopic: ${session.hallucinationCountForCurrentTopic} (Expected: 0 - since cursor advanced and count reset)`);
  console.log(`    Action resolved to: ${t2.action} (Expected: advance)`);
  console.log(`    New Active Topic Cursor: ${session.cursor} (Expected: 1)`);
  console.log(`    Interviewer reply: "${t2.reply}"`);
  const transitionAdvancementText = t2.reply.includes("Let's move on to the next topic") || t2.reply.includes("move on to the next topic");
  console.log(`    Transition text shows topic advancement: ${transitionAdvancementText}`);

  const tc3Pass = 
    t1.action === 'followup' && 
    t2.action === 'advance' && 
    session.cursor === 1 && 
    session.hallucinationCountForCurrentTopic === 0;

  console.log(`Test Case 3 (Forced Advance Check): ${tc3Pass ? 'PASS' : 'FAIL'}`);
  console.log('=======================================');
  console.log('PHASE I1 TESTS COMPLETE');
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
