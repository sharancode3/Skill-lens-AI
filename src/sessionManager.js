import { db } from './firebase.js';
import { buildTopicQueue } from './topicSelector.js';

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
async function getSessionDoc(sessionId) {
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
    done: false
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

  // Increment turn Count
  session.turnCount++;

  // Append candidate response
  session.transcript.push({
    role: 'candidate',
    text: message,
    turn: session.turnCount
  });

  // Mark the just-asked topic as asked, record day, increment questionsAsked
  const currentTopicIndex = session.cursor;
  const currentTopic = session.topicQueue[currentTopicIndex];
  if (currentTopic) {
    currentTopic.status = 'asked';
    if (!session.distinctDaysCovered.includes(currentTopic.day)) {
      session.distinctDaysCovered.push(currentTopic.day);
    }
    session.questionsAsked++;
  }

  // Evaluate stopping criteria
  const isOutOfTopics = session.cursor + 1 >= session.topicQueue.length;
  const wrapUpTriggered = shouldWrapUp(session) || isOutOfTopics;

  if (wrapUpTriggered) {
    // Transition state
    session.state = SessionState.DONE;
    
    // Placeholder feedback matching schema
    session.feedback = {
      summary: `Candidate successfully completed the interview. Covered ${session.questionsAsked} questions over ${session.distinctDaysCovered.length} curriculum days.`,
      strengths: ['Demonstrated understanding of core curriculum concepts'],
      gaps: ['No critical gaps detected in mock turn handler'],
      next: ['Revisit curriculum modules for deeper advanced integration projects']
    };

    await saveSessionDoc(sessionId, session);

    return {
      reply: 'Interview completed.',
      done: true,
      feedback: session.feedback
    };
  }

  // Otherwise, advance cursor and ask next question
  session.cursor++;
  const nextTopic = session.topicQueue[session.cursor];
  const nextQuestion = `Got it. Let's move to the next topic. Can you tell me about your experience on Day ${nextTopic.day}: "${nextTopic.title}"?`;

  session.transcript.push({
    role: 'interviewer',
    day: nextTopic.day,
    text: nextQuestion,
    turn: session.turnCount + 1
  });

  await saveSessionDoc(sessionId, session);

  return {
    reply: nextQuestion,
    done: false
  };
}
