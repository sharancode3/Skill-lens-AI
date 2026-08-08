// State variables
let candidatesList = [];
let selectedCandidate = null;
let currentSessionId = null;
let isInterviewActive = false;
let violationCount = 0;
let firedFlaggedNotice = false;
let activeTimerInterval = null;
let sessionTimerInterval = null;
let sessionElapsedSeconds = 0;


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

// ==================== INITIALIZATION & RESTORATION ====================
async function tryRestoreActiveSession() {
  const savedSessionId = localStorage.getItem('currentSessionId');
  if (!savedSessionId) return;

  try {
    const res = await fetch(`/api/session/${savedSessionId}`);
    if (!res.ok) {
      localStorage.removeItem('currentSessionId');
      return;
    }
    const data = await res.json();
    
    if (data.suspended) {
      isInterviewActive = false;
      localStorage.removeItem('currentSessionId');
      showSuspensionScreen();
      return;
    }

    if (data.state === 'active') {
      currentSessionId = savedSessionId;
      selectedCandidate = data.candidate;
      
      // Update UI elements
      screenStart.classList.add('hidden');
      screenChat.classList.remove('hidden');

      chatCandName.textContent = selectedCandidate.member.name;
      chatCandRole.textContent = selectedCandidate.member.jobRole;
      const initialsEl = document.getElementById('chat-avatar-initials');
      if (initialsEl && selectedCandidate.member.name) {
        const parts = selectedCandidate.member.name.trim().split(/\s+/);
        initialsEl.textContent = parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
      }

      // Re-populate transcript
      chatMessages.innerHTML = '';
      const transcript = data.transcript || [];
      
      // Separate history from active question
      for (let i = 0; i < transcript.length; i++) {
        const msg = transcript[i];
        const isLast = (i === transcript.length - 1);
        
        if (msg.role === 'interviewer') {
          if (isLast && data.lastResponse) {
            await appendInterviewerMessage(
              msg.text, 
              msg.connections || [], 
              data.lastResponse.nextQuestionType || 'open',
              data.lastResponse.mcqOptions,
              data.lastResponse.diagramDefinition,
              data.lastResponse.diagramQuestionText,
              data.lastResponse.hallucinationCorrection
            );
          } else {
            await appendInterviewerMessage(msg.text, msg.connections || [], 'open', null, null, null, null);
          }
        } else if (msg.role === 'candidate') {
          appendCandidateMessage(msg.text);
        }
      }

      // Setup counters
      chatProgressQuestions.textContent = data.lastResponse ? (data.lastResponse.metrics?.questionTypeBreakdown?.open || 0) + (data.lastResponse.metrics?.questionTypeBreakdown?.mcq || 0) + (data.lastResponse.metrics?.questionTypeBreakdown?.diagram_interpret || 0) : '0';
      
      const days = data.lastResponse?.metrics?.perDay || [];
      const covered = days.filter(d => d.score !== undefined).length;
      chatProgressTopics.textContent = `${covered}/4`;
      
      if (chatProgressDifficulty && data.lastResponse) {
        const diff = data.lastResponse.difficultyTier || 'Standard';
        chatProgressDifficulty.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
      }

      // Sync warning counts text
      const exits = data.fullscreenExits || 0;
      const remaining = Math.max(0, 3 - exits);
      const countText = document.getElementById('fullscreen-violation-count');
      if (countText) {
        countText.textContent = `Warning ${exits} of 2 — ${remaining} warning${remaining === 1 ? '' : 's'} remaining before automatic suspension.`;
      }

      // Start camera feed
      const videoActive = document.getElementById('video-active');
      if (window.CameraManager && videoActive) {
        window.CameraManager.startActive(videoActive);
      }
      const cameraWidget = document.getElementById('camera-widget');
      if (cameraWidget) cameraWidget.classList.remove('hidden');

      isInterviewActive = true;
      startSessionTimer();

      // Check for warning lockout countdown
      if (data.warningLockoutUntil) {
        const remainingMs = new Date(data.warningLockoutUntil).getTime() - Date.now();
        if (remainingMs > 0) {
          startWarningLockoutCountdown(Math.ceil(remainingMs / 1000));
        } else {
          document.getElementById('fullscreen-overlay').classList.remove('hidden');
        }
      } else {
        document.getElementById('fullscreen-overlay').classList.remove('hidden');
      }
    }
  } catch (err) {
    console.error('[Restore Error] Failed to restore active session:', err);
  }
}

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
    
    // Auto-restore session if active
    await tryRestoreActiveSession();
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
let isFullscreenTransitionActive = false;
let fullscreenTransitionTimeout = null;

function triggerFullscreenTransitionActive() {
  isFullscreenTransitionActive = true;
  if (fullscreenTransitionTimeout) clearTimeout(fullscreenTransitionTimeout);
  fullscreenTransitionTimeout = setTimeout(() => {
    isFullscreenTransitionActive = false;
  }, 1500);
}

async function enterFullscreen() {
  triggerFullscreenTransitionActive();
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

function startSessionTimer() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionElapsedSeconds = 0;
  const timerValSpan = document.getElementById('session-timer-val');
  if (timerValSpan) timerValSpan.textContent = '00:00';
  
  sessionTimerInterval = setInterval(() => {
    sessionElapsedSeconds++;
    const mins = Math.floor(sessionElapsedSeconds / 60);
    const secs = sessionElapsedSeconds % 60;
    if (timerValSpan) {
      timerValSpan.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }, 1000);
}

function stopSessionTimer() {
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }
}

