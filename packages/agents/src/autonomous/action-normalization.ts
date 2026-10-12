/** Normalize spelling only; never select an action from ambiguous prose. */
export function normalizeDecisionAction(action: string): string {
  return action
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}
