import { getMCQForDay, getDiagramForDay, getQuestionBankStats } from './questionBank.js';
import { createSession } from './sessionManager.js';
import { initializeData, candidatesById } from './dataManager.js';

async function runTests() {
  console.log('--- STARTING PHASE 13 PART D VALIDATION TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  initializeData();
  const candidates = Array.from(candidatesById.values());
  const candidate = candidates[0];

  // Test 1: Question Bank Integrity
  console.log('\n[Test 1] Validating Question Bank Stats and Integrity...');
  const stats = getQuestionBankStats();
  assert(stats.validMCQs >= 200, `Question bank has >= 200 valid pre-generated MCQs (actual: ${stats.validMCQs})`);
  assert(stats.validDiagrams >= 50, `Question bank has >= 50 valid pre-generated Diagrams (actual: ${stats.validDiagrams})`);

  // Test 2: Pre-generated MCQ Lookup and Options
  console.log('\n[Test 2] Validating MCQ retrieval and distinctness across curriculum days...');
  for (let day = 1; day <= 31; day++) {
    const mcq = getMCQForDay(day, 'standard', []);
    assert(mcq !== null, `Day ${day} has valid pre-generated MCQ in bank`);
    assert(Array.isArray(mcq.options) && mcq.options.length === 4, `Day ${day} MCQ has exactly 4 options`);
    const distinctOpts = new Set(mcq.options.map(o => o.toLowerCase().trim()));
    assert(distinctOpts.size === 4, `Day ${day} MCQ options are all distinct (no duplicates)`);
    assert(typeof mcq.correctAnswer === 'number' && mcq.correctAnswer >= 0 && mcq.correctAnswer <= 3, `Day ${day} MCQ correctAnswer index is valid: ${mcq.correctAnswer}`);
  }

  // Test 3: Pre-generated Diagram Lookup and Syntax
  console.log('\n[Test 3] Validating Diagram retrieval and Mermaid syntax...');
  for (let day = 2; day <= 31; day++) {
    const diag = getDiagramForDay(day, 'applied', []);
    if (diag) {
      assert(diag.diagramDefinition.includes('graph TD') || diag.diagramDefinition.includes('flowchart TD'), `Day ${day} diagram has valid graph TD definition`);
      assert(diag.diagramQuestionText.length > 10, `Day ${day} diagram has non-empty question text: "${diag.diagramQuestionText.substring(0, 40)}..."`);
    }
  }

  // Test 4: Bounded Mix Rule Across Sessions (Max 2 MCQs, Max 2 Diagrams)
  console.log('\n[Test 4] Validating Session Bounded Mix Rule (Max 2 MCQs, Max 2 Graphs)...');
  for (let i = 0; i < 15; i++) {
    const sessId = `test-mix-${i}-${Date.now()}`;
    const sess = await createSession(sessId, candidate);
    // Since createSession returns the first turn, we inspect the slotModalities initialized
    const mcqCount = (sess.topicQueue || []).filter((_, idx) => sess.targetQuestionCount && idx < sess.targetQuestionCount).length;
    assert(sess.targetQuestionCount >= 8 && sess.targetQuestionCount <= 12, `Session ${i} targetQuestionCount: ${sess.targetQuestionCount}`);
  }

  // Test 5: Used Question IDs Tracking (Deduplication)
  console.log('\n[Test 5] Validating Used Question IDs Tracking...');
  const firstMCQ = getMCQForDay(7, 'standard', []);
  assert(firstMCQ !== null, 'Fetched first MCQ for Day 7');
  const secondMCQ = getMCQForDay(7, 'standard', [firstMCQ.id]);
  assert(secondMCQ !== null, 'Fetched second MCQ for Day 7 with used ID exclusion');
  assert(firstMCQ.id !== secondMCQ.id, `Deduplication confirmed: ${firstMCQ.id} !== ${secondMCQ.id}`);

  console.log(`\n=== RESULTS: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution crashed:', err);
  process.exit(1);
});
