import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { capturedPoints, foldPoints, initialPoints, reconcile, reducePoints, selectPoint } from '../src/points.ts'

/** Build a contiguous log the way the store does: `seq` is the position. */
function log(...entries: readonly { type: string; data: unknown; time?: number }[]): SessionEvent[] {
  return entries.map((entry, seq) => ({
    seq,
    time: entry.time ?? 1_000 + seq,
    type: entry.type,
    data: entry.data,
  })) as unknown as SessionEvent[]
}

/**
 * One captured turn in the order the loop writes it: the turn opens, pre-step
 * captures, the entered message is appended, the turn closes.
 */
function turn(n: number, text: string): { type: string; data: unknown }[] {
  return [
    { type: 'turn/start', data: { turn: n } },
    { type: 'filesnap/point', data: { turn: n, point: `s.t${String(n)}`, manifest: 'm', reused: 0, hashed: 0, dropped: 0 } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } },
    { type: 'turn/end', data: { turn: n, reason: 'natural' } },
  ]
}

describe('foldPoints', () => {
  it('reports one point per captured turn, in conversation order', () => {
    const points = foldPoints(log(...turn(1, 'first'), ...turn(2, 'second')))
    expect(points.map(point => point.turn)).toEqual([1, 2])
    expect(points.map(point => point.point)).toEqual(['s.t1', 's.t2'])
  })

  it('puts the boundary before the turn opened, never inside it', () => {
    // A fork rejects a prefix ending inside an open turn, and cutting at the
    // `turn/start` itself would hand the child a turn it never ran.
    const events = log(...turn(1, 'first'), ...turn(2, 'second'))
    const points = foldPoints(events)
    expect(points[0]?.boundary).toBe(-1)
    expect(points[1]?.boundary).toBe(3)
    expect(events[3]?.type).toBe('turn/end')
  })

  it('labels a point with the message that opened its turn', () => {
    const points = foldPoints(log(...turn(1, 'rename the widget\nand its tests')))
    expect(points[0]?.label).toBe('rename the widget')
  })

  it('does not label a point with injected context the user never wrote', () => {
    const points = foldPoints(log(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'filesnap/point', data: { turn: 1, point: 's.t1', manifest: 'm', reused: 0, hashed: 0, dropped: 0 } },
      {
        type: 'user/message',
        data: {
          role: 'user',
          content: [{ type: 'text', text: 'Files changed on disk.' }],
          source: { kind: 'plugin', plugin: 'fs-notice' },
        },
      },
      { type: 'turn/end', data: { turn: 1, reason: 'natural' } },
    ))
    expect(points[0]?.label).toBeUndefined()
  })

  it('keeps the first human message when a turn carries several', () => {
    const points = foldPoints(log(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'filesnap/point', data: { turn: 1, point: 's.t1', manifest: 'm', reused: 0, hashed: 0, dropped: 0 } },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } } },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'steering' }], source: { kind: 'user' } } },
      { type: 'turn/end', data: { turn: 1, reason: 'natural' } },
    ))
    expect(points[0]?.label).toBe('first')
  })

  it('labels a point whose message was logged before the capture', () => {
    // The loop captures ahead of the entered messages today. This reader does
    // not depend on that, because a log is read long after it was written.
    const points = foldPoints(log(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'early' }], source: { kind: 'user' } } },
      { type: 'filesnap/point', data: { turn: 1, point: 's.t1', manifest: 'm', reused: 0, hashed: 0, dropped: 0 } },
      { type: 'turn/end', data: { turn: 1, reason: 'natural' } },
    ))
    expect(points[0]?.label).toBe('early')
  })

  it('leaves an image-only turn unlabelled rather than inventing text', () => {
    const points = foldPoints(log(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'filesnap/point', data: { turn: 1, point: 's.t1', manifest: 'm', reused: 0, hashed: 0, dropped: 0 } },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'image' }], source: { kind: 'user' } } },
      { type: 'turn/end', data: { turn: 1, reason: 'natural' } },
    ))
    expect(points[0]?.label).toBeUndefined()
  })

  it('trims a long opening line to a list-sized label', () => {
    const long = 'x'.repeat(200)
    const points = foldPoints(log(...turn(1, long)))
    expect(points[0]?.label).toHaveLength(72)
    expect(points[0]?.label?.endsWith('…')).toBe(true)
  })

  it('omits a turn whose capture never landed', () => {
    const points = foldPoints(log(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'a' }], source: { kind: 'user' } } },
      { type: 'turn/end', data: { turn: 1, reason: 'natural' } },
      ...turn(2, 'b'),
    ))
    expect(points.map(point => point.turn)).toEqual([2])
  })

  it('survives a seed whose turn boundaries were inherited from a parent', () => {
    // A forked child carries its parent's events verbatim. The point's own
    // recorded turn is what places it, not wherever the reader's cursor is.
    const points = foldPoints(log(
      ...turn(1, 'inherited'),
      { type: 'session/end-seed', data: {} },
      ...turn(2, 'own work'),
    ))
    expect(points.map(point => point.turn)).toEqual([1, 2])
    expect(points[1]?.boundary).toBe(4)
  })

  it('reports nothing for a session that has captured nothing', () => {
    expect(foldPoints(log({ type: 'turn/start', data: { turn: 1 } }))).toEqual([])
    expect(foldPoints([])).toEqual([])
  })
})

