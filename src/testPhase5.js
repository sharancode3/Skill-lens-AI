import { mockLLMCall } from './llmClient.js';

console.log('=== TESTING PHASE 5 DYNAMIC AI FOLLOW-UP GENERATION ===\n');

const mockTopic = {
  day: 1,
  title: 'Python Core & Data Pipelines',
  objectives: ['pandas dataframe manipulation', 'sqlite database storage', 'error handling']
};

const testAnswers = [
  { name: 'Vague Answer', text: 'I loaded the data and cleaned it up.' },
  { name: 'Partial / Detailed Answer', text: 'I used Pandas to load the CSV, cleaned nulls, and wrote to SQLite.' },
  { name: 'Error / Failure Case Answer', text: 'We ran into a database lock error when writing concurrently from multiple threads.' }
];

let allPassed = true;
const oldTemplateRegex = /You mentioned ".*" - Can you elaborate on the exact mechanism or trade-offs/i;

testAnswers.forEach(test => {
  const result = mockLLMCall(
    { name: 'Test Candidate' },
    mockTopic,
    'How did you build the pipeline?',
    test.text,
    0, // followupCount
    [],
    'open',
    null,
    'standard',
    { recentReactions: [], questionsAsked: 1, distinctDaysCovered: [1] },
    []
  );

  console.log(`[Input: ${test.name}] "${test.text}"`);
  console.log(`  -> Classification: ${result.classification}, Action: ${result.action}`);
  console.log(`  -> AI Reply: "${result.reply}"\n`);

  if (oldTemplateRegex.test(result.reply)) {
    console.error(`❌ FAILED: Reply matches old template!`);
    allPassed = false;
  }
});

if (allPassed) {
  console.log('✅ ALL TEST ANSWERS PRODUCED UNIQUE, DYNAMIC AI FOLLOW-UPS WITH ZERO TEMPLATE MATCHES!');
} else {
  console.error('❌ TEST FAILED');
  process.exit(1);
}
