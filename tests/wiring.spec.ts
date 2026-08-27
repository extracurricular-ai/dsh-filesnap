/**
 * The plugin as a deployment mounts it: `apply` on a real context, the real
 * agent dispatch, and a command registry present.
 *
 * This tier exists because the service tier cannot see the failure it covers.
 * Calling `service.capture()` directly proves the operation; it proves nothing
 * about whether a turn ever reaches it. A first version of this plugin
 * registered its listeners on a `ctx.inject(…)` child fiber and read
 * `ctx.commands` as a property — cordis disposed the child as soon as its
 * callback returned, and refused the undeclared property read, so the whole
 * service fiber was torn down five milliseconds after it was built. Every
 * service-tier test still passed, and no turn was ever captured.
 *
 * So the assertions here are deliberately about the wiring, not the work: the
 * fiber is still alive after boot, and a dispatched turn reaches the engine.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { apply, FILESNAP_EVENT_TYPES } from '../src/index.ts'
import { BINARY, nodeSubprocess, scratch } from './support.ts'

/** A session bound to a working directory, and the slice of `Agent` this plugin reads. */
function agentAt(id: string, cwd: string): Agent & { session: Session } {
  const header: SessionHeader = { version: 0, id: SessionId(id), createdAt: 1_700_000_000_000, cwd }
  const session = Session.create(SessionId(id), undefined, header)
  return {
    id: session.header.id,
    session,
    status: 'idle',
    options: { provider: 'mock', model: 'mock' },
  } as unknown as Agent & { session: Session }
}

