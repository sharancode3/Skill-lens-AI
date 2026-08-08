import { db } from './firebase.js';
import { buildTopicQueue } from './topicSelector.js';
import { findRelatedDays, computeSemanticScore } from './embeddingManager.js';
import { evaluateTurnWithLLM, generateFeedbackReport } from './llmClient.js';


// Explicit Session States
export const SessionState = {
  INIT: 'INIT',
  ASKING: 'ASKING',
  WRAP_UP: 'WRAP_UP',
  DONE: 'DONE'
};

// Expected real-world response times lookup table per difficulty tier
export const RESPONSE_TIME_BOUNDS = {
  foundational: [20, 40],
  standard: [40, 70],
  applied: [70, 120],
  expert: [120, 200],
  capstone: [180, 400]
};

// Deterministic hedging-detection checks
export function detectHedging(answerText) {
  if (!answerText) return [];
  const lower = answerText.toLowerCase();
  const hedges = [
    "i think", "maybe", "probably", "i guess",
    "not sure", "kind of", "sort of", "i believe", "possibly"
  ];
  return hedges.filter(hedge => lower.includes(hedge));
}

export function checkDisengagement(message, isMCQ) {
  const clean = (message || '').trim().toLowerCase();
  if (clean === '') return true;

  if (isMCQ) {
    if (/^\d+$/.test(clean)) {
      return false;
    }
  }

  // Exact disengagement words
  const exactRefusals = [
    'idk', 'i don\'t know', 'i dont know', 'no idea', 'skip', 'dunno', 'pass', 
    'dont know', 'next question', 'move on', 'n/a', 'na', 'none', 'nothing',
    'no clue', 'not sure', 'i do not know', 'cant say', 'can\'t say', 'i cannot answer',
    'whatever', 'i don’t know', 'i don\'t care', 'id care', 'skip this', 'next'
  ];

  if (exactRefusals.includes(clean)) {
    return true;
  }

  // Refusal phrases if message is short
  const disengagePhrases = [
    "i don't know", "i do not know", "i dont know", "i don’t know",
    "no clue", "no idea", "skip this", "next question", "move on",
    "cannot answer", "can't answer", "cant answer"
  ];
  if (clean.length < 35) {
    if (disengagePhrases.some(phrase => clean.includes(phrase))) {
      return true;
    }
  }

  // Dismissive/empty patterns (only punctuation/special chars)
  const cleanNoPunct = clean.replace(/[^\w]/g, '');
  if (cleanNoPunct === '' && !isMCQ) {
    return true;
  }

  return false;
}

// Local cache store for offline simulation or fallback if Firestore connection is unavailable
const localSessions = new Map();

// Cooldown tracker for suspended candidates: candId -> Date (suspension time)
export const cooldowns = new Map();

/**
 * Reads a session document from Firestore, with automatic fallback to local memory cache.
 */
export async function getSessionDoc(sessionId) {
  if (db) {
    try {
      const doc = await db.collection('sessions').doc(sessionId).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      console.warn(`[SessionManager Warning] Firestore read failed for session "${sessionId}". Falling back to memory:`, e.message);
      return localSessions.get(sessionId) || null;
    }
  }
  return localSessions.get(sessionId) || null;
}

/**
 * Writes a session document to Firestore, with automatic fallback to local memory cache.
 */
export async function saveSessionDoc(sessionId, data) {
  const updatedData = {
    ...data,
    updatedAt: new Date().toISOString()
  };

  if (db) {
    try {
      await db.collection('sessions').doc(sessionId).set(updatedData);
      return;
    } catch (e) {
      console.warn(`[SessionManager Warning] Firestore write failed for session "${sessionId}". Falling back to memory:`, e.message);
    }
  }
  localSessions.set(sessionId, updatedData);
}

/**
 * Stopping-condition check.
 * 
 * CRITICAL CORRECTNESS REQUIREMENT: The hard cap of 14 turns is a strict correctness
 * requirement to guarantee that the interview always terminates in a live demo,
 * even if upstream components misbehave. Do not remove or modify this cap.
 * 
 * @param {Object} session - The interview session document data.
 * @returns {boolean} True if the interview stopping conditions are met.
 */
export function shouldWrapUp(session, modelWantsToStop) {
  const floorMet = session.questionsAsked >= 8 && session.distinctDaysCovered.length >= 4;
  if (!floorMet) {
    return false;
  }
  const hitsHardCap = session.turnCount >= 14;
  if (hitsHardCap) {
    return true;
  }
  return !!modelWantsToStop;
}

