// cameraManager.js - ES Module for Proctoring Camera Lifecycle (Phase C0)

let currentStream = null;
let currentState = 'OFF'; // States: OFF, PREVIEW, ACTIVE

const CameraManager = {
  getCurrentState() {
    return currentState;
  },

  async startPreview(videoElement) {
    console.log('[CameraManager] Entering PREVIEW state...');
    if (currentStream) {
      this.stop();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      currentStream = stream;
      videoElement.srcObject = stream;
      
      const statusText = document.getElementById('camera-status-text');
      if (statusText) statusText.textContent = 'Camera Live';
      
      currentState = 'PREVIEW';
      return true;
    } catch (err) {
      console.error('[CameraManager] Camera permission denied or error:', err);
      const statusText = document.getElementById('camera-status-text');
      if (statusText) statusText.textContent = 'Camera Error / Blocked';
      return false;
    }
  },

  async startActive(videoElement) {
    console.log('[CameraManager] Entering ACTIVE state...');
    
    // If we have a stream active from PREVIEW, reuse it to avoid re-triggering prompt
    if (currentStream && videoElement) {
      videoElement.srcObject = currentStream;
      currentState = 'ACTIVE';
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      currentStream = stream;
      if (videoElement) {
        videoElement.srcObject = stream;
      }
      currentState = 'ACTIVE';
    } catch (err) {
      console.error('[CameraManager] Camera permission error entering ACTIVE state:', err);
      currentState = 'ACTIVE';
    }
  },

  stop() {
    console.log('[CameraManager] Entering OFF state. Releasing stream tracks...');
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        track.stop();
        console.log('[CameraManager] Stopped track:', track.label);
      });
      currentStream = null;
    }
    currentState = 'OFF';
  }
};

// Bind to window to allow public/app.js access
window.CameraManager = CameraManager;
