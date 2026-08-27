/**
 * The two halves of a rewind, sequenced.
 *
 * filesnap has no `rewind` command and no hook to call back into a host
 * (filesnap D27). The engine puts files back; it has no conversation and no
 * opinion about one, and a command that promised the combined operation would
 * deliver half of it. *Rewind* is the user-facing word for what a plugin does,
 * and this is the layer that holds both halves — so the ordering, the failure
 * modes, and the durable record of what happened all live here.
 *
 * The order is fixed and the reason is `undo_for`. A restore files its undo
 * record in the session named by `--undo-for`, and for a forking host that is
 * the session the user ends up standing in (filesnap D26). The fork therefore
 * happens first: the destination has to exist before the restore can name it,
 * or the redo is filed somewhere the user cannot reach.
 *
 * @module
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import { registerCommands } from './commands.ts'
import type { FilesnapCli, FilesnapRun } from './cli.ts'
import { createFilesnapCli, eventsOfType, lastEvent, numberField, stringField } from './cli.ts'
import { explain, pointId, sessionId as admitSessionId } from './ids.ts'
import { foldPoints, reconcile, selectPoint } from './points.ts'
import type { FilesnapStatus, RedoOutcome, RewindOutcome, RewindPoint, RewindRefusal, RewindResult } from './types.ts'
import type { FilesnapConfig } from './config.ts'

/** Per-session bookkeeping, all of it recoverable from the log or the store. */
interface TrackState {
  /** The filesnap session id, or why this session cannot be tracked. */
  readonly binding: { readonly ok: true; readonly id: string; readonly cwd: string }
    | { readonly ok: false; readonly why: string }
  /** Turns already captured, seeded from the log so a resume does not recapture. */
  readonly captured: Set<number>
  /** Paths already declared, per turn, so one file edited twice is one spawn. */
  readonly declared: Map<number, Set<string>>
}

/**
 * Where a rewind's conversation half comes from. The fork is the host's
 * business, and a deployment that already has a correct one — the web client's
 * own fork, which also attaches the child to its workspace — should use it
 * rather than have this plugin build a second.
 */
export type RewindDestination
  /** This plugin forks the conversation and creates the child agent. */
  = | { readonly kind: 'fork' }
    /** The caller already forked; file the undo record in this session. */
    | { readonly kind: 'into'; readonly session: SessionId }

declare module '@deepseek-ai/cordis' {
  interface Context {
    filesnap: FilesnapRewind
  }
}

/** Refuse with a reason rather than throwing; every caller has to render it. */
function refuse<T>(refusal: RewindRefusal): RewindResult<T> {
  return { ok: false, refusal }
}

/** The engine's own words when it could not do what was asked. */
function engineRefusal<T>(run: FilesnapRun, what: string): RewindResult<T> {
  const detail = run.stderr === '' ? `filesnap exited ${run.exit}` : run.stderr
  return refuse({ kind: 'engine', message: `${what}: ${detail}` })
}

/**
 * The turn currently open in a session.
 *
 * Read from the log rather than tracked in memory: a resumed session is mid
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

/** Per-file failures, named individually because a terminal list has no bound (filesnap D40). */
function failures(run: FilesnapRun): { path: string; error: string }[] {
  return eventsOfType(run, 'restore.failed').map(event => ({
    path: stringField(event, 'path', '<unnamed>'),
    error: stringField(event, 'error', 'unreported'),
  }))
}

/**
 * Rewind and redo over a filesnap store.
 *
 * Registered as `ctx.filesnap`. The command handlers and the browser half both
 * go through it, so the sequencing exists once.
 */
export class FilesnapRewind extends Service {
  /**
   * Cordis reads an array as the required set and holds the fiber PENDING until
   * every name resolves; the object form is a name-to-config map, not a
   * required/optional split. `fs` and `agentPresets` are deliberately absent —
   * both are read through `ctx.get` at the moment they are needed, so a
   * deployment without a filesystem seam or per-session presets still gets a
   * working service rather than a plugin that never loads.
   */
  static inject = ['subprocess', 'agents']

  /** Validated deployment configuration. */
  private readonly config: FilesnapConfig

  /** Per-session state, dropped with the session it belongs to. */
  private readonly tracked = new WeakMap<Session, TrackState>()

