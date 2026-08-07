# AI Interview Agent — Adaptive Intelligence Upgrade Pack
**Part A.1 — Blended Numeric Accuracy Scoring**

This document tracks the adaptive intelligence requirements layered on top of the core specifications.

## 1. Blended Numeric Accuracy Scoring (0–100)
Instead of relying solely on a 4-bucket classification (strong | partial | shallow | off_topic), the interview agent computes a blended, multi-signal accuracy score (0–100) on every turn:

$$\text{finalAccuracyScore} = \text{round}(0.5 \times \text{llmConfidence} + 0.3 \times \text{semanticSimilarityScore} + 0.2 \times \text{conceptCoverageScore})$$

### The Three Independent Signals:
1. **LLM-judged confidence (0–100)**: The model's own calibrated score of correctness and depth, returned as an extra field in the structured turn evaluation schema.
2. **Semantic similarity to the day's objectives (0–100)**: Compute the cosine similarity between the candidate's embedded answer and the embedding vector for the current day's objectives. Linear-remap the raw cosine value (typically 0.3 to 0.9) to a 0–100 scale.
3. **Concept coverage (0–100)**: Precompute a short list of 3–5 key concept terms/phrases for each curriculum day once at startup. Loose match checking:
   $$\text{conceptCoverageScore} = \frac{\text{Number of terms loosely matched in candidate answer}}{\text{Total precomputed terms for the day}} \times 100$$

## 2. Adaptive Difficulty Tiers & Recency Window
Instead of static topics, the session state maintains:
- `recentScores`: Array of the last 2 `finalAccuracyScore` values in the session.
- `difficultyTier`: One of `foundational` | `standard` | `applied` | `expert`.

### Transition Rules:
1. **Escalation**: If both of the last 2 scores are $\geq 85$, increase `difficultyTier` by one step (cap at `expert`). This unlocks **Diagram/Graph Interpretation** type questions.
2. **De-escalation**: If either of the last 2 scores is $< 40$, decrease `difficultyTier` by one step (floor at `foundational`). This triggers **Multiple Choice Questions (MCQ)** to keep the candidate engaged and gather signal.
3. **Otherwise**: The tier remains unchanged, and the system continues with normal open-ended questions.

## 3. Interviewer Tone Calibration & Prompts
To make the agent sound like a realistic technical interviewer and prevent standard friendly-assistant AI drift:
- **Banned Phrase List**: Banned phrases include `"great question"`, `"that's a fascinating point"`, `"as an AI"`, `"I'd be happy to"`, `"let's dive into"`, and repeating candidate answers back before responding.
- **Strict Brevity**: Responses must be 1–3 sentences (except when formulating diagrams/MCQs).
- **Realistic Skepticism**: Allow short, direct acknowledgments (`"Right."`, `"Okay, and—"`) and neutral pushback (`"That's part of it, but what actually triggers X?"`).
- **No Generic Praise**: Praise must be earned and reference specific correctness signals or omitted completely.
- **Few-shot examples**: The prompt must contain explicit examples of both correct interviewer tone and bad assistant tone.

# PART B — Phase Amendments & New Sub-Phases
## Amendment to Phase 3 — Session Schema Additions
Add these fields to the `sessions/{sessionId}` document created in Phase 3, alongside the existing fields:
- `recentScores`: Array of floats (keeps only the last 2 `finalAccuracyScore` values).
- `difficultyTier`: "standard" (starting tier).
- `nextQuestionType`: "open" (one of `open` | `mcq` | `diagram_interpret`).
- `pendingMCQAnswer`: Null or Integer (holds the correct option index server-side only when `nextQuestionType` is `mcq` for the current pending question — never sent to the client).
- `accuracyLog`: Array of objects (append `{day, questionType, finalAccuracyScore, llmConfidence, semanticScore, conceptScore}` every turn).

## Sub-Phase 4A — Accuracy Scoring Computation
1. **Extend Phase 4 Structured LLM Output**: Add a new required field `llmConfidence` (integer 0–100) representing the model's calibrated correctness estimate.
2. **Server-side Signal Computation**:
   - `semanticScore`: Run cosine similarity check against current topic objectives. Remap the raw score lineary to a 0–100 scale.
   - `conceptCoverageScore`: Cache 3–5 concept terms/phrases for each curriculum day once at startup. Score based on case-insensitive substring overlaps in candidate's answers.
3. **Blended Scoring**: Compute `finalAccuracyScore = round(0.5 * llmConfidence + 0.3 * semanticScore + 0.2 * conceptCoverageScore)`. Push to `recentScores` (trim to last 2) and append the breakdown to `accuracyLog`.

## Sub-Phase 4B — Adaptive Difficulty Engine
1. **Difficulty State Updates**: Call `updateDifficulty(session)` after updating `recentScores`:
   - Both of last 2 scores $\geq 85 \rightarrow$ tier up (`foundational` $\rightarrow$ `standard` $\rightarrow$ `applied` $\rightarrow$ `expert`), cap at `expert`, set `nextQuestionType = "diagram_interpret"`.
   - Either of last 2 scores $< 40 \rightarrow$ tier down, floor at `foundational`, set `nextQuestionType = "mcq"`.
   - Otherwise, tier stays same, `nextQuestionType = "open"`.
   - Requires at least 2 scores to run updates; defaults to `standard` tier and `"open"` type.
2. **Prompt Modifiers**: Inject `difficultyTier` into prompt instructions:
   - `foundational`: Stick close to the literal objective text.
   - `standard`: Ask "how" or "why", not just "what".
   - `applied`: Ask about a concrete scenario or architectural trade-off.
   - `expert`: Ask to critique design choices or compare two different implementations.
