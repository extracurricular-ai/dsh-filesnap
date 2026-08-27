/**
 * The values that cross to the browser, and nothing else.
 *
 * Kept apart from [`types.ts`](./types.ts) on purpose. That module merges into
 * `SessionEventMap`, which reaches the host's cordis `Context` — and a browser
 * program that pulled those declarations in would see the host's `ctx.sessions`
 * merged onto the same key as the client runtime's, so `sessions.open` would
 * stop existing and `sessions.fork` would take the wrong argument. The
 * projection seam names this hazard and answers it the same way, with a
 * pure-type outlet: everything here is plain data with no dependency on either
 * side's `Context`.
 *
 * @module
 */

/** One place the workspace and the conversation can both be returned to. */
export interface RewindPoint {
  /** The filesnap turn id — what `restore` is addressed by. */
  readonly point: string
  /** The harness turn this point precedes. */
  readonly turn: number
  /**
   * The seq a fork anchors on so the conversation lands where the files land:
   * a seq **inside the last turn the fork keeps**, which is the turn before
   * this point's own.
   *
   * The host does not cut at this seq. `sessions.fork` takes the first
   * `turn/end` **at or after** the anchor and keeps that whole turn — the same
   * convention the harness's own per-message fork button uses, where a message
   * seq means "keep the turn this message belongs to". Anchoring one event
   * before this turn opened therefore keeps this turn instead of dropping it,
   * which is the one thing this field must never do.
   *
   * Absent until the point knows which message closed the previous turn.
   * A point with no anchor — the first turn of a session — has no fork to
   * offer and renders no control.
   */
  readonly boundary?: number | undefined
  /** Epoch ms the turn opened. */
  readonly at: number
  /**
   * What this turn's capture covered: files kept by reference, files read and
   * hashed, and files the scan saw and did not store. Absent for a point
   * recorded before this plugin reported them.
   */
  readonly coverage?: { readonly reused: number; readonly hashed: number; readonly dropped: number } | undefined
  /**
   * First line of the user message that opened the turn, trimmed for a list —
   * absent for a turn that entered no user message, or one whose message is
   * not text.
   *
   * `| undefined` because this value round-trips through JSON, both to the
   * browser and through the projection cache. Producers still omit the key
   * rather than writing `undefined` into it: a serialized `undefined` is a key
   * that vanishes, which is not the value that went in.
   */
  readonly label?: string | undefined
  /**
   * Id of the assistant message that closed this turn, when one did.
   *
   * The browser's per-message action strip is addressed by message id and
   * nothing else, so this is what lets a bubble find the point that returns
   * the workspace to before its turn. Last one wins: a turn with three steps
   * carries three assistant messages, and the rewind belongs under the last.
   */
  readonly messageId?: string | undefined
}

/** Where a rewind out of a session went. */
export interface RewindRecord {
  /** The point the workspace was returned to. */
  readonly point: string
  /** The turn that point precedes. */
  readonly turn: number
  /** The session the conversation continues in. */
  readonly child: string
  /** Epoch ms the rewind was recorded. */
  readonly at: number
}

/** What a client reads under the `filesnap` projection key. */
export interface FilesnapProjection {
  /** The points this session can return to, oldest first. */
  readonly points: readonly RewindPoint[]
  /** Where the last rewind out of this session went, when there was one. */
  readonly lastRewind?: RewindRecord | undefined
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Rewind points, and where the last rewind went. */
    filesnap: FilesnapProjection
  }
}