  /** The invoker, built once the executable has been resolved. */
  private cli: Promise<FilesnapCli | { readonly unavailable: string }> | undefined

  constructor(ctx: Context, config: FilesnapConfig) {
    super(ctx, 'filesnap')
    this.config = config

    // **Registered here, on the service's own fiber.** An earlier version put
    // these on a `ctx.inject(['filesnap'], …)` child so they could not run
    // before the service existed. That child is disposed as soon as its
    // callback returns, and cordis unwinds a disposed fiber's effects — so the
    // listeners vanished, silently, and no turn was ever captured. A service
    // that registers its own listeners cannot drift out of step with itself.

    // After `next()`, so a step the deployment rejects does not pay for a scan
    // of the tree — and still before `step/start`, the model request, and every
    // tool the step goes on to call.
    ctx.on('agent/pre-step', async ({ agent, turn, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'enter') await this.capture(agent, turn, signal)
      return decision
    })

    if (config.declareEdits) {
      // Both are single-slot decision waterfalls: the first listener that
      // returns an intent owns the decision. This one owns nothing — it records
      // and then delegates, so whichever policy the deployment mounted still
      // decides.
      ctx.on('fs/write-intent', async (target, _actor, next): Promise<FsWriteIntent | undefined> => {
        await this.declareTarget(target)
        return next()
      })
      ctx.on('fs/edit-intent', async (target, _actor, next): Promise<{ version: FsVersion } | undefined> => {
        await this.declareTarget(target)
        return next()
      })
    }

    // Command availability follows plugin composition, and a headless run has
    // no registry at all. The service stays reachable either way.
    const commands = ctx.get('commands')
    if (commands !== undefined) registerCommands(commands, this)
  }

  /**
   * Report something a person may need to see.
   *
   * The logger is resolved through `ctx.get` rather than read as `ctx.logger`,
   * for the same reason the command registry is: cordis refuses a property
   * read for an undeclared service, and declaring the logger would hold this
   * fiber PENDING in an assembly that mounts none. Without one the line goes to
   * stderr, which is where prose belongs anyway.
   *
   * @param message - the line to report.
   */
  private warn(message: string): void {
    const logger = this.ctx.get('logger')
    if (logger === undefined) console.error(message)
    else logger.warn(message)
  }

  /**
   * Record one path's pre-edit state, if there is an agent to attribute it to.
   *
   * The filesystem waterfalls carry an opaque tool-execution context rather
   * than an agent, so the agent comes from the initiator scope the driver
   * established. A mutation with no initiator — a plugin writing on its own
   * account — is not part of any turn and is left alone.
   *
   * @param target - the resolved target about to change.
   */
  private async declareTarget(target: FsTarget): Promise<void> {
    let agent: Agent | undefined
    try {
      agent = this.ctx.agents.currentInitiator()
    } catch {
      // The registry is disposed, which means the tree is coming down. A
      // missing pre-image matters less than a teardown that throws out of a
      // file write.
      return
    }
    if (agent === undefined) return
    const fs = this.ctx.get('fs')
    if (fs === undefined) return
    await this.declare(agent, currentTurn(agent.session), [fs.processPath(target)])
  }

  /**
   * Resolve the `filesnap` executable once, lazily.
   *
   * Lazily because a deployment that has not installed it should still load:
   * the plugin then refuses each operation with a sentence naming the missing
   * command, which is a better failure than a tree that will not boot.
   *
   * @returns the invoker, or why the command could not be reached.
   */
  private invoker(): Promise<FilesnapCli | { readonly unavailable: string }> {
    const started = this.cli ?? this.start()
    this.cli = started
    return started
  }

  /**
   * Start the one executable lookup this service ever performs.
   *
   * @returns the invoker, or why the command could not be reached.
   */
  private start(): Promise<FilesnapCli | { readonly unavailable: string }> {
    return this.ctx.subprocess
      .resolveExecutable(this.config.command)
      .then((executable): FilesnapCli | { unavailable: string } => createFilesnapCli(this.ctx, {
        executable,
        dataDir: this.config.dataDir,
        timeoutMs: this.config.timeoutMs,
        graceMs: this.config.graceMs,
        maxOutputBytes: this.config.maxOutputBytes,
      }))
      .catch((error: unknown) => ({
        unavailable: `\`${this.config.command}\` could not be found (${String(error)}); `
          + 'install it with `cargo install filesnap-cli` or `npm i -g filesnap`, '
          + 'or set this plugin\'s `command` to its path',
      }))
  }

