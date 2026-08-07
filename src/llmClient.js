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
        description: 'One of: followup (if answer is partial/shallow and no follow-up has been asked yet), or advance (if strong, off_topic, or follow-up count is already 1).',
        enum: ['followup', 'advance', 'wrapup']
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
      }
    },
    required: ['classification', 'reasoning', 'action', 'reply', 'updatedMemory', 'llmConfidence']
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
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

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
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

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
 * Deterministic offline mock LLM fallback.
 * Uses text characteristics and keywords to generate schema-adherent output.
 */
function mockLLMCall(candidate, topic, lastQuestion, message, followupCount, connections, nextQuestionType, nextTopic, difficultyTier) {
  console.log('[LLMClient] GEMINI_API_KEY not found or call failed. Using offline Mock LLM...');

  const cleanMsg = message.toLowerCase().trim();
  let classification = 'standard';
  let action = 'advance';
  let reasoning = 'Mock evaluation based on keyword analysis and message length.';
  let reply = '';

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
    reply = `You mentioned "${segment}..." - Can you elaborate on the exact mechanism or trade-offs involved in this for Day ${topic.day}?`;
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

  const updatedMemory = `Candidate has completed turn for Day ${topic.day} (${topic.title}). Evaluated as: ${classification}.`;

  const confMap = { strong: 92, partial: 68, shallow: 35, off_topic: 12 };
  const llmConfidence = confMap[classification] || 50;

  const result = {
    classification,
    reasoning,
    action,
    reply,
    updatedMemory,
    llmConfidence
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
    const targetTopic = nextTopic || topic;
    result.reply = `Please examine the diagram below for Day ${targetTopic.day}: "${targetTopic.title}".`;
    result.diagramDefinition = `graph TD\n  A[Client] -->|Query| B(Embeddings)\n  B -->|Search| C[Chroma DB]\n  C -->|Retrieve| D[LLM Prompt]\n  D -.->|Missing Step| A`;
    result.diagramQuestionText = `Identify the missing step or flaw in this connection flow.`;
  }

  return result;
}


/**
 * Main intelligence layer evaluation entrypoint.
 * Assembles prompts, manages Gemini REST vs offline fallback, and validates schemas.
 */