async function startInterviewSession() {
  // Generate session ID
  currentSessionId = `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  localStorage.setItem('currentSessionId', currentSessionId);
  
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

    // Transition camera to ACTIVE
    const cameraWidget = document.getElementById('camera-widget');
    if (cameraWidget) cameraWidget.classList.remove('hidden');

    const videoActive = document.getElementById('video-active');
    if (window.CameraManager && videoActive) {
      window.CameraManager.startActive(videoActive);
    }

    // Set interview active to trigger monitoring
    isInterviewActive = true;
    violationCount = 0;
    startSessionTimer();

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

// Rules Screen validation logic
function checkRulesValidation() {
  const chkConsent = document.getElementById('chk-proctor-consent');
  const acceptButton = document.getElementById('btn-accept-rules');
  if (!acceptButton) return;

  const isConsentChecked = chkConsent && chkConsent.checked;
  const isCameraActive = window.CameraManager && window.CameraManager.getCurrentState() === 'PREVIEW';

  if (isConsentChecked && isCameraActive) {
    acceptButton.disabled = false;
    acceptButton.classList.remove('opacity-50', 'cursor-not-allowed');
  } else {
    acceptButton.disabled = true;
    acceptButton.classList.add('opacity-50', 'cursor-not-allowed');
  }
}

const chkProctorConsent = document.getElementById('chk-proctor-consent');
if (chkProctorConsent) {
  chkProctorConsent.addEventListener('change', checkRulesValidation);
}

btnStart.addEventListener('click', async () => {
  if (!selectedCandidate) {
    alert('Please select a candidate first.');
    return;
  }

  // Populate candidate name on rules screen and transition
  if (rulesCandName) {
    rulesCandName.textContent = selectedCandidate.member.name;
  }
  
  // Reset checkbox
  const chkConsent = document.getElementById('chk-proctor-consent');
  if (chkConsent) chkConsent.checked = false;

  screenStart.classList.add('hidden');
  screenRules.classList.remove('hidden');
  window.scrollTo(0, 0);
  if (window.lucide) lucide.createIcons();

  // Reset camera setup visual controls
  const errorBanner = document.getElementById('camera-error-banner');
  if (errorBanner) errorBanner.classList.add('hidden');
  
  const acceptButton = document.getElementById('btn-accept-rules');
  if (acceptButton) {
    acceptButton.disabled = true;
    acceptButton.classList.add('opacity-50', 'cursor-not-allowed');
  }
  
  const enableButton = document.getElementById('btn-enable-camera');
  if (enableButton) {
    enableButton.disabled = true;
    enableButton.querySelector('span').textContent = 'Requesting camera...';
    enableButton.classList.remove('bg-emerald-600', 'hover:bg-emerald-700', 'opacity-50');
    enableButton.classList.add('bg-blue-600', 'hover:bg-blue-700');
  }

  const statusText = document.getElementById('camera-status-text');
  if (statusText) statusText.textContent = 'Camera Offline';

  const videoPreview = document.getElementById('video-preview');
  if (videoPreview) {
    videoPreview.srcObject = null;
  }

  // Auto-trigger camera preview permission request
  if (videoPreview && window.CameraManager) {
    const success = await window.CameraManager.startPreview(videoPreview);
    if (success) {
      if (enableButton) {
        enableButton.disabled = true;
        enableButton.querySelector('span').textContent = 'Camera Enabled';
        enableButton.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        enableButton.classList.add('bg-emerald-600', 'hover:bg-emerald-700', 'opacity-50');
      }
      if (errorBanner) errorBanner.classList.add('hidden');
    } else {
      if (enableButton) {
        enableButton.disabled = false;
        enableButton.querySelector('span').textContent = 'Enable Camera for Proctoring';
      }
      if (errorBanner) errorBanner.classList.remove('hidden');
    }
    checkRulesValidation();
  }
});

if (btnBackToSelect) {
  btnBackToSelect.addEventListener('click', () => {
    screenRules.classList.add('hidden');
    screenStart.classList.remove('hidden');

    // Turn camera OFF when moving back
    if (window.CameraManager) {
      window.CameraManager.stop();
    }
    const cameraWidget = document.getElementById('camera-widget');
    if (cameraWidget) cameraWidget.classList.add('hidden');
  });
}

const btnEnableCamera = document.getElementById('btn-enable-camera');
if (btnEnableCamera) {
  btnEnableCamera.addEventListener('click', async () => {
    const videoPreview = document.getElementById('video-preview');
    const acceptButton = document.getElementById('btn-accept-rules');
    const errorBanner = document.getElementById('camera-error-banner');

    if (!videoPreview || !window.CameraManager) return;

    btnEnableCamera.disabled = true;
    btnEnableCamera.querySelector('span').textContent = 'Requesting access...';

    const success = await window.CameraManager.startPreview(videoPreview);
    if (success) {
      // Permission granted!
      btnEnableCamera.disabled = true;
      btnEnableCamera.querySelector('span').textContent = 'Camera Enabled';
      btnEnableCamera.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      btnEnableCamera.classList.add('bg-emerald-600', 'hover:bg-emerald-700', 'opacity-50');
      if (errorBanner) errorBanner.classList.add('hidden');
    } else {
      // Permission denied or error
      btnEnableCamera.disabled = false;
      btnEnableCamera.querySelector('span').textContent = 'Retry Enable Camera';
      if (errorBanner) errorBanner.classList.remove('hidden');
    }
    checkRulesValidation();
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
      handleInterviewEndFlow(data);
    } else {
      if (type === 'copy-paste' || type === 'screenshot') {
        const pasteError = document.getElementById('paste-error');
        if (pasteError) {
          pasteError.innerHTML = `<i data-lucide="shield-alert" class="w-3.5 h-3.5 text-red-700"></i> <span>Warning 1 of 1: Copying, pasting, or screenshot attempts are prohibited. A 2nd attempt will suspend your interview.</span>`;
          pasteError.style.display = 'flex';
          if (window.lucide) lucide.createIcons();
          setTimeout(() => { pasteError.style.display = 'none'; }, 6000);
        }
      } else {
        const countText = document.getElementById('fullscreen-violation-count');
        const msgText = document.getElementById('fullscreen-violation-msg');
        
        const exits = data.fullscreenExits || 1;
        const remaining = data.warningsRemaining !== undefined ? data.warningsRemaining : Math.max(0, 3 - exits);

        if (countText) {
          countText.textContent = `Warning ${exits} of 2 — ${remaining} warning${remaining === 1 ? '' : 's'} remaining before automatic suspension.`;
        }
        if (msgText) {
          msgText.textContent = type === 'fullscreen-exit' 
            ? 'Exiting fullscreen mode is not permitted during proctored technical evaluations.'
            : 'Switching away from this browser window or tab is not allowed during the interview.';
        }
      }
    }
    return data;
  } catch (error) {
    console.error('Error logging violation on server:', error);
    return null;
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

  // Turn camera OFF when suspended
  if (window.CameraManager) {
    window.CameraManager.stop();
  }
  const cameraWidget = document.getElementById('camera-widget');
  if (cameraWidget) cameraWidget.classList.add('hidden');
  
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
  localStorage.removeItem('currentSessionId');
  isInterviewActive = false;
  violationCount = 0;
  firedFlaggedNotice = false;

  // Enforce camera OFF
  if (window.CameraManager) {
    window.CameraManager.stop();
  }
  const cameraWidget = document.getElementById('camera-widget');
  if (cameraWidget) cameraWidget.classList.add('hidden');
});

// Unified debounced exit-event proctoring pipeline
let exitDebounceTimeout = null;
let activeLockoutInterval = null;

function startWarningLockoutCountdown(seconds) {
  const warningOverlay = document.getElementById('fullscreen-warning-overlay');
  if (warningOverlay) {
    warningOverlay.classList.remove('hidden');
  }

  const resumeBtn = document.getElementById('btn-fullscreen-resume');
  if (!resumeBtn) return;

  resumeBtn.disabled = true;

  if (activeLockoutInterval) clearInterval(activeLockoutInterval);

  let currentSec = seconds;
  const originalText = 'Re-enter Fullscreen & Resume Interview';
  
  const updateBtnText = () => {
    if (currentSec > 0) {
      resumeBtn.innerHTML = `<i data-lucide="lock" class="w-5 h-5"></i> <span>Wait ${currentSec}s to Resume</span>`;
    } else {
      resumeBtn.innerHTML = `<i data-lucide="maximize-2" class="w-5 h-5"></i> <span>${originalText}</span>`;
      resumeBtn.disabled = false;
    }
    if (window.lucide) lucide.createIcons();
  };

  updateBtnText();

  activeLockoutInterval = setInterval(() => {
    currentSec--;
    updateBtnText();
    if (currentSec <= 0) {
      clearInterval(activeLockoutInterval);
      activeLockoutInterval = null;
    }
  }, 1000);
}

function registerPotentialExit(signalType) {
  if (!isInterviewActive) return;
  if (isReenteringFullscreen || isFullscreenTransitionActive) {
    console.log(`[Proctor] Bypassing raw signal ${signalType} during active transition/re-entry.`);
    return;
  }

  console.log(`[Proctor] Raw signal registered: ${signalType}`);

  if (exitDebounceTimeout) clearTimeout(exitDebounceTimeout);
  exitDebounceTimeout = setTimeout(() => {
    processLogicalExitEvent();
  }, 500);
}

async function processLogicalExitEvent() {
  if (!isInterviewActive) return;
  if (isReenteringFullscreen || isFullscreenTransitionActive) return;

  const isHidden = document.hidden;
  const isFocused = document.hasFocus();
  const isFS = isCurrentlyFullscreen();

  if (!isFS || isHidden || !isFocused) {
    console.warn(`[Proctor] Logical exit event verified: FS=${isFS}, hidden=${isHidden}, focused=${isFocused}`);

    // Show warning overlay and start 10s lockout immediately
    startWarningLockoutCountdown(10);

    // Report violation to server
    const data = await reportViolationToServer('fullscreen-exit');
    if (data) {
      if (data.suspended) {
        return;
      }
      if (data.warningLockoutUntil) {
        const remainingMs = new Date(data.warningLockoutUntil).getTime() - Date.now();
        const remainingSecs = Math.max(1, Math.ceil(remainingMs / 1000));
        startWarningLockoutCountdown(remainingSecs);
      }
    }
  }
}

window.addEventListener('blur', () => registerPotentialExit('window-blur'));
window.addEventListener('focusout', () => registerPotentialExit('window-focusout'));
window.addEventListener('focus', () => {
  if (blurTimeout) clearTimeout(blurTimeout);
});
document.addEventListener('visibilitychange', () => registerPotentialExit('visibilitychange'));

document.addEventListener('fullscreenchange', () => registerPotentialExit('fullscreenchange'));
document.addEventListener('webkitfullscreenchange', () => registerPotentialExit('fullscreenchange'));
document.addEventListener('mozfullscreenchange', () => registerPotentialExit('fullscreenchange'));
document.addEventListener('MSFullscreenChange', () => registerPotentialExit('fullscreenchange'));

// ==================== PHASE 4: CLIPBOARD & SCREENSHOT DETECTION ====================
function handleClipboardOrShortcutViolation(e, type = 'copy-paste') {
  if (!isInterviewActive) return;
  if (e && e.preventDefault) {
    e.preventDefault();
  }
  if (e && e.stopPropagation) {
    e.stopPropagation();
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

// Comprehensive Screenshot & Hotkey Interceptors across Capture Phase
function handleProctoredKeyEvents(e) {
  if (!isInterviewActive) return;

  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const key = e.key ? e.key.toLowerCase() : '';
  const code = e.code || '';
  const keyCode = e.keyCode || e.which || 0;

  // Intercept PrintScreen / Windows Snipping Tool (Win+PrtScn, PrtScn, Win+Shift+S, Alt+PrtScn)
  const isPrintScreenKey = e.key === 'PrintScreen' || code === 'PrintScreen' || keyCode === 44 || key === 'printscreen';
  const isWindowsSnipping = isCtrlOrCmd && e.shiftKey && (key === 's' || code === 'KeyS');
  const isAltOrWinPrtScn = (isCtrlOrCmd || e.altKey) && isPrintScreenKey;

  if (isPrintScreenKey || isWindowsSnipping || isAltOrWinPrtScn) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    console.log('[Proctor] Blocked screenshot shortcut keystroke. Separate proctor violation reporting bypassed.');
    return;
  }

  // Intercept Copy/Paste/Cut/SelectAll shortcuts
  if (isCtrlOrCmd && ['c', 'v', 'x', 'a'].includes(key)) {
    handleClipboardOrShortcutViolation(e, 'copy-paste');
    return;
  }

  // Intercept Developer Inspection Tools (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U)
  if (e.key === 'F12' || (isCtrlOrCmd && e.shiftKey && ['i', 'j', 'c'].includes(key)) || (isCtrlOrCmd && key === 'u')) {
    handleClipboardOrShortcutViolation(e, 'copy-paste');
    return;
  }
}

window.addEventListener('keydown', handleProctoredKeyEvents, true);
window.addEventListener('keyup', (e) => {
  if (!isInterviewActive) return;
  const isPrintScreenKey = e.key === 'PrintScreen' || e.code === 'PrintScreen' || e.keyCode === 44;
  if (isPrintScreenKey) {
    handleClipboardOrShortcutViolation(e, 'screenshot');
  }
}, true);

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
  adjustTextareaHeight();

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
      // Transition to feedback screen (via Post-Interview Feedback Screen)
      handleInterviewEndFlow(data);
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
    updateInputArea();
  }
}

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
  window.lastQuestionData = {
    nextQuestionType: nextQuestionType || 'open',
    mcqOptions: mcqOptions || null
  };
  updateInputArea();

  // Render MCQ choices if present
  let shouldRenderMCQ = nextQuestionType === 'mcq' && mcqOptions && mcqOptions.length >= 2;
  if (shouldRenderMCQ) {
    if (window._lastRenderedMCQText === text && window._lastRenderedMCQOptions && JSON.stringify(window._lastRenderedMCQOptions) === JSON.stringify(mcqOptions)) {
      console.warn('[Frontend Safeguard] Duplicate MCQ question/options detected in UI stream. Suppressing duplicate rendering.');
      shouldRenderMCQ = false;
    } else {
      window._lastRenderedMCQText = text;
      window._lastRenderedMCQOptions = [...mcqOptions];
    }
  }

  if (shouldRenderMCQ) {
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
            handleInterviewEndFlow(data);
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

function transitionToFeedback(feedback, metrics, judgeVerdict, proctoringSummary) {
  // Clear running activeTimerInterval if active
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }
  stopSessionTimer();

  // Render Integrity / Proctoring Section (Phase C6)
  const proctoringSection = document.getElementById('feedback-proctoring-section');
  if (proctoringSection) {
    const summary = proctoringSummary || { flaggedForReview: false, totalViolationCount: 0, breakdown: { presence: 0, multi_face: 0, gaze: 0, phone: 0 } };
    if (summary.totalViolationCount > 0) {
      proctoringSection.classList.remove('hidden');
      
      const badge = document.getElementById('proctoring-flag-badge');
      if (badge) {
        if (summary.flaggedForReview) {
          badge.className = 'text-xs font-black uppercase px-3 py-1 rounded bg-rose-100 text-rose-800 border-2 border-slate-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]';
          badge.textContent = 'Flagged for Review';
        } else {
          badge.className = 'text-xs font-black uppercase px-3 py-1 rounded bg-emerald-100 text-emerald-800 border-2 border-slate-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]';
          badge.textContent = 'Integrity Clear';
        }
      }

      const totalCount = document.getElementById('proctoring-total-count');
      if (totalCount) {
        totalCount.textContent = `${summary.totalViolationCount} total violation${summary.totalViolationCount === 1 ? '' : 's'} recorded`;
      }

      const breakdownList = document.getElementById('proctoring-breakdown-list');
      if (breakdownList) {
        const b = summary.breakdown || { presence: 0, multi_face: 0, gaze: 0, phone: 0, camera_lost: 0 };
        breakdownList.innerHTML = `
          <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-b-0 text-xs font-semibold text-slate-700">
            <span>Face Not Detected:</span>
            <span class="${b.presence > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}">${b.presence || 0}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-b-0 text-xs font-semibold text-slate-700">
            <span>Multiple Faces:</span>
            <span class="${b.multi_face > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}">${b.multi_face || 0}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-b-0 text-xs font-semibold text-slate-700">
            <span>Gaze Deviation:</span>
            <span class="${b.gaze > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}">${b.gaze || 0}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-b-0 text-xs font-semibold text-slate-700">
            <span>Phone Detected:</span>
            <span class="${b.phone > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}">${b.phone || 0}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-b-0 text-xs font-semibold text-slate-700">
            <span>Camera Feed Lost:</span>
            <span class="${b.camera_lost > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}">${b.camera_lost || 0}</span>
          </div>
        `;
      }
    } else {
      proctoringSection.classList.add('hidden');
    }
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
  let validNextItems = [];
  if (feedback.next && Array.isArray(feedback.next)) {
    validNextItems = feedback.next
      .map(item => typeof item === 'string' ? item.trim() : (item && (item.recommendation || item.action || item.step || item.text) ? String(item.recommendation || item.action || item.step || item.text).trim() : ''))
      .filter(text => text.length > 0);
  }

  if (validNextItems.length > 0) {
    validNextItems.forEach((text, index) => {
      const row = document.createElement('div');
      row.className = 'flex gap-4 items-start bg-slate-800 border-2 border-slate-700 p-4 rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]';
      row.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center flex-shrink-0 border-2 border-slate-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">${index + 1}</div>
        <p class="text-sm font-bold text-slate-100 flex-grow leading-relaxed pt-1">${text}</p>
      `;
      feedbackNext.appendChild(row);
    });
  } else {
    feedbackNext.innerHTML = '<div class="text-slate-400 text-sm font-semibold p-4">No next steps compiled.</div>';
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
        const totalSecs = sessionElapsedSeconds;
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

  // Turn camera OFF when session completes
  if (window.CameraManager) {
    window.CameraManager.stop();
  }
  const cameraWidget = document.getElementById('camera-widget');
  if (cameraWidget) cameraWidget.classList.add('hidden');
}