  /**
   * The per-session binding and its caches.
   *
   * `captured` is seeded from the log rather than kept only in memory: this
   * process may have resumed a session that already captured twenty turns, and
   * recapturing them would file a second manifest under a turn id that already
   * resolves to the first.
   *
   * @param session - the session to look up.
   * @returns its tracking state, created on first use.
   */
  private stateFor(session: Session): TrackState {
    const existing = this.tracked.get(session)
    if (existing !== undefined) return existing

    const cwd = session.header.cwd
    const admitted = admitSessionId(session.id)
    const binding: TrackState['binding'] = cwd === undefined
      ? { ok: false, why: 'the session has no working directory, and filesnap partitions a store by workspace' }
      : admitted.ok
        ? { ok: true, id: admitted.id, cwd }
        : { ok: false, why: `filesnap refuses the session id "${session.id}" because ${explain(admitted.refusal)}` }

    const captured = new Set<number>()
    for (const event of session.events) {
      if (event.type === 'filesnap/point') captured.add(event.data.turn)
    }
    const state: TrackState = { binding, captured, declared: new Map() }
    this.tracked.set(session, state)
    if (!binding.ok) {
      this.warn(`filesnap: session "${session.id}" is not being tracked — ${binding.why}`)
    }
    return state
  }

  /**
   * Capture the workspace as it stands at the start of one turn.
   *
   * Called from an awaited extension point on purpose: a capture that has not
   * finished when the first tool runs is a rewind point that is missing exactly
   * the files the turn is about to change. The cost is the scan's latency once
   * per turn, which is the same trade every per-turn snapshot makes.
   *
   * A failure is reported and swallowed. Refusing to run a turn because a
   * snapshot could not be taken would make an optional safety net into a
   * single point of failure for the whole product.
   *
   * @param agent - the agent whose turn is opening.
   * @param turn - the harness turn number.
   * @param signal - the turn's cancellation signal.
   */
  async capture(agent: Agent, turn: number, signal?: AbortSignal): Promise<void> {
    const session = agent.session
    const state = this.stateFor(session)
    if (!state.binding.ok || state.captured.has(turn)) return
    const point = pointId(state.binding.id, turn)
    if (!point.ok) {
      this.warn(
        `filesnap: turn ${String(turn)} of "${session.id}" cannot be captured — `
        + `the point id would be refused because ${explain(point.refusal)}`,
      )
      return
    }
    const cli = await this.invoker()
    if ('unavailable' in cli) {
      this.warn(`filesnap: no capture for turn ${String(turn)} — ${cli.unavailable}`)
      return
    }
    // Marked before the await settles rather than after: a second pre-step for
    // the same turn (a retried step, a steering claim) must not start a second
    // scan of the same tree.
    state.captured.add(turn)
    const run = await cli.run(
      ['capture', '--session', state.binding.id, '--turn', point.id, '--cwd', state.binding.cwd],
      state.binding.cwd,
      signal,
    )
    if (run.exit !== 'ok') {
      state.captured.delete(turn)
      this.warn(`filesnap: capture of turn ${String(turn)} did not complete — ${run.stderr}`)
      return
    }
    const done = lastEvent(run, 'capture.done')
    if (done === undefined) {
      state.captured.delete(turn)
      this.warn(`filesnap: capture of turn ${String(turn)} reported no terminal event`)
      return
    }
    session.append('filesnap/point', {
      turn,
      point: point.id,
      manifest: stringField(done, 'manifest', ''),
      reused: numberField(done, 'reused', 0),
      hashed: numberField(done, 'hashed', 0),
      dropped: numberField(done, 'dropped', 0),
    })
  }

