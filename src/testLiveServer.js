async function testLiveServer() {
  console.log('--- TESTING LIVE SERVER ON LOCALHOST:3000 ---');

  // 1. Check /api/candidates
  const candRes = await fetch('http://localhost:3000/api/candidates');
  if (!candRes.ok) throw new Error(`Failed to fetch candidates: ${candRes.status}`);
  const candidates = await candRes.json();
  console.log(`[PASS] Connected to http://localhost:3000 - Loaded ${candidates.length} candidates.`);

  const candidate = candidates[0];
  const sessionId = `live-verification-${Date.now()}`;

  // 2. Start an Interview session
  console.log(`\nStarting session "${sessionId}" for candidate "${candidate.member?.name || 'Test'}"...`);
  const startRes = await fetch('http://localhost:3000/api/interview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      candidate
    })
  });
  if (!startRes.ok) throw new Error(`Failed to start interview: ${startRes.status}`);
  const startData = await startRes.json();
  console.log('[PASS] Interview Session Initialized!');
  console.log(`  - First AI Question: "${startData.reply.substring(0, 80)}..."`);
  console.log(`  - Target Question Count: ${startData.targetQuestionCount || 'configured'}`);

  // 3. Submit a candidate turn to verify live AI evaluation & follow-up
  console.log('\nSubmitting candidate answer to verify live AI response pipeline...');
  const turnRes = await fetch('http://localhost:3000/api/interview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      message: "I implemented a microservice pipeline using Kafka for stream ingestion and PostgreSQL for transactional storage, with Prometheus monitoring."
    })
  });
  if (!turnRes.ok) throw new Error(`Turn request failed: ${turnRes.status}`);
  const turnData = await turnRes.json();
  console.log('[PASS] Live AI Response Received:');
  console.log(`  - Evaluated Difficulty Tier: ${turnData.difficultyTier}`);
  console.log(`  - Next AI Question / Followup: "${turnData.reply.substring(0, 100)}..."`);
  console.log(`  - Questions Asked: ${turnData.questionsAsked}`);
  console.log(`  - Done Status: ${turnData.done}`);

  console.log('\n>>> SUCCESS: Localhost server and AI are LIVE and fully functional! <<<');
}

testLiveServer().catch(err => {
  console.error('[FAIL] Live server test failed:', err);
  process.exit(1);
});