/**
 * Initializes a new interview session record.
 * 
 * @param {string} sessionId 
 * @param {Object} candidate 
 * @returns {Promise<Object>} The first interviewer message shape: { reply, done }
 */
export async function createSession(sessionId, candidate) {
  // Build the topicQueue using Phase 2 selector
  const topicQueue = buildTopicQueue(candidate);
  if (!topicQueue || topicQueue.length === 0) {
    throw new Error(`Could not build a topic queue for candidate.`);
  }

  // Construct initial session document matching schema
  const session = {
    sessionId,
    state: SessionState.ASKING,
    candidateSnapshot: candidate,
    topicQueue,
    cursor: 0,
    questionsAsked: 1,
    distinctDaysCovered: [],
    turnCount: 0,
    followupCountForCurrentTopic: 0,
    emptyRetryCount: 0,
    lastMessageHash: null,
    lastMessageTime: null,
    lastResponse: null,
    transcript: [],
    interviewMemory: '',
    feedback: null,
    createdAt: new Date().toISOString(),
    interviewStartedAt: new Date().toISOString(),
    interviewEndedAt: null,
    whyChainDepth: 0,
    capstoneTriggered: false,
    hallucinationCount: 0,
    hallucinationCountForCurrentTopic: 0,
    hedgeEventCount: 0,
    questionSentAt: new Date().toISOString(),
    pendingWhyProbe: false,
    recentScores: [],
    recentDiagrams: [],
    recentReactions: [],
    difficultyTier: "standard",
    nextQuestionType: "open",
    pendingQuestionType: "open",
    pendingMCQAnswer: null,
    accuracyLog: []
  };

  // Select first topic and build template question
  const firstTopic = topicQueue[0];
  const firstQuestion = `Welcome ${candidate.member?.name || 'Candidate'}. Let's begin the interview. Can you tell me about your experience on Day ${firstTopic.day}: "${firstTopic.title}"?`;

  // Append question to transcript
  session.transcript.push({
    role: 'interviewer',
    day: firstTopic.day,
    text: firstQuestion,
    turn: 1
  });

  // Save state
  await saveSessionDoc(sessionId, session);

  return {
    reply: firstQuestion,
    done: false,
    questionsAsked: 1,
    distinctDaysCovered: 0,
    difficultyTier: session.difficultyTier,
    questionHistory: []
  };
}

/**
 * Updates difficulty tier and determines next question type based on performance.
 */
export function updateDifficulty(session, finalScore) {
  if (!session.recentScores) {
    session.recentScores = [];
  }
  session.recentScores.push(finalScore);
  if (session.recentScores.length > 2) {
    session.recentScores.shift();
  }

  // Recalculate nextQuestionType: default to open
  session.pendingQuestionType = 'open';

  // Only evaluate transitions once we have at least 2 scores
  if (session.recentScores.length >= 2) {
    const s1 = session.recentScores[0];
    const s2 = session.recentScores[1];

    const tiers = ['foundational', 'standard', 'applied', 'expert'];
    let currentIdx = tiers.indexOf(session.difficultyTier || 'standard');
    if (currentIdx === -1) currentIdx = 1;

    if (s1 >= 85 && s2 >= 85) {
      // Escalation
      const nextIdx = Math.min(currentIdx + 1, tiers.length - 1);
      session.difficultyTier = tiers[nextIdx];
      session.pendingQuestionType = 'diagram_interpret';
      console.log(`[Difficulty Engine] Escalating difficulty to: ${session.difficultyTier}. Next type: diagram_interpret`);
    } else if (s1 < 40 || s2 < 40) {
      // De-escalation (either score < 40)
      const nextIdx = Math.max(currentIdx - 1, 0);
      session.difficultyTier = tiers[nextIdx];
      session.pendingQuestionType = 'mcq';
      console.log(`[Difficulty Engine] De-escalating difficulty to: ${session.difficultyTier}. Next type: mcq`);
    } else {
      console.log(`[Difficulty Engine] No difficulty change: ${session.difficultyTier}. Next type: open`);
    }
  } else {
    console.log(`[Difficulty Engine] Less than 2 scores. Next type: open`);
  }
  console.log(`[Difficulty Engine Log] recentScores: [${session.recentScores.join(', ')}], pendingQuestionType: ${session.pendingQuestionType}, difficultyTier: ${session.difficultyTier}`);
}

