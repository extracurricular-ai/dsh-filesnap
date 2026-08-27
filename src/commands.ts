/**
 * `/rewind` and `/redo` — the human surface.
 *
 * They dispatch without a model turn, which is the point: rewinding is
 * something the user does *to* the conversation, and routing it through the
 * model would put the decision in the hands of the thing being rewound.
 *
 * `/rewind` with no argument lists rather than acts. filesnap addresses a
 * restore by turn id and refuses relative addressing (filesnap D35) because the
 * cost of landing on the wrong point is the user's files; the list is what
 * makes that usable, since whoever counts is counting against something they
 * are looking at.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { RewindDestination } from './service.ts'
import type { RedoOutcome, RewindOutcome, RewindPoint, RewindRefusal } from './types.ts'

/** What `/rewind` accepts, echoed back on a usage error. */
const REWIND_USAGE = 'Usage: /rewind [<turn>|<point id>] [--into <session id>]'
  + ' — with no argument, lists the points this session can return to.'

/** One parsed `/rewind` invocation. */
export type RewindCommand
  /** No argument: show the list rather than act on it. */
  = | { readonly kind: 'list' }
    /** Rewind, forking the conversation here or filing into a caller's fork. */
    | { readonly kind: 'rewind'; readonly selector: string; readonly into?: string }
    /** The words do not form a `/rewind`. */
    | { readonly kind: 'usage' }

/**
 * Parse only the grammar `/rewind` owns.
 *
 * `--into` exists for a caller that has already forked the conversation
 * through the deployment's own fork — the web client's, which also attaches
 * the child to its workspace. Without it, that caller's only route would be to
 * have this plugin build a second fork beside the correct one.
 *
 * @param rawInput - everything after the command name.
 * @returns what the user asked for.
 */
export function parseRewind(rawInput: string): RewindCommand {
  const words = rawInput.trim().split(/\s+/u).filter(word => word !== '')
  if (words.length === 0) return { kind: 'list' }
  const [selector, ...rest] = words
  /* v8 ignore next -- a non-empty word list has a first word */
  if (selector === undefined) return { kind: 'usage' }
  if (selector.startsWith('--')) return { kind: 'usage' }
  if (rest.length === 0) return { kind: 'rewind', selector }
  if (rest.length !== 2 || rest[0] !== '--into') return { kind: 'usage' }
  const into = rest[1]
  if (into === undefined || into === '') return { kind: 'usage' }
  return { kind: 'rewind', selector, into }
}

/**
 * Render a refusal as one direct sentence.
 *
 * @param refusal - why the operation did not happen.
 * @returns the command result a UI shows.
 */
function refusalResult(refusal: RewindRefusal): CommandResult {
  switch (refusal.kind) {
    case 'untracked':
      return { kind: 'error', text: `This session has no snapshots: ${refusal.why}.` }
    case 'unknown-point':
      return { kind: 'error', text: `No rewind point named "${refusal.point}". Run /rewind to see the list.` }
    case 'agent-busy':
      return { kind: 'error', text: 'The agent is mid-turn. Stop it first, then rewind.' }
    case 'fork-failed':
      return { kind: 'error', text: `The conversation could not be forked: ${refusal.message}` }
    case 'engine':
      return { kind: 'error', text: refusal.message }
    /* v8 ignore next 2 -- RewindRefusal is closed and every member is handled above */
    default:
      throw new TypeError(`unknown refusal kind: ${String(refusal)}`)
  }
}

/**
 * Render the list of points, oldest first.
 *
 * @param points - what this session can return to.
 * @returns the command result a UI shows.
 */
function listResult(points: readonly RewindPoint[]): CommandResult {
  if (points.length === 0) {
    return {
      kind: 'success',
      text: 'No rewind points yet. One is taken at the start of each turn, so the first appears after this session\'s next turn.',
    }
  }
  const rows = points.map((point) => {
    const when = new Date(point.at).toISOString().replace('T', ' ').slice(0, 19)
    const label = point.label ?? '(no user message)'
    return `  ${String(point.turn).padStart(4)}  ${when}  ${label}`
  })
  return {
    kind: 'success',
    text: [
      'Rewind points — the workspace as it stood before each turn:',
      '',
      '  turn  when                 opened by',
      ...rows,
      '',
      'Rewind with /rewind <turn>. The conversation forks at that point and the files go back with it.',
    ].join('\n'),
  }
}