describe.skipIf(BINARY === undefined)('the plugin as a deployment mounts it', () => {
  let workspace: ReturnType<typeof scratch>
  let store: ReturnType<typeof scratch>
  let ctx: Context
  let fiber: Awaited<ReturnType<Context['plugin']>>
  /** Targets the fs policy stand-in decided on, in order. */
  let decided: string[]

  beforeEach(async () => {
    workspace = scratch('filesnap-wiring-ws')
    store = scratch('filesnap-wiring-store')
    ctx = new Context()
    ctx.provide('subprocess', nodeSubprocess())
    // The narrow slice `declareTarget` uses: a resolved target back to the
    // absolute path the engine can read.
    ctx.provide('fs', { processPath: (target: { targetKey: string }) => target.targetKey })
    // A real initiator scope: the filesystem waterfalls carry no agent, so the
    // plugin reads the one the driver established, and a stub returning
    // undefined would make the declare path untestable.
    let initiator: Agent | undefined
    ctx.provide('agents', {
      currentInitiator: () => initiator,
      withInitiator: <T>(agent: Agent, operation: () => T): T => {
        const previous = initiator
        initiator = agent
        try { return operation() } finally { initiator = previous }
      },
      create: () => Promise.resolve({}),
    })
    // Present, and deliberately NOT in this plugin's `inject`: reading it as a
    // property is what cordis refuses, and what the plugin must therefore not do.
    await ctx.plugin(CommandRuntime)

    // The deployment's filesystem policy, in the position a bundle layer puts
    // it: BEFORE the plugin, which a profile patch layer mounts after. It takes
    // the single decision slot and does not delegate, exactly as
    // `dsh-fs-observation-policy` does.
    decided = []
    ctx.on('fs/edit-intent', (target) => {
      decided.push(target.displayPath)
      return Promise.resolve({ version: 'v1' as never })
    })
    fiber = await ctx.plugin(
      { name: 'dsh-filesnap', apply },
      /* v8 ignore next -- the binary is required for this suite to run at all */
      { command: BINARY ?? '', dataDir: store.path, timeoutMs: 60_000 },
    )
  })

  afterEach(async () => {
    await fiber.dispose()
    workspace.remove()
    store.remove()
  })

  it('leaves the service alive and reachable after boot', () => {
    // A torn-down fiber takes its service with it, so this one read is the
    // whole assertion: the failure it catches is silent, and showed up here as
    // `undefined`.
    expect(ctx.get('filesnap')).toBeDefined()
  })

  it('registers its commands without touching an undeclared service', () => {
    const agent = agentAt('session-a', workspace.path)
    const names = ctx.get('commands')?.list(agent).map(command => command.name) ?? []
    expect(names).toContain('rewind')
    expect(names).toContain('redo')
  })

  it('captures the workspace when a real turn dispatches pre-step', async () => {
    const agent = agentAt('session-a', workspace.path)
    writeFileSync(join(workspace.path, 'notes.txt'), 'original\n')
    agent.session.append('turn/start', { turn: 1 })

    // The loop's own dispatch, carrier and all — not a direct method call.
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      (): Promise<PreStepDecision> => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    expect(decision.kind).toBe('enter')

    const point = agent.session.events.find(event => event.type === 'filesnap/point')
    expect(point?.type === 'filesnap/point' && point.data.point).toBe('session-a.t1')
  })

  it('puts the workspace back through the point a dispatched turn recorded', async () => {
    const agent = agentAt('session-a', workspace.path)
    const file = join(workspace.path, 'notes.txt')
    writeFileSync(file, 'original\n')
    agent.session.append('turn/start', { turn: 1 })
    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      (): Promise<PreStepDecision> => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    agent.session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text: 'wreck it' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    writeFileSync(file, 'wrecked\n')

    const service = ctx.get('filesnap')
    expect(service).toBeDefined()
    const outcome = await service!.rewind(agent, '1', { kind: 'into', session: SessionId('session-b') })
    expect(outcome.ok).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('original\n')
  })

  it('records a pre-edit image even though the fs policy owns the decision slot', async () => {
    // `fs/write-intent` and `fs/edit-intent` are single-slot decision
    // waterfalls, and the deployment's policy takes the slot without calling
    // `next()`. Appended, this plugin's listener never ran and every pre-edit
    // image was silently missed. The stand-in below is that policy's shape,
    // registered first, which is the order a profile patch layer produces.
    // OUTSIDE the workspace on purpose: the turn-start scan cannot see it, so
    // restoring it later is possible only if the pre-edit declare ran. A file
    // inside the workspace would be restored by the scan whether or not it did,
    // and would prove nothing about this path.
    const outside = scratch('filesnap-wiring-outside')
    try {
      const file = join(outside.path, 'config.toml')
      writeFileSync(file, 'before the edit\n')

      const agent = agentAt('session-a', workspace.path)
      agent.session.append('turn/start', { turn: 1 })
      await agentEvents(ctx, agent).waterfall(
        'agent/pre-step',
        { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
        (): Promise<PreStepDecision> => Promise.resolve({ kind: 'enter', messages: [] }),
      )

      const target = { targetKey: file as never, displayPath: file }
      const intent = await ctx.agents.withInitiator(agent, () => ctx.waterfall(
        'fs/edit-intent', target, undefined,
        () => Promise.resolve(undefined),
      ))

      // The policy still decided; this plugin only observed on the way past.
      expect(decided).toEqual([file])
      expect(intent).toEqual({ version: 'v1' })

      writeFileSync(file, 'after the edit\n')
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      const outcome = await ctx.get('filesnap')!.rewind(agent, '1', { kind: 'into', session: SessionId('session-b') })
      expect(outcome.ok).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe('before the edit\n')
    } finally {
      outside.remove()
    }
  })

  it('declares its event types, so a captured session stays loadable', async () => {
    // The persistence reader refuses a log holding a type it does not know
    // unless the event is marked ignorable, and a plugin outside the harness
    // repository can do neither through the public API. Undeclared, every
    // session this plugin captured in failed to load with
    // SessionFormatUnsupportedError — the conversation was still on disk and
    // the harness would not read it.
    for (const type of FILESNAP_EVENT_TYPES) {
      expect(KNOWN_SESSION_EVENT_TYPES.has(type)).toBe(true)
    }
  })

  it('does not capture a step the deployment rejected', async () => {
    const agent = agentAt('session-a', workspace.path)
    agent.session.append('turn/start', { turn: 1 })
    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      (): Promise<PreStepDecision> => Promise.resolve({ kind: 'reject' }),
    )
    expect(agent.session.events.some(event => event.type === 'filesnap/point')).toBe(false)
  })
})
