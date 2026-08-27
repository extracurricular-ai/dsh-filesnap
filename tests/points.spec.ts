import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldPoints, reconcile, selectPoint } from '../src/points.ts'

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
    { type: 'filesnap/point', data: { turn: n, point: `s.t${String(n)}`, manifest: 'm', dropped: 0 } },
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
      { type: 'filesnap/point', data: { turn: 1, point: 's.t1', manifest: 'm', dropped: 0 } },
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
      { type: 'filesnap/point', data: { turn: 1, point: 's.t1', manifest: 'm', dropped: 0 } },
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
      { type: 'filesnap/point', data: { turn: 1, point: 's.t1', manifest: 'm', dropped: 0 } },
      { type: 'turn/end', data: { turn: 1, reason: 'natural' } },
    ))
    expect(points[0]?.label).toBe('early')
  })

  it('leaves an image-only turn unlabelled rather than inventing text', () => {
    const points = foldPoints(log(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'filesnap/point', data: { turn: 1, point: 's.t1', manifest: 'm', dropped: 0 } },
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
  it('drops a point the store can no longer resolve', () => {
    const points = foldPoints(log(...turn(1, 'a'), ...turn(2, 'b')))
    expect(reconcile(points, new Set(['s.t2'])).map(point => point.turn)).toEqual([2])
  })

  it('keeps the log order', () => {
    const points = foldPoints(log(...turn(1, 'a'), ...turn(2, 'b')))
    expect(reconcile(points, new Set(['s.t2', 's.t1'])).map(point => point.turn)).toEqual([1, 2])
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
      { type: 'filesnap/point', data: { turn: 1, point: '2', manifest: 'm', dropped: 0 } },
      { type: 'turn/end', data: { turn: 1, reason: 'natural' } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'filesnap/point', data: { turn: 2, point: 's.t2', manifest: 'm', dropped: 0 } },
      { type: 'turn/end', data: { turn: 2, reason: 'natural' } },
    ))
    expect(selectPoint(odd, '2')?.turn).toBe(1)
  })
})
