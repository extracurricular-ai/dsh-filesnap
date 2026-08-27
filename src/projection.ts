/**
 * The rewind points, as a projection the browser can read.
 *
 * A client never sees raw session events, and it should not re-derive this
 * list from a transcript it renders for other reasons. The projection seam is
 * the sanctioned route: a pure fold the framework drives over committed
 * events, whose whole current value is served to whoever subscribes.
 *
 * The fold itself is {@link reducePoints}, shared verbatim with the host's own
 * reader — this module is the registration and the schemas, not a second
 * implementation.
 *
 * **Optional.** `sessionProjections` is registered through `ctx.inject`, so a
 * headless assembly with no projection registry is unaffected and the plugin
 * still works through its commands.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-session-projection'
import { capturedPoints, initialPoints, reducePoints } from './points.ts'
import type { PointsState } from './points.ts'
import type {} from './wire.ts'

export type { FilesnapProjection } from './wire.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /**
     * The reader state behind the `filesnap` client view. Host-only: the
     * client-visible half of the pair is merged in `wire.ts`, which a browser
     * program can import without dragging the host's `Context` merges in
     * behind it.
     */
    filesnap: PointsState
  }
}

/** One point, as it crosses the wire and as it is persisted. */
const pointSchema = z.object({
  point: z.string(),
  turn: z.number().int().nonnegative(),
  boundary: z.number().int(),
  at: z.number().int(),
  label: z.string().optional(),
  messageId: z.string().optional(),
  coverage: z.object({
    reused: z.number().int().nonnegative(),
    hashed: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
  }).optional(),
})

/** Where a rewind went, as it crosses the wire and as it is persisted. */
const rewindSchema = z.object({
  point: z.string(),
  turn: z.number().int().nonnegative(),
  child: z.string(),
  at: z.number().int(),
})

/**
 * The persisted fold state. `openTurn` is nullable rather than optional
 * because the cache round-trips through JSON, where `undefined` does not
 * survive and a key that vanishes is not the same value that went in.
 */
const stateSchema = z.object({
  points: z.array(pointSchema),
  openTurn: z.number().int().nonnegative().nullable(),
  openTurnStart: z.number().int(),
  lastRewind: rewindSchema.optional(),
})

/** The client view. */
const viewSchema = z.object({
  points: z.array(pointSchema),
  lastRewind: rewindSchema.optional(),
})

/**
 * Bump when the serialized fields or the fold's meaning change, so persisted
 * rows from an older unit are discarded rather than forward-applied into
 * something that no longer means what it says.
 */
const STATE_VERSION = 2

/**
 * Register the `filesnap` projection when the deployment composes a registry.
 *
 * @param ctx - the plugin's context.
 */
export function registerProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx: Context) => {
    projectionCtx.sessionProjections.register<'filesnap', PointsState>({
      key: 'filesnap',
      stateSchema,
      init: initialPoints,
      apply: reducePoints,
      wire: {
        viewSchema,
        // A turn that was labelled but never captured is held in the fold
        // state — the label has to survive until its capture lands — and is
        // not a rewind target, so it does not cross the wire.
        view: state => ({
          points: capturedPoints(state),
          ...state.lastRewind === undefined ? {} : { lastRewind: state.lastRewind },
        }),
      },
      stateVersion: STATE_VERSION,
    })
  })
}
