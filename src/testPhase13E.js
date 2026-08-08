import { bankByDay, initQuestionBank, getMCQForDay, getDiagramForDay, getQuestionBankStats } from './questionBank.js';
import { initializeData } from './dataManager.js';

async function runTests() {
  console.log('--- STARTING PHASE 13 PART E VALIDATION TESTS ---');
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

  // Test 1: Nested Structure Verification
  console.log('\n[Test 1] Validating Nested In-Memory Index Structure bankByDay[day][type][difficulty]...');
  assert(typeof bankByDay === 'object' && bankByDay !== null, 'bankByDay is initialized in memory');
  
  for (let day = 1; day <= 31; day++) {
    const dayBucket = bankByDay[day];
    assert(dayBucket !== undefined, `Day ${day} bucket exists in bankByDay`);
    assert(dayBucket.mcq !== undefined, `Day ${day} has 'mcq' structure`);
    assert(Array.isArray(dayBucket.mcq.foundational), `Day ${day} has mcq.foundational array`);
    assert(Array.isArray(dayBucket.mcq.standard), `Day ${day} has mcq.standard array`);
    assert(Array.isArray(dayBucket.mcq.applied), `Day ${day} has mcq.applied array`);

    assert(dayBucket.diagram_interpret !== undefined, `Day ${day} has 'diagram_interpret' structure`);
    assert(Array.isArray(dayBucket.diagram_interpret.foundational), `Day ${day} has diagram_interpret.foundational array`);
    assert(Array.isArray(dayBucket.diagram_interpret.standard), `Day ${day} has diagram_interpret.standard array`);
    assert(Array.isArray(dayBucket.diagram_interpret.applied), `Day ${day} has diagram_interpret.applied array`);
  }

  // Test 2: Direct O(1) Sub-Millisecond Retrieval Benchmark
  console.log('\n[Test 2] Benchmarking Direct O(1) Lookup Performance (1,000 operations)...');
  const startTime = process.hrtime.bigint();
  const iterations = 1000;
  for (let i = 0; i < iterations; i++) {
    const targetDay = (i % 31) + 1;
    const diff = i % 2 === 0 ? 'standard' : 'applied';
    const mcq = getMCQForDay(targetDay, diff, []);
    const diag = getDiagramForDay(targetDay, diff, []);
  }
  const endTime = process.hrtime.bigint();
  const totalDurationMs = Number(endTime - startTime) / 1000000;
  const avgDurationMs = totalDurationMs / (iterations * 2);

  console.log(`  - 2,000 lookups completed in ${totalDurationMs.toFixed(3)} ms`);
  console.log(`  - Average lookup latency: ${(avgDurationMs * 1000).toFixed(3)} microseconds per query`);
  assert(avgDurationMs < 0.1, `Direct O(1) lookup average latency is sub-millisecond (< 0.1ms): ${avgDurationMs.toFixed(4)}ms`);

  // Test 3: Randomization & Variety Across Demo Runs
  console.log('\n[Test 3] Validating Random Item Selection across identical (day, difficulty) requests...');
  const pickedIds = new Set();
  for (let i = 0; i < 20; i++) {
    const item = getMCQForDay(12, 'standard', []);
    if (item) pickedIds.add(item.id);
  }
  assert(pickedIds.size > 1, `Observed randomized selection across repeated calls for Day 12 standard (distinct IDs: ${Array.from(pickedIds).join(', ')})`);

  // Test 4: Safe Exhaustion Fallback
  console.log('\n[Test 4] Validating Safe Handling on Exhaustion / Missing Keys...');
  const exhaustedItem = getMCQForDay(999, 'standard', []);
  assert(exhaustedItem === null, 'Out of bounds day returns null safely without exception');

  console.log(`\n=== RESULTS: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution crashed:', err);
  process.exit(1);
});
