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

### 5. Running the Project Locally
- Follow the instructions below to run locally.

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