// Restart button actions
btnRestart.addEventListener('click', () => {
  screenFeedback.classList.add('hidden');
  screenStart.classList.remove('hidden');
  candidateSelect.value = '';
  candidateCard.classList.add('hidden');
  selectedCandidate = null;
  currentSessionId = null;
  localStorage.removeItem('currentSessionId');
  isInterviewActive = false;
  violationCount = 0;
  firedFlaggedNotice = false;

  // Enforce camera OFF
  if (window.CameraManager) {
    window.CameraManager.stop();
  }
  const cameraWidget = document.getElementById('camera-widget');
  if (cameraWidget) cameraWidget.classList.add('hidden');

  // Clear sidebar state
  updateSidebar([]);
  const chatSidebar = document.getElementById('chat-sidebar');
  if (chatSidebar) chatSidebar.classList.remove('active');
});

// Anti-cheating: Disable paste, copy, cut on answer input field
function showPasteWarning() {
  const errorEl = document.getElementById('paste-error');
  if (errorEl) {
    errorEl.innerHTML = `<i data-lucide="shield-alert" class="w-3.5 h-3.5 text-red-700"></i> <span>Pasting is prohibited in exam mode</span>`;
    errorEl.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
    setTimeout(() => {
      errorEl.style.display = 'none';
    }, 4000);
  }
}

