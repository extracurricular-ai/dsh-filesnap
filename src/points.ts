/**
 * Which points a session can be rewound to, folded from its own log.
 *
 * filesnap addresses a restore by turn id and nothing else — no "go back N"
 * (filesnap D35), because the cost of landing on the wrong point is the user's
 * files and an off-by-one in a relative index is easy to make and easy to
 * miss. The convenience is not lost, it moves: whoever counts, counts against
 * a list they are looking at. This module builds that list.
 *
 * It is built from the **session log**, not from `filesnap log`. The two
 * answer different questions. The engine knows which manifests exist in this
 * workspace; only the log knows which of them belong to *this* conversation,
 * where each turn sits in it, and what the user typed to open it — and a fork
 * carries the log into the child, so an inherited point stays addressable in a
 * session that has not run a turn yet. `filesnap log` remains the authority on
 * what the store still holds, which is why {@link reconcile} exists.
 *
 * @module
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RewindPoint } from './types.ts'

/** How much of a user's opening message labels a point in a list. */
const LABEL_MAX_CHARS = 72

/**
 * First line of a message's visible text, trimmed to a list-sized label.
 *
 * Reasoning and non-text blocks are skipped rather than rendered: the label
 * answers "which of my messages was this", and an image or a tool result never
 * opened a turn the user would recognize.
 *
 * @param content - the message's model-facing blocks.
 * @returns the label, or undefined when the message carries no visible text.
 */
function label(content: readonly { type: string; text?: string }[]): string | undefined {
  const text = content.find(block => block.type === 'text')?.text
  if (text === undefined) return undefined
  const firstLine = text.split('\n').find(line => line.trim() !== '')
  if (firstLine === undefined) return undefined
  const trimmed = firstLine.trim()
  return trimmed.length <= LABEL_MAX_CHARS
    ? trimmed
    : `${trimmed.slice(0, LABEL_MAX_CHARS - 1)}…`
}

/**
 * Fold a session's events into the points it can be rewound to.
 *
 * One point per captured turn, in the order the session ran. A turn appears
 * only if its capture succeeded and recorded a `filesnap/point`; a turn whose
 * capture failed is deliberately absent rather than listed and refused on use.
 *
 * The `boundary` each point carries is the seq of the event *before* its turn
 * opened, which is the last `turn/end` (or nothing, for the first turn). That
 * is the cut a fork needs: a prefix ending inside an open turn is rejected, and
 * cutting at the `turn/start` itself would land the child holding an opened
 * turn it never ran.
 *
 * @param events - the session log, in order.
 * @returns the points, oldest first.
 */
export function foldPoints(events: readonly SessionEvent[]): RewindPoint[] {
  /** Captured turns, keyed by harness turn number. */
  const captured = new Map<number, { point: string; boundary: number; at: number }>()
  /** Opening messages, kept apart from the captures so neither has to arrive first. */
  const labels = new Map<number, string>()
  /** Turn currently open, so a `user/message` knows which point it labels. */
  let openTurn: number | undefined
  /** Seq the open turn started at, for the boundary one before it. */
  let openTurnStart = 0
  /** Turn order of first capture, so the list runs in conversation order. */
  const order: number[] = []

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        openTurnStart = event.seq
        break
      case 'turn/end':
        openTurn = undefined
        break
      case 'filesnap/point': {
        // The capture is attached to the turn it names rather than to whichever
        // turn happens to be open: a fork can seed a child with a point whose
        // turn boundaries are already in the seed, and the seq arithmetic has
        // to follow the recorded turn, not the reader's cursor.
        const boundary = event.data.turn === openTurn ? openTurnStart - 1 : event.seq - 1
        if (!captured.has(event.data.turn)) order.push(event.data.turn)
        captured.set(event.data.turn, { point: event.data.point, boundary, at: event.time })
        break
      }
      case 'user/message': {
        // Only a direct human prompt labels a point. Injected context — file
        // notices, skill content, goal continuations — is a user-role message
        // too, and labelling a rewind point with one would name something the
        // user never wrote.
        if (openTurn === undefined || event.data.source.kind !== 'user') break
        if (labels.has(openTurn)) break
        const text = label(event.data.content)
        if (text !== undefined) labels.set(openTurn, text)
        break
      }
      default:
        // Every other event type is someone else's business. This is a
        // merge-extensible map, so the default is a fall-through rather than
        // an exhaustiveness check.
        break
    }
  }

  // Joined at the end rather than as the events arrive, so the capture and the
  // message that labels it may appear in either order. They do have one fixed
  // order today — the capture runs in pre-step, ahead of the entered
  // messages — but that is the loop's business, not this reader's.
  return order.flatMap((turn) => {
    const point = captured.get(turn)
    /* v8 ignore next -- `order` only gains a turn as `captured` gains it */
    if (point === undefined) return []
    const text = labels.get(turn)
    return [{
      point: point.point,
      turn,
      boundary: point.boundary,
      at: point.at,
      ...text === undefined ? {} : { label: text },
    }]
  })
}

/**
 * Keep the points the store can still resolve.
 *
 * The two records drift for ordinary reasons: `filesnap delete` ends a
 * session's data, and a store from an older format version is left alone
 * rather than read. A point the log remembers and the store cannot resolve is
 * not an error — it is a rewind that is no longer available, and offering it
 * would be a listing of options that are not options.
 *
 * @param points - what the log remembers, from {@link foldPoints}.
 * @param resolvable - turn ids `filesnap log` reported for this session.
 * @returns the points that are still rewind targets, in the same order.
 */
export function reconcile(
  points: readonly RewindPoint[],
  resolvable: ReadonlySet<string>,
): RewindPoint[] {
  return points.filter(point => resolvable.has(point.point))
}

/**
 * Resolve what a user typed into one point.
 *
 * Two spellings are accepted, and both name the list rather than an index into
 * history: the turn number as shown, or the point id verbatim. A bare number is
 * read as a turn because that is what the list shows; there is no positional
 * form, deliberately.
 *
 * @param points - the available points, oldest first.
 * @param input - the user's argument, already trimmed.
 * @returns the named point, or undefined when nothing matches.
 */
export function selectPoint(points: readonly RewindPoint[], input: string): RewindPoint | undefined {
  const exact = points.find(point => point.point === input)
  if (exact !== undefined) return exact
  if (!/^\d+$/u.test(input)) return undefined
  const turn = Number(input)
  return points.find(point => point.turn === turn)
}
