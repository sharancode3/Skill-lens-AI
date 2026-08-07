# Project Architecture Decisions — Skill Labs Ai

1. **Backend Framework & Language**: We use Node.js with Express because it allows fast REST API development, has native support for asynchronous operations, and is highly deployable within the hackathon's tight timeline.
2. **LLM Provider**: We use Gemini 1.5 Flash via the Google Gemini API, which natively supports structured output (JSON schema mode) to ensure reliable turn-by-turn conversation and classification parsing.
3. **Database & State persistence**: Firebase Firestore is used exclusively to persist ephemeral session state under the `sessions/{sessionId}` collection, while static curriculum and candidate data are loaded directly into server memory at startup to minimize latency and network roundtrips.
4. **Vector Search Layer**: We implement an in-memory vector database layer (embedding all 31 curriculum day objectives at startup) using Cosine Similarity to detect semantic connection matches across candidate answers and adapt the interview dynamically.

