import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { createSession, handleTurn } from './sessionManager.js';

console.log('=== TESTING PHASE 6 CONDUCT VIOLATION ACCUMULATION & SUSPENSION ===\n');

async function runTest() {
  initializeData();
  await precomputeConceptTerms();

  process.env.SIMULATE_LLM_OUTAGE = 'true';

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `session-phase6-test-${Date.now()}`;

  console.log(`1. Initializing session "${sessionId}" for ${candidate.member.name}...`);
  await createSession(sessionId, candidate);

  // Turn 1: "idk" (Disengaged, Weight = 1)
  console.log('\n--- Turn 1: Candidate sends "idk" ---');
  const res1 = await handleTurn(sessionId, "idk");
  console.log(`  Done: ${res1.done}, Suspended: ${res1.suspended || false}`);
  console.log(`  AI Response: "${res1.reply}"`);

  if (res1.done) {
    console.error('❌ FAILED: Session ended prematurely on 1st disengaged answer!');
    process.exit(1);
  }

  // Turn 2: "how can i know" (Disengaged, Weight = 1 -> Total = 2)
  console.log('\n--- Turn 2: Candidate sends "how can i know" ---');
  const res2 = await handleTurn(sessionId, "how can i know");
  console.log(`  Done: ${res2.done}, Suspended: ${res2.suspended || false}`);
  console.log(`  AI Response: "${res2.reply}"`);

  if (res2.done) {
    console.error('❌ FAILED: Session ended prematurely on 2nd disengaged answer!');
    process.exit(1);
  }

  // Turn 3: "do has u like" (Disrespectful, Weight = 2 -> Total = 4 >= 3 threshold)
  console.log('\n--- Turn 3: Candidate sends "do has u like" (Screenshot reproduction) ---');
  const res3 = await handleTurn(sessionId, "do has u like");
  console.log(`  Done: ${res3.done}, Suspended: ${res3.suspended || false}`);
  console.log(`  Feedback Summary: "${res3.feedback ? res3.feedback.summary : 'N/A'}"`);

  if (res3.done && res3.suspended) {
    console.log('\n✅ SUCCESS: 3rd turn ("do has u like") crossed conduct threshold and IMMEDIATELY ended the interview in suspended state!');
  } else {
    console.error('❌ FAILED: 3rd turn did NOT suspend the interview!');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
