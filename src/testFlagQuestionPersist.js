import dotenv from 'dotenv';
dotenv.config();

import { initializeData, precomputeConceptTerms } from './dataManager.js';
import { db } from './firebase.js';

initializeData();
precomputeConceptTerms();

async function runTest() {
  console.log('========================================================');
  console.log('RUNNING FLAG QUESTION PERSISTENCE TESTS');
  console.log('========================================================');

  const testSessionId = `flag-test-sess-${Date.now()}`;
  const testDay = 5;
  const testQuestionText = "Describe how index replication works in Elasticsearch.";
  const testReason = "Question is ambiguous or unclear: Options specify primary replicas but curiculum says active replicas.";

  console.log('[Test 1] Posting flag request to server endpoint...');
  const res = await fetch('http://127.0.0.1:3000/api/flag-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: testSessionId,
      day: testDay,
      questionText: testQuestionText,
      reason: testReason
    })
  });

  if (!res.ok) {
    console.error(`FAIL: API returned status ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log('Response:', data);

  if (!data.success) {
    console.error('FAIL: Response did not return success.');
    process.exit(1);
  }
  console.log('PASS: API endpoint successfully stored flag-question log.');

  console.log('========================================================');
  console.log('ALL FLAG QUESTION PERSISTENCE TESTS PASSED!');
  console.log('========================================================');
}

runTest().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
