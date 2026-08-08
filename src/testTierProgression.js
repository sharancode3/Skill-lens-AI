import { createSession, handleTurn, getSessionDoc, updateDifficulty, computeMetrics } from './sessionManager.js';
import { initializeData, getCandidateById } from './dataManager.js';

process.env.SIMULATE_LLM_OUTAGE = 'true';

async function testProgression() {
  console.log('=== TESTING PHASE 7: ADAPTIVE DIFFICULTY ESCALATION & DE-ESCALATION ===\n');

  await initializeData();
  const candidate = getCandidateById('CAND-001');
  const sessionId = `test-tier-full-${Date.now()}`;
  const session = await createSession(sessionId, candidate);

  console.log(`Initial Session Tier: ${session.difficultyTier} (Expected: standard)`);

  // Direct escalation validation
  console.log('\n--- 1. Validating Tier Escalation Streak ---');
  updateDifficulty(session, 95);
  console.log(`After Score 1 (95): Tier = ${session.difficultyTier}, Tiers Reached: [${session.tiersReached.join(', ')}]`);
  
  updateDifficulty(session, 100);
  console.log(`After Score 2 (100): Tier = ${session.difficultyTier}, Tiers Reached: [${session.tiersReached.join(', ')}]`);
  const reachedApplied = session.difficultyTier === 'applied';

  updateDifficulty(session, 95);
  console.log(`After Score 3 (95): Tier = ${session.difficultyTier}, Tiers Reached: [${session.tiersReached.join(', ')}]`);
  const reachedExpert = session.difficultyTier === 'expert';

  // De-escalation validation
  console.log('\n--- 2. Validating Tier De-escalation Streak ---');
  updateDifficulty(session, 30);
  console.log(`After Drop 1 (30): Tier = ${session.difficultyTier} (Expected: applied)`);
  
  updateDifficulty(session, 30);
  console.log(`After Drop 2 (30): Tier = ${session.difficultyTier} (Expected: standard)`);

  updateDifficulty(session, 30);
  console.log(`After Drop 3 (30): Tier = ${session.difficultyTier} (Expected: foundational)`);
  const reachedFoundational = session.difficultyTier === 'foundational';

  // Metrics progression check
  const metrics = computeMetrics(session);
  console.log('\n--- 3. Performance Metrics Progression Check ---');
  console.log('Metrics difficultyProgression:', metrics.difficultyProgression);

  const containsAll = ['foundational', 'standard', 'applied', 'expert'].every(t => metrics.difficultyProgression.includes(t));

  console.log(`\n=== RESULTS ===`);
  console.log(`Escalated to Applied: ${reachedApplied ? 'PASS' : 'FAIL'}`);
  console.log(`Escalated to Expert: ${reachedExpert ? 'PASS' : 'FAIL'}`);
  console.log(`De-escalated to Foundational: ${reachedFoundational ? 'PASS' : 'FAIL'}`);
  console.log(`Metrics Progression includes all 4 tiers: ${containsAll ? 'PASS' : 'FAIL'}`);

  if (reachedApplied && reachedExpert && reachedFoundational && containsAll) {
    console.log('\n✅ PHASE 7 ADAPTIVE DIFFICULTY ACCEPTANCE CRITERIA PASSED!');
  } else {
    console.error('\n❌ PHASE 7 FAILED.');
    process.exit(1);
  }
}

testProgression().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
