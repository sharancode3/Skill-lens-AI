# Project Memory Document

This document is maintained to help AI models understand the current state of the project without needing to analyze the entire codebase every time.

## Project Overview
- **Name:** Skill Labs Ai
- **Goal:** Build an adaptive, multi-turn AI technical interview agent that assesses candidates based on their learning path and generates feedback.
- **Tech Stack:** Node.js/Express (Backend), React/Vite/Tailwind (Frontend), Firebase Firestore (Session DB)


## Current State
- Configured Git repository with remote tracking pointing to `https://github.com/sharancode3/Skill-lens-AI.git`.
- Saved design guidelines, database design, PRD, TRD, UI application notes, and workflow phases.
- Integrated OpenAI-compatible routing for **Qwen 2.5 3B** local and tunneled models inside `llmClient.js`.
- Configured ngrok authtoken and added configurable `.env` settings.
- All testing and validation suites are passing successfully.



## Architecture / File Structure
- `project_memory.md`: Current file, maintains context.
- `ai_usage_log.md`: Tracks AI usage for hackathon compliance.
- `README.md`: Project description and setup instructions.
- `prd.md`: Product Requirements Document for the AI Interview Agent.
- `trd.md`: Technical Requirements & Architecture.
- `architecture_decisions.md`: Details model configuration, vector database design choices, and API tradeoffs.
- `ARCHITECTURE.md`: High-level summary of backend framework, LLM provider, and Firestore/memory data design split.
- `handover.md`: Project context handover guide for incoming AI assistants.
- `workflow.md`: End-to-end request lifecycle and phase plan.

- `db_design.md`: Firestore database state/collection structure.
- `ui_notes.md`: UI specifications mapped to the 3 application screens.
- `design_system.md`: The Flat Design token guidelines.
- `technical-spec.md`: The exact JSON schemas and endpoint expectations for grading.
- `curriculum.json`: The 31-day curriculum modules reference data.
- `candidates.json`: The candidates list and learning paths.
- `src/dataManager.js`: Indexes data synchronously at startup and provides candidate enrichment.
- `src/topicSelector.js`: Deterministic topic selection algorithm under module diversity constraints.
- `src/embeddingManager.js`: In-memory vector index generation and cosine similarity lookup.
- `src/sessionManager.js`: Session state machine logic and database operations wrapper.
- `src/llmClient.js`: Google Gemini API client with schema enforcement and offline mock simulation.
- `src/firebase.js`: Firebase Firestore connection and startup health check.
- `src/server.js`: Node.js Express server defining interview endpoint routes.
- `public/index.html`: Main HTML entrypoint defining views for landing, chat, and feedback screens.
- `public/style.css`: Vanilla CSS stylesheet containing design system colors, custom shapes, and focus rings.
- `public/app.js`: Frontend application script executing candidates indexing, chat turns, and dynamic feedback rendering.
- `src/testHardening.js`: Standalone runner validating whitespace retries, input truncation, double-submit caching, and outages.


## Ongoing Tasks
- [x] All phases completed successfully. Ready for demo grading.


## Completed Tasks
- [x] Initial repository setup.
- [x] Saved all design, requirements, database, and workflow documents.
- [x] Phase 0: Express skeleton + contract with Firebase Admin healthcheck.
- [x] Phase 1: Reference Data Loading (curriculum and candidates), index maps, validation pass, and candidate enrichment helper.
- [x] Phase 2: Implement the Topic Queue Selection Scoring algorithm.
- [x] Phase 2.5: Implement the in-memory vector embedding layer for Connection Detection.
- [x] Phase 3: Implement Session State Machine & Firestore Wiring.
- [x] Phase 4: Implement LLM Core Intelligence Layer (classification, follow-ups, memory).
- [x] Phase 5: Implement Feedback Composer with deterministic fallback report composition.
- [x] Phases 6–8: Implement Frontend Web Interface (Landing, Chat, and Feedback screens) with flat design system and API integration.
- [x] Phase 9: Hardening & Edge Cases (idempotency caching, whitespace re-prompts, forced advance, context truncation, outage simulation).
- [x] Phase 10: Final Polish & Submission Checklist (flat-design pass, relative URL audits, architecture readme update).
- [x] PS2 Bugfix & Voice Pack (Phases F1 to F9): Fixed 8-question stop, sticky question modes, duplicate diagrams, reaction clauses with memory, feedback score-threshold routing (<40 and >=60), and live question history sidebar.
- [x] LoRA Voice Adapter Pack (Phases L0 to L8): Locked scope to voice/tone adaptation using Qwen 2.5 3B / Unsloth on Colab GPU with synthetic data generation and cloud fallback.
- [x] Phase I0: Session Schema & Turn-Input Additions (server timing, detectHedging, whyChainDepth, and schema extensions).
- [x] Phase I1: Hallucination Detector (structured schema output, contrastive instructions, warning prefixes, and repeated hallucination advancement overrides).
- [x] Phase I2: Communication Confidence Detection (confidence tracking separate from correctness, user prompt hedge event metrics, and probing reaction notes).
- [x] Phase I3: \"Why?\" Recursive Loop (recursive why-probing, rootUnderstandingReached detection, and loop depth cap overrides).
- [x] Phase I4: System Design Transition (capstone trigger check on 4-turn average score >= 80, strongest topic extraction, and preferential why-loop redirects).
- [x] Phase I5: Simulated AI Interrupt (simulated mid-sentence interviewer interruption, anchoring reactions on mid-answer phrasing, and preventing consecutive interruptions).
- [x] Phase I6: Per-Question Timer & Real-World Time Comparison (server-side timing, visual running chat timers, and final feedback timing bounds comparisons).
- [x] Phase I7: Judge Mode (committed hiring decision, descriptive reasoning, and ordered evidence trail tracking strengths, gaps, recovery, and Capstones).
- [x] Phase I8: Frontend: Surfacing All of This (inline warning banners inside chat bubble, confidence/why-probe/hallucination sidebar tags, and vertical timeline verdict summary cards).
- [x] Phase I9: Full Regression Test Checklist (successful Turn 1-10 end-to-end simulated regression testing covering all features).
- [x] PS2 Settings Panel Improvements (Font/Element Size Scaling, Theme Mode, Calculator, Keyboard) & Header Redesign.











## Hackathon Specific Rules Addressed
- **AI Usage Log:** Maintained in `ai_usage_log.md`.
- **Commit History:** Small, incremental commits will be made to demonstrate ongoing development.