// ==================== AUTO-EXPANDING CHAT TEXTAREA RESIZE LOGIC ====================
function adjustTextareaHeight() {
  if (!chatInput) return;
  chatInput.style.height = 'auto';
  const newHeight = Math.min(Math.max(chatInput.scrollHeight, 50), 180);
  chatInput.style.height = newHeight + 'px';
}

if (chatInput) {
  chatInput.addEventListener('input', adjustTextareaHeight);
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

  // Handle Enter (Send) vs Shift+Enter (Newline)
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Allow newline and auto-expand height
        setTimeout(adjustTextareaHeight, 10);
      } else {
        // Send message
        e.preventDefault();
        handleSendMessage();
      }
    }
  });
}

if (btnSend) {
  btnSend.addEventListener('click', () => {
    handleSendMessage();
  });
}

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
      leftBadges.style.flexWrap = 'wrap';
      leftBadges.style.maxWidth = '75%';

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

// 2. Comprehensive Font & Element Scaling Engine
const fontSizeIndicator = document.getElementById('font-size-indicator');

function applyFontSize(size) {
  document.body.classList.remove('font-size-sm', 'font-size-md', 'font-size-lg');
  document.body.classList.add(`font-size-${size}`);

  if (fontSizeIndicator) {
    fontSizeIndicator.textContent = size === 'sm' ? 'Small' : size === 'lg' ? 'Large' : 'Medium';
  }

  fontButtons.forEach(btn => {
    if (btn.dataset.size === size) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
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

// 3. Theme Mode Switcher (Dark / Light Mode)
const btnToggleTheme = document.getElementById('btn-toggle-theme');
const themeLabelText = document.getElementById('theme-label-text');
const themeIconMoon = document.querySelector('.theme-icon-moon');
const themeIconSun = document.querySelector('.theme-icon-sun');

function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    if (themeLabelText) themeLabelText.textContent = 'Light Mode';
    if (themeIconMoon) themeIconMoon.classList.add('hidden');
    if (themeIconSun) themeIconSun.classList.remove('hidden');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
    if (themeLabelText) themeLabelText.textContent = 'Dark Mode';
    if (themeIconMoon) themeIconMoon.classList.remove('hidden');
    if (themeIconSun) themeIconSun.classList.add('hidden');
  }
  try {
    localStorage.setItem('interview_theme', isDark ? 'dark' : 'light');
  } catch (e) {}
  if (window.lucide) lucide.createIcons();
}

if (btnToggleTheme) {
  btnToggleTheme.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(!isDark);
  });
}