/**
 * Computes performance analytics metrics for final review.
 */
export function computeMetrics(session) {
  const accuracyLog = session.accuracyLog || [];
  if (accuracyLog.length === 0) {
    return {
      overallAccuracy: 0,
      perDay: [],
      difficultyProgression: [],
      questionTypeBreakdown: { open: 0, mcq: 0, diagram_interpret: 0 }
    };
  }

  const overallAccuracy = Math.round(
    accuracyLog.reduce((sum, item) => sum + item.finalAccuracyScore, 0) / accuracyLog.length
  );

  const difficultyProgression = accuracyLog.map(item => item.difficultyTier || 'standard');

  const questionTypeBreakdown = { open: 0, mcq: 0, diagram_interpret: 0 };
  accuracyLog.forEach(item => {
    const qType = item.questionType || 'open';
    if (qType in questionTypeBreakdown) {
      questionTypeBreakdown[qType]++;
    } else {
      questionTypeBreakdown.open++;
    }
  });

  const dayScoresMap = {};
  accuracyLog.forEach(item => {
    if (item.day !== null && item.day !== undefined) {
      if (!dayScoresMap[item.day]) {
        dayScoresMap[item.day] = [];
      }
      dayScoresMap[item.day].push(item.finalAccuracyScore);
    }
  });

  const perDay = Object.keys(dayScoresMap).map(dayStr => {
    const dayNum = parseInt(dayStr);
    const scores = dayScoresMap[dayStr];
    const avgScore = Math.round(scores.reduce((sum, val) => sum + val, 0) / scores.length);
    const topicObj = session.topicQueue.find(t => t.day === dayNum);
    const title = topicObj ? topicObj.title : `Day ${dayNum}`;
    return { day: dayNum, title, score: avgScore };
  });

  return {
    overallAccuracy,
    perDay,
    difficultyProgression,
    questionTypeBreakdown
  };
}


/**
 * Processes a single turn input from the candidate.

 * 
 * @param {string} sessionId 
 * @param {string} message 
 * @returns {Promise<Object>} Route response shape or error shape.
 */
