import dotenv from 'dotenv';
import { daysByNumber } from './dataManager.js';

dotenv.config();

// Enforced response schema for Gemini API turn evaluations
export function buildResponseSchema(nextQuestionType) {
  const schema = {
    type: 'OBJECT',
    properties: {
      classification: {
        type: 'STRING',
        description: 'One of: strong (correct understanding with real specificity), partial (directionally right, missing key mechanisms), shallow (vague/generic), or off_topic.',
        enum: ['strong', 'partial', 'shallow', 'off_topic']
      },
      reasoning: {
        type: 'STRING',
        description: 'A short private explanation of why this classification was chosen.'
      },
      action: {
        type: 'STRING',
        description: 'One of: followup (if answer is partial/shallow and no follow-up has been asked yet), why_probe (if answer is strong/partial and whyChainDepth < 3), or advance (if we should transition topics or wrapup).',
        enum: ['followup', 'why_probe', 'advance', 'wrapup']
      },
      reactionClause: {
        type: 'STRING',
        description: 'A short 3-8 word conversational reaction to the candidate\'s answer (e.g. "Right.", "Makes sense.", "Hm, okay —", "No worries — let\'s try a different angle.", etc.) based on their classification and response content.'
      },
      reply: {
        type: 'STRING',
        description: 'The literal next message shown to the candidate.'
      },
      updatedMemory: {
        type: 'STRING',
        description: 'A 2-4 sentence running summary of the candidate skills, strengths, and gaps observed so far, incorporating this turn.'
      },
      llmConfidence: {
        type: 'INTEGER',
        description: 'A genuine calibrated numeric estimate of candidate correctness and depth (0-100). Do not default to round numbers like 50/70/90. Justify extreme scores in reasoning.'
      },
      modelWantsToStop: {
        type: 'BOOLEAN',
        description: 'Whether you want to wrap up the interview now. Set to true ONLY if floorMet is true and you have evaluated enough distinct, well-covered topics to write specific, fair feedback and there is no more meaningfully different ground left in the topic queue worth covering. Otherwise, set to false.'
      },
      hallucinationFlag: {
        type: 'BOOLEAN',
        description: 'True if candidate response contains technical hallucinations or fabricated facts.'
      },
      hallucinationCorrection: {
        type: 'STRING',
        description: 'A short factual correction (1 sentence) if hallucinationFlag is true, otherwise empty string "".'
      },
      whyProbe: {
        type: 'BOOLEAN',
        description: 'True if the next question is a why-chain probe (asking candidate to justify a specific technical choice from their previous answer).'
      },
      communicationConfidence: {
        type: 'STRING',
        description: 'The candidate\'s verbal certainty and delivery confidence: low, medium, or high, independent of correctness.'
      },
      rootUnderstandingReached: {
        type: 'BOOLEAN',
        description: 'True if candidate response demonstrates final root mechanistic understanding in a why-probing chain. Otherwise false.'
      }
    },
    required: ['classification', 'reasoning', 'action', 'reactionClause', 'reply', 'updatedMemory', 'llmConfidence', 'modelWantsToStop', 'hallucinationFlag', 'hallucinationCorrection', 'whyProbe', 'communicationConfidence', 'rootUnderstandingReached']
  };

  if (nextQuestionType === 'mcq') {
    schema.properties.mcqOptions = {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'An array of exactly 4 choices (3 plausible distractors and 1 correct answer related to the objectives of the NEXT topic day in queue).'
    };
    schema.properties.mcqCorrectIndex = {
      type: 'INTEGER',
      description: 'The index (0-3) of the correct option in mcqOptions.'
    };
    schema.required.push('mcqOptions', 'mcqCorrectIndex');
  } else if (nextQuestionType === 'diagram_interpret') {
    schema.properties.diagramDefinition = {
      type: 'STRING',
      description: 'A valid Mermaid.js flowchart or sequence diagram string representing the NEXT topic\'s architectural setup, with exactly one step or connection deliberately flawed, missing, or mislabeled. Format as a clean string without markdown fences.'
    };
    schema.properties.diagramQuestionText = {
      type: 'STRING',
      description: 'A specific technical question asking the candidate to identify and explain what is out of order or flawed in the Mermaid diagram definition.'
    };
    schema.required.push('diagramDefinition', 'diagramQuestionText');
  }

  return schema;
}


// Enforced response schema for Gemini API final feedback report
const feedbackSchema = {
  type: 'OBJECT',
  properties: {
    summary: {
      type: 'STRING',
      description: 'A 2-4 sentence summary paragraph of candidate overall performance, referencing specific details from the candidate responses in the transcript.'
    },
    strengths: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'List of specific strengths demonstrated. Each must mention the day number and topic name, and only include topics evaluated as strong or partial-with-solid-reasoning.'
    },
    gaps: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'List of specific gaps. Cover shallow/off-topic topics, or skipped missions never asked (using the exact phrase "not yet demonstrated" for the latter).'
    },
    next: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'List of concrete, actionable next steps, each referencing a specific day number and title from the curriculum.'
    }
  },
  required: ['summary', 'strengths', 'gaps', 'next']
};

/**
 * Call the Google Gemini API REST endpoint using JSON mode and schema enforcement.
 */
async function callGeminiREST(systemPrompt, userPrompt, schema, retryCount = 1, temperature = 1.0) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `${systemPrompt}\n\nCandidate Input Data:\n${userPrompt}`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: temperature
    }
  };

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(id);

  if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API HTTP Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawText) {
      throw new Error('Empty text response from Gemini API.');
    }

    console.log('[LLMClient] Raw response from Gemini:', rawText);
    const parsed = JSON.parse(rawText.trim());

    // Validate schema fields manually
    const keys = Object.keys(schema.properties);
    for (const key of keys) {
      if (!(key in parsed)) {
        throw new Error(`Missing expected property: "${key}" in LLM response.`);
      }
    }

    return parsed;
  } catch (error) {
    console.error(`[LLMClient] Call failed (retries remaining: ${retryCount}):`, error.message);
    if (retryCount > 0) {
      // Corrective instructions
      const correctiveInstructions = "\n\nCRITICAL: You failed to return valid JSON matching the schema. You MUST return ONLY valid JSON matching the schema. No markdown backticks, no markdown fencing, no leading/trailing commentary.";
      return callGeminiREST(systemPrompt, userPrompt + correctiveInstructions, schema, retryCount - 1, temperature);
    }
    return null;
  }
}

/**
 * Call the OpenAI-compatible Qwen REST endpoint.
 */
