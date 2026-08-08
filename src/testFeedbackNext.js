import { createSession, handleTurn, getSessionDoc } from './sessionManager.js';
import { initializeData, getCandidateById } from './dataManager.js';
import { generateFeedbackReport } from './llmClient.js';

process.env.SIMULATE_LLM_OUTAGE = 'true';

async function testFeedback() {
  await initializeData();
  const candidate = getCandidateById('CAND-001');
  const sessionId = `test-feedback-${Date.now()}`;
  await createSession(sessionId, candidate);

  // Run 8 turns to meet floor
  for (let i = 0; i < 8; i++) {
    await handleTurn(sessionId, "I used pandas and sqlite with database locks.");
  }

  const session = await getSessionDoc(sessionId);
  const report = await generateFeedbackReport(session);
  console.log('\n=== GENERATED FEEDBACK REPORT ===');
  console.log('Summary:', report.feedback.summary);
  console.log('Strengths (count):', report.feedback.strengths.length);
  console.log('Gaps (count):', report.feedback.gaps.length);
  console.log('Next Steps (count):', report.feedback.next.length);
  console.log('Next Steps Items:');
  report.feedback.next.forEach((item, idx) => {
    console.log(`  ${idx + 1}. "${item}"`);
  });
}

testFeedback().catch(console.error);
