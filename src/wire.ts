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
   * Inclusive source event seq a fork must cut through to land the
   * conversation where the files land: the event before this turn opened.
   */
  readonly boundary: number
  /** Epoch ms the turn opened. */
  readonly at: number
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
