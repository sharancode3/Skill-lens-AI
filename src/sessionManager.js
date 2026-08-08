import { db } from './firebase.js';
import { buildTopicQueue } from './topicSelector.js';
import { findRelatedDays, computeSemanticScore } from './embeddingManager.js';
import { evaluateTurnWithLLM, generateFeedbackReport, generateInterviewerResponseWithLLM, mockLLMCall } from './llmClient.js';
import { getMCQForDay, getDiagramForDay } from './questionBank.js';


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
 * CRITICAL CORRECTNESS REQUIREMENT: Requires questionsAsked >= session.targetQuestionCount
 * AND distinctDaysCovered.length >= 4. Neither condition alone is sufficient.
 * 
 * @param {Object} session - The interview session document data.
 * @returns {boolean} True if the interview stopping conditions are met.
 */
export function checkStoppingCondition(session, modelWantsToStop) {
  const target = session.targetQuestionCount || 8;
  const questionsAsked = session.questionsAsked || 0;
  const distinctDays = session.distinctDaysCovered || [];
  const distinctDaysCount = Array.isArray(distinctDays) ? distinctDays.length : 0;

  // Hard safety cap (turnCount >= 24) to prevent infinite loops if model completely hangs
  const hitsHardCap = (session.turnCount || 0) >= 24;
  if (hitsHardCap) {
    console.log(`[Stopping Condition] Safety hard cap hit at turnCount: ${session.turnCount}. session "${session.sessionId}": ended at questionsAsked=${questionsAsked}, targetWas=${target}, distinctDays=${distinctDaysCount}`);
    return true;
  }

  // Dual-condition gate: MUST have questionsAsked >= target AND distinctDaysCount >= 4
  const conditionMet = questionsAsked >= target && distinctDaysCount >= 4;

  if (!conditionMet) {
    return false;
  }

  // If Capstone is triggered but has not been answered/evaluated in accuracyLog, don't stop yet
  const log = session.accuracyLog || [];
  const hasAnsweredCapstone = log.some(l => l.questionType === 'capstone');
  if (session.capstoneTriggered && !hasAnsweredCapstone) {
    return false;
  }

  console.log(`[Stopping Condition] Target and curriculum requirements satisfied. session "${session.sessionId}": ended at questionsAsked=${questionsAsked}, targetWas=${target}, distinctDays=${distinctDaysCount}`);
  return true;
}

export function shouldWrapUp(session, modelWantsToStop) {
  return checkStoppingCondition(session, modelWantsToStop);
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

  // Randomize target question count between 8 and 12 inclusive
  const targetQuestionCount = Math.floor(Math.random() * 5) + 8;
  const candidateName = candidate.member?.name || candidate.name || 'Candidate';
  console.log(`[SessionManager] session "${sessionId}": target=${targetQuestionCount}, candidate="${candidateName}"`);

  // Bounded mix rule: At most 2 MCQs and at most 2 Graphs total across session drawn from bank
  const eligibleSlotIndices = [];
  for (let i = 1; i < Math.min(targetQuestionCount - 1, topicQueue.length); i++) {
    eligibleSlotIndices.push(i);
  }
  const shuffledSlots = [...eligibleSlotIndices].sort(() => 0.5 - Math.random());
  const mcqSlotSet = new Set(shuffledSlots.slice(0, 2));
  const diagSlotSet = new Set(shuffledSlots.slice(2, 4));

  const slotModalities = topicQueue.map((_, idx) => {
    if (mcqSlotSet.has(idx)) return 'mcq';
    if (diagSlotSet.has(idx)) return 'diagram_interpret';
    return 'open';
  });

  // Construct initial session document matching schema
  const session = {
    sessionId,
    state: SessionState.ASKING,
    candidateSnapshot: candidate,
    targetQuestionCount,
    topicQueue,
    slotModalities,
    mcqCount: 0,
    diagramCount: 0,
    usedBankQuestionIds: [],
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
    // Phase 7: Compact derived state — incrementally updated after each topic evaluation.
    // Replaces freeform interviewMemory string as the structured context passed to LLM brains.
    compactState: {
      strongTopics: [],
      weakTopics: [],
      misconceptions: [],
      currentDay: topicQueue[0]?.day || null,
      currentDifficultyTier: 'standard',
      questionsAsked: 1,
      daysCovered: []
    },
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
    accuracyLog: [],
    violations: [],
    fullscreenExits: 0,
    tabSwitches: 0,
    clipboardViolations: 0,
    flaggedForReview: false,
    warningLockoutUntil: null,
    proctoring: {
      violations: [],
      flaggedForReview: false,
      totalViolationCount: 0,
      warningLockoutUntil: null
    }
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
    targetQuestionCount: session.targetQuestionCount,
    distinctDaysCovered: 0,
    difficultyTier: session.difficultyTier,
    questionHistory: []
  };
}

/**
 * Updates difficulty tier and determines next question type based on performance.
 */
