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
  console.log('STARTING PHASE I3 INTEGRATION TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-phase-i3-${Date.now()}`;

  // Force offline mock mode for deterministic answers
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  // Scenario 1: Deepening Why-Chain to Depth 3 and Root Reached
  console.log('>>> 1. Testing Scenario 1: Full Probing Chain to Root Reached...');
  await createSession(sessionId, candidate);

  console.log('  [Turn 1] Submitting strong initial answer...');
  let res1 = await handleTurn(sessionId, "Pandas helps load claims. [why-initial]");
  let session = await getSessionDoc(sessionId);
  console.log(`    Action: ${res1.action} (Expected: why_probe)`);
  console.log(`    whyChainDepth: ${session.whyChainDepth} (Expected: 1)`);
  console.log(`    Reply: "${res1.reply}"`);
  
  const step1Pass = res1.action === 'why_probe' && session.whyChainDepth === 1;

  console.log('  [Turn 2] Submitting level 1 justification...');
  let res2 = await handleTurn(sessionId, "SQLite handles SQL queries directly. [why-level-1]");
  session = await getSessionDoc(sessionId);
  console.log(`    Action: ${res2.action} (Expected: why_probe)`);
  console.log(`    whyChainDepth: ${session.whyChainDepth} (Expected: 2)`);
  console.log(`    Reply: "${res2.reply}"`);

  const step2Pass = res2.action === 'why_probe' && session.whyChainDepth === 2;

  console.log('  [Turn 3] Submitting level 2 justification...');
  let res3 = await handleTurn(sessionId, "Index avoids full scans. [why-level-2]");
  session = await getSessionDoc(sessionId);
  console.log(`    Action: ${res3.action} (Expected: why_probe)`);
  console.log(`    whyChainDepth: ${session.whyChainDepth} (Expected: 3)`);
  console.log(`    Reply: "${res3.reply}"`);

  const step3Pass = res3.action === 'why_probe' && session.whyChainDepth === 3;

  console.log('  [Turn 4] Submitting level 3 (final) justification...');
  let res4 = await handleTurn(sessionId, "SQLite uses B-Trees on disk pages. [why-level-3]");
  session = await getSessionDoc(sessionId);
  console.log(`    Action: ${res4.action} (Expected: advance)`);
  console.log(`    whyChainDepth: ${session.whyChainDepth} (Expected: 0 - reset on advance)`);
  console.log(`    Active Topic Cursor Index: ${session.cursor} (Expected: 1)`);
  console.log(`    Reply: "${res4.reply}"`);

  const lastEntry = session.accuracyLog[session.accuracyLog.length - 1];
  console.log(`    rootUnderstandingReached logged: ${lastEntry.rootUnderstandingReached} (Expected: true)`);

  const step4Pass = res4.action === 'advance' && session.whyChainDepth === 0 && session.cursor === 1 && lastEntry.rootUnderstandingReached === true;

  console.log(`Scenario 1 (Successful drill): ${step1Pass && step2Pass && step3Pass && step4Pass ? 'PASS' : 'FAIL'}`);
  console.log('-------------------------------------------------------\n');

  // Scenario 2: Gap mid-drill (drops to shallow)
  console.log('>>> 2. Testing Scenario 2: Gap Discovered Mid-Drill (Termination)...');
  const sessionId2 = `test-phase-i3-gap-${Date.now()}`;
  await createSession(sessionId2, candidate);

  console.log('  [Turn 1] Submitting strong initial answer...');
  let t1 = await handleTurn(sessionId2, "We load CSV to SQLite. [why-initial]");
  session = await getSessionDoc(sessionId2);
  console.log(`    Action: ${t1.action} (Expected: why_probe)`);
  console.log(`    whyChainDepth: ${session.whyChainDepth} (Expected: 1)`);

  const gapStep1Pass = t1.action === 'why_probe' && session.whyChainDepth === 1;

  console.log('  [Turn 2] Submitting weak/shallow answer to why probe...');
  let t2 = await handleTurn(sessionId2, "I don't know much about index internals. [why-weak]");
  session = await getSessionDoc(sessionId2);
  
  const loggedTurn = session.accuracyLog[session.accuracyLog.length - 1];
  console.log(`    Action: ${t2.action} (Expected: advance - terminated early)`);
  console.log(`    whyChainDepth: ${session.whyChainDepth} (Expected: 0 - reset)`);
  console.log(`    Classification: ${loggedTurn.classification} (Expected: shallow)`);
  console.log(`    Active Topic Cursor Index: ${session.cursor} (Expected: 1)`);

  const gapStep2Pass = t2.action === 'advance' && session.whyChainDepth === 0 && loggedTurn.classification === 'shallow' && session.cursor === 1;

  console.log(`Scenario 2 (Gap early termination): ${gapStep1Pass && gapStep2Pass ? 'PASS' : 'FAIL'}`);
  console.log('=======================================');
  console.log('PHASE I3 TESTS COMPLETE');
  console.log('=======================================');

  if (step1Pass && step2Pass && step3Pass && step4Pass && gapStep1Pass && gapStep2Pass) {
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