/**
 * Render a completed rewind.
 *
 * A rewind with failures must not read as an uneventful success anywhere
 * (filesnap D28), so the failures are named and the safety id is offered.
 *
 * @param outcome - what the rewind did.
 * @returns the command result a UI shows.
 */
function rewindResult(outcome: RewindOutcome): CommandResult {
  const label = outcome.point.label === undefined ? '' : ` (${outcome.point.label})`
  const lines = [
    `Rewound to turn ${String(outcome.point.turn)}${label}.`,
    `Files: ${String(outcome.written)} written, ${String(outcome.deleted)} deleted.`,
  ]
  if (outcome.failures.length > 0) {
    lines.push(
      '',
      `${String(outcome.failures.length)} file(s) could not be written:`,
      ...outcome.failures.map(failure => `  ${failure.path} — ${failure.error}`),
      '',
      'The rest of the rewind landed. /redo reverses all of it.',
    )
  }
  lines.push(
    '',
    `The conversation continues in ${outcome.child}.`,
    'Run /redo there to reverse this rewind.',
  )
  return { kind: 'success', text: lines.join('\n'), sourceEventSeq: outcome.eventSeq }
}

/**
 * Render a completed redo.
 *
 * @param outcome - what the undo did.
 * @returns the command result a UI shows.
 */
function redoResult(outcome: RedoOutcome): CommandResult {
  const lines = [
    'Rewind reversed.',
    `Files: ${String(outcome.written)} written, ${String(outcome.deleted)} deleted.`,
  ]
  if (outcome.conflicts.length > 0) {
    lines.push(
      '',
      `${String(outcome.conflicts.length)} path(s) had changed since the rewind and were overwritten:`,
      ...outcome.conflicts.map(path => `  ${path}`),
      '',
      `Those changes were captured first and are recoverable from safety point ${outcome.safety}.`,
    )
  }
  if (outcome.failures.length > 0) {
    lines.push(
      '',
      `${String(outcome.failures.length)} file(s) could not be written:`,
      ...outcome.failures.map(failure => `  ${failure.path} — ${failure.error}`),
    )
  }
  return { kind: 'success', text: lines.join('\n'), sourceEventSeq: outcome.eventSeq }
}

/**
 * Execute one `/rewind` invocation.
 *
 * @param ctx - a context carrying `ctx.filesnap`.
 * @param invocation - the dispatching UI's invocation.
 * @returns the command result a UI shows.
 */
async function runRewind(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const command = parseRewind(invocation.rawInput)
  if (command.kind === 'usage') return { kind: 'error', text: REWIND_USAGE }
  if (command.kind === 'list') {
    const points = await ctx.filesnap.points(invocation.agent, invocation.signal)
    return points.ok ? listResult(points.value) : refusalResult(points.refusal)
  }
  const destination: RewindDestination = command.into === undefined
    ? { kind: 'fork' }
    : { kind: 'into', session: SessionId(command.into) }
  const outcome = await ctx.filesnap.rewind(invocation.agent, command.selector, destination, invocation.signal)
  return outcome.ok ? rewindResult(outcome.value) : refusalResult(outcome.refusal)
}

/**
 * Execute one `/redo` invocation.
 *
 * @param ctx - a context carrying `ctx.filesnap`.
 * @param invocation - the dispatching UI's invocation.
 * @returns the command result a UI shows.
 */
async function runRedo(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') {
    return { kind: 'error', text: 'Usage: /redo — reverses the rewind that landed in this session. It takes no argument.' }
  }
  const outcome = await ctx.filesnap.redo(invocation.agent, invocation.signal)
  return outcome.ok ? redoResult(outcome.value) : refusalResult(outcome.refusal)
}

/**
 * Register both commands, when the deployment has a command registry.
 *
 * @param ctx - a context carrying `ctx.commands` and `ctx.filesnap`.
 */
export function registerCommands(ctx: Context): void {
  ctx.commands.register({
    name: 'rewind',
    description: 'put the workspace and the conversation back to the start of an earlier turn',
    input: { hint: '[<turn>|<point id>] [--into <session id>]' },
    handler: invocation => runRewind(ctx, invocation),
  })
  ctx.commands.register({
    name: 'redo',
    description: 'reverse the rewind that landed in this session',
    handler: invocation => runRedo(ctx, invocation),
  })
}
