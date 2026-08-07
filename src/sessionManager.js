import { db } from './firebase.js';
import { buildTopicQueue } from './topicSelector.js';
import { findRelatedDays } from './embeddingManager.js';
import { evaluateTurnWithLLM, generateFeedbackReport } from './llmClient.js';


// Explicit Session States
export const SessionState = {
  INIT: 'INIT',
  ASKING: 'ASKING',
  WRAP_UP: 'WRAP_UP',
  DONE: 'DONE'
};

// Local cache store for offline simulation or fallback if Firestore connection is unavailable
const localSessions = new Map();

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
async function saveSessionDoc(sessionId, data) {
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
export function shouldWrapUp(session) {
  const hasMinQuestionsAndDays = session.questionsAsked >= 8 && session.distinctDaysCovered.length >= 4;
  const hitsHardCap = session.turnCount >= 14;
  return hasMinQuestionsAndDays || hitsHardCap;
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
    questionsAsked: 0,
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
    createdAt: new Date().toISOString()
  };

  // Select first topic and build template question
  const firstTopic = topicQueue[0];
  const firstQuestion = `Welcome ${candidate.name || 'Candidate'}. Let's begin the interview. Can you tell me about your experience on Day ${firstTopic.day}: "${firstTopic.title}"?`;

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
    questionsAsked: 0,
    distinctDaysCovered: 0
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
      feedback: session.feedback
    };
  }

  // 1. Backend Idempotency Check (Rapid duplicate submit prevention)
  const cleanMsg = (message || '').trim().toLowerCase();
  const now = Date.now();
  if (cleanMsg !== '' && session.lastMessageHash === cleanMsg && session.lastMessageTime && (now - new Date(session.lastMessageTime).getTime()) < 5000) {
    console.log(`[SessionManager Idempotency] Duplicate submit detected for session "${sessionId}" within 5s window. Returning cached response.`);
    return session.lastResponse;
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

  // 3. Evaluate Turn with LLM (or bypass on blank forced advancement)
  let llmResponse;
  let detectedConnections = [];

  if (forceAdvanceDueToBlankRetries) {
    llmResponse = {
      classification: 'shallow',
      reasoning: 'Forced advance after 2 empty retries.',
      action: 'advance',
      reply: `Let's move on.`,
      updatedMemory: session.interviewMemory || 'Candidate skipped topic due to consecutive blank answers.'
    };
  } else {
    // 1. Semantic connection detection layer (Phase 2.5)
    const currentTopicDay = currentTopic ? currentTopic.day : -1;
    detectedConnections = await findRelatedDays(message, [currentTopicDay], 2);

    // 2. Structured LLM Call evaluation (Phase 4)
    llmResponse = await evaluateTurnWithLLM(session, message, detectedConnections);
  }
  
  console.log(`\n--- [LLM Evaluation Log] Session "${sessionId}" Turn ${session.turnCount} ---`);
  console.log(`  Classification: ${llmResponse.classification}`);
  console.log(`  Private Reasoning: ${llmResponse.reasoning}`);
  console.log(`  LLM Action Selection: ${llmResponse.action}`);
  console.log(`  Updated Memory Summary: "${llmResponse.updatedMemory}"`);

  // Attach the turn classification inline to the candidate's transcript entry
  const lastEntry = session.transcript[session.transcript.length - 1];
  if (lastEntry && lastEntry.role === 'candidate') {
    lastEntry.classification = llmResponse.classification;
  }

  // Log detected connections and checking if LLM chose to use them
  if (detectedConnections && detectedConnections.length > 0) {
    detectedConnections.forEach(conn => {
      const replyLower = llmResponse.reply.toLowerCase();
      // Check if reply references the day number or keyword in title
      const usedByLLM = replyLower.includes(`day ${conn.day}`) || replyLower.includes(conn.title.toLowerCase().split(' ')[0]);
      console.log(`[Connection Detector Log] Detected connection with Day ${conn.day} ("${conn.title}") [Score: ${conn.similarity}]. Used by LLM: ${usedByLLM}`);
    });
  }

  // Update interview memory
  session.interviewMemory = llmResponse.updatedMemory;

  // 4. Server-side rule enforcement
  let action = llmResponse.action;
  let forceAdvanceDueToFollowupLimit = false;

  if (action === 'followup' && session.followupCountForCurrentTopic >= 1) {
    console.log(`[SessionManager Override] Overwriting action "followup" to "advance" because followupCount is already ${session.followupCountForCurrentTopic}.`);
    action = 'advance';
    forceAdvanceDueToFollowupLimit = true;
  }

  // 5. Handle follow-up action
  if (action === 'followup') {
    session.followupCountForCurrentTopic++;
    
    session.transcript.push({
      role: 'interviewer',
      day: currentTopic.day,
      text: llmResponse.reply,
      turn: session.turnCount + 1
    });

    await saveSessionDoc(sessionId, session);

    const responsePayload = {
      reply: llmResponse.reply,
      done: false,
      questionsAsked: session.questionsAsked,
      distinctDaysCovered: session.distinctDaysCovered.length,
      detectedConnections,
      action
    };

    // Cache this response for idempotency checks
    session.lastMessageHash = cleanMsg;
    session.lastMessageTime = new Date().toISOString();
    session.lastResponse = responsePayload;
    await saveSessionDoc(sessionId, session);

    return responsePayload;
  }

  // 6. Handle advance action (topic transition or wrap up)
  if (action === 'advance' || action === 'wrapup') {
    // Complete current topic
    if (currentTopic) {
      currentTopic.status = 'asked';
      if (!session.distinctDaysCovered.includes(currentTopic.day)) {
        session.distinctDaysCovered.push(currentTopic.day);
      }
      session.questionsAsked++;
    }

    // Reset topic followups count
    session.followupCountForCurrentTopic = 0;

    // Evaluate stopping criteria
    const isOutOfTopics = session.cursor + 1 >= session.topicQueue.length;
    const wrapUpTriggered = shouldWrapUp(session) || isOutOfTopics;

    if (wrapUpTriggered) {
      session.state = SessionState.DONE;
      
      // Generate real structured feedback via LLM (with mechanical fallback)
      session.feedback = await generateFeedbackReport(session);

      await saveSessionDoc(sessionId, session);

      const responsePayload = {
        reply: 'Interview completed.',
        done: true,
        feedback: session.feedback
      };

      // Cache this response for idempotency checks
      session.lastMessageHash = cleanMsg;
      session.lastMessageTime = new Date().toISOString();
      session.lastResponse = responsePayload;
      await saveSessionDoc(sessionId, session);

      return responsePayload;
    }

    // Advance topic cursor
    session.cursor++;
    const nextTopic = session.topicQueue[session.cursor];
    
    // Choose reply: if overrode follow-up limit or forced by blank retries, use transition template; else use LLM reply
    const replyText = (forceAdvanceDueToFollowupLimit || forceAdvanceDueToBlankRetries)
      ? `Got it. Let's move on to the next topic. Can you tell me about your experience on Day ${nextTopic.day}: "${nextTopic.title}"?`
      : llmResponse.reply;

    session.transcript.push({
      role: 'interviewer',
      day: nextTopic.day,
      text: replyText,
      turn: session.turnCount + 1
    });

    await saveSessionDoc(sessionId, session);

    const responsePayload = {
      reply: replyText,
      done: false,
      questionsAsked: session.questionsAsked,
      distinctDaysCovered: session.distinctDaysCovered.length,
      detectedConnections,
      action
    };

    // Cache this response for idempotency checks
    session.lastMessageHash = cleanMsg;
    session.lastMessageTime = new Date().toISOString();
    session.lastResponse = responsePayload;
    await saveSessionDoc(sessionId, session);

    return responsePayload;
  }

  // Fallback case
  return {
    error: 'Invalid state machine action encountered.'
  };
}