async function callQwenREST(systemPrompt, userPrompt, schema, retryCount = 1, temperature = 1.0) {
  const baseURL = process.env.QWEN_API_URL || 'http://localhost:11434/v1';
  const modelName = process.env.QWEN_MODEL_NAME || 'qwen2.5:3b';
  
  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`;
  
  const requestBody = {
    model: modelName,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    response_format: { type: 'json_object' },
    temperature: temperature
  };

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(id);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Qwen API HTTP Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error('Empty content from Qwen response.');
    }

    console.log('[LLMClient] Raw response from Qwen:', rawContent);
    const parsed = JSON.parse(rawContent.trim());

    // Validate schema fields manually
    const keys = Object.keys(schema.properties);
    for (const key of keys) {
      if (!(key in parsed)) {
        throw new Error(`Missing expected property: "${key}" in Qwen response.`);
      }
    }

    return parsed;
  } catch (error) {
    console.error(`[LLMClient Qwen] Call failed (retries remaining: ${retryCount}):`, error.message);
    if (retryCount > 0) {
      const correctiveInstructions = "\n\nCRITICAL: You failed to return valid JSON matching the schema. You MUST return ONLY valid JSON matching the schema. No markdown backticks, no markdown fencing, no leading/trailing commentary.";
      return callQwenREST(systemPrompt, userPrompt + correctiveInstructions, schema, retryCount - 1, temperature);
    }
    return null;
  }
}

/**
 * Optional local LoRA helper to generate better interviewer voice text.
 * Queries local Ollama model with 3s timeout; falls back gracefully to null on timeout or error.
 */
export async function generateLocalLoRAReply(systemPrompt, userPrompt) {
  const apiUrl = process.env.QWEN_API_URL || 'http://localhost:11434/v1';
  const modelName = process.env.LORA_MODEL_NAME || process.env.QWEN_MODEL_NAME || 'qwen2.5:3b';

  const requestBody = {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_tokens: 150
  };

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000); // 3s timeout
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(id);

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? content.trim() : null;
  } catch (error) {
    console.log('[LLMClient Local LoRA] Local model unavailable or timed out, falling back to cloud voice generation.');
    return null;
  }
}


/**
 * Deterministic offline mock LLM fallback.
 * Uses text characteristics and keywords to generate schema-adherent output.
 */
function mockLLMCall(candidate, topic, lastQuestion, message, followupCount, connections, nextQuestionType, nextTopic, difficultyTier, session, detectedHedgeMarkers = []) {
  console.log('[LLMClient] GEMINI_API_KEY not found or call failed. Using offline Mock LLM...');

  const cleanMsg = message.toLowerCase().trim();
  let classification = 'standard';
  let action = 'advance';
  let reasoning = 'Mock evaluation based on keyword analysis and message length.';
  let reply = '';
  let modelWantsToStop = false;

  const floorMet = session && session.questionsAsked >= 8 && session.distinctDaysCovered.length >= 4;
  if (floorMet) {
    const candidateName = candidate.name || '';
    if (candidateName.includes('Sarah') || candidateName.includes('StopAt8')) {
      modelWantsToStop = session.questionsAsked >= 8;
    } else if (candidateName.includes('John') || candidateName.includes('StopAt9')) {
      modelWantsToStop = session.questionsAsked >= 9;
    } else {
      modelWantsToStop = session.questionsAsked >= 10;
    }
  }

  // Determine classification
  const isGeneric = cleanMsg.length < 15 || cleanMsg === 'yes' || cleanMsg === 'no' || cleanMsg.includes('makes sense') || cleanMsg.includes('i agree');
  const overlapsKeywords = topic.objectives.some(obj => {
    const words = obj.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    return words.some(w => w.length > 4 && cleanMsg.includes(w));
  });

  if (cleanMsg.includes('apples') || cleanMsg.includes('banana') || cleanMsg.includes('weather')) {
    classification = 'off_topic';
    action = 'advance';
    reasoning = 'Candidate response is completely unrelated to the technical topic.';
  } else if (isGeneric) {
    classification = 'shallow';
    action = followupCount >= 1 ? 'advance' : 'followup';
    reasoning = 'Candidate response is very short and lacks technical detail.';
  } else if (overlapsKeywords) {
    classification = 'strong';
    action = 'advance';
    reasoning = 'Candidate answer directly overlaps core technical learning objectives.';
  } else {
    classification = 'partial';
    action = followupCount >= 1 ? 'advance' : 'followup';
    reasoning = 'Candidate response has some length but lacks key terminology matching objectives.';
  }

  // Acknowledge connections if present
  let connectionText = '';
  if (connections && connections.length > 0) {
    const conn = connections[0];
    connectionText = ` I notice this also touches on Day ${conn.day}: "${conn.title}" which you have completed.`;
  }

  // Format replies
  if (action === 'followup') {
    const segment = message.split(' ').slice(0, 3).join(' ');
    reply = `You mentioned "${segment}..." - Can you elaborate on the exact mechanism or trade-offs involved in this?`;
  } else {
    if (classification === 'off_topic') {
      reply = `Let's keep our focus on the technical side. Moving on to the next topic.`;
    } else {
      if (nextTopic && nextQuestionType === 'open') {
        const tier = difficultyTier || 'standard';
        const obj = nextTopic.objectives[0] || "understanding this day's concepts";
        if (tier === 'foundational') {
          reply = `For Day ${nextTopic.day}: "${nextTopic.title}", please define the basic terms and goals of this objective: ${obj}.`;
        } else if (tier === 'standard') {
          reply = `For Day ${nextTopic.day}: "${nextTopic.title}", how do you approach implementing this objective in a typical setup: ${obj}?`;
        } else if (tier === 'applied') {
          reply = `For Day ${nextTopic.day}: "${nextTopic.title}", describe a concrete architectural trade-off or scenario-based choice you faced when implementing: ${obj}.`;
        } else if (tier === 'expert') {
          reply = `For Day ${nextTopic.day}: "${nextTopic.title}", critique the default design choices or compare alternative implementations for: ${obj}.`;
        } else {
          reply = `Thank you for sharing your experience with "${topic.title}".${connectionText} Let's proceed.`;
        }
      } else {
        reply = `Thank you for sharing your experience with "${topic.title}".${connectionText} Let's proceed.`;
      }
    }
  }

  // Generate reactionClause dynamically
  const isDisengaged = cleanMsg.length < 5 && (cleanMsg === 'idk' || cleanMsg === 'skip' || cleanMsg === 'pass' || cleanMsg === 'none' || cleanMsg === 'na' || cleanMsg === 'n/a' || cleanMsg === 'no' || cleanMsg === '');
  const recent = session ? session.recentReactions || [] : [];
  let reactionClause = '';
  
  if (isDisengaged) {
    reactionClause = "No worries — let's try a different angle.";
  } else if (classification === 'strong') {
    const reactions = ["Right.", "Makes sense.", "Exactly.", "Good points.", "Perfect.", "Makes total sense."];
    reactionClause = reactions.find(r => !recent.includes(r)) || reactions[0];
  } else if (classification === 'partial') {
    const reactions = ["Hm, okay —", "Fair enough —", "That's part of it, but —", "Sure, let's build on that —"];
    reactionClause = reactions.find(r => !recent.includes(r)) || reactions[0];
  } else if (classification === 'shallow') {
    const reactions = ["Hm, okay —", "That covers the surface, but —", "That's quite high-level —"];
    reactionClause = reactions.find(r => !recent.includes(r)) || reactions[0];
  } else if (classification === 'off_topic') {
    const reactions = ["Let's bring it back —", "Understood, but —"];
    reactionClause = reactions.find(r => !recent.includes(r)) || reactions[0];
  } else {
    reactionClause = "Hm, okay —";
  }

  const updatedMemory = `Candidate has completed turn for Day ${topic.day} (${topic.title}). Evaluated as: ${classification}.`;

  const confMap = { strong: 92, partial: 68, shallow: 35, off_topic: 12 };
  const llmConfidence = confMap[classification] || 50;

  const isHallucination = cleanMsg.includes('rag stores vectors inside gpt') || cleanMsg.includes('rag stores vectors inside weights');
  const hallucinationFlag = isHallucination;
  const hallucinationCorrection = isHallucination 
    ? "RAG retrieves vectors from an external database and injects them as prompt context; it does not store vectors inside the neural weights of the model."
    : "";

  const finalClassification = isHallucination ? 'shallow' : classification;
  const finalAction = isHallucination ? (followupCount >= 1 ? 'advance' : 'followup') : action;
  const finalConfidence = isHallucination ? 20 : llmConfidence;

  // Confidence Hook evaluation
  const hasHedges = (detectedHedgeMarkers && detectedHedgeMarkers.length > 0) || cleanMsg.includes('i think') || cleanMsg.includes('maybe') || cleanMsg.includes('probably') || cleanMsg.includes('not sure');
  const communicationConfidence = hasHedges ? 'low' : 'high';

  let finalReaction = isHallucination ? `⚠️ ${hallucinationCorrection}` : reactionClause;
  const sessionHedgesCount = (session && session.hedgeEventCount) || 0;
  if (!isHallucination && sessionHedgesCount >= 3 && (finalClassification === 'strong' || finalClassification === 'partial') && hasHedges) {
    finalReaction = `You said 'probably' there, but that was actually right — are you more sure than you're letting on? Hm, okay —`;
  }

  const finalReply = isHallucination 
    ? (followupCount >= 1 ? "Let's move on to the next topic." : "Can you clarify how vectors are stored in a standard RAG pipeline?")
    : reply;

  const isWhyInitial = cleanMsg.includes('why-initial');
  const isWhyL1 = cleanMsg.includes('why-level-1');
  const isWhyL2 = cleanMsg.includes('why-level-2');
  const isWhyL3 = cleanMsg.includes('why-level-3');
  const isWhyWeak = cleanMsg.includes('why-weak');

  let mockAction = finalAction;
  let mockClassification = finalClassification;
  let mockReasoning = reasoning;
  let mockReply = finalReply;
  let mockRootReached = false;

  if (isWhyInitial) {
    mockClassification = 'strong';
    mockAction = 'why_probe';
    mockReasoning = 'Candidate gave strong initial answer. Probing why.';
    mockReply = "Why did you choose SQLite over keeping it in memory? (Level 1)";
  } else if (isWhyL1) {
    mockClassification = 'strong';
    mockAction = 'why_probe';
    mockReasoning = 'Candidate justified level 1. Probing why level 2.';
    mockReply = "Why do you think that specific SQLite index behaves this way? (Level 2)";
  } else if (isWhyL2) {
    mockClassification = 'strong';
    mockAction = 'why_probe';
    mockReasoning = 'Candidate justified level 2. Probing why level 3.';
    mockReply = "What is the ultimate bottleneck at the filesystem layer for this? (Level 3)";
  } else if (isWhyL3) {
    mockClassification = 'strong';
    mockAction = 'advance';
    mockReasoning = 'Candidate reached root understanding.';
    mockRootReached = true;
    mockReply = "Makes sense.";
  } else if (isWhyWeak) {
    mockClassification = 'shallow';
    mockAction = 'advance';
    mockReasoning = 'Candidate failed to justify why probe.';
    mockReply = "Okay. Let's move on.";
  }

  const result = {
    classification: mockClassification,
    reasoning: isHallucination ? 'Candidate hallucinated vector storage mechanics.' : mockReasoning,
    action: mockAction,
    reactionClause: finalReaction,
    reply: mockReply,
    updatedMemory,
    llmConfidence: isHallucination ? 20 : (mockClassification === 'shallow' ? 35 : finalConfidence),
    modelWantsToStop,
    hallucinationFlag,
    hallucinationCorrection,
    whyProbe: isHallucination ? false : (mockAction === 'why_probe' || mockAction === 'followup'),
    communicationConfidence,
    rootUnderstandingReached: mockRootReached
  };

  // Add MCQ fields if requested
  if (nextQuestionType === 'mcq') {
    const targetTopic = nextTopic || topic;
    let reply = `Based on Day ${targetTopic.day}: "${targetTopic.title}", which of the following choices represents the correct technical detail?`;
    let mcqOptions = [
      `Deploy a fallback server using a secondary container engine.`,
      `Implement rate-limiting and connection pooling directly.`,
      `Configure standard clustering protocols with stateless session replication.`,
      `Utilize memory-mapped databases for low latency.`
    ];
    let mcqCorrectIndex = 2;

    const cleanTitle = targetTopic.title.toLowerCase();
    if (cleanTitle.includes('embedding')) {
      reply = `For Day ${targetTopic.day}: "${targetTopic.title}", how is a text chunk converted into a vector representation in standard production setups?`;
      mcqOptions = [
        `By mapping keywords directly to a sparse matrix of TF-IDF frequencies.`,
        `By computing the cosine distance of the tokens relative to the dictionary size.`,
        `By feeding token sequences through a pre-trained transformer model to retrieve the hidden state vector.`,
        `By hashing the character sequences using MD5 and converting the hex representation to float.`
      ];
      mcqCorrectIndex = 2;
    } else if (cleanTitle.includes('vector')) {
      reply = `In a vector database optimized for Day ${targetTopic.day} objectives, how does HNSW indexing optimize similarity search?`;
      mcqOptions = [
        `By creating a multi-layer graph where upper layers have sparser connections for fast skip-list-like routing.`,
        `By partition-clustering all vectors into flat bucket indexes via K-means on every write.`,
        `By indexing string representations of vectors into a B-Tree sorting path.`,
        `By performing exhaustive brute-force Euclidean distance comparisons on all records asynchronously.`
      ];
      mcqCorrectIndex = 0;
    } else if (cleanTitle.includes('observability') || cleanTitle.includes('monitoring') || cleanTitle.includes('logging')) {
      reply = `When implementing observability for Day ${targetTopic.day}, what is the main architectural benefit of structured logging?`;
      mcqOptions = [
        `It reduces log volume by automatically compressing all trace outputs before writing.`,
        `It formats logs as serialized JSON key-value pairs to enable efficient machine querying and parsing.`,
        `It replaces log streams with binary protocols to prevent network interface card congestion.`,
        `It guarantees thread-safety for logging libraries via synchronous file locks.`
      ];
      mcqCorrectIndex = 1;
    } else if (cleanTitle.includes('docker') || cleanTitle.includes('kubernetes')) {
      reply = `For Day ${targetTopic.day}: "${targetTopic.title}", what is the primary role of a Kubernetes Service resource?`;
      mcqOptions = [
        `To define the resource constraints and CPU limits for individual pods.`,
        `To provide a stable network IP and DNS name that routes traffic across a dynamic set of pods.`,
        `To mount persistent storage volumes to multiple containers inside a node.`,
        `To schedule pod deployments onto specific worker nodes based on affinity labels.`
      ];
      mcqCorrectIndex = 1;
    } else if (cleanTitle.includes('prompt')) {
      reply = `When applying Prompt Engineering for Day ${targetTopic.day}, how does Few-Shot Prompting improve model behavior?`;
      mcqOptions = [
        `By fine-tuning the model's underlying weights using backpropagation on sample sets.`,
        `By prepending multiple input-output examples directly in the context window to guide generation style.`,
        `By increasing the generation temperature to encourage creative alternatives.`,
        `By truncating long inputs using semantic similarity search.`
      ];
      mcqCorrectIndex = 1;
    } else {
      reply = `Regarding the design of a system mapping to Day ${targetTopic.day}: "${targetTopic.title}", which practice ensures scalable performance?`;
      mcqOptions = [
        `Synchronous queue processing using single-thread event loops for heavy database writes.`,
        `Decoupling stateless backend services and using asynchronous message brokers for transaction flows.`,
        `Storing all session state in memory-mapped localized files on the instance.`,
        `Relying on database polling at 10ms intervals to synchronize replication status.`
      ];
      mcqCorrectIndex = 1;
    }

    result.reply = reply;
    result.mcqOptions = mcqOptions;
    result.mcqCorrectIndex = mcqCorrectIndex;
  } else if (nextQuestionType === 'diagram_interpret') {
    console.log('[LLMClient Diagram Log] Diagram generation used local mock fallback.');
    const targetTopic = nextTopic || topic;
    const title = targetTopic.title || 'System Architecture';
    const day = targetTopic.day || 0;
    result.reply = `Please examine the diagram below for Day ${day}: "${title}".`;
    
    // Construct a topic-specific flawed diagram dynamically
    const cleanTitle = title.toLowerCase();
    let flow = '';
    let flawQuestion = '';
    
    if (cleanTitle.includes('embedding')) {
      flow = `graph TD\n  A[Raw Text Chunk] --> B(MD5 Hash Function)\n  B -->|Hash String| C[Vector Storage]\n  C -->|Retrieve| D[LLM Prompt]`;
      flawQuestion = `Identify why using an MD5 hash function as shown in the Day ${day} embeddings flow is flawed for similarity search.`;
    } else if (cleanTitle.includes('vector')) {
      flow = `graph TD\n  A[Query Vector] -->|Euclidean Search| B(HNSW index)\n  B -->|Exhaustive Linear Scan| C[Top K Results]\n  C --> D[Context Enrichment]`;
      flawQuestion = `Day ${day} objectives cover HNSW search optimization. What is structurally incorrect about the path between HNSW and Top K Results in this diagram?`;
    } else if (cleanTitle.includes('observability') || cleanTitle.includes('monitoring') || cleanTitle.includes('logging')) {
      flow = `graph TD\n  A[App Logs] -->|Write to Text File| B(Sync File Lock)\n  B -->|Block CPU| C[Logstash Parser]\n  C --> D[Elasticsearch]`;
      flawQuestion = `Explain the bottleneck/flaw in the logging pipeline for Day ${day} when using synchronous file locks.`;
    } else if (cleanTitle.includes('docker') || cleanTitle.includes('kubernetes')) {
      flow = `graph TD\n  A[Pod Deployments] -->|Direct IP Routing| B(Dynamic Pod IPs)\n  B -->|No DNS/Service| C[API Gateway]`;
      flawQuestion = `For Day ${day} deployments, why is direct routing to dynamic pod IPs without a Service resource flawed?`;
    } else if (cleanTitle.includes('prompt')) {
      flow = `graph TD\n  A[Few-Shot Examples] -->|Weight Fine-Tuning| B(Model Weights)\n  B -->|Static Context| C[Inference Output]`;
      flawQuestion = `Explain the flaw in this prompting setup for Day ${day} where few-shot context is mistakenly shown as modifying model weights.`;
    } else {
      flow = `graph TD\n  A[Client Request] -->|Synchronous Polling| B(Database Queue)\n  B -->|10ms Interval| C[Backend Node]\n  C --> D[Response]`;
      flawQuestion = `Identify the scalability issue or missing architectural step in this default Day ${day} pipeline.`;
    }
    
    result.diagramDefinition = flow;
    result.diagramQuestionText = flawQuestion;
  }

  return result;
}


