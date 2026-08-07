import { initializeData, candidatesById } from './dataManager.js';
import { buildTopicQueue } from './topicSelector.js';

// 1. Initialize data manager (loads curriculum & candidates)
initializeData();

// 2. Fetch first 5 candidates
const testCandidateIds = ['CAND-001', 'CAND-002', 'CAND-003', 'CAND-004', 'CAND-005'];

console.log('\n=======================================');
console.log('STARTING TOPIC SELECTION ALGORITHM TESTS');
console.log('=======================================\n');

for (const id of testCandidateIds) {
  const candidate = candidatesById.get(id);
  if (!candidate) {
    console.error(`Candidate ${id} not found in database.`);
    continue;
  }

  console.log(`\n>>> Testing Candidate: ${candidate.member.name} (${id})`);
  console.log(`Job Role: ${candidate.member.jobRole}`);
  console.log(`Experience: ${candidate.member.yearsExperience} years`);
  
  // Count skipped, high attempts, etc. in original candidate data for manual verification comparison
  const stats = { skipped: 0, highAttempts: 0, firstTry: 0, standard: 0 };
  for (const m of candidate.missions) {
    if (m.skipped) stats.skipped++;
    else if (m.attempts >= 3) stats.highAttempts++;
    else if (m.attempts === 1 && m.passed) stats.firstTry++;
    else stats.standard++;
  }
  console.log(`Original Path Stats:`, stats);

  // Run the selector
  const queue = buildTopicQueue(candidate);

  console.log(`Resulting Topic Queue (Length: ${queue.length}):`);
  const dayList = [];
  const moduleList = [];
  
  queue.forEach((topic, idx) => {
    dayList.push(topic.day);
    if (topic.module) {
      moduleList.push(topic.module.number);
    }
    console.log(
      `  ${idx + 1}. Day ${topic.day} - "${topic.title}"` +
      ` | Difficulty: ${topic.difficulty}` +
      ` | Module: ${topic.module ? `#${topic.module.number} ${topic.module.title}` : 'None'}`
    );
  });

  const distinctDays = new Set(dayList);
  const distinctModules = new Set(moduleList);
  console.log(`Verification:`);
  console.log(`  - Unique days: ${distinctDays.size === queue.length ? 'PASS' : 'FAIL'} (${distinctDays.size} days)`);
  console.log(`  - Distinct modules represented: ${distinctModules.size}`);
  console.log(`  - Day numbers: [${dayList.join(', ')}]`);
  console.log(`  - Module numbers: [${moduleList.join(', ')}]`);
}

console.log('\n=======================================');
console.log('TOPIC SELECTION ALGORITHM TESTS COMPLETE');
console.log('=======================================\n');
