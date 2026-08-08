# Skill Labs Ai
**Adaptive, Multi-Turn AI Technical Interview Agent**

Skill Labs Ai is an adaptive technical interview portal that dynamically evaluates engineering candidates based on their actual course histories (passed, skipped, or retried missions) and builds custom interview tracks, culminating in detailed, structured JSON feedback.

---

## 🎯 Architecture Decisions

### 1. Storage Strategy: Firestore Sessions vs. In-Memory Static Data (A.4)
- **Session State (Firestore)**: Session state is highly dynamic, multi-turn, and requires persistence across requests. Firestore provides a reliable document store matching the JSON state-schema. If Firestore becomes unreachable, the server automatically degrades gracefully to an in-memory cache fallback to guarantee uptime.
- **Reference Data (In-Memory)**: Curriculum details (`curriculum.json`) and candidate spreadsheets (`candidates.json`) are immutable reference schemas. Loading them once at process startup into optimized O(1) in-memory maps avoids redundant database network I/O, eliminating cold-start delays.

### 2. Retrieval Strategy: Why No Vector Database? (A.2)
- **Course Metadata**: The curriculum consists of exactly 31 curriculum days. Setting up a dedicated cloud vector database pipeline for a dataset of 31 items is a classic case of unnecessary engineering overhead.
- **In-Memory Semantic Matcher**: Instead of an external vector store, we load TF-IDF keyword overlap weights and cosine similarity matrices directly in memory at process start. When a candidate answers a question, we run cosine similarity on the vocabulary vectors to discover cross-curriculum connection touchpoints.

### 3. Adaptive Interview Flow & Follow-Up Logic (A.1)
- **Deterministic Queue Selection**: At session start, the candidate's learning history is processed. Highest weights are assigned to skipped days (gaps to probe) and high-attempt days (areas of friction).
- **Turn Classifications**: Every answer is classified by the LLM as `strong`, `partial`, `shallow`, or `off_topic`.
- **FSM Transitions**:
  - `strong` or `off_topic` response → Advance cursor to next topic.
  - `partial` or `shallow` response → Trigger a contextual `followup` turn.
  - **Override Constraint**: If a follow-up has already been issued for the current topic, the server overrides any further follow-up requests and forces an advance, preventing infinite loops.

### 4. LLM Provider Choice (A.3)
- **Google Gemini 1.5 Flash**: Selected for its fast response latency, native support for JSON schema enforcement (JSON mode via `responseSchema`), and cost efficiency.
- **Offline Mock Simulation**: If the Gemini API key is missing or fails twice, the system switches to an offline evaluator that calculates classification overlays and produces mechanical feedback reports.

### 5. LoRA Voice Adaptation & Dual-Tier Intelligence Architecture (Phase L0–L8)
- **Fine-Tuning Scope**: We fine-tune a local open-weight model (**Qwen 2.5 3B**) to produce the natural two-part *"reaction clause + technical follow-up"* interviewer voice. We deliberately do **not** route classification, scoring rubrics, or structured JSON schema validation through the 3B model, as a 3B model under time constraints is prone to JSON schema degradation.
- **Data Provenance**: The training dataset is **100% self-distilled and synthetic**. We systematically generated 370+ labeled training pairs across all 31 days in `curriculum.json` (weighted across strong, partial, shallow, off-topic, and explicit non-answers) plus 50 supplementary MCQ/diagram transitions using our cloud model with strict voice rubrics. No external or scraped internet data was used.
- **PEFT / QLoRA Configuration**: Built using **Unsloth** in 4-bit precision with a modest rank ($r=16, \alpha=16, \text{lr}=2\times 10^{-4}$, 0% dropout). A narrow rank is mathematically optimal for narrow style/tone adaptation without overfitting or injecting hallucinations.
- **Zero-Downtime Fallback Architecture**: The local model is integrated as an optional swap-in via `generateLocalLoRAReply` in `src/llmClient.js`. It is guarded by an automated 3-second timeout and try/catch block that falls back to cloud few-shot generation if Ollama is slow or offline, ensuring local model hosting is never a single point of failure during live judged evaluations.

---

## 📂 Reference Documents
- **Project Memory**: [project_memory.md](project_memory.md)
- **Product Requirements (PRD)**: [prd.md](prd.md)
- **Technical Requirements (TRD)**: [trd.md](trd.md)
- **Database Design**: [db_design.md](db_design.md)
- **UI Design System**: [design_system.md](design_system.md)

---

## 🚀 Setup & Local Running

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key_here
   # Optional Firestore Service Account:
   # FIREBASE_SERVICE_ACCOUNT=base64_or_json_string
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to access the technical portal.

---

## 🧪 Integration Testing Curl Commands

### 1. Initialize Interview
```bash
curl -X POST http://localhost:3000/api/interview \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-test-100", "candidate": {"member": {"id": "CAND-001", "name": "Sarah Johnson", "jobRole": "Senior Data Engineer", "yearsExperience": 9}}}'
```

### 2. Submit Technical Response
```bash
curl -X POST http://localhost:3000/api/interview \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-test-100", "message": "I configure Winston logs and stream them to Elasticsearch."}'
```

---

## 🛡️ Proctoring & Integrity Limits (Phases E3 - E6)

### Screenshot Deterrent Limitations (Phase E6)
- **What is covered**: Interception of the physical `PrintScreen` key press on Windows systems, triggering an immediate proctoring suspension.
- **What is NOT covered**: Out-of-browser snipping tools (such as Windows Snipping Tool `Win+Shift+S`, macOS `Cmd+Shift+3/4/5`), third-party screenshot software, OS-level screen recorders, or external device photography (taking pictures with a phone).
- **Rationale**: Web browsers run in a secure sandbox that does not expose system-level capture APIs. True 100% screenshot prevention requires system-level kernel/device driver hooks (e.g., kiosk-mode or lockdown browsers). This best-effort implementation acts as a software-level deterrent.

