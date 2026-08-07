import express from 'express';
import dotenv from 'dotenv';
import { initFirebase, runStartupHealthCheck } from './firebase.js';

dotenv.config();

const app = express();
app.use(express.json());

// In-memory session tracking for Phase 0 only
const sessionTurns = new Map();

// Root check
app.get('/', (req, res) => {
  res.json({ message: 'Skill Labs Ai API is running' });
});

// POST /api/interview
app.post('/api/interview', (req, res) => {
  const { sessionId, candidate, message } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  // Branch on request shape:
  // 1. Session start: presence of candidate (no message)
  if (candidate && !message) {
    sessionTurns.set(sessionId, 0);
    const candidateName = candidate.name || 'Candidate';
    return res.json({
      reply: `Welcome ${candidateName}. Let's begin the interview. Tell me about your experience with AI and embeddings.`,
      done: false
    });
  }

  // 2. Conversation turn: presence of message (no candidate)
  if (message) {
    let currentTurns = sessionTurns.has(sessionId) ? sessionTurns.get(sessionId) : 0;
    currentTurns++;
    sessionTurns.set(sessionId, currentTurns);

    if (currentTurns >= 3) {
      // End interview and return structured feedback
      sessionTurns.delete(sessionId); // Clean up
      return res.json({
        reply: 'Thank you. The interview is completed.',
        done: true,
        feedback: {
          summary: 'The candidate demonstrated a solid foundational grasp of AI concepts but had minor gaps in observability.',
          strengths: ['Clear understanding of embeddings', 'Hands-on project experience'],
          gaps: ['Observability was skipped on Day 29'],
          next: [
            'Revisit Day 29 (Observability): read about structured logging and telemetry.',
            'Practice writing production-ready correlation filters.'
          ]
        }
      });
    }

    // Standard intermediate turn
    return res.json({
      reply: `Noted. (Received response: "${message}"). Let's expand on that or proceed to the next question.`,
      done: false
    });
  }

  // Fallback for invalid shape
  return res.status(400).json({
    error: 'Invalid request payload. Must specify either candidate (for start) or message (for turn).'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize Firebase and execute the health check
  console.log('Starting Firebase Admin SDK...');
  initFirebase();
  console.log('Running Firebase startup healthcheck...');
  await runStartupHealthCheck();
});
