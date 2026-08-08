// cameraManager.js - ES Module for Proctoring Camera Lifecycle & MediaPipe Face Landmarker & Object Detector (Phase C4)

let currentStream = null;
let currentState = 'OFF'; // States: OFF, PREVIEW, ACTIVE

let faceLandmarker = null;
let isModelLoading = false;
let objectDetector = null;
let isObjectDetectorLoading = false;

let activeCheckInterval = null;

let noFaceTicks = 0;
let gazeTicks = 0;
let phoneTicks = 0;

let firedPresenceViolation = false;
let firedGazeViolation = false;
let firedPhoneViolation = false;

async function initFaceLandmarker() {
  if (faceLandmarker || isModelLoading) return;
  isModelLoading = true;
  console.log('[CameraManager] Loading MediaPipe FaceLandmarker...');
  try {
    const { FilesetResolver, FaceLandmarker } = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/vision_bundle.mjs"
    );

    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 2
    });
    console.log('[CameraManager] FaceLandmarker loaded successfully.');
  } catch (err) {
    console.error('[CameraManager] Failed to load FaceLandmarker:', err);
  } finally {
    isModelLoading = false;
  }
}

async function initObjectDetector() {
  if (objectDetector || isObjectDetectorLoading) return;
  isObjectDetectorLoading = true;
  console.log('[CameraManager] Loading MediaPipe ObjectDetector...');
  try {
    const { FilesetResolver, ObjectDetector } = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/vision_bundle.mjs"
    );

    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
    );

    objectDetector = await ObjectDetector.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      scoreThreshold: 0.4
    });
    console.log('[CameraManager] ObjectDetector loaded successfully.');
  } catch (err) {
    console.error('[CameraManager] Failed to load ObjectDetector:', err);
  } finally {
    isObjectDetectorLoading = false;
  }
}

function processDetectionSample(result) {
  const faces = result.faceLandmarks || [];
  const matrices = result.facialTransformationMatrixes || [];

  console.log(`[CameraManager Sample] Detected faces count: ${faces.length}`);

  const notifyViolation = (type) => {
    if (window.ProctoringNotifier) {
      window.ProctoringNotifier(type);
    }
  };

  // 1. Multi-face violation check (Immediate check)
  if (faces.length > 1) {
    console.warn('[CameraManager] Multi-face violation detected!');
    notifyViolation('multi_face_violation');
    noFaceTicks = 0;
    gazeTicks = 0;
    return;
  }

  // 2. No face detected check (Sustained window of 5 seconds)
  if (faces.length === 0) {
    noFaceTicks++;
    gazeTicks = 0;
    console.log(`[CameraManager Sample] No face detected. Ticks: ${noFaceTicks}/5`);
    if (noFaceTicks >= 5) {
      if (!firedPresenceViolation) {
        console.warn('[CameraManager] Presence violation fired!');
        notifyViolation('presence_violation');
        firedPresenceViolation = true;
      }
    }
    return;
  }

  // Normal face present: reset presence variables
  noFaceTicks = 0;
  firedPresenceViolation = false;

  // 3. Head pose/gaze deviation (matrix yaw off-center > 28 degrees, sustained for 4 seconds)
  let yaw = 0;
  const matrix = matrices[0];

  if (matrix) {
    yaw = Math.atan2(matrix[8], matrix[10]) * (180 / Math.PI);
  } else {
    // Fallback: estimate yaw using landmarks eye-to-nose relative offsets
    const landmarks = faces[0];
    if (landmarks && landmarks.length > 300) {
      const leftEye = landmarks[33];   // outer left eye corner
      const rightEye = landmarks[263]; // outer right eye corner
      const noseTip = landmarks[1];    // nose tip
      if (leftEye && rightEye && noseTip) {
        const distLeft = Math.abs(noseTip.x - leftEye.x);
        const distRight = Math.abs(noseTip.x - rightEye.x);
        const total = distLeft + distRight;
        if (total > 0) {
          const ratio = distLeft / total;
          yaw = (ratio - 0.5) * 120; // scale to degree approximations
        }
      }
    }
  }

  console.log(`[CameraManager Sample] Face detected. Yaw: ${yaw.toFixed(1)} degrees`);

  const yawThreshold = 28;
  if (Math.abs(yaw) > yawThreshold) {
    gazeTicks++;
    console.log(`[CameraManager Sample] Gaze deviation detected. Ticks: ${gazeTicks}/4`);
    if (gazeTicks >= 4) {
      if (!firedGazeViolation) {
        console.warn('[CameraManager] Gaze violation fired!');
        notifyViolation('gaze_violation');
        firedGazeViolation = true;
      }
    }
  } else {
    // Centered head: reset gaze deviation timers
    gazeTicks = 0;
    firedGazeViolation = false;
  }
}