const savedTheme = localStorage.getItem('interview_theme');
if (savedTheme === 'dark') {
  applyTheme(true);
}

// 4. Assessment Utilities: Calculator Engine
const modalCalc = document.getElementById('modal-calculator');
const btnOpenCalc = document.getElementById('btn-open-calculator');
const btnCloseCalc = document.getElementById('btn-close-calculator');
const calcDisplay = document.getElementById('calc-display');
const calcHistory = document.getElementById('calc-history');
const btnCalcInsert = document.getElementById('btn-calc-insert');

let calcCurrentVal = '0';
let calcPrevVal = '';
let calcOp = null;
let calcJustEvaluated = false;

function updateCalcDisplay() {
  if (calcDisplay) calcDisplay.textContent = calcCurrentVal;
  if (calcHistory) {
    calcHistory.textContent = calcOp && calcPrevVal !== '' ? `${calcPrevVal} ${calcOp}` : '';
  }
}

if (btnOpenCalc && modalCalc) {
  btnOpenCalc.addEventListener('click', () => {
    modalCalc.classList.remove('hidden');
    if (settingsPopover) settingsPopover.classList.add('hidden');
    if (window.lucide) lucide.createIcons();
  });
}

if (btnCloseCalc && modalCalc) {
  btnCloseCalc.addEventListener('click', () => {
    modalCalc.classList.add('hidden');
  });
}

