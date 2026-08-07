import { initializeData, candidatesById } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { createSession, handleTurn, SessionState } from './sessionManager.js';
import { db } from './firebase.js';

async function runTest() {
  console.log('=======================================');
  console.log('STARTING SESSION STATE MACHINE TESTS');
  console.log('=======================================\n');

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-session-${Date.now()}`;

  console.log(`Candidate selected: ${candidate.member.name} (${candidateId})`);
  console.log(`Generated sessionId: ${sessionId}\n`);

  // 1. Test Session Creation
  console.log('>>> 1. Initializing Session...');
  const startResponse = await createSession(sessionId, candidate);
  console.log('Start Response:', startResponse);
  console.log('-------------------------------------------------------\n');

  // 2. Loop turns
  console.log('>>> 2. Simulating turns sequentially...');
  let turnResponse = startResponse;
  let turnNumber = 1;

  while (!turnResponse.done && turnNumber <= 15) {
    const answerMessage = `My experience on this topic is solid. I have built projects and dealt with typical challenges. (Turn ${turnNumber})`;
    console.log(`\n--- Sending Candidate Turn ${turnNumber} Answer ---`);
    console.log(`Answer: "${answerMessage}"`);

    turnResponse = await handleTurn(sessionId, answerMessage);
    console.log(`Interviewer Reply: "${turnResponse.reply}"`);
    console.log(`Interview status: done = ${turnResponse.done}`);
    
    if (turnResponse.done) {
      console.log('Feedback Received:', JSON.stringify(turnResponse.feedback, null, 2));
    }
    
    turnNumber++;
  }
  console.log('-------------------------------------------------------\n');

  // 3. Test Idempotency (11th/subsequent turn)
  console.log('>>> 3. Testing Idempotency (Sending additional messages after DONE state)...');
  const postDoneMessage = 'This is an extra message sent after completion.';
  
  // Call handleTurn again
  const firstIdempotencyCheck = await handleTurn(sessionId, postDoneMessage);
  console.log('First Idempotency Reply done status:', firstIdempotencyCheck.done);
  console.log('First Idempotency Feedback match:', JSON.stringify(firstIdempotencyCheck.feedback) === JSON.stringify(turnResponse.feedback) ? 'PASS' : 'FAIL');

  // Call handleTurn yet again
  const secondIdempotencyCheck = await handleTurn(sessionId, postDoneMessage + ' 2');
  console.log('Second Idempotency Reply done status:', secondIdempotencyCheck.done);
  console.log('Second Idempotency Feedback match:', JSON.stringify(secondIdempotencyCheck.feedback) === JSON.stringify(turnResponse.feedback) ? 'PASS' : 'FAIL');

  console.log('\n=======================================');
  console.log('SESSION STATE MACHINE TESTS COMPLETE');
  console.log('=======================================\n');
}

runTest().catch(err => {
  console.error('Test script crashed:', err);
});