export function updateDifficulty(session, finalScore, currentHallucinationFlag = false) {
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

    // Check last two log entries for hallucination flags (one current, one previous)
    const log = session.accuracyLog || [];
    const prevEntry = log[log.length - 1];
    const hasRecentHallucinations = !!currentHallucinationFlag || (prevEntry && !!prevEntry.hallucinationFlag);

    // Hysteresis escalation logic: last 2 scores >= 80, no recent hallucinations
    const canEscalate = s1 >= 80 && s2 >= 80 && !hasRecentHallucinations;

    // Hysteresis de-escalation logic: most recent score < 40, and not the very first question at this new tier
    const isFirstQuestionAtNewTier = session.lastTierChangeTurnCount !== undefined && (session.turnCount <= session.lastTierChangeTurnCount + 1);
    const canDeEscalate = finalScore < 40 && !isFirstQuestionAtNewTier;

    if (canEscalate) {
      const nextIdx = Math.min(currentIdx + 1, tiers.length - 1);
      if (nextIdx !== currentIdx) {
        session.difficultyTier = tiers[nextIdx];
        session.lastTierChangeTurnCount = session.turnCount;
        console.log(`[Difficulty Engine] Escalating difficulty to: ${session.difficultyTier}.`);
      }
    } else if (canDeEscalate) {
      const nextIdx = Math.max(currentIdx - 1, 0);
      if (nextIdx !== currentIdx) {
        session.difficultyTier = tiers[nextIdx];
        session.lastTierChangeTurnCount = session.turnCount;
        console.log(`[Difficulty Engine] De-escalating difficulty to: ${session.difficultyTier}.`);
      }
    }
  }

  // Question Bank Integration & Bounded Mix Rule Enforcement (Max 2 MCQs, Max 2 Diagrams across session)
  const cursor = typeof session.cursor === 'number' ? session.cursor : 0;
  const nextSlotIndex = cursor + 1;
  const assignedModality = (session.slotModalities && session.slotModalities[nextSlotIndex]) || 'open';
  const nextTopic = (session.topicQueue && session.topicQueue[nextSlotIndex]) || null;

  session.pendingQuestionType = 'open';
  session.bankMCQItem = null;
  session.bankDiagramItem = null;

  if (assignedModality === 'mcq' && (session.mcqCount || 0) < 2 && nextTopic) {
    const mcqItem = getMCQForDay(nextTopic.day, session.difficultyTier, session.usedBankQuestionIds || []);
    if (mcqItem) {
      session.pendingQuestionType = 'mcq';
      session.bankMCQItem = mcqItem;
      session.pendingMCQAnswer = mcqItem.correctAnswer;
      session.mcqOptions = mcqItem.options;
      session.usedBankQuestionIds = session.usedBankQuestionIds || [];
      session.usedBankQuestionIds.push(mcqItem.id);
      session.mcqCount = (session.mcqCount || 0) + 1;
      console.log(`[Question Bank] Assigned pre-validated MCQ for Day ${nextTopic.day} (Tier: ${session.difficultyTier}, ID: ${mcqItem.id})`);
    } else {
      console.log(`[Question Bank Exhaustion] No eligible MCQ found for Day ${nextTopic.day}. Falling back to descriptive open question.`);
    }
  } else if (assignedModality === 'diagram_interpret' && (session.diagramCount || 0) < 2 && nextTopic) {
    const diagItem = getDiagramForDay(nextTopic.day, session.difficultyTier, session.usedBankQuestionIds || []);
    if (diagItem) {
      session.pendingQuestionType = 'diagram_interpret';
      session.bankDiagramItem = diagItem;
      session.diagramDefinition = diagItem.diagramDefinition;
      session.diagramQuestionText = diagItem.diagramQuestionText;
      session.usedBankQuestionIds = session.usedBankQuestionIds || [];
      session.usedBankQuestionIds.push(diagItem.id);
      session.diagramCount = (session.diagramCount || 0) + 1;
      console.log(`[Question Bank] Assigned pre-validated Diagram for Day ${nextTopic.day} (Tier: ${session.difficultyTier}, ID: ${diagItem.id})`);
    } else {
      console.log(`[Question Bank Exhaustion] No eligible Diagram found for Day ${nextTopic.day}. Falling back to descriptive open question.`);
    }
  } else {
    console.log(`[Question Engine] Next question type: open (Live LLM-generated descriptive question)`);
  }

  // Record reached tiers cumulatively for performance analytics
  if (!session.tiersReached) {
    session.tiersReached = ['foundational', 'standard'];
  }
  const currentTier = session.difficultyTier || 'standard';
  const tiers = ['foundational', 'standard', 'applied', 'expert'];
  const maxIdx = tiers.indexOf(currentTier);
  for (let i = 0; i <= maxIdx; i++) {
    if (!session.tiersReached.includes(tiers[i])) {
      session.tiersReached.push(tiers[i]);
    }
  }

  console.log(`[Difficulty Engine Log] recentScores: [${session.recentScores.join(', ')}], pendingQuestionType: ${session.pendingQuestionType}, difficultyTier: ${session.difficultyTier}, tiersReached: [${session.tiersReached.join(', ')}]`);
}

/**
 * PHASE 7: Deterministic compact state update.
 * Called once per topic evaluation (on advance), never on follow-ups or interim turns.
 * No LLM call — purely code-driven based on score and narrative feedback.
 *
 * @param {Object} session   - The live session document.
 * @param {Object} topic     - The topic that just completed (from topicQueue).
 * @param {number} score     - The blended finalAccuracyScore for this topic (0-100).
 * @param {string} narrative - The Evaluator's narrativeFeedback string.
 * @param {Object} dims      - Optional dimension scores object { correctness, depth, reasoning, tradeoffs, clarity }.
 */
export function updateCompactState(session, topic, score, narrative = '', dims = {}) {
  if (!session.compactState) {
    // Bootstrap in case the session was created before Phase 7 was deployed
    session.compactState = {
      strongTopics: [],
      weakTopics: [],
      misconceptions: [],
      currentDay: topic ? topic.day : null,
      currentDifficultyTier: session.difficultyTier || 'standard',
      questionsAsked: session.questionsAsked || 0,
      daysCovered: [...(session.distinctDaysCovered || [])]
    };
  }

  const state = session.compactState;

  // Always sync current interview state fields
  if (topic) {
    state.currentDay = topic.day;
  }
  state.currentDifficultyTier = session.difficultyTier || 'standard';
  state.questionsAsked = session.questionsAsked || 0;
  state.daysCovered = [...(session.distinctDaysCovered || [])];

  if (!topic) return;

  // Classify this topic's performance and update lists accordingly
  if (score >= 70) {
    // Strong: add to strongTopics (once per day)
    if (!state.strongTopics.find(t => t.day === topic.day)) {
      const entry = { day: topic.day, title: topic.title, score };
      if (dims.correctness !== undefined) {
        entry.correctness = dims.correctness;
        entry.depth = dims.depth;
        entry.reasoning = dims.reasoning;
      }
      state.strongTopics.push(entry);
    } else {
      // Update score if re-evaluated (e.g. follow-up improved it)
      const existing = state.strongTopics.find(t => t.day === topic.day);
      if (existing && score > existing.score) existing.score = score;
    }
    // Remove from weakTopics if it was previously marked weak (candidate recovered)
    const weakIdx = state.weakTopics.findIndex(t => t.day === topic.day);
    if (weakIdx !== -1) {
      state.weakTopics.splice(weakIdx, 1);
      console.log(`[CompactState] Day ${topic.day} recovered from weakTopics to strongTopics (score: ${score}).`);
    }
  } else if (score < 50) {
    // Weak: add to weakTopics (once per day, not if already in strongTopics)
    const alreadyStrong = state.strongTopics.find(t => t.day === topic.day);
    if (!alreadyStrong && !state.weakTopics.find(t => t.day === topic.day)) {
      state.weakTopics.push({ day: topic.day, title: topic.title, score });
    }
    // Extract misconception: first sentence of narrative feedback as a short gap note
    if (narrative && !state.misconceptions.some(m => m.day === topic.day)) {
      const narrativeStr = typeof narrative === 'string' ? narrative : (narrative.narrative || JSON.stringify(narrative) || '');
      const firstSentence = narrativeStr.split(/[.!?]/)[0].trim();
      if (firstSentence.length > 10) {
        state.misconceptions.push({ day: topic.day, note: firstSentence });
      }
    }
  }
  // 50-69 range (partial): not added to either list — acknowledged implicitly by absence

  console.log(`[CompactState] Updated after Day ${topic.day}: strongTopics=${state.strongTopics.length}, weakTopics=${state.weakTopics.length}, misconceptions=${state.misconceptions.length}, tier=${state.currentDifficultyTier}.`);
}



