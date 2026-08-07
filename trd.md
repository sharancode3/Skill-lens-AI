# TRD — AI Interview Agent
**Technical Requirements & Architecture**

## 1. Stack recommendation (optimized for 42h, not for "impressiveness")
- **Backend**: Node.js + Express (or FastAPI if the team is stronger in Python — pick one, do not mix)
- **LLM**: Claude (Anthropic API) or any chat-completions-compatible model, called with **structured output** (JSON schema / tool-use) so responses are parseable every turn
- **State/DB**: Firebase Firestore — one document per interview session. No vector DB. No embeddings pipeline.
- **Frontend**: React (Vite) + Tailwind CSS, using the supplied flat-design token system verbatim
- **Hosting**: Vercel/Render for backend, Vercel/Firebase Hosting for frontend (pick whichever the team can deploy fastest — deployability > architecture purity)

### Why no vector DB
The curriculum is 31 rows of structured JSON. Semantic search over 31 rows adds latency, infra risk, and zero real benefit — a plain in-memory filter/scoring function over the JSON array is faster, deterministic, and easier to debug live at a hackathon. This is the single biggest scope-reduction decision in this build — defend it explicitly if judges ask about "RAG."

---

## 2. System components

```
┌─────────────┐      POST /api/interview       ┌──────────────────────┐
│  Frontend    │ ───────────────────────────▶ │  Interview Controller │
│  (React/Vite)│ ◀─────────────────────────── │  (Express/FastAPI)    │
└─────────────┘        {reply, done, ...}      └──────────┬───────────┘
                                                            │
                              ┌─────────────────────────────┼───────────────────────────┐
                              ▼                              ▼                            ▼
                     ┌────────────────┐          ┌────────────────────┐        ┌──────────────────┐
                     │ Topic Selector  │          │ Question/Followup   │        │ Feedback Composer │
                     │ (scoring algo)  │          │ Generator (LLM call)│        │ (LLM call + rubric)│
                     └───────┬────────┘          └──────────┬──────────┘        └─────────┬─────────┘
                             │                                │                             │
                             ▼                                ▼                             ▼
                     curriculum.json                 Firestore: sessions/{id}       Firestore: sessions/{id}
                     candidates.json                  (transcript, state)             (final feedback)
```

---

## 3. Core algorithms

### 3.1 Topic Selection & Weighting (runs once, at session start)
For a candidate with `missions[]` and `signals`, compute a **priority score** per mission to build an ordered `topicQueue`:

```
for each mission m in candidate.missions:
    if m.skipped:
        weight = 3        # gap — worth probing conceptually, gently
        difficulty = "conceptual"
    elif m.attempts >= 3:
        weight = 2.5       # struggled — good interview signal, moderate depth
        difficulty = "applied"
    elif m.attempts == 1 and m.passed:
        weight = 1.5       # strong — safe to go deep / ask "why" and trade-offs
        difficulty = "deep"
    else:
        weight = 1
        difficulty = "standard"

sort missions by weight DESC
select missions spanning >= 4 DISTINCT days, prefer spread across modules (use curriculum.json modules[].days range to avoid clustering all questions in one module)
cap topicQueue length at ~6-7 topics (8+ questions come from topics + follow-ups, not from 8 distinct topics)
```

This produces a small, ordered plan: e.g. `[Day 29 (skipped, conceptual), Day 12 (5 attempts, applied), Day 7 (1st try, deep), Day 23 (2 attempts, applied), ...]`.

**Why this matters**: it's the mechanism that makes the interview feel personalized instead of running the same 8 questions on every candidate — this is the #1 thing to demo.

