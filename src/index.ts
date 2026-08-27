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
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import { registerCommands } from './commands.ts'
import { resolveConfig } from './config.ts'
import { registerProjection } from './projection.ts'
import { FilesnapRewind } from './service.ts'
import type {} from './types.ts'

export { DEFAULTS, resolveConfig } from './config.ts'
export type { FilesnapConfig } from './config.ts'
export { FilesnapRewind } from './service.ts'
export type { RewindDestination } from './service.ts'
export { parseRewind } from './commands.ts'
export type { RewindCommand } from './commands.ts'
export { capturedPoints, foldPoints, initialPoints, reconcile, reducePoints, selectPoint } from './points.ts'
export type { PointsState } from './points.ts'
export type { FilesnapProjection, RewindRecord } from './wire.ts'
export type {
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
 * The turn currently open in a session.
 *
 * Read from the log rather than tracked in memory: a resumed session is mid-
 * conversation the moment it loads, and a counter starting at zero would file
 * its next capture under a turn id an earlier one already holds.
 *
 * @param session - the session to read.
 * @returns the open turn's number, or 0 when no turn has opened.
 */
export function currentTurn(session: Session): number {
  const last = session.events.findLast(event => event.type === 'turn/start')
  return last?.type === 'turn/start' ? last.data.turn : 0
}

/**
 * Record one path's pre-edit state, if there is an agent to attribute it to.
 *
 * The filesystem waterfalls carry an opaque tool-execution context rather than
 * an agent, so the agent comes from the initiator scope the driver established.
 * A mutation with no initiator — a plugin writing on its own account — is not
 * part of any turn and is left alone.
 *
 * @param ctx - a context carrying `ctx.filesnap` and `ctx.fs`.
 * @param target - the resolved target about to change.
 */
async function declareTarget(ctx: Context, target: FsTarget): Promise<void> {
  let agent: Agent | undefined
  try {
    agent = ctx.agents.currentInitiator()
  } catch {
    // The registry is disposed, which means the tree is coming down. A missing
    // pre-image matters less than a teardown that throws out of a file write.
    return
  }
  if (agent === undefined) return
  const fs = ctx.get('fs')
  if (fs === undefined) return
  await ctx.filesnap.declare(agent, currentTurn(agent.session), [fs.processPath(target)])
}

/**
 * Mount the plugin.
 *
 * @param ctx - the plugin's own context.
 * @param config - the deployment's `config` block, validated here.
 */
export function apply(ctx: Context, config: unknown): void {
  const resolved = resolveConfig(config)
  ctx.plugin(FilesnapRewind, resolved)

  // The browser's view of the rewind points. Registered through `ctx.inject`,
  // so a headless assembly with no projection registry is unaffected.
  registerProjection(ctx)

  // Every attachment below calls the service, so they are registered on a
  // context that waits for it. Registering them beside the child plugin would
  // let a turn open while `ctx.filesnap` is still undefined.
  ctx.inject(['filesnap'], (inner: Context) => {
    // After `next()`, so a step the deployment rejects does not pay for a scan
    // of the tree — and still before `step/start`, the model request, and every
    // tool the step goes on to call.
    inner.on('agent/pre-step', async ({ agent, turn, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'enter') await inner.filesnap.capture(agent, turn, signal)
      return decision
    })

    if (resolved.declareEdits) {
      // Both are single-slot decision waterfalls: the first listener that
      // returns an intent owns the decision. This one owns nothing — it records
      // and then delegates, so whichever policy the deployment mounted still
      // decides.
      inner.on('fs/write-intent', async (target, _actor, next): Promise<FsWriteIntent | undefined> => {
        await declareTarget(inner, target)
        return next()
      })
      inner.on('fs/edit-intent', async (target, _actor, next): Promise<{ version: FsVersion } | undefined> => {
        await declareTarget(inner, target)
        return next()
      })
    }

    // Command availability follows plugin composition, and a headless run has
    // no registry at all. The service stays reachable either way.
    if (inner.get('commands') !== undefined) registerCommands(inner)
  })
}