function processObjectDetectionSample(result) {
  const detections = result.detections || [];
  let phoneDetected = false;

  for (const detection of detections) {
    const categories = detection.categories || [];
    for (const cat of categories) {
      if (cat.categoryName === 'cell phone') {
        console.log(`[CameraManager Sample] Cell phone candidate detected with score: ${cat.score}`);
        if (cat.score >= 0.65) {
          phoneDetected = true;
          break;
        }
      }
    }
    if (phoneDetected) break;
  }

  const notifyViolation = (type) => {
    if (window.ProctoringNotifier) {
      window.ProctoringNotifier(type);
    }
  };

  if (phoneDetected) {
    phoneTicks++;
    console.log(`[CameraManager Sample] Cell phone detected. Ticks: ${phoneTicks}/2`);
    if (phoneTicks >= 2) {
      if (!firedPhoneViolation) {
        console.warn('[CameraManager] Phone violation fired!');
        notifyViolation('phone_violation');
        firedPhoneViolation = true;
      }
    }
  } else {
    phoneTicks = 0;
    firedPhoneViolation = false;
  }
}

function startDetectionLoop(videoElement) {
  if (activeCheckInterval) clearInterval(activeCheckInterval);

  noFaceTicks = 0;
  gazeTicks = 0;
  phoneTicks = 0;

  firedPresenceViolation = false;
  firedGazeViolation = false;
  firedPhoneViolation = false;

  activeCheckInterval = setInterval(async () => {
    if (currentState !== 'ACTIVE') {
      clearInterval(activeCheckInterval);
      return;
    }

    if (!faceLandmarker) {
      await initFaceLandmarker();
    }
    if (!objectDetector) {
      await initObjectDetector();
    }

    if (videoElement && videoElement.readyState >= 2) {
      const timestamp = performance.now();

      // 1. Run FaceLandmarker proctoring
      if (faceLandmarker) {
        try {
          const faceResult = faceLandmarker.detectForVideo(videoElement, timestamp);
          processDetectionSample(faceResult);
        } catch (err) {
          console.error('[CameraManager] Error running face detection:', err);
        }
      }

      // 2. Run ObjectDetector proctoring
      if (objectDetector) {
        try {
          const objectResult = objectDetector.detectForVideo(videoElement, timestamp);
          processObjectDetectionSample(objectResult);
        } catch (err) {
          console.error('[CameraManager] Error running object detection:', err);
        }
      }
    }
  }, 1000);
}

const CameraManager = {
  getCurrentState() {
    return currentState;
  },

  async startPreview(videoElement) {
    console.log('[CameraManager] Entering PREVIEW state...');
    if (currentStream) {
      this.stop();
    }

    // Load model assets in the background
    initFaceLandmarker();
    initObjectDetector();

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
      startDetectionLoop(videoElement);
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
      startDetectionLoop(videoElement);
    } catch (err) {
      console.error('[CameraManager] Camera permission error entering ACTIVE state:', err);
      currentState = 'ACTIVE';
    }
  },

  stop() {
    console.log('[CameraManager] Entering OFF state. Releasing stream tracks...');
    if (activeCheckInterval) {
      clearInterval(activeCheckInterval);
      activeCheckInterval = null;
    }
    noFaceTicks = 0;
    gazeTicks = 0;
    phoneTicks = 0;

    firedPresenceViolation = false;
    firedGazeViolation = false;
    firedPhoneViolation = false;

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
