import dotenv from 'dotenv';
import { generateLocalLoRAReply, evaluateTurnWithLLM } from './llmClient.js';

dotenv.config();

async function runLoRAFallbackTests() {
  console.log('=======================================');
  console.log('TESTING LORA MODEL SWAP-IN & FALLBACK');
  console.log('=======================================');

  // 1. Test generateLocalLoRAReply timeout/offline resilience
  console.log('\n>>> 1. Testing Local Model Fetch with Unreachable Endpoint...');
  const fakeSystemPrompt = 'You are a technical interviewer.';
  const fakeUserPrompt = 'Classification: strong\nCandidate Answer: I use Docker for isolation.';
  
  // Pointing to a dummy port to simulate offline Ollama
  process.env.QWEN_API_URL = 'http://localhost:59999/v1';
  const start = Date.now();
  const res = await generateLocalLoRAReply(fakeSystemPrompt, fakeUserPrompt);
  const elapsed = Date.now() - start;

  console.log(`Fallback Result: ${res}`);
  console.log(`Elapsed Time: ${elapsed}ms (Expected <= 3500ms timeout)`);
  if (res === null && elapsed <= 4000) {
    console.log('PASS: Local model error safely caught and returned null for fallback.');
  } else {
    console.log('FAIL: Local model did not handle outage properly.');
  }

  // 2. Test evaluateTurnWithLLM Integration with ENABLE_LORA_REPLY=true
  console.log('\n>>> 2. Testing evaluateTurnWithLLM with ENABLE_LORA_REPLY=true...');
  process.env.ENABLE_LORA_REPLY = 'true';
  
  const mockTopic = { day: 12, title: 'Prompt Engineering Fundamentals', objectives: ['Zero-shot', 'Few-shot'] };
  const mockSession = {
    sessionId: 'test-lora-session',
    candidateSnapshot: { name: 'Sarah Johnson', jobRole: 'Backend Engineer' },
    cursor: 0,
    topicQueue: [mockTopic],
    followupCountForCurrentTopic: 0,
    transcript: [{ role: 'interviewer', text: 'Tell me about prompt engineering.' }],
    distinctDaysCovered: [12],
    questionsAsked: 1,
    difficultyTier: 'standard',
    pendingQuestionType: 'open'
  };
  
  const turnResult = await evaluateTurnWithLLM(
    mockSession,
    'I use few-shot examples for structured JSON extraction.',
    []
  );

  console.log('\nTurn Evaluation Completed:');
  console.log(`  Classification: ${turnResult.classification}`);
  console.log(`  Reaction Clause: "${turnResult.reactionClause || 'N/A'}"`);
  console.log(`  Final Reply: "${turnResult.reply}"`);
  console.log(`  Action: ${turnResult.action}`);

  if (turnResult && turnResult.reply && turnResult.classification) {
    console.log('\nPASS: Full interview turn evaluated successfully despite local LoRA outage!');
  } else {
    console.log('\nFAIL: Turn evaluation broke during local LoRA outage.');
  }

  console.log('\n=======================================');
  console.log('LORA FALLBACK TESTS COMPLETE');
  console.log('=======================================');
}

runLoRAFallbackTests().catch(console.error);
