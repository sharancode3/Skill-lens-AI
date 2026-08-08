// testDeterministicPreFilter.js - Test suite for Conduct Pre-Filter Heuristics
import { checkDeterministicConduct } from './llmClient.js';

console.log('========================================================');
console.log('RUNNING DETERMINISTIC CONDUCT PRE-FILTER TESTS');
console.log('========================================================\n');

const testCases = [
  // 1. Empty / Whitespace
  { input: '', expected: 'non_answer', name: 'Empty string' },
  { input: '   ', expected: 'non_answer', name: 'Whitespace-only string' },

  // 2. Short Dismissives
  { input: 'idk', expected: 'non_answer', name: 'Exact idk' },
  { input: 'idk.', expected: 'non_answer', name: 'idk with punctuation' },
  { input: 'skip', expected: 'non_answer', name: 'Exact skip' },
  { input: 'pass!', expected: 'non_answer', name: 'pass with punctuation' },
  { input: 'no', expected: 'non_answer', name: 'no' },
  { input: 'i don\'t know', expected: 'non_answer', name: "i don't know" },

  // 3. Disrespectful phrases
  { input: 'do has u like', expected: 'disrespectful', name: 'do has u like' },
  { input: 'shut up', expected: 'disrespectful', name: 'shut up' },
  { input: 'whatever', expected: 'disrespectful', name: 'whatever' },

  // 4. Keyboard Mashing / Gibberish
  { input: 'sdfsdf', expected: 'off_topic', name: 'Keyboard mashing (sdfsdf)' },
  { input: 'qwertyuiop', expected: 'off_topic', name: 'Extremely low vowels ratio' },
  { input: 'aaaa', expected: 'off_topic', name: 'High single letter repetition' },

  // 5. Fallthrough: Genuine attempts
  { input: 'I configured SQLite with connection pools to optimize write lock latency.', expected: null, name: 'Strong technical attempt' },
  { input: 'Maybe we should use memory-mapped databases for low latency.', expected: null, name: 'Genuine technical answer with hedges' },
  { input: 'The system has standard routing tables.', expected: null, name: 'Short but clean standard attempt' }
];

let failed = false;

testCases.forEach((tc, idx) => {
  const result = checkDeterministicConduct(tc.input);
  const actualClass = result ? result.classification : null;
  
  if (actualClass !== tc.expected) {
    console.error(`FAIL [Test ${idx + 1} - ${tc.name}]: Input "${tc.input}" -> Expected: ${tc.expected}, Got: ${actualClass}`);
    failed = true;
  } else {
    console.log(`PASS [Test ${idx + 1} - ${tc.name}]: Input "${tc.input}" -> Classification: ${actualClass} (${result ? result.reasoning : 'Falls through to LLM'})`);
  }
});

if (failed) {
  console.log('\n========================================================');
  console.log('FAIL: Some deterministic pre-filter assertions failed!');
  console.log('========================================================');
  process.exit(1);
} else {
  console.log('\n========================================================');
  console.log('SUCCESS: All deterministic pre-filter assertions passed!');
  console.log('========================================================');
}