export async function evaluateTurnWithLLM(session, candidateMessage, detectedConnections) {
  const candidate = session.candidateSnapshot;
  const topicIndex = session.cursor;
  const currentTopic = session.topicQueue[topicIndex];
  const nextTopic = session.topicQueue[topicIndex + 1] || null;
  const difficultyTier = session.difficultyTier || 'standard';
  const nextQuestionType = session.nextQuestionType || 'open';

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
    return mockLLMCall(candidate, currentTopic, lastQuestion, truncatedMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier);
  }

  const systemPrompt = `You are a professional, senior technical interviewer conducting a coding and architectural review for Skill Labs Ai.
You must evaluate the candidate's last response for the current topic.

CONSTRAINTS FOR CLASSIFICATION:
- "strong": Candidate demonstrates clear understanding with real specificity.
- "partial": Candidate is directionally right but misses key mechanisms or trade-offs.
- "shallow": Candidate is vague, generic, or just restates the question.
- "off_topic": Candidate response is completely unrelated to the topic.

CONSTRAINTS FOR ACTION & PHRASING:
- "strong" -> Action MUST be "advance".
- "off_topic" -> Action MUST be "advance". You must gently redirect the conversation back in the reply text.
- "partial" or "shallow" -> Action MUST be "followup" (which will be overwritten to "advance" by the server if a follow-up was already asked).
- When action is "followup": The reply MUST reference something concrete or quote a word/phrase from the candidate last message. DO NOT ask generic "can you elaborate?" questions.
- Adjust your vocabulary and question depth based on the candidate's years of experience:
  * Junior candidate (<3 years): Maintain supportive, concept-focused language.
  * Senior candidate (5+ years): Ask for architectural trade-offs, edge cases, scalability, and "why" decisions.

TONE CALIBRATION CONSTRAINTS:
1. NEVER use the following phrases: "great question", "that's a fascinating point", "as an AI", "I'd be happy to", "let's dive into", "sounds like a good plan", or restating the candidate's answer back before responding.
2. STRICT BREVITY: Keep your reply to 1-3 sentences unless presenting a diagram/MCQ. Do not monologue.
3. REALISTIC TERSENESS: Use short neutral acknowledgments ("Right.", "Okay, and—", "Sure.") and ask direct follow-ups or push back on weak answers ("That's part of it, but what actually triggers X?").
4. NO GENERIC PRAISE: Do not say "nice job" or "well explained". Praise must reference a specific correct mechanism named or be omitted entirely.

FEW-SHOT EXAMPLES:
[GOOD TONALLY]
- Candidate: "I used Chroma DB to cache context."
  Interviewer: "Okay, and how did you configure the chunking strategy to prevent context fragmentation?"
- Candidate: "We did basic prompting."
  Interviewer: "Right. What specific prompt-engineering pattern did you implement to handle boundary cases?"
- Candidate: "We set up an ELK stack but it crashed under load."
  Interviewer: "Sure. What was the exact bottleneck that caused the crash, and how did you diagnose it?"

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
- If "open": Return normal open-ended text question in "reply".

detectedConnections parameter: if populated, it contains curriculum days matching the candidate response semantically. You may optionally weave a brief acknowledgment of this connection into the reply if relevant, e.g. "That actually touches on Day 8 vector databases..." but never force it.`;

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
    topicsRemainingInQueue: session.topicQueue.length - (session.cursor + 1)
  }, null, 2);

  const provider = process.env.LLM_PROVIDER || 'gemini';
  const apiKey = process.env.GEMINI_API_KEY;
  if (provider === 'gemini' && !apiKey) {
    return mockLLMCall(candidate, currentTopic, lastQuestion, truncatedMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier);
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
      if (!isValidMermaid) {
        console.warn('[LLMClient Warning] Invalid Mermaid syntax detected. Retrying with enforcement...');
        const correctiveMermaidPrompt = "\n\nCRITICAL: The diagramDefinition you returned was not valid Mermaid flowchart or sequenceDiagram syntax. You MUST return ONLY valid Mermaid syntax (e.g. starting with 'graph TD' or 'sequenceDiagram'), no markdown fences.";
        let retryResult;
        if (provider === 'qwen') {
          retryResult = await callQwenREST(systemPrompt + correctiveMermaidPrompt, userPrompt, schema, 0);
        } else {
          retryResult = await callGeminiREST(systemPrompt + correctiveMermaidPrompt, userPrompt, schema, 0);
        }
        if (retryResult && (retryResult.diagramDefinition.trim().startsWith('graph') || retryResult.diagramDefinition.trim().startsWith('sequenceDiagram'))) {
          return retryResult;
        }
        console.warn('[LLMClient Fallback] Mermaid retry failed. Falling back to open question...');
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
        const backupMCQ = mockLLMCall(candidate, currentTopic, lastQuestion, truncatedMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier);
        llmResult.reply = backupMCQ.reply;
        llmResult.mcqOptions = backupMCQ.mcqOptions;
        llmResult.mcqCorrectIndex = backupMCQ.mcqCorrectIndex;
      }
    }

    return llmResult;
  }

  // Fallback if API fails twice
  console.warn('[LLMClient Warning] LLM call failed or returned invalid JSON twice. Triggering hardcoded safety fallback...');
  return mockLLMCall(candidate, currentTopic, lastQuestion, candidateMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier);
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

      // 50 is the cutoff threshold:
      // If score is below 50, it goes to gaps.
      // If score is 50 or above, it goes to strengths.
      if (avgScore >= 50) {
        strengths.push(`Day ${dayData.day} (${dayData.title}): Demonstrated understanding of objectives (Score: ${avgScore}/100). Candidate discussion: "${sampleAnswer.substring(0, 60)}...". Feedback: ${sampleReasoning}`);
      } else {
        gaps.push(`Day ${dayData.day} (${dayData.title}): Showed gaps in understanding objectives (Score: ${avgScore}/100). Candidate response: "${sampleAnswer.substring(0, 60)}...". Gaps identified: ${sampleReasoning}`);
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

  return {
    summary,
    strengths: Array.from(new Set(finalStrengths)),
    gaps: Array.from(new Set(finalGaps)),
    next: Array.from(new Set(next))
  };
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
   - If a day's average score is below 50/100, that topic MUST go to the "gaps" array and NEVER to "strengths".
   - If a day's average score is 50/100 or above, that topic can go to "strengths" (or "gaps" if there are specific concerns).
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
      return {
        summary: result.summary,
        strengths: Array.from(new Set(result.strengths || [])),
        gaps: Array.from(new Set(result.gaps || [])),
        next: Array.from(new Set(result.next || []))
      };
    }
  }

  console.warn('[LLMClient Warning] Feedback Composer call failed or returned invalid JSON twice. Triggering mechanical fallback...');
  return generateMechanicalFeedback(session);
}
