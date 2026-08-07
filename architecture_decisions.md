# AI Interview Agent — Architecture Decisions (Skill Labs Ai)

This document details the critical architecture decisions made for the Skill Labs Ai hackathon project, covering model training, vector databases, local vs cloud LLMs, and state persistence.

---

## 1. How is the agent "trained"? (No fine-tuning, and here's why)
There is no model training in this project. What we are actually doing is **in-context learning via structured prompting** — the model's weights never change. "Training" here means three layered techniques, all happening at request-time:

1. **System-prompt role definition**: A fixed block of instructions telling the model who it is ("You are a senior technical interviewer...") and the exact rules of engagement (classification categories, follow-up limits, tone calibration). This is re-sent on every single call.
2. **Context injection (retrieval without a retriever)**: On every turn, we assemble a fresh prompt containing only the relevant slice of `curriculum.json` and `candidates.json` (the current topic's objectives, the candidate's specific signal for that topic — attempts, skipped, first-try). This is functionally "retrieval-augmented generation" in spirit, but the retrieval step is a plain dictionary/array lookup by day number, not a semantic search. This distinction is critical — we avoid using a vector DB for curriculum lookup because structured JSON lookups are deterministic and faster.
3. **Structured output constraints (function-calling / JSON schema mode)**: Instead of relying on free text, we force the model to return a fixed JSON shape (`classification`, `action`, `reply`, `updatedMemory`). This makes the agent reliable turn after turn.

Fine-tuning teaches a model a fixed style baked into weights; it cannot teach a model this specific candidate's history, because that changes per session. Baking one candidate's data into weights and then using the same weights for the next candidate is actively wrong. Context injection is the correct architecture for a personalization problem.

---

## 2. Vector databases: how we use one as a differentiator
A vector database stores embeddings — numeric representations of text such that semantically similar text ends up numerically close together — and lets you query "find me the K most similar chunks to this query" via cosine similarity.

We use a vector database layer, but **only for a problem that is actually semantic**, not for the exact-lookup problem Phase 1 solves (which remains an $O(1)$ key lookup by day number):

- **Cross-Curriculum Connection Detection**: The candidate's pre-selected queue only covers 5–7 days. However, a candidate's free-text response to one topic can reveal understanding or gaps spanning other days never explicitly queued. A plain day-number lookup cannot detect that. By embedding all 31 days' objectives at startup and storing them as vectors, we can perform a similarity search using the candidate's response to detect matches across the entire curriculum. This allows the interviewer to adapt to topics they did not anticipate.
- **In-Memory Vector Search**: We do not need a hosted vector DB service (like Pinecone or pgvector). 31 days × a few objectives is small enough to embed once at startup, hold as in-memory vector arrays, and compute cosine similarity directly in JavaScript. This delivers the architectural benefit of a vector search layer without latency and infrastructure overhead.

---


## 3. Local vs Cloud LLM
We evaluate the options as follows:

| Criteria | Local (Ollama + Gemma 3 4B / Qwen 2.5 3B) | Cloud API (Gemini Flash / Claude / OpenAI) |
|---|---|---|
| **Cost** | Free | Free-tier sufficient for hackathon |
| **Reliability** | Risky (ngrok tunnel, local machine runtime) | High uptime |
| **Structured Output** | Weaker schema adherence | Native function-calling (highly reliable) |
| **Latency** | Hardware dependent | Consistently fast |
| **Reasoning Quality** | Weaker at 3B-4B scale | Much stronger (critical for adaptivity criteria) |

**Decision**: Use a **Cloud API** (Gemini Flash / Claude) for the deployed and judged version. Structured JSON output reliability and high reasoning quality are critical for Phase 4/5. Local Ollama may be used for local testing to preserve API limits, but the production endpoint will call a cloud model.

---

## 4. Firebase / Firestore: what goes in DB vs memory
- **Static reference data** (`curriculum.json`, `candidates.json`) → Loaded once at server startup into in-memory lookup maps. Network round-trips to Firestore for fixed data is unnecessary overhead.
- **Dynamic session state** (live interview) → Firestore, one document per sessionId at `sessions/{sessionId}`. This survives server process restarts and allows session recovery.

This split keeps our data access fast, doesn't require relational joins, and maps 1:1 onto Firestore's document model.

---

## 5. Computerized Adaptive Testing (CAT) & Scaling Design
In psychometrics, high-stakes adaptive testing (e.g. GRE, GMAT) is governed by **Item Response Theory (IRT)**. Under IRT, each question (item) has pre-calibrated parameters (difficulty, discrimination, guessing factor) calculated mathematically by testing the items on thousands of historical participants before the real test is ever run.

For a 48-hour hackathon, attempting to build a true IRT engine would be a major architectural mistake:
1. **No Calibration Data**: We do not have thousands of historical candidate attempts to calibrate questions. Without calibration parameters, IRT formulas collapse.
2. **Synthetic Constraints**: In a hackathon presentation, judges need to see difficulty adapt in real-time within a small 8-10 turn window.

### Sized-to-Hackathon CAT Implementation
Instead of IRT, we built a **Rolling Performance Window & Discrete Difficulty Tiers** model:
- **Performance Window**: Tracks the candidate's last 2 final blended accuracy scores (llm confidence + semantic similarity + concept coverage). A 2-turn window ensures rapid responsiveness to performance spikes or dips, which is ideal for short demo presentations.
- **Difficulty Tiers**: Translates scores into four tiers (`foundational` $\rightarrow$ `standard` $\rightarrow$ `applied` $\rightarrow$ `expert`).
  - **Escalation Trigger**: Consecutive scores $\geq 85$ escalate the tier and unlock advanced diagram-critique/Mermaid question formats.
  - **De-escalation Trigger**: Any score $< 40$ drops the tier and presents MCQs to keep struggling candidates engaged without stalling.
- **Tone Calibration**: Direct, terse system-prompt instructions enforce realistic interviewer tone and keep turn lengths under 3 sentences to mimic a real coding session.

