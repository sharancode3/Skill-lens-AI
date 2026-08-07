# DB Design — Firebase Firestore
**Plain Document Store for Session/Interview State**

Curriculum and candidate data stay as static JSON loaded into memory at server start — they don't need to live in Firestore at all (they're read-only reference data for the hackathon).

## Why Firestore and not a vector DB
No semantic search is needed over 31 curriculum rows. Firestore is used purely to persist **interview session state** across HTTP requests, since the API is stateless per-request but the interview itself is stateful across turns.

---

## Collection: `sessions`
One document per interview, keyed by `sessionId`.

```jsonc
// sessions/{sessionId}
{
  "sessionId": "abc-123",
  "state": "ASKING",              // INIT | ASKING | WRAP_UP | DONE
  "candidate": {                   // snapshot of candidate.json at session start
    "id": "CAND-001",
    "name": "Sarah Johnson",
    "jobRole": "Senior Data Engineer",
    "yearsExperience": 9
  },
  "topicQueue": [                  // built once by the Topic Selection algorithm
    { "day": 29, "title": "Monitoring, Logging & Observability", "difficulty": "conceptual", "status": "pending" },
    { "day": 12, "title": "Prompt Engineering Fundamentals", "difficulty": "applied", "status": "pending" }
    // ...
  ],
  "cursor": 0,                     // index into topicQueue currently being asked
  "questionsAsked": 3,
  "distinctDaysCovered": [29, 12, 7],
  "turnCount": 6,
  "followupCountForCurrentTopic": 1,
  "interviewMemory": "Candidate is strong on embeddings/vector search (fast, first-try), weak on observability (skipped) and struggled with prompt eng (5 attempts). So far: gave a solid answer on cosine similarity, vague on logging correlation IDs.",
  "transcript": [
    { "role": "interviewer", "day": 29, "text": "..." , "turn": 1 },
    { "role": "candidate", "text": "...", "turn": 1, "classification": "shallow" },
    { "role": "interviewer", "day": 29, "text": "...(followup)", "turn": 2 },
    { "role": "candidate", "text": "...", "turn": 2, "classification": "partial" }
  ],
  "feedback": null,                // populated only when state === DONE
  "createdAt": "<server timestamp>",
  "updatedAt": "<server timestamp>"
}
```

---

## Field notes
- **`topicQueue`**: computed once at session start (TRD §3.1), never recomputed — keeps the interview deterministic/reproducible for debugging.
- **`interviewMemory`**: the compact, LLM-updated running summary (TRD §3.6). This is what gets sent on each per-turn LLM call instead of the full transcript — keeps token usage flat as the interview grows.
- **`transcript`**: full source of truth, only read in bulk once — at the very end, for Feedback Composition. Never resent per-turn.
- **`feedback`**: written once, on the terminal turn. If a client retries a `DONE` session (e.g. network hiccup on the client), the backend should just return the cached `feedback` again rather than recomputing.

---

## Read/write pattern per request
| Request | Firestore ops |
|---|---|
| Start (`INIT`) | 1 write (create doc) |
| Each turn | 1 read + 1 write (single doc, no queries, no joins) |
| Final turn | 1 read + 1 write (adds `feedback`, sets `state: DONE`) |

No indexes or queries across sessions are needed for the hackathon scope — every operation is a direct doc-ID read/write, which is the cheapest and fastest Firestore access pattern available.