document.querySelectorAll('.calc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.val;
    if (!val) return;

    if (val === 'C') {
      calcCurrentVal = '0';
      calcPrevVal = '';
      calcOp = null;
    } else if (val === 'back') {
      if (calcCurrentVal.length > 1) {
        calcCurrentVal = calcCurrentVal.slice(0, -1);
      } else {
        calcCurrentVal = '0';
      }
    } else if (val === '%') {
      calcCurrentVal = String(parseFloat(calcCurrentVal) / 100);
    } else if (val === 'sqrt') {
      const num = parseFloat(calcCurrentVal);
      calcCurrentVal = num >= 0 ? String(Math.round(Math.sqrt(num) * 10000) / 10000) : 'Error';
    } else if (['+', '-', '*', '/'].includes(val)) {
      calcPrevVal = calcCurrentVal;
      calcOp = val;
      calcCurrentVal = '0';
    } else if (val === '=') {
      if (calcOp && calcPrevVal !== '') {
        const a = parseFloat(calcPrevVal);
        const b = parseFloat(calcCurrentVal);
        let res = 0;
        if (calcOp === '+') res = a + b;
        else if (calcOp === '-') res = a - b;
        else if (calcOp === '*') res = a * b;
        else if (calcOp === '/') res = b !== 0 ? Math.round((a / b) * 10000) / 10000 : 'Error';
        calcCurrentVal = String(res);
        calcPrevVal = '';
        calcOp = null;
        calcJustEvaluated = true;
      }
    } else {
      // Numbers or dot
      if (calcCurrentVal === '0' || calcJustEvaluated) {
        calcCurrentVal = val === '.' ? '0.' : val;
        calcJustEvaluated = false;
      } else {
        if (val === '.' && calcCurrentVal.includes('.')) return;
        calcCurrentVal += val;
      }
    }
    updateCalcDisplay();
  });
});

if (btnCalcInsert && chatInput) {
  btnCalcInsert.addEventListener('click', () => {
    const textToInsert = calcDisplay ? calcDisplay.textContent : '';
    if (textToInsert && textToInsert !== 'Error') {
      chatInput.value += (chatInput.value ? ' ' : '') + textToInsert;
      adjustTextareaHeight();
      chatInput.focus();
    }
    if (modalCalc) modalCalc.classList.add('hidden');
  });
}

// 5. Assessment Utilities: Virtual Keyboard Engine
const modalKeyboard = document.getElementById('modal-keyboard');
const btnOpenKeyboard = document.getElementById('btn-open-keyboard');
const btnCloseKeyboard = document.getElementById('btn-close-keyboard');
const btnVkeyDone = document.getElementById('btn-vkey-done');
const vkeyShift = document.getElementById('vkey-shift');
let isVkeyShiftActive = false;

if (btnOpenKeyboard && modalKeyboard) {
  btnOpenKeyboard.addEventListener('click', () => {
    modalKeyboard.classList.remove('hidden');
    if (settingsPopover) settingsPopover.classList.add('hidden');
    if (window.lucide) lucide.createIcons();
  });
}

if (btnCloseKeyboard && modalKeyboard) {
  btnCloseKeyboard.addEventListener('click', () => {
    modalKeyboard.classList.add('hidden');
  });
}

if (btnVkeyDone && modalKeyboard) {
  btnVkeyDone.addEventListener('click', () => {
    modalKeyboard.classList.add('hidden');
    if (chatInput) chatInput.focus();
  });
}

document.querySelectorAll('.vkey-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if (!key || !chatInput) return;

    if (key === 'shift') {
      isVkeyShiftActive = !isVkeyShiftActive;
      btn.classList.toggle('bg-blue-600', isVkeyShiftActive);
      btn.classList.toggle('text-white', isVkeyShiftActive);
      document.querySelectorAll('.vkey-btn').forEach(kBtn => {
        const k = kBtn.dataset.key;
        if (k && k.length === 1 && /[a-zA-Z]/.test(k)) {
          kBtn.textContent = isVkeyShiftActive ? k.toUpperCase() : k.toLowerCase();
        }
      });
      return;
    }

    if (key === 'backspace') {
      chatInput.value = chatInput.value.slice(0, -1);
    } else if (key === 'clear') {
      chatInput.value = '';
    } else if (key === 'space') {
      chatInput.value += ' ';
    } else if (key === 'enter') {
      handleSendMessage();
    } else {
      const charToAdd = isVkeyShiftActive ? key.toUpperCase() : key;
      chatInput.value += charToAdd;
    }
    adjustTextareaHeight();
    chatInput.focus();
  });
});

// 6. History Panel Show / Hide Toggle Logic
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

// Derived state logic for input area response mode
window.lastQuestionData = null;

function updateInputArea() {
  const latestMsg = window.lastQuestionData;
  if (!latestMsg) {
    chatInput.disabled = false;
    btnSend.disabled = false;
    chatInput.placeholder = 'Type your answer here...';
    return;
  }

  const isMCQ = latestMsg.nextQuestionType === 'mcq';
  const hasOptions = Array.isArray(latestMsg.mcqOptions) && latestMsg.mcqOptions.length >= 2;

  if (isMCQ && !hasOptions) {
    console.warn(`[Session: ${currentSessionId || 'none'}] Malformed MCQ choice data fallback: 'mcqOptions' is empty or missing. Falling back to free-text input.`);
  }

  if (isMCQ && hasOptions) {
    chatInput.disabled = true;
    btnSend.disabled = true;
    chatInput.placeholder = 'Please select one of the choices below...';
  } else {
    chatInput.disabled = false;
    btnSend.disabled = false;
    chatInput.placeholder = 'Type your answer here...';
    adjustTextareaHeight();
    const hasRules = screenRules && !screenRules.classList.contains('hidden');
    const hasStart = screenStart && !screenStart.classList.contains('hidden');
    if (!hasRules && !hasStart && isInterviewActive) {
      chatInput.focus();
    }
  }
}