  /**
   * Record what paths hold **before** an edit changes them.
   *
   * The caller says what it is about to change and never what the file used to
   * contain: filesnap stats and reads each path itself, so the pre-image rests
   * on an observation rather than a claim (filesnap D30). The cost of that
   * design is that calling late is silently wrong — declare after the write and
   * the stored "pre-image" is the post-edit content, with nothing to tell them
   * apart. Every call site here is on a decision waterfall that runs before the
   * provider mutates anything.
   *
   * @param agent - the agent whose turn owns the edit.
   * @param turn - the harness turn number.
   * @param paths - absolute paths about to change.
   * @param signal - the tool call's cancellation signal.
   */
  async declare(agent: Agent, turn: number, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    const state = this.stateFor(agent.session)
    if (!state.binding.ok || paths.length === 0) return
    const seen = state.declared.get(turn) ?? new Set<string>()
    state.declared.set(turn, seen)
    // A path already declared this turn is already in the manifest, so a second
    // call would be a no-op inside the engine — but it would still be a
    // process. One turn that edits one file twenty times stays one spawn.
    const fresh = paths.filter(path => !seen.has(path))
    if (fresh.length === 0) return
    const point = pointId(state.binding.id, turn)
    if (!point.ok) return
    const cli = await this.invoker()
    if ('unavailable' in cli) return
    for (const path of fresh) seen.add(path)
    const run = await cli.run(
      [
        'declare', '--session', state.binding.id, '--turn', point.id,
        '--cwd', state.binding.cwd,
        ...fresh.flatMap(path => ['--path', path]),
      ],
      state.binding.cwd,
      signal,
    )
    if (run.exit !== 'ok') {
      // Forget them, so the next edit of the same file tries again. The
      // pre-image is the one thing that cannot be recovered later.
      for (const path of fresh) seen.delete(path)
      this.warn(`filesnap: could not record pre-edit state for ${fresh.join(', ')} — ${run.stderr}`)
    }
  }

  /**
   * The points this session can be rewound to, newest last.
   *
   * Folded from the log and then intersected with what the store still holds,
   * because the two drift for ordinary reasons — `filesnap delete` ends a
   * session's data, and a store in a format this build does not understand is
   * refused rather than misread.
   *
   * @param agent - the agent whose session is being listed.
   * @param signal - caller cancellation.
   * @returns the available points, or why there are none to offer.
   */
  async points(agent: Agent, signal?: AbortSignal): Promise<RewindResult<RewindPoint[]>> {
    const state = this.stateFor(agent.session)
    if (!state.binding.ok) return refuse({ kind: 'untracked', why: state.binding.why })
    const cli = await this.invoker()
    if ('unavailable' in cli) return refuse({ kind: 'untracked', why: cli.unavailable })
    const logged = foldPoints(agent.session.events)
    if (logged.length === 0) return { ok: true, value: [] }
    const run = await cli.run(
      ['log', '--session', state.binding.id, '--cwd', state.binding.cwd],
      state.binding.cwd,
      signal,
    )
    if (run.exit !== 'ok') return engineRefusal(run, 'filesnap could not read the session log')
    const resolvable = new Set(eventsOfType(run, 'log.entry').map(event => stringField(event, 'turn', '')))
    return { ok: true, value: reconcile(logged, resolvable) }
  }

  /**
   * What the store holds for this workspace, and what it does not protect.
   *
   * **Re-scans.** The engine answers this by walking the tree again rather
   * than reading something a capture stored, because the question is about the
   * project as it stands now, not as it stood at some past turn. That is why
   * nothing calls this per turn: it costs what a capture costs.
   *
   * @param agent - the agent whose workspace is being asked about.
   * @param signal - caller cancellation.
   * @returns the workspace's protection and usage picture, or why it could not be read.
   */
  async status(agent: Agent, signal?: AbortSignal): Promise<RewindResult<FilesnapStatus>> {
    const state = this.stateFor(agent.session)
    if (!state.binding.ok) return refuse({ kind: 'untracked', why: state.binding.why })
    const cli = await this.invoker()
    if ('unavailable' in cli) return refuse({ kind: 'untracked', why: cli.unavailable })

    const run = await cli.run(['status', '--cwd', state.binding.cwd], state.binding.cwd, signal)
    if (run.exit !== 'ok') return engineRefusal(run, 'filesnap could not read this workspace')

    const usage = lastEvent(run, 'status.usage')
    return {
      ok: true,
      value: {
        workspace: stringField(lastEvent(run, 'status.workspace'), 'workspace', state.binding.cwd),
        sessions: eventsOfType(run, 'status.session').map(event => ({
          session: stringField(event, 'session', ''),
          turns: numberField(event, 'turns', 0),
          earliest: stringField(event, 'earliest', ''),
          latest: stringField(event, 'latest', ''),
        })),
        recordsBytes: numberField(usage, 'recordsBytes', 0),
        sharedContentBytes: numberField(usage, 'sharedContentBytes', 0),
        unprotected: eventsOfType(run, 'status.unprotected').map(event => ({
          path: stringField(event, 'path', '<unnamed>'),
          reason: stringField(event, 'reason', 'unreported'),
        })),
      },
    }
  }

