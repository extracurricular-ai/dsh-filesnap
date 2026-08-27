/**
 * Marking the conversation a rewind left behind, reversibly.
 *
 * After a rewind there are two conversations holding the same history up to the
 * rewind point, and picking the wrong one is easy. The obvious fix is to
 * archive the one you left — but `ctx.workspaceRegistry` ships
 * `archiveSession` and **no unarchive**; the harness's own comments call a
 * future unarchive out as deferred work. Archiving without a way back would
 * make `/redo` leave both conversations hidden, which is worse than the
 * confusion it set out to fix.
 *
 * So the mark is a title prefix. It is visible where the choice is actually
 * made — the session list — and it is symmetric: a rewind adds it to the
 * session being left, and a redo strips it from the session being returned to.
 * Nothing is hidden, so nothing can be stranded.
 *
 * @module
 */

/**
 * The prefix a rewound-out-of conversation carries.
 *
 * A leading character rather than a suffix so it survives the truncation a
 * narrow session list applies to the tail, and one that is unlikely to open a
 * title a human typed.
 */
export const REWOUND_MARK = '↩ '

/**
 * Add the mark, unless it is already there.
 *
 * Idempotent because a session can be rewound out of more than once — a second
 * rewind from the same conversation must not stack a second prefix.
 *
 * @param title - the session's current title.
 * @returns the marked title.
 */
export function mark(title: string): string {
  return isMarked(title) ? title : `${REWOUND_MARK}${title}`
}

/**
 * Remove the mark, if it is there.
 *
 * @param title - the session's current title.
 * @returns the title without the mark.
 */
export function unmark(title: string): string {
  return isMarked(title) ? title.slice(REWOUND_MARK.length) : title
}

/**
 * Whether a title already carries the mark.
 *
 * @param title - the session's current title.
 * @returns whether it is marked.
 */
export function isMarked(title: string): boolean {
  return title.startsWith(REWOUND_MARK)
}
