import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const curriculumPath = path.resolve(__dirname, '../curriculum.json');
const outputPath = path.resolve(__dirname, '../src/data/questionBank.json');

const curriculum = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));

console.log('[Offline Bank Generator] Generating pre-validated Question Bank for all curriculum days...');

// Programmatic MCQ Validator
function validateMCQ(item) {
  if (!item.id || typeof item.id !== 'string') return false;
  if (typeof item.day !== 'number' || item.day < 1 || item.day > 31) return false;
  if (!item.question || typeof item.question !== 'string' || item.question.trim().length < 10) return false;
  if (!Array.isArray(item.options) || item.options.length !== 4) return false;
  
  // Options must be non-empty strings and no [object Object]
  for (const opt of item.options) {
    if (typeof opt !== 'string' || opt.trim().length === 0 || opt.includes('[object Object]')) {
      return false;
    }
  }

  // Options must be distinct (no duplicate or near-duplicate options)
  const normalized = item.options.map(o => o.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const unique = new Set(normalized);
  if (unique.size !== 4) return false;

  // Correct answer index must be 0..3
  if (typeof item.correctAnswer !== 'number' || item.correctAnswer < 0 || item.correctAnswer > 3) return false;

  return true;
}

// Programmatic Diagram Validator
function validateDiagram(item) {
  if (!item.id || typeof item.id !== 'string') return false;
  if (typeof item.day !== 'number' || item.day < 1 || item.day > 31) return false;
  if (!item.diagramQuestionText || typeof item.diagramQuestionText !== 'string' || item.diagramQuestionText.trim().length < 10) return false;
  if (!item.diagramDefinition || typeof item.diagramDefinition !== 'string') return false;

  const def = item.diagramDefinition.trim();
  const validPrefix = /^(graph\s+(TD|TB|LR|RL)|flowchart\s+(TD|TB|LR|RL)|sequenceDiagram|classDiagram|stateDiagram)/i.test(def);
  if (!validPrefix) return false;

  // Basic syntax structure check: balanced brackets
  let openBrackets = 0;
  let closeBrackets = 0;
  for (const char of def) {
    if (char === '[' || char === '(' || char === '{') openBrackets++;
    if (char === ']' || char === ')' || char === '}') closeBrackets++;
  }
  if (openBrackets !== closeBrackets) return false;

  return true;
}

// Question Bank Template Generator across all 31 Days
const mcqBank = {};
const diagramBank = {};

// Helper to seed high quality technical questions per day
for (const d of curriculum.days) {
  const dayNum = d.day;
  const title = d.title;
  const objectives = d.objectives || [];
  const tools = (d.tools || []).join(', ');

  mcqBank[dayNum] = [
    // Foundational / Easy
    {
      id: `mcq-d${dayNum}-easy-1`,
      day: dayNum,
      topic: title,
      difficulty: 'foundational',
      question: `In the context of Day ${dayNum} (${title}), what is the primary role of ${d.tools?.[0] || 'the core tooling'} in the architecture?`,
      options: [
        `Provides the core execution environment and runtime interface for ${title}.`,
        `Serves solely as an offline data backup repository.`,
        `Replaces all network transport layers with unencrypted broadcast sockets.`,
        `Automatically bypasses all parameter validation and schema verification.`
      ],
      correctAnswer: 0,
      explanation: `${d.tools?.[0] || 'The tool'} establishes the primary developer environment and runtime interface.`
    },
    {
      id: `mcq-d${dayNum}-easy-2`,
      day: dayNum,
      topic: title,
      difficulty: 'foundational',
      question: `Which of the following best represents a foundational best practice for Day ${dayNum} (${title})?`,
      options: [
        `Hardcoding secrets and configuration credentials in public git repositories.`,
        `Verifying environment prerequisites and isolating dependencies using dedicated environments.`,
        `Disabling all compiler warnings and error logging to increase throughput.`,
        `Storing runtime state directly in ephemeral memory without persistence.`
      ],
      correctAnswer: 1,
      explanation: `Dependency isolation and prerequisite validation prevent runtime divergence.`
    },
    // Standard / Medium
    {
      id: `mcq-d${dayNum}-med-1`,
      day: dayNum,
      topic: title,
      difficulty: 'standard',
      question: `When implementing ${objectives[0] || title} on Day ${dayNum}, what is the main technical trade-off to consider?`,
      options: [
        `Balancing latency and throughput against resource consumption and precision.`,
        `Discarding all structured data formats in favor of random binary streams.`,
        `Ensuring zero CPU utilization by disabling background workers permanently.`,
        `Replacing asynchronous I/O with blocking thread sleeps across all requests.`
      ],
      correctAnswer: 0,
      explanation: `System engineering requires optimizing throughput against latency and hardware bounds.`
    },
    {
      id: `mcq-d${dayNum}-med-2`,
      day: dayNum,
      topic: title,
      difficulty: 'standard',
      question: `During the implementation of Day ${dayNum} (${title}), what mechanism ensures deterministic and reproducible behavior?`,
      options: [
        `Relying on unseeded random number generators for state transitions.`,
        `Explicitly pinning dependency versions and enforcing schema contracts.`,
        `Executing commands without return code verification or error boundaries.`,
        `Overriding production database tables with test mocks at runtime.`
      ],
      correctAnswer: 1,
      explanation: `Version pinning and strict schema contracts prevent unexpected configuration drift.`
    },
    // Applied / Deep / Hard
    {
      id: `mcq-d${dayNum}-hard-1`,
      day: dayNum,
      topic: title,
      difficulty: 'applied',
      question: `In a production deployment of Day ${dayNum} (${title}), how should the system handle sudden upstream latency spikes or service degradation?`,
      options: [
        `Implement circuit breakers with exponential backoff and localized fallback caches.`,
        `Retry indefinitely in a synchronous blocking loop until the host runs out of memory.`,
        `Immediately terminate the parent process without flushing telemetry buffers.`,
        `Increase thread concurrency infinitely until upstream responds.`
      ],
      correctAnswer: 0,
      explanation: `Circuit breakers and exponential backoff prevent cascading service collapse.`
    },
    {
      id: `mcq-d${dayNum}-hard-2`,
      day: dayNum,
      topic: title,
      difficulty: 'applied',
      question: `Which architectural failure mode is most critical to guard against in Day ${dayNum} (${title})?`,
      options: [
        `Over-allocating memory during batch processing leading to unhandled Out-Of-Memory (OOM) crashes.`,
        `Using standardized JSON schemas instead of proprietary byte strings.`,
        `Enforcing HTTPS encryption across inter-service RPC communication.`,
        `Logging structured JSON events with monotonic timestamps.`
      ],
      correctAnswer: 0,
      explanation: `Unbounded memory allocation during high load triggers OOM faults and container restarts.`
    }
  ];

  // Specific Day-Level Enrichments for Technical Days (AI_CORE, BUILD, OPTIMIZE)
  if (dayNum >= 7 && dayNum <= 10) {
    // Vector & Embeddings Module
    mcqBank[dayNum].push({
      id: `mcq-d${dayNum}-vector-hard`,
      day: dayNum,
      topic: title,
      difficulty: 'applied',
      question: `When querying high-dimensional vector embeddings with HNSW indexes in Chroma/Pinecone, how does increasing the \`efSearch\` parameter affect search performance?`,
      options: [
        `Increases recall precision at the cost of higher query latency and compute.`,
        `Decreases recall precision while dramatically increasing index build time.`,
        `Converts cosine similarity distances into unnormalized Manhattan coordinates.`,
        `Truncates all vector dimensions below 512 automatically.`
      ],
      correctAnswer: 0,
      explanation: `Higher efSearch expands the candidate search graph, boosting recall accuracy at higher latency.`
    });
  } else if (dayNum >= 11 && dayNum <= 15) {
    // LLM Core & Prompting
    mcqBank[dayNum].push({
      id: `mcq-d${dayNum}-llm-hard`,
      day: dayNum,
      topic: title,
      difficulty: 'applied',
      question: `When fine-tuning open-weights models using LoRA (Low-Rank Adaptation), what is the primary benefit of decomposing weight update matrices $\\Delta W$ into rank $r$ matrices $A$ and $B$?`,
      options: [
        `Drastically reduces trainable parameter count and VRAM consumption while preserving base model weights.`,
        `Forces all transformer attention heads to operate in single-precision FP64 mode.`,
        `Eliminates the need for tokenization by operating directly on ASCII raw byte streams.`,
        `Bypasses backpropagation by using genetic evolutionary mutations.`
      ],
      correctAnswer: 0,
      explanation: `LoRA factors the $\\Delta W$ matrix into low-rank representations, enabling efficient fine-tuning on consumer hardware.`
    });
  } else if (dayNum >= 21 && dayNum <= 24) {
    // Agentic AI & MCP
    mcqBank[dayNum].push({
      id: `mcq-d${dayNum}-agent-hard`,
      day: dayNum,
      topic: title,
      difficulty: 'applied',
      question: `In Model Context Protocol (MCP) or ReAct agent loop architectures, how should the orchestrator handle non-recoverable tool execution errors?`,
      options: [
        `Feed the structured error message back into the model's scratchpad context so it can adjust its reasoning.`,
        `Silently ignore the failed tool output and fabricate synthetic success data.`,
        `Panic and terminate the entire agent container without closing open connections.`,
        `Execute the failed tool command recursively in an infinite loop.`
      ],
      correctAnswer: 0,
      explanation: `Feeding tool execution errors into the reasoning context allows the LLM agent to self-correct.`
    });
  } else if (dayNum >= 25 && dayNum <= 31) {
    // Security, Observability & Production
    mcqBank[dayNum].push({
      id: `mcq-d${dayNum}-prod-hard`,
      day: dayNum,
      topic: title,
      difficulty: 'applied',
      question: `When implementing distributed tracing and observability (OpenTelemetry) in an LLM pipeline, what is the critical function of trace and span IDs?`,
      options: [
        `Correlates asynchronous multi-hop requests across microservices and model calls into a unified timeline.`,
        `Encodes candidate passwords and API tokens directly in trace spans.`,
        `Encrypts network packets to prevent DNS spoofing at the router layer.`,
        `Replaces standard HTTP status codes with arbitrary floating point values.`
      ],
      correctAnswer: 0,
      explanation: `Distributed trace context propagation links disparate service requests and LLM invocations.`
    });
  }

  // Pre-generate Diagram Questions for Technical Curriculum Days
  if (d.type === 'AI_CORE' || d.type === 'BUILD' || d.type === 'OPTIMIZE' || dayNum >= 2) {
    diagramBank[dayNum] = [
      {
        id: `diag-d${dayNum}-arch-1`,
        day: dayNum,
        topic: title,
        difficulty: 'standard',
        diagramDefinition: `graph TD\n  Client[User Request] --> Gateway[API Gateway]\n  Gateway --> Auth[Auth & Rate Limiter]\n  Auth --> Engine[Day ${dayNum}: ${title}]\n  Engine --> Storage[(Vector / Relational DB)]`,
        diagramQuestionText: `Review this high-level architecture diagram for Day ${dayNum} (${title}). What potential performance bottleneck or failure mode exists if the Storage layer experiences high latency?`,
        expectedInsight: `Backpressure at the storage layer can cascade upstream into the Engine and Gateway without circuit breaking.`
      },
      {
        id: `diag-d${dayNum}-pipe-2`,
        day: dayNum,
        topic: title,
        difficulty: 'applied',
        diagramDefinition: `graph TD\n  Ingest[Data Ingestion] --> Preprocess[Chunking & Cleaning]\n  Preprocess --> Embedding[Embedding Model]\n  Embedding --> VectorStore[(Vector Store)]\n  Preprocess --> SyncQueue[Background Sync Queue]\n  SyncQueue --> Cache[In-Memory Cache]`,
        diagramQuestionText: `Analyze this processing pipeline for Day ${dayNum} (${title}). If the Background Sync Queue fails or desynchronizes from the Vector Store, what consistency issues will users observe?`,
        expectedInsight: `Stale or missing cache entries will cause vector lookups to diverge from cached metadata.`
      }
    ];
  }
}

// Perform strict offline validation pass
let totalMCQs = 0;
let totalDiagrams = 0;
let validMCQs = 0;
let validDiagrams = 0;

for (const day in mcqBank) {
  mcqBank[day] = mcqBank[day].filter(item => {
    totalMCQs++;
    const isValid = validateMCQ(item);
    if (isValid) validMCQs++;
    return isValid;
  });
}

for (const day in diagramBank) {
  diagramBank[day] = diagramBank[day].filter(item => {
    totalDiagrams++;
    const isValid = validateDiagram(item);
    if (isValid) validDiagrams++;
    return isValid;
  });
}

const questionBankPayload = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  mcqBank,
  diagramBank,
  summary: {
    totalDaysIndexed: curriculum.days.length,
    validMCQs,
    validDiagrams
  }
};

// Ensure parent dir exists and write
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(questionBankPayload, null, 2), 'utf8');

console.log(`[Offline Bank Generator] Question Bank successfully compiled and validated!`);
console.log(`  - Valid MCQs: ${validMCQs} / ${totalMCQs}`);
console.log(`  - Valid Diagrams: ${validDiagrams} / ${totalDiagrams}`);
console.log(`  - Saved to: ${outputPath}`);
