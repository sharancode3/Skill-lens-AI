// State variables
let candidatesList = [];
let selectedCandidate = null;
let currentSessionId = null;
let isInterviewActive = false;
let violationCount = 0;
let activeTimerInterval = null;


// DOM Elements
const screenStart = document.getElementById('screen-start');
const screenRules = document.getElementById('screen-rules');
const screenChat = document.getElementById('screen-chat');
const screenFeedback = document.getElementById('screen-feedback');

const candidateSelect = document.getElementById('candidate-select');
const candidateCard = document.getElementById('candidate-card');
const candName = document.getElementById('cand-name');
const candRole = document.getElementById('cand-role');
const candExp = document.getElementById('cand-exp');
const statCompleted = document.getElementById('stat-completed');
const statRate = document.getElementById('stat-rate');
const btnStart = document.getElementById('btn-start');

const rulesCandName = document.getElementById('rules-cand-name');
const btnBackToSelect = document.getElementById('btn-back-to-select');
const btnAcceptRules = document.getElementById('btn-accept-rules');

const chatCandName = document.getElementById('chat-cand-name');
const chatCandRole = document.getElementById('chat-cand-role');
const chatProgressQuestions = document.getElementById('chat-progress-questions');
const chatProgressTopics = document.getElementById('chat-progress-topics');
const chatProgressDifficulty = document.getElementById('chat-progress-difficulty');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');

const feedbackSummary = document.getElementById('feedback-summary');
const feedbackStrengths = document.getElementById('feedback-strengths');
const feedbackGaps = document.getElementById('feedback-gaps');
const feedbackNext = document.getElementById('feedback-next');
const btnRestart = document.getElementById('btn-restart');

// ==================== INITIALIZATION ====================
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/candidates');
    if (!res.ok) throw new Error('Failed to retrieve candidates list.');
    candidatesList = await res.json();
    
    // Populate select element
    candidateSelect.innerHTML = '<option value="" disabled selected>Choose a candidate...</option>';
    candidatesList.forEach(cand => {
      const opt = document.createElement('option');
      opt.value = cand.member.id;
      opt.textContent = `${cand.member.name} (${cand.member.jobRole})`;
      candidateSelect.appendChild(opt);
    });

    lucide.createIcons();
  } catch (error) {
    console.error('Initialization error:', error);
    candidateSelect.innerHTML = '<option value="" disabled>Error loading candidates.</option>';
  }
});

// ==================== SCREEN 1: CANDIDATE SELECTOR ====================
candidateSelect.addEventListener('change', () => {
  const candId = candidateSelect.value;
  selectedCandidate = candidatesList.find(c => c.member.id === candId);
  if (!selectedCandidate) return;

  // Calculate metrics
  const completedMissions = selectedCandidate.missions.filter(m => !m.skipped && m.attempts > 0);
  const totalCompleted = completedMissions.length;
  const firstTryMissions = completedMissions.filter(m => m.attempts === 1).length;
  const rate = totalCompleted > 0 ? Math.round((firstTryMissions / totalCompleted) * 100) : 0;

  // Update DOM values
  candName.textContent = selectedCandidate.member.name;
  candRole.textContent = selectedCandidate.member.jobRole;
  candExp.textContent = `${selectedCandidate.member.yearsExperience} Year${selectedCandidate.member.yearsExperience === 1 ? '' : 's'} Experience`;
  statCompleted.textContent = totalCompleted;
  statRate.textContent = `${rate}%`;

  candidateCard.classList.remove('hidden');
  lucide.createIcons();
});

let isReenteringFullscreen = false;

async function enterFullscreen() {
  const docEl = document.documentElement;
  isReenteringFullscreen = true;
  setTimeout(() => { isReenteringFullscreen = false; }, 1200);

  try {
    if (docEl.requestFullscreen) {
      await docEl.requestFullscreen();
    } else if (docEl.webkitRequestFullscreen) {
      await docEl.webkitRequestFullscreen();
    } else if (docEl.msRequestFullscreen) {
      await docEl.msRequestFullscreen();
    } else {
      throw new Error('Fullscreen API not supported');
    }
    return true;
  } catch (err) {
    console.warn('Fullscreen request blocked or unsupported:', err);
    return false;
  }
}

function isCurrentlyFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}

