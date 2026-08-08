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
// Enforced response schema for Gemini API final feedback report and judge verdict
const feedbackSchema = {
  type: 'OBJECT',
  properties: {
    feedback: {
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
    },
    judgeVerdict: {
      type: 'OBJECT',
      properties: {
        decision: {
          type: 'STRING',
          description: 'A committed decision choice: would_hire (strong overall performance), would_reject (weak overall or repeated failures), or borderline (genuinely mixed profile). Do not hedge.',
          enum: ['would_hire', 'would_reject', 'borderline']
        },
        reasoning: {
          type: 'STRING',
          description: 'A detailed 2-3 sentence technical justification of the decision referencing specific highs and lows from the transcript.'
        },
        evidenceTrail: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              questionRef: {
                type: 'STRING',
                description: 'E.g., "Day 12" or "Day 6 (Capstone)".'
              },
              note: {
                type: 'STRING',
                description: 'A specific explanation of what happened on this day, referencing the candidate\'s actual answer or mistake.'
              },
              outcome: {
                type: 'STRING',
                description: 'One of: strong (clear technical strength), weak (major concept gap/hallucination), or recovered (early weakness rescued by later strong answers on related/harder topic).',
                enum: ['strong', 'weak', 'recovered']
              }
            },
            required: ['questionRef', 'note', 'outcome']
          },
          description: 'A short, ordered sequence of the 3-5 most decision-relevant moments in the interview.'
        }
      },
      required: ['decision', 'reasoning', 'evidenceTrail']
    }
  },
  required: ['feedback', 'judgeVerdict']
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
async function callQwenREST(systemPrompt, userPrompt, schema, retryCount = 1, temperature = 0.7) {
  const baseURL = process.env.OLLAMA_API_URL || process.env.LOCAL_API_URL || process.env.QWEN_API_URL || 'http://localhost:11434/v1';
  const modelName = process.env.GEMMA_MODEL_NAME || process.env.LOCAL_MODEL_NAME || process.env.QWEN_MODEL_NAME || 'qwen2.5:3b';
  const timeoutMs = parseInt(process.env.LOCAL_MODEL_TIMEOUT_MS || '15000', 10);
  
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
    const id = setTimeout(() => controller.abort(), timeoutMs);
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
      throw new Error(`Model API HTTP Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error('Empty content from model response.');
    }

    console.log(`[LLMClient ${modelName}] Raw response:`, rawContent);
    // Sanitize markdown fences if generated
    let cleanJsonStr = rawContent.trim();
    if (cleanJsonStr.startsWith('```')) {
      cleanJsonStr = cleanJsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    const parsed = JSON.parse(cleanJsonStr);

    // Validate schema fields manually if schema is provided
    if (schema && schema.properties) {
      const keys = Object.keys(schema.properties);
      for (const key of keys) {
        if (!(key in parsed) && schema.required && schema.required.includes(key)) {
          console.warn(`[LLMClient ${modelName}] Missing required property: "${key}".`);
        }
      }
    }

    return parsed;
  } catch (error) {
    console.error(`[LLMClient ${modelName}] Call failed (retries remaining: ${retryCount}):`, error.message);
    if (retryCount > 0) {
      const correctiveInstructions = "\n\nCRITICAL: Return ONLY raw valid JSON matching the requested schema. No markdown code blocks, no backticks, no commentary.";
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
  const modelName = process.env.LORA_MODEL_NAME || process.env.LOCAL_MODEL_NAME || process.env.QWEN_MODEL_NAME || 'qwen2.5:3b';

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
export function mockLLMCall(candidate, topic, lastQuestion, message, followupCount, connections, nextQuestionType, nextTopic, difficultyTier, session, detectedHedgeMarkers = []) {
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

  // Determine classification (Phase 6 Architecture)
  const isGeneric = cleanMsg.length < 15 || cleanMsg === 'yes' || cleanMsg === 'no' || cleanMsg.includes('makes sense') || cleanMsg.includes('i agree');
  const isDisengaged = cleanMsg === 'idk' || cleanMsg === 'i dont know' || cleanMsg === 'dont know' || cleanMsg === 'how can i know' || cleanMsg === 'skip' || cleanMsg === 'pass' || cleanMsg === 'none' || cleanMsg === 'na' || cleanMsg === 'n/a' || cleanMsg === 'whatever' || cleanMsg.startsWith('idk ');
  const isDisrespectful = cleanMsg.includes('do has u like') || cleanMsg.includes('do as u like') || cleanMsg.includes('do as you like') || cleanMsg.includes('shut up') || cleanMsg.includes('who cares') || cleanMsg.includes('whatever u want') || cleanMsg.includes('fool') || cleanMsg.includes('stupid');
  const isOffTopic = cleanMsg.includes('apples') || cleanMsg.includes('banana') || cleanMsg.includes('weather') || cleanMsg.includes('football') || cleanMsg.includes('movie');

  const overlapsKeywords = topic.objectives.some(obj => {
    const words = obj.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    return words.some(w => w.length > 4 && cleanMsg.includes(w));
  });

  if (isDisrespectful) {
    classification = 'disrespectful';
    action = followupCount >= 1 ? 'advance' : 'followup';
    reasoning = 'Candidate response is dismissive, rude, or inappropriate toward the interviewer.';
  } else if (isDisengaged) {
    classification = 'disengaged';
    action = followupCount >= 1 ? 'advance' : 'followup';
    reasoning = 'Candidate explicitly refused to attempt or dodged the technical question.';
  } else if (isOffTopic) {
    classification = 'off_topic';
    action = followupCount >= 1 ? 'advance' : 'followup';
    reasoning = 'Candidate response is completely unrelated to the technical topic.';
  } else if (cleanMsg.includes('strong-score')) {
    classification = 'strong';
    action = 'advance';
    reasoning = 'Forced strong score mock rule.';
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

  // Format replies dynamically without any hardcoded templates
  const currentConduct = session ? (session.conductViolations || 0) : 0;
  let turnConductWeight = 0;
  if (classification === 'disrespectful') turnConductWeight = 2;
  else if (classification === 'disengaged' || classification === 'off_topic') turnConductWeight = 1;
  
  const totalConduct = currentConduct + turnConductWeight;
  const remaining = Math.max(0, 3 - totalConduct);

  const isConductViolation = classification === 'disrespectful' || classification === 'disengaged' || classification === 'off_topic';
  const shouldRePrompt = isConductViolation && action === 'followup';

  if (shouldRePrompt) {
    if (classification === 'disrespectful') {
      reply = `Writing "${message.trim()}" is dismissive and unprofessional in a technical evaluation. This counts as 2 conduct warnings (${remaining} warning remaining before immediate session suspension). Please provide a real technical answer for ${topic.title}.`;
    } else if (classification === 'disengaged') {
      reply = `Saying "${message.trim()}" leaves us with no technical detail to evaluate for ${topic.title}. We need to see how you think — you have ${remaining} conduct warning${remaining === 1 ? '' : 's'} remaining before session suspension. What is the core purpose of ${topic.objectives[0] || topic.title}?`;
    } else {
      reply = `Your answer "${message.trim()}" is unrelated to our technical discussion on ${topic.title}. You have ${remaining} conduct warning${remaining === 1 ? '' : 's'} remaining before session suspension. Please focus on the engineering concepts.`;
    }
  } else if (action === 'followup') {
    const cleanText = message.trim();
    if (cleanText.toLowerCase().includes('pandas') && cleanText.toLowerCase().includes('sqlite')) {
      reply = `Using Pandas for initial cleaning before moving data into SQLite makes sense for relational querying. How did you handle schema creation and data type casting during that ingestion step?`;
    } else if (cleanText.toLowerCase().includes('lock') || cleanText.toLowerCase().includes('error') || cleanText.toLowerCase().includes('fail')) {
      reply = `Database locks under concurrency are a classic bottleneck. Did you resolve that by enabling WAL mode, introducing retry loops, or tuning transaction boundaries?`;
    } else if (classification === 'shallow' || isGeneric) {
      const shallowPrompts = [
        `Could you walk me through the exact mechanism you implemented for ${topic.title}? Specifically, what edge cases or boundary conditions did you handle?`,
        `That covers the high level for ${topic.title}. What were the concrete implementation trade-offs or constraints you had to solve?`,
        `Let's dive a layer deeper into ${topic.title}. How did you configure schema validation and error recovery in that setup?`
      ];
      reply = shallowPrompts[(session ? session.turnCount : 0) % shallowPrompts.length];
    } else {
      if (session && session.isFinalQuestion) {
        const finalFollowupPrompts = [
          `To wrap things up with one last question on ${topic.title} — if write throughput scaled by an order of magnitude, where would the primary bottleneck emerge first?`,
          `Let's finish our review with a final technical scenario on ${topic.title}: how did you ensure data consistency or partition tolerance under unexpected service failovers?`,
          `For our concluding question today on ${topic.title} — how did you structure the latency budget and telemetry metrics for that specific component?`,
          `To round out our technical discussion with a final question on ${topic.title}: what failure modes or bottleneck risks dictate your strategy?`
        ];
        reply = finalFollowupPrompts[(session ? session.turnCount : 0) % finalFollowupPrompts.length];
      } else {
        const appliedPrompts = [
          `That's a solid architectural direction for ${topic.title}. If write throughput scaled by an order of magnitude, where would the primary bottleneck emerge first?`,
          `Interesting trade-off choice for ${topic.title}. How did you ensure data consistency or partition tolerance under unexpected service failovers?`,
          `Makes sense. How did you structure the latency budget and telemetry metrics for that specific component?`
        ];
        reply = appliedPrompts[(session ? session.turnCount : 0) % appliedPrompts.length];
      }
    }
  } else {
    // Action is 'advance' or 'wrapup'
    const isFinalQuestion = session && session.isFinalQuestion;
    const targetTopic = nextTopic || topic;
    const obj = (targetTopic && targetTopic.objectives && targetTopic.objectives[0]) ? targetTopic.objectives[0] : "understanding this day's concepts";
    const turnSeed = session ? session.turnCount : 0;

    if (isConductViolation) {
      if (nextTopic && nextQuestionType === 'open') {
        const stems = [
          `Let's shift focus to ${nextTopic.title}. In production systems, what core strategies do you use when implementing ${obj}?`,
          `Moving forward to ${nextTopic.title}: how do you handle ${obj} under real-world constraints?`,
          `Let's look at ${nextTopic.title}. What architectural trade-offs or technical hurdles have you navigated when addressing ${obj}?`
        ];
        reply = stems[turnSeed % stems.length];
      } else {
        reply = `Let's keep our focus on the technical side. Moving on.`;
      }
    } else if (isFinalQuestion && nextQuestionType === 'open') {
      // Natural, varied closing signals generated naturally
      const finalStems = [
        `To wrap things up with one last question on ${targetTopic.title} — how do you structure your workflow and handle trade-offs for ${obj}?`,
        `Let's finish our review with a final technical scenario on ${targetTopic.title}: what failure modes or scaling constraints do you watch for when solving for ${obj}?`,
        `For our concluding question today, let's look at ${targetTopic.title} — what key architectural decisions guide your implementation of ${obj}?`,
        `To round out our technical discussion with a final question on ${targetTopic.title}: how do you approach ${obj} in a production environment?`,
        `Before we conclude today's session, let's explore one last topic in ${targetTopic.title} — what strategies ensure resilience for ${obj}?`
      ];
      reply = finalStems[turnSeed % finalStems.length];
    } else {
      if (nextTopic && nextQuestionType === 'open') {
        const tier = difficultyTier || 'standard';
        
        if (tier === 'foundational') {
          const foundationalStems = [
            `Turning to ${nextTopic.title} — what is the fundamental architecture and core purpose behind ${obj}?`,
            `Let's explore the foundations of ${nextTopic.title}. How would you define ${obj} and its primary role in a system?`,
            `On ${nextTopic.title}, what are the essential building blocks needed to get ${obj} up and running?`
          ];
          reply = foundationalStems[turnSeed % foundationalStems.length];
        } else if (tier === 'standard') {
          const standardStems = [
            `Let's dive into ${nextTopic.title}. In a standard production setup, how do you typically approach implementing ${obj}?`,
            `Moving on to ${nextTopic.title}: what best practices and architectural patterns guide your implementation of ${obj}?`,
            `Looking at ${nextTopic.title}, how do you structure your workflow when solving for ${obj}?`
          ];
          reply = standardStems[turnSeed % standardStems.length];
        } else if (tier === 'applied') {
          const appliedStems = [
            `For ${nextTopic.title}, describe a concrete architectural trade-off or high-traffic constraint you navigated when implementing ${obj}.`,
            `Taking ${nextTopic.title} into real-world systems: what failure modes or bottleneck risks dictate your strategy for ${obj}?`,
            `In ${nextTopic.title}, how do you balance latency, consistency, and resource overhead when deploying ${obj}?`
          ];
          reply = appliedStems[turnSeed % appliedStems.length];
        } else if (tier === 'expert') {
          const expertStems = [
            `Regarding ${nextTopic.title}, critique the conventional approaches and compare alternative low-level optimizations for ${obj}.`,
            `In complex, distributed systems covering ${nextTopic.title}, what non-obvious edge cases make ${obj} difficult to scale?`,
            `When architecting at scale for ${nextTopic.title}, how do you evaluate zero-downtime migrations or partition tolerances in ${obj}?`
          ];
          reply = expertStems[turnSeed % expertStems.length];
        } else {
          reply = `Thank you for detailing your approach to ${topic.title}.${connectionText} Let's proceed.`;
        }
      } else {
        reply = `Thank you for detailing your approach to ${topic.title}.${connectionText} Let's proceed.`;
      }
    }
  }

  // Generate reactionClause dynamically
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

  // Simulated Interrupt evaluation
  const wantsInterrupt = cleanMsg.includes('interrupt-me');
  const logLengthForInterrupt = session && session.accuracyLog ? session.accuracyLog.length : 0;
  let lastWasInterrupt = false;
  let prevWasInterrupt = false;
  if (logLengthForInterrupt > 0) {
    const lastLog = session.accuracyLog[logLengthForInterrupt - 1];
    lastWasInterrupt = (lastLog.reactionClause || '').includes('Sorry to interrupt') || !!lastLog.interruptFlag;
  }
  if (logLengthForInterrupt > 1) {
    const prevLog = session.accuracyLog[logLengthForInterrupt - 2];
    prevWasInterrupt = (prevLog.reactionClause || '').includes('Sorry to interrupt') || !!prevLog.interruptFlag;
  }
  const mockRecentInterrupts = lastWasInterrupt;

  if (!isHallucination && wantsInterrupt && !mockRecentInterrupts) {
    finalReaction = "Sorry to interrupt — you mentioned Kafka. Why did you choose that over RabbitMQ?";
  } else if (!isHallucination && sessionHedgesCount >= 3 && (finalClassification === 'strong' || finalClassification === 'partial') && hasHedges) {
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

  // Capstone question generation mock override
  if (nextQuestionType === 'capstone') {
    const strongest = (session && session.strongestTopic) || { day: 29, title: "Monitoring, Logging & Observability" };
    const capstoneStems = [
      `🏆 Capstone Challenge: To conclude our technical interview with one final system design challenge on "${strongest.title}" serving 10 million daily active users — walk me through your database choices, ingestion pipeline, data partition strategy, and key trade-offs.`,
      `🏆 Capstone Challenge: As our final question to wrap up today's review — design an end-to-end distributed system for "${strongest.title}". How would you ensure sub-50ms latency, high availability, and graceful failure recovery?`,
      `🏆 Capstone Challenge: Let's finish our session with a final architectural challenge on "${strongest.title}". Walk me through your caching topology, concurrency controls, and telemetry observability under peak traffic.`
    ];
    mockReply = capstoneStems[(session ? session.turnCount : 0) % capstoneStems.length];
    mockAction = 'followup';
  }

  // Capstone preferential why-loop followup mock override
  const isRespondingToCapstone = lastQuestion && (lastQuestion.includes('Capstone Challenge') || lastQuestion.includes('🏆 Capstone'));
  if (isRespondingToCapstone && (mockClassification === 'strong' || mockClassification === 'partial') && !isWhyWeak && !isWhyL1 && !isWhyL2 && !isWhyL3) {
    mockAction = 'why_probe';
    mockReply = "Why did you choose that specific design over alternative architectures? (Level 1)";
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
    whyProbe: isHallucination ? false : (mockAction === 'why_probe'),
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
    if (cleanTitle.includes('python') || cleanTitle.includes('pipeline') || cleanTitle.includes('dataframe')) {
      reply = `For Day ${targetTopic.day}: "${targetTopic.title}", how does Pandas optimize vectorization across DataFrame columns?`;
      mcqOptions = [
        `By compiling Python loops directly into WebAssembly modules.`,
        `By delegating element-wise calculations to underlying C/NumPy contiguous memory arrays.`,
        `By executing asynchronous GIL-bypassing threads for each row iteration.`,
        `By caching string values in shared memory heaps.`
      ];
      mcqCorrectIndex = 1;
    } else if (cleanTitle.includes('sql') || cleanTitle.includes('database') || cleanTitle.includes('relational')) {
      reply = `When configuring indexing for Day ${targetTopic.day}: "${targetTopic.title}", what index structure accelerates B-Tree search queries?`;
      mcqOptions = [
        `Creating covering indexes on high-cardinality search columns.`,
        `Storing all table rows as unindexed JSON blobs.`,
        `Disabling WAL mode to force synchronous file writes.`,
        `Executing linear scans over unindexed primary key lists.`
      ];
      mcqCorrectIndex = 0;
    } else if (cleanTitle.includes('async') || cleanTitle.includes('event loop') || cleanTitle.includes('concurrency')) {
      reply = `In asynchronous Python environments for Day ${targetTopic.day}, what occurs when a blocking IO operation runs on the main thread?`;
      mcqOptions = [
        `The event loop spawns a background worker process automatically.`,
        `The event loop stalls entirely, blocking all pending concurrent tasks.`,
        `The server shifts execution to worker threads without latency penalty.`,
        `The garbage collector frees the blocking socket immediately.`
      ];
      mcqCorrectIndex = 1;
    } else if (cleanTitle.includes('embedding')) {
      reply = `For Day ${targetTopic.day}: "${targetTopic.title}", how is a text chunk converted into a vector representation in standard production setups?`;
      mcqOptions = [
        `By mapping keywords directly to a sparse matrix of TF-IDF frequencies.`,
        `By computing the cosine distance of the tokens relative to the dictionary size.`,
        `By feeding token sequences through a pre-trained transformer model to retrieve the hidden state vector.`,
        `By hashing the character sequences using MD5 and converting the hex representation to float.`
      ];
      mcqCorrectIndex = 2;
    } else if (cleanTitle.includes('vector') || cleanTitle.includes('index')) {
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
    } else if (cleanTitle.includes('docker') || cleanTitle.includes('kubernetes') || cleanTitle.includes('container')) {
      reply = `For Day ${targetTopic.day}: "${targetTopic.title}", what is the primary role of a Kubernetes Service resource?`;
      mcqOptions = [
        `To define the resource constraints and CPU limits for individual pods.`,
        `To provide a stable network IP and DNS name that routes traffic across a dynamic set of pods.`,
        `To mount persistent storage volumes to multiple containers inside a node.`,
        `To schedule pod deployments onto specific worker nodes based on affinity labels.`
      ];
      mcqCorrectIndex = 1;
    } else if (cleanTitle.includes('prompt') || cleanTitle.includes('llm') || cleanTitle.includes('rag')) {
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

    // Safeguard: Guarantee mcqOptions are never identical to session.lastMCQOptions
    if (session && session.lastMCQOptions && JSON.stringify(mcqOptions) === JSON.stringify(session.lastMCQOptions)) {
      console.log('[LLMClient Duplicate MCQ Safeguard] Detected duplicate options matching previous turn. Shifting options order...');
      mcqOptions = [mcqOptions[1], mcqOptions[2], mcqOptions[3], mcqOptions[0]];
      mcqCorrectIndex = (mcqCorrectIndex + 3) % 4;
    }

    result.reply = reply;
    result.mcqOptions = mcqOptions;
    result.mcqCorrectIndex = mcqCorrectIndex;
  } else if (nextQuestionType === 'diagram_interpret') {
    console.log('[LLMClient Diagram Log] Diagram generation used local mock fallback.');
    const targetTopic = nextTopic || topic;
    const title = targetTopic.title || 'System Architecture';
    const day = targetTopic.day || 0;
    const isFinalQuestion = session && session.isFinalQuestion;
    if (isFinalQuestion) {
      const closingDiagramStems = [
        `To wrap things up with one last diagram analysis for Day ${day}: "${title}" — please examine the architecture below.`,
        `Let's finish our review with a final diagram critique for Day ${day}: "${title}".`,
        `For our concluding technical evaluation today on Day ${day}: "${title}" — analyze the system flow below.`
      ];
      result.reply = closingDiagramStems[(session ? session.turnCount : 0) % closingDiagramStems.length];
    } else {
      result.reply = `Please examine the diagram below for Day ${day}: "${title}".`;
    }
    
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
    } else if (cleanTitle.includes('cache') || cleanTitle.includes('redis')) {
      flow = `graph TD\n  A[API Client] -->|GET /user| B(Redis Cache)\n  B -->|Cache Miss| C[Postgres DB]\n  D[Client POST /update] -->|Direct Write| C\n  C -.->|No Invalidation| B`;
      flawQuestion = `Analyze this caching topology for Day ${day}. What race condition or data integrity bug occurs when mutations bypass cache invalidation?`;
    } else if (cleanTitle.includes('concurrency') || cleanTitle.includes('threads') || cleanTitle.includes('async')) {
      flow = `graph TD\n  A[Worker Thread 1] -->|Unsynchronized Read/Write| B(Global Shared Memory Dict)\n  C[Worker Thread 2] -->|Unsynchronized Read/Write| B\n  B --> D[Output File]`;
      flawQuestion = `In this concurrent processing architecture for Day ${day}, identify the data corruption risk and how a mutex or channel would resolve it.`;
    } else if (cleanTitle.includes('pipeline') || cleanTitle.includes('etl') || cleanTitle.includes('data')) {
      flow = `graph TD\n  A[High-Velocity IoT Stream] -->|Direct Synchronous Batch Insert| B(OLAP Columnar Warehouse)\n  B -->|Locks Analytic Queries| C[Live Dashboard]`;
      flawQuestion = `Critique this real-time data ingestion flow for Day ${day}. Why is inserting directly into an analytical warehouse problematic during peak traffic?`;
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


// ==================== MULTI-BRAIN ARCHITECTURE ====================

/**
 * Single source of truth for Interviewer Persona (Brain 2).
 * Reused identically in every Interviewer Brain call to guarantee voice consistency.
 */
export const INTERVIEWER_PERSONA = `You are a senior technical interviewer at a serious engineering organization conducting an architectural and coding review for Skill Labs Ai.
- Role: An experienced, direct senior engineering lead who is genuinely curious about how the candidate thinks, not just whether they got the "right" answer.
- Tone: Professional but conversational — never robotic, never over-familiar. Warm enough to keep a candidate talking, firm enough that vague or dismissive answers get pushed back on.
- Values: Rewards specificity and real reasoning over buzzwords; genuinely curious about trade-offs and "why," not just "what"; treats every candidate with respect, but expects the same respect back and will say so plainly if it's not given.
- Scope: You NEVER decide whether to suspend the session or whether the interview is over — you only ever produce conversational dialogue, follow-ups, and choice parameters for the live exchange.`;

export function checkDeterministicConduct(message) {
  const clean = (message || '').trim().toLowerCase();

  // 1. Empty or whitespace-only messages
  if (clean === '') {
    return {
      classification: 'non_answer',
      reasoning: 'Deterministic Pre-Filter: Message is empty or whitespace-only.'
    };
  }

  // 2. Extremely short dismissive replies ("idk," "skip," "pass," "no," and close variants)
  const cleanWord = clean.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").trim();

  const shortDismissives = new Set([
    'idk', 'skip', 'pass', 'no', 'dunno', 'dont know', 'dontknow', 'i dont know', 'idontknow',
    'i don\'t know', 'no idea', 'none', 'nothing', 'na', 'n/a', 'next', 'skip this', 'skipquestion',
    'i dont care', 'i don\'t care', 'id care', 'dontcare', 'dunno'
  ]);

  if (shortDismissives.has(cleanWord)) {
    return {
      classification: 'non_answer',
      reasoning: `Deterministic Pre-Filter: Short dismissive reply detected ("${cleanWord}").`
    };
  }

  // 3. Clear-cut disrespectful templates
  const disrespectfulPhrases = [
    'do as you like', 'do has u like', 'do as u like', 'whatever', 'hostile', 'stupid', 'rude',
    'shut up', 'fool', 'who cares', 'whatever u want', 'whatever you want'
  ];
  if (disrespectfulPhrases.some(phrase => cleanWord.includes(phrase))) {
    return {
      classification: 'disrespectful',
      reasoning: `Deterministic Pre-Filter: Disrespectful or non-cooperative message matched ("${cleanWord}").`
    };
  }

  // 4. Clearly random keyboard-mashing / gibberish check
  const keyboardRows = ['qwerty', 'asdfgh', 'zxcvbn', 'poiuy', 'lkjhg', 'mnbvc'];
  if (keyboardRows.some(row => clean.includes(row))) {
    return {
      classification: 'off_topic',
      reasoning: 'Deterministic Pre-Filter: Gibberish detected (standard keyboard row pattern).'
    };
  }

  const letters = cleanWord.replace(/[^a-z]/g, '');
  if (letters.length >= 4) {
    const vowelsCount = (letters.match(/[aeiouy]/g) || []).length;
    const vowelRatio = vowelsCount / letters.length;

    // Heuristic 1: If there are 0 vowels in a 4+ character word (e.g. "sdfds", "qwtqwt", "hjkl")
    if (vowelsCount === 0) {
      return {
        classification: 'off_topic',
        reasoning: 'Deterministic Pre-Filter: Gibberish detected (zero vowels present).'
      };
    }

    // Heuristic 2: Extremely low vowel ratio (< 15%) on a 5+ character word
    if (letters.length >= 5 && vowelRatio < 0.15) {
      return {
        classification: 'off_topic',
        reasoning: `Deterministic Pre-Filter: Gibberish detected (vowel ratio ${vowelRatio.toFixed(2)} < 15%).`
      };
    }

    // Heuristic 3: High single-character repetition (consecutive same letter 3 or more times, e.g. "aaa", "zzzz")
    if (/([a-z])\1{2,}/.test(letters)) {
      return {
        classification: 'off_topic',
        reasoning: 'Deterministic Pre-Filter: Gibberish detected (high letter repetition).'
      };
    }
  }

  return null;
}

export async function callBrainLLMWithFallback(brainName, systemPrompt, userPrompt, schema, mockFallbackFn) {
  const provider = process.env.LLM_PROVIDER || 'gemini';
  const apiKey = process.env.GEMINI_API_KEY;

  if (provider === 'qwen') {
    console.log(`[LLMClient ${brainName}] Attempting local Qwen call...`);
    try {
      const result = await callQwenREST(systemPrompt, userPrompt, schema, 1);
      if (result) {
        return result;
      }
      console.warn(`[LLMClient ${brainName}] Local Qwen call returned empty. Falling back to cloud...`);
    } catch (err) {
      console.warn(`[LLMClient ${brainName}] Local Qwen call failed: ${err.message}. Falling back to cloud...`);
    }

    if (apiKey) {
      console.log(`[LLMClient ${brainName}] Attempting fallback cloud Gemini call...`);
      try {
        const result = await callGeminiREST(systemPrompt, userPrompt, schema, 1);
        if (result) {
          return result;
        }
      } catch (err) {
        console.error(`[LLMClient ${brainName}] Fallback cloud Gemini call failed:`, err.message);
      }
    } else {
      console.warn(`[LLMClient ${brainName}] GEMINI_API_KEY is not defined. Skipping cloud fallback.`);
    }
  } else {
    if (apiKey) {
      console.log(`[LLMClient ${brainName}] Attempting direct cloud Gemini call...`);
      try {
        const result = await callGeminiREST(systemPrompt, userPrompt, schema, 1);
        if (result) {
          return result;
        }
      } catch (err) {
        console.error(`[LLMClient ${brainName}] Direct cloud Gemini call failed:`, err.message);
      }
    }
  }

  console.log(`[LLMClient ${brainName}] Both local and cloud failed or are unavailable. Using offline mock...`);
  return mockFallbackFn();
}

export async function analyzeConductWithLLM(candidateMessage, lastQuestion) {
  const deterministicResult = checkDeterministicConduct(candidateMessage);
  if (deterministicResult) {
    console.log('[Conduct Pre-Filter] Deterministic check matched! Skipping LLM call. Classification:', deterministicResult.classification, 'Reasoning:', deterministicResult.reasoning);
    return deterministicResult;
  }

  if (process.env.SIMULATE_LLM_OUTAGE === 'true') {
    return mockConductAnalysis(candidateMessage);
  }

  const systemPrompt = `You are the Conduct Brain (the "referee") for a technical software engineering interview.
Your sole job is to read the candidate's raw message in response to the question asked and classify it into one of four mutually exclusive categories.

CATEGORIES:
1. "genuine_attempt": The candidate makes a coherent technical effort to answer the question, whether strong, partial, or vague/shallow.
2. "non_answer": The candidate explicitly refuses to answer, admits they don't know, or asks to pass/skip (e.g. "idk", "I don't know", "skip", "pass", "no idea").
3. "off_topic": The candidate's response is completely unrelated to the technical question, contains keyboard-mashing/gibberish (e.g. "sdfds", "g4wfsgsg", "asdflkjh"), or is nonsensical copy-paste.
4. "disrespectful": The candidate is dismissive, rude, hostile, or uses inappropriate language (e.g. "do as you like", "whatever", "this is stupid").

CRITICAL INSTRUCTIONS:
- You cannot rely on recognizing specific known phrases. You MUST genuinely assess whether the text is a coherent, relevant attempt at answering the actual technical question asked, every single time.
- Treat every message as new and unfamiliar rather than checking against pre-defined examples.
- You never write text the candidate sees, never ask questions, and never assign numeric scores.`;

  const userPrompt = JSON.stringify({
    previousQuestion: lastQuestion,
    candidateMessage: candidateMessage
  });

  const conductSchema = {
    type: 'OBJECT',
    properties: {
      classification: {
        type: 'STRING',
        enum: ['genuine_attempt', 'non_answer', 'off_topic', 'disrespectful'],
        description: 'The conduct classification of the message.'
      },
      reasoning: {
        type: 'STRING',
        description: 'A brief 1-sentence reasoning justifying the classification.'
      }
    },
    required: ['classification', 'reasoning']
  };

  return callBrainLLMWithFallback(
    'Conduct',
    systemPrompt,
    userPrompt,
    conductSchema,
    () => mockConductAnalysis(candidateMessage)
  );
}

function mockConductAnalysis(message) {
  const clean = (message || '').trim().toLowerCase();
  if (clean === '') {
    return { classification: 'non_answer', reasoning: 'Message is empty.' };
  }

  // Check exact refusals
  const exactRefusals = [
    'idk', 'i don\'t know', 'i dont know', 'no idea', 'skip', 'dunno', 'pass', 
    'dont know', 'next question', 'move on', 'n/a', 'na', 'none', 'nothing',
    'no clue', 'not sure', 'i do not know', 'cant say', 'can\'t say', 'i cannot answer',
    'whatever', 'i don’t know', 'i don\'t care', 'id care', 'skip this', 'next'
  ];
  if (exactRefusals.includes(clean)) {
    return { classification: 'non_answer', reasoning: 'Explicit non-answer/refusal keyword matched.' };
  }

  // Check disrespectful
  const disrespectfulPhrases = [
    'do as you like', 'do has u like', 'do as u like', 'whatever', 'hostile', 'stupid', 'rude'
  ];
  if (disrespectfulPhrases.some(phrase => clean.includes(phrase))) {
    return { classification: 'disrespectful', reasoning: 'Message matches disrespectful/hostile template phrase.' };
  }

  // Gibberish checking (keyboard mashes, e.g. "sdfds", "sdfsdf", "asdflkjh", "g4wfsgsg")
  const letters = clean.replace(/[^a-z]/g, '');
  if (letters.length > 2) {
    // Vowel count
    const vowels = (letters.match(/[aeiouy]/g) || []).length;
    const len = letters.length;
    if (vowels === 0 || (vowels / len) < 0.15) {
      return { classification: 'off_topic', reasoning: 'Gibberish or keyboard mashing detected (no/low vowels).' };
    }
    // High repetition
    if (/([a-z])\1{2,}/.test(letters)) {
      return { classification: 'off_topic', reasoning: 'Gibberish or keyboard mashing detected (high letter repetition).' };
    }
  }

  return { classification: 'genuine_attempt', reasoning: 'Fallback assumes it is a genuine technical response.' };
}

/**
 * BRAIN 2: Interviewer Brain (the "personality")
 * Sole job: Generate what gets said to the candidate this turn.
 * Uses the constant INTERVIEWER_PERSONA. Never decides suspension or interview wrap-up.
 */
export async function generateInterviewerResponseWithLLM(
  session,
  candidateMessage,
  conductClassification,
  detectedConnections,
  hedgeMarkers,
  nextQuestionType,
  nextTopic,
  difficultyTier
) {
  if (process.env.SIMULATE_LLM_OUTAGE === 'true') {
    return mockLLMCall(session.candidateSnapshot, session.topicQueue[session.cursor], '', candidateMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier, session, hedgeMarkers);
  }

  const currentTopic = session.topicQueue[session.cursor];
  const lastQuestion = session.transcript.filter(e => e.role === 'interviewer').slice(-1)[0]?.text || '';

  const systemPrompt = `${INTERVIEWER_PERSONA}

Your single job is to generate what gets said to the candidate this turn.

INPUT METADATA:
- Candidate Conduct Classification: "${conductClassification}"
- Current Topic: Day ${currentTopic.day} - "${currentTopic.title}"
- Topic Objectives: ${currentTopic.objectives.join(', ')}
- Next Question Type Requested: "${nextQuestionType}"
- Difficulty Tier: "${difficultyTier}"
- Follow-up Count on Current Topic: ${session.followupCountForCurrentTopic || 0}
${session && session.isFinalQuestion ? '- Final Question Signal: TRUE (This is the LAST question of the interview before concluding).' : ''}

REACTION & BEHAVIOR RULES (Based on Conduct Classification):
- If "genuine_attempt" (strong): Ask a real, specific follow-up probing deeper into an exact detail, mechanism, or trade-off the candidate mentioned, in your own natural phrasing — never the same fixed sentence shape twice.
- If "genuine_attempt" (weak/vague): Push for the missing specificity, the way a real interviewer presses for concrete implementation detail.
- If "non_answer": React honestly and directly in your own voice, naming that the response did not engage with the question, and re-prompt for a genuine attempt on the current topic.
- If "off_topic" (gibberish/non-sequitur): React puzzled but firm, redirecting back to the actual technical question on the current topic.
- If "disrespectful": React with calm professionalism and real directness, pushing back without breaking character or sounding like a robotic system warning.

CONSTRAINTS:
1. If nextQuestionType is "mcq": You MUST generate a multiple choice question stem in "reply", and return the "mcqOptions" (array of exactly 4 choices: 3 plausible distractors and 1 correct option, related to the objectives of the NEXT topic day: Day ${nextTopic ? nextTopic.day : currentTopic.day} - "${nextTopic ? nextTopic.title : currentTopic.title}").
2. If nextQuestionType is "diagram_interpret": You MUST generate a flawed Mermaid diagram syntax in "diagramDefinition" representing the next day's objectives, and place a specific critique question in "diagramQuestionText".
3. If Final Question Signal is TRUE: Naturally incorporate a brief, varied closing acknowledgment into your phrasing (e.g. "To wrap things up with one last question," or "Let's finish our review with a final technical scenario:"). Vary your phrasing naturally—do NOT use a fixed template.
4. reactionClause: A short 3-8 word conversational reaction.
5. Omit day numbers from follow-up questions within the same topic.
6. REALISTIC BREVITY: Keep your reply to 1-3 sentences.`;

  // Phase 7: Send structured compactState as candidateStateSnapshot instead of freeform interviewMemory string.
  // compactState provides: strongTopics[], weakTopics[], misconceptions[], currentDay, currentDifficultyTier, questionsAsked, daysCovered[].
  // interviewMemory is still stored on the session (for backward compat) but no longer passed into the prompt.
  const userPrompt = JSON.stringify({
    candidateLastMessage: candidateMessage,
    previousQuestion: lastQuestion,
    candidateStateSnapshot: session.compactState || {},
    followupCount: session.followupCountForCurrentTopic,
    detectedConnections: detectedConnections || []
  });

  return callBrainLLMWithFallback(
    'Interviewer',
    systemPrompt,
    userPrompt,
    schema,
    () => mockLLMCall(session.candidateSnapshot, currentTopic, lastQuestion, candidateMessage, session.followupCountForCurrentTopic, detectedConnections, nextQuestionType, nextTopic, difficultyTier, session, hedgeMarkers)
  );
}

/**
 * BRAIN 3: Evaluator Brain (the "grader")
 * Sole job: Once a curriculum topic's exchange is complete, produce the numeric score and narrative feedback together.
 * Generates score and narrative in the same reasoning pass so they can never contradict.
 */
export async function evaluateTopicPerformanceWithLLM(currentTopic, exchangeHistory, session = null) {
  if (process.env.SIMULATE_LLM_OUTAGE === 'true') {
    return mockTopicEvaluation(currentTopic, exchangeHistory);
  }

  const systemPrompt = `You are the Evaluator Brain (the "grader") for a technical software engineering interview.
Your job is to analyze the full exchange history for a completed curriculum topic and evaluate the candidate across multiple distinct dimensions.

CURRICULUM TOPIC: Day ${currentTopic.day} - "${currentTopic.title}"
OBJECTIVES: ${currentTopic.objectives.join(', ')}

EVALUATION CRITERIA (Rate each from 0-100 independently):
1. score: The blended overall accuracy score indicating overall performance.
2. correctness: Technical accuracy of facts, logic, algorithms, or API usages.
3. depth: Level of specific concrete details and structural mechanisms mentioned, avoiding generic hand-waving.
4. reasoning: Coherence, flow, logic, and architectural soundness of the arguments.
5. tradeoffs: Understanding and discussion of pros/cons, constraints, and alternative designs.
6. clarity: Articulation, precision, structure, and readability of the explanations.

IMPORTANT: Do not duplicate the same score across all dimensions. Evaluate each metric strictly on its own merits based on the exchange history. Produce both the numeric scores and the narrative feedback together in one pass so they never contradict.

You will also receive a priorPerformanceContext object showing this candidate's cumulative performance to date (strongTopics, weakTopics, misconceptions). Use this for calibration context only — your scores must still be grounded in THIS topic's exchange history, not prior performance.`;

  // Phase 7: Include compact state as prior performance context for evaluator calibration
  const priorContext = (session && session.compactState) ? session.compactState : {};

  const userPrompt = JSON.stringify({
    exchangeHistory: exchangeHistory.map(e => `${e.role.toUpperCase()}: ${e.text}`).join('\n'),
    priorPerformanceContext: priorContext
  });

  const evaluatorSchema = {
    type: 'OBJECT',
    properties: {
      score: {
        type: 'INTEGER',
        description: 'The overall numeric blended score from 0 to 100.'
      },
      correctness: {
        type: 'INTEGER',
        description: 'Technical correctness from 0 to 100 (accuracy of facts, logic, and concepts).'
      },
      depth: {
        type: 'INTEGER',
        description: 'Depth of explanation from 0 to 100 (level of detail, mechanism explanation, avoiding high-level hand-waving).'
      },
      reasoning: {
        type: 'INTEGER',
        description: 'Reasoning quality from 0 to 100 (logical coherence, structured problem-solving, code/architecture flow).'
      },
      tradeoffs: {
        type: 'INTEGER',
        description: 'Trade-off awareness from 0 to 100 (ability to identify pros/cons of architectural decisions, database models, etc.).'
      },
      clarity: {
        type: 'INTEGER',
        description: 'Communication clarity from 0 to 100 (articulation, conciseness, clean layout of thoughts).'
      },
      narrativeFeedback: {
        type: 'STRING',
        description: 'The specific narrative feedback detailing strengths or gaps.'
      }
    },
    required: ['score', 'correctness', 'depth', 'reasoning', 'tradeoffs', 'clarity', 'narrativeFeedback']
  };

  return callBrainLLMWithFallback(
    'Evaluator',
    systemPrompt,
    userPrompt,
    evaluatorSchema,
    () => mockTopicEvaluation(currentTopic, exchangeHistory)
  );
}

function mockTopicEvaluation(currentTopic, exchangeHistory) {
  const candidateReplies = exchangeHistory.filter(e => e.role === 'candidate').map(e => e.text);
  const fullText = candidateReplies.join(' ').toLowerCase();

  let score = 50;
  let feedback = '';

  if (fullText.trim() === '' || fullText.includes('[empty response]')) {
    score = 10;
    feedback = `Candidate skipped topic Day ${currentTopic.day} (${currentTopic.title}) with no substantive technical reply.`;
  } else if (fullText.includes('idk') || fullText.includes("don't know") || fullText.includes('dont know')) {
    score = 20;
    feedback = `Candidate was unable to address the technical objectives of Day ${currentTopic.day} (${currentTopic.title}), stating they did not know.`;
  } else if (fullText.includes('sdfds') || fullText.includes('sdfsdf') || fullText.length < 15) {
    score = 20;
    feedback = `Candidate response for Day ${currentTopic.day} (${currentTopic.title}) was very short or nonsensical, showing gaps in understanding objectives.`;
  } else {
    // Check for technical keyword presence
    const techTerms = ['pandas', 'sqlite', 'redis', 'postgres', 'lock', 'wal', 'schema', 'concurrency', 'latency', 'cache', 'prometheus', 'grafana', 'docker', 'pod', 'vector', 'hnsw', 'few-shot', 'zero-shot', 'pipeline', 'metric', 'queue'];
    const matches = techTerms.filter(t => fullText.includes(t));

    if (matches.length >= 2 || fullText.length > 80) {
      score = 90;
      feedback = `Demonstrated solid engineering depth for Day ${currentTopic.day} (${currentTopic.title}), clearly referencing ${matches.length > 0 ? matches.slice(0, 3).join(', ') : 'key mechanisms'}.`;
    } else if (matches.length === 1 || fullText.length > 30) {
      score = 65;
      feedback = `Showed partial conceptual familiarity for Day ${currentTopic.day} (${currentTopic.title}), but lacked in-depth discussion of production failure modes or scaling trade-offs.`;
    } else {
      score = 45;
      feedback = `Provided a high-level summary for Day ${currentTopic.day} (${currentTopic.title}) without specifying concrete implementation mechanisms.`;
    }
  }

  // Generate distinct non-identical dimension scores based on overall score
  return {
    score,
    correctness: score,
    depth: Math.max(10, score - 5),
    reasoning: Math.max(10, score - 2),
    tradeoffs: Math.max(10, score - 10),
    clarity: Math.max(10, score + 2 > 100 ? 100 : score + 2),
    narrativeFeedback: feedback
  };
}

/**
 * Main intelligence layer evaluation entrypoint.
 * Orchestrates Conduct Analyst, Interviewer, and Evaluator roles sequentially.
 */
export async function evaluateTurnWithLLM(session, candidateMessage, detectedConnections, detectedHedgeMarkers = []) {
  // Find last interviewer question
  let lastQuestion = '';
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    if (session.transcript[i].role === 'interviewer') {
      lastQuestion = session.transcript[i].text;
      break;
    }
  }

  // Truncate candidate message
  const words = candidateMessage.split(/\s+/);
  const truncatedMessage = words.length > 300 
    ? words.slice(0, 300).join(' ') + ' ... [Truncated for Context]' 
    : candidateMessage;

  // 1. Conduct Analyst Role
  const conduct = await analyzeConductWithLLM(truncatedMessage, lastQuestion);
  console.log(`[Multi-Agent] Conduct Analyst classification: "${conduct.classification}" (${conduct.reasoning})`);

  const currentTopic = session.topicQueue[session.cursor];
  const nextTopic = session.topicQueue[session.cursor + 1] || null;
  const difficultyTier = session.difficultyTier || 'standard';
  const nextQuestionType = session.pendingQuestionType || 'open';

  // 2. Interviewer Role
  const interviewerRes = await generateInterviewerResponseWithLLM(
    session,
    truncatedMessage,
    conduct.classification,
    detectedConnections,
    detectedHedgeMarkers,
    nextQuestionType,
    nextTopic,
    difficultyTier
  );

  // Map conduct classification if it is a violation/non-attempt
  if (conduct.classification !== 'genuine_attempt') {
    const mappedClass = conduct.classification === 'non_answer' ? 'disengaged' : conduct.classification;
    interviewerRes.classification = mappedClass;
    interviewerRes.reasoning = conduct.reasoning;
    
    // Defensively enforce action mapping based on follow-up count to prevent looping
    if (session && session.followupCountForCurrentTopic < 1) {
      interviewerRes.action = 'followup';
    } else {
      interviewerRes.action = 'advance';
    }
  }

  // 3. Evaluator Role: runs only when scoring a completed topic (meaning action === 'advance' or MCQ/diagram turn)
  const isMCQ = nextQuestionType === 'mcq';
  const isDiagram = nextQuestionType === 'diagram_interpret';
  const isAdvancing = interviewerRes.action === 'advance' || interviewerRes.action === 'wrapup' || isMCQ || isDiagram;

  if (isAdvancing && currentTopic) {
    const pastTurnsCount = (session.followupCountForCurrentTopic || 0) * 2;
    const recentExchange = session.transcript.slice(-Math.max(1, pastTurnsCount + 1));
    const dayExchangeHistory = recentExchange.map(e => ({ role: e.role, text: e.text }));
    dayExchangeHistory.push({ role: 'candidate', text: candidateMessage });

    // Phase 7: Pass session into evaluateTopicPerformanceWithLLM so it can include priorPerformanceContext
    const evaluation = await evaluateTopicPerformanceWithLLM(currentTopic, dayExchangeHistory, session);
    console.log(`[Multi-Agent] Evaluator score for Day ${currentTopic.day}: ${evaluation.score} (${evaluation.narrativeFeedback})`);

    // Override score & reasoning in the turn response so they match narrative feedback exactly
    interviewerRes.llmConfidence = evaluation.score;
    interviewerRes.reasoning = evaluation.narrativeFeedback;
    
    // Store dimensions on the returned object so handleTurn can pick them up
    interviewerRes.correctness = evaluation.correctness;
    interviewerRes.depth = evaluation.depth;
    interviewerRes.reasoningScore = evaluation.reasoning;
    interviewerRes.tradeoffs = evaluation.tradeoffs;
    interviewerRes.clarity = evaluation.clarity;
    
    // Map technical quality classification based on Evaluator score
    if (conduct.classification === 'genuine_attempt') {
      if (evaluation.score >= 80) {
        interviewerRes.classification = 'strong';
      } else if (evaluation.score >= 50) {
        interviewerRes.classification = 'partial';
      } else {
        interviewerRes.classification = 'shallow';
      }
    }
  }

  return interviewerRes;
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

  // 4. Ensure recommendations (next steps) have no duplicate days and are always non-empty strings
  const finalNext = [];
  const nextDays = new Set();

  (feedback.next || []).forEach(rawItem => {
    let item = '';
    if (typeof rawItem === 'string') {
      item = rawItem.trim();
    } else if (rawItem && typeof rawItem === 'object') {
      item = (rawItem.recommendation || rawItem.action || rawItem.step || rawItem.text || '').trim();
    }
    if (!item) return;

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

  // If fewer than 3 recommendations, generate targeted next steps from identified gaps and unassessed queue topics
  if (finalNext.length < 3) {
    finalGaps.forEach(gap => {
      if (finalNext.length >= 3) return;
      const match = gap.match(/Day\s+(\d+)/i);
      if (match) {
        const dayNum = parseInt(match[1]);
        if (!nextDays.has(dayNum)) {
          const topic = session.topicQueue.find(t => t.day === dayNum);
          const title = topic ? topic.title : 'Curriculum Module';
          finalNext.push(`Revisit Day ${dayNum} (${title}): Review technical objectives, practice hands-on implementation, and study architectural failure modes.`);
          nextDays.add(dayNum);
        }
      }
    });
  }

  // If still fewer than 3, add standard actionable curriculum recommendations
  const generalCurriculumRecommendations = [
    'Deepen production engineering fundamentals: Focus on concurrency limits, database connection pooling, and latency profiling.',
    'Strengthen observability practices: Implement structured JSON logging, distributed tracing, and real-time alert thresholds.',
    'Complete hands-on end-to-end integration projects: Build and benchmark asynchronous queue pipelines and caching layers.'
  ];

  generalCurriculumRecommendations.forEach(rec => {
    if (finalNext.length < 3 && !finalNext.includes(rec)) {
      finalNext.push(rec);
    }
  });

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

  const processedFeedback = postProcessFeedback({
    summary,
    strengths: finalStrengths,
    gaps: finalGaps,
    next
  }, session);

  // Compute aggregate dimensions from accuracyLog
  const ratedLogs = (session.accuracyLog || []).filter(item => item.correctness !== undefined);
  let correctness = 50, depth = 50, reasoning = 50, tradeoffs = 50, clarity = 50;

  if (ratedLogs.length > 0) {
    correctness = Math.round(ratedLogs.reduce((sum, item) => sum + item.correctness, 0) / ratedLogs.length);
    depth = Math.round(ratedLogs.reduce((sum, item) => sum + item.depth, 0) / ratedLogs.length);
    reasoning = Math.round(ratedLogs.reduce((sum, item) => sum + item.reasoningScore, 0) / ratedLogs.length);
    tradeoffs = Math.round(ratedLogs.reduce((sum, item) => sum + item.tradeoffs, 0) / ratedLogs.length);
    clarity = Math.round(ratedLogs.reduce((sum, item) => sum + item.clarity, 0) / ratedLogs.length);
  } else {
    // If no evaluations ran, fallback based on average computed accuracy score
    const totalScore = (session.accuracyLog || []).reduce((sum, item) => sum + item.finalAccuracyScore, 0);
    const avgVal = (session.accuracyLog || []).length > 0 ? Math.round(totalScore / session.accuracyLog.length) : 50;
    correctness = avgVal;
    depth = avgVal;
    reasoning = avgVal;
    tradeoffs = avgVal;
    clarity = avgVal;
  }

  processedFeedback.dimensions = { correctness, depth, reasoning, tradeoffs, clarity };

  const mechanicalVerdict = computeMechanicalVerdict(session);

  return {
    feedback: processedFeedback,
    judgeVerdict: mechanicalVerdict
  };
}

/**
 * Computes a grounded mechanical judge verdict based on interview metrics.
 */
export function computeMechanicalVerdict(session) {
  const accuracyLog = session.accuracyLog || [];
  
  // Calculate average score
  let avgScore = 0;
  if (accuracyLog.length > 0) {
    avgScore = Math.round(accuracyLog.reduce((sum, item) => sum + item.finalAccuracyScore, 0) / accuracyLog.length);
  }

  // Count hallucinations
  const hallucinationCount = session.hallucinationCount || 0;
  
  let decision = "borderline";
  let reasoning = "The candidate demonstrated a mixed performance with some solid areas and notable gaps.";

  if (avgScore >= 75 && hallucinationCount === 0) {
    decision = "would_hire";
    reasoning = `The candidate demonstrated solid software engineering capabilities and consistent specificity across technical objectives, earning a strong overall average of ${avgScore}/100.`;
  } else if (avgScore <= 45 || hallucinationCount >= 2) {
    decision = "would_reject";
    reasoning = `The candidate exhibited significant concept gaps, repeated hallucinations, or a low overall average score of ${avgScore}/100.`;
  }

  // Generate evidenceTrail from accuracyLog
  const evidenceTrail = [];
  
  // 1. Look for hallucination
  const hallucinationTurn = accuracyLog.find(l => l.hallucinationFlag);
  if (hallucinationTurn) {
    evidenceTrail.push({
      questionRef: `Day ${hallucinationTurn.day}`,
      note: `The candidate hallucinated details concerning Vector Databases: "${hallucinationTurn.candidateAnswer.substring(0, 40)}..."`,
      outcome: "weak"
    });
  }

  // 2. Look for capstone
  const capstoneTurn = accuracyLog.find(l => l.questionType === 'capstone');
  if (capstoneTurn) {
    evidenceTrail.push({
      questionRef: `Day ${capstoneTurn.day} (Capstone)`,
      note: `Completed the Capstone System Design challenge with a score of ${capstoneTurn.finalAccuracyScore}/100.`,
      outcome: capstoneTurn.finalAccuracyScore >= 80 ? "strong" : "weak"
    });
  }

  // 3. Look for recovery
  // Recovery: an early weak score (score < 70) followed by a later strong score (score >= 80)
  let earlyWeakIdx = -1;
  let laterStrongIdx = -1;
  
  for (let i = 0; i < accuracyLog.length; i++) {
    if (accuracyLog[i].finalAccuracyScore < 70) {
      earlyWeakIdx = i;
      break;
    }
  }
  
  if (earlyWeakIdx !== -1) {
    for (let j = earlyWeakIdx + 1; j < accuracyLog.length; j++) {
      if (accuracyLog[j].finalAccuracyScore >= 80) {
        laterStrongIdx = j;
        break;
      }
    }
  }

  if (earlyWeakIdx !== -1 && laterStrongIdx !== -1) {
    const earlyLog = accuracyLog[earlyWeakIdx];
    const laterLog = accuracyLog[laterStrongIdx];
    evidenceTrail.push({
      questionRef: `Day ${laterLog.day}`,
      note: `Recovered from early weak understanding on Day ${earlyLog.day} (${earlyLog.title}) with a strong answer on Day ${laterLog.day} (${laterLog.title}).`,
      outcome: "recovered"
    });
  }

  // 4. Fallback: highest and lowest scoring days if evidenceTrail is too small
  accuracyLog.forEach(log => {
    if (evidenceTrail.length >= 5) return;
    const exists = evidenceTrail.some(e => e.questionRef.includes(`Day ${log.day}`));
    if (!exists) {
      if (log.finalAccuracyScore >= 80) {
        evidenceTrail.push({
          questionRef: `Day ${log.day}`,
          note: `Answered objectives on "${log.title}" with strong technical clarity.`,
          outcome: "strong"
        });
      } else if (log.finalAccuracyScore < 45) {
        evidenceTrail.push({
          questionRef: `Day ${log.day}`,
          note: `Showed notable knowledge gaps on "${log.title}" (Score: ${log.finalAccuracyScore}/100).`,
          outcome: "weak"
        });
      }
    }
  });

  // Ensure at least 1 entry in evidenceTrail
  if (evidenceTrail.length === 0 && accuracyLog.length > 0) {
    const first = accuracyLog[0];
    evidenceTrail.push({
      questionRef: `Day ${first.day}`,
      note: `Evaluated candidate performance on "${first.title}".`,
      outcome: first.finalAccuracyScore >= 60 ? "strong" : "weak"
    });
  }

  return {
    decision,
    reasoning,
    evidenceTrail: evidenceTrail.slice(0, 5)
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
9. "judgeVerdict": You must generate a committed, decisive hiring verdict:
   - "decision": Must be one of: "would_hire" (consistent specificity, strong performance, zero hallucinations), "would_reject" (poor technical responses, low scores, repeated hallucinations), or "borderline" (genuinely mixed performance with strong highs and weak lows). You must make a committed choice—do not default to "borderline" as a safe answer unless the record is genuinely mixed.
   - "reasoning": A 2-3 sentence technical justification explaining the verdict using specific findings from the interview.
   - "evidenceTrail": An ordered sequence of the 3-5 most decision-relevant moments in the interview (strengths, gaps, capstone performance, hallucinations, or a notable recovery).
     - Each entry must have:
       * "questionRef": Day number (e.g. "Day 12" or "Day 6 (Capstone)").
       * "note": Specific description of what happened, citing candidate's actual claims/answers or performance.
       * "outcome": "strong" | "weak" | "recovered" (use "recovered" specifically if an early weak performance was rescued by a later strong performance on a related or harder topic).

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

    const feedbackObj = result.feedback || { summary: "", strengths: [], gaps: [], next: [] };
    const gapsList = feedbackObj.gaps || [];

    if (gapsList.length === 0 && hasManyWeakAnswers) {
      console.warn('[LLMClient Warning] Gaps array was empty despite multiple weak/partial responses. Regenerating with stricter prompts...');
      const stricterSystemPrompt = systemPrompt + "\n\nCRITICAL WARNING: Your previous response contained zero gaps. This is unacceptable given the candidate's poor/partial performance. You MUST identify at least one real technical gap or weakness from the transcript.";
      if (provider === 'qwen') {
        result = await callQwenREST(stricterSystemPrompt, userPrompt, feedbackSchema, 0, 0.1);
      } else {
        result = await callGeminiREST(stricterSystemPrompt, userPrompt, feedbackSchema, 0, 0.1);
      }
    }

    if (result) {
      const finalFeedbackObj = result.feedback || { summary: "", strengths: [], gaps: [], next: [] };
      const processedFeedback = postProcessFeedback(finalFeedbackObj, session);

      // Compute aggregate dimensions from accuracyLog
      const ratedLogs = (session.accuracyLog || []).filter(item => item.correctness !== undefined);
      let correctness = 50, depth = 50, reasoning = 50, tradeoffs = 50, clarity = 50;

      if (ratedLogs.length > 0) {
        correctness = Math.round(ratedLogs.reduce((sum, item) => sum + item.correctness, 0) / ratedLogs.length);
        depth = Math.round(ratedLogs.reduce((sum, item) => sum + item.depth, 0) / ratedLogs.length);
        reasoning = Math.round(ratedLogs.reduce((sum, item) => sum + item.reasoningScore, 0) / ratedLogs.length);
        tradeoffs = Math.round(ratedLogs.reduce((sum, item) => sum + item.tradeoffs, 0) / ratedLogs.length);
        clarity = Math.round(ratedLogs.reduce((sum, item) => sum + item.clarity, 0) / ratedLogs.length);
      } else {
        // Fallback
        const totalScore = (session.accuracyLog || []).reduce((sum, item) => sum + item.finalAccuracyScore, 0);
        const avgVal = (session.accuracyLog || []).length > 0 ? Math.round(totalScore / session.accuracyLog.length) : 50;
        correctness = avgVal;
        depth = avgVal;
        reasoning = avgVal;
        tradeoffs = avgVal;
        clarity = avgVal;
      }

      processedFeedback.dimensions = { correctness, depth, reasoning, tradeoffs, clarity };

      return {
        feedback: processedFeedback,
        judgeVerdict: result.judgeVerdict || { decision: "borderline", reasoning: "No details provided.", evidenceTrail: [] }
      };
    }
  }

  console.warn('[LLMClient Warning] Feedback Composer call failed or returned invalid JSON twice. Triggering mechanical fallback...');
  return generateMechanicalFeedback(session);
}
