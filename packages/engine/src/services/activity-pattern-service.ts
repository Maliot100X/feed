/**
 * Activity Pattern Service
 *
 * SIMPLIFIED: Hour-based rotation to spread actors across the day.
 * Each actor is assigned to a "shift" based on their ID hash.
 * Active for 10 hours, rotating through 24 hours.
 * This ensures all 140+ actors get fair coverage without timezone complexity.
 *
 * Game day is used for daily rotation - different actors are active on different
 * game days, keeping the narrative fresh while maintaining determinism within a day.
 */

/**
 * Minimal actor interface for activity patterns (all hours are UTC).
 */
export interface ActivityActor {
  id: string;
}

/**
 * Hours each actor is active per day.
 * 10 hours = ~42% of actors active at any time = ~59 actors from 140.
 * Increased from 8 to provide more overlap between actor schedules,
 * enabling better coverage and more diverse feed content.
 * Exported for use in UI/metrics if needed.
 */
export const ACTIVE_HOURS_PER_DAY = 10;

/**
 * Simple hash function to get a number from actor ID.
 * Used to deterministically assign actors to time slots.
 */
function hashActorId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash | 0; // Force 32-bit signed truncation
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Validate that gameDay is a finite integer >= 1.
 * Throws TypeError for invalid values to prevent silent bugs from modulo on bad inputs.
 */
function validateGameDay(gameDay: number, functionName: string): void {
  if (!Number.isFinite(gameDay) || !Number.isInteger(gameDay) || gameDay < 1) {
    throw new TypeError(
      `${functionName}: gameDay must be a finite integer >= 1, got ${gameDay}`
    );
  }
}

/**
 * Get the hours an actor is active based on their ID and game day.
 * Spreads actors evenly across the 24-hour day.
 *
 * @param actorId - The actor's unique identifier
 * @param gameDay - The current game day (1-indexed from games.currentDay). Defaults to 1.
 */
export function getActorActiveHours(actorId: string, gameDay = 1): number[] {
  validateGameDay(gameDay, 'getActorActiveHours');

  // Combine actor ID hash with game day for daily rotation
  // Different actors will be active on different game days
  const startHour = (hashActorId(actorId) + gameDay) % 24;

  // Generate 10 consecutive hours (wrapping around midnight)
  const hours: number[] = [];
  for (let i = 0; i < ACTIVE_HOURS_PER_DAY; i++) {
    hours.push((startHour + i) % 24);
  }
  return hours;
}

/**
 * Check if an NPC is in their active hours right now.
 * Based on simple hour rotation from actor ID hash combined with game day.
 *
 * @param actor - The actor to check
 * @param utcHour - Current UTC hour (0-23)
 * @param gameDay - The current game day (1-indexed) for rotation. Defaults to 1.
 */
export function isActiveHour(
  actor: ActivityActor,
  utcHour: number,
  gameDay = 1
): boolean {
  if (!Number.isInteger(utcHour) || utcHour < 0 || utcHour > 23) {
    throw new TypeError(
      `isActiveHour: utcHour must be an integer 0-23, got ${utcHour}`
    );
  }
  const activeHours = getActorActiveHours(actor.id, gameDay);
  return activeHours.includes(utcHour);
}
