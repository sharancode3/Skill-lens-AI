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