/**
 * Computes performance analytics metrics for final review.
 */
export function computeMetrics(session) {
  const accuracyLog = session.accuracyLog || [];

  // Calculate totalInterviewDurationSeconds
  const start = session.interviewStartedAt ? new Date(session.interviewStartedAt) : (session.createdAt ? new Date(session.createdAt) : new Date());
  const end = session.interviewEndedAt ? new Date(session.interviewEndedAt) : new Date();
  const totalInterviewDurationSeconds = Math.max(0, Math.round((end - start) / 1000));

  // Calculate perQuestionTimes
  const perQuestionTimes = accuracyLog.map(item => {
    const tier = item.questionType === 'capstone' ? 'capstone' : (item.difficultyTier || 'standard');
    const bounds = RESPONSE_TIME_BOUNDS[tier] || RESPONSE_TIME_BOUNDS.standard;
    return {
      day: item.day,
      questionType: item.questionType,
      difficultyTier: item.difficultyTier,
      responseTimeSeconds: item.responseTimeSeconds !== undefined ? item.responseTimeSeconds : 0,
      expectedRangeSeconds: bounds
    };
  });

  if (accuracyLog.length === 0) {
    return {
      overallAccuracy: 0,
      perDay: [],
      difficultyProgression: session.tiersReached || ['foundational', 'standard'],
      questionTypeBreakdown: { open: 0, mcq: 0, diagram_interpret: 0 },
      totalInterviewDurationSeconds,
      perQuestionTimes: [],
      correctness: 0,
      depth: 0,
      reasoning: 0,
      tradeoffs: 0,
      clarity: 0
    };
  }

  const overallAccuracy = Math.round(
    accuracyLog.reduce((sum, item) => sum + item.finalAccuracyScore, 0) / accuracyLog.length
  );

  const allTiersInLog = accuracyLog.map(item => item.difficultyTier || 'standard');
  const tiersReached = session.tiersReached || ['foundational', 'standard'];
  const difficultyProgression = Array.from(new Set([...tiersReached, ...allTiersInLog]));

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

  // Calculate aggregate dimensions from accuracyLog
  const ratedLogs = accuracyLog.filter(item => item.correctness !== undefined);
  let correctness = 0;
  let depth = 0;
  let reasoningScore = 0;
  let tradeoffs = 0;
  let clarity = 0;

  if (ratedLogs.length > 0) {
    correctness = Math.round(ratedLogs.reduce((sum, item) => sum + item.correctness, 0) / ratedLogs.length);
    depth = Math.round(ratedLogs.reduce((sum, item) => sum + item.depth, 0) / ratedLogs.length);
    reasoningScore = Math.round(ratedLogs.reduce((sum, item) => sum + item.reasoningScore, 0) / ratedLogs.length);
    tradeoffs = Math.round(ratedLogs.reduce((sum, item) => sum + item.tradeoffs, 0) / ratedLogs.length);
    clarity = Math.round(ratedLogs.reduce((sum, item) => sum + item.clarity, 0) / ratedLogs.length);
  } else {
    // If no evaluations ran, fallback based on overallAccuracy
    correctness = overallAccuracy;
    depth = overallAccuracy;
    reasoningScore = overallAccuracy;
    tradeoffs = overallAccuracy;
    clarity = overallAccuracy;
  }

  return {
    overallAccuracy,
    perDay,
    difficultyProgression,
    questionTypeBreakdown,
    totalInterviewDurationSeconds,
    perQuestionTimes,
    correctness,
    depth,
    reasoning: reasoningScore,
    tradeoffs,
    clarity
  };
}


function getProctoringSummary(session) {
  const violations = session.violations || [];
  const breakdown = {
    presence: violations.filter(v => v.type === 'presence').length,
    multi_face: violations.filter(v => v.type === 'multi_face').length,
    gaze: violations.filter(v => v.type === 'gaze').length,
    phone: violations.filter(v => v.type === 'phone').length,
    camera_lost: violations.filter(v => v.type === 'camera_lost').length
  };
  return {
    flaggedForReview: session.flaggedForReview || false,
    totalViolationCount: violations.length,
    breakdown
  };
}


/**
 * Processes a single turn input from the candidate.

 * 
 * @param {string} sessionId 
 * @param {string} message 
 * @returns {Promise<Object>} Route response shape or error shape.
 */
/**
 * BRAIN 4: Combiner Brain / Progression Controller (Deterministic Orchestration)
 * Sole job: Take outputs of Brain 1 (Conduct), Brain 2 (Interviewer), Brain 3 (Evaluator),
 * track violation/proctoring counters, adjust adaptive difficulty, and decide all state transitions.
 * This is the ONLY place in the system where early session termination / suspension is decided.
 */
