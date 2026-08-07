import dotenv from 'dotenv';

dotenv.config();

// Enforced response schema for Gemini API JSON mode
const responseSchema = {
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
      description: 'The literal next message shown to the candidate. If followup, must reference a specific detail from the candidate verbatim answer.'
    },
    updatedMemory: {
      type: 'STRING',
      description: 'A 2-4 sentence running summary of the candidate skills, strengths, and gaps observed so far, incorporating this turn.'
    }
  },
  required: ['classification', 'reasoning', 'action', 'reply', 'updatedMemory']
};

/**
 * Call the Google Gemini API REST endpoint using JSON mode and schema enforcement.
 */
async function callGeminiREST(systemPrompt, userPrompt, retryCount = 1) {
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
      responseSchema: responseSchema
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
    const keys = Object.keys(responseSchema.properties);
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
      return callGeminiREST(systemPrompt, userPrompt + correctiveInstructions, retryCount - 1);
    }
    return null;
  }
}

/**
 * Deterministic offline mock LLM fallback.
 * Uses text characteristics and keywords to generate schema-adherent output.
 */
function mockLLMCall(candidate, topic, lastQuestion, message, followupCount, connections) {
  console.log('[LLMClient] GEMINI_API_KEY not found or call failed. Using offline Mock LLM...');

  const cleanMsg = message.toLowerCase().trim();
  let classification = 'standard';
  let action = 'advance';
  let reasoning = 'Mock evaluation based on keyword analysis and message length.';
  let reply = '';
  let updatedMemory = '';

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
    // Quote a segment of candidate response to fulfill "quote/reference verbatim text" rule
    const segment = message.split(' ').slice(0, 3).join(' ');
    reply = `You mentioned "${segment}..." - Can you elaborate on the exact mechanism or trade-offs involved in this for Day ${topic.day}? (Mock LLM follow-up)`;
  } else {
    // Redirect if off-topic
    if (classification === 'off_topic') {
      reply = `Let's keep our focus on the technical side. Moving on to the next topic. (Mock Redirect)`;
    } else {
      reply = `Thank you for sharing your experience with "${topic.title}".${connectionText} Let's proceed. (Mock LLM advance)`;
    }
  }

  updatedMemory = `Candidate has completed turn for Day ${topic.day} (${topic.title}). Evaluated as: ${classification}.`;

  return {
    classification,
    reasoning,
    action,
    reply,
    updatedMemory
  };
}

/**
 * Main intelligence layer evaluation entrypoint.
 * Assembles prompts, manages Gemini REST vs offline fallback, and validates schemas.
 */
export async function evaluateTurnWithLLM(session, candidateMessage, detectedConnections) {
  const candidate = session.candidateSnapshot;
  const topicIndex = session.cursor;
  const currentTopic = session.topicQueue[topicIndex];
  
  // Find last interviewer question
  let lastQuestion = '';
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    if (session.transcript[i].role === 'interviewer') {
      lastQuestion = session.transcript[i].text;
      break;
    }
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

detectedConnections parameter: if populated, it contains curriculum days matching the candidate response semantically. You may optionally weave an acknowledgment of this connection into the reply if relevant, e.g. "That actually touches on Day 8 vector databases..." but never force it.`;

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
    candidateLastMessage: candidateMessage,
    previousInterviewerQuestion: lastQuestion,
    runningInterviewMemory: session.interviewMemory || 'No history yet.',
    followupCountForCurrentTopic: session.followupCountForCurrentTopic,
    detectedConnections: detectedConnections || []
  }, null, 2);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return mockLLMCall(candidate, currentTopic, lastQuestion, candidateMessage, session.followupCountForCurrentTopic, detectedConnections);
  }

  console.log(`[LLMClient] Calling Gemini API for session "${session.sessionId}"...`);
  const llmResult = await callGeminiREST(systemPrompt, userPrompt, 1);

  if (llmResult) {
    return llmResult;
  }

  // Fallback if API fails twice
  console.warn('[LLMClient Warning] LLM call failed or returned invalid JSON twice. Triggering hardcoded safety fallback...');
  return mockLLMCall(candidate, currentTopic, lastQuestion, candidateMessage, session.followupCountForCurrentTopic, detectedConnections);
}
