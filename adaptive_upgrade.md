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
