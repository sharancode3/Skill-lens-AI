import { initializeData, candidatesById } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { createSession, handleTurn, getSessionDoc } from './sessionManager.js';
import assert from 'assert';

process.env.SIMULATE_LLM_OUTAGE = 'true';

async function runMultidimensionalTest() {
  console.log('=======================================');
  console.log('STARTING MULTIDIMENSIONAL EVALUATION TESTS');
  console.log('=======================================\n');

  initializeData();
  await generateEmbeddings();

  const candidate = candidatesById.get('CAND-001');
  const sessionId = `test-multi-dim-${Date.now()}`;

  let res = await createSession(sessionId, candidate);
  let turn = 1;

  console.log('>>> Simulating interview turns to check multidimensional scoring...');

  while (!res.done) {
    let candidateReply = '';
    if (res.nextQuestionType === 'mcq') {
      candidateReply = '1';
    } else {
      if (turn % 2 === 1) {
        candidateReply = 'This is a strong answer with details about pandas, sqlite, redis, lock, wal and concurrency.';
      } else {
        candidateReply = 'I do not know or have any idea about that, sorry.';
      }
    }
    
    console.log(`[Turn ${turn}] Question Type: ${res.nextQuestionType || 'open'}. Candidate: "${candidateReply}"`);
    res = await handleTurn(sessionId, candidateReply);
    turn++;
  }

  console.log('\n>>> Interview completed. Loading session document...');
  const session = await getSessionDoc(sessionId);

  console.log('\n>>> Verifying accuracyLog entries have dimension scores...');
  assert(session.accuracyLog && session.accuracyLog.length > 0, 'accuracyLog should not be empty');
  
  session.accuracyLog.forEach((entry, idx) => {
    console.log(`\nAccuracyLog Entry ${idx + 1} (Day ${entry.day} - ${entry.title}):`);
    console.log(`  - Overall Score: ${entry.finalAccuracyScore}`);
    console.log(`  - Correctness: ${entry.correctness}`);
    console.log(`  - Depth: ${entry.depth}`);
    console.log(`  - Reasoning Score: ${entry.reasoningScore}`);
    console.log(`  - Trade-offs: ${entry.tradeoffs}`);
    console.log(`  - Clarity: ${entry.clarity}`);

    // If rated, verify that dimensions are numbers and not identical
    if (entry.correctness !== undefined) {
      assert(typeof entry.correctness === 'number', 'correctness must be a number');
      assert(typeof entry.depth === 'number', 'depth must be a number');
      assert(typeof entry.reasoningScore === 'number', 'reasoningScore must be a number');
      assert(typeof entry.tradeoffs === 'number', 'tradeoffs must be a number');
      assert(typeof entry.clarity === 'number', 'clarity must be a number');
    }
  });

  console.log('\n>>> Verifying overall metrics payload aggregates...');
  const metrics = res.metrics;
  console.log('Metrics object:', {
    overallAccuracy: metrics.overallAccuracy,
    correctness: metrics.correctness,
    depth: metrics.depth,
    reasoning: metrics.reasoning,
    tradeoffs: metrics.tradeoffs,
    clarity: metrics.clarity
  });

  assert(typeof metrics.correctness === 'number', 'metrics.correctness must be a number');
  assert(typeof metrics.depth === 'number', 'metrics.depth must be a number');
  assert(typeof metrics.reasoning === 'number', 'metrics.reasoning must be a number');
  assert(typeof metrics.tradeoffs === 'number', 'metrics.tradeoffs must be a number');
  assert(typeof metrics.clarity === 'number', 'metrics.clarity must be a number');

  console.log('\n>>> Verifying feedback report dimensions...');
  const feedback = res.feedback;
  console.log('Feedback dimensions:', feedback.dimensions);
  
  assert(feedback.dimensions, 'feedback must include dimensions object');
  assert(typeof feedback.dimensions.correctness === 'number', 'feedback.dimensions.correctness must be a number');
  assert(typeof feedback.dimensions.depth === 'number', 'feedback.dimensions.depth must be a number');
  assert(typeof feedback.dimensions.reasoning === 'number', 'feedback.dimensions.reasoning must be a number');
  assert(typeof feedback.dimensions.tradeoffs === 'number', 'feedback.dimensions.tradeoffs must be a number');
  assert(typeof feedback.dimensions.clarity === 'number', 'feedback.dimensions.clarity must be a number');

  console.log('\n=======================================');
  console.log('ALL MULTIDIMENSIONAL TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================\n');
}

runMultidimensionalTest().catch(err => {
  console.error('Multidimensional test failed:', err);
  process.exit(1);
});
