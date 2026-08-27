/**
 * Rewind surface, browser half.
 *
 * Two registrations, and the split is the design:
 *
 * - **`conversation.chat.assistant-actions`** carries the rewind itself, one
 *   icon in each turn's own message row, beside copy and branch. The
 *   transcript already is the list of points — one per turn — so a panel that
 *   repeated it added a second thing to read and nothing to do.
 * - **`conversation.session.header.actions`** carries the two facts that are
 *   about the session rather than a turn: undoing the rewind that landed here,
 *   and asking the engine what it holds.
 *
 * The plugin owns no store, no refresh chain and no event listener: the point
 * list is the host-computed `filesnap` projection.
 *
 * What it does own is the **order of a rewind in the web**, which differs from
 * the headless one on purpose:
 *
 *   1. `sessions.fork(atSeq)` — the deployment's own fork, which composes the
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

// Taken from cordis and the session package rather than from
// `@deepseek-ai/dsh-client-runtime/client`, which the harness has since
// removed. That package's `ClientContext` was `export type ClientContext =
// Context` — a plain alias — so this is the same type from its own home, and it
// resolves against a harness from either side of the removal.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ui-conversation SlotMap merge (the two strips).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the `filesnap` SessionProjectionMap key merge, from the pure-type
// outlet — importing the host's projection module here would merge the host's
// `ctx.sessions` onto the client runtime's key.
import type { RewindPoint } from '../wire.ts'
import type { RewindActionResult, RewindActions, RewindHeaderActions } from './actions.ts'
import { RewindAction } from './RewindAction.tsx'
import { RewindHeader } from './RewindHeader.tsx'
import { en, zh, type RewindKey } from './locales.ts'

export { RewindAction } from './RewindAction.tsx'
export { RewindHeader } from './RewindHeader.tsx'
export type { RewindActionResult, RewindActions, RewindHeaderActions } from './actions.ts'
export type { RewindKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The rewind controls' copy. */
    filesnap: RewindKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'filesnap'

/** Required services: the slot system, session control, and copy. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: the per-turn rewind control and the session-level strip.
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
   * repository can reach without generating an RPC of its own, and every verb
   * it needs is already there. A command's own text renders in the transcript
   * as a command row; only admission comes back here.
   *
   * @param sessionId - the session whose agent executes it.
   * @param line - the full command line, leading slash included.
   * @returns whether the command was admitted.
   */
  const command = async (sessionId: SessionId, line: string): Promise<RewindActionResult> => {
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) return { ok: false, error: `session "${sessionId}" is not open here` }
    const result = await session.command(line)
    if (!result.ok) return { ok: false, error: result.error.message }
    if (!result.value.matched) return { ok: false, error: `the host has no "${line.split(' ')[0] ?? ''}" command` }
    return { ok: true }
  }

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'filesnap',
    // After feedback (10), so the destructive control is not the one a stray
    // click lands on.
    order: 30,
    locale: NS,
    inject: (sessionId): RewindActions => ({
      onRewind: async (point: RewindPoint): Promise<RewindActionResult> => {
        // An omitted `atSeq` does not mean "cut at the beginning" — the host
        // reads it as "the last completed turn", which would fork the newest
        // state and then restore old files into it. A point with no anchor
        // renders no control, so this is unreachable; it is checked anyway
        // because the failure it prevents is silent and looks like success.
        const atSeq = point.boundary
        if (atSeq === undefined) {
          return { ok: false, error: `turn ${String(point.turn)} has no completed turn before it to fork from` }
        }
        // The fork first, because the host files the undo record in the
        // session named by `--into` and that has to exist before it is named.
        let child: SessionId
        try {
          child = await sessions.fork({ sessionId, atSeq, increaseTitle: true })
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
    }),
  }, RewindAction))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'filesnap',
    order: 20,
    locale: NS,
    inject: (sessionId): RewindHeaderActions => ({
      onRedo: () => command(sessionId, '/redo'),
      onStatus: () => command(sessionId, '/rewind status'),
    }),
  }, RewindHeader))
}
