# Project Memory Document

This document is maintained to help AI models understand the current state of the project without needing to analyze the entire codebase every time.

## Project Overview
- **Name:** Skill Labs Ai
- **Goal:** Build an adaptive, multi-turn AI technical interview agent that assesses candidates based on their learning path and generates feedback.
- **Tech Stack:** Node.js/Express (Backend), React/Vite/Tailwind (Frontend), Firebase Firestore (Session DB)


## Current State
- Configured Git repository with remote tracking pointing to `https://github.com/sharancode3/Skill-lens-AI.git`.
- Saved design guidelines, database design, PRD, TRD, UI application notes, and workflow phases.
- Pre-scaffolding documentation phase completed.


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
- `src/firebase.js`: Firebase Firestore connection and startup health check.
- `src/server.js`: Node.js Express server defining interview endpoint routes.


## Ongoing Tasks
- [ ] Complete Phase 2.5: Set up in-memory vector embeddings for cross-curriculum Connection Detection.


## Completed Tasks
- [x] Initial repository setup.
- [x] Saved all design, requirements, database, and workflow documents.
- [x] Phase 0: Express skeleton + contract with Firebase Admin healthcheck.
- [x] Phase 1: Reference Data Loading (curriculum and candidates), index maps, validation pass, and candidate enrichment helper.
- [x] Phase 2: Implement the Topic Queue Selection Scoring algorithm.



## Hackathon Specific Rules Addressed
- **AI Usage Log:** Maintained in `ai_usage_log.md`.
- **Commit History:** Small, incremental commits will be made to demonstrate ongoing development.

