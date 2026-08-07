import { initializeData, candidatesById } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { createSession, handleTurn } from './sessionManager.js';

async function runFeedbackTest() {
  console.log('=======================================');
  console.log('STARTING INTEGRATED FEEDBACK COMPOSER TESTS');
  console.log('=======================================\n');

  // Initialize loaders and embeds
  initializeData();
  await generateEmbeddings();

  const candidate = candidatesById.get('CAND-001');

  // Test 1: Strong performance simulation
  console.log('>>> RUNNING TEST 1: Mostly Strong Performance...');
  const sessionStrongId = `test-feedback-strong-${Date.now()}`;
  let strongRes = await createSession(sessionStrongId, candidate);
  let step = 1;

  while (!strongRes.done) {
    const detailedAnswer = `I have extensive expertise on this topic. I always design robust systems, structure logging dynamically, configure secure pipelines, and handle edge cases, resulting in high reliability and performance under load. (Turn ${step})`;
    strongRes = await handleTurn(sessionStrongId, detailedAnswer);
    step++;
  }

  console.log('\n--- STRONG PERFORMANCE REPORT ---');
  console.log(JSON.stringify(strongRes.feedback, null, 2));
  console.log('-------------------------------------------------------\n');

  // Test 2: Shallow performance simulation
  console.log('>>> RUNNING TEST 2: Mostly Shallow Performance...');
  const sessionShallowId = `test-feedback-shallow-${Date.now()}`;
  let shallowRes = await createSession(sessionShallowId, candidate);
  step = 1;

  while (!shallowRes.done) {
    const shallowAnswer = `No.`;
    shallowRes = await handleTurn(sessionShallowId, shallowAnswer);
    step++;
  }

  console.log('\n--- SHALLOW PERFORMANCE REPORT ---');
  console.log(JSON.stringify(shallowRes.feedback, null, 2));
  console.log('-------------------------------------------------------\n');

  console.log('=======================================');
  console.log('INTEGRATED FEEDBACK COMPOSER TESTS COMPLETE');
  console.log('=======================================\n');
}

runFeedbackTest().catch(err => {
  console.error('Feedback test crashed:', err);
});
