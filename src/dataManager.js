import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory data structures
export const daysByNumber = new Map();
export const modulesByDay = new Map();
export const candidatesById = new Map();

/**
 * Initializes the data manager by reading the static JSON files,
 * precomputing the O(1) lookup structures, and running validation.
 */
export function initializeData() {
  try {
    // Resolve paths to the root folder where the JSON files are located
    const curriculumPath = path.resolve(__dirname, '../curriculum.json');
    const candidatesPath = path.resolve(__dirname, '../candidates.json');

    console.log(`[DataManager] Loading curriculum from: ${curriculumPath}`);
    console.log(`[DataManager] Loading candidates from: ${candidatesPath}`);

    const curriculumData = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));
    const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

    // 1. Populate modulesByDay
    if (curriculumData.modules && Array.isArray(curriculumData.modules)) {
      for (const mod of curriculumData.modules) {
        if (mod.days && Array.isArray(mod.days) && mod.days.length === 2) {
          const startDay = mod.days[0];
          const endDay = mod.days[1];
          for (let d = startDay; d <= endDay; d++) {
            modulesByDay.set(d, {
              number: mod.n,
              title: mod.title
            });
          }
        }
      }
    }

    // 2. Populate daysByNumber
    if (curriculumData.days && Array.isArray(curriculumData.days)) {
      for (const d of curriculumData.days) {
        daysByNumber.set(d.day, {
          title: d.title,
          type: d.type,
          tools: d.tools,
          objectives: d.objectives
        });
      }
    }

    // 3. Populate candidatesById
    if (candidatesData.candidates && Array.isArray(candidatesData.candidates)) {
      for (const cand of candidatesData.candidates) {
        if (cand.member && cand.member.id) {
          candidatesById.set(cand.member.id, cand);
        }
      }
    }

    console.log(`[DataManager] In-memory structures initialized:`);
    console.log(`  - Days indexed: ${daysByNumber.size}`);
    console.log(`  - Modules mapped: ${modulesByDay.size}`);
    console.log(`  - Candidates loaded: ${candidatesById.size}`);

    // 4. Perform startup validation pass
    runStartupValidation(candidatesData.candidates);

  } catch (error) {
    console.error('[DataManager] Initialization failed critical error:', error);
    throw error;
  }
}

/**
 * Precomputes 3-5 concept terms/phrases for each curriculum day.
 * Uses Gemini API if available, otherwise falls back to local tool/objective keyword list.
 */
export async function precomputeConceptTerms() {
  const apiKey = process.env.GEMINI_API_KEY;
  const simulateOutage = process.env.SIMULATE_LLM_OUTAGE === 'true';

  console.log('[DataManager] Precomputing concept terms for curriculum...');

  // Helper for programmatic fallback
  function localExtract(dayNum, dayData) {
    const terms = [...(dayData.tools || [])];
    if (terms.length > 5) {
      return terms.slice(0, 5);
    }
    if (terms.length < 3) {
      const text = `${dayData.title} ${dayData.objectives.join(' ')}`.toLowerCase();
      const techPhrases = [
        'vector database', 'embeddings', 'rag', 'llm', 'ollama', 'prompt engineering',
        'agentic', 'mcp', 'flowchart', 'sequence diagram', 'monitoring', 'observability',
        'evaluation', 'deployment', 'virtual environment', 'docker', 'kubernetes',
        'fastapi', 'react', 'github', 'state machine', 'fine-tuning', 'in-context learning',
        'structured output', 'langchain', 'llama-index', 'semantic search', 'cosine similarity'
      ];
      for (const phrase of techPhrases) {
        if (text.includes(phrase) && !terms.some(t => t.toLowerCase() === phrase)) {
          terms.push(phrase);
        }
      }
    }
    // Fallback if still < 3
    if (terms.length < 3) {
      terms.push('curriculum topic');
      terms.push('learning objectives');
    }
    return terms.slice(0, 5);
  }

  // Prepopulate locally first so we always have a default
  for (const [dayNum, dayData] of daysByNumber.entries()) {
    dayData.conceptTerms = localExtract(dayNum, dayData);
  }

  if (!apiKey || simulateOutage) {
    console.log('[DataManager] Using programmatic concept terms (offline/mock mode).');
    return;
  }

  console.log('[DataManager] Calling Gemini to refine key concept terms for all days...');
  try {
    const promises = Array.from(daysByNumber.entries()).map(async ([dayNum, dayData]) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const systemPrompt = "You are a curriculum analyzer. Extract 3 to 5 key technical terms or concepts (1-3 words each) that a candidate must mention or discuss to demonstrate understanding of this day's objectives.";
      const userPrompt = `Day ${dayNum}: "${dayData.title}"\nObjectives:\n${dayData.objectives.map(o => `- ${o}`).join('\n')}`;

      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          }
        }
      };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const parsed = JSON.parse(rawText.trim());
          if (Array.isArray(parsed) && parsed.length >= 3) {
            dayData.conceptTerms = parsed.slice(0, 5);
            return;
          }
        }
      } catch (err) {
        // Silent catch: falls back to the locally computed terms
      }
    });

    await Promise.all(promises);
    console.log('[DataManager] Refined concept terms with LLM.');
  } catch (error) {
    console.warn('[DataManager Warning] Gemini concept term refinement failed. Using programmatic fallbacks.', error.message);
  }
}

/**
 * Validates that every candidate mission matches a day in the curriculum.
 * Logs a warning for mismatches instead of throwing.
 */
function runStartupValidation(candidates) {
  let warningCount = 0;
  for (const cand of candidates) {
    const candidateId = cand.member?.id || 'UNKNOWN';
    if (cand.missions && Array.isArray(cand.missions)) {
      for (const mission of cand.missions) {
        if (!daysByNumber.has(mission.day)) {
          console.warn(
            `[Data Validation Warning] Candidate "${candidateId}" references day ${mission.day} which is not present in curriculum.json`
          );
          warningCount++;
        }
      }
    }
  }
  if (warningCount > 0) {
    console.log(`[DataManager] Startup validation completed with ${warningCount} warnings.`);
  } else {
    console.log('[DataManager] Startup validation completed successfully with 0 warnings.');
  }
}

/**
 * Resolves a candidate's full mission list with each mission enriched
 * with its resolved day title, objectives, and parent module.
 * 
 * @param {string} candidateId 
 * @returns {Array|null} Enriched mission list, or null if candidate not found.
 */
export function getEnrichedCandidate(candidateId) {
  const candidate = candidatesById.get(candidateId);
  if (!candidate) {
    return null;
  }

  return candidate.missions.map(mission => {
    const dayData = daysByNumber.get(mission.day);
    const moduleData = modulesByDay.get(mission.day);

    return {
      ...mission,
      dayTitle: dayData ? dayData.title : mission.title,
      objectives: dayData ? dayData.objectives : [],
      module: moduleData || null
    };
  });
}

export function getCandidateById(candidateId) {
  return candidatesById.get(candidateId) || null;
}

