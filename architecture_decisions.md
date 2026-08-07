# AI Interview Agent — Architecture Decisions

This document details the critical architecture decisions made for the AI Interview Agent hackathon project, covering model training, vector databases, local vs cloud LLMs, and state persistence.

---

## 1. How is the agent "trained"? (No fine-tuning, and here's why)
There is no model training in this project. What we are actually doing is **in-context learning via structured prompting** — the model's weights never change. "Training" here means three layered techniques, all happening at request-time:

1. **System-prompt role definition**: A fixed block of instructions telling the model who it is ("You are a senior technical interviewer...") and the exact rules of engagement (classification categories, follow-up limits, tone calibration). This is re-sent on every single call.
2. **Context injection (retrieval without a retriever)**: On every turn, we assemble a fresh prompt containing only the relevant slice of `curriculum.json` and `candidates.json` (the current topic's objectives, the candidate's specific signal for that topic — attempts, skipped, first-try). This is functionally "retrieval-augmented generation" in spirit, but the retrieval step is a plain dictionary/array lookup by day number, not a semantic search. This distinction is critical — we avoid using a vector DB because structured JSON lookups are deterministic and faster.
3. **Structured output constraints (function-calling / JSON schema mode)**: Instead of relying on free text, we force the model to return a fixed JSON shape (`classification`, `action`, `reply`, `updatedMemory`). This makes the agent reliable turn after turn.

Fine-tuning teaches a model a fixed style baked into weights; it cannot teach a model this specific candidate's history, because that changes per session. Baking one candidate's data into weights and then using the same weights for the next candidate is actively wrong. Context injection is the correct architecture for a personalization problem.

---

## 2. Vector databases: the concept, and why this project (mostly) doesn't need one
A vector database stores embeddings — numeric representations of text such that semantically similar text ends up numerically close together — and lets you query "find me the K most similar chunks to this query" via cosine similarity. It exists to solve one problem: searching large, unstructured text corpora where you don't know in advance which document is relevant.

Our data doesn't have that problem:
- `curriculum.json` has exactly 31 days, each with a known day number. If we need Day 12's objectives, we look it up directly via day number (e.g., `{"day": 12}`). This is an exact key lookup, $O(1)$, zero ambiguity, zero embedding cost, zero latency, and zero chance of retrieving the wrong day.
- `candidates.json` is the same story — we look up by `candidateId`.

Therefore, we do not build a vector DB for retrieving curriculum or candidate data. Structured JSON lookups are strictly better here — faster, deterministic, and easier to debug under time pressure.

### Optional Semantic Answer Matching (Nice-to-Have):
To show technical range if time allows, we could embed the candidate's answer and the day's stated learning objectives, then use cosine similarity as a secondary signal fed into the LLM classification prompt. Even if we do this, we do not need a hosted vector DB service. 31 curriculum days is small enough to hold all embeddings in memory as plain arrays and compute cosine similarity in JavaScript/Python — no hosted Pinecone/Weaviate needed.

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
