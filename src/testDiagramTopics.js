import { initializeData, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { createSession, handleTurn, getSessionDoc, saveSessionDoc } from './sessionManager.js';

async function run() {
  console.log("=======================================");
  console.log("STARTING DIAGRAM SPECIFICITY TESTS");
  console.log("=======================================");

  // Initialize data loaders
  initializeData();
  await generateEmbeddings();
  await precomputeConceptTerms();

  // Create a new session
  const candidateId = 'CAND-001';
  const candidate = candidatesById.get(candidateId);
  const sessionId = `test-diagram-${Date.now()}`;
  await createSession(sessionId, candidate);

  // We want to simulate diagram questions for 5 different turns
  process.env.SIMULATE_LLM_OUTAGE = 'true';

  for (let cursor = 0; cursor < 5; cursor++) {
    // Reload sessionDoc each time because it gets updated and saved in handleTurn
    const session = await getSessionDoc(sessionId);
    session.cursor = cursor;
    session.nextQuestionType = 'diagram_interpret';
    session.pendingQuestionType = 'diagram_interpret';
    await saveSessionDoc(sessionId, session);

    const currentTopic = session.topicQueue[cursor];
    const targetTopic = session.topicQueue[cursor + 1] || currentTopic;
    
    console.log(`\nTesting Topic Day ${currentTopic.day} ("${currentTopic.title}") -> Target Topic Day ${targetTopic.day} ("${targetTopic.title}")`);

    // Determine the expected keyword based on target topic title
    const titleLower = targetTopic.title.toLowerCase();
    let expectedKeyword = '';
    if (titleLower.includes('embedding')) expectedKeyword = 'embedding';
    else if (titleLower.includes('vector')) expectedKeyword = 'vector';
    else if (titleLower.includes('observability') || titleLower.includes('logging') || titleLower.includes('monitoring')) expectedKeyword = 'lock';
    else if (titleLower.includes('docker') || titleLower.includes('kubernetes')) expectedKeyword = 'pod';
    else if (titleLower.includes('prompt')) expectedKeyword = 'weight';
    else expectedKeyword = 'polling';

    // Submit a mock response to trigger the next turn generation
    const res = await handleTurn(sessionId, "Here is my answer to the previous question.");
    
    console.log(`  Generated Diagram Definition:`);
    console.log(`    ${res.reply}`);
    console.log(`    ${res.diagramDefinition.replace(/\n/g, '\n    ')}`);
    console.log(`  Critique Question:`);
    console.log(`    ${res.diagramQuestionText}`);

    // Verify it contains the expected topic-specific keywords
    const flowLower = res.diagramDefinition.toLowerCase();
    const matchesExpected = flowLower.includes(expectedKeyword) || res.diagramQuestionText.toLowerCase().includes(expectedKeyword);
    
    if (matchesExpected) {
      console.log(`  [VERIFICATION] Matches expected keyword/term "${expectedKeyword}": PASS`);
    } else {
      console.log(`  [VERIFICATION] Matches expected keyword/term "${expectedKeyword}": FAIL`);
      process.exit(1);
    }
  }

  console.log("\n=======================================");
  console.log("DIAGRAM SPECIFICITY TESTS COMPLETE - ALL PASS");
  console.log("=======================================");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
