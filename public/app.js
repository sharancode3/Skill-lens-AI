// State variables
let candidatesList = [];
let selectedCandidate = null;
let currentSessionId = null;

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
btnStart.addEventListener('click', async () => {
  if (!selectedCandidate) {
    alert('Please select a candidate first.');
    return;
  }

  // Generate session ID
  currentSessionId = `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  // Set UI state
  chatCandName.textContent = selectedCandidate.member.name;
  chatCandRole.textContent = selectedCandidate.member.jobRole;
  chatProgressQuestions.textContent = '0/8';
  chatProgressTopics.textContent = '0/4';
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

    if (!res.ok) throw new Error('API initialization failed.');
    const data = await res.json();

    // Switch screen
    screenStart.classList.add('hidden');
    screenChat.classList.remove('hidden');

    // Append first interviewer question
    appendInterviewerMessage(data.reply);
    updateProgress(data.questionsAsked, data.distinctDaysCovered);
  } catch (error) {
    console.error('Failed to start interview:', error);
    alert('Failed to start the interview session. Check backend logs.');
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = 'Start Technical Interview';
  }
});

// ==================== SCREEN 2: CHAT ACTIONS ====================
async function handleSendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // Append user bubble
  appendCandidateMessage(text);
  chatInput.value = '';

  // Show thinking state indicator
  const thinkingEl = appendThinkingIndicator();
  scrollChatBottom();

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
      transitionToFeedback(data.feedback);
    } else {
      // Check for topic transition (Emerald tag)
      if (data.action === 'advance') {
        appendTopicTag('New Topic');
      }
      
      appendInterviewerMessage(data.reply, data.detectedConnections);
      updateProgress(data.questionsAsked, data.distinctDaysCovered);
    }
  } catch (error) {
    thinkingEl.remove();
    console.error('Error sending message:', error);
    appendInterviewerMessage('Connection error. Failed to retrieve server response.');
  }
}

btnSend.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSendMessage();
});

// ==================== DOM GENERATORS & HELPERS ====================
function appendInterviewerMessage(text, connections = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-bubble interviewer';
  wrapper.textContent = text;

  // Render connections tags if present
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
  scrollChatBottom();
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
  chatProgressQuestions.textContent = `${questions || 0}/8`;
  chatProgressTopics.textContent = `${topics || 0}/4`;
}

function scrollChatBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ==================== SCREEN 3: FEEDBACK PORTAL ====================
function transitionToFeedback(feedback) {
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
});
