/**
 * Rewind surface, browser half: an entry in the session header's action strip.
 *
 * The point list is the host-computed `filesnap` projection, so this plugin
 * owns no store, no refresh chain, and no event listener. What it does own is
 * the **order of a rewind in the web**, which differs from the headless one on
 * purpose:
 *
 *   1. `sessions.fork(...)` — the deployment's own fork, which composes the
 *      child's preset and attaches it to the workspace.
 *   2. `/rewind <point> --into <child>` — the host puts the files back and
 *      files the undo record in that fork.
 *   3. `sessions.open(child)` — the user lands where the files landed.
 *
 * The host plugin can do step 1 itself and does so for a headless run. Here it
 * must not: a second fork beside the deployment's correct one would leave the
 * child out of the workspace it belongs to.
 *
 * @module dsh-filesnap/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the header action strip).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the `filesnap` SessionProjectionMap key merge, from the pure-type
// outlet — importing the host's projection module here would merge the host's
// `ctx.sessions` onto the client runtime's key.
import type { RewindPoint } from '../wire.ts'
import type { RewindActionResult, RewindActions } from './actions.ts'
import { RewindHeaderEntry } from './RewindMenu.tsx'
import { en, zh, type RewindKey } from './locales.ts'

export { RewindMenu, RewindHeaderEntry } from './RewindMenu.tsx'
export type { RewindActionResult, RewindActions } from './actions.ts'
export type { RewindKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The rewind menu's copy. */
    filesnap: RewindKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'filesnap'

/** Required services: the slot system, session control, and copy. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: the rewind entry in the session header action strip.
 *
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-filesnap: dictionaries')

  const sessions = ctx.sessions

  /**
   * Run one slash command against a session's agent and report the outcome.
   *
   * The command registry is the one host route a plugin outside the harness
   * repository can reach without generating an RPC of its own, and the two
   * verbs it needs are already there.
   *
   * @param sessionId - the session whose agent executes it.
   * @param line - the full command line, leading slash included.
   * @returns whether the command completed.
   */
  const command = async (sessionId: SessionId, line: string): Promise<RewindActionResult> => {
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) return { ok: false, error: `session "${sessionId}" is not open here` }
    const result = await session.command(line)
    if (!result.ok) return { ok: false, error: result.error.message }
    if (!result.value.matched) return { ok: false, error: `the host has no "${line.split(' ')[0] ?? ''}" command` }
    return { ok: true }
  }

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'filesnap',
    order: 20,
    locale: NS,
    inject: (sessionId): RewindActions => ({
      onRewind: async (point: RewindPoint): Promise<RewindActionResult> => {
        // The fork first, because the host files the undo record in the
        // session named by `--into` and that has to exist before it is named.
        let child: SessionId
        try {
          child = await sessions.fork({ sessionId, atSeq: point.boundary, increaseTitle: true })
        } catch (error: unknown) {
          return { ok: false, error: String(error) }
        }
        const done = await command(sessionId, `/rewind ${point.point} --into ${child}`)
        // Opened even when the files half failed: the fork exists either way,
        // and leaving the user in the parent with a stray child is worse than
        // landing them in it with the failure on screen.
        sessions.open(child)
        return done
      },
      onRedo: () => command(sessionId, '/redo'),
    }),
  }, RewindHeaderEntry))
}
