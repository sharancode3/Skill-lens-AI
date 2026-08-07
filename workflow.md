# Overall Workflow — AI Interview Agent
**Detailed End-to-End Lifecycle and Team Build Schedule**

## A. End-to-end request lifecycle

```
1. Frontend generates a sessionId (uuid) when candidate starts.
2. POST /api/interview { sessionId, candidate } 
      → backend builds topicQueue (Topic Selection algo, TRD 3.1)
      → backend writes sessions/{sessionId} to Firestore (state=ASKING, cursor=0)
      → backend calls LLM to phrase the FIRST question for topicQueue[0]
      → responds { reply: "<question>", done: false }

3. Frontend renders reply as chat bubble, shows input box.

4. Candidate types answer → POST /api/interview { sessionId, message }
      → backend loads session doc from Firestore
      → backend calls LLM ONCE with: current topic, candidate's message, last exchange, interviewMemory
          → LLM returns { classification, reply, action: "followup"|"advance"|"wrapup" }
      → backend updates Firestore: transcript.push(...), interviewMemory = updated summary,
        questionsAsked++, cursor updated per action
      → responds { reply: "<next question or followup>", done: false }

5. Repeat step 4 until stopping condition met:
        questionsAsked >= 8 AND distinctDaysCovered >= 4   → normal completion
        OR turnCount >= HARD_CAP                             → forced completion

6. On stopping condition:
      → backend calls Feedback Composer (TRD 3.5) with full transcript from Firestore
      → backend writes feedback to sessions/{sessionId}.feedback, state=DONE
      → responds { reply: "Interview completed.", done: true, feedback: {...} }

7. Frontend detects done:true → navigates to Feedback Report screen, renders feedback.
```

---

## B. Team build workflow (how to actually use this doc set in 42h)

1. **Hour 0–1**: Read PRD + TRD together as a team. Agree on stack (do NOT debate mid-build). Assign: 1 person backend/state machine, 1 person LLM prompt/algorithm layer, 1 person frontend/UI, 1 person Firestore + integration/deploy. If solo, follow the phases below in order — do not parallelize prematurely.
2. **Hour 1–3 (Phase 1)**: Stand up the Express/FastAPI skeleton + Firestore connection + the exact `/api/interview` contract with a hardcoded canned reply. Get `done:true` + feedback shape working with fake data FIRST. This proves the contract before any intelligence is added — deploy it immediately so there's always something working.
3. **Hour 3–6 (Phase 2)**: Implement the Topic Selection algorithm (pure function, unit-testable with `candidates.json` + `curriculum.json`, no LLM needed yet). Verify with console logs that it produces sane, spread-out topic queues for several different candidate profiles.
4. **Hour 6–10 (Phase 3)**: Wire in the LLM for question phrasing + answer classification + follow-up decision as ONE structured call. Test with curl/Postman manually stepping through a full interview.
5. **Hour 10–13 (Phase 4)**: Implement Feedback Composer + wrap-up trigger + hard cap. Run 2-3 full simulated interviews end-to-end via curl.
6. **Hour 13–15**: Freeze backend contract. Everything downstream (frontend) treats the API as fixed.
7. **Hour 15–24 (Phase 5)**: Build frontend — Landing/candidate load → Chat Interview screen → Feedback Report screen, in the flat design system. Wire to the real API.
8. **Hour 24–30**: Polish adaptivity — tune prompts so follow-ups visibly reference prior answers; tune feedback specificity.
9. **Hour 30–36**: Edge cases — empty answers, very long answers, off-topic answers, network retry, malformed LLM JSON fallback.
10. **Hour 36–40**: UI polish pass against the design system checklist (no shadows, hover scale states, Outfit font, color blocking). Record demo video/script.
11. **Hour 40–42**: Deploy freeze, README, submission checklist against `technical-spec.md`.

---

## C. Update-the-memory-doc habit (why + how)
Every time a phase finishes, update `project_memory.md` with: what's built, current file locations, the exact request/response shapes actually implemented, and open TODOs. When prompting an AI coding assistant for the NEXT phase, paste the memory doc instead of re-explaining the whole system — this is the single biggest token-usage lever in a 42h AI-assisted build.