describe('reconcile', () => {
  /** Both fixture turns are this session's own. */
  const own = new Set(['s.t1', 's.t2'])

  it('drops a point this session captured that the store no longer holds', () => {
    const points = foldPoints(log(...turn(1, 'a'), ...turn(2, 'b')))
    expect(reconcile(points, new Set(['s.t2']), own).map(point => point.turn)).toEqual([2])
  })

  it('keeps the log order', () => {
    const points = foldPoints(log(...turn(1, 'a'), ...turn(2, 'b')))
    expect(reconcile(points, new Set(['s.t2', 's.t1']), own).map(point => point.turn)).toEqual([1, 2])
  })

  it('keeps a point another session minted, whatever this session\'s listing says', () => {
    // A forked session's log carries its parent's points and its own listing is
    // empty, so filtering on that listing would leave it with nothing to offer.
    const points = foldPoints(log(...turn(1, 'a'), ...turn(2, 'b')))
    expect(reconcile(points, new Set(), new Set()).map(point => point.turn)).toEqual([1, 2])
  })

  it('narrows only the points it can attribute to this session', () => {
    const points = foldPoints(log(...turn(1, 'a'), ...turn(2, 'b')))
    // Turn 1 is this session's and missing from the store; turn 2 is inherited.
    expect(reconcile(points, new Set(), new Set(['s.t1'])).map(point => point.turn)).toEqual([2])
  })
})

describe('selectPoint', () => {
  const points = foldPoints(log(...turn(1, 'a'), ...turn(2, 'b')))

  it('accepts the turn number the list shows', () => {
    expect(selectPoint(points, '2')?.point).toBe('s.t2')
  })

  it('accepts the point id verbatim', () => {
    expect(selectPoint(points, 's.t1')?.turn).toBe(1)
  })

  it('names nothing it was not given', () => {
    expect(selectPoint(points, '9')).toBeUndefined()
    expect(selectPoint(points, 'last')).toBeUndefined()
    expect(selectPoint(points, '-1')).toBeUndefined()
    expect(selectPoint(points, '')).toBeUndefined()
  })

  it('prefers an exact point id over a turn that shares the spelling', () => {
    const odd = foldPoints(log(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'filesnap/point', data: { turn: 1, point: '2', manifest: 'm', reused: 0, hashed: 0, dropped: 0 } },
      { type: 'turn/end', data: { turn: 1, reason: 'natural' } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'filesnap/point', data: { turn: 2, point: 's.t2', manifest: 'm', reused: 0, hashed: 0, dropped: 0 } },
      { type: 'turn/end', data: { turn: 2, reason: 'natural' } },
    ))
    expect(selectPoint(odd, '2')?.turn).toBe(1)
  })
})

describe('reducePoints', () => {
  it('returns the same reference for an event it does not read', () => {
    // The projection seam treats an unchanged reference as zero downstream
    // work, and most events in a session are not this reader's.
    const state = initialPoints()
    const [chunk] = log({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: {} } })
    expect(reducePoints(state, chunk!)).toBe(state)
  })

  it('returns the same reference for a message that labels nothing', () => {
    const state = initialPoints()
    const [injected] = log({
      type: 'user/message',
      data: { role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'plugin', plugin: 'p' } },
    })
    expect(reducePoints(state, injected!)).toBe(state)
  })

  it('holds plain JSON, so a persisted cache can seed it', () => {
    const state = log(...turn(1, 'a')).reduce(reducePoints, initialPoints())
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
    expect(state.openTurn).toBeNull()
  })

  it('records where the last rewind out of this session went', () => {
    const state = log(
      ...turn(1, 'a'),
      {
        type: 'filesnap/rewound',
        data: { point: 's.t1', turn: 1, child: 'session-b', boundary: -1, written: 2, deleted: 0, failed: 0, safety: 'ab' },
      },
    ).reduce(reducePoints, initialPoints())
    expect(state.lastRewind).toMatchObject({ point: 's.t1', turn: 1, child: 'session-b' })
  })

  it('is the same answer folded one event at a time as in one pass', () => {
    const events = log(...turn(1, 'a'), ...turn(2, 'b'))
    let state = initialPoints()
    for (const event of events) state = reducePoints(state, event)
    expect(capturedPoints(state)).toEqual(foldPoints(events))
  })

  it('does not offer a turn that was labelled but never captured', () => {
    const state = log(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'never captured' }], source: { kind: 'user' } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ).reduce(reducePoints, initialPoints())
    expect(state.points).toHaveLength(1)
    expect(capturedPoints(state)).toEqual([])
  })
})
