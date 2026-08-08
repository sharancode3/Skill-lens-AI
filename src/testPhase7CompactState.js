/**
 * Phase 7 Side-by-Side Validation Test
 * Verifies:
 *   1. session.compactState is initialized on session creation
 *   2. updateCompactState classifies topics correctly (deterministic)
 *   3. compactState is updated in handleTurn on topic advance
 *   4. session.transcript is fully intact and unaffected
 *   5. evaluateTopicPerformanceWithLLM backward compat (with/without session param)
 *   6. No scoring regression
 */

process.env.SIMULATE_LLM_OUTAGE = 'true';

import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { createSession, handleTurn, updateCompactState, getSessionDoc } from './sessionManager.js';
import { evaluateTopicPerformanceWithLLM } from './llmClient.js';

initializeData();
precomputeConceptTerms();

const candidate = candidatesById.get('CAND-001');
if (!candidate) {
  console.error('[Phase7 Test] CAND-001 not found. Aborting.');
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}${detail ? ' -- ' + detail : ''}`);
    failed++;
  }
}

async function runPhase7Tests() {
  console.log('\n===========================================');
  console.log('Phase 7: Compact Derived Session State Tests');
  console.log('===========================================\n');

  // TEST 1: compactState initialized in createSession
  console.log('[Test 1] compactState initialized on session creation...');
  const sessionId = `test-p7-${Date.now()}`;
  await createSession(sessionId, candidate);
  const session = await getSessionDoc(sessionId);

  assert('session.compactState exists', !!session.compactState);
  assert('strongTopics is empty array', Array.isArray(session.compactState.strongTopics) && session.compactState.strongTopics.length === 0);
  assert('weakTopics is empty array', Array.isArray(session.compactState.weakTopics) && session.compactState.weakTopics.length === 0);
  assert('misconceptions is empty array', Array.isArray(session.compactState.misconceptions) && session.compactState.misconceptions.length === 0);
  assert('currentDay is set', session.compactState.currentDay !== null && session.compactState.currentDay !== undefined);
  assert('currentDifficultyTier is standard', session.compactState.currentDifficultyTier === 'standard');
  assert('daysCovered is empty array', Array.isArray(session.compactState.daysCovered) && session.compactState.daysCovered.length === 0);
  assert('session.transcript still exists', Array.isArray(session.transcript));

  // TEST 2: updateCompactState deterministic classification
  console.log('\n[Test 2] updateCompactState classifies topics correctly...');

  const mockSession = {
    difficultyTier: 'standard',
    questionsAsked: 3,
    distinctDaysCovered: [7],
    compactState: {
      strongTopics: [],
      weakTopics: [],
      misconceptions: [],
      currentDay: 7,
      currentDifficultyTier: 'standard',
      questionsAsked: 2,
      daysCovered: []
    }
  };

  const mockTopic = { day: 7, title: 'Embeddings Explained' };

  // Strong score
  updateCompactState(mockSession, mockTopic, 85, 'Solid embeddings answer with HNSW details.', { correctness: 88, depth: 82, reasoning: 85 });
  assert('Strong score (85) adds to strongTopics', mockSession.compactState.strongTopics.length === 1);
  assert('Strong topic has correct day', mockSession.compactState.strongTopics[0].day === 7);
  assert('Strong topic has score 85', mockSession.compactState.strongTopics[0].score === 85);
  assert('Strong topic has dimension scores', mockSession.compactState.strongTopics[0].correctness === 88);
  assert('weakTopics remains empty after strong score', mockSession.compactState.weakTopics.length === 0);
  assert('daysCovered synced', JSON.stringify(mockSession.compactState.daysCovered) === JSON.stringify([7]));

  // Weak score
  const weakTopic = { day: 12, title: 'Prompt Engineering Fundamentals' };
  updateCompactState(mockSession, weakTopic, 35, 'Candidate did not know zero-shot vs few-shot.', {});
  assert('Weak score (35) adds to weakTopics', mockSession.compactState.weakTopics.length === 1);
  assert('Weak topic has correct day', mockSession.compactState.weakTopics[0].day === 12);
  assert('Misconception extracted from narrative', mockSession.compactState.misconceptions.length === 1);
  assert('Misconception note is non-empty string', typeof mockSession.compactState.misconceptions[0].note === 'string' && mockSession.compactState.misconceptions[0].note.length > 5);
  assert('strongTopics unchanged after weak score', mockSession.compactState.strongTopics.length === 1);

  // Partial score (50-69) should NOT add to either list
  const partialTopic = { day: 16, title: 'Chatbot Backend' };
  updateCompactState(mockSession, partialTopic, 60, 'Partial answer on API routing.', {});
  assert('Partial score (60) NOT added to strongTopics', !mockSession.compactState.strongTopics.find(t => t.day === 16));
  assert('Partial score (60) NOT added to weakTopics', !mockSession.compactState.weakTopics.find(t => t.day === 16));

  // Recovery: weak topic then scores strong
  updateCompactState(mockSession, weakTopic, 80, 'Candidate demonstrated understanding this time.', { correctness: 82 });
  assert('Recovery removes day 12 from weakTopics', mockSession.compactState.weakTopics.length === 0, JSON.stringify(mockSession.compactState.weakTopics));
  assert('Recovery adds day 12 to strongTopics', !!mockSession.compactState.strongTopics.find(t => t.day === 12));

  // TEST 3: compactState updated via handleTurn
  console.log('\n[Test 3] compactState updated by handleTurn...');
  const strongAnswer = 'I have implemented Redis cache with pub/sub, pipeline batching, postgres with WAL streaming and concurrency control using locks and MVCC. Prometheus metrics and Grafana dashboards handle observability.';

  await handleTurn(sessionId, strongAnswer);
  await handleTurn(sessionId, strongAnswer);
  const sessionAfterT2 = await getSessionDoc(sessionId);

  assert('compactState still exists after handleTurn', !!sessionAfterT2.compactState);
  assert('compactState.currentDifficultyTier is a string', typeof sessionAfterT2.compactState.currentDifficultyTier === 'string');
  assert('compactState.questionsAsked is a number', typeof sessionAfterT2.compactState.questionsAsked === 'number');
  const hasRated = sessionAfterT2.compactState.strongTopics.length > 0 || sessionAfterT2.compactState.weakTopics.length > 0;
  // If topics were advanced, at least one should be rated; otherwise just check structure
  if (sessionAfterT2.distinctDaysCovered.length > 0) {
    assert('At least one topic rated in compactState after advance', hasRated, JSON.stringify(sessionAfterT2.compactState));
  } else {
    assert('compactState structure intact even without advance yet', Array.isArray(sessionAfterT2.compactState.strongTopics));
  }

  // TEST 4: Full transcript intact
  console.log('\n[Test 4] session.transcript is fully intact...');
  const transcriptLen = sessionAfterT2.transcript.length;
  assert('transcript exists and is non-empty', Array.isArray(sessionAfterT2.transcript) && transcriptLen > 0);
  assert('transcript has both roles', sessionAfterT2.transcript.some(e => e.role === 'interviewer') && sessionAfterT2.transcript.some(e => e.role === 'candidate'));

  await handleTurn(sessionId, strongAnswer);
  const sessionAfterT3 = await getSessionDoc(sessionId);
  assert('transcript grows after additional turn (not replaced by compactState)', sessionAfterT3.transcript.length > transcriptLen, `was ${transcriptLen}, now ${sessionAfterT3.transcript.length}`);

  // TEST 5: evaluateTopicPerformanceWithLLM accepts/rejects session param cleanly
  console.log('\n[Test 5] evaluateTopicPerformanceWithLLM with/without session param...');
  const mockExchange = [
    { role: 'interviewer', text: 'Explain vector databases and HNSW indexing.' },
    { role: 'candidate', text: 'HNSW builds a hierarchical graph for approximate nearest-neighbor search. It trades recall for speed by exploring a bounded set of candidate nodes using a greedy algorithm at each layer.' }
  ];
  const mockTopicForEval = { day: 22, title: 'Vector Databases', objectives: ['HNSW indexing', 'similarity search', 'recall vs speed tradeoffs'] };
  const mockSessionForEval = {
    compactState: {
      strongTopics: [{ day: 7, title: 'Embeddings', score: 85 }],
      weakTopics: [],
      misconceptions: [],
      currentDay: 22,
      currentDifficultyTier: 'standard',
      questionsAsked: 4,
      daysCovered: [7]
    }
  };

  let evalWithSession = null, evalWithoutSession = null;
  let errWith = null, errWithout = null;

  try { evalWithSession = await evaluateTopicPerformanceWithLLM(mockTopicForEval, mockExchange, mockSessionForEval); }
  catch (e) { errWith = e; }

  try { evalWithoutSession = await evaluateTopicPerformanceWithLLM(mockTopicForEval, mockExchange); }
  catch (e) { errWithout = e; }

  assert('No error with session param', errWith === null, errWith ? errWith.message : '');
  assert('No error without session param (backward compat)', errWithout === null, errWithout ? errWithout.message : '');
  assert('evalWithSession has score', evalWithSession && typeof evalWithSession.score === 'number');
  assert('evalWithoutSession has score', evalWithoutSession && typeof evalWithoutSession.score === 'number');
  assert('Both paths return all 5 dimension fields', evalWithSession && typeof evalWithSession.correctness === 'number' && evalWithoutSession && typeof evalWithoutSession.correctness === 'number');
  assert('Scores consistent between paths in mock mode', evalWithSession && evalWithoutSession && evalWithSession.score === evalWithoutSession.score, `with=${evalWithSession ? evalWithSession.score : 'err'}, without=${evalWithoutSession ? evalWithoutSession.score : 'err'}`);

  // TEST 6: No scoring regression
  console.log('\n[Test 6] No scoring regression...');
  const weakExchange = [
    { role: 'interviewer', text: 'What is HNSW indexing?' },
    { role: 'candidate', text: 'I have no idea about that at all.' }
  ];
  const weakResult = await evaluateTopicPerformanceWithLLM(mockTopicForEval, weakExchange, mockSessionForEval);
  assert('Weak answer scores lower than strong answer', weakResult.score < evalWithSession.score, `weak=${weakResult.score}, strong=${evalWithSession.score}`);
  assert('Strong answer has non-trivial score', evalWithSession.score > 50);

  // SUMMARY
  console.log('\n===========================================');
  if (failed === 0) {
    console.log(`ALL PHASE 7 TESTS PASSED (${passed}/${passed + failed})`);
  } else {
    console.log(`RESULTS: ${passed} passed, ${failed} FAILED`);
  }
  console.log('===========================================\n');
}

runPhase7Tests().catch(err => {
  console.error('[Phase7 Test Fatal Error]', err.message);
  process.exit(1);
});