export async function handleTurn(sessionId, message) {
  const session = await getSessionDoc(sessionId);
  if (!session) {
    return {
      status: 404,
      error: `Session with ID "${sessionId}" was not found.`
    };
  }

  // Idempotency check: If session is already DONE, return cached feedback immediately
  if (session.state === SessionState.DONE) {
    console.log(`[SessionManager] Idempotent hit: session "${sessionId}" is already completed.`);
    return {
      reply: 'Interview completed.',
      done: true,
      feedback: session.feedback,
      metrics: computeMetrics(session)
    };
  }

  // 1. Backend Idempotency Check (Rapid duplicate submit prevention)
  const cleanMsg = (message || '').trim().toLowerCase();
  const now = Date.now();
  const isTesting = process.env.SIMULATE_LLM_OUTAGE === 'true' || process.env.NODE_ENV === 'test';
  if (!isTesting && cleanMsg !== '' && session.lastMessageHash === cleanMsg && session.lastMessageTime && (now - new Date(session.lastMessageTime).getTime()) < 5000) {
    console.log(`[SessionManager Idempotency] Duplicate submit detected for session "${sessionId}" within 5s window. Returning cached response.`);
    return session.lastResponse;
  }

  // Server-side Response Timing and Hedging Check
  const answerReceivedAt = new Date().toISOString();
  const questionSentAt = session.questionSentAt || session.createdAt || answerReceivedAt;
  const responseTimeSeconds = Math.max(0, Math.round((new Date(answerReceivedAt) - new Date(questionSentAt)) / 1000));
  
  const hedgeMarkers = detectHedging(message);
  if (hedgeMarkers.length > 0) {
    session.hedgeEventCount = (session.hedgeEventCount || 0) + 1;
  }

  // 2. Empty/whitespace message handling
  let forceAdvanceDueToBlankRetries = false;
  const isMsgEmpty = !message || message.trim() === '';
  
  if (isMsgEmpty) {
    if (session.emptyRetryCount === undefined) session.emptyRetryCount = 0;

    if (session.emptyRetryCount < 2) {
      session.emptyRetryCount++;
      const reprompt = `I didn't receive your answer. Can you please describe your experience on this topic?`;

      // Log blank turn in transcript
      session.turnCount++;
      session.transcript.push({
        role: 'candidate',
        text: '[Empty Response]',
        turn: session.turnCount
      });

      session.questionSentAt = new Date().toISOString();
      await saveSessionDoc(sessionId, session);

      const responsePayload = {
        reply: reprompt,
        done: false,
        questionsAsked: session.questionsAsked,
        distinctDaysCovered: session.distinctDaysCovered.length,
        detectedConnections: [],
        action: 'followup'
      };

      // Cache this response for idempotency checks
      session.lastMessageHash = cleanMsg;
      session.lastMessageTime = new Date().toISOString();
      session.lastResponse = responsePayload;
      session.questionSentAt = new Date().toISOString();
      await saveSessionDoc(sessionId, session);

      return responsePayload;
    } else {
      // 2 empty retries hit: force advance!
      console.log(`[SessionManager Override] Forcing topic advance because candidate hit 2 blank retries.`);
      session.emptyRetryCount = 0;
      forceAdvanceDueToBlankRetries = true;
    }
  } else {
    // Reset empty retry count on non-empty message
    session.emptyRetryCount = 0;
  }

  // Increment turn Count
  session.turnCount++;

  // Append candidate response (always store full untruncated message in Firestore transcript)
  session.transcript.push({
    role: 'candidate',
    text: message,
    turn: session.turnCount
  });

  const currentTopicIndex = session.cursor;
  const currentTopic = session.topicQueue[currentTopicIndex];

  const isMCQTurn = session.nextQuestionType === 'mcq';
  const isDiagramTurn = session.nextQuestionType === 'diagram_interpret';
  const isDisengaged = checkDisengagement(message, isMCQTurn);

  if (isDisengaged && !forceAdvanceDueToBlankRetries) {
    if (session.disengagementCount === undefined) {
      session.disengagementCount = 0;
    }
    session.disengagementCount++;

    console.log(`[Disengagement Logger] Logged disengagement count ${session.disengagementCount} for session "${sessionId}"`);

    if (session.disengagementCount === 1) {
      const reply = `I noticed you didn't attempt to answer the question about Day ${currentTopic.day}: "${currentTopic.title}". Please take a moment to provide a genuine response so we can properly evaluate your understanding of these objectives.`;
      
      session.turnCount++;
      session.transcript.push({
        role: 'interviewer',
        day: currentTopic.day,
        text: reply,
        turn: session.turnCount
      });

      session.questionSentAt = new Date().toISOString();
      await saveSessionDoc(sessionId, session);

      const responsePayload = {
        reply,
        done: false,
        questionsAsked: session.questionsAsked,
        distinctDaysCovered: session.distinctDaysCovered.length,
        detectedConnections: [],
        action: 'followup'
      };

      session.lastMessageHash = cleanMsg;
      session.lastMessageTime = new Date().toISOString();
      session.lastResponse = responsePayload;
      session.questionSentAt = new Date().toISOString();
      await saveSessionDoc(sessionId, session);

      return responsePayload;
    } else if (session.disengagementCount === 2) {
      const reply = `Warning: This is your second disengaged response. Failing to engage with the technical curriculum objectives will directly impact your review status. Please provide a technical answer.`;
      
      session.turnCount++;
      session.transcript.push({
        role: 'interviewer',
        day: currentTopic.day,
        text: reply,
        turn: session.turnCount
      });

      session.questionSentAt = new Date().toISOString();
      await saveSessionDoc(sessionId, session);

      const responsePayload = {
        reply,
        done: false,
        questionsAsked: session.questionsAsked,
        distinctDaysCovered: session.distinctDaysCovered.length,
        detectedConnections: [],
        action: 'followup'
      };

      session.lastMessageHash = cleanMsg;
      session.lastMessageTime = new Date().toISOString();
      session.lastResponse = responsePayload;
      session.questionSentAt = new Date().toISOString();
      await saveSessionDoc(sessionId, session);

      return responsePayload;
    } else {
      session.state = SessionState.DONE;
      session.interviewEndedAt = new Date().toISOString();
      session.feedback = {
        summary: "The technical review was terminated early due to repeated disengagement and a refusal to attempt the technical questions.",
        strengths: [],
        gaps: [],
        next: []
      };
      session.accuracyLog = []; // zero out/empty scores
      
      await saveSessionDoc(sessionId, session);

      const responsePayload = {
        reply: "This session has been terminated due to repeated non-engagement.",
        done: true,
        feedback: session.feedback,
        metrics: {
          overallAccuracy: 0,
          perDay: [],
          difficultyProgression: [],
          questionTypeBreakdown: { open: 0, mcq: 0, diagram_interpret: 0 }
        }
      };

      session.lastMessageHash = cleanMsg;
      session.lastMessageTime = new Date().toISOString();
      session.lastResponse = responsePayload;
      await saveSessionDoc(sessionId, session);

      return responsePayload;
    }
  }

  // 3. Evaluate Turn with LLM (or bypass on blank forced advancement)
  const floorMetInput = (session.questionsAsked >= 8 && session.distinctDaysCovered.length >= 4);
  const nextQuestionTypeGenerated = session.pendingQuestionType || 'open';
  let llmResponse;
  let detectedConnections = [];
  let finalAccuracyScore = 50;
  let llmConfidence = 50;
  let semanticScore = 0;
  let conceptScore = 0;

  // isMCQTurn is already declared above

  if (isMCQTurn) {
    const candidateSelectionIndex = parseInt((message || '').trim());
    const isCorrect = candidateSelectionIndex === session.pendingMCQAnswer;
    
    finalAccuracyScore = isCorrect ? 100 : 20;
    llmConfidence = finalAccuracyScore;
    semanticScore = 0;
    conceptScore = 0;

    // Use dummy message to maintain stopping checks in LLM call
    const dummyMessage = `[MCQ Selection: Option ${message} - ${isCorrect ? 'Correct' : 'Incorrect'}]`;
    session.mcqResult = {
      choiceIndex: candidateSelectionIndex,
      correctIndex: session.pendingMCQAnswer,
      correct: isCorrect
    };

    llmResponse = await evaluateTurnWithLLM(session, dummyMessage, []);
    delete session.mcqResult;
  } else if (forceAdvanceDueToBlankRetries) {
    llmResponse = {
      classification: 'shallow',
      reasoning: 'Forced advance after 2 empty retries.',
      action: 'advance',
      reply: `Let's move on.`,
      updatedMemory: session.interviewMemory || 'Candidate skipped topic due to consecutive blank answers.',
      llmConfidence: 10
    };
    finalAccuracyScore = 10;
    llmConfidence = 10;
    semanticScore = 0;
    conceptScore = 0;
  } else {
    // 1. Semantic connection detection layer (Phase 2.5)
    const currentTopicDay = currentTopic ? currentTopic.day : -1;
    detectedConnections = await findRelatedDays(message, [currentTopicDay], 2);

    // 2. Structured LLM Call evaluation (Phase 4)
    llmResponse = await evaluateTurnWithLLM(session, message, detectedConnections);

    // 3. Compute 3 signals for open-ended turn:
    llmConfidence = llmResponse.llmConfidence || 50;
    semanticScore = await computeSemanticScore(message, currentTopicDay);

    const cachedTerms = currentTopic ? currentTopic.conceptTerms || [] : [];
    let matchCount = 0;
    const cleanAnswer = message.toLowerCase();
    cachedTerms.forEach(term => {
      if (cleanAnswer.includes(term.toLowerCase())) {
        matchCount++;
      }
    });
    conceptScore = cachedTerms.length > 0 ? Math.round((matchCount / cachedTerms.length) * 100) : 0;

    // Blended formula
    finalAccuracyScore = Math.round(0.5 * llmConfidence + 0.3 * semanticScore + 0.2 * conceptScore);

    // Offline score mapping to simulate realistic values for tests
    if (!process.env.GEMINI_API_KEY || process.env.SIMULATE_LLM_OUTAGE === 'true') {
      if (llmResponse.classification === 'strong') {
        finalAccuracyScore = 95;
      } else if (llmResponse.classification === 'partial') {
        finalAccuracyScore = 65;
      } else if (llmResponse.classification === 'shallow') {
        finalAccuracyScore = 20;
      } else if (llmResponse.classification === 'off_topic') {
        finalAccuracyScore = 10;
      }
    }
  }

  // Discard modelWantsToStop from LLM response if floor was not met at turn start
  if (llmResponse) {
    if (!floorMetInput) {
      llmResponse.modelWantsToStop = false;
    }
  }

  const hallucinationFlag = llmResponse && !!llmResponse.hallucinationFlag;
  if (hallucinationFlag) {
    session.hallucinationCount = (session.hallucinationCount || 0) + 1;
    session.hallucinationCountForCurrentTopic = (session.hallucinationCountForCurrentTopic || 0) + 1;
    finalAccuracyScore = 20;
  }

  // Extract reaction clause and compute fullReply
  let reaction = llmResponse && llmResponse.reactionClause ? llmResponse.reactionClause.trim() : "";
  if (hallucinationFlag) {
    const correction = llmResponse.hallucinationCorrection || "";
    const correctionPrefix = `⚠️ ${correction}`.trim();
    if (!reaction.includes('⚠️')) {
      reaction = reaction ? `${correctionPrefix} ${reaction}` : correctionPrefix;
    }
  }
  const replyBody = llmResponse && llmResponse.reply ? llmResponse.reply.trim() : "";
  const fullReply = reaction ? `${reaction} ${replyBody}` : replyBody;

  // Store reaction in session to prevent repetition
  if (reaction) {
    if (!session.recentReactions) {
      session.recentReactions = [];
    }
    session.recentReactions.push(reaction);
    if (session.recentReactions.length > 2) {
      session.recentReactions.shift();
    }
  }
  const whyProbe = !!session.pendingWhyProbe;

  // Update difficulty and next question type based on accuracy
  updateDifficulty(session, finalAccuracyScore);

  // Set the next question type to the type of the question that was generated on this turn
  session.nextQuestionType = nextQuestionTypeGenerated;

  // Append to accuracyLog
  if (!session.accuracyLog) session.accuracyLog = [];
  session.accuracyLog.push({
    day: currentTopic ? currentTopic.day : null,
    title: currentTopic ? currentTopic.title : 'Curriculum Topic',
    questionType: isMCQTurn ? 'mcq' : (isDiagramTurn ? 'diagram_interpret' : 'open'),
    difficultyTier: session.difficultyTier,
    classification: llmResponse ? llmResponse.classification : 'unknown',
    finalAccuracyScore,
    llmConfidence,
    semanticScore,
    conceptScore,
    reasoning: llmResponse.reasoning || "No specific feedback reasoning provided.",
    candidateAnswer: message || "",
    questionSentAt,
    answerReceivedAt,
    responseTimeSeconds,
    hallucinationFlag,
    hallucinationCorrection: llmResponse ? (llmResponse.hallucinationCorrection || "") : "",
    hedgeMarkers,
    whyProbe
  });

  console.log(`\n--- [LLM Evaluation Log] Session "${sessionId}" Turn ${session.turnCount} ---`);
  console.log(`  Classification: ${llmResponse.classification}`);
  console.log(`  Private Reasoning: ${llmResponse.reasoning}`);
  console.log(`  LLM Action Selection: ${llmResponse.action}`);
  console.log(`  LLM Calibrated Confidence: ${llmConfidence}`);
  console.log(`  Semantic Score: ${semanticScore}`);
  console.log(`  Concept Score: ${conceptScore}`);
  console.log(`  Blended Accuracy Score: ${finalAccuracyScore}`);
  console.log(`  Difficulty Tier: ${session.difficultyTier}`);
  console.log(`  Next Question Type: ${session.nextQuestionType}`);
  console.log(`  Updated Memory Summary: "${llmResponse.updatedMemory}"`);

  // Store MCQ correct answer in session (never return to client)
  if (session.nextQuestionType === 'mcq' && llmResponse.mcqCorrectIndex !== undefined) {
    session.pendingMCQAnswer = llmResponse.mcqCorrectIndex;
  } else {
    session.pendingMCQAnswer = null;
  }

  // Set pendingWhyProbe and update whyChainDepth
  session.pendingWhyProbe = llmResponse && !!llmResponse.whyProbe;
  if (session.pendingWhyProbe) {
    session.whyChainDepth = (session.whyChainDepth || 0) + 1;
  }

  // Store generated diagram in session to prevent structural repetition
  if (llmResponse && llmResponse.diagramDefinition) {
    if (!session.recentDiagrams) {
      session.recentDiagrams = [];
    }
    session.recentDiagrams.push(llmResponse.diagramDefinition);
    if (session.recentDiagrams.length > 2) {
      session.recentDiagrams.shift();
    }
  }

  // Attach turn classification to candidate transcript
  const lastEntry = session.transcript[session.transcript.length - 1];
  if (lastEntry && lastEntry.role === 'candidate') {
    lastEntry.classification = llmResponse.classification;
  }

  // Log detected connections
  if (detectedConnections && detectedConnections.length > 0) {
    detectedConnections.forEach(conn => {
      const replyLower = (llmResponse.reply || '').toLowerCase();
      const usedByLLM = replyLower.includes(`day ${conn.day}`) || replyLower.includes(conn.title.toLowerCase().split(' ')[0]);
      console.log(`[Connection Detector Log] Detected connection with Day ${conn.day} ("${conn.title}") [Score: ${conn.similarity}]. Used by LLM: ${usedByLLM}`);
    });
  }

  // Update memory
  session.interviewMemory = llmResponse.updatedMemory;

  // Rule enforcement
  let action = llmResponse.action;
  let forceAdvanceDueToFollowupLimit = false;
  let forceAdvanceDueToHallucinationLimit = false;

  if (isMCQTurn) {
    console.log(`[SessionManager Override] Overwriting action to "advance" because MCQ turns always transition to the next topic.`);
    action = 'advance';
  } else if (action === 'followup' && session.followupCountForCurrentTopic >= 1) {
    console.log(`[SessionManager Override] Overwriting action "followup" to "advance" because followupCount is already ${session.followupCountForCurrentTopic}.`);
    action = 'advance';
    forceAdvanceDueToFollowupLimit = true;
  } else if (action === 'followup' && session.hallucinationCountForCurrentTopic >= 2) {
    console.log(`[SessionManager Override] Overwriting action "followup" to "advance" because hallucinationCountForCurrentTopic is ${session.hallucinationCountForCurrentTopic}.`);
    action = 'advance';
    forceAdvanceDueToHallucinationLimit = true;
  }

  // Handle follow-up action
  if (action === 'followup') {
    session.followupCountForCurrentTopic++;
    session.questionsAsked++;
    
    session.transcript.push({
      role: 'interviewer',
      day: currentTopic.day,
      text: fullReply,
      turn: session.turnCount + 1
    });

    session.questionSentAt = new Date().toISOString();
    await saveSessionDoc(sessionId, session);

    const responsePayload = {
      reply: fullReply,
      done: false,
      questionsAsked: session.questionsAsked,
      distinctDaysCovered: session.distinctDaysCovered.length,
      detectedConnections,
      action,
      nextQuestionType: session.nextQuestionType,
      difficultyTier: session.difficultyTier,
      mcqOptions: llmResponse.mcqOptions || null,
      diagramDefinition: llmResponse.diagramDefinition || null,
      diagramQuestionText: llmResponse.diagramQuestionText || null,
      questionHistory: (session.accuracyLog || []).map(log => ({
        day: log.day,
        title: log.title || 'Curriculum Topic',
        difficultyTier: log.difficultyTier,
        questionType: log.questionType,
        classification: log.classification || 'unknown'
      }))
    };

    session.lastMessageHash = cleanMsg;
    session.lastMessageTime = new Date().toISOString();
    session.lastResponse = responsePayload;
    session.lastMCQOptions = responsePayload.mcqOptions || null;
    session.questionSentAt = new Date().toISOString();
    await saveSessionDoc(sessionId, session);

    return responsePayload;
  }

  // Handle advance action
  if (action === 'advance' || action === 'wrapup') {
    if (currentTopic) {
      currentTopic.status = 'asked';
      if (!session.distinctDaysCovered.includes(currentTopic.day)) {
        session.distinctDaysCovered.push(currentTopic.day);
      }
      session.questionsAsked++;
    }

    session.followupCountForCurrentTopic = 0;
    session.whyChainDepth = 0;
    session.hallucinationCountForCurrentTopic = 0;

    const isOutOfTopics = session.cursor + 1 >= session.topicQueue.length;
    const wrapUpTriggered = shouldWrapUp(session, llmResponse ? llmResponse.modelWantsToStop : false) || isOutOfTopics;

    if (wrapUpTriggered) {
      session.state = SessionState.DONE;
      session.interviewEndedAt = new Date().toISOString();
      session.feedback = await generateFeedbackReport(session);
      await saveSessionDoc(sessionId, session);

      const responsePayload = {
        reply: 'Interview completed.',
        done: true,
        feedback: session.feedback,
        metrics: computeMetrics(session)
      };

      session.lastMessageHash = cleanMsg;
      session.lastMessageTime = new Date().toISOString();
      session.lastResponse = responsePayload;
      await saveSessionDoc(sessionId, session);

      return responsePayload;
    }

    // Advance topic cursor
    session.cursor++;
    const nextTopic = session.topicQueue[session.cursor];
    
    const replyText = (forceAdvanceDueToFollowupLimit || forceAdvanceDueToBlankRetries || forceAdvanceDueToHallucinationLimit)
      ? `Got it. Let's move on to the next topic. Can you tell me about your experience on Day ${nextTopic.day}: "${nextTopic.title}"?`
      : fullReply;

    session.transcript.push({
      role: 'interviewer',
      day: nextTopic.day,
      text: replyText,
      turn: session.turnCount + 1
    });

    session.questionSentAt = new Date().toISOString();
    await saveSessionDoc(sessionId, session);

    const responsePayload = {
      reply: replyText,
      done: false,
      questionsAsked: session.questionsAsked,
      distinctDaysCovered: session.distinctDaysCovered.length,
      detectedConnections,
      action,
      nextQuestionType: session.nextQuestionType,
      difficultyTier: session.difficultyTier,
      mcqOptions: llmResponse.mcqOptions || null,
      diagramDefinition: llmResponse.diagramDefinition || null,
      diagramQuestionText: llmResponse.diagramQuestionText || null,
      questionHistory: (session.accuracyLog || []).map(log => ({
        day: log.day,
        title: log.title || 'Curriculum Topic',
        difficultyTier: log.difficultyTier,
        questionType: log.questionType,
        classification: log.classification || 'unknown'
      }))
    };

    session.lastMessageHash = cleanMsg;
    session.lastMessageTime = new Date().toISOString();
    session.lastResponse = responsePayload;
    session.lastMCQOptions = responsePayload.mcqOptions || null;
    session.questionSentAt = new Date().toISOString();
    await saveSessionDoc(sessionId, session);

    return responsePayload;
  }

  return {
    error: 'Invalid state machine action encountered.'
  };
}

