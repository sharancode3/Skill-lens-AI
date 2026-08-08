import { createSession, handleTurn, getSessionDoc } from './sessionManager.js';
import { initializeData, getCandidateById } from './dataManager.js';

process.env.SIMULATE_LLM_OUTAGE = 'true';

async function testPhase8() {
  console.log('=== TESTING PHASE 8: NATURAL LAST QUESTION ANNOUNCEMENT ===\n');

  await initializeData();
  const closingPhrasesObserved = [];

  // Run 3 independent interview sessions to test varied phrasing
  for (let run = 1; run <= 3; run++) {
    const candidate = getCandidateById(`CAND-00${run}`);
    const sessionId = `test-phase8-run${run}-${Date.now()}`;
    const session = await createSession(sessionId, candidate);

    console.log(`--- Starting Run ${run} for ${candidate.member?.name || 'Candidate'} ---`);
    let lastInterviewerQuestion = '';

    // Conduct turns until wrap-up
    for (let turn = 1; turn <= 10; turn++) {
      const res = await handleTurn(sessionId, "I configured postgres connection pools, wal mode, and prometheus metrics.");
      if (res.done) {
        console.log(`Run ${run} completed on turn ${turn}.`);
        break;
      }
      lastInterviewerQuestion = res.reply;
    }

    console.log(`Run ${run} Final Question: "${lastInterviewerQuestion}"\n`);
    closingPhrasesObserved.push(lastInterviewerQuestion);
  }

  console.log('--- ALL OBSERVED FINAL QUESTIONS ---');
  closingPhrasesObserved.forEach((q, idx) => console.log(`[Run ${idx + 1}]: "${q}"`));

  // Suspension check: Ensure suspension doesn't output a "last question" announcement
  console.log('--- Checking Suspension Path (Should NOT output closing question) ---');
  const suspSessionId = `test-phase8-susp-${Date.now()}`;
  await createSession(suspSessionId, getCandidateById('CAND-001'));
  await handleTurn(suspSessionId, "idk");
  await handleTurn(suspSessionId, "how can i know");
  const suspRes = await handleTurn(suspSessionId, "do as you like");
  console.log(`Suspension reply: "${suspRes.reply}" (Suspended: ${suspRes.suspended})`);

  const suspHasClosingStem = suspRes.reply.includes('To wrap things up') || suspRes.reply.includes('Let\'s finish our review');

  console.log('\n=== VERIFICATION RESULTS ===');
  const validClosingKeywords = [
    'wrap things up',
    'finish our review',
    'concluding',
    'round out our technical discussion',
    'before we conclude',
    'final'
  ];

  const allHaveClosingSignals = closingPhrasesObserved.every(q => 
    validClosingKeywords.some(kw => q.toLowerCase().includes(kw))
  );

  const arePhrasesVaried = closingPhrasesObserved[0] !== closingPhrasesObserved[1] || closingPhrasesObserved[1] !== closingPhrasesObserved[2];

  console.log(`All completed interviews contain natural closing signals: ${allHaveClosingSignals ? 'PASS' : 'FAIL'}`);
  console.log(`Phrasing is varied across runs (not hardcoded static): ${arePhrasesVaried ? 'PASS' : 'FAIL'}`);
  console.log(`Suspension path avoids last question signal: ${!suspHasClosingStem ? 'PASS' : 'FAIL'}`);

  if (allHaveClosingSignals && arePhrasesVaried && !suspHasClosingStem) {
    console.log('\n✅ PHASE 8 ACCEPTANCE CRITERIA PASSED: Natural, varied final question announcements verified!');
  } else {
    console.error('\n❌ PHASE 8 FAILED.');
    process.exit(1);
  }
}

testPhase8().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