// Unconditional auto-scroll using MutationObserver
if (chatMessages) {
  const scrollObserver = new MutationObserver(() => {
    scrollChatBottom();
  });
  scrollObserver.observe(chatMessages, { childList: true, subtree: true });
}

// Register ProctoringNotifier window callback for MediaPipe proctoring violations (Phase C3/C4/C5)
window.ProctoringNotifier = async (type) => {
  if (!isInterviewActive) return;
  console.log(`[Proctoring App] Handling proctoring violation event: ${type}`);
  
  // 1. Report to server and get updated violation counts and flagging status
  const data = await reportViolationToServer(type);
  if (!data) return;

  const currentCount = data.violationCount || 1;

  // 2. Check for one-time flagged notice threshold (4+ violations)
  if (data.flaggedForReview && !firedFlaggedNotice) {
    firedFlaggedNotice = true;
    showFlaggedForReviewNotice();
    return;
  }

  // 3. Display warning banner toast based on escalation rules
  const pasteError = document.getElementById('paste-error');
  if (pasteError) {
    let msg = '';
    let duration = 5000;

    if (currentCount === 1) {
      // First violation escalation: brief generic warning
      msg = 'Please stay visible and focused on the screen during the interview';
      duration = 4000;
    } else {
      // Second/Third violation escalation: specific plain-language warning
      let label = 'Proctoring anomaly';
      if (type === 'presence_violation') label = 'No face detected for several seconds';
      else if (type === 'multi_face_violation') label = 'Multiple faces detected in frame';
      else if (type === 'gaze_violation') label = 'Gaze deviation detected for several seconds';
      else if (type === 'phone_violation') label = 'Phone detected in frame';
      else if (type === 'camera_lost') label = 'Camera feed connection lost';

      msg = `Proctoring Warning: ${label}.`;
      duration = 8000;
    }

    pasteError.innerHTML = `<i data-lucide="shield-alert" class="w-3.5 h-3.5 text-red-700 font-extrabold"></i> <span>${msg}</span>`;
    pasteError.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
    
    // Auto-hide warning toast
    setTimeout(() => {
      if (pasteError.innerHTML.includes(msg)) {
        pasteError.style.display = 'none';
      }
    }, duration);
  }
};

function showFlaggedForReviewNotice() {
  // Clear any active toast warnings
  const pasteError = document.getElementById('paste-error');
  if (pasteError) pasteError.style.display = 'none';

  const flaggedModal = document.createElement('div');
  flaggedModal.className = 'fixed inset-0 flex items-center justify-center bg-slate-900/80 z-[100000] p-4';
  flaggedModal.innerHTML = `
    <div class="bg-white border-4 border-slate-900 rounded-xl p-8 max-w-md w-full shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-4 animate-scaleUp">
      <div class="flex items-center gap-2.5 text-amber-600 font-extrabold text-xl">
        <i data-lucide="shield-alert" class="w-6 h-6"></i>
        <span>Session Flagged for Review</span>
      </div>
      <p class="text-slate-800 text-sm font-semibold leading-relaxed">
        Due to repeated proctoring anomalies (camera, face, or gaze deviations), your session has been flagged for administrative review.
      </p>
      <p class="text-slate-500 text-xs font-semibold leading-relaxed">
        You may continue and complete your technical interview normally. Evaluation scoring and system design rounds will progress as scheduled.
      </p>
      <button id="btn-dismiss-flagged" class="mt-2 py-3 bg-slate-900 hover:bg-slate-800 text-white text-sm font-extrabold rounded-lg border-2 border-slate-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition w-full">
        Understood & Continue
      </button>
    </div>
  `;
  document.body.appendChild(flaggedModal);
  if (window.lucide) lucide.createIcons();
  
  document.getElementById('btn-dismiss-flagged').addEventListener('click', () => {
    flaggedModal.remove();
  });
}

// ==================== PART F & G: FLAG & FEEDBACK ESCAPE HATCH ====================
window.finalInterviewData = null;

// Flag Question Modal triggers
const btnFlagQuestion = document.getElementById('btn-flag-question');
const modalFlagQuestion = document.getElementById('modal-flag-question');
const btnCloseFlagModal = document.getElementById('btn-close-flag-modal');
const btnSkipFlag = document.getElementById('btn-skip-flag');
const btnSubmitFlag = document.getElementById('btn-submit-flag');

const flagReasonPreset = document.getElementById('flag-reason-preset');
const flagReasonText = document.getElementById('flag-reason-text');

if (btnFlagQuestion) {
  btnFlagQuestion.addEventListener('click', () => {
    if (!isInterviewActive) return;
    modalFlagQuestion.classList.remove('hidden');
    flagReasonPreset.value = '';
    flagReasonText.value = '';
  });
}

if (btnCloseFlagModal) {
  btnCloseFlagModal.addEventListener('click', () => {
    modalFlagQuestion.classList.add('hidden');
  });
}

if (btnSkipFlag) {
  btnSkipFlag.addEventListener('click', () => {
    submitFlagCurrentQuestion('No reason provided');
  });
}

if (btnSubmitFlag) {
  btnSubmitFlag.addEventListener('click', () => {
    const preset = flagReasonPreset.value;
    const custom = flagReasonText.value.trim();
    let reason = 'No reason provided';
    if (preset && custom) {
      reason = `${preset}: ${custom}`;
    } else if (preset) {
      reason = preset;
    } else if (custom) {
      reason = custom;
    }
    submitFlagCurrentQuestion(reason);
  });
}

