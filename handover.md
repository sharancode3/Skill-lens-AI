# PROJECT HANDOVER: Skill Labs Ai (AI Interview Agent)

To the incoming AI Coding Assistant: **Read this document first**. It provides full context on the workspace state, design constraints, technical architecture, and the workflow you must follow to avoid any misunderstanding.

---

## 1. What We Have Built (Current State)
We are in a 42-hour hackathon setup. **Phase 0 is complete and fully working**.
- **Backend framework**: Node.js + Express (running in ESM mode `"type": "module"`).
- **Endpoint**: Exposes `POST /api/interview` (no auth).
  - Handles **Session Start** when `candidate` is present in the request body.
  - Handles **Conversation Turn** when `message` is present in the request body.
  - Returns a mock terminal response with structured `feedback` on the 3rd turn.
  - State tracking in Phase 0 is in-memory via `sessionTurns` Map.
- **Database Connection**: Firebase Admin SDK initialized in `src/firebase.js`.
  - Reads credentials from the `FIREBASE_SERVICE_ACCOUNT` environment variable.
  - Performs a write-then-read startup healthcheck on server start to the `_healthcheck/startup` collection.
- **Git Remote**: Linked to `https://github.com/sharancode3/Skill-lens-AI.git` (pushed to `origin/master`).

---

## 2. Directory Structure & Key Files
You must familiarize yourself with these files immediately:
- **`project_memory.md`**: The persistent memory doc. You **MUST** read and update this file at the end of every phase. Do not analyze the entire codebase from scratch; trust this file.
- **`ai_usage_log.md`**: The AI Activity Log. Every prompt and code modification must be logged here with date, description, model name, and prompt used to ensure hackathon authenticity review compliance.
- **`ARCHITECTURE.md`**: Decision log confirming Node.js/Express, Gemini 1.5 Flash, in-memory static data, and Firestore session persistence.
- **`architecture_decisions.md`**: In-depth explanations of A.1-A.4 (Why context-injection instead of fine-tuning, why in-memory vector search instead of hosted, Firestore document mapping, local vs cloud details).
- **`design_system.md`**: Flat Design token guidelines. **Strictly 0 shadows, no gradients on elements, Outfit font, bold color blocks, hover scale animations.**
- **`prd.md`**: Product Requirements Document (min 8 questions, min 4 curriculum days, adaptive follow-ups, turn cap, structured feedback).
- **`trd.md`**: Technical specifications (Topic Selection Scoring, state machine, answer classification, follow-up parameters).
- **`workflow.md`**: Phase-by-phase timeline (0 to 10). We are starting **Phase 1**.
- **`ui_notes.md`**: Screen-by-screen breakdown mapping the Flat Design system onto the 3 application screens.
- **`candidates.json` & `curriculum.json`**: The static reference data.
- **`technical-spec.md`**: The strict JSON API payload specifications for grading.

---

## 3. Strict Rules of Engagement for the AI Agent
1. **Never Rebuild Phase 0**: The server structure, endpoints, and health check are working. Build incrementally on top of them.
2. **Read Project Memory and AI Logs**: Check `project_memory.md` to see the next task.
3. **Commit Incrementally**: Break work down into small changes. Make a clean Git commit for each step.
4. **Update AI Usage Log & Project Memory**: After making changes, use file-edit tools to document the action in `ai_usage_log.md` and update `project_memory.md`.
5. **No External Vector DB**: Do not install Pinecone, Weaviate, or pgvector. Store curriculum embeddings in-memory as JavaScript arrays and write a simple cosine similarity utility for similarity search (for the cross-curriculum Connection Detection).
6. **No Shadows or Element Gradients**: Read `design_system.md` before writing frontend CSS/Tailwind.

---

## 4. Next Step: Phase 1
Your very first task is to implement **Phase 1**:
- Load `curriculum.json` and `candidates.json` into memory on startup.
- Build fast lookup maps: `daysByNumber` (Map of day -> object), `modulesByDay` (Map of day -> module name), `candidatesById` (Map of candidateId -> object).
- Write a helper function `getEnrichedCandidate(candidateId)` to retrieve the candidate and attach full day data (title and objectives) for all of their passed/skipped missions.

Verify that your helper functions work using local testing or console logging, update `project_memory.md` and `ai_usage_log.md`, commit, and then request the prompt for **Phase 2 (Topic Queue Algorithm)**.
