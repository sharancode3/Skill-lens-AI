import { initializeData, getCandidateById } from './dataManager.js';
import { createSession, handleTurn, getSessionDoc } from './sessionManager.js';

// Setup environment and database fallback
process.env.GEMINI_API_KEY = ''; // Force offline mode initially

async function runHardeningTests() {
  console.log('=======================================');
  console.log('STARTING PHASE 9 HARDENING & EDGE CASE TESTS');
  console.log('=======================================');

  // Initialize synchronous curriculum data structures
  initializeData();

  const candidateId = 'CAND-001';
  const candidate = getCandidateById(candidateId);
  const sessionId = `hardening-test-session-${Date.now()}`;

  // 1. Create Session
  console.log(`\n>>> 1. Creating Session (ID: ${sessionId})...`);
  const startRes = await createSession(sessionId, candidate);
  console.log(`Initial Question: ${startRes.reply}`);

  // ==================== EDGE CASE 1: EMPTY/WHITESPACE MESSAGES ====================
  console.log('\n--- Test Case 1: Empty/Whitespace Re-prompts & Forced Advance ---');
  
  // Empty message 1
  console.log('Sending first empty response: ""');
  const resEmpty1 = await handleTurn(sessionId, '   ');
  console.log(`Interviewer Reply: "${resEmpty1.reply}"`);
  console.log(`Questions Asked: ${resEmpty1.questionsAsked}, Action: ${resEmpty1.action}`);
  
  // Empty message 2
  console.log('Sending second empty response: ""');
  const resEmpty2 = await handleTurn(sessionId, '');
  console.log(`Interviewer Reply: "${resEmpty2.reply}"`);
  console.log(`Questions Asked: ${resEmpty2.questionsAsked}, Action: ${resEmpty2.action}`);

  // Empty message 3 (Should force advance now!)
  console.log('Sending third empty response: "" (Expect Forced Advance to Day 12)');
  const resEmpty3 = await handleTurn(sessionId, ' ');
  console.log(`Interviewer Reply: "${resEmpty3.reply}"`);
  console.log(`Questions Asked: ${resEmpty3.questionsAsked}, Action: ${resEmpty3.action}`);

  // ==================== EDGE CASE 2: DUPLICATE SUBMIT PREVENTIONS ====================
  console.log('\n--- Test Case 2: Duplicate Submit Check ---');
  
  const textMsg = 'I use Prometheus to count request metrics.';
  console.log(`Sending message: "${textMsg}"`);
  const resOrig = await handleTurn(sessionId, textMsg);
  console.log(`Original Reply: "${resOrig.reply}"`);

  console.log('Sending identical duplicate message immediately (Expect Cached Hit):');
  const resDuplicate = await handleTurn(sessionId, textMsg);
  console.log(`Duplicate Reply (Cached): "${resDuplicate.reply}"`);
  
  // Check if they match
  if (resOrig.reply === resDuplicate.reply) {
    console.log('✔ Idempotency Check Passed: Identical cached response returned.');
  } else {
    console.error('❌ Idempotency Check Failed: Different response returned for duplicate input.');
  }

  // ==================== EDGE CASE 3: TEXT CONTEXT TRUNCATION ====================
  console.log('\n--- Test Case 3: Very Long Message Truncation ---');
  
  // Construct 350-word message
  const wordBase = 'data ';
  const longText = wordBase.repeat(350) + 'observability';
  console.log(`Sending 350-word response. Full length: ${longText.length} characters.`);
  
  await handleTurn(sessionId, longText);
  
  // Retrieve session document and verify transcript has full text
  const savedDoc = await getSessionDoc(sessionId);
  const lastCandidateTurn = savedDoc.transcript[savedDoc.transcript.length - 2]; // message before interviewer advanced
  console.log(`Stored Transcript length: ${lastCandidateTurn.text.length} chars.`);
  if (lastCandidateTurn.text.includes('observability') && lastCandidateTurn.text.length > 1500) {
    console.log('✔ Stored Transcript Check Passed: Full untruncated message preserved.');
  } else {
    console.error('❌ Stored Transcript Check Failed: Transcript was truncated.');
  }

  // ==================== EDGE CASE 4: TOTAL LLM OUTAGE FALLBACK ====================
  console.log('\n--- Test Case 4: LLM Outage Fallback Simulation ---');
  
  // Enable Simulated Outage flag
  process.env.SIMULATE_LLM_OUTAGE = 'true';
  console.log('Set SIMULATE_LLM_OUTAGE = "true". Progressing remaining topics...');
  
  // Sarah Johnson topic queue:
  // Day 29 (completed via forced advance)
  // Day 12 (completed via duplicate test)
  // Day 28 (completed via long text test)
  // Current Cursor is at Day 7.
  let isDone = false;
  let turnNumber = 1;
  
  while (!isDone && turnNumber < 10) {
    const currentSession = await getSessionDoc(sessionId);
    const topic = currentSession.topicQueue[currentSession.cursor];
    console.log(`Processing Topic Day ${topic.day}: "${topic.title}"`);
    
    const turnRes = await handleTurn(sessionId, 'This is a mock answer satisfying requirements for turn ' + turnNumber);
    isDone = turnRes.done;
    
    if (isDone) {
      console.log('\n✔ Interview Completed via Fallback!');
      console.log('--- COMPOSER FALLBACK REPORT ---');
      console.log(`Summary: ${turnRes.feedback.summary}`);
      console.log('Strengths:', turnRes.feedback.strengths);
      console.log('Gaps:', turnRes.feedback.gaps);
      console.log('Next Steps:', turnRes.feedback.next);
    } else {
      console.log(`Interviewer: "${turnRes.reply}" (done: false)`);
    }
    
    turnNumber++;
  }
  
  console.log('\n=======================================');
  console.log('PHASE 9 HARDENING & EDGE CASE TESTS COMPLETE');
  console.log('=======================================');
}

runHardeningTests().catch(err => {
  console.error('Hardening tests failed with error:', err);
});
