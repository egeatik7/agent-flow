/**
 * Which engine events are allowed to reach the window while a run is going on.
 *
 * A branch test runs the *derived* flow, but its node ids are the base flow's ids. So every event
 * that carries a node id would be taken by the canvas for its own node: steps would light up the
 * user's nodes and move their loop ticks, and patches - learned memory, the proven path, the last
 * trace - would be written into the user's flow and saved with it. Trying a suggestion must change
 * nothing but the suggestion.
 *
 * This lives on its own, away from Electron, so the rule can be tested directly; it was found the
 * hard way when only the step events were held back and the patches were not.
 */
export function windowEventAllowed(channel: string, derived: boolean): boolean {
  if (!derived) return true
  return channel !== 'agent:step' && channel !== 'agent:patch' && channel !== 'agent:edge'
}