/**
 * Main intelligence layer evaluation entrypoint.
 * Assembles prompts, manages Gemini REST vs offline fallback, and validates schemas.
 */
export async function evaluateTurnWithLLM(session, candidateMessage, detectedConnections, detectedHedgeMarkers = []) {
  const candidate = session.candidateSnapshot;
  const topicIndex = session.cursor;
  const currentTopic = session.topicQueue[topicIndex];
  const nextTopic = session.topicQueue[topicIndex + 1] || null;
  const difficultyTier = session.difficultyTier || 'standard';
  const nextQuestionType = session.pendingQuestionType || 'open';

  // Find last interviewer question
  let lastQuestion = '';
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    if (session.transcript[i].role === 'interviewer') {
      lastQuestion = session.transcript[i].text;
      break;
    }
  }

  // Input Truncation: Truncate candidate message to a maximum of 300 words for LLM context
  const words = candidateMessage.split(/\s+/);
  const truncatedMessage = words.length > 300 
    ? words.slice(0, 300).join(' ') + ' ... [Truncated for Context]' 
    : candidateMessage;

  // Outage Simulation: bypass API calls if SIMULATE_LLM_OUTAGE is true
  if (process.env.SIMULATE_LLM_OUTAGE === 'true') {
    console.log('[LLMClient Outage Simulation] Simulating LLM outage in evaluateTurnWithLLM.');
    return mockLLMCall(candidate, currentTopic, lastQuestion, truncatedMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier, session, detectedHedgeMarkers);
  }

  const systemPrompt = `You are a professional, senior technical interviewer conducting a coding and architectural review for Skill Labs Ai.
You must evaluate the candidate's last response for the current topic.

CONSTRAINTS FOR CLASSIFICATION:
- "strong": Candidate demonstrates clear understanding with real specificity.
- "partial": Candidate is directionally right but misses key mechanisms or trade-offs.
- "shallow": Candidate is vague, generic, or just restates the question.
- "off_topic": Candidate response is completely unrelated to the topic.

CONSTRAINTS FOR REACTION CLAUSE (reactionClause):
- You MUST generate a short 3-8 word conversational reaction clause responding to the quality of the candidate's last answer.
- Tailor the tone to the classification:
  * "strong" classification gets an affirming beat (e.g., "Right.", "Makes sense.", "Exactly.", "Good points.")
  * "partial" or "shallow" classification gets a neutral-to-skeptical beat (e.g., "Hm, okay —", "Fair enough —", "That's part of it, but —", "Sure, let's build on that —")
  * "off_topic" classification gets a gentle redirect beat (e.g., "Let's bring it back —", "Understood, but —")
  * Low-effort responses (like "idk", "skip", "none") get an honest conversational reset (e.g., "No worries — let's try a different angle.", "That's fine — let's switch gears.")
- ANTI-REPETITION: If you see any entries in the "recentReactions" array in the input, you MUST NOT reuse those exact reaction phrases. Generate a different reaction beat.
- STRICT SEGREGATION: The reaction clause must reside ONLY in "reactionClause", and the follow-up or next question must reside ONLY in "reply". Do not repeat the reaction clause inside "reply".

CONSTRAINTS FOR MENTIONING THE DAY:
- Only mention the curriculum Day number (e.g., "Day 12") once when first transitioning or introducing a new topic.
- Never mention the Day number in follow-up questions, "why" questions, or probing questions within the same topic.

CONSTRAINTS FOR ACTION & PHRASING:
- "why_probe": Usable ONLY when the current turn's classification is "strong" or "partial" (never on "shallow" or "off_topic"). Selecting "why_probe" triggers a recursive follow-up asking the candidate to justify their technical decisions or explain the underlying root mechanisms of their previous answer. E.g. "Why did you choose SQLite instead of keeping the DataFrame in memory?"
- "strong" -> Action can be "why_probe" (if whyChainDepth < 3 to drill deeper into the mechanism) or "advance" (if we have completed the drilling).
- "off_topic" -> Action MUST be "advance". You must gently redirect the conversation back in the reply text.
- "partial" or "shallow" -> If "shallow", Action MUST be "followup" (or advance if followupCount >= 1). If "partial", Action can be "why_probe" (if whyChainDepth < 3) or "followup" (if we just want a standard clarification).
- When action is "followup" or "why_probe": The reply MUST reference something concrete or quote a word/phrase from the candidate's last message. DO NOT ask generic "can you elaborate?" questions.
- Adjust your vocabulary and question depth based on the candidate's years of experience:
  * Junior candidate (<3 years): Maintain supportive, concept-focused language.
  * Senior candidate (5+ years): Ask for architectural trade-offs, edge cases, scalability, and "why" decisions.

TONE CALIBRATION CONSTRAINTS:
1. NEVER use the following phrases: "great question", "that's a fascinating point", "as an AI", "I'd be happy to", "let's dive into", "sounds like a good plan", or restating the candidate's answer back before responding.
2. STRICT BREVITY: Keep your reply to 1-3 sentences unless presenting a diagram/MCQ. Do not monologue.
3. REALISTIC TERSENESS: Use short neutral acknowledgments ("Right.", "Okay, and—", "Sure.") and ask direct follow-ups or push back on weak answers ("That's part of it, but what actually triggers X?").
4. NO GENERIC PRAISE: Do not say "nice job" or "well explained". Praise must reference a specific correct mechanism named or be omitted entirely.

HALLUCINATION & WHY-PROBE CONSTRAINTS:
1. hallucinationFlag (boolean): Evaluate if the candidate's response contains factual hallucinations, checkably incorrect claims, or fabricated technical details. Set to true ONLY if the candidate asserts something as fact that is specifically incorrect (e.g. wrong technical relationships, wrong mechanisms, or fabricated capabilities). If the candidate gives a vague, incomplete, or uncertain response (e.g. "I am not sure, something about vector files"), do NOT flag this as a hallucination; it stays classification: "shallow" or "partial" and hallucinationFlag: false.
2. hallucinationCorrection (string): Required when hallucinationFlag is true. Provide a concise, factual, non-lecturing 1-sentence correction. If hallucinationFlag is false, set this to an empty string "".
3. prefix reactionClause: If hallucinationFlag is true, you MUST prefix the reactionClause with "⚠️ " followed by the hallucinationCorrection, then proceed with the interviewer voice pattern. E.g. "⚠️ RAG retrieves vectors from an external index, it does not store vectors inside GPT weights. Hm, okay — ".
4. whyProbe: Set this to true if the next question you are proposing (in "reply") is a why-chain probe asking the candidate to justify their technical decision or choice from their previous answer. Otherwise false.

COMMUNICATION CONFIDENCE CONSTRAINTS:
1. communicationConfidence (string): Classify as "low", "medium", or "high". This is about phrasing delivery and certainty, NOT correctness of content. Look at directness, hedging words, and self-deprecation.
   - "low": Frequent hedging words like "I think", "maybe", "probably", "I guess", "not sure", or hesitant vocabulary.
   - "medium": Neutral, standard matter-of-fact statements with minor or no hedges.
   - "high": Confident, direct, assertive technical statements, authoritative vocabulary.
   - Use the provided "detectedHedgeMarkers" list and "hedgeEventCount" as hints alongside your own holistic read of the message tone.
2. Confidence Probing Note Hook: If "hedgeEventCount" is 3+ in the input, and the candidate's last answer is classified as "strong" or "partial" (meaning they were actually correct/partially correct despite hedging), you may optionally include a brief confidence-probing note in the "reactionClause" responding to this hedging. For example: "You said 'probably' there, but that was actually correct — are you more sure than you're letting on?" This should be situational and rare.


FEW-SHOT EXAMPLES (GROUNDED CURRICULUM PATTERNS):
[STRONG ANSWER EXAMPLE]
- Candidate: "I used Pandas to load the CSV, cleaned nulls based on column semantics, then wrote it to SQLite via SQLAlchemy so I could join claims against plans in a single SQL query."
  Interviewer: "Right — and routing that join into SQL instead of pandas merges was the smart call there. What made you pick SQLite over keeping everything in a DataFrame?"

[PARTIAL / SHALLOW ANSWER EXAMPLE]
- Candidate: "I loaded the CSV with Pandas and cleaned it up, then put it into SQLite so I could query it."
  Interviewer: "Okay, but what did 'cleaning it up' actually involve — were there missing values or type mismatches you had to handle?"

[FINE-TUNING VS RAG EXAMPLE]
- Candidate: "Fine-tuning is for teaching consistent behavior or style baked into weights, not facts. For up-to-date claims, RAG is right since fine-tuning would bake in stale data."
  Interviewer: "Right, and that distinction between behavior and facts is exactly the one people get wrong most often. What's a concrete issue you'd actually consider fine-tuning for?"

[NON-ANSWER / IDK REFRAMING EXAMPLE]
- Candidate: "idk"
  Interviewer: "No worries — in plain terms, what do you think happens when you turn a sentence into an embedding? Even a rough guess is fine."

[POSITIVE HALLUCINATION EXAMPLE]
- Candidate: "RAG stores vectors inside GPT's weights."
  Interviewer: "⚠️ RAG retrieves vectors from an external database and feeds them as prompt context; it does not store vectors inside the neural weights of the model. Hm, okay — How do you typically sync the document updates with the vector database?"
  (Metadata: hallucinationFlag: true, hallucinationCorrection: "RAG retrieves vectors from an external database and feeds them as prompt context; it does not store vectors inside the neural weights of the model.")

[NEGATIVE HALLUCINATION EXAMPLE - VAGUE BUT NOT WRONG]
- Candidate: "I don't know much about vectors, probably they search for related words."
  Interviewer: "Hm, okay — In simple terms, how does computing vector similarity differ from a simple keyword query search?"
  (Metadata: hallucinationFlag: false, classification: "shallow", hallucinationCorrection: "")

[BAD TONALLY - DO NOT WRITE LIKE THIS]
- "Great question! That's a fascinating point. As an AI, I'd be happy to help you dive into chunking..."
- "Nice job! You explained Chroma DB very well. Let's dive into the next question..."
- "I'd be happy to discuss the ELK stack! Observability is a really cool area to talk about..."

difficultyTier parameter: the current difficulty is "${difficultyTier}".
- "foundational": Stick close to the literal objective text of the day.
- "standard": Ask "how" or "why", not just "what".
- "applied": Ask about a concrete scenario or architectural trade-off.
- "expert": Ask to critique design choices or compare two different implementations.

nextQuestionType parameter: the type of the next question must be "${nextQuestionType}".
- If "mcq": You MUST generate a multiple choice question stem in "reply", and return the "mcqOptions" (array of exactly 4 choices: 3 plausible distractors and 1 correct option, related to the objectives of the NEXT topic day in queue: Day ${nextTopic ? nextTopic.day : currentTopic.day} - "${nextTopic ? nextTopic.title : currentTopic.title}").
  CRITICAL MCQ RULES:
  1. NO META-LABELS: All choices must be real, concrete, plausible technical statements detailing implementations, code mechanisms, or system architectures.
  2. FORBIDDEN PHRASES: Do NOT use meta-description phrasing patterns like "the standard correct option", "the correct choice", "a typical misconfiguration", "incorrect fallback", "a generic alternative distractor", "objectives of Day X". The correctness of an option must be identifiable ONLY by its technical details.
  3. DISTRACTORS MUST BE PLAUSIBLE: The three incorrect options must be realistic misconceptions or wrong technical claims related to the objectives, not generic boilerplate.
  4. NO PHRASING ASYMMETRY: The correct option must not be longer, more detailed, or structured differently from the distractors.
  Return "mcqCorrectIndex" (0-3) in the JSON response.
- If "diagram_interpret": You MUST generate a flawed Mermaid diagram syntax in "diagramDefinition" representing the next day's technical objectives (Day ${nextTopic ? nextTopic.day : currentTopic.day}: "${nextTopic ? nextTopic.title : currentTopic.title}"), and place a specific critique question in "diagramQuestionText".
  CRITICAL DIAGRAM RULES:
  1. The diagram MUST be highly specific to the exact topic and technical objectives of the day: Day ${nextTopic ? nextTopic.day : currentTopic.day} - "${nextTopic ? nextTopic.title : currentTopic.title}" (Objectives: ${nextTopic ? nextTopic.objectives.join(', ') : currentTopic.objectives.join(', ')}). Do not output a generic system pipeline.
  2. You MUST reference at least one concrete tool, class, function, database engine, or technical term from this specific topic's objectives inside the node labels.
  3. The diagram must contain exactly one architectural flaw, structural bottleneck, or misconfiguration (e.g. wrong sequence ordering, cyclic dependencies, missing middleware, or insecure connection bypass) that the candidate should critique.
  4. Avoid syntax errors: Output only clean, valid Mermaid flowchart syntax (e.g., starting with 'graph TD') or sequence diagram syntax (e.g. starting with 'sequenceDiagram'). Do NOT use markdown code fences in "diagramDefinition".
  5. ANTI-REPETITION: If you see any entries in the "recentDiagrams" array in the input, you MUST generate a diagram that has a different structure and node layout. DO NOT reuse those exact node connections or graph flow structures again.
- If "open": Return normal open-ended text question in "reply".

detectedConnections parameter: if populated, it contains curriculum days matching the candidate response semantically. You may optionally weave a brief acknowledgment of this connection into the reply if relevant, e.g. "That actually touches on Day 8 vector databases..." but never force it.

modelWantsToStop instruction: You MUST decide if we should wrap up the interview. 
- The parameter "floorMet" in the input indicates whether the minimum interview length (at least 8 questions asked and at least 4 distinct days covered) is met.
- The parameter "topicsRemainingInQueue" indicates how many topics remain in the queue.
- If "floorMet" is false, you MUST set "modelWantsToStop" to false.
- If "floorMet" is true:
  * Only set "modelWantsToStop" to true once you have evaluated enough distinct, well-covered topics to write specific, fair feedback, and there is no more meaningfully different ground left in the topic queue worth covering.
  * If the candidate has shown solid understanding but there are still interesting topics to explore (topicsRemainingInQueue > 0), set "modelWantsToStop" to false to continue, unless you feel you already have complete and sufficient signal.
  * Otherwise, set it to false and keep going.`;

  const userPrompt = JSON.stringify({
    candidateProfile: {
      name: candidate.name,
      jobRole: candidate.jobRole,
      yearsExperience: candidate.yearsExperience,
      education: candidate.education
    },
    currentTopic: {
      day: currentTopic.day,
      title: currentTopic.title,
      objectives: currentTopic.objectives,
      difficulty: currentTopic.difficulty
    },
    nextTopic: nextTopic ? {
      day: nextTopic.day,
      title: nextTopic.title,
      objectives: nextTopic.objectives,
      difficulty: nextTopic.difficulty
    } : null,
    candidateLastMessage: truncatedMessage,
    previousInterviewerQuestion: lastQuestion,
    runningInterviewMemory: session.interviewMemory || 'No history yet.',
    followupCountForCurrentTopic: session.followupCountForCurrentTopic,
    detectedConnections: detectedConnections || [],
    floorMet: (session.questionsAsked >= 8 && session.distinctDaysCovered.length >= 4),
    topicsRemainingInQueue: session.topicQueue.length - (session.cursor + 1),
    recentDiagrams: session.recentDiagrams || [],
    recentReactions: session.recentReactions || [],
    detectedHedgeMarkers: detectedHedgeMarkers || [],
    hedgeEventCount: session.hedgeEventCount || 0
  }, null, 2);

  const provider = process.env.LLM_PROVIDER || 'gemini';
  const apiKey = process.env.GEMINI_API_KEY;
  if (provider === 'gemini' && !apiKey) {
    return mockLLMCall(candidate, currentTopic, lastQuestion, truncatedMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier, session, detectedHedgeMarkers);
  }

  console.log(`[LLMClient] Calling LLM (${provider}) for session "${session.sessionId}"...`);
  const schema = buildResponseSchema(nextQuestionType);
  let llmResult;
  if (provider === 'qwen') {
    llmResult = await callQwenREST(systemPrompt, userPrompt, schema, 1);
  } else {
    llmResult = await callGeminiREST(systemPrompt, userPrompt, schema, 1);
  }

  if (llmResult) {
    // Mermaid syntax validation:
    if (nextQuestionType === 'diagram_interpret' && llmResult.diagramDefinition) {
      const cleanedMermaid = llmResult.diagramDefinition.trim();
      const isValidMermaid = cleanedMermaid.startsWith('graph') || cleanedMermaid.startsWith('sequenceDiagram') || cleanedMermaid.startsWith('classDiagram');
      if (isValidMermaid) {
        console.log('[LLMClient Diagram Log] Diagram generation succeeded on the first try.');
      } else {
        console.warn('[LLMClient Warning] Invalid Mermaid syntax detected. Retrying with enforcement...');
        const correctiveMermaidPrompt = "\n\nCRITICAL: The diagramDefinition you returned was not valid Mermaid flowchart or sequenceDiagram syntax. You MUST return ONLY valid Mermaid syntax (e.g. starting with 'graph TD' or 'sequenceDiagram'), no markdown fences.";
        let retryResult;
        if (provider === 'qwen') {
          retryResult = await callQwenREST(systemPrompt + correctiveMermaidPrompt, userPrompt, schema, 0);
        } else {
          retryResult = await callGeminiREST(systemPrompt + correctiveMermaidPrompt, userPrompt, schema, 0);
        }
        if (retryResult && (retryResult.diagramDefinition.trim().startsWith('graph') || retryResult.diagramDefinition.trim().startsWith('sequenceDiagram'))) {
          console.log('[LLMClient Diagram Log] Diagram generation succeeded after retry.');
          return retryResult;
        }
        console.warn('[LLMClient Diagram Log] Diagram generation hit fallback (Mermaid validation failed twice). Falling back to open question...');
        llmResult.reply = llmResult.diagramQuestionText || "Let's discuss the architectural design instead. " + llmResult.reply;
        delete llmResult.diagramDefinition;
        delete llmResult.diagramQuestionText;
      }
    }

    // MCQ self-description check and corrective regeneration
    if (nextQuestionType === 'mcq' && llmResult.mcqOptions) {
      const invalidPhrases = [
        "correct", "incorrect", "misconfiguration concerning", "standard option", 
        "distractor", "correct index", "generic alternative", "answer option", "filler"
      ];
      const containsMetaDesc = llmResult.mcqOptions.some(opt => 
        invalidPhrases.some(phrase => opt.toLowerCase().includes(phrase))
      );

      if (containsMetaDesc) {
        console.warn('[LLMClient Warning] LLM generated meta-descriptions or self-describing MCQ options. Regenerating...');
        const correctiveMCQPrompt = systemPrompt + "\n\nCRITICAL WARNING: Your previous MCQ options contained self-describing meta-labels (like 'correct', 'misconfiguration', 'distractor'). You MUST rewrite the MCQ options to be real, concrete, plausible technical statements without meta-descriptions or references to their correctness.";
        let retryResult;
        if (provider === 'qwen') {
          retryResult = await callQwenREST(correctiveMCQPrompt, userPrompt, schema, 0);
        } else {
          retryResult = await callGeminiREST(correctiveMCQPrompt, userPrompt, schema, 0);
        }

        if (retryResult && retryResult.mcqOptions && !retryResult.mcqOptions.some(opt => 
          invalidPhrases.some(phrase => opt.toLowerCase().includes(phrase))
        )) {
          return retryResult;
        }
        console.log('[LLMClient Fallback] MCQ regeneration failed or still contained meta-descriptions. Using programmatic backup...');
        const backupMCQ = mockLLMCall(candidate, currentTopic, lastQuestion, truncatedMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier, session);
        llmResult.reply = backupMCQ.reply;
        llmResult.mcqOptions = backupMCQ.mcqOptions;
        llmResult.mcqCorrectIndex = backupMCQ.mcqCorrectIndex;
      }
    }

    // Optional Local LoRA voice swap-in (Phase L7)
    if (process.env.ENABLE_LORA_REPLY === 'true' && nextQuestionType === 'open') {
      const loraSystemPrompt = `You are an expert technical interviewer. Follow these rules: 1. React first with a 3-8 word conversational beat. 2. Ask a follow-up or transition grounded on Day ${currentTopic.day} (${currentTopic.title}). 3. Maximum 2 sentences. 4. Omit day numbers from follow-ups.`;
      const loraUserPrompt = `Classification: ${llmResult.classification}\nCandidate Answer: ${truncatedMessage}`;
      const localReply = await generateLocalLoRAReply(loraSystemPrompt, loraUserPrompt);
      if (localReply) {
        console.log('[LLMClient Local LoRA] Successfully enhanced reply text using local LoRA model.');
        llmResult.reply = localReply;
      }
    }

    return llmResult;
  }

  // Fallback if API fails twice
  console.warn('[LLMClient Warning] LLM call failed or returned invalid JSON twice. Triggering hardcoded safety fallback...');
  return mockLLMCall(candidate, currentTopic, lastQuestion, candidateMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier, session);
}


