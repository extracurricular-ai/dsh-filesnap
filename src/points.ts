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
  /**
   * The most recent assistant message and the turn it belongs to.
   *
   * A point for turn N hangs its control under the message that closed turn
   * N-1, because restoring it lands the workspace where that turn left it.
   * Held here rather than searched for later: the reader sees each message
   * once, and the point that wants it arrives afterwards.
   */
  readonly lastMessage: { readonly turn: number; readonly id: string; readonly seq: number } | null
  /** Where the last rewind out of this session went, when there was one. */
  readonly lastRewind?: RewindRecord | undefined
}

/**
 * The reader state for an empty log.
 *
 * @returns a fresh initial state.
 */
export function initialPoints(): PointsState {
  return { points: [], openTurn: null, lastMessage: null }
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
      return { ...state, openTurn: event.data.turn }
    case 'turn/end':
      return state.openTurn === null ? state : { ...state, openTurn: null }
    case 'filesnap/point': {
      // Anchored on the message that closed the PREVIOUS turn, because that is
      // the turn a fork has to keep: this point holds the workspace as it was
      // when that turn finished. Anchoring inside this turn instead — or one
      // event before it opened, which the host rounds forward to this turn's
      // own `turn/end` — would keep the turn whose effects the restore undoes,
      // and the conversation would claim work the files no longer show.
      const anchor = state.lastMessage?.turn === event.data.turn - 1 ? state.lastMessage : undefined
      const known = state.points.find(point => point.turn === event.data.turn)
      const fresh: RewindPoint = {
        point: event.data.point,
        turn: event.data.turn,
        at: event.time,
        ...known?.label === undefined ? {} : { label: known.label },
        // The anchor and the message it names are one fact, so they are set
        // together or not at all: a control that renders without a usable
        // anchor would fork somewhere nobody asked for.
        ...anchor === undefined
          ? {
              ...known?.boundary === undefined ? {} : { boundary: known.boundary },
              ...known?.messageId === undefined ? {} : { messageId: known.messageId },
            }
          : { boundary: anchor.seq, messageId: anchor.id },
        // A log written before the plugin reported these carries neither
        // field; `numberField`-shaped defaults would invent a zero that reads
        // as "nothing tracked" rather than "not recorded".
        ...typeof event.data.reused !== 'number' || typeof event.data.hashed !== 'number'
          ? {}
          : { coverage: { reused: event.data.reused, hashed: event.data.hashed, dropped: event.data.dropped } },
      }
      return {
        ...state,
        points: known === undefined
          ? [...state.points, fresh]
          : state.points.map(point => point.turn === event.data.turn ? fresh : point),
      }
    }
    case 'assistant/message': {
      // Recorded on the point rather than derived later: only the log knows
      // which message closed which turn, and the browser sees message ids
      // without seeing turns.
      //
      // Every message of a turn overwrites the one before it, so what survives
      // is the last — the bubble the control belongs under. The point that
      // wants it is the NEXT turn's, which normally arrives later; the update
      // below covers the seed order where it did not.
      const lastMessage = { turn: event.data.turn, id: event.data.message.id, seq: event.seq }
      const target = state.points.find(point => point.turn === event.data.turn + 1)
      if (target === undefined) return { ...state, lastMessage }
      if (target.messageId === lastMessage.id && target.boundary === lastMessage.seq) {
        return { ...state, lastMessage }
      }
      return {
        ...state,
        lastMessage,
        points: state.points.map(point =>
          point.turn === lastMessage.turn + 1
            ? { ...point, messageId: lastMessage.id, boundary: lastMessage.seq }
            : point),
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
      const placeholder: RewindPoint = { point: '', turn, at: event.time, label: text }
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
 * Drop the points **this session captured** that the store no longer holds.
 *
 * The narrowing matters. `filesnap log` answers per session, while a turn
 * resolves through the workspace's turn index and is independent of any
 * session — so a forked session, whose log carries its parent's points
 * verbatim and which has captured nothing of its own, gets an empty listing
 * back and would lose every point it can actually reach. Every point a freshly
 * forked session has is an inherited one, which made this the common case
 * rather than an edge.
 *
 * A point is this session's when this session's own id and that point's turn
 * would mint it. Recomputed rather than parsed out of the id: the minting rule
 * lives in one place and this asks it, instead of re-deriving it from a string.
 *
 * The two records still drift for ordinary reasons — `filesnap delete` ends a
 * session's data — and offering a point the store cannot resolve is a listing
 * of options that are not options. That is what this still removes.
 *
 * @param points - what the log remembers, from {@link foldPoints}.
 * @param resolvable - turn ids `filesnap log` reported for this session.
 * @param mintedHere - the point ids this session would mint for the turns it holds.
 * @returns the points still worth offering, in the same order.
 */
export function reconcile(
  points: readonly RewindPoint[],
  resolvable: ReadonlySet<string>,
  mintedHere: ReadonlySet<string>,
): RewindPoint[] {
  return points.filter(point => !mintedHere.has(point.point) || resolvable.has(point.point))
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