### 3.2 Interview State Machine
States, stored per session in Firestore:
```
INIT → ASKING → (EVALUATING_ANSWER → FOLLOWUP | ADVANCE_TOPIC) → ... → WRAP_UP → DONE
```
- `ASKING`: system has just sent a question for `topicQueue[cursor]`.
- `EVALUATING_ANSWER`: on receiving the candidate's message, classify the answer (see 3.3) before deciding the next system action.
- `FOLLOWUP`: fired only if answer is `shallow` or `partial` **and** `followupCountForTopic < 1` (cap follow-ups per topic at 1, so the interview doesn't stall).
- `ADVANCE_TOPIC`: move `cursor++`, ask next topic's question.
- `WRAP_UP`: triggered when `questionsAsked >= 8 AND distinctDaysCovered >= 4` (min met) OR `turnCount >= hardCap (e.g. 14)`.
- `DONE`: feedback has been generated and returned; session is closed (further requests to a DONE session should return the cached feedback again, not regenerate).

### 3.3 Answer Classification (drives adaptivity — this is the "intelligence")
Before deciding follow-up vs. advance, classify the candidate's last answer along one axis, done via a single structured LLM call (not vibes):
```
classification: "strong" | "partial" | "shallow" | "off_topic"
reasoning: <short internal string, not shown to candidate>
```
Rules:
- `strong` → advance topic, optionally acknowledge briefly, no follow-up.
- `partial` → ask exactly ONE targeted follow-up that references the specific gap in their answer (e.g., "You mentioned cosine similarity — how would that break down with high-dimensional sparse vectors?").
- `shallow` → ask ONE simplifying/rephrased follow-up (give them a real second chance) — if still shallow, advance anyway (do not loop).
- `off_topic` → gently redirect once, then advance regardless of quality (never argue with the candidate).

### 3.4 Follow-up Generation
Follow-up questions are **not templated** — generate via LLM with this input contract:
```
inputs: {
  current_topic: {day, title, objectives[]},
  candidate_answer: <verbatim last message>,
  classification: <from 3.3>,
  prior_transcript_summary: <short, see 3.6>
}
output: { reply: <question text>, done: false }
```
The system prompt must explicitly instruct: *"Reference something specific the candidate said. Do not ask a generic 'can you elaborate' question."*

### 3.5 Feedback Composition (end of interview)
Single LLM call, fed the **entire transcript** + the `topicQueue` with each topic's classification outcomes:
```
output JSON: {
  summary: string (2-4 sentences, references candidate by role/level),
  strengths: string[] (tie each to a specific day/topic where they scored "strong"),
  gaps: string[] (tie each to a specific day/topic where they scored "shallow"/"partial", or a skipped mission never covered),
  next: string[] (concrete, actionable — "Revisit Day 29 (Observability): read about structured logging and trace correlation")
}
```
Rule: every bullet must be traceable to something in the transcript or candidate data — never generate generic advice.

### 3.6 Context Management (stateless LLM, stateful app)
The LLM API itself has no memory — **every call must resend full necessary context**. To keep token usage sane over a 14-turn interview:
- Store the **full transcript** in Firestore (source of truth, for the final feedback call).
- For per-turn question/follow-up generation calls, do NOT resend the full transcript — resend only:
  - candidate profile (compact form)
  - current topic + its objectives
  - last 1-2 exchanges (verbatim)
  - a running one-paragraph `interviewMemory` string, updated after each turn (see DB doc) — this is the token-reduction mechanism, analogous to the team's own "memory doc" pattern.

---

## 4. API contract (must match `technical-spec.md` exactly — do not deviate)
- `POST /api/interview`
- Start: `{sessionId, candidate}` → `{reply, done:false}`
- Turn: `{sessionId, message}` → `{reply, done:false}`
- End: `{reply, done:true, feedback:{summary, strengths[], gaps[], next[]}}`
- No auth. State keyed entirely by `sessionId`.

---

## 5. Non-functional requirements
- **Latency**: each turn should respond in <5s (single LLM call per turn in the common path; classification + follow-up can be combined into ONE structured LLM call with both fields to avoid 2x latency — see Phase prompts).
- **Resilience**: if the LLM call fails or returns malformed JSON, retry once with a stricter "return ONLY JSON" instruction; if it fails twice, fall back to a safe canned transition ("Let's move to the next topic.") rather than crashing the endpoint.
- **Determinism of contract**: `done` must be a real boolean, `feedback` must be omitted (or null) on all non-final responses, present only when `done:true`.

---

## 6. Explicit engineering decisions to be ready to defend to judges
1. No vector DB — in-memory weighted topic selection over 31 structured rows is more correct here than RAG-for-RAG's-sake.
2. Single structured LLM call per turn (classify + respond in one shot) to hit latency targets.
3. Firestore session doc as the only persistence — simple, no ORM, no schema migration overhead.
4. Hard turn cap guarantees termination — a live demo must never hang.
