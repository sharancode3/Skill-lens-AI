import dotenv from 'dotenv';

dotenv.config();

// Enforced response schema for Gemini API turn evaluations
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
async function callGeminiREST(systemPrompt, userPrompt, schema, retryCount = 1) {
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
      responseSchema: schema
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
      return callGeminiREST(systemPrompt, userPrompt + correctiveInstructions, schema, retryCount - 1);
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
  const llmResult = await callGeminiREST(systemPrompt, userPrompt, responseSchema, 1);

  if (llmResult) {
    return llmResult;
  }

  // Fallback if API fails twice
  console.warn('[LLMClient Warning] LLM call failed or returned invalid JSON twice. Triggering hardcoded safety fallback...');
  return mockLLMCall(candidate, currentTopic, lastQuestion, candidateMessage, session.followupCountForCurrentTopic, detectedConnections);
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

  // 1. Process transcript turns
  session.transcript.forEach((entry, idx) => {
    if (entry.role === 'candidate' && entry.classification) {
      // Find matching preceding interviewer entry to resolve day
      let dayNum = null;
      for (let i = idx - 1; i >= 0; i--) {
        if (session.transcript[i].role === 'interviewer' && session.transcript[i].day) {
          dayNum = session.transcript[i].day;
          break;
        }
      }

      if (dayNum !== null) {
        const dayData = session.topicQueue.find(t => t.day === dayNum);
        if (dayData) {
          if (entry.classification === 'strong' || entry.classification === 'partial') {
            strengths.push(`Day ${dayData.day} (${dayData.title}): Demonstrated understanding of learning objectives during active discussion.`);
          } else {
            gaps.push(`Day ${dayData.day} (${dayData.title}): Response was classified as ${entry.classification} (vague or off-topic).`);
          }
        }
      }
    }
  });

  // 2. Process unreached topicQueue topics (status pending)
  session.topicQueue.forEach(topic => {
    if (topic.status === 'pending') {
      gaps.push(`Day ${topic.day} ("${topic.title}"): not yet demonstrated.`);
    }
  });

  // 3. Process candidate-skipped missions that were never asked
  if (candidate.missions) {
    candidate.missions.forEach(m => {
      if (m.skipped) {
        const asked = session.topicQueue.some(t => t.day === m.day && t.status === 'asked');
        if (!asked) {
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

  const strengthsSummary = strengths.map(s => {
    const match = s.match(/Day \d+ \(([^)]+)\)/);
    return match ? match[1] : '';
  }).filter(t => t !== '').join(', ');

  const summary = `Candidate ${candidate.name || 'Candidate'} completed the technical review. Demonstrated capabilities in: ${strengthsSummary || 'foundational software topics'}. Additional practice is suggested for gaps.`;

  return {
    summary,
    strengths: finalStrengths,
    gaps: finalGaps,
    next
  };
}

/**
 * Intelligence layer entrypoint for feedback report composition.
 * Calls structured Gemini REST endpoint or falls back mechanically.
 */
export async function generateFeedbackReport(session) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return generateMechanicalFeedback(session);
  }

  const candidate = session.candidateSnapshot;

  const systemPrompt = `You are a professional, senior technical interviewer and Feedback Composer for Skill Labs Ai.
You must compile a structured technical feedback report for the candidate based on their interview.

CONSTRAINTS FOR GENERATION:
- "grounded generation": You MUST ONLY assert what is evidenced in the transcript. Do not invent strengths or capabilities for topics that were never reached.
- "summary": A short paragraph that MUST reference at least one concrete answer or exchange from this specific interview. Fail/Reject generic templates.
- "strengths": Array of strings. Only include topics that were evaluated as "strong" or "partial-with-solid-reasoning" in the transcript. Mention the Day number and title.
- "gaps": Array of strings. Cover topics evaluated as "shallow" or "off_topic", AND any candidate skipped missions that were never asked about at all in this interview. For unasked or skipped topics, you MUST use the exact phrasing: "not yet demonstrated" (e.g. "Day 29 (Observability): not yet demonstrated").
- "next": Array of concrete, actionable recommendations, each tied to a specific Day number and title from the curriculum. No generic advice like "keep practicing".`;

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

  const userPrompt = JSON.stringify({
    candidateProfile: {
      name: candidate.name,
      jobRole: candidate.jobRole,
      yearsExperience: candidate.yearsExperience
    },
    fullTranscript: session.transcript.map(t => ({
      role: t.role,
      day: t.day || null,
      text: t.text,
      classification: t.classification || null
    })),
    topicQueueStatus: session.topicQueue.map(t => ({
      day: t.day,
      title: t.title,
      difficulty: t.difficulty,
      status: t.status
    })),
    skippedMissionsUnasked: skippedUnasked
  }, null, 2);

  console.log(`[LLMClient] Calling Feedback Composer Gemini API for session "${session.sessionId}"...`);
  const result = await callGeminiREST(systemPrompt, userPrompt, feedbackSchema, 1);
  if (result) {
    return result;
  }

  console.warn('[LLMClient Warning] Feedback Composer call failed or returned invalid JSON twice. Triggering mechanical fallback...');
  return generateMechanicalFeedback(session);
}
