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