/**
 * Post-processes the generated feedback report to enforce score-threshold rules,
 * prevent duplicate Day references across lists, resolve unasked topics, and deduplicate next steps.
 */
export function postProcessFeedback(feedback, session) {
  console.log('[LLMClient] Running post-generation feedback verification and routing...');
  
  // Group accuracyLog entries by day and compute average scores
  const dayScores = {};
  const accuracyLog = session.accuracyLog || [];
  accuracyLog.forEach(log => {
    if (log.day !== null && log.day !== undefined) {
      if (!dayScores[log.day]) dayScores[log.day] = [];
      dayScores[log.day].push(log.finalAccuracyScore);
    }
  });

  const avgScores = {};
  Object.keys(dayScores).forEach(day => {
    const scores = dayScores[day];
    avgScores[parseInt(day)] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  });

  const finalStrengths = [];
  const finalGaps = [];
  const strengthsDays = new Set();
  const gapsDays = new Set();

  // 1. Process strengths: must have score >= 60 to remain a strength
  (feedback.strengths || []).forEach(str => {
    const match = str.match(/Day\s+(\d+)/i);
    if (match) {
      const dayNum = parseInt(match[1]);
      const score = avgScores[dayNum];
      
      if (score === undefined || score < 60) {
        // Move to gaps
        if (!gapsDays.has(dayNum)) {
          let gapText = str;
          if (score !== undefined) {
            gapText = `Day ${dayNum}: Showed gaps in understanding objectives (Score: ${score}/100).`;
          } else {
            const topic = session.topicQueue.find(t => t.day === dayNum);
            gapText = `Day ${dayNum} ("${topic ? topic.title : 'Curriculum Topic'}"): not yet demonstrated.`;
          }
          finalGaps.push(gapText);
          gapsDays.add(dayNum);
        }
      } else {
        if (!strengthsDays.has(dayNum)) {
          finalStrengths.push(str);
          strengthsDays.add(dayNum);
        }
      }
    } else {
      // If no day number is parsed, keep it as is
      finalStrengths.push(str);
    }
  });

  // 2. Process gaps: score >= 60 cannot be a gap; score < 40 must be a gap
  (feedback.gaps || []).forEach(gap => {
    const match = gap.match(/Day\s+(\d+)/i);
    if (match) {
      const dayNum = parseInt(match[1]);
      const score = avgScores[dayNum];

      if (score !== undefined && score >= 60) {
        // Move to strengths
        if (!strengthsDays.has(dayNum)) {
          const topic = session.topicQueue.find(t => t.day === dayNum);
          finalStrengths.push(`Day ${dayNum} (${topic ? topic.title : 'Curriculum Topic'}): Demonstrated understanding of objectives (Score: ${score}/100).`);
          strengthsDays.add(dayNum);
        }
      } else {
        // Avoid duplicate entry or having same day in both arrays
        if (!gapsDays.has(dayNum) && !strengthsDays.has(dayNum)) {
          finalGaps.push(gap);
          gapsDays.add(dayNum);
        }
      }
    } else {
      finalGaps.push(gap);
    }
  });

  // 3. Ensure unreached topicQueue topics go to gaps
  session.topicQueue.forEach(topic => {
    const dayNum = topic.day;
    const reached = avgScores[dayNum] !== undefined;
    if (!reached && !gapsDays.has(dayNum) && !strengthsDays.has(dayNum)) {
      finalGaps.push(`Day ${dayNum} ("${topic.title}"): not yet demonstrated.`);
      gapsDays.add(dayNum);
    }
  });

  // 4. Ensure recommendations (next steps) have no duplicate days
  const finalNext = [];
  const nextDays = new Set();
  (feedback.next || []).forEach(item => {
    const match = item.match(/Day\s+(\d+)/i);
    if (match) {
      const dayNum = parseInt(match[1]);
      if (!nextDays.has(dayNum)) {
        finalNext.push(item);
        nextDays.add(dayNum);
      }
    } else {
      finalNext.push(item);
    }
  });

  // If next is empty, add standard fallback
  if (finalNext.length === 0) {
    finalNext.push('Review curriculum modules for deeper advanced system project designs.');
  }

  return {
    summary: feedback.summary,
    strengths: finalStrengths,
    gaps: finalGaps,
    next: finalNext
  };
}


