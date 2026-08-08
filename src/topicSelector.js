import { getEnrichedCandidate } from './dataManager.js';

/**
 * Deterministically constructs a topic queue for a candidate's technical interview.
 * Uses priority scoring (weighting) and greedy selection with module-diversity
 * tie-breaking to choose 5 to 7 topics covering at least 4 distinct days.
 * 
 * @param {Object} candidate - The candidate object.
 * @returns {Array} List of selected topic queue entries.
 */
export function buildTopicQueue(candidate) {
  if (!candidate || !candidate.member || !candidate.member.id) {
    return [];
  }

  // Retrieve enriched candidate missions from Phase 1 data manager
  const enrichedMissions = getEnrichedCandidate(candidate.member.id);
  if (!enrichedMissions) {
    return [];
  }

  // 1. Calculate weights and difficulty levels
  const processedMissions = enrichedMissions.map(m => {
    let weight = 1.0;
    let difficulty = "standard";

    if (m.skipped) {
      weight = 3.0;
      difficulty = "conceptual";
    } else if (m.attempts >= 3) {
      weight = 2.5;
      difficulty = "applied";
    } else if (m.attempts === 1 && m.passed) {
      weight = 1.5;
      difficulty = "deep";
    } else {
      weight = 1.0;
      difficulty = "standard";
    }

    return {
      ...m,
      weight,
      difficulty
    };
  });

  const queue = [];
  let remaining = [...processedMissions];

  // 2. Greedily select topics under constraints
  while (true) {
    const distinctDays = new Set(queue.map(q => q.day));

    // Stopping criteria (Part E: Guarantee at least 8 topics in queue covering at least 4 distinct days):
    if (queue.length >= 10) {
      break;
    }
    if (queue.length >= 8 && distinctDays.size >= 4) {
      break;
    }
    if (remaining.length === 0) {
      break;
    }

    // Find the maximum weight among remaining missions
    let maxWeight = -1;
    for (const m of remaining) {
      if (m.weight > maxWeight) {
        maxWeight = m.weight;
      }
    }

    // Gather all remaining missions with that maximum weight
    const candidatesForSelection = remaining.filter(m => m.weight === maxWeight);

    // Dynamic tie-breaker:
    // "when two candidate missions have equal weight, prefer whichever belongs to a module not yet represented in the queue so far"
    const representedModules = new Set(
      queue.map(q => q.module?.number).filter(num => num !== undefined)
    );

    const unrepresentedGroup = [];
    const representedGroup = [];

    for (const m of candidatesForSelection) {
      const modNum = m.module?.number;
      if (modNum !== undefined && !representedModules.has(modNum)) {
        unrepresentedGroup.push(m);
      } else {
        representedGroup.push(m);
      }
    }

    // Choose preferred group: prefer unrepresented modules
    const preferredGroup = unrepresentedGroup.length > 0 ? unrepresentedGroup : representedGroup;

    // Deterministic ordering: sort by day number ascending if a tie still exists
    preferredGroup.sort((a, b) => a.day - b.day);

    const selectedMission = preferredGroup[0];

    // Add to queue
    queue.push({
      day: selectedMission.day,
      title: selectedMission.dayTitle,
      objectives: selectedMission.objectives,
      difficulty: selectedMission.difficulty,
      status: 'pending',
      module: selectedMission.module
    });

    // Remove the selected mission's day number from remaining to prevent duplicate days
    remaining = remaining.filter(m => m.day !== selectedMission.day);
  }

  // 3. Post-selection warning log for sparse data
  const finalDistinctDays = new Set(queue.map(q => q.day));
  if (finalDistinctDays.size < 4) {
    console.warn(
      `[Topic Selection Warning] Candidate "${candidate.member.id}" has sparse data with only ${finalDistinctDays.size} distinct days.`
    );
  }

  return queue;
}