// Submit Flag to backend and advance
async function submitFlagCurrentQuestion(reason) {
  modalFlagQuestion.classList.add('hidden');
  
  const thinkingEl = appendThinkingIndicator();
  scrollChatBottom(true);
  
  try {
    const res = await fetch('/api/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        flagCurrentQuestion: true,
        flagReason: reason
      })
    });
    
    thinkingEl.remove();
    if (!res.ok) throw new Error('Failed to flag question');
    const data = await res.json();
    
    if (data.done) {
      handleInterviewEndFlow(data);
    } else {
      appendTopicTag('New Topic');
      appendInterviewerMessage(data.reply, data.detectedConnections, data.nextQuestionType, data.mcqOptions, data.diagramDefinition, data.diagramQuestionText, null);
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
    console.error('Error flagging question:', error);
    appendInterviewerMessage('Error occurred while flagging the question. Moving on...');
  } finally {
    updateInputArea();
  }
}

// Unified end-of-interview feedback flow router
async function handleInterviewEndFlow(data) {
  isInterviewActive = false;
  stopSessionTimer();
  
  if (window.CameraManager) {
    window.CameraManager.stop();
  }
  const cameraWidget = document.getElementById('camera-widget');
  if (cameraWidget) cameraWidget.classList.add('hidden');

  window.finalInterviewData = {
    feedback: data.feedback,
    metrics: data.metrics || {
      overallAccuracy: 0,
      perDay: [],
      difficultyProgression: [],
      questionTypeBreakdown: { open: 0, mcq: 0, diagram_interpret: 0 }
    },
    judgeVerdict: data.judgeVerdict,
    proctoringSummary: data.proctoringSummary
  };
  
  try {
    const res = await fetch(`/api/session/${currentSessionId}`);
    if (!res.ok) throw new Error('Failed to fetch session details');
    const sessionDetails = await res.json();
    
    const askedQuestions = (sessionDetails.transcript || [])
      .filter(entry => entry.role === 'interviewer' && entry.day !== undefined);
      
    renderPostInterviewFeedbackScreen(askedQuestions);
  } catch (err) {
    console.error('Error entering feedback flow, bypassing directly to summary:', err);
    transitionToFeedback(
      window.finalInterviewData.feedback,
      window.finalInterviewData.metrics,
      window.finalInterviewData.judgeVerdict,
      window.finalInterviewData.proctoringSummary
    );
  }
}

function renderPostInterviewFeedbackScreen(questions) {
  const container = document.getElementById('post-feedback-questions-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (questions.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-sm text-center py-6">No questions asked during this session.</div>`;
  } else {
    questions.forEach((q, idx) => {
      const row = document.createElement('div');
      row.className = 'border-2 border-slate-900 rounded-lg p-4 bg-slate-50 flex flex-col gap-3';
      row.innerHTML = `
        <div class="flex justify-between items-start border-b border-slate-200 pb-2">
          <span class="text-xs font-black text-blue-600 uppercase tracking-wider">Question ${idx + 1} (Day ${q.day})</span>
        </div>
        <p class="text-xs font-bold text-slate-800 leading-relaxed">${q.text}</p>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] font-black uppercase tracking-wider text-slate-500">Was this question unclear or wrong? (optional)</label>
          <input type="text" data-question-text="${encodeURIComponent(q.text)}" data-day="${q.day}" class="post-feedback-comment-input w-full p-2 bg-white border border-slate-300 rounded outline-none text-xs font-semibold focus:border-slate-900" placeholder="e.g. The options did not match, wording was ambiguous" />
        </div>
      `;
      container.appendChild(row);
    });
  }
  
  // Hide other screens
  screenStart.classList.add('hidden');
  screenChat.classList.add('hidden');
  screenFeedback.classList.add('hidden');
  const suspendedScreen = document.getElementById('screen-suspended');
  if (suspendedScreen) suspendedScreen.classList.add('hidden');
  
  // Show feedback screen
  document.getElementById('screen-post-interview-feedback').classList.remove('hidden');
  
  if (window.lucide) lucide.createIcons();
}

// Post-interview feedback actions
const btnSkipPostFeedback = document.getElementById('btn-skip-post-feedback');
const btnSubmitPostFeedback = document.getElementById('btn-submit-post-feedback');

if (btnSkipPostFeedback) {
  btnSkipPostFeedback.addEventListener('click', () => {
    document.getElementById('screen-post-interview-feedback').classList.add('hidden');
    transitionToFeedback(
      window.finalInterviewData.feedback,
      window.finalInterviewData.metrics,
      window.finalInterviewData.judgeVerdict,
      window.finalInterviewData.proctoringSummary
    );
  });
}

if (btnSubmitPostFeedback) {
  btnSubmitPostFeedback.addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.post-feedback-comment-input');
    const feedbackPromises = [];
    
    inputs.forEach(input => {
      const text = input.value.trim();
      if (text) {
        const questionText = decodeURIComponent(input.getAttribute('data-question-text'));
        const day = parseInt(input.getAttribute('data-day'));
        
        feedbackPromises.push(
          fetch('/api/flag-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: currentSessionId,
              day,
              questionText,
              reason: text
            })
          }).catch(err => console.error('Failed to submit comment:', err))
        );
      }
    });
    
    if (feedbackPromises.length > 0) {
      try {
        await Promise.all(feedbackPromises);
        console.log('[Post-Feedback] All comments submitted successfully.');
      } catch (e) {
        console.error('Error submitting feedback comments:', e);
      }
    }
    
    document.getElementById('screen-post-interview-feedback').classList.add('hidden');
    transitionToFeedback(
      window.finalInterviewData.feedback,
      window.finalInterviewData.metrics,
      window.finalInterviewData.judgeVerdict,
      window.finalInterviewData.proctoringSummary
    );
  });
}


