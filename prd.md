# PRD — AI Interview Agent
**Hackathon build · 42 hours · Team scope doc**

## 1. Problem
Learners finish a 31-day AI Cohort but struggle to *articulate* what they built and why. We need an agent that runs a realistic, adaptive, multi-turn technical interview grounded in each candidate's actual learning path (missions passed, skipped, retried) and produces structured, actionable feedback.

## 2. Goal (what "done" looks like in 42h)
A working web app where:
1. A candidate is selected (or auto-loaded via `candidate.json`).
2. The agent conducts a live, conversational interview over `POST /api/interview`, asking **≥8 questions across ≥4 distinct curriculum days**, with real follow-ups driven by what the candidate just said.
3. At the end, the agent returns structured feedback (`summary`, `strengths`, `gaps`, `next`).
4. The whole thing is wrapped in a clean flat-design UI (chat interview screen + feedback report screen).

## 3. Non-goals (explicitly out of scope — do not build these)
- Voice interaction
- Login / auth / user accounts
- Persistent history across sessions (session state only needs to live for the duration of one interview)
- Mobile app
- A real vector database (curriculum is 31 rows — no embedding infra needed; see TRD for why in-memory scoring beats a vector DB here)

## 4. Users
- **Candidate**: the person being interviewed. Wants a fair, relevant, non-repetitive interview that reflects what they actually did.
- **Evaluator (hackathon judge)**: wants to see adaptivity, multi-turn context retention, and a legible feedback artifact.

## 5. Core user story
> "As a candidate who passed Day 7 (Embeddings) on the first try but skipped Day 29 (Observability), I want the interviewer to ask me a confident, slightly deeper question on embeddings, and either skip observability or ask a gentler conceptual question about it — not treat every topic identically."

## 6. Functional requirements

| # | Requirement | Priority |
|---|---|---|
| F1 | Expose `POST /api/interview`, stateful via `sessionId`, matching `technical-spec.md` exactly | P0 |
| F2 | On session start, load the candidate's `member` + `missions` + `signals` and select an interview plan (topic queue) | P0 |
| F3 | Ask a minimum of 8 questions spanning at least 4 distinct curriculum days | P0 |
| F4 | Generate at least one genuine follow-up question per weak/partial answer, referencing what the candidate actually said | P0 |
| F5 | Maintain full conversational context turn-to-turn within a session | P0 |
| F6 | Adapt difficulty/topic selection using candidate signals (attempts, skipped, commitDays, missionsFirstTry) | P1 |
| F7 | End interview and return structured feedback (`summary`, `strengths[]`, `gaps[]`, `next[]`) | P0 |
| F8 | Frontend: chat-style interview UI + a feedback report screen, both in the supplied flat-design system | P0 |
| F9 | Graceful handling of short/evasive/off-topic answers (probe once, then move on — don't loop forever) | P1 |
| F10 | Interview time-boxing: cap total turns so an interview always terminates (e.g., max ~14 exchanges) | P1 |

## 7. Success metrics (for demo)
- Interview reliably completes in <15 turns without crashing.
- Judge can visibly see a follow-up that references a specific prior answer (proves "context," not scripted Q&A).
- Feedback output is specific to the candidate's actual weak days (e.g., mentions Day 29 if skipped), not generic filler.
- UI strictly matches the flat design tokens (no shadows, no gradients-on-elements, Outfit font, bold color blocks).

## 8. Constraints
- 42-hour build window → bias toward a **small, provably-working slice** over broad, half-working features.
- Any LLM/framework/DB allowed; team is using **Firebase (Firestore)** for session persistence, not a vector DB.
- Must match the exact request/response JSON shapes in `technical-spec.md` — this is graded directly.

## 9. Risks & mitigations
| Risk | Mitigation |
|---|---|
| LLM rambles / breaks JSON contract | Force structured output (JSON mode / tool-call schema) on every turn, validate + retry once before falling back to a template response |
| Interview never ends | Hard turn cap + explicit "wrap-up" state that always fires `done:true` |
| Follow-ups feel scripted | Feed the LLM the candidate's last answer verbatim + a rubric ("is this shallow/correct/deep?") before deciding to follow up or move on |
| Time runs out before UI is polished | Build backend + a bare HTML chat first, prove the contract works with curl, then layer the flat-design UI |
