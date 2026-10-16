/**
 * Fixed waits the agent uses between its own steps. Each name says why the wait exists, so the
 * numbers are no longer anonymous. The values are unchanged from the literals they replace.
 */

/** After a click, before keys: lets the field take focus. */
export const FOCUS_SETTLE_MS = 420
/** Built-in: if a target is missing, wait, rescan the whole screen, try once more. */
export const REFRESH_RETRY_MS = 3000
/** After an action, before the reaction screen is read. */
export const REACTION_SETTLE_MS = 900
/** Page still loading after an action: wait, then look again. */
export const LOADING_RECHECK_MS = 2000
/** The next item is not visible yet: wait once before deciding. */
export const NEXT_ITEM_WAIT_MS = 2500
/** After typing, before Enter is sent. */
export const ENTER_GAP_MS = 240
/** Screen is locked: poll the lock state this often. */
export const LOCK_POLL_MS = 5000
/** Screen just unlocked: let the desktop settle before continuing. */
export const UNLOCK_SETTLE_MS = 1500
