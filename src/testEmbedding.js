import { initializeData } from './dataManager.js';
import { generateEmbeddings, findRelatedDays, embeddingMode } from './embeddingManager.js';

async function runTests() {
  console.log('=======================================');
  console.log('STARTING SEMANTIC CONNECTION LAYER TESTS');
  console.log('=======================================\n');

  // 1. Initialize day maps & load JSONs
  initializeData();

  // 2. Generate embeddings (either API or TF-IDF mock fallback)
  await generateEmbeddings();

  console.log(`\nActive Embedding Mode: ${embeddingMode.toUpperCase()}\n`);

  // 3. Define test query scenarios
  const testCases = [
    {
      description: 'Scenario 1: Candidate mentions Docker, containers, Kubernetes, and pod deployments (excludes Day 8)',
      text: 'For scaling my backend, I built containerized Docker services and managed pod scaling using Kubernetes.',
      excludeDays: [8],
      expectedKeyword: 'Docker'
    },
    {
      description: 'Scenario 2: Candidate mentions monitoring, Prometheus, logging, observability, and Grafana dashboards (excludes Day 10)',
      text: 'I tracked API latency using Prometheus, set up Grafana metrics, and integrated structured logging dashboards.',
      excludeDays: [10],
      expectedKeyword: 'Monitoring'
    },
    {
      description: 'Scenario 3: Candidate mentions prompt engineering, system instructions, and few-shot templates (excludes Day 22)',
      text: 'I optimized model performance by writing structured system instructions and few-shot prompting examples.',
      excludeDays: [22],
      expectedKeyword: 'Prompt'
    },
    {
      description: 'Scenario 4: Generic / Unrelated response (should not fire or trigger high similarity)',
      text: 'Yes, that makes sense. I agree with that point.',
      excludeDays: [],
      expectedKeyword: 'none'
    }
  ];

  for (const tc of testCases) {
    console.log(`>>> ${tc.description}`);
    console.log(`Query: "${tc.text}"`);
    console.log(`Excluding days: [${tc.excludeDays.join(', ')}]`);

    const matches = await findRelatedDays(tc.text, tc.excludeDays, 2);
    console.log('Detected connections:', matches);

    if (tc.expectedKeyword !== 'none') {
      if (matches.length > 0) {
        const foundExpected = matches.some(m => m.title.includes(tc.expectedKeyword));
        console.log(`Verification: ${foundExpected ? 'PASS' : 'FAIL'} (Surfaced relevant day: "${matches[0].title}")`);
      } else {
        console.log('Verification: FAIL (No matches returned)');
      }
    } else {
      console.log(`Verification: ${matches.length === 0 ? 'PASS' : 'FAIL'} (Returned ${matches.length} matches, expected 0)`);
    }
    console.log('-------------------------------------------------------\n');
  }

  console.log('=======================================');
  console.log('SEMANTIC CONNECTION LAYER TESTS COMPLETE');
  console.log('=======================================\n');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
});
