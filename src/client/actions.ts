/**
 * The rewind menu's injected face: two verbs and nothing else.
 *
 * The live point list is not part of this face — it arrives through
 * `useProjection('filesnap')`. Inject carries callbacks; the framework hooks
 * carry state.
 *
 * @module
 */

import type { RewindPoint } from '../wire.ts'

/** Settled outcome of one verb, rendered inline by the menu. */
export interface RewindActionResult {
  /** Whether the operation completed. */
  readonly ok: boolean
  /** Why it did not, when it did not. */
  readonly error?: string
}

/** Injected business face of the per-message rewind control. */
export interface RewindActions {
  /**
   * Rewind to one point: fork the conversation, put the files back into the
   * fork, and open it.
   * @param point - the point under the message that was clicked.
   * @returns whether the rewind completed.
   */
  onRewind: (point: RewindPoint) => Promise<RewindActionResult>
}

/** Injected business face of the session-level header strip. */
export interface RewindHeaderActions {
  /**
   * Reverse the rewind that landed in this session.
   * @returns whether the undo completed.
   */
  onRedo: () => Promise<RewindActionResult>
  /**
   * Ask the engine what it holds and what it does not protect. The answer
   * lands in the transcript as a command row, not in this strip.
   * @returns whether the query ran.
   */
  onStatus: () => Promise<RewindActionResult>
}