export async function handleTurn(sessionId, message, violationType = null, flagCurrentQuestion = false, flagReason = null) {
  const session = await getSessionDoc(sessionId);
  if (!session) {
    throw new Error(`Session with id "${sessionId}" not found.`);
  }

  // Idempotency check: If session is already DONE, return cached feedback immediately
  if (session.state === SessionState.DONE) {
    console.log(`[SessionManager] Idempotent hit: session "${sessionId}" is already completed.`);
    return {
      reply: 'Interview completed.',
      done: true,
      feedback: session.feedback,
      metrics: computeMetrics(session),
      judgeVerdict: session.judgeVerdict || null,
      proctoringSummary: getProctoringSummary(session)
    };
  }

  // Consolidate wrap-up check at the top of every turn (Part E SSOT stopping gate)
  if (checkStoppingCondition(session, false)) {
    session.state = SessionState.DONE;
    session.interviewEndedAt = new Date().toISOString();
    const report = await generateFeedbackReport(session);
    session.feedback = report.feedback;
    session.judgeVerdict = report.judgeVerdict;
    await saveSessionDoc(sessionId, session);
    
    return {
      reply: 'Interview completed.',
      done: true,
      feedback: session.feedback,
      metrics: computeMetrics(session),
      judgeVerdict: session.judgeVerdict || null,
      proctoringSummary: getProctoringSummary(session)
    };
  }

  // PART F: Flag Current Question Escape Hatch
  if (flagCurrentQuestion) {
    const currentTopic = session.topicQueue[session.cursor];
    console.log(`[SessionManager] Flagging current question for session "${sessionId}", Day ${currentTopic ? currentTopic.day : 'unknown'}`);
    
    // 1. Mark flagged in accuracyLog
    if (!session.accuracyLog) session.accuracyLog = [];
    const flaggedLogEntry = {
      day: currentTopic ? currentTopic.day : null,
      title: currentTopic ? currentTopic.title : 'Curriculum Topic',
      questionType: session.pendingQuestionType || 'open',
      difficultyTier: session.difficultyTier,
      classification: 'flagged',
      flagged: true,
      flagReason: flagReason || 'No reason provided',
      finalAccuracyScore: 50, // neutral score
      llmConfidence: 50,
      semanticScore: 0,
      conceptScore: 0,
      reasoning: `Candidate flagged the question: "${flagReason || 'No reason provided'}"`,
      candidateAnswer: '[FLAGGED]',
      questionSentAt: session.questionSentAt || new Date().toISOString(),
      answerReceivedAt: new Date().toISOString(),
      responseTimeSeconds: 0,
      hallucinationFlag: false,
      hallucinationCorrection: '',
      hedgeMarkers: [],
      whyProbe: false,
      communicationConfidence: 'medium',
      correctness: 50,
      depth: 50,
      reasoningScore: 50,
      tradeoffs: 50,
      clarity: 50
    };
    session.accuracyLog.push(flaggedLogEntry);

    // 2. Persist to flaggedQuestions collection in Firestore / memory
    const lastQuestionText = session.transcript.filter(e => e.role === 'interviewer').slice(-1)[0]?.text || '';
    const flaggedDbObj = {
      sessionId,
      day: currentTopic ? currentTopic.day : null,
      questionText: lastQuestionText,
      reason: flagReason || 'No reason provided',
      timestamp: new Date().toISOString()
    };
    try {
      await db.collection('flaggedQuestions').add(flaggedDbObj);
      console.log(`[FlaggedQuestions] Persisted to Firestore: Session ${sessionId}`);
    } catch (e) {
      console.warn('[FlaggedQuestions] Firestore write failed. Falling back to memory:', e.message);
      if (!global.flaggedQuestionsFallback) global.flaggedQuestionsFallback = [];
      global.flaggedQuestionsFallback.push(flaggedDbObj);
    }

    // 3. Mark current topic status and advance cursor
    if (currentTopic) {
      currentTopic.status = 'asked';
      if (!session.distinctDaysCovered.includes(currentTopic.day)) {
        session.distinctDaysCovered.push(currentTopic.day);
      }
      session.questionsAsked++;
    }

    // Phase 7: Update compactState deterministically
    if (currentTopic) {
      updateCompactState(session, currentTopic, 50, `Flagged: ${flagReason}`, {
        correctness: 50,
        depth: 50,
        reasoning: 50,
        tradeoffs: 50,
        clarity: 50
      });
    }

    session.followupCountForCurrentTopic = 0;
    session.whyChainDepth = 0;
    session.hallucinationCountForCurrentTopic = 0;

    // Check stopping condition (SSOT)
    const wrapUpTriggered = checkStoppingCondition(session, false);
    if (wrapUpTriggered) {
      session.state = SessionState.DONE;
      session.interviewEndedAt = new Date().toISOString();
      const report = await generateFeedbackReport(session);
      session.feedback = report.feedback;
      session.judgeVerdict = report.judgeVerdict;
      await saveSessionDoc(sessionId, session);

      return {
        reply: 'Interview completed.',
        done: true,
        feedback: session.feedback,
        metrics: computeMetrics(session),
        judgeVerdict: session.judgeVerdict || null,
        proctoringSummary: getProctoringSummary(session)
      };
    }

    // Advance cursor
    session.cursor++;
    const nextTopic = session.topicQueue[session.cursor];

    // Determine next question type and difficulty
    session.nextQuestionType = 'open'; // default after flag
    const difficultyTier = session.difficultyTier;

    // Call Interviewer Brain / mock to generate the next question
    let llmResponse = null;
    const detectedConnections = [];
    const nextTopicFuture = session.topicQueue[session.cursor + 1];

    if (!process.env.GEMINI_API_KEY || process.env.SIMULATE_LLM_OUTAGE === 'true') {
      llmResponse = mockLLMCall(
        session.candidateSnapshot,
        nextTopic,
        '',
        '',
        0,
        detectedConnections,
        session.nextQuestionType,
        nextTopicFuture,
        difficultyTier,
        session
      );
    } else {
      llmResponse = await generateInterviewerResponseWithLLM(
        session,
        '',
        'genuine_attempt',
        detectedConnections,
        [],
        session.nextQuestionType,
        nextTopicFuture,
        difficultyTier
      );
    }

    const replyText = llmResponse ? llmResponse.reply : `Got it. Let's move on. Can you tell me about your experience on Day ${nextTopic.day}: "${nextTopic.title}"?`;
    
    session.transcript.push({
      role: 'interviewer',
      day: nextTopic.day,
      text: replyText,
      turn: session.turnCount + 1
    });

    session.pendingQuestionType = session.nextQuestionType;
    session.turnCount++;

    const responsePayload = {
      reply: replyText,
      done: false,
      questionsAsked: session.questionsAsked,
      distinctDaysCovered: session.distinctDaysCovered.length,
      detectedConnections: [],
      action: 'advance',
      nextQuestionType: session.nextQuestionType,
      difficultyTier: session.difficultyTier,
      conductViolations: session.conductViolations,
      mcqOptions: llmResponse ? (llmResponse.mcqOptions || null) : null,
      diagramDefinition: llmResponse ? (llmResponse.diagramDefinition || null) : null,
      diagramQuestionText: llmResponse ? (llmResponse.diagramQuestionText || null) : null,
      hallucinationFlag: false,
      hallucinationCorrection: '',
      questionHistory: (session.accuracyLog || []).map(log => ({
        day: log.day,
        title: log.title || 'Curriculum Topic',
        difficultyTier: log.difficultyTier,
        questionType: log.questionType,
        classification: log.classification || 'unknown',
        communicationConfidence: log.communicationConfidence || 'medium',
        hallucinationFlag: !!log.hallucinationFlag,
        whyProbe: !!log.whyProbe
      }))
    };

    session.lastMessageHash = '';
    session.lastMessageTime = new Date().toISOString();
    session.lastResponse = responsePayload;
    session.lastMCQOptions = responsePayload.mcqOptions || null;
    session.questionSentAt = new Date().toISOString();
    await saveSessionDoc(sessionId, session);

    return responsePayload;
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

  const answeredQuestionType = session.nextQuestionType || 'open';
  const isMCQTurn = answeredQuestionType === 'mcq';
  const isDiagramTurn = answeredQuestionType === 'diagram_interpret';

  // 3. Evaluate Turn with LLM (or bypass on blank forced advancement)
  const target = session.targetQuestionCount || 8;
  const floorMetInput = (session.questionsAsked >= target && session.distinctDaysCovered.length >= 4);
  const nextQuestionTypeGenerated = session.pendingQuestionType || 'open';

  // Progression Controller: Signal when the upcoming question is the final one for this session
  const isFinalQuestion = 
    session.pendingQuestionType === 'capstone' ||
    (session.questionsAsked >= target - 1 && session.distinctDaysCovered.length >= 3) ||
    session.turnCount >= 20;
  session.isFinalQuestion = isFinalQuestion;

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

    llmResponse = await evaluateTurnWithLLM(session, dummyMessage, [], []);
    delete session.mcqResult;
  } else if (forceAdvanceDueToBlankRetries) {
    llmResponse = {
      classification: 'shallow',
      reasoning: 'Forced advance after 2 empty retries.',
      action: 'advance',
      reply: `Let's move on.`,
      updatedMemory: session.interviewMemory || 'Candidate skipped topic due to consecutive blank answers.',
      llmConfidence: 10,
      communicationConfidence: 'high'
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
    llmResponse = await evaluateTurnWithLLM(session, message, detectedConnections, hedgeMarkers);

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

  // Phase 6 Conduct Violation Accumulation
  if (!session.conductViolations) session.conductViolations = 0;
  
  if (llmResponse) {
    if (llmResponse.classification === 'disrespectful') {
      session.conductViolations += 2;
    } else if (llmResponse.classification === 'disengaged' || llmResponse.classification === 'off_topic') {
      const isRapidViolation = responseTimeSeconds !== undefined && responseTimeSeconds < 3;
      if (isRapidViolation) {
        console.log(`[Conduct Proctor] Rapid violation detected (Response Time: ${responseTimeSeconds}s < 3s). Escalating violation weight to 2.`);
        session.conductViolations += 2;
      } else {
        session.conductViolations += 1;
      }
    }
  }

  // Check Phase 6 Conduct Suspension Threshold (3 total weight)
  if (session.conductViolations >= 3) {
    console.log(`[Conduct Proctor] SESSION SUSPENDED! Total conductViolations: ${session.conductViolations} >= 3.`);
    session.state = SessionState.DONE;
    const summaryMsg = "Candidate was suspended due to repeated conduct violations (disengagement, off-topic, or disrespectful responses during the technical review).";
    
    session.feedback = {
      summary: summaryMsg,
      strengths: [],
      gaps: [],
      next: []
    };
    session.judgeVerdict = {
      decision: "would_reject",
      reasoning: summaryMsg,
      evidenceTrail: []
    };
    session.accuracyLog = []; // zero out scores

    // Register 5-minute cooldown
    const candSnapshot = session.candidateSnapshot;
    const candId = candSnapshot.id || (candSnapshot.member ? candSnapshot.member.id : null);
    if (candId) {
      cooldowns.set(candId, new Date());
      console.log(`[Cooldown Registered] Candidate ID "${candId}" suspended for conduct violations at ${new Date().toISOString()}`);
    }

    await saveSessionDoc(sessionId, session);

    return {
      reply: "Your interview session has been suspended due to repeated conduct violations.",
      done: true,
      suspended: true,
      conductViolations: session.conductViolations,
      feedback: session.feedback,
      judgeVerdict: session.judgeVerdict
    };
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
  updateDifficulty(session, finalAccuracyScore, hallucinationFlag);

  // Set the next question type to the type of the question that was generated on this turn
  session.nextQuestionType = nextQuestionTypeGenerated;

  // MCQ Hard Validation Safeguard (Part C Backend Guarantee)
  if (session.nextQuestionType === 'mcq') {
    const choices = llmResponse && llmResponse.mcqOptions;
    if (!choices || !Array.isArray(choices) || choices.length < 2) {
      console.warn(`[MCQ Validation Override] Question was flagged as MCQ but choices are missing, empty, or sparse (${choices ? choices.length : 0} options). Falling back to open.`);
      session.nextQuestionType = 'open';
      if (session.pendingQuestionType === 'mcq') {
        session.pendingQuestionType = 'open';
      }
      if (llmResponse) {
        llmResponse.mcqOptions = null;
        llmResponse.mcqCorrectIndex = undefined;
      }
      session.pendingMCQAnswer = null;
    }
  }

  // Append to accuracyLog
  if (!session.accuracyLog) session.accuracyLog = [];
  session.accuracyLog.push({
    day: currentTopic ? currentTopic.day : null,
    title: currentTopic ? currentTopic.title : 'Curriculum Topic',
    questionType: answeredQuestionType,
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
    whyProbe,
    communicationConfidence: llmResponse ? (llmResponse.communicationConfidence || "medium") : "medium",
    rootUnderstandingReached: llmResponse ? !!llmResponse.rootUnderstandingReached : false,
    reactionClause: llmResponse ? (llmResponse.reactionClause || "") : "",
    interruptFlag: llmResponse && llmResponse.reactionClause && llmResponse.reactionClause.includes('Sorry to interrupt'),
    correctness: llmResponse ? llmResponse.correctness : undefined,
    depth: llmResponse ? llmResponse.depth : undefined,
    reasoningScore: llmResponse ? llmResponse.reasoningScore : undefined,
    tradeoffs: llmResponse ? llmResponse.tradeoffs : undefined,
    clarity: llmResponse ? llmResponse.clarity : undefined
  });

  // Capstone Trigger Check (Phase I4)
  if (!session.capstoneTriggered) {
    const target = session.targetQuestionCount || 8;
    const floorMetAtEnd = (session.questionsAsked >= target && session.distinctDaysCovered.length >= 4);
    const logLength = session.accuracyLog.length;
    const appliedExpertCount = session.accuracyLog.filter(entry => entry.difficultyTier === 'applied' || entry.difficultyTier === 'expert').length;
    if (floorMetAtEnd && logLength >= 4 && appliedExpertCount >= 2) {
      const last4 = session.accuracyLog.slice(-4);
      const avg = last4.reduce((sum, entry) => sum + entry.finalAccuracyScore, 0) / 4;
      const hasHallucinations = last4.some(entry => entry.hallucinationFlag);
      if (avg >= 80 && !hasHallucinations) {
        console.log(`[SessionManager] CAPSTONE TRIGGERED! Avg Score: ${avg}, Hallucinations: 0.`);
        session.capstoneTriggered = true;
        session.pendingQuestionType = 'capstone';
        session.nextQuestionType = 'capstone';

        // Compute strongest topic
        const scoresByDay = {};
        session.accuracyLog.forEach(log => {
          if (log.day !== null) {
            if (!scoresByDay[log.day]) {
              scoresByDay[log.day] = [];
            }
            scoresByDay[log.day].push(log.finalAccuracyScore);
          }
        });
        let highestDay = null;
        let highestAvg = -1;
        for (const day in scoresByDay) {
          const avgScore = scoresByDay[day].reduce((a, b) => a + b, 0) / scoresByDay[day].length;
          if (avgScore > highestAvg) {
            highestAvg = avgScore;
            highestDay = day;
          }
        }
        const dayNum = highestDay ? parseInt(highestDay) : (currentTopic ? currentTopic.day : 1);
        const strongestTopic = session.topicQueue.find(t => t.day === dayNum) || session.topicQueue[0];
        session.strongestTopic = { day: strongestTopic.day, title: strongestTopic.title };
      }
    }
  }

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

  // Find last interviewer question
  let lastQuestion = '';
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    if (session.transcript[i].role === 'interviewer') {
      lastQuestion = session.transcript[i].text;
      break;
    }
  }

  // Rule enforcement
  let action = llmResponse.action;
  let forceAdvanceDueToFollowupLimit = false;
  let forceAdvanceDueToHallucinationLimit = false;
  let forceAdvanceDueToWhyProbeLimit = false;

  const isPreviousCapstone = lastQuestion && (lastQuestion.includes('Capstone Challenge') || lastQuestion.includes('🏆 Capstone'));
  if (isPreviousCapstone && action === 'followup') {
    console.log(`[SessionManager Override] Converting action "followup" to "why_probe" for Capstone review.`);
    action = 'why_probe';
  }

  const wasWhyProbing = (session.whyChainDepth || 0) > 0;

  if (isMCQTurn || nextQuestionTypeGenerated === 'mcq') {
    console.log(`[SessionManager Override] Overwriting action to "advance" because MCQ turns always transition to the target topic.`);
    action = 'advance';
  } else if (nextQuestionTypeGenerated === 'capstone') {
    console.log(`[SessionManager Override] Overwriting action to "advance" because Capstone is triggered.`);
    action = 'advance';
  } else if (action === 'followup' && session.followupCountForCurrentTopic >= 1) {
    console.log(`[SessionManager Override] Overwriting action "followup" to "advance" because followupCount is already ${session.followupCountForCurrentTopic}.`);
    action = 'advance';
    forceAdvanceDueToFollowupLimit = true;
  } else if (action === 'followup' && session.hallucinationCountForCurrentTopic >= 2) {
    console.log(`[SessionManager Override] Overwriting action "followup" to "advance" because hallucinationCountForCurrentTopic is ${session.hallucinationCountForCurrentTopic}.`);
    action = 'advance';
    forceAdvanceDueToHallucinationLimit = true;
  } else if (action === 'why_probe') {
    if ((session.whyChainDepth || 0) > 3 || session.followupCountForCurrentTopic >= 1) {
      console.log(`[SessionManager Override] Overwriting action "why_probe" to "advance" because whyChainDepth is ${session.whyChainDepth} or standard follow-up was already asked.`);
      action = 'advance';
      forceAdvanceDueToWhyProbeLimit = true;
    }
  }

  // Stop the chain mid-drill if candidate drops classification or rootReached is true
  if (wasWhyProbing && action !== 'advance') {
    if (llmResponse.rootUnderstandingReached || (session.whyChainDepth || 0) > 3 || llmResponse.classification === 'shallow' || llmResponse.classification === 'off_topic') {
      console.log(`[SessionManager Override] Overwriting action to "advance" due to why-probe chain termination triggers (Root: ${llmResponse.rootUnderstandingReached}, Depth: ${session.whyChainDepth}, Class: ${llmResponse.classification}).`);
      action = 'advance';
      forceAdvanceDueToWhyProbeLimit = true;
    }
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
      conductViolations: session.conductViolations,
      mcqOptions: llmResponse.mcqOptions || null,
      diagramDefinition: llmResponse.diagramDefinition || null,
      diagramQuestionText: llmResponse.diagramQuestionText || null,
      hallucinationFlag: hallucinationFlag,
      hallucinationCorrection: hallucinationFlag ? (llmResponse.hallucinationCorrection || "") : "",
      questionHistory: (session.accuracyLog || []).map(log => ({
        day: log.day,
        title: log.title || 'Curriculum Topic',
        difficultyTier: log.difficultyTier,
        questionType: log.questionType,
        classification: log.classification || 'unknown',
        communicationConfidence: log.communicationConfidence || 'medium',
        hallucinationFlag: !!log.hallucinationFlag,
        whyProbe: !!log.whyProbe
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

  // Handle why_probe action
  if (action === 'why_probe') {
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
      conductViolations: session.conductViolations,
      mcqOptions: null,
      diagramDefinition: null,
      diagramQuestionText: null,
      hallucinationFlag: hallucinationFlag,
      hallucinationCorrection: hallucinationFlag ? (llmResponse.hallucinationCorrection || "") : "",
      questionHistory: (session.accuracyLog || []).map(log => ({
        day: log.day,
        title: log.title || 'Curriculum Topic',
        difficultyTier: log.difficultyTier,
        questionType: log.questionType,
        classification: log.classification || 'unknown',
        communicationConfidence: log.communicationConfidence || 'medium',
        hallucinationFlag: !!log.hallucinationFlag,
        whyProbe: !!log.whyProbe
      }))
    };

    session.lastMessageHash = cleanMsg;
    session.lastMessageTime = new Date().toISOString();
    session.lastResponse = responsePayload;
    session.lastMCQOptions = null;
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

    // Phase 7: Update compact state deterministically with this topic's evaluation result
    if (currentTopic) {
      updateCompactState(
        session,
        currentTopic,
        finalAccuracyScore,
        llmResponse ? llmResponse.reasoning : '',
        {
          correctness: llmResponse ? llmResponse.correctness : undefined,
          depth: llmResponse ? llmResponse.depth : undefined,
          reasoning: llmResponse ? llmResponse.reasoningScore : undefined,
          tradeoffs: llmResponse ? llmResponse.tradeoffs : undefined,
          clarity: llmResponse ? llmResponse.clarity : undefined
        }
      );
    }

    session.followupCountForCurrentTopic = 0;
    session.whyChainDepth = 0;
    session.hallucinationCountForCurrentTopic = 0;

    const wrapUpTriggered = checkStoppingCondition(session, llmResponse ? llmResponse.modelWantsToStop : false);

    if (wrapUpTriggered) {
      session.state = SessionState.DONE;
      session.interviewEndedAt = new Date().toISOString();
      const report = await generateFeedbackReport(session);
      session.feedback = report.feedback;
      session.judgeVerdict = report.judgeVerdict;
      await saveSessionDoc(sessionId, session);

      const responsePayload = {
        reply: 'Interview completed.',
        done: true,
        feedback: session.feedback,
        metrics: computeMetrics(session),
        judgeVerdict: session.judgeVerdict || null,
        proctoringSummary: getProctoringSummary(session)
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
    
    const isForcedAdvance = (forceAdvanceDueToFollowupLimit || forceAdvanceDueToBlankRetries || forceAdvanceDueToHallucinationLimit || forceAdvanceDueToWhyProbeLimit);
    if (isForcedAdvance) {
      session.nextQuestionType = 'open';
    }
    
    let replyText = fullReply;
    if (session.bankMCQItem) {
      replyText = `Let's evaluate a specific concept from Day ${nextTopic.day} ("${nextTopic.title}"):\n\n${session.bankMCQItem.question}`;
      session.nextQuestionType = 'mcq';
      if (llmResponse) {
        llmResponse.mcqOptions = session.bankMCQItem.options;
      }
      session.bankMCQItem = null;
    } else if (session.bankDiagramItem) {
      replyText = `Take a look at this system architecture for Day ${nextTopic.day} ("${nextTopic.title}"):`;
      session.nextQuestionType = 'diagram_interpret';
      if (llmResponse) {
        llmResponse.diagramDefinition = session.bankDiagramItem.diagramDefinition;
        llmResponse.diagramQuestionText = session.bankDiagramItem.diagramQuestionText;
      }
      session.bankDiagramItem = null;
    } else if (isForcedAdvance) {
      replyText = `Got it. Let's move on to the next topic. Can you tell me about your experience on Day ${nextTopic.day}: "${nextTopic.title}"?`;
    }

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
      conductViolations: session.conductViolations,
      mcqOptions: session.mcqOptions || (llmResponse ? llmResponse.mcqOptions : null) || null,
      diagramDefinition: session.diagramDefinition || (llmResponse ? llmResponse.diagramDefinition : null) || null,
      diagramQuestionText: session.diagramQuestionText || (llmResponse ? llmResponse.diagramQuestionText : null) || null,
      hallucinationFlag: hallucinationFlag,
      hallucinationCorrection: hallucinationFlag ? (llmResponse.hallucinationCorrection || "") : "",
      questionHistory: (session.accuracyLog || []).map(log => ({
        day: log.day,
        title: log.title || 'Curriculum Topic',
        difficultyTier: log.difficultyTier,
        questionType: log.questionType,
        classification: log.classification || 'unknown',
        communicationConfidence: log.communicationConfidence || 'medium',
        hallucinationFlag: !!log.hallucinationFlag,
        whyProbe: !!log.whyProbe
      }))
    };

    session.lastMessageHash = cleanMsg;
    session.lastMessageTime = new Date().toISOString();
    session.lastResponse = responsePayload;
    session.lastMCQOptions = responsePayload.mcqOptions ? [...responsePayload.mcqOptions] : null;
    session.lastQuestionText = responsePayload.reply;
    session.questionSentAt = new Date().toISOString();
    await saveSessionDoc(sessionId, session);

    return responsePayload;
  }

  return {
    error: 'Invalid state machine action encountered.'
  };
}

/**
 * Voluntarily ends the session early.
 */
export async function endSessionEarly(sessionId) {
  const session = await getSessionDoc(sessionId);
  if (!session) {
    return { error: 'Session not found', status: 404 };
  }

  session.state = SessionState.DONE;
  session.interviewEndedAt = new Date().toISOString();

  let report = null;
  try {
    report = await generateFeedbackReport(session);
  } catch (e) {
    console.error('Failed to generate LLM feedback report for early exit, using mechanical fallback:', e);
    report = generateMechanicalFeedback(session);
  }

  const feedbackObj = (report && report.feedback) ? report.feedback : { summary: "", strengths: [], gaps: [], next: [] };
  // Explicitly note that the candidate voluntarily ended early
  feedbackObj.summary = "The candidate voluntarily ended the interview session early. " + (feedbackObj.summary || "");
  
  // Custom borderline/early verdict
  session.judgeVerdict = (report && report.judgeVerdict) ? report.judgeVerdict : {
    decision: 'borderline',
    reasoning: 'Candidate voluntarily ended the session early. Assessment completed with partial performance data.',
    evidenceTrail: []
  };

  session.feedback = feedbackObj;
  await saveSessionDoc(sessionId, session);

  return {
    reply: 'Interview completed.',
    done: true,
    feedback: session.feedback,
    metrics: computeMetrics(session),
    judgeVerdict: session.judgeVerdict,
    proctoringSummary: getProctoringSummary(session)
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
  
  if (!session.fullscreenExits) session.fullscreenExits = 0;
  if (!session.tabSwitches) session.tabSwitches = 0;
  if (!session.clipboardViolations) session.clipboardViolations = 0;
  if (!session.violations) session.violations = [];

  if (session.state === SessionState.DONE) {
    const isSuspended = session.feedback && session.feedback.summary.includes('suspended');
    return {
      done: true,
      suspended: isSuspended,
      fullscreenExits: session.fullscreenExits,
      tabSwitches: session.tabSwitches,
      clipboardViolations: session.clipboardViolations,
      violationCount: session.violations.length,
      feedback: session.feedback,
      metrics: {
        overallAccuracy: 0,
        perDay: [],
        difficultyProgression: [],
        questionTypeBreakdown: { open: 0, mcq: 0, diagram_interpret: 0 }
      },
      judgeVerdict: session.judgeVerdict || null,
      proctoringSummary: getProctoringSummary(session)
    };
  }

  // Increment dedicated counts
  if (violationType === 'fullscreen-exit') {
    session.fullscreenExits += 1;
  } else if (violationType === 'tab-switch') {
    session.tabSwitches += 1;
  } else if (violationType === 'copy-paste' || violationType === 'screenshot') {
    session.clipboardViolations += 1;
  }
  
  const isCameraViolation = ['presence_violation', 'multi_face_violation', 'gaze_violation', 'phone_violation', 'camera_lost'].includes(violationType);
  
  let cameraType = violationType;
  let severity = 'medium';
  if (isCameraViolation) {
    if (violationType === 'presence_violation') cameraType = 'presence';
    if (violationType === 'multi_face_violation') { cameraType = 'multi_face'; severity = 'high'; }
    if (violationType === 'gaze_violation') cameraType = 'gaze';
    if (violationType === 'phone_violation') { cameraType = 'phone'; severity = 'high'; }
    if (violationType === 'camera_lost') cameraType = 'camera_lost';
  }
  
  const violationCount = session.violations.length + 1;
  session.violations.push({
    timestamp: new Date().toISOString(),
    type: cameraType,
    count: violationCount,
    severity: severity,
    fullscreenExits: session.fullscreenExits,
    tabSwitches: session.tabSwitches,
    clipboardViolations: session.clipboardViolations
  });

  console.log(`[Proctoring Server] Logged violation ${violationCount} (fullscreenExits: ${session.fullscreenExits}, tabSwitches: ${session.tabSwitches}, clipboardViolations: ${session.clipboardViolations}, severity: ${severity}) for session "${sessionId}": ${violationType}`);

  // Set flaggedForReview if total violations reach 4
  if (violationCount >= 4 && !session.flaggedForReview) {
    session.flaggedForReview = true;
    console.log(`[Proctoring Server] SESSION FLAGGED FOR REVIEW (Total violations: ${violationCount})`);
  }

  // Phase 2 Rule: 3rd fullscreen exit causes immediate suspension
  const isFullscreenSuspension = (session.fullscreenExits >= 3);
  // Phase 3 Rule: 1st tab switch causes immediate suspension (zero tolerance)
  const isTabSwitchSuspension = (violationType === 'tab-switch' && session.tabSwitches >= 1);
  // Phase 4 Rule: 2nd copy/paste or screenshot attempt causes immediate suspension
  const isClipboardSuspension = ((violationType === 'copy-paste' || violationType === 'screenshot') && session.clipboardViolations >= 2);
  
  // General suspension for non-camera interface violations reaching 4
  const nonCameraViolationCount = (session.fullscreenExits || 0) + (session.tabSwitches || 0) + (session.clipboardViolations || 0);
  const isGeneralSuspension = nonCameraViolationCount >= 4;

  const isCameraSuspension = isCameraViolation && violationCount >= 4;
  const shouldSuspend = isCameraSuspension || (!isCameraViolation && (isFullscreenSuspension || isTabSwitchSuspension || isClipboardSuspension || isGeneralSuspension));

  if (!shouldSuspend && (violationType === 'fullscreen-exit' || violationType === 'tab-switch')) {
    const lockoutMs = 10000; // 10 second warning lockout countdown
    session.warningLockoutUntil = new Date(Date.now() + lockoutMs).toISOString();
  } else {
    session.warningLockoutUntil = null;
  }

  if (shouldSuspend) {
    // Suspend candidate!
    session.state = SessionState.DONE;
    let summaryMsg = "Candidate was suspended for repeated proctoring violations.";
    if (isClipboardSuspension) {
      summaryMsg = "Candidate was suspended due to repeated copy/paste or screenshot attempts during an active proctored session.";
    } else if (isTabSwitchSuspension) {
      summaryMsg = "Candidate was suspended immediately due to switching tabs/windows during an active proctored session.";
    } else if (isFullscreenSuspension) {
      summaryMsg = "Candidate was suspended due to repeated fullscreen violations (exited fullscreen 3 times).";
    } else if (isCameraSuspension) {
      summaryMsg = "Candidate was suspended due to repeated proctoring anomalies (camera, face, or gaze deviations) detected during the session.";
    }

    session.feedback = {
      summary: summaryMsg,
      strengths: [],
      gaps: [],
      next: []
    };
    session.judgeVerdict = {
      decision: "would_reject",
      reasoning: summaryMsg,
      evidenceTrail: []
    };
    session.accuracyLog = []; // zero out scores
    
    // Register 5-minute cooldown
    const candSnapshot = session.candidateSnapshot;
    const candId = candSnapshot.id || (candSnapshot.member ? candSnapshot.member.id : null);
    if (candId) {
      cooldowns.set(candId, new Date());
      console.log(`[Cooldown Registered] Candidate ID "${candId}" suspended at ${new Date().toISOString()}`);
    }
    
    await saveSessionDoc(sessionId, session);

    // Update session.proctoring schema
    session.proctoring = {
      violations: session.violations.map(v => ({
        type: v.type,
        timestamp: v.timestamp,
        severity: v.severity || 'medium'
      })),
      flaggedForReview: session.flaggedForReview || false,
      totalViolationCount: session.violations.length,
      warningLockoutUntil: session.warningLockoutUntil || null
    };

    await saveSessionDoc(sessionId, session);

    return {
      done: true,
      suspended: true,
      fullscreenExits: session.fullscreenExits,
      tabSwitches: session.tabSwitches,
      clipboardViolations: session.clipboardViolations,
      warningsRemaining: 0,
      violationCount,
      flaggedForReview: !!session.flaggedForReview,
      warningLockoutUntil: session.warningLockoutUntil || null,
      feedback: session.feedback,
      metrics: {
        overallAccuracy: 0,
        perDay: [],
        difficultyProgression: [],
        questionTypeBreakdown: { open: 0, mcq: 0, diagram_interpret: 0 }
      },
      judgeVerdict: session.judgeVerdict,
      proctoringSummary: getProctoringSummary(session)
    };
  }

  // Update session.proctoring schema
  session.proctoring = {
    violations: session.violations.map(v => ({
      type: v.type,
      timestamp: v.timestamp,
      severity: v.severity || 'medium'
    })),
    flaggedForReview: session.flaggedForReview || false,
    totalViolationCount: session.violations.length,
    warningLockoutUntil: session.warningLockoutUntil || null
  };

  await saveSessionDoc(sessionId, session);
  const warningsRemaining = (violationType === 'copy-paste' || violationType === 'screenshot')
    ? Math.max(0, 2 - session.clipboardViolations)
    : Math.max(0, 3 - session.fullscreenExits);

  return {
    done: false,
    suspended: false,
    fullscreenExits: session.fullscreenExits,
    tabSwitches: session.tabSwitches,
    clipboardViolations: session.clipboardViolations,
    warningsRemaining,
    violationCount,
    flaggedForReview: session.flaggedForReview || false,
    warningLockoutUntil: session.warningLockoutUntil || null,
    proctoringSummary: getProctoringSummary(session)
  };
}