  /**
   * Put the workspace and the conversation back to one point.
   *
   * @param agent - the agent being rewound out of.
   * @param selector - a turn number as listed, or a point id verbatim.
   * @param destination - fork here, or file the undo record in a session the caller already forked.
   * @param signal - caller cancellation.
   * @returns what the rewind did, or why it did not happen.
   */
  async rewind(
    agent: Agent,
    selector: string,
    destination: RewindDestination = { kind: 'fork' },
    signal?: AbortSignal,
  ): Promise<RewindResult<RewindOutcome>> {
    const state = this.stateFor(agent.session)
    if (!state.binding.ok) return refuse({ kind: 'untracked', why: state.binding.why })
    // A rewind while the agent is mid-turn would write over files the turn's
    // own tools are still using, and would fork a conversation whose last turn
    // has no end. Both halves need the agent standing still.
    if (agent.status === 'running') return refuse({ kind: 'agent-busy' })

    const available = await this.points(agent, signal)
    if (!available.ok) return available
    const point = selectPoint(available.value, selector)
    if (point === undefined) return refuse({ kind: 'unknown-point', point: selector })

    const child = destination.kind === 'into'
      ? { ok: true as const, value: destination.session }
      : await this.forkConversation(agent, point, signal)
    if (!child.ok) return child

    const childBinding = admitSessionId(child.value)
    if (!childBinding.ok) {
      return refuse({
        kind: 'fork-failed',
        message: `the forked session id "${child.value}" cannot hold an undo record because ${explain(childBinding.refusal)}`,
      })
    }

    const cli = await this.invoker()
    /* v8 ignore next -- points() already refused an unavailable command */
    if ('unavailable' in cli) return refuse({ kind: 'untracked', why: cli.unavailable })
    const run = await cli.run(
      [
        'restore', '--session', state.binding.id, '--turn', point.point,
        '--undo-for', childBinding.id, '--cwd', state.binding.cwd,
      ],
      state.binding.cwd,
      signal,
    )
    // `partial` is a completed restore that could not write every file, and its
    // terminal event still carries the counts and the point it can be reversed
    // to. Treating it as a failure would discard the only record of what landed.
    if (run.exit !== 'ok' && run.exit !== 'partial') {
      return engineRefusal(run, `filesnap could not restore turn ${String(point.turn)}`)
    }
    const done = lastEvent(run, 'restore.done')
    if (done === undefined) return engineRefusal(run, 'the restore reported no terminal event')

    const written = numberField(done, 'written', 0)
    const deleted = numberField(done, 'deleted', 0)
    const failed = failures(run)
    const safety = stringField(done, 'safety', '')
    // Recorded in the session the user is leaving, after the fork, so it is not
    // part of the child's seed — the child's history ends before the turn this
    // rewound to, and a marker inside it would describe a rewind it never had.
    const record = agent.session.append('filesnap/rewound', {
      point: point.point,
      turn: point.turn,
      child: child.value,
      boundary: point.boundary,
      written,
      deleted,
      failed: failed.length,
      safety,
    })
    const outcome: RewindOutcome = {
      point,
      child: child.value,
      written,
      deleted,
      failures: failed,
      safety,
      eventSeq: record.seq,
    }
    return { ok: true, value: outcome }
  }

