import { createSession, handleTurn, getSessionDoc } from './sessionManager.js';
import { initializeData, getCandidateById } from './dataManager.js';

process.env.SIMULATE_LLM_OUTAGE = 'true';

async function testPhase5MCQ() {
  console.log('=== TESTING PHASE 5: MCQ REPETITION & SAFEGUARD CHECK ===\n');

  await initializeData();
  const candidate = getCandidateById('CAND-001');
  const sessionId = `test-mcq-phase5-${Date.now()}`;
  const session = await createSession(sessionId, candidate);

  // Set difficulty to foundational so MCQs trigger consecutively
  session.difficultyTier = 'foundational';
  session.pendingQuestionType = 'mcq';
  session.nextQuestionType = 'mcq';
  session.recentScores = [20, 20];

  const seenQuestions = [];
  const seenOptions = [];

  // Turn 1: Trigger first turn
  console.log('--- Turn 1: Initial turn ---');
  const r1 = await handleTurn(sessionId, "0");
  if (r1.mcqOptions) {
    seenQuestions.push(r1.reply);
    seenOptions.push(JSON.stringify(r1.mcqOptions));
  }

  // Turn 2
  console.log('\n--- Turn 2 ---');
  const r2 = await handleTurn(sessionId, "1");
  if (r2.mcqOptions) {
    seenQuestions.push(r2.reply);
    seenOptions.push(JSON.stringify(r2.mcqOptions));
  }

  // Turn 3: 1st MCQ generated
  console.log('\n--- Turn 3 ---');
  const r3 = await handleTurn(sessionId, "0");
  if (r3.mcqOptions) {
    console.log(`[Captured MCQ 1] Reply: "${r3.reply}"`);
    console.log(`[Captured MCQ 1 Options]:`, r3.mcqOptions);
    seenQuestions.push(r3.reply);
    seenOptions.push(JSON.stringify(r3.mcqOptions));
  }

  // Turn 4: Answer 1st MCQ -> 2nd MCQ generated
  console.log('\n--- Turn 4: Answering 1st MCQ (choice 2) ---');
  const r4 = await handleTurn(sessionId, "2");
  if (r4.mcqOptions) {
    console.log(`[Captured MCQ 2] Reply: "${r4.reply}"`);
    console.log(`[Captured MCQ 2 Options]:`, r4.mcqOptions);
    seenQuestions.push(r4.reply);
    seenOptions.push(JSON.stringify(r4.mcqOptions));
  }

  // Turn 5: Answer 2nd MCQ -> 3rd MCQ generated
  console.log('\n--- Turn 5: Answering 2nd MCQ (choice 1) ---');
  const r5 = await handleTurn(sessionId, "1");
  if (r5.mcqOptions) {
    console.log(`[Captured MCQ 3] Reply: "${r5.reply}"`);
    console.log(`[Captured MCQ 3 Options]:`, r5.mcqOptions);
    seenQuestions.push(r5.reply);
    seenOptions.push(JSON.stringify(r5.mcqOptions));
  }

  console.log('\n=== VERIFICATION RESULTS ===');
  console.log(`Total MCQ Questions Captured: ${seenQuestions.length}`);
  
  let duplicatesFound = false;
  for (let i = 0; i < seenQuestions.length - 1; i++) {
    const isDupQ = seenQuestions[i] === seenQuestions[i + 1];
    const isDupOpt = seenOptions[i] === seenOptions[i + 1];
    console.log(`MCQ ${i + 1} vs MCQ ${i + 2}: ${isDupQ || isDupOpt ? 'FAIL (Duplicate)' : 'PASS (Distinct)'}`);
    if (isDupQ || isDupOpt) duplicatesFound = true;
  }

  if (!duplicatesFound && seenQuestions.length >= 3) {
    console.log('\n✅ PHASE 5 MCQ ACCEPTANCE CRITERIA PASSED: All consecutive MCQ questions and option sets are unique!');
  } else {
    console.error('\n❌ PHASE 5 MCQ FAILED: Repetition or insufficient MCQ questions.');
    process.exit(1);
  }
}

testPhase5MCQ().catch(err => {
  console.error('Error running testPhase5MCQ:', err);
  process.exit(1);
});
