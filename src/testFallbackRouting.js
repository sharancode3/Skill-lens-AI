// testFallbackRouting.js - Test suite for brain-specific fallback routing
import { checkDeterministicConduct } from './llmClient.js';
import * as llmClient from './llmClient.js';

console.log('========================================================');
console.log('RUNNING BRAIN-SPECIFIC FALLBACK ROUTING TESTS');
console.log('========================================================\n');

// Mock restore reference
const originalCallQwen = llmClient.callBrainLLMWithFallback;

// Since we want to test analyzeConductWithLLM fallback path:
// Let's call analyzeConductWithLLM with mock behaviors
import { analyzeConductWithLLM } from './llmClient.js';

// Setup environment variables
process.env.LLM_PROVIDER = 'qwen';
process.env.GEMINI_API_KEY = 'mock-gemini-key';
process.env.SIMULATE_LLM_OUTAGE = 'false';

// Helper to reset mocks
function resetMocks() {
  global.qwenCalls = 0;
  global.geminiCalls = 0;
}

// Wrap callQwenREST & callGeminiREST dynamically or test callBrainLLMWithFallback directly
import assert from 'assert';

async function runTests() {
  // Test 1: Direct fallback validation using callBrainLLMWithFallback directly
  console.log('[Test 1] Testing callBrainLLMWithFallback direct behavior...');
  
  // Save original functions if needed or test the helper directly
  const mockSchema = { type: 'OBJECT', properties: {} };
  const mockFallback = () => ({ status: 'mock' });

  // Test Case A: Qwen succeeds
  resetMocks();
  process.env.LLM_PROVIDER = 'qwen';
  
  // We will temporarily override the global fetch or individual helper call behavior.
  // Actually, let's just mock the HTTP endpoints for Qwen and Gemini using a custom global fetch!
  const originalFetch = global.fetch;
  
  // Mock fetch
  global.fetch = async (url, options) => {
    if (url.includes('11434')) {
      global.qwenCalls++;
      // Return a valid mock JSON response for Qwen
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"classification":"genuine_attempt","reasoning":"qwen ok"}' } }]
        })
      };
    } else if (url.includes('generativelanguage')) {
      global.geminiCalls++;
      // Return a valid mock JSON response for Gemini
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"classification":"genuine_attempt","reasoning":"gemini ok"}' }] } }]
        })
      };
    }
    return { ok: false, text: async () => 'Error' };
  };

  try {
    const resA = await llmClient.callBrainLLMWithFallback('TestBrain', 'sys', 'user', mockSchema, mockFallback);
    console.log(' -> Qwen success case output:', resA);
    assert.strictEqual(global.qwenCalls, 1, 'Should call Qwen once');
    assert.strictEqual(global.geminiCalls, 0, 'Should not call Gemini if Qwen succeeds');
    console.log(' -> PASS: Qwen success case.');

    // Test Case B: Qwen fails, Gemini succeeds
    resetMocks();
    global.fetch = async (url, options) => {
      if (url.includes('11434')) {
        global.qwenCalls++;
        throw new Error('Ollama offline/timeout');
      } else if (url.includes('generativelanguage')) {
        global.geminiCalls++;
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"classification":"genuine_attempt","reasoning":"gemini fallback ok"}' }] } }]
          })
        };
      }
      return { ok: false };
    };

    const resB = await llmClient.callBrainLLMWithFallback('TestBrain', 'sys', 'user', mockSchema, mockFallback);
    console.log(' -> Fallback case output:', resB);
    assert.ok(global.qwenCalls >= 1, 'Should try Qwen at least once');
    assert.strictEqual(global.geminiCalls, 1, 'Should fall back to Gemini once Qwen fails');
    assert.strictEqual(resB.reasoning, 'gemini fallback ok', 'Should use Gemini response');
    console.log(' -> PASS: Cloud fallback case.');

    // Test Case C: Both fail, mock fallback triggered
    resetMocks();
    global.fetch = async (url, options) => {
      if (url.includes('11434')) {
        global.qwenCalls++;
        throw new Error('Ollama offline');
      } else if (url.includes('generativelanguage')) {
        global.geminiCalls++;
        throw new Error('Gemini quota exceeded');
      }
      return { ok: false };
    };

    const resC = await llmClient.callBrainLLMWithFallback('TestBrain', 'sys', 'user', mockSchema, mockFallback);
    console.log(' -> Both failed case output:', resC);
    assert.ok(global.qwenCalls >= 1, 'Should try Qwen');
    assert.ok(global.geminiCalls >= 1, 'Should try Gemini');
    assert.strictEqual(resC.status, 'mock', 'Should fall back to offline mock');
    console.log(' -> PASS: Both fail to static mock fallback case.');

  } finally {
    // Restore fetch
    global.fetch = originalFetch;
  }
  
  console.log('\n========================================================');
  console.log('SUCCESS: All brain-specific fallback routing tests passed!');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('\nFAIL: Fallback routing validation failed:', err);
  process.exit(1);
});
