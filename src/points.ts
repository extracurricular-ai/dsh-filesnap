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
 * The fold is written as a **reducer over one event at a time**, because the
 * projection seam drives exactly that shape and a second whole-log
 * implementation beside it would be one more thing to keep in step.
 * {@link foldPoints} is the batch form of the same transition.
 *
 * @module
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RewindPoint, RewindRecord } from './wire.ts'

/** How much of a user's opening message labels a point in a list. */
const LABEL_MAX_CHARS = 72

/**
 * Accumulated reader state.
 *
 * Plain JSON, and deliberately so: the projection cache persists it between
 * processes, which rules out `undefined` and any exotic object. `openTurn` is
 * `null` rather than absent for the same reason.
 */
export interface PointsState {
  /** The points found so far, in conversation order. */
  readonly points: readonly RewindPoint[]
  /** The turn currently open, so a `user/message` knows which point it labels. */
  readonly openTurn: number | null
  /** Seq the open turn started at, for the boundary one before it. */
  readonly openTurnStart: number
  /** Where the last rewind out of this session went, when there was one. */
  readonly lastRewind?: RewindRecord | undefined
}

/**
 * The reader state for an empty log.
 *
 * @returns a fresh initial state.
 */
export function initialPoints(): PointsState {
  return { points: [], openTurn: null, openTurnStart: 0 }
}

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
 * Fold one committed event into the reader state.
 *
 * **Returns the same reference when the event is not this reader's.** The
 * projection seam treats an unchanged reference as zero downstream work, and
 * most events in a session — every chunk, every tool result — are not this
 * reader's.
 *
 * @param state - the state covering every prior event.
 * @param event - the next committed event.
 * @returns the next state, or `state` itself when nothing changed.
 */
export function reducePoints(state: PointsState, event: SessionEvent): PointsState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, openTurn: event.data.turn, openTurnStart: event.seq }
    case 'turn/end':
      return state.openTurn === null ? state : { ...state, openTurn: null }
    case 'filesnap/point': {
      // The capture is placed by the turn it names rather than by whichever
      // turn happens to be open: a fork can seed a child with a point whose
      // turn boundaries are already in the seed, and the seq arithmetic has to
      // follow the recorded turn, not the reader's cursor.
      const boundary = event.data.turn === state.openTurn ? state.openTurnStart - 1 : event.seq - 1
      const known = state.points.find(point => point.turn === event.data.turn)
      const fresh: RewindPoint = {
        point: event.data.point,
        turn: event.data.turn,
        boundary,
        at: event.time,
        ...known?.label === undefined ? {} : { label: known.label },
      }
      return {
        ...state,
        points: known === undefined
          ? [...state.points, fresh]
          : state.points.map(point => point.turn === event.data.turn ? fresh : point),
      }
    }
    case 'filesnap/rewound':
      return {
        ...state,
        lastRewind: {
          point: event.data.point,
          turn: event.data.turn,
          child: event.data.child,
          at: event.time,
        },
      }
    case 'user/message': {
      // Only a direct human prompt labels a point. Injected context — file
      // notices, skill content, goal continuations — is a user-role message
      // too, and labelling a rewind point with one would name something the
      // user never wrote.
      const turn = state.openTurn
      if (turn === null || event.data.source.kind !== 'user') return state
      const known = state.points.find(point => point.turn === turn)
      if (known !== undefined && known.label !== undefined) return state
      const text = label(event.data.content)
      if (text === undefined) return state
      // A message can arrive before its turn's capture. The label is held on
      // the point when one exists and is re-read from the state when the
      // capture lands, so neither has to come first.
      const placeholder: RewindPoint = { point: '', turn, boundary: state.openTurnStart - 1, at: event.time, label: text }
      return {
        ...state,
        points: known === undefined
          ? [...state.points, placeholder]
          : state.points.map(point => point.turn === turn ? { ...point, label: text } : point),
      }
    }
    default:
      // Every other event type is someone else's business. This is a
      // merge-extensible map, so the default is a fall-through rather than an
      // exhaustiveness check — and returning `state` unchanged is what makes
      // the projection's change detection free.
      return state
  }
}

/**
 * The points a log holds, oldest first.
 *
 * A turn appears only if its capture succeeded and recorded a
 * `filesnap/point`; a turn whose capture failed is deliberately absent rather
 * than listed and refused on use.
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
  return capturedPoints(events.reduce(reducePoints, initialPoints()))
}

/**
 * The captured points in a reader state.
 *
 * A turn that was labelled but never captured holds a placeholder with no
 * point id, which is not a rewind target: dropping it here keeps the list to
 * things `restore` will accept.
 *
 * @param state - a folded reader state.
 * @returns the points that name a snapshot.
 */
export function capturedPoints(state: PointsState): RewindPoint[] {
  return state.points.filter(point => point.point !== '')
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