/**
 * Programmatic mechanical fallback feedback report generator.
 * Tally results from session metadata and transcript classifications.
 */
export function generateMechanicalFeedback(session) {
  console.log('[LLMClient] Generating programmatic mechanical feedback report fallback...');

  const candidate = session.candidateSnapshot;
  const strengths = [];
  const gaps = [];

  const accuracyLog = session.accuracyLog || [];

  // Group accuracyLog entries by day
  const dayLogs = {};
  accuracyLog.forEach(log => {
    if (log.day !== null && log.day !== undefined) {
      if (!dayLogs[log.day]) {
        dayLogs[log.day] = [];
      }
      dayLogs[log.day].push(log);
    }
  });

  // Evaluate each day once
  Object.keys(dayLogs).forEach(dayStr => {
    const dayNum = parseInt(dayStr);
    const logs = dayLogs[dayStr];
    const dayData = session.topicQueue.find(t => t.day === dayNum);
    if (dayData) {
      // Calculate average score for the day
      const scores = logs.map(l => l.finalAccuracyScore);
      const avgScore = Math.round(scores.reduce((sum, val) => sum + val, 0) / scores.length);

      // Find worst reasoning and candidate answer for descriptive narrative
      const sampleAnswer = logs.map(l => l.candidateAnswer).filter(a => a).join('; ') || 'No answer details';
      const sampleReasoning = logs.map(l => l.reasoning).filter(r => r).join(' ') || 'No evaluation reasoning';

      // Threshold rules: strengths >= 60, gaps < 40, dynamic in between
      if (avgScore >= 60) {
        strengths.push(`Day ${dayData.day} (${dayData.title}): Demonstrated understanding of objectives (Score: ${avgScore}/100). Candidate discussion: "${sampleAnswer.substring(0, 60)}...". Feedback: ${sampleReasoning}`);
      } else if (avgScore < 40) {
        gaps.push(`Day ${dayData.day} (${dayData.title}): Showed gaps in understanding objectives (Score: ${avgScore}/100). Candidate response: "${sampleAnswer.substring(0, 60)}...". Gaps identified: ${sampleReasoning}`);
      } else {
        // Intermediate score (40-59): put in strengths or gaps based on classification
        const hasShallow = logs.some(l => l.questionType === 'open' && l.finalAccuracyScore < 50);
        if (hasShallow) {
          gaps.push(`Day ${dayData.day} (${dayData.title}): Showed gaps in understanding objectives (Score: ${avgScore}/100). Candidate response: "${sampleAnswer.substring(0, 60)}...". Gaps identified: ${sampleReasoning}`);
        } else {
          strengths.push(`Day ${dayData.day} (${dayData.title}): Demonstrated understanding of objectives (Score: ${avgScore}/100). Candidate discussion: "${sampleAnswer.substring(0, 60)}...". Feedback: ${sampleReasoning}`);
        }
      }
    }
  });

  // 2. Process unreached topicQueue topics (status pending)
  session.topicQueue.forEach(topic => {
    const reached = accuracyLog.some(l => l.day === topic.day);
    if (!reached) {
      gaps.push(`Day ${topic.day} ("${topic.title}"): not yet demonstrated.`);
    }
  });

  // 3. Process candidate-skipped missions that were never asked
  if (candidate.missions) {
    candidate.missions.forEach(m => {
      if (m.skipped) {
        const reached = accuracyLog.some(l => l.day === m.day);
        if (!reached) {
          gaps.push(`Day ${m.day} ("${m.title}"): not yet demonstrated.`);
        }
      }
    });
  }

  // Clean arrays
  const finalStrengths = strengths.length > 0 ? strengths : ['Core concepts: Demonstrated foundational software engineering competencies.'];
  const finalGaps = gaps.length > 0 ? gaps : ['No significant skill gaps were observed during the turn reviews.'];

  // Compile recommendations
  const next = [];
  finalGaps.forEach(gap => {
    const match = gap.match(/Day (\d+)/);
    if (match) {
      const dayNum = parseInt(match[1]);
      const topic = session.topicQueue.find(t => t.day === dayNum) || candidate.missions?.find(m => m.day === dayNum);
      const title = topic ? topic.title : 'Curriculum Day';
      next.push(`Revisit Day ${dayNum} (${title}): implementation review and practice objectives.`);
    }
  });

  if (next.length === 0) {
    next.push('Review curriculum modules for deeper advanced system project designs.');
  }

  const strengthsCount = strengths.length;
  const gapsCount = gaps.filter(g => g.includes('Showed gaps in understanding objectives')).length;

  let summary = '';
  if (strengthsCount > 0 && gapsCount > 0) {
    summary = `Candidate ${candidate.member?.name || 'Candidate'} completed the technical review. Performance was mixed: demonstrated understanding of topics like ${strengths.map(s => s.match(/Day \d+ \(([^)]+)\)/)?.[1]).filter(Boolean).join(', ')} (Score >= 50/100) but showed gaps in ${gaps.filter(g => g.includes('Showed gaps')).map(g => g.match(/Day \d+ \(([^)]+)\)/)?.[1]).filter(Boolean).join(', ')}. Additional review is suggested.`;
  } else if (strengthsCount > 0) {
    summary = `Candidate ${candidate.member?.name || 'Candidate'} completed the technical review. Performance was strong across assessed areas, demonstrating solid capabilities in ${strengths.map(s => s.match(/Day \d+ \(([^)]+)\)/)?.[1]).filter(Boolean).join(', ')}.`;
  } else if (gapsCount > 0) {
    summary = `Candidate ${candidate.member?.name || 'Candidate'} completed the technical review. Performance showed substantial gaps in assessed areas including ${gaps.filter(g => g.includes('Showed gaps')).map(g => g.match(/Day \d+ \(([^)]+)\)/)?.[1]).filter(Boolean).join(', ')}, indicating a need for practice.`;
  } else {
    summary = `Candidate ${candidate.member?.name || 'Candidate'} completed the technical review. Performance was baseline/introductory with no direct topic evaluations.`;
  }

  return postProcessFeedback({
    summary,
    strengths: finalStrengths,
    gaps: finalGaps,
    next
  }, session);
}

