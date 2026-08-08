// State variables
let candidatesList = [];
let selectedCandidate = null;
let currentSessionId = null;
let isInterviewActive = false;
let violationCount = 0;

// DOM Elements
const screenStart = document.getElementById('screen-start');
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

// ==================== INTERVIEW ROUTING & TRANSITIONS ====================
async function enterFullscreen() {
  const docEl = document.documentElement;
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

btnStart.addEventListener('click', async () => {
  if (!selectedCandidate) {
    alert('Please select a candidate first.');
    return;
  }

  // Request fullscreen
  const hasFullscreen = await enterFullscreen();
  if (!hasFullscreen) {
    // Show Fullscreen Required overlay modal
    document.getElementById('fullscreen-overlay').classList.remove('hidden');
  } else {
    await startInterviewSession();
  }
});

// Fullscreen grant retry button click listener
document.getElementById('btn-fullscreen-grant').addEventListener('click', async () => {
  const hasFullscreen = await enterFullscreen();
  if (hasFullscreen) {
    document.getElementById('fullscreen-overlay').classList.add('hidden');
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
    
    violationCount = data.violationCount;
    
    if (data.suspended) {
      isInterviewActive = false;
      showSuspensionScreen();
    } else {
      // Show warning overlay
      const warningOverlay = document.getElementById('fullscreen-warning-overlay');
      const countText = document.getElementById('fullscreen-violation-count');
      const msgText = document.getElementById('fullscreen-violation-msg');
      if (warningOverlay) warningOverlay.classList.remove('hidden');
      if (countText) countText.textContent = `Violation ${violationCount} of 3 — further attempts will end your interview.`;
      if (msgText) {
        msgText.textContent = type === 'fullscreen-exit' 
          ? 'Exiting fullscreen is not allowed during the interview.'
          : 'Switching tabs or windows is not allowed during the interview.';
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

  if (!isCurrentlyFullscreen()) {
    reportViolationToServer('fullscreen-exit');
  }
}

// Monitor visibility and window focus changes
function handleVisibilityOrFocusChange() {
  if (!isInterviewActive) return;

  if (document.hidden || !document.hasFocus()) {
    if (blurTimeout) clearTimeout(blurTimeout);
    blurTimeout = setTimeout(() => {
      if (document.hidden || !document.hasFocus()) {
        reportViolationToServer('tab-switch');
      }
    }, 200);
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
      transitionToFeedback(data.feedback, data.metrics);
    } else {
      // Check for topic transition (Emerald tag)
      if (data.action === 'advance') {
        if (data.nextQuestionType === 'capstone') {
          appendTopicTag('🏆 Capstone Challenge');
        } else {
          appendTopicTag('New Topic');
        }
      }
      
      appendInterviewerMessage(data.reply, data.detectedConnections, data.nextQuestionType, data.mcqOptions, data.diagramDefinition, data.diagramQuestionText);
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
async function appendInterviewerMessage(text, connections = [], nextQuestionType = 'open', mcqOptions = null, diagramDefinition = null, diagramQuestionText = null) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-bubble interviewer';
  
  const stemEl = document.createElement('div');
  stemEl.textContent = text;
  wrapper.appendChild(stemEl);

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

function scrollChatBottom() {
  if (!chatMessages) return;
  requestAnimationFrame(() => {
    chatMessages.scrollTo({
      top: chatMessages.scrollHeight,
      behavior: 'smooth'
    });
  });
}

// ==================== SCREEN 3: FEEDBACK PORTAL ====================
function transitionToFeedback(feedback, metrics) {
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
