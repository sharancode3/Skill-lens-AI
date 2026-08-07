import { initializeData, candidatesById } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { createSession, handleTurn } from './sessionManager.js';

async function runTests() {
  console.log('=======================================');
  console.log('STARTING INTEGRATED INTEL/LLM LAYER TESTS');
  console.log('=======================================\n');

  // Initialize loaders and embeds
  initializeData();
  await generateEmbeddings();

  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-llm-session-${Date.now()}`;

  console.log(`Candidate: ${candidate.member.name} (${candidateId})`);
  console.log(`Session ID: ${sessionId}\n`);

  // 1. Start Session
  console.log('>>> 1. Creating Session (Expect initial question for Day 29)...');
  const startRes = await createSession(sessionId, candidate);
  console.log('Start Reply:', startRes.reply);
  console.log('-------------------------------------------------------\n');

  // 2. Turn 1: Detailed answer (Expect "strong" -> "advance")
  console.log('>>> 2. Sending detailed response (Day 29 - Observability)...');
  const detailedAnswer = 'I always configure structured JSON logging using Winston or Bunyan in Node.js. For correlation, we generate a unique transaction ID and inject it into the request headers. We store logs in Elasticsearch and trace errors using correlation ID filters to keep debug metrics clear.';
  console.log(`Answer: "${detailedAnswer}"`);
  
  const turn1Res = await handleTurn(sessionId, detailedAnswer);
  console.log('Turn 1 Reply:', turn1Res.reply);
  console.log('Turn 1 done:', turn1Res.done);
  console.log('-------------------------------------------------------\n');

  // 3. Turn 2: Vague answer (Expect "shallow" -> "followup")
  console.log('>>> 3. Sending shallow response (Day 12 - Prompt Engineering)...');
  const shallowAnswer = 'I just write standard system prompts and ask the model to do a good job.';
  console.log(`Answer: "${shallowAnswer}"`);

  const turn2Res = await handleTurn(sessionId, shallowAnswer);
  console.log('Turn 2 Reply:', turn2Res.reply);
  console.log('Turn 2 done:', turn2Res.done);
  console.log('-------------------------------------------------------\n');

  // 4. Turn 3: Answer to follow-up (Expect "shallow"/"partial" -> but MUST override to "advance" because of follow-up cap)
  console.log('>>> 4. Sending answer to follow-up (Expect follow-up cap override -> ADVANCE to Day 28)...');
  const followUpAnswer = 'Yes, that is correct.';
  console.log(`Answer: "${followUpAnswer}"`);

  const turn3Res = await handleTurn(sessionId, followUpAnswer);
  console.log('Turn 3 Reply:', turn3Res.reply);
  console.log('Turn 3 done:', turn3Res.done);
  console.log('-------------------------------------------------------\n');

  // 5. Turn 4: Short response to follow-up (Expect follow-up cap override -> ADVANCE to Day 7)
  console.log('>>> 5. Sending short response to follow-up (Expect follow-up cap override -> ADVANCE to Day 7)...');
  const shortOverrideAnswer = 'Yes.';
  console.log(`Answer: "${shortOverrideAnswer}"`);

  const turn4Res = await handleTurn(sessionId, shortOverrideAnswer);
  console.log('Turn 4 Reply:', turn4Res.reply);
  console.log('Turn 4 done:', turn4Res.done);
  console.log('-------------------------------------------------------\n');

  // 6. Turn 5: Answer triggering connection detection (Current topic is Day 7 - Embeddings. Candidate mentions container scaling/K8s (Day 28) in the answer)
  console.log('>>> 6. Sending response triggering connection detection (Day 7 - Embeddings)...');
  const connectionAnswer = 'For embeddings, we use Qwen to compute similarities. I also deploy containerized backends on Docker and scale pods with Kubernetes clusters.';
  console.log(`Answer: "${connectionAnswer}"`);

  const turn5Res = await handleTurn(sessionId, connectionAnswer);
  console.log('Turn 5 Reply:', turn5Res.reply);
  console.log('Turn 5 done:', turn5Res.done);
  console.log('-------------------------------------------------------\n');

  console.log('=======================================');
  console.log('INTEGRATED INTEL/LLM LAYER TESTS COMPLETE');
  console.log('=======================================\n');
}


runTests().catch(err => {
  console.error('Test run failed:', err);
});
