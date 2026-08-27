/**
 * The service against a real Cordis context, a real Session, and the real
 * engine. This is where the sequencing is asserted — the fork happening before
 * the restore, the undo record landing in the child, the durable record of what
 * happened — because none of that is visible from either half alone.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { FilesnapRewind } from '../src/service.ts'
import { BINARY, nodeSubprocess, scratch } from './support.ts'

/** One detached session bound to a working directory. */
function sessionAt(id: string, cwd: string): Session {
  const header: SessionHeader = { version: 0, id: SessionId(id), createdAt: 1_700_000_000_000, cwd }
  return Session.create(SessionId(id), undefined, header)
}

/** The slice of `Agent` this service reads. */
function agentOn(session: Session, status: 'idle' | 'running' = 'idle'): Agent {
  return {
    id: session.header.id,
    session,
    status,
    options: { provider: 'mock', model: 'mock' },
  } as unknown as Agent
}

/** Open a turn, prompt it, and close it — the shape the loop writes. */
function runTurn(session: Session, turn: number, text: string, capture: () => void): void {
  session.append('turn/start', { turn })
  capture()
  session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe.skipIf(BINARY === undefined)('FilesnapRewind', () => {
  let workspace: ReturnType<typeof scratch>
  let store: ReturnType<typeof scratch>
  let ctx: Context
  let service: FilesnapRewind
  let fiber: Awaited<ReturnType<Context['plugin']>>
  let forked: { id: SessionId; seed: readonly SessionEvent[]; parent?: SessionId }[]

  beforeEach(async () => {
    workspace = scratch('filesnap-svc-ws')
    store = scratch('filesnap-svc-store')
    forked = []
    ctx = new Context()
    ctx.provide('subprocess', nodeSubprocess())
    ctx.provide('sessions', {})
    ctx.provide('agents', {
      create(options: { sessionId: SessionId; seed?: readonly SessionEvent[]; meta?: { parentSession?: SessionId } }) {
        forked.push({
          id: options.sessionId,
          seed: options.seed ?? [],
          ...options.meta?.parentSession === undefined ? {} : { parent: options.meta.parentSession },
        })
        return Promise.resolve({})
      },
    })
    fiber = await ctx.plugin(FilesnapRewind, resolveConfig({
      /* v8 ignore next -- the suite is skipped when the binary is absent */
      command: BINARY ?? '',
      dataDir: store.path,
      timeoutMs: 60_000,
    }))
    service = ctx.filesnap
  })

  afterEach(async () => {
    await fiber.dispose()
    workspace.remove()
    store.remove()
  })

  it('records a rewind point per captured turn', async () => {
    const session = sessionAt('session-a', workspace.path)
    writeFileSync(join(workspace.path, 'a.txt'), 'v1\n')
    const agent = agentOn(session)

    session.append('turn/start', { turn: 1 })
    await service.capture(agent, 1)

    const point = session.events.find(event => event.type === 'filesnap/point')
    expect(point?.type === 'filesnap/point' && point.data).toMatchObject({ turn: 1, point: 'session-a.t1' })
    expect(point?.type === 'filesnap/point' && point.data.manifest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('captures a turn once, however often the step is proposed', async () => {
    const session = sessionAt('session-a', workspace.path)
    const agent = agentOn(session)
    session.append('turn/start', { turn: 1 })
    await service.capture(agent, 1)
    await service.capture(agent, 1)
    await service.capture(agent, 1)
    expect(session.events.filter(event => event.type === 'filesnap/point')).toHaveLength(1)
  })

  it('does not recapture a turn a previous process already captured', async () => {
    // The state is seeded from the log, so a resumed session does not file a
    // second manifest under a turn id that already resolves to the first.
    const session = sessionAt('session-a', workspace.path)
    session.append('turn/start', { turn: 1 })
    session.append('filesnap/point', { turn: 1, point: 'session-a.t1', manifest: 'seeded', reused: 0, hashed: 0, dropped: 0 })
    await service.capture(agentOn(session), 1)
    expect(session.events.filter(event => event.type === 'filesnap/point')).toHaveLength(1)
  })

  it('leaves a session with no working directory alone', async () => {
    const header: SessionHeader = { version: 0, id: SessionId('session-nowhere'), createdAt: 1, ...{} }
    const session = Session.create(SessionId('session-nowhere'), undefined, header)
    session.append('turn/start', { turn: 1 })
    await service.capture(agentOn(session), 1)
    expect(session.events.some(event => event.type === 'filesnap/point')).toBe(false)

    const points = await service.points(agentOn(session))
    expect(points.ok).toBe(false)
    expect(points.ok || points.refusal.kind).toBe('untracked')
  })

  it('offers only the points the store can still resolve', async () => {
    const session = sessionAt('session-a', workspace.path)
    const agent = agentOn(session)
    writeFileSync(join(workspace.path, 'a.txt'), 'v1\n')
    runTurn(session, 1, 'first change', () => {})
    // Turn 1 was never captured, so the log has a turn the engine cannot resolve.
    session.append('filesnap/point', { turn: 1, point: 'session-a.t1', manifest: 'gone', reused: 0, hashed: 0, dropped: 0 })
    runTurn(session, 2, 'second change', () => {})
    await service.capture(agent, 2)

    const points = await service.points(agent)
    expect(points.ok).toBe(true)
    expect(points.ok && points.value.map(point => point.turn)).toEqual([2])
    expect(points.ok && points.value[0]?.label).toBe('second change')
  })

  it('still offers a point its parent captured, in a session that has captured nothing', async () => {
    // What a fork leaves behind. The child's log carries the parent's points
    // verbatim, but `filesnap log --session <child>` lists only what the CHILD
    // captured — so filtering against that set drops every inherited point,
    // which is every point a freshly forked session has.
    const file = join(workspace.path, 'a.txt')
    writeFileSync(file, 'original\n')

    const parent = sessionAt('session-a', workspace.path)
    parent.append('turn/start', { turn: 1 })
    await service.capture(agentOn(parent), 1)
    parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // The child inherits the parent's log and has captured nothing itself.
    const child = sessionAt('session-b', workspace.path)
    for (const event of parent.events) {
      if (event.type === 'filesnap/point') child.append('filesnap/point', event.data)
      else if (event.type === 'turn/start') child.append('turn/start', event.data)
      else if (event.type === 'turn/end') child.append('turn/end', event.data)
    }
    const heir = agentOn(child)

    const points = await service.points(heir)
    expect(points.ok).toBe(true)
    expect(points.ok && points.value.map(point => point.point)).toEqual(['session-a.t1'])

    writeFileSync(file, 'wrecked\n')
    const outcome = await service.rewind(heir, '1', { kind: 'into', session: SessionId('session-c') })
    expect(outcome.ok).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('original\n')
  })

  it('forks the conversation, then restores the files into the fork', async () => {
    const file = join(workspace.path, 'a.txt')
    const session = sessionAt('session-a', workspace.path)
    const agent = agentOn(session)

    writeFileSync(file, 'original\n')
    let captured: Promise<void> | undefined
    session.append('turn/start', { turn: 1 })
    captured = service.capture(agent, 1)
    await captured
    session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text: 'break it' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    writeFileSync(file, 'something regrettable\n')

    const outcome = await service.rewind(agent, '1')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // The files half landed.
    expect(readFileSync(file, 'utf8')).toBe('original\n')
    expect(outcome.value.written).toBe(1)
    expect(outcome.value.failures).toEqual([])
    expect(outcome.value.safety).toMatch(/^[0-9a-f]{64}$/u)

    // The conversation half cut before the turn opened, and carried the lineage.
    expect(forked).toHaveLength(1)
    expect(forked[0]?.parent).toBe('session-a')
    expect(forked[0]?.seed).toHaveLength(0)
    expect(outcome.value.child).toBe(forked[0]?.id)

    // The source log says where the user went.
    const record = session.events.findLast(event => event.type === 'filesnap/rewound')
    expect(record?.type === 'filesnap/rewound' && record.data).toMatchObject({
      point: 'session-a.t1',
      turn: 1,
      child: forked[0]?.id,
      written: 1,
      failed: 0,
    })
    expect(record?.seq).toBe(outcome.value.eventSeq)
  })

  it('cuts the fork at the end of the previous turn, not inside the one being rewound', async () => {
    const session = sessionAt('session-a', workspace.path)
    const agent = agentOn(session)
    writeFileSync(join(workspace.path, 'a.txt'), 'v1\n')

    session.append('turn/start', { turn: 1 })
    await service.capture(agent, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const afterFirstTurn = session.events.length
    session.append('turn/start', { turn: 2 })
    await service.capture(agent, 2)
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    const outcome = await service.rewind(agent, '2')
    expect(outcome.ok).toBe(true)
    expect(forked[0]?.seed).toHaveLength(afterFirstTurn)
    expect(forked[0]?.seed.at(-1)?.type).toBe('turn/end')
  })

  it('files the undo record in the fork, so /redo works where the user is standing', async () => {
    const file = join(workspace.path, 'a.txt')
    const session = sessionAt('session-a', workspace.path)
    const agent = agentOn(session)
    writeFileSync(file, 'original\n')
    session.append('turn/start', { turn: 1 })
    await service.capture(agent, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    writeFileSync(file, 'later work\n')

    const rewound = await service.rewind(agent, '1')
    expect(rewound.ok).toBe(true)
    if (!rewound.ok) return
    expect(readFileSync(file, 'utf8')).toBe('original\n')

    // The source session holds no undo: the record went to the child.
    const wrongPlace = await service.redo(agent)
    expect(wrongPlace.ok).toBe(false)

    const child = sessionAt(rewound.value.child, workspace.path)
    const redone = await service.redo(agentOn(child))
    expect(redone.ok).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('later work\n')
    expect(child.events.some(event => event.type === 'filesnap/redone')).toBe(true)
  })

  it('accepts a fork the caller already performed', async () => {
    const file = join(workspace.path, 'a.txt')
    const session = sessionAt('session-a', workspace.path)
    const agent = agentOn(session)
    writeFileSync(file, 'original\n')
    session.append('turn/start', { turn: 1 })
    await service.capture(agent, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    writeFileSync(file, 'changed\n')

    const outcome = await service.rewind(agent, '1', { kind: 'into', session: SessionId('session-b') })
    expect(outcome.ok).toBe(true)
    // The deployment's own fork was used; this plugin built none.
    expect(forked).toHaveLength(0)
    expect(outcome.ok && outcome.value.child).toBe('session-b')

    const child = sessionAt('session-b', workspace.path)
    expect((await service.redo(agentOn(child))).ok).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('changed\n')
  })

  it('refuses a point nobody offered', async () => {
    const session = sessionAt('session-a', workspace.path)
    session.append('turn/start', { turn: 1 })
    await service.capture(agentOn(session), 1)
    const outcome = await service.rewind(agentOn(session), '99')
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.refusal).toEqual({ kind: 'unknown-point', point: '99' })
    expect(forked).toHaveLength(0)
  })

  it('refuses to rewind an agent that is mid-turn', async () => {
    const session = sessionAt('session-a', workspace.path)
    session.append('turn/start', { turn: 1 })
    await service.capture(agentOn(session), 1)
    const outcome = await service.rewind(agentOn(session, 'running'), '1')
    expect(!outcome.ok && outcome.refusal.kind).toBe('agent-busy')
    // Nothing was forked and nothing was written.
    expect(forked).toHaveLength(0)
  })

  it('declares a pre-image for a path the scan never sees, and restores it', async () => {
    const outside = scratch('filesnap-svc-outside')
    try {
      const file = join(outside.path, 'config.toml')
      writeFileSync(file, 'before\n')
      const session = sessionAt('session-a', workspace.path)
      const agent = agentOn(session)
      session.append('turn/start', { turn: 1 })
      await service.capture(agent, 1)
      await service.declare(agent, 1, [file])
      writeFileSync(file, 'after\n')
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      expect((await service.rewind(agent, '1')).ok).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe('before\n')
    } finally {
      outside.remove()
    }
  })

  it('declares a created path so the rewind may remove it again', async () => {
    const created = join(workspace.path, 'new.txt')
    const session = sessionAt('session-a', workspace.path)
    const agent = agentOn(session)
    session.append('turn/start', { turn: 1 })
    await service.capture(agent, 1)
    await service.declare(agent, 1, [created])
    writeFileSync(created, 'brand new\n')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const outcome = await service.rewind(agent, '1')
    expect(outcome.ok && outcome.value.deleted).toBe(1)
    expect(existsSync(created)).toBe(false)
  })

  it('declares one path once per turn, however many times it is edited', async () => {
    // The engine ignores a repeat, so this is about not paying for the process.
    const file = join(workspace.path, 'a.txt')
    writeFileSync(file, 'v0\n')
    const session = sessionAt('session-a', workspace.path)
    const agent = agentOn(session)
    let spawns = 0
    const counting = nodeSubprocess()
    ctx.filesnap  // touch the service so the invoker is built against the original
    session.append('turn/start', { turn: 1 })
    await service.capture(agent, 1)
    const inner = counting.spawn.bind(counting)
    ;(ctx.subprocess as unknown as { spawn: typeof inner }).spawn = (spec) => {
      if (spec.argv.includes('declare')) spawns++
      return inner(spec)
    }
    await service.declare(agent, 1, [file])
    await service.declare(agent, 1, [file])
    await service.declare(agent, 1, [file, file])
    expect(spawns).toBe(1)
  })
})
