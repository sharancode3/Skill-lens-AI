import express from 'express';
import dotenv from 'dotenv';
import { initFirebase, runStartupHealthCheck } from './firebase.js';
import { initializeData, getEnrichedCandidate } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { createSession, handleTurn } from './sessionManager.js';

dotenv.config();


// Load curriculum and candidates data synchronously on process startup
initializeData();



const app = express();
app.use(express.json());

// Root check
app.get('/', (req, res) => {
  res.json({ message: 'Skill Labs Ai API is running' });
});


// POST /api/interview
app.post('/api/interview', async (req, res) => {
  const { sessionId, candidate, message } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    // Branch on request shape:
    // 1. Session start: presence of candidate (no message)
    if (candidate && !message) {
      const result = await createSession(sessionId, candidate);
      return res.json(result);
    }

    // 2. Conversation turn: presence of message (no candidate)
    if (message) {
      const result = await handleTurn(sessionId, message);
      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      return res.json(result);
    }

    // Fallback for invalid shape
    return res.status(400).json({
      error: 'Invalid request payload. Must specify either candidate (for start) or message (for turn).'
    });
  } catch (error) {
    console.error('[API Error] Exception during interview turn:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Generate day embeddings synchronously or via API fallback
  await generateEmbeddings();


  // Verification step for Phase 1
  console.log('[Verification] Testing getEnrichedCandidate synchronously for CAND-001, CAND-002, and CAND-003:');
  const ids = ['CAND-001', 'CAND-002', 'CAND-003'];
  for (const id of ids) {
    const enriched = getEnrichedCandidate(id);
    if (enriched) {
      console.log(`\n--- Enriched Candidate: ${id} ---`);
      console.log(JSON.stringify(enriched.slice(0, 2), null, 2)); // log first 2 missions
      console.log(`Total enriched missions for ${id}: ${enriched.length}`);
    } else {
      console.error(`Candidate ${id} not found.`);
    }
  }
  
  // Initialize Firebase and execute the health check
  console.log('Starting Firebase Admin SDK...');
  initFirebase();
  console.log('Running Firebase startup healthcheck...');
  await runStartupHealthCheck();
});

