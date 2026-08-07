# Skill Labs Ai
**AI Interview Agent — Hackathon Submission**

Skill Labs Ai runs a realistic, adaptive, multi-turn technical interview grounded in each candidate's actual learning path (missions passed, skipped, retried) and produces structured, actionable feedback.


## Hackathon Verification Links
- **Repository URL**: [https://github.com/sharancode3/Skill-lens-AI](https://github.com/sharancode3/Skill-lens-AI)
- **Live Demo**: [Will be updated when deployed]
- **AI Usage Log**: [ai_usage_log.md](file:///c:/SHARAN%20PROJECTS/Abtalks%20Vicode/ai_usage_log.md)

## Reference Documents
- **Project Memory Document**: [project_memory.md](file:///c:/SHARAN%20PROJECTS/Abtalks%20Vicode/project_memory.md) (used to maintain state across models/sessions)
- **Product Requirements Document (PRD)**: [prd.md](file:///c:/SHARAN%20PROJECTS/Abtalks%20Vicode/prd.md)
- **Technical Requirements Document (TRD)**: [trd.md](file:///c:/SHARAN%20PROJECTS/Abtalks%20Vicode/trd.md)
- **Database Design**: [db_design.md](file:///c:/SHARAN%20PROJECTS/Abtalks%20Vicode/db_design.md)
- **UI Application Notes**: [ui_notes.md](file:///c:/SHARAN%20PROJECTS/Abtalks%20Vicode/ui_notes.md)
- **Design System Spec (Flat Design)**: [design_system.md](file:///c:/SHARAN%20PROJECTS/Abtalks%20Vicode/design_system.md)
- **Development Workflow & Phases**: [workflow.md](file:///c:/SHARAN%20PROJECTS/Abtalks%20Vicode/workflow.md)

## Setup and Running Instructions

### Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm run dev
   ```

### API Testing Curl Commands
You can verify the `/api/interview` contract using these curl commands (replace `http://localhost:3000` with the deployed API URL when testing the production deploy):

**1. Session Start (Initial Welcome Message)**
```bash
curl -X POST http://localhost:3000/api/interview \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-12345", "candidate": {"id": "CAND-001", "name": "Sarah Johnson", "jobRole": "Senior Data Engineer", "yearsExperience": 9}}'
```

**2. Conversation Turn (Answer & Follow-up)**
```bash
curl -X POST http://localhost:3000/api/interview \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-12345", "message": "I built custom vector retrieval pipelines for search."}'
```

**3. Terminal Turn (End of Interview & Structured Feedback)**
Run the conversation turn two more times. On the third turn, it terminates and returns the feedback shape:
```bash
curl -X POST http://localhost:3000/api/interview \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-12345", "message": "Yes, I also monitored latency and logs."}'
```

