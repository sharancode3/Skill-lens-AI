import express from 'express';
import dotenv from 'dotenv';
import { initFirebase, runStartupHealthCheck } from './firebase.js';
import { initializeData, getEnrichedCandidate, candidatesById, precomputeConceptTerms } from './dataManager.js';
import { generateEmbeddings } from './embeddingManager.js';
import { createSession, handleTurn, reportViolation, cooldowns, getSessionDoc } from './sessionManager.js';

dotenv.config();


// Load curriculum and candidates data synchronously on process startup
initializeData();



const app = express();
app.use(express.json());

// Serve frontend files
app.use(express.static('public'));

// GET /api/candidates
app.get('/api/candidates', (req, res) => {
  try {
    const list = Array.from(candidatesById.values());
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve candidates list.' });
  }
});

// GET /api/session/:sessionId
app.get('/api/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await getSessionDoc(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.json({
      sessionId: session.sessionId,
      state: session.state,
      fullscreenExits: session.fullscreenExits || 0,
      warningLockoutUntil: session.warningLockoutUntil || null,
      suspended: session.state === 'done' && session.feedback && session.feedback.summary.includes('suspended'),
      violations: session.violations || [],
      candidate: session.candidateSnapshot || null,
      transcript: session.transcript || [],
      lastResponse: session.lastResponse || null
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


// POST /api/interview
app.post('/api/interview', async (req, res) => {
  const { sessionId, candidate, message, violationType } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    // Branch on request shape:
    // 1. Proctoring violation log: presence of violationType
    if (violationType) {
      const result = await reportViolation(sessionId, violationType);
      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      return res.json(result);
    }

    // 2. Session start: presence of candidate (no message, no violationType)
    if (candidate && !message) {
      const candId = candidate.id || (candidate.member ? candidate.member.id : null);
      if (candId && cooldowns.has(candId)) {
        const suspendedAt = cooldowns.get(candId);
        const elapsedMs = Date.now() - suspendedAt.getTime();
        const cooldownMs = 5 * 60 * 1000; // 5 minutes
        if (elapsedMs < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
          const mins = Math.floor(remainingSeconds / 60);
          const secs = remainingSeconds % 60;
          return res.status(403).json({
            error: 'COOLDOWN_ACTIVE',
            message: `You are in a cooldown period due to repeated proctoring violations. Please retry in ${mins}m ${secs}s.`
          });
        } else {
          // Cooldown expired, clear it
          cooldowns.delete(candId);
        }
      }
      const result = await createSession(sessionId, candidate);
      return res.json(result);
    }

    // 3. Conversation turn: presence of message (no candidate, no violationType)
    if (message !== undefined) {
      const result = await handleTurn(sessionId, message);
      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      return res.json(result);
    }

    // Fallback for invalid shape
    return res.status(400).json({
      error: 'Invalid request payload. Must specify candidate (for start), message (for turn), or violationType (for proctoring).'
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
  
  // Precompute key concept terms for all days
  await precomputeConceptTerms();


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