  /**
   * Reverse the rewind that landed in this session.
   *
   * The undo record is filed under the session a rewind switched *to*, which is
   * where the user is standing when they ask for it, and which no other session
   * can reach — so two conversations in one directory cannot consume each
   * other's undos.
   *
   * @param agent - the agent to reverse the rewind in.
   * @param signal - caller cancellation.
   * @returns what the undo did, or why it did not happen.
   */
  async redo(agent: Agent, signal?: AbortSignal): Promise<RewindResult<RedoOutcome>> {
    const state = this.stateFor(agent.session)
    if (!state.binding.ok) return refuse({ kind: 'untracked', why: state.binding.why })
    if (agent.status === 'running') return refuse({ kind: 'agent-busy' })
    const cli = await this.invoker()
    if ('unavailable' in cli) return refuse({ kind: 'untracked', why: cli.unavailable })

    const run = await cli.run(
      ['undo', '--session', state.binding.id, '--cwd', state.binding.cwd],
      state.binding.cwd,
      signal,
    )
    // `partial` here also covers a clean undo that found paths changed since
    // the rewind: they are reported, not refused, because the safety checkpoint
    // captured them before this wrote over them.
    if (run.exit !== 'ok' && run.exit !== 'partial') {
      return engineRefusal(run, 'filesnap could not reverse the rewind')
    }
    const done = lastEvent(run, 'restore.done')
    if (done === undefined) return engineRefusal(run, 'the undo reported no terminal event')

    const conflicts = eventsOfType(run, 'undo.conflict').map(event => stringField(event, 'path', '<unnamed>'))
    const written = numberField(done, 'written', 0)
    const deleted = numberField(done, 'deleted', 0)
    const failed = failures(run)
    const safety = stringField(done, 'safety', '')
    const record = agent.session.append('filesnap/redone', {
      written,
      deleted,
      failed: failed.length,
      safety,
      conflicts: [...conflicts],
    })
    return {
      ok: true,
      value: { written, deleted, failures: failed, safety, conflicts, eventSeq: record.seq },
    }
  }

  /**
   * Fork the conversation at a point's boundary and publish an agent on it.
   *
   * Composition is inherited rather than chosen: the seeded history was
   * produced under the parent's preset and model route, and a child composed
   * differently would replay tool calls it can no longer make.
   *
   * @param agent - the source agent.
   * @param point - the point whose boundary the cut follows.
   * @param signal - creation-only cancellation.
   * @returns the child session id, or why the fork did not happen.
   */
  private async forkConversation(
    agent: Agent,
    point: RewindPoint,
    signal?: AbortSignal,
  ): Promise<RewindResult<SessionId>> {
    const source = agent.session
    const seed = source.events.slice(0, point.boundary + 1)
    const openTurn = seed.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
    if (openTurn?.type === 'turn/start') {
      return refuse({
        kind: 'fork-failed',
        message: `event ${String(point.boundary)} is inside open turn ${String(openTurn.data.turn)}`,
      })
    }
    const childId = brandSessionId(`session-${crypto.randomUUID()}`)
    const composition = await this.composition(source)
    try {
      await this.ctx.agents.create({
        sessionId: childId,
        seed,
        meta: {
          ...source.header.cwd === undefined ? {} : { cwd: source.header.cwd },
          parentSession: source.id,
          seedLength: seed.length,
          ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
        },
        agentOptions: agent.options,
        ...composition.setup === undefined ? {} : { setup: composition.setup },
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      return refuse({ kind: 'fork-failed', message: String(error) })
    }
    return { ok: true, value: childId }
  }

  /**
   * The child's scoped composition, when the deployment composes per session.
   *
   * `agentPresets` is optional, and its absence is the ordinary case for a
   * deployment that mounts one fixed agent. The dynamic import is reached only
   * once the service proves the package is installed.
   *
   * @param source - the session being forked.
   * @returns the preset id to record and the setup that mounts it.
   */
  private async composition(source: Session): Promise<{
    agentPreset?: string
    setup?: (agentCtx: Context) => Promise<void>
  }> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return {}
    const { resolveSessionPreset } = await import('@deepseek-ai/dsh-agent-presets')
    const resolved = await presets.resolve(resolveSessionPreset(source))
    return {
      agentPreset: resolved.id,
      setup: async (agentCtx: Context) => void await presets.mount(agentCtx, resolved.id),
    }
  }
}

export default FilesnapRewind

/** Re-exported so a consumer can name the log's own event shape. */
export type { SessionEvent }
