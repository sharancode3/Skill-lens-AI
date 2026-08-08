import { createSession, handleTurn, endSessionEarly } from './sessionManager.js';
import { generateFeedbackReport, generateMechanicalFeedback } from './llmClient.js';
import { initializeData, candidatesById } from './dataManager.js';

async function runTests() {
  console.log('--- STARTING PHASE 13 PART A VALIDATION TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  initializeData();
  const candidates = Array.from(candidatesById.values());
  const candidate = candidates[0];

  // Test 1: Mechanical Fallback Feedback Shape
  console.log('\n[Test 1] Validating Mechanical Fallback Feedback Object Shape...');
  const mockSession = {
    sessionId: `test-p13a-mech-${Date.now()}`,
    candidateSnapshot: candidate,
    topicQueue: [
      { day: 1, title: 'Network Fundamentals', status: 'asked' },
      { day: 2, title: 'OS & Concurrency', status: 'pending' }
    ],
    transcript: [
      { role: 'interviewer', day: 1, text: 'Explain TCP vs UDP.' },
      { role: 'candidate', day: 1, text: 'TCP is connection oriented and reliable.', classification: 'strong' }
    ],
    accuracyLog: [
      {
        day: 1,
        title: 'Network Fundamentals',
        candidateAnswer: 'TCP is connection oriented and reliable.',
        finalAccuracyScore: 85,
        reasoning: 'Good technical clarity.',
        correctness: 85,
        depth: 80,
        reasoningScore: 85,
        tradeoffs: 75,
        clarity: 90
      }
    ]
  };

  const mechReport = generateMechanicalFeedback(mockSession);
  assert(mechReport && typeof mechReport === 'object', 'Mechanical feedback report returned an object');
  assert(mechReport.feedback && typeof mechReport.feedback === 'object', 'Report contains feedback object');
  assert(typeof mechReport.feedback.summary === 'string' && mechReport.feedback.summary.length > 0, 'Feedback summary is a non-empty string');
  assert(Array.isArray(mechReport.feedback.strengths) && mechReport.feedback.strengths.length > 0, 'Feedback strengths is a non-empty array');
  assert(Array.isArray(mechReport.feedback.gaps) && mechReport.feedback.gaps.length > 0, 'Feedback gaps is a non-empty array');
  assert(Array.isArray(mechReport.feedback.next) && mechReport.feedback.next.length >= 3, 'Feedback next is an array with at least 3 recommendations');

  // Test 2: Full Interview End Session Early Terminal Contract
  console.log('\n[Test 2] Validating Terminal Response from endSessionEarly...');
  const earlySessionId = `test-p13a-early-${Date.now()}`;
  await createSession(earlySessionId, candidate);
  const endEarlyRes = await endSessionEarly(earlySessionId);

  assert(endEarlyRes.done === true, 'Terminal response done property is true');
  assert(typeof endEarlyRes.reply === 'string', 'Terminal response contains reply string');
  assert(endEarlyRes.feedback && typeof endEarlyRes.feedback === 'object', 'Terminal response contains feedback object');
  assert(typeof endEarlyRes.feedback.summary === 'string' && endEarlyRes.feedback.summary.length > 0, 'Feedback summary is a non-empty string');
  assert(Array.isArray(endEarlyRes.feedback.strengths), 'Feedback strengths is an array');
  assert(Array.isArray(endEarlyRes.feedback.gaps), 'Feedback gaps is an array');
  assert(Array.isArray(endEarlyRes.feedback.next) && endEarlyRes.feedback.next.length > 0, 'Feedback next is a non-empty array');

  console.log(`\n=== RESULTS: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution crashed:', err);
  process.exit(1);
});