async function startInterviewSession() {
  // Generate session ID
  currentSessionId = `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  // Set UI state
  chatCandName.textContent = selectedCandidate.member.name;
  chatCandRole.textContent = selectedCandidate.member.jobRole;
  const initialsEl = document.getElementById('chat-avatar-initials');
  if (initialsEl && selectedCandidate.member.name) {
    const parts = selectedCandidate.member.name.trim().split(/\s+/);
    initialsEl.textContent = parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
  }
  chatProgressQuestions.textContent = '0';
  chatProgressTopics.textContent = '0/4';
  if (chatProgressDifficulty) chatProgressDifficulty.textContent = 'Standard';
  chatMessages.innerHTML = '';

  // Show loading state
  btnStart.disabled = true;
  btnStart.textContent = 'Initializing session...';

  try {
    const res = await fetch('/api/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        candidate: selectedCandidate
      })
    });

    if (!res.ok) {
      if (res.status === 403) {
        const errData = await res.json();
        if (errData.error === 'COOLDOWN_ACTIVE') {
          alert(errData.message);
          if (isCurrentlyFullscreen()) {
            document.exitFullscreen().catch(() => {});
          }
          return;
        }
      }
      throw new Error('API initialization failed.');
    }
    const data = await res.json();

    // Switch screen
    screenStart.classList.add('hidden');
    screenChat.classList.remove('hidden');

    // Set interview active to trigger monitoring
    isInterviewActive = true;
    violationCount = 0;

    // Append first interviewer question
    appendInterviewerMessage(data.reply, data.detectedConnections, data.nextQuestionType, data.mcqOptions, data.diagramDefinition, data.diagramQuestionText);
    updateProgress(data.questionsAsked, data.distinctDaysCovered, data.difficultyTier);

    let activeTopic = null;
    const match = (data.reply || '').match(/Day\s+(\d+)[:\s]+"([^"]+)"/i);
    if (match) {
      activeTopic = { day: parseInt(match[1]), title: match[2] };
    }
    updateSidebar(data.questionHistory, activeTopic);
  } catch (error) {
    console.error('Failed to start interview:', error);
    alert('Failed to start the interview session. Check backend logs.');
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = 'Start Technical Interview';
  }
}

btnStart.addEventListener('click', () => {
  if (!selectedCandidate) {
    alert('Please select a candidate first.');
    return;
  }

  // Populate candidate name on rules screen and transition
  if (rulesCandName) {
    rulesCandName.textContent = selectedCandidate.member.name;
  }
  screenStart.classList.add('hidden');
  screenRules.classList.remove('hidden');
  window.scrollTo(0, 0);
  if (window.lucide) lucide.createIcons();
});

if (btnBackToSelect) {
  btnBackToSelect.addEventListener('click', () => {
    screenRules.classList.add('hidden');
    screenStart.classList.remove('hidden');
  });
}

if (btnAcceptRules) {
  btnAcceptRules.addEventListener('click', async () => {
    // Request fullscreen
    const hasFullscreen = await enterFullscreen();
    if (!hasFullscreen) {
      // Show Fullscreen Required overlay modal
      document.getElementById('fullscreen-overlay').classList.remove('hidden');
    } else {
      screenRules.classList.add('hidden');
      await startInterviewSession();
    }
  });
}

// Fullscreen grant retry button click listener
document.getElementById('btn-fullscreen-grant').addEventListener('click', async () => {
  const hasFullscreen = await enterFullscreen();
  if (hasFullscreen) {
    document.getElementById('fullscreen-overlay').classList.add('hidden');
    screenRules.classList.add('hidden');
    await startInterviewSession();
  }
});

// Fullscreen warning resume button click listener
document.getElementById('btn-fullscreen-resume').addEventListener('click', async () => {
  const hasFullscreen = await enterFullscreen();
  if (hasFullscreen) {
    document.getElementById('fullscreen-warning-overlay').classList.add('hidden');
  }
});

let cooldownInterval = null;
let blurTimeout = null;

async function reportViolationToServer(type) {
  try {
    const res = await fetch('/api/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        violationType: type
      })
    });
    if (!res.ok) throw new Error('Failed to report violation.');
    const data = await res.json();
    
    if (data.suspended) {
      isInterviewActive = false;
      showSuspensionScreen();
    } else {
      if (type === 'copy-paste' || type === 'screenshot') {
        const pasteError = document.getElementById('paste-error');
        if (pasteError) {
          pasteError.innerHTML = `<i data-lucide="shield-alert" class="w-3.5 h-3.5"></i> Warning 1 of 1: Copying, pasting, or screenshot attempts are prohibited. A 2nd attempt will suspend your interview.`;
          pasteError.classList.remove('hidden');
          if (window.lucide) lucide.createIcons();
          setTimeout(() => { pasteError.classList.add('hidden'); }, 6000);
        }
      } else {
        // Show fullscreen exit warning overlay
        const warningOverlay = document.getElementById('fullscreen-warning-overlay');
        const countText = document.getElementById('fullscreen-violation-count');
        const msgText = document.getElementById('fullscreen-violation-msg');
        if (warningOverlay) warningOverlay.classList.remove('hidden');
        
        const exits = data.fullscreenExits || data.violationCount || 1;
        const remaining = data.warningsRemaining !== undefined ? data.warningsRemaining : Math.max(0, 4 - exits);

        if (countText) {
          countText.textContent = `Warning ${exits} of 3 — ${remaining} warning${remaining === 1 ? '' : 's'} remaining before automatic suspension.`;
        }
        if (msgText) {
          msgText.textContent = type === 'fullscreen-exit' 
            ? 'Exiting fullscreen mode is not permitted during proctored technical evaluations.'
            : 'Switching away from this browser window or tab is not allowed during the interview.';
        }

        // Auto-recovery attempt: Try to re-enter fullscreen programmatically after 1.5s
        if (type === 'fullscreen-exit') {
          setTimeout(async () => {
            if (isInterviewActive && !isCurrentlyFullscreen()) {
              const reEntered = await enterFullscreen();
              if (reEntered || isCurrentlyFullscreen()) {
                if (warningOverlay) warningOverlay.classList.add('hidden');
              }
            }
          }, 1500);
        }
      }
    }
  } catch (error) {
    console.error('Error logging violation on server:', error);
  }
}

function showSuspensionScreen() {
  if (isCurrentlyFullscreen()) {
    document.exitFullscreen().catch(() => {});
  }
  
  // Hide overlays
  document.getElementById('fullscreen-overlay').classList.add('hidden');
  document.getElementById('fullscreen-warning-overlay').classList.add('hidden');
  
  // Hide other screens
  screenStart.classList.add('hidden');
  screenChat.classList.add('hidden');
  screenFeedback.classList.add('hidden');
  
  // Show suspension screen
  const screenSuspended = document.getElementById('screen-suspended');
  screenSuspended.classList.remove('hidden');
  
  // Start countdown timer
  const cooldownTimer = document.getElementById('cooldown-timer');
  let secondsRemaining = 5 * 60;
  
  if (cooldownInterval) clearInterval(cooldownInterval);
  
  cooldownTimer.textContent = '05:00';
  cooldownInterval = setInterval(() => {
    secondsRemaining--;
    if (secondsRemaining <= 0) {
      clearInterval(cooldownInterval);
      cooldownTimer.textContent = 'Expired - You may retry now';
    } else {
      const mins = Math.floor(secondsRemaining / 60);
      const secs = secondsRemaining % 60;
      cooldownTimer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }, 1000);
}

// Exit button click handler for suspension screen
document.getElementById('btn-suspended-exit').addEventListener('click', () => {
  if (cooldownInterval) clearInterval(cooldownInterval);
  document.getElementById('screen-suspended').classList.add('hidden');
  screenStart.classList.remove('hidden');
  candidateSelect.value = '';
  candidateCard.classList.add('hidden');
  selectedCandidate = null;
  currentSessionId = null;
  isInterviewActive = false;
  violationCount = 0;
});

// Continuously monitor fullscreen changes
function handleFullscreenChange() {
  if (!isInterviewActive) return;
  if (isReenteringFullscreen) return;

  const warningOverlay = document.getElementById('fullscreen-warning-overlay');
  if (warningOverlay && !warningOverlay.classList.contains('hidden')) {
    return;
  }

  if (!isCurrentlyFullscreen()) {
    reportViolationToServer('fullscreen-exit');
  }
}


// Monitor visibility and window focus changes (Phase 3 Zero Tolerance Tab-Switch)
function handleVisibilityOrFocusChange() {
  if (!isInterviewActive) return;
  if (isReenteringFullscreen) return;

  const warningOverlay = document.getElementById('fullscreen-warning-overlay');
  const isWarningOverlayActive = warningOverlay && !warningOverlay.classList.contains('hidden');
  if (isWarningOverlayActive) return;

  // Zero-tolerance tab-switch: only fire if document is genuinely hidden (tab switched or minimized)
  if (document.hidden) {
    if (blurTimeout) clearTimeout(blurTimeout);
    blurTimeout = setTimeout(() => {
      if (document.hidden && isInterviewActive && !isReenteringFullscreen) {
        reportViolationToServer('tab-switch');
      }
    }, 250);
  }
}

window.addEventListener('blur', handleVisibilityOrFocusChange);
window.addEventListener('focus', () => {
  if (blurTimeout) clearTimeout(blurTimeout);
});
document.addEventListener('visibilitychange', handleVisibilityOrFocusChange);

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
document.addEventListener('MSFullscreenChange', handleFullscreenChange);

// ==================== PHASE 4: CLIPBOARD & SCREENSHOT DETECTION ====================
function handleClipboardOrShortcutViolation(e, type = 'copy-paste') {
  if (!isInterviewActive) return;
  if (e && e.preventDefault) {
    e.preventDefault();
  }
  reportViolationToServer(type);
}

['copy', 'cut', 'paste'].forEach(eventType => {
  document.addEventListener(eventType, (e) => {
    if (isInterviewActive) {
      handleClipboardOrShortcutViolation(e, 'copy-paste');
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (!isInterviewActive) return;

  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const key = e.key ? e.key.toLowerCase() : '';

  // Intercept Copy/Paste/Cut/SelectAll shortcuts
  if (isCtrlOrCmd && ['c', 'v', 'x', 'a'].includes(key)) {
    handleClipboardOrShortcutViolation(e, 'copy-paste');
    return;
  }

  // Intercept PrintScreen / Screenshot shortcuts
  if (e.key === 'PrintScreen' || key === 'printscreen' || (e.shiftKey && isCtrlOrCmd && ['s', '3', '4'].includes(key))) {
    handleClipboardOrShortcutViolation(e, 'screenshot');
    return;
  }

  // Intercept Developer Inspection Tools (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U)
  if (e.key === 'F12' || (isCtrlOrCmd && e.shiftKey && ['i', 'j', 'c'].includes(key)) || (isCtrlOrCmd && key === 'u')) {
    handleClipboardOrShortcutViolation(e, 'copy-paste');
    return;
  }
});

// ==================== SCREEN 2: CHAT ACTIONS ====================
async function handleSendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // Disable controls to prevent duplicate clicks (Belt)
  chatInput.disabled = true;
  btnSend.disabled = true;

  // Append user bubble
  appendCandidateMessage(text);
  chatInput.value = '';

  // Show thinking state indicator
  const thinkingEl = appendThinkingIndicator();
  scrollChatBottom(true);

  try {
    const res = await fetch('/api/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        message: text
      })
    });

    // Remove thinking indicator
    thinkingEl.remove();

    if (!res.ok) throw new Error('API turn call failed.');
    const data = await res.json();

    if (data.done) {
      // Transition to feedback screen
      transitionToFeedback(data.feedback, data.metrics, data.judgeVerdict);
    } else {
      // Check for topic transition (Emerald tag)
      if (data.action === 'advance') {
        if (data.nextQuestionType === 'capstone') {
          appendTopicTag('🏆 Capstone Challenge');
        } else {
          appendTopicTag('New Topic');
        }
      }
      
      appendInterviewerMessage(data.reply, data.detectedConnections, data.nextQuestionType, data.mcqOptions, data.diagramDefinition, data.diagramQuestionText, data.hallucinationFlag ? data.hallucinationCorrection : null);
      updateProgress(data.questionsAsked, data.distinctDaysCovered, data.difficultyTier);

      let nextActiveTopic = null;
      const match = (data.reply || '').match(/Day\s+(\d+)[:\s]+"([^"]+)"/i);
      if (match) {
        nextActiveTopic = { day: parseInt(match[1]), title: match[2] };
      }
      updateSidebar(data.questionHistory, nextActiveTopic);
    }
  } catch (error) {
    if (thinkingEl) thinkingEl.remove();
    console.error('Error sending message:', error);
    appendInterviewerMessage('Connection error. Failed to retrieve server response.');
  } finally {
    // Re-enable controls if not MCQ
    if (chatInput.placeholder !== 'Please select one of the choices below...') {
      chatInput.disabled = false;
      btnSend.disabled = false;
      chatInput.focus();
    }
  }
}

btnSend.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSendMessage();
});

// ==================== DOM GENERATORS & HELPERS ====================
async function appendInterviewerMessage(text, connections = [], nextQuestionType = 'open', mcqOptions = null, diagramDefinition = null, diagramQuestionText = null, hallucinationCorrection = null) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-bubble interviewer';
  
  let cleanText = text;
  if (hallucinationCorrection) {
    const banner = document.createElement('div');
    banner.className = 'bg-amber-50 border-2 border-amber-500 rounded-md p-3 flex items-start gap-2 text-amber-900 text-xs font-semibold leading-relaxed mb-2.5';
    banner.innerHTML = `
      <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-600 mt-0.5 shrink-0"></i>
      <div>
        <span class="font-extrabold uppercase text-[10px] tracking-wider text-amber-700 block mb-0.5">Concept Hallucination Alert</span>
        ${hallucinationCorrection}
      </div>
    `;
    wrapper.appendChild(banner);

    const term = `⚠️ ${hallucinationCorrection}`.trim();
    if (cleanText.startsWith(term)) {
      cleanText = cleanText.replace(term, '').trim();
    } else if (cleanText.includes(hallucinationCorrection)) {
      cleanText = cleanText.replace(`⚠️`, '').replace(hallucinationCorrection, '').trim();
    }
  }

  const stemEl = document.createElement('div');
  stemEl.textContent = cleanText;
  wrapper.appendChild(stemEl);

  // Appending the running timer display next to the current question (Phase I6)
  const timerContainer = document.createElement('div');
  timerContainer.className = 'flex items-center gap-1.5 text-[10px] text-slate-400 mt-2 self-start font-mono font-semibold bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md';
  timerContainer.innerHTML = `<i data-lucide="clock" class="w-3 h-3 text-slate-400"></i><span class="chat-timer-val">0:00</span>`;
  wrapper.appendChild(timerContainer);

  let elapsedSeconds = 0;
  const timerValSpan = timerContainer.querySelector('.chat-timer-val');
  if (activeTimerInterval) clearInterval(activeTimerInterval);
  activeTimerInterval = setInterval(() => {
    elapsedSeconds++;
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    timerValSpan.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }, 1000);

  // Render diagram if present
  if (diagramDefinition) {
    const diagWrapper = document.createElement('div');
    diagWrapper.className = 'diagram-container';
    wrapper.appendChild(diagWrapper);

    const uniqueId = 'mermaid-' + Math.floor(Math.random() * 100000);
    try {
      const { svg } = await mermaid.render(uniqueId, diagramDefinition);
      diagWrapper.innerHTML = svg;
    } catch (err) {
      console.error('Mermaid render error:', err);
      const badEl = document.getElementById(uniqueId);
      if (badEl) badEl.remove();
      diagWrapper.innerHTML = `<pre style="font-size: 0.8rem; text-align: left; width:100%; color: #EF4444; margin: 0;">${diagramDefinition}</pre>`;
    }

    if (diagramQuestionText) {
      const qText = document.createElement('div');
      qText.style.marginTop = '0.75rem';
      qText.style.fontWeight = '600';
      qText.textContent = diagramQuestionText;
      wrapper.appendChild(qText);
    }
  }

  // Set input states based on question type
  if (nextQuestionType === 'mcq' && mcqOptions && mcqOptions.length > 0) {
    chatInput.disabled = true;
    btnSend.disabled = true;
    chatInput.placeholder = 'Please select one of the choices below...';
  } else {
    chatInput.disabled = false;
    btnSend.disabled = false;
    chatInput.placeholder = 'Type your technical response here...';
    chatInput.focus();
  }

  // Render MCQ choices if present
  if (nextQuestionType === 'mcq' && mcqOptions && mcqOptions.length > 0) {
    const mcqContainer = document.createElement('div');
    mcqContainer.className = 'mcq-container';

    mcqOptions.forEach((optText, idx) => {
      const optBtn = document.createElement('button');
      optBtn.className = 'mcq-option-btn';
      optBtn.textContent = `${idx + 1}. ${optText}`;
      optBtn.addEventListener('click', async () => {
        optBtn.classList.add('selected-choice');
        mcqContainer.querySelectorAll('button').forEach(b => {
          b.disabled = true;
          if (!b.classList.contains('selected-choice')) {
            b.classList.add('faded-choice');
          }
        });
        
        // Disable all inputs during the API fetch to prevent double clicks/typing
        chatInput.disabled = true;
        btnSend.disabled = true;
        chatInput.placeholder = 'Processing your choice...';

        appendCandidateMessage(`Choice ${idx + 1}: ${optText}`);

        const thinkingEl = appendThinkingIndicator();
        scrollChatBottom(true);

        try {
          const res = await fetch('/api/interview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: currentSessionId,
              message: idx.toString()
            })
          });

          thinkingEl.remove();

          if (!res.ok) throw new Error('API turn call failed.');
          const data = await res.json();

          if (data.done) {
            transitionToFeedback(data.feedback, data.metrics);
          } else {
            if (data.action === 'advance') {
              if (data.nextQuestionType === 'capstone') {
                appendTopicTag('🏆 Capstone Challenge');
              } else {
                appendTopicTag('New Topic');
              }
            }
            appendInterviewerMessage(data.reply, data.detectedConnections, data.nextQuestionType, data.mcqOptions, data.diagramDefinition, data.diagramQuestionText);
            updateProgress(data.questionsAsked, data.distinctDaysCovered, data.difficultyTier);
          }
        } catch (error) {
          if (thinkingEl) thinkingEl.remove();
          console.error('Error submitting MCQ answer:', error);
          appendInterviewerMessage('Connection error. Failed to retrieve server response.');
        }
      });
      mcqContainer.appendChild(optBtn);
    });

    wrapper.appendChild(mcqContainer);
  }

  // Render connection tags if present
  if (connections && connections.length > 0) {
    connections.forEach(conn => {
      const connTag = document.createElement('div');
      connTag.className = 'chat-connection-tag';
      connTag.innerHTML = `<i data-lucide="git-branch" class="w-3 h-3"></i><span>Touchpoint: Day ${conn.day} (${conn.title.split(' ')[0]})</span>`;
      wrapper.appendChild(connTag);
    });
  }

  chatMessages.appendChild(wrapper);
  lucide.createIcons();
  scrollChatBottom();
}

function appendCandidateMessage(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-bubble candidate';
  wrapper.textContent = text;
  chatMessages.appendChild(wrapper);
  scrollChatBottom(true);
}

function appendTopicTag(text) {
  const tag = document.createElement('div');
  tag.className = 'topic-tag';
  tag.textContent = text;
  chatMessages.appendChild(tag);
}

function appendThinkingIndicator() {
  const container = document.createElement('div');
  container.className = 'thinking-bubble';
  container.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  chatMessages.appendChild(container);
  return container;
}

function updateProgress(questions, topics) {
  chatProgressQuestions.textContent = `${questions || 0}`;
  chatProgressTopics.textContent = `${topics || 0}/4`;
}

function scrollChatBottom(force = false) {
  if (!chatMessages) return;
  setTimeout(() => {
    chatMessages.scrollTo({
      top: chatMessages.scrollHeight,
      behavior: force ? 'auto' : 'smooth'
    });
  }, 100);
}

function transitionToFeedback(feedback, metrics, judgeVerdict) {
  // Clear running activeTimerInterval if active
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }

  // Populate Judge Verdict (Phase I7)
  const verdictSection = document.getElementById('feedback-verdict-section');
  const verdictDecision = document.getElementById('verdict-decision');
  const verdictReasoning = document.getElementById('verdict-reasoning');
  const verdictEvidenceTrail = document.getElementById('verdict-evidence-trail');

  if (verdictSection && judgeVerdict) {
    verdictSection.classList.remove('hidden');

    // Setup color classes for decision
    let decisionClass = 'bg-slate-50 text-slate-800 border-slate-500';
    let decisionText = 'Borderline';
    if (judgeVerdict.decision === 'would_hire') {
      decisionClass = 'bg-emerald-50 text-emerald-800 border-emerald-500';
      decisionText = 'Would Hire';
    } else if (judgeVerdict.decision === 'would_reject') {
      decisionClass = 'bg-rose-50 text-rose-800 border-rose-500';
      decisionText = 'Would Reject';
    }

    verdictDecision.className = `text-xs font-black uppercase px-4 py-1.5 rounded-md border-4 border-gray-900 ${decisionClass}`;
    verdictDecision.textContent = decisionText;

    verdictReasoning.textContent = judgeVerdict.reasoning || 'No details provided.';

    // Evidence trail
    verdictEvidenceTrail.innerHTML = '';
    const trail = judgeVerdict.evidenceTrail || [];
    if (trail.length > 0) {
      trail.forEach((e, idx) => {
        let outcomeMarkerClass = 'bg-emerald-400';
        let badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        let outcomeText = 'Strong';
        if (e.outcome === 'weak') {
          outcomeMarkerClass = 'bg-red-400';
          badgeClass = 'bg-red-100 text-red-800 border-red-300';
          outcomeText = 'Weak';
        } else if (e.outcome === 'recovered') {
          outcomeMarkerClass = 'bg-blue-400';
          badgeClass = 'bg-blue-100 text-blue-800 border-blue-300';
          outcomeText = 'Recovered';
        }

        const row = document.createElement('div');
        row.className = 'flex gap-4 items-start relative pl-6 pb-6 last:pb-0';
        
        if (idx < trail.length - 1) {
          row.className += " before:content-[''] before:absolute before:left-2 before:top-4 before:bottom-0 before:w-1 before:bg-slate-200";
        }

        row.innerHTML = `
          <!-- marker -->
          <div class="absolute left-0.5 top-1.5 w-4 h-4 rounded-full border-2 border-gray-900 ${outcomeMarkerClass}"></div>
          
          <!-- block content -->
          <div class="flex-grow bg-slate-50 border-4 border-gray-900 rounded-md p-4 flex flex-col gap-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            <div class="flex justify-between items-center border-b-2 border-slate-200 pb-1.5 mb-1">
              <span class="text-xs font-black text-gray-900">${e.questionRef}</span>
              <span class="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded border border-gray-900 ${badgeClass}">${outcomeText}</span>
            </div>
            <p class="text-xs text-gray-700 font-semibold leading-relaxed">${e.note}</p>
          </div>
        `;
        verdictEvidenceTrail.appendChild(row);
      });
    } else {
      verdictEvidenceTrail.innerHTML = '<div class="text-slate-400 text-sm text-center py-4">No evidence moments logged.</div>';
    }
  } else if (verdictSection) {
    verdictSection.classList.add('hidden');
  }

  // Populate summaries
  feedbackSummary.textContent = feedback.summary || 'Summary loaded successfully.';

  // Populate Strengths
  feedbackStrengths.innerHTML = '';
  if (feedback.strengths && feedback.strengths.length > 0) {
    feedback.strengths.forEach(str => {
      const card = document.createElement('div');
      card.className = 'feedback-card strength flex gap-4 items-start';
      card.innerHTML = `
        <div class="icon-circle text-emerald-600 border border-emerald-200">
          <i data-lucide="check-circle" class="w-6 h-6"></i>
        </div>
        <div>
          <p class="text-sm font-semibold text-gray-900">${str}</p>
        </div>
      `;
      feedbackStrengths.appendChild(card);
    });
  } else {
    feedbackStrengths.innerHTML = '<div class="text-gray-500 text-sm">No specific strengths recorded.</div>';
  }

  // Populate Gaps
  feedbackGaps.innerHTML = '';
  if (feedback.gaps && feedback.gaps.length > 0) {
    feedback.gaps.forEach(gap => {
      const card = document.createElement('div');
      card.className = 'feedback-card gap flex gap-4 items-start';
      card.innerHTML = `
        <div class="icon-circle text-amber-600 border border-amber-200">
          <i data-lucide="alert-triangle" class="w-6 h-6"></i>
        </div>
        <div>
          <p class="text-sm font-semibold text-gray-900">${gap}</p>
        </div>
      `;
      feedbackGaps.appendChild(card);
    });
  } else {
    feedbackGaps.innerHTML = '<div class="text-gray-500 text-sm">No specific gaps reported.</div>';
  }

  // Populate Next Steps (numbered Outfit list)
  feedbackNext.innerHTML = '';
  if (feedback.next && feedback.next.length > 0) {
    feedback.next.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'flex gap-4 items-center bg-gray-800 p-4 rounded-md';
      row.innerHTML = `
        <div class="num-circle bg-blue-600 text-white">${index + 1}</div>
        <p class="text-sm font-semibold text-gray-100 flex-grow">${item}</p>
      `;
      feedbackNext.appendChild(row);
    });
  } else {
    feedbackNext.innerHTML = '<div class="text-gray-500 text-sm">No next steps compiled.</div>';
  }

  // Render metrics dynamically & defensively
  const metricsSection = document.getElementById('feedback-metrics-section');
  if (metricsSection) {
    if (metrics && metrics.overallAccuracy !== undefined) {
      metricsSection.classList.remove('hidden');
      document.getElementById('metrics-overall').textContent = `${metrics.overallAccuracy}%`;
      
      // Render difficulty progression
      const progressionContainer = document.getElementById('metrics-progression');
      if (progressionContainer) {
        progressionContainer.innerHTML = '';
        const tiers = ['foundational', 'standard', 'applied', 'expert'];
        tiers.forEach(tier => {
          const step = document.createElement('div');
          const reached = metrics.difficultyProgression && metrics.difficultyProgression.includes(tier);
          step.className = `progression-step ${reached ? 'reached' : 'muted'}`;
          step.innerHTML = `
            <span>${tier}</span>
            <i data-lucide="${reached ? 'check-circle' : 'circle'}" class="w-4 h-4"></i>
          `;
          progressionContainer.appendChild(step);
        });
      }

      // Render question breakdown
      const breakdownContainer = document.getElementById('metrics-breakdown');
      if (breakdownContainer) {
        const b = metrics.questionTypeBreakdown || { open: 0, mcq: 0, diagram_interpret: 0 };
        breakdownContainer.innerHTML = `
          <div class="breakdown-row"><span>Open Question:</span><span>${b.open || 0}</span></div>
          <div class="breakdown-row"><span>MCQ Question:</span><span>${b.mcq || 0}</span></div>
          <div class="breakdown-row"><span>Diagram Critique:</span><span>${b.diagram_interpret || 0}</span></div>
        `;
      }

      // Render per day scores
      const perdayContainer = document.getElementById('metrics-perday-list');
      if (perdayContainer) {
        perdayContainer.innerHTML = '';
        if (metrics.perDay && metrics.perDay.length > 0) {
          metrics.perDay.forEach(dayInfo => {
            const row = document.createElement('div');
            row.className = 'metric-row';
            row.innerHTML = `
              <span>Day ${dayInfo.day}: ${dayInfo.title}</span>
              <span class="text-blue-600 font-bold">${dayInfo.score}/100</span>
            `;
            perdayContainer.appendChild(row);
          });
        }
      }

      // Render Timing Analysis (Phase I6)
      const totalDurationEl = document.getElementById('metrics-total-duration');
      const timingListEl = document.getElementById('metrics-timing-list');
      if (totalDurationEl && timingListEl) {
        // Render Total Duration
        const totalSecs = metrics.totalInterviewDurationSeconds || 0;
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        totalDurationEl.textContent = `Total Duration: ${mins}m ${secs}s`;

        // Render timing list
        timingListEl.innerHTML = '';
        const qTimes = metrics.perQuestionTimes || [];
        if (qTimes.length > 0) {
          qTimes.forEach((q, idx) => {
            const min = q.expectedRangeSeconds[0];
            const max = q.expectedRangeSeconds[1];
            const resp = q.responseTimeSeconds;

            let statusClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
            let statusText = 'On Pace';
            if (resp < min) {
              statusClass = 'bg-red-50 text-red-700 border border-red-200';
              statusText = 'Too Fast';
            } else if (resp > max) {
              statusClass = 'bg-amber-50 text-amber-700 border border-amber-200';
              statusText = 'Too Slow';
            }

            const typeMap = {
              open: 'Open Question',
              mcq: 'MCQ',
              diagram_interpret: 'Diagram Critique',
              capstone: 'Capstone Challenge'
            };
            const displayType = typeMap[q.questionType] || q.questionType || 'Open Question';

            const row = document.createElement('div');
            row.className = 'flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 py-3 gap-2 last:border-b-0';
            row.innerHTML = `
              <div class="flex flex-col">
                <span class="text-sm font-bold text-slate-800">Q${idx + 1}: ${displayType} (Day ${q.day})</span>
                <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Difficulty: ${q.difficultyTier || 'standard'}</span>
              </div>
              <div class="flex items-center gap-3">
                <span class="text-xs text-slate-600 font-medium">${resp}s <span class="text-slate-400">/ expected ${min}-${max}s</span></span>
                <span class="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${statusClass}">${statusText}</span>
              </div>
            `;
            timingListEl.appendChild(row);
          });
        } else {
          timingListEl.innerHTML = '<div class="text-slate-400 text-sm text-center py-4">No timing metrics recorded.</div>';
        }
      }
    } else {
      metricsSection.classList.add('hidden');
    }
  }

  // Show feedback screen
  screenChat.classList.add('hidden');
  screenFeedback.classList.remove('hidden');
  lucide.createIcons();
}

// Restart button actions
btnRestart.addEventListener('click', () => {
  screenFeedback.classList.add('hidden');
  screenStart.classList.remove('hidden');
  candidateSelect.value = '';
  candidateCard.classList.add('hidden');
  selectedCandidate = null;
  currentSessionId = null;
  isInterviewActive = false;
  violationCount = 0;

  // Clear sidebar state
  updateSidebar([]);
  const chatSidebar = document.getElementById('chat-sidebar');
  if (chatSidebar) chatSidebar.classList.remove('active');
});

// Anti-cheating: Disable paste, copy, cut on answer input field
function showPasteWarning() {
  const errorEl = document.getElementById('paste-error');
  if (errorEl) {
    errorEl.classList.remove('hidden');
    setTimeout(() => {
      errorEl.classList.add('hidden');
    }, 3000);
  }
}

chatInput.addEventListener('paste', (e) => {
  e.preventDefault();
  showPasteWarning();
});

chatInput.addEventListener('copy', (e) => {
  e.preventDefault();
});

chatInput.addEventListener('cut', (e) => {
  e.preventDefault();
});

// Disable right-click context menu during active interview
window.addEventListener('contextmenu', (e) => {
  if (isInterviewActive) {
    e.preventDefault();
  }
});

// Block browser shortcuts (Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A, F12, DevTools) during active interview
window.addEventListener('keydown', (e) => {
  if (!isInterviewActive) return;

  const key = e.key.toLowerCase();
  if (
    (e.ctrlKey && ['c', 'v', 'x', 'a', 'u'].includes(key)) ||
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(key))
  ) {
    e.preventDefault();
    if (['c', 'v', 'x'].includes(key)) {
      showPasteWarning();
    }
  }
});

// Update live Question History sidebar
let activeTopicInfo = null;

function updateSidebar(history, currentActiveTopic = null) {
  const listEl = document.getElementById('sidebar-list');
  const countEl = document.getElementById('sidebar-count');
  if (!listEl) return;

  if (currentActiveTopic) {
    activeTopicInfo = currentActiveTopic;
  }

  const evaluatedCount = history ? history.length : 0;
  if (countEl) countEl.textContent = evaluatedCount;
  listEl.innerHTML = '';

  // 1. If an active question is currently awaiting response, render it at the top
  if (activeTopicInfo) {
    const activeRow = document.createElement('div');
    activeRow.className = 'sidebar-row';
    activeRow.style.borderColor = '#3B82F6';
    activeRow.style.backgroundColor = '#EFF6FF';

    const activeHeader = document.createElement('div');
    activeHeader.className = 'sidebar-row-header';

    const activeTitle = document.createElement('span');
    activeTitle.style.fontWeight = '700';
    activeTitle.style.fontSize = '0.85rem';
    activeTitle.style.color = '#1D4ED8';
    
    let displayTitle = 'Active Topic';
    if (activeTopicInfo && typeof activeTopicInfo === 'object') {
      if (activeTopicInfo.title && activeTopicInfo.day) {
        displayTitle = `Day ${activeTopicInfo.day}: ${activeTopicInfo.title}`;
      } else if (activeTopicInfo.title) {
        displayTitle = activeTopicInfo.title;
      } else if (activeTopicInfo.day) {
        displayTitle = `Day ${activeTopicInfo.day}`;
      }
    } else if (typeof activeTopicInfo === 'string') {
      displayTitle = activeTopicInfo;
    }
    activeTitle.textContent = displayTitle;

    const pulseDot = document.createElement('span');
    pulseDot.className = 'sidebar-dot';
    pulseDot.style.backgroundColor = '#3B82F6';
    pulseDot.style.borderColor = '#1D4ED8';
    pulseDot.style.animation = 'pulse 1.5s infinite';
    pulseDot.title = 'Current active question awaiting response';

    activeHeader.appendChild(activeTitle);
    activeHeader.appendChild(pulseDot);

    const activeBadges = document.createElement('div');
    activeBadges.style.display = 'flex';
    activeBadges.style.justifyContent = 'space-between';
    activeBadges.style.alignItems = 'center';

    const activeBadge = document.createElement('span');
    activeBadge.className = 'sidebar-badge';
    activeBadge.style.backgroundColor = '#DBEAFE';
    activeBadge.style.borderColor = '#3B82F6';
    activeBadge.style.color = '#1E40AF';
    activeBadge.textContent = 'IN PROGRESS';

    const hintSpan = document.createElement('span');
    hintSpan.style.fontSize = '0.7rem';
    hintSpan.style.fontWeight = '600';
    hintSpan.style.color = '#6B7280';
    hintSpan.textContent = 'Awaiting answer...';

    activeBadges.appendChild(activeBadge);
    activeBadges.appendChild(hintSpan);

    activeRow.appendChild(activeHeader);
    activeRow.appendChild(activeBadges);
    listEl.appendChild(activeRow);
  }

  // 2. Render all previously evaluated questions below
  if (history && history.length > 0) {
    const reversed = [...history].reverse();
    reversed.forEach(item => {
      const row = document.createElement('div');
      row.className = 'sidebar-row';

      const header = document.createElement('div');
      header.className = 'sidebar-row-header';

      const titleSpan = document.createElement('span');
      titleSpan.style.fontWeight = '700';
      titleSpan.style.fontSize = '0.85rem';
      titleSpan.style.color = '#111827';
      titleSpan.textContent = `Day ${item.day}: ${item.title}`;

      const dot = document.createElement('span');
      dot.className = `sidebar-dot dot-${item.classification}`;
      dot.title = `Answer evaluation: ${item.classification}`;

      header.appendChild(titleSpan);
      header.appendChild(dot);

      const badges = document.createElement('div');
      badges.style.display = 'flex';
      badges.style.justifyContent = 'space-between';
      badges.style.alignItems = 'center';

      const leftBadges = document.createElement('div');
      leftBadges.style.display = 'flex';
      leftBadges.style.gap = '0.4rem';

      const diffBadge = document.createElement('span');
      diffBadge.className = 'sidebar-badge';
      diffBadge.textContent = item.difficultyTier || 'standard';

      const typeBadge = document.createElement('span');
      typeBadge.className = 'sidebar-badge';
      typeBadge.textContent = item.questionType === 'diagram_interpret' ? 'diagram' : (item.questionType || 'open');

      leftBadges.appendChild(diffBadge);
      leftBadges.appendChild(typeBadge);

      // Communication Confidence Badge (Phase I8)
      const confBadge = document.createElement('span');
      confBadge.className = 'sidebar-badge';
      confBadge.textContent = `confidence: ${item.communicationConfidence || 'medium'}`;
      if (item.communicationConfidence === 'low') {
        confBadge.style.backgroundColor = '#FFF7ED';
        confBadge.style.color = '#EA580C';
        confBadge.style.borderColor = '#FED7AA';
      } else if (item.communicationConfidence === 'high') {
        confBadge.style.backgroundColor = '#EEF2FF';
        confBadge.style.color = '#4F46E5';
        confBadge.style.borderColor = '#C7D2FE';
      } else {
        confBadge.style.backgroundColor = '#F8FAFC';
        confBadge.style.color = '#475569';
        confBadge.style.borderColor = '#E2E8F0';
      }
      leftBadges.appendChild(confBadge);

      // Hallucination Tag (Phase I8)
      if (item.hallucinationFlag) {
        const hallBadge = document.createElement('span');
        hallBadge.className = 'sidebar-badge';
        hallBadge.textContent = '⚠️ H';
        hallBadge.title = 'Hallucination Detected';
        hallBadge.style.backgroundColor = '#FEF2F2';
        hallBadge.style.color = '#DC2626';
        hallBadge.style.borderColor = '#FCA5A5';
        leftBadges.appendChild(hallBadge);
      }

      // why-probe Tag (Phase I8)
      if (item.whyProbe) {
        const whyBadge = document.createElement('span');
        whyBadge.className = 'sidebar-badge';
        whyBadge.textContent = 'why?';
        whyBadge.style.backgroundColor = '#F5F3FF';
        whyBadge.style.color = '#7C3AED';
        whyBadge.style.borderColor = '#DDD6FE';
        leftBadges.appendChild(whyBadge);
      }

      const qualLabel = document.createElement('span');
      qualLabel.style.fontSize = '0.7rem';
      qualLabel.style.fontWeight = '700';
      qualLabel.style.textTransform = 'uppercase';
      const colorMap = { strong: '#059669', partial: '#D97706', shallow: '#EA580C', off_topic: '#DC2626' };
      qualLabel.style.color = colorMap[item.classification] || '#6B7280';
      qualLabel.textContent = item.classification.replace('_', ' ');

      badges.appendChild(leftBadges);
      badges.appendChild(qualLabel);

      row.appendChild(header);
      row.appendChild(badges);
      listEl.appendChild(row);
    });
  }

  lucide.createIcons();
}

// Collapsible mobile sidebar toggle
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const chatSidebar = document.getElementById('chat-sidebar');
if (btnToggleSidebar && chatSidebar) {
  btnToggleSidebar.addEventListener('click', () => {
    chatSidebar.classList.toggle('active');
  });
}

// ==================== PHASE 9: SETTINGS PANEL LOGIC ====================
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingsPopover = document.getElementById('settings-popover');
const btnToggleHistoryPanel = document.getElementById('btn-toggle-history-panel');
const fontButtons = document.querySelectorAll('.btn-font-size');

// 1. Toggle Settings Popover
if (btnToggleSettings && settingsPopover) {
  btnToggleSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPopover.classList.toggle('hidden');
  });

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => {
      settingsPopover.classList.add('hidden');
    });
  }

  document.addEventListener('click', (e) => {
    if (!settingsPopover.contains(e.target) && !btnToggleSettings.contains(e.target)) {
      settingsPopover.classList.add('hidden');
    }
  });
}

// 2. Font Size Scaling Logic
function applyFontSize(size) {
  if (!chatMessages) return;
  chatMessages.classList.remove('font-size-sm', 'font-size-md', 'font-size-lg');
  chatMessages.classList.add(`font-size-${size}`);

  fontButtons.forEach(btn => {
    if (btn.dataset.size === size) {
      btn.className = 'btn-font-size px-2 py-1.5 text-xs font-extrabold rounded-md transition-all bg-slate-900 text-white shadow-sm';
    } else {
      btn.className = 'btn-font-size px-2 py-1.5 text-xs font-extrabold rounded-md transition-all text-slate-700 hover:bg-white';
    }
  });

  try {
    localStorage.setItem('interview_font_size', size);
  } catch (e) {}
}

fontButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const size = btn.dataset.size;
    applyFontSize(size);
  });
});

const savedFontSize = localStorage.getItem('interview_font_size') || 'md';
applyFontSize(savedFontSize);

// 3. History Panel Show / Hide Toggle Logic
function updateHistoryPanelToggleUI(isPanelVisible) {
  if (!chatSidebar || !btnToggleHistoryPanel) return;

  if (isPanelVisible) {
    chatSidebar.classList.remove('hidden');
    btnToggleHistoryPanel.textContent = 'Hide Panel';
    btnToggleHistoryPanel.className = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-lg border-2 border-slate-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition shrink-0';
  } else {
    chatSidebar.classList.add('hidden');
    btnToggleHistoryPanel.textContent = 'Show Panel';
    btnToggleHistoryPanel.className = 'px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-extrabold rounded-lg border-2 border-slate-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition shrink-0';
  }

  try {
    localStorage.setItem('interview_show_history_panel', isPanelVisible ? 'true' : 'false');
  } catch (e) {}
}

if (btnToggleHistoryPanel && chatSidebar) {
  btnToggleHistoryPanel.addEventListener('click', () => {
    const isCurrentlyHidden = chatSidebar.classList.contains('hidden');
    updateHistoryPanelToggleUI(isCurrentlyHidden);
  });

  const savedPanelState = localStorage.getItem('interview_show_history_panel');
  if (savedPanelState === 'false') {
    updateHistoryPanelToggleUI(false);
  } else {
    updateHistoryPanelToggleUI(true);
  }
}

