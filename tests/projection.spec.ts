/**
 * The projection against the real registry: the framework drives the fold over
 * committed events, and the browser reads whatever comes out. Asserting the
 * reducer alone would not catch a schema that rejects its own output, which is
 * the failure a client would see as capability absence.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { registerProjection } from '../src/projection.ts'
import type { FilesnapProjection } from '../src/projection.ts'

/** Mount the registry and this plugin's unit on it. */
async function registry(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin({
    name: 'filesnap-projection-fixture',
    apply: (inner: Context) => { registerProjection(inner) },
  })
  return { ctx, dispose: async () => void await fiber.dispose() }
}

/** A live store session bound to a directory, so the registry drives its events. */
function liveSession(ctx: Context, id: string): Session {
  const meta: Partial<SessionHeader> = { cwd: '/work/project' }
  return ctx.sessions.create(SessionId(id), { meta })
}

/** Read the unit's current client value. */
function view(ctx: Context, session: Session): FilesnapProjection | undefined {
  return ctx.sessionProjections.snapshot(session).values.filesnap
}

describe('the filesnap projection', () => {
  it('serves the points a session can return to', async () => {
    const { ctx, dispose } = await registry()
    try {
      const session = liveSession(ctx, 'session-a')
      session.append('turn/start', { turn: 1 })
      session.append('filesnap/point', { turn: 1, point: 'session-a.t1', manifest: 'ab', reused: 2, hashed: 1, dropped: 0 })
      session.append(
        'user/message',
        createUserMessage({ content: [{ type: 'text', text: 'add a rate limiter' }], source: { kind: 'user' } }),
        { surfaceOp: 'append' },
      )
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      expect(view(ctx, session)?.points).toEqual([
        {
          point: 'session-a.t1', turn: 1, at: expect.any(Number),
          label: 'add a rate limiter',
          coverage: { reused: 2, hashed: 1, dropped: 0 },
        },
      ])
    } finally {
      await dispose()
    }
  })

  it('serves where the last rewind went, which is how a client follows one', async () => {
    const { ctx, dispose } = await registry()
    try {
      const session = liveSession(ctx, 'session-a')
      session.append('turn/start', { turn: 1 })
      session.append('filesnap/point', { turn: 1, point: 'session-a.t1', manifest: 'ab', reused: 2, hashed: 1, dropped: 0 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('filesnap/rewound', {
        point: 'session-a.t1',
        turn: 1,
        child: SessionId('session-b'),
        boundary: 3,
        written: 3,
        deleted: 0,
        failed: 0,
        safety: 'cd',
      })

      expect(view(ctx, session)?.lastRewind).toMatchObject({
        point: 'session-a.t1',
        turn: 1,
        child: 'session-b',
      })
    } finally {
      await dispose()
    }
  })

  it('does not serve a turn that was labelled but never captured', async () => {
    const { ctx, dispose } = await registry()
    try {
      const session = liveSession(ctx, 'session-a')
      session.append('turn/start', { turn: 1 })
      session.append(
        'user/message',
        createUserMessage({ content: [{ type: 'text', text: 'no snapshot for this' }], source: { kind: 'user' } }),
        { surfaceOp: 'append' },
      )
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      expect(view(ctx, session)?.points).toEqual([])
    } finally {
      await dispose()
    }
  })

  it('leaves the key absent once the plugin unloads, so a client reads capability absence', async () => {
    const { ctx, dispose } = await registry()
    const session = liveSession(ctx, 'session-a')
    session.append('turn/start', { turn: 1 })
    session.append('filesnap/point', { turn: 1, point: 'session-a.t1', manifest: 'ab', reused: 2, hashed: 1, dropped: 0 })
    expect(view(ctx, session)).toBeDefined()
    await dispose()
    expect(view(ctx, session)).toBeUndefined()
  })

  it('accepts its own state back, which is what the persisted cache round-trips', async () => {
    // The cache stores the fold state as JSON and seeds a later process from
    // it. A state carrying anything JSON drops — an `undefined` where a key
    // should be absent — comes back as a different value than went in.
    const { ctx, dispose } = await registry()
    try {
      const session = liveSession(ctx, 'session-a')
      session.append('turn/start', { turn: 1 })
      session.append('filesnap/point', { turn: 1, point: 'session-a.t1', manifest: 'ab', reused: 2, hashed: 1, dropped: 0 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      const checkpoint = ctx.sessionProjections.checkpoint(session)
      const row = checkpoint['filesnap']
      expect(row).toBeDefined()
      expect(JSON.parse(JSON.stringify(row?.val))).toEqual(row?.val)

      // Seeded from the row alone, with no events left to replay.
      const serialized = JSON.parse(JSON.stringify(checkpoint)) as typeof checkpoint
      // `header` is the fourth argument as of the harness release that turned
      // preset resolution into a projection: `init` now receives the header, so
      // a restore has to hand it back. This plugin never calls `restore` — it
      // registers a definition and the harness drives it — so the argument
      // count is a fact about the harness this suite is linked against, not
      // about what the plugin supports.
      const restored = ctx.sessionProjections.restore(serialized, [], session.seq, session.header)
      const value = restored.snapshot.values.filesnap
      expect(value?.points).toEqual([
        {
          point: 'session-a.t1', turn: 1, at: expect.any(Number),
          coverage: { reused: 2, hashed: 1, dropped: 0 },
        },
      ])
    } finally {
      await dispose()
    }
  })
})
