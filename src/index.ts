/**
 * Git-free rewind and redo for DeepSeek Harness, over the
 * [filesnap](https://github.com/extracurricular-ai/filesnap) engine.
 *
 * Three attachments, no changes to the loop:
 *
 * - **`agent/pre-step`** captures the workspace once per turn, in an awaited
 *   position, so the snapshot is complete before the model can ask for a tool.
 * - **`fs/write-intent`** and **`fs/edit-intent`** record what a path holds
 *   before the provider changes it. Both are decision waterfalls that run
 *   immediately ahead of the mutation, which is the only place a pre-image
 *   still exists to be read.
 * - **`ctx.commands`** carries `/rewind` and `/redo`, which dispatch without a
 *   model turn.
 *
 * The filesystem attachments are tool-agnostic on purpose. Coverage follows
 * `ctx.fs`, not a list of tool names, so a tool this plugin has never heard of
 * is protected the moment it writes through the seam — and a shell command that
 * edits an already-tracked file is still caught by the next turn's scan.
 *
 * @module dsh-filesnap
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig } from './config.ts'
import { declareEventTypes } from './types.ts'
import { registerProjection } from './projection.ts'
import { FilesnapRewind } from './service.ts'
import type {} from './types.ts'

export { DEFAULTS, resolveConfig } from './config.ts'
export type { FilesnapConfig } from './config.ts'
export { declareEventTypes, FILESNAP_EVENT_TYPES } from './types.ts'
export { currentTurn, FilesnapRewind } from './service.ts'
export type { RewindDestination } from './service.ts'
export { parseRewind } from './commands.ts'
export { isMarked, mark, REWOUND_MARK, unmark } from './mark.ts'
export type { RewindCommand } from './commands.ts'
export { capturedPoints, foldPoints, initialPoints, reconcile, reducePoints, selectPoint } from './points.ts'
export type { PointsState } from './points.ts'
export type { FilesnapProjection, RewindRecord } from './wire.ts'
export type {
  FilesnapStatus,
  RedoOutcome,
  RewindOutcome,
  RewindPoint,
  RewindRefusal,
  RewindResult,
} from './types.ts'

export const name = 'filesnap'

/**
 * `subprocess` spawns the command and `agents` carries the fork. `fs`,
 * `commands` and `agentPresets` are read opportunistically through `ctx.get`
 * instead: a headless deployment with no command registry still captures and
 * still exposes `ctx.filesnap`, and a deployment with no filesystem seam simply
 * has nothing to declare.
 */
export const inject = ['subprocess', 'agents']

/**
 * Mount the plugin.
 *
 * @param ctx - the plugin's own context.
 * @param config - the deployment's `config` block, validated here.
 */
export function apply(ctx: Context, config: unknown): void {
  // Before anything can append or read one. Not an effect: see the function's
  // own note on why removing these on unload would strand existing logs.
  declareEventTypes()

  const resolved = resolveConfig(config)

  // The service registers its own loop listeners and commands, on its own
  // fiber. Nothing is attached here: a listener registered beside the service
  // rather than by it can outlive it, or — as an earlier version found the hard
  // way — be unwound by a short-lived helper fiber while the service stays up.
  ctx.plugin(FilesnapRewind, resolved)

  // The browser's view of the rewind points. Registered through `ctx.inject`,
  // so a headless assembly with no projection registry is unaffected. Safe as a
  // child fiber because `register` is an effect that rides it either way.
  registerProjection(ctx)
}