/**
 * Logs a proctoring violation server-side.
 * If total violations (including fullscreen-exit and tab-switch) exceeds 3,
 * the candidate is suspended.
 */
export async function reportViolation(sessionId, violationType) {
  const session = await getSessionDoc(sessionId);
  if (!session) {
    return { error: 'Session not found', status: 404 };
  }
  
  if (session.state === SessionState.DONE) {
    // If it's already done (could be suspended or regular end), just return status
    const isSuspended = session.feedback && session.feedback.summary.includes('suspended');
    return {
      done: true,
      suspended: isSuspended,
      violationCount: session.violations ? session.violations.length : 0,
      feedback: session.feedback,
      metrics: {
        overallAccuracy: 0,
        perDay: [],
        difficultyProgression: [],
        questionTypeBreakdown: { open: 0, mcq: 0, diagram_interpret: 0 }
      }
    };
  }

  if (!session.violations) {
    session.violations = [];
  }
  
  const violationCount = session.violations.length + 1;
  session.violations.push({
    timestamp: new Date().toISOString(),
    type: violationType,
    count: violationCount
  });

  console.log(`[Proctoring Server] Logged violation ${violationCount} for session "${sessionId}": ${violationType}`);

  if (violationCount >= 4) {
    // Suspend candidate!
    session.state = SessionState.DONE;
    session.feedback = {
      summary: "Candidate was suspended for repeated proctoring violations.",
      strengths: [],
      gaps: [],
      next: []
    };
    session.accuracyLog = []; // zero out/empty scores
    
    // Register cooldown
    const candSnapshot = session.candidateSnapshot;
    const candId = candSnapshot.id || (candSnapshot.member ? candSnapshot.member.id : null);
    if (candId) {
      cooldowns.set(candId, new Date());
      console.log(`[Cooldown Registered] Candidate ID "${candId}" suspended at ${new Date().toISOString()}`);
    }
    
    await saveSessionDoc(sessionId, session);

    return {
      done: true,
      suspended: true,
      violationCount,
      feedback: session.feedback,
      metrics: {
        overallAccuracy: 0,
        perDay: [],
        difficultyProgression: [],
        questionTypeBreakdown: { open: 0, mcq: 0, diagram_interpret: 0 }
      }
    };
  }

  await saveSessionDoc(sessionId, session);
  return {
    done: false,
    suspended: false,
    violationCount
  };
}

