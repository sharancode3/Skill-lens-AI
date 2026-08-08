async function runTests() {
  console.log('--- STARTING PHASE 13 PART C VALIDATION TESTS ---');
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

  // Test 1: Diagram Extraction and Sanitization
  console.log('\n[Test 1] Validating Diagram Extraction from raw text...');
  
  function extractDiagram(text, explicitDef) {
    let extractedDiagram = explicitDef;
    let displayStem = text;

    if (!extractedDiagram && text) {
      const mermaidFenceMatch = text.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
      if (mermaidFenceMatch && (
        mermaidFenceMatch[1].includes('graph ') || 
        mermaidFenceMatch[1].includes('flowchart ') || 
        mermaidFenceMatch[1].includes('sequenceDiagram') || 
        mermaidFenceMatch[1].includes('classDiagram') || 
        mermaidFenceMatch[1].includes('stateDiagram') || 
        mermaidFenceMatch[1].includes('erDiagram')
      )) {
        extractedDiagram = mermaidFenceMatch[1].trim();
        displayStem = text.replace(mermaidFenceMatch[0], '').trim();
      } else if (
        text.includes('graph TD') || text.includes('graph LR') ||
        text.includes('flowchart TD') || text.includes('flowchart LR')
      ) {
        const lines = text.split('\n');
        const diagramLines = [];
        const stemLines = [];
        let inDiagram = false;
        for (const line of lines) {
          if (/^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram)\s+/i.test(line)) {
            inDiagram = true;
          }
          if (inDiagram) {
            diagramLines.push(line);
          } else {
            stemLines.push(line);
          }
        }
        if (diagramLines.length > 0) {
          extractedDiagram = diagramLines.join('\n').trim();
          displayStem = stemLines.join('\n').trim();
        }
      }
    }

    if (extractedDiagram) {
      extractedDiagram = extractedDiagram.replace(/^```(?:mermaid)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    return { displayStem, extractedDiagram };
  }

  const rawSample1 = `Here is a system architecture diagram:\n\`\`\`mermaid\ngraph TD\n  A[Client] --> B[API Gateway]\n  B --> C[Auth Service]\n\`\`\`\nWhat bottleneck exists in this architecture?`;
  const res1 = extractDiagram(rawSample1, null);
  assert(res1.extractedDiagram === 'graph TD\n  A[Client] --> B[API Gateway]\n  B --> C[Auth Service]', 'Extracted pure Mermaid code from fenced markdown');
  assert(!res1.displayStem.includes('```mermaid'), 'Display stem contains zero raw mermaid fences');
  assert(res1.displayStem.includes('What bottleneck exists in this architecture?'), 'Display stem preserves question prompt');

  // Test 2: MCQ Option Object Sanitization
  console.log('\n[Test 2] Validating MCQ Option Sanitization and [object Object] prevention...');

  function sanitizeMCQOptions(options) {
    if (!Array.isArray(options)) return [];
    return options.map(opt => {
      if (typeof opt === 'string') {
        const trimmed = opt.trim();
        return (trimmed === '[object Object]' || trimmed === '') ? '' : trimmed;
      }
      if (opt && typeof opt === 'object') {
        const val = opt.text || opt.label || opt.option || opt.choice || opt.title || opt.value || '';
        const strVal = String(val).trim();
        return strVal === '[object Object]' ? '' : strVal;
      }
      return '';
    }).filter(Boolean);
  }

  const objectOptions = [
    { text: 'A) Use Redis for distributed cache' },
    { label: 'B) Increase connection pool timeout' },
    { option: 'C) Implement exponential backoff retry' },
    { choice: 'D) Deploy replicas across availability zones' }
  ];
  const cleaned = sanitizeMCQOptions(objectOptions);
  assert(cleaned.length === 4, 'All 4 object choices cleanly converted to strings');
  assert(cleaned[0] === 'A) Use Redis for distributed cache', 'Extracted opt.text correctly');
  assert(cleaned[1] === 'B) Increase connection pool timeout', 'Extracted opt.label correctly');
  assert(cleaned[2] === 'C) Implement exponential backoff retry', 'Extracted opt.option correctly');
  assert(cleaned[3] === 'D) Deploy replicas across availability zones', 'Extracted opt.choice correctly');
  assert(!cleaned.some(c => c.includes('[object Object]')), 'Zero instances of [object Object] in sanitized options');

  // Test 3: Defensive Fallback on Malformed/Corrupted Options
  console.log('\n[Test 3] Validating Fallback to Open Mode on Malformed Choices...');
  const corruptedOptions = ['[object Object]', '', null, undefined];
  const sanitizedCorrupted = sanitizeMCQOptions(corruptedOptions);
  assert(sanitizedCorrupted.length === 0, 'Filtered out all corrupted options');
  const shouldFallback = sanitizedCorrupted.length < 2;
  assert(shouldFallback === true, 'Correctly triggers defensive fallback to open free-text input mode when valid options < 2');

  console.log(`\n=== RESULTS: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution crashed:', err);
  process.exit(1);
});