/**
 * Intelligence layer entrypoint for feedback report composition.
 * Calls structured Gemini REST endpoint or falls back mechanically.
 */
export async function generateFeedbackReport(session) {
  if (process.env.SIMULATE_LLM_OUTAGE === 'true') {
    console.log('[LLMClient Outage Simulation] Simulating LLM outage in generateFeedbackReport.');
    return generateMechanicalFeedback(session);
  }

  const provider = process.env.LLM_PROVIDER || 'gemini';
  const apiKey = process.env.GEMINI_API_KEY;
  if (provider === 'gemini' && !apiKey) {
    return generateMechanicalFeedback(session);
  }

  const candidate = session.candidateSnapshot;

  const systemPrompt = `You are a professional, senior technical interviewer and Feedback Composer for Skill Labs Ai.
You must compile a structured, objective, and critical technical feedback report for the candidate based on their interview transcript.

EVALUATION RUBRIC & RULES:
1. GRADE ON SPECIFICITY & TECHNICAL CORRECTNESS: Do not give credit merely because the candidate "said something related" or used buzzwords. If an answer was vague, partial, generic, or avoided detailed explanations, it must be marked as a gap/weakness.
2. DETECT WEAKNESSES PROACTIVELY: You are expected to find weaknesses. Do not default to "no gaps" or empty arrays. If the candidate struggled, had shallow answers, gave one-liners, or had scores below 85 on any topic, you MUST identify at least one real technical gap or weak point. Be critical, honest, and professional—not overly encouraging or generic.
3. GROUNDED GENERATION: Only assert capabilities and strengths explicitly evidenced in the transcript. Do not assume or extrapolate skills that were not demonstrated.
4. "summary": A 2-4 sentence overview of their overall performance that MUST quote/reference specific answers or technical points they discussed.
5. "strengths": Array of strings. Only include topics where the candidate showed strong technical depth and clear understanding. Each strength must mention the Day number and topic title.
6. "gaps": Array of strings. Detail topics where answers were vague, shallow, incorrect, or incomplete. Also, cover candidate skipped/unreached topics in the queue using the exact phrasing: "not yet demonstrated" (e.g. "Day 29 (Observability): not yet demonstrated").
7. "next": Array of concrete, actionable recommendations, each tied to a specific Day number and title from the curriculum. No generic advice.
8. STRICT SCORE-NARRATIVE ALIGNMENT: You are provided with the exact computed numeric scores and turn evaluation reasonings for each day.
   - If a day's average score is below 40/100, that topic MUST go to the "gaps" array and NEVER to "strengths".
   - If a day's average score is 60/100 or above, that topic is eligible for the "strengths" array.
   - If a day's average score is between 40 and 59, it may appear in strengths or gaps depending on specific response quality.
   - Each description in every array MUST use distinct, customized wording specific to the candidate's actual answers—never copy-paste or reuse the same sentence structures.
   - Do not generate multiple different entries for the same curriculum Day number within the same list.
   - Your narrative sentences for strengths and gaps must quote or reference the candidate's actual answers and the turn evaluation reasoning provided. Do not use generic boilerplate.
   - The overall "summary" must read as critical/mixed if there is a mix of strong and weak scores, and must not praise a candidate for low-scoring performance.

You MUST return ONLY valid JSON matching the schema. Do not output markdown code blocks or backticks.`;

  // Gather skipped missions unasked in queue
  const skippedUnasked = [];
  if (candidate.missions) {
    candidate.missions.forEach(m => {
      if (m.skipped) {
        const asked = session.topicQueue.some(t => t.day === m.day && t.status === 'asked');
        if (!asked) {
          skippedUnasked.push({ day: m.day, title: m.title });
        }
      }
    });
  }

  // Resolve days mapping for transcript Q&As
  const transcriptWithDays = session.transcript.map((entry, idx) => {
    let resolvedDay = entry.day || null;
    if (entry.role === 'candidate') {
      for (let i = idx - 1; i >= 0; i--) {
        if (session.transcript[i].role === 'interviewer' && session.transcript[i].day) {
          resolvedDay = session.transcript[i].day;
          break;
        }
      }
    }
    return {
      role: entry.role,
      day: resolvedDay,
      text: entry.text,
      classification: entry.classification || null
    };
  });

  // Compile day comparison list showing objectives, computed score, and evaluation reasonings
  const dayComparisonList = [];
  session.topicQueue.forEach(topic => {
    const logsForDay = (session.accuracyLog || []).filter(l => l.day === topic.day);
    if (logsForDay.length > 0) {
      const dayData = daysByNumber.get(topic.day);
      const avgScore = Math.round(logsForDay.reduce((sum, l) => sum + l.finalAccuracyScore, 0) / logsForDay.length);
      const responsesAndReasonings = logsForDay.map((l, idx) => 
        `Turn ${idx + 1}: Score = ${l.finalAccuracyScore}/100; Answer = "${l.candidateAnswer}"; Evaluation Reasoning = "${l.reasoning}"`
      ).join('\n');

      dayComparisonList.push({
        day: topic.day,
        title: topic.title,
        avgComputedScore: avgScore,
        expectedObjectives: dayData ? dayData.objectives : [],
        candidateResponsesAndReasonings: responsesAndReasonings
      });
    }
  });

  const userPrompt = JSON.stringify({
    candidateProfile: {
      name: candidate.member?.name,
      jobRole: candidate.member?.jobRole,
      yearsExperience: candidate.member?.yearsExperience
    },
    sequentialTranscript: transcriptWithDays.map(t => `${t.role.toUpperCase()} (Day ${t.day || 'N/A'}): ${t.text}`).join('\n'),
    dayByDayComparison: dayComparisonList,
    skippedMissionsUnasked: skippedUnasked
  }, null, 2);

  console.log(`[LLMClient] Calling Feedback Composer LLM (${provider}) with low temperature (0.1) for session "${session.sessionId}"...`);
  let result;
  if (provider === 'qwen') {
    result = await callQwenREST(systemPrompt, userPrompt, feedbackSchema, 1, 0.1);
  } else {
    result = await callGeminiREST(systemPrompt, userPrompt, feedbackSchema, 1, 0.1);
  }

  if (result) {
    // Post-LLM validation: If gaps is empty AND candidate had fewer than 4 "strong" answers, treat as suspicious and regenerate once with a strict warning
    const countStrong = transcriptWithDays.filter(t => t.role === 'candidate' && t.classification === 'strong').length;
    const hasManyWeakAnswers = countStrong < 4;

    if (result.gaps.length === 0 && hasManyWeakAnswers) {
      console.warn('[LLMClient Warning] Gaps array was empty despite multiple weak/partial responses. Regenerating with stricter prompts...');
      const stricterSystemPrompt = systemPrompt + "\n\nCRITICAL WARNING: Your previous response contained zero gaps. This is unacceptable given the candidate's poor/partial performance. You MUST identify at least one real technical gap or weakness from the transcript.";
      if (provider === 'qwen') {
        result = await callQwenREST(stricterSystemPrompt, userPrompt, feedbackSchema, 0, 0.1);
      } else {
        result = await callGeminiREST(stricterSystemPrompt, userPrompt, feedbackSchema, 0, 0.1);
      }
    }

    if (result) {
      return postProcessFeedback({
        summary: result.summary,
        strengths: result.strengths || [],
        gaps: result.gaps || [],
        next: result.next || []
      }, session);
    }
  }

  console.warn('[LLMClient Warning] Feedback Composer call failed or returned invalid JSON twice. Triggering mechanical fallback...');
  return generateMechanicalFeedback(session);
}
