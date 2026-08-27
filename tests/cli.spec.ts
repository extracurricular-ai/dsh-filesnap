import { describe, expect, it } from 'vitest'
import type { FilesnapRun } from '../src/cli.ts'
import { eventsOfType, lastEvent, numberField, parseEvents, stringField } from '../src/cli.ts'

/** Build a run from parsed stdout, for the readers that take a whole run. */
function runOf(stdout: string): FilesnapRun {
  const { events, refused } = parseEvents(stdout)
  return { exit: 'ok', code: 0, events, refused, stderr: '' }
}

describe('parseEvents', () => {
  it('reads the flat envelope the engine emits', () => {
    const { events, refused } = parseEvents(
      '{"v":1,"type":"capture.started","session":"s1","turn":"t1"}\n'
      + '{"v":1,"type":"capture.done","manifest":"a1b2","reused":412,"hashed":7,"dropped":1}\n',
    )
    expect(refused).toBe(0)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ type: 'capture.done', manifest: 'a1b2', reused: 412 })
  })

  it('refuses a line whose schema version it does not understand', () => {
    // The version is per line precisely so a reader holding one line can refuse
    // it. Reading a v2 line as though the fields still meant what they used to
    // is the failure this prevents.
    const { events, refused } = parseEvents('{"v":2,"type":"capture.done","manifest":"x"}\n')
    expect(events).toEqual([])
    expect(refused).toBe(1)
  })

  it('keeps the terminal event when an earlier line is unreadable', () => {
    // A restore names every failure on its own line. One corrupt line must not
    // cost the caller the `restore.done` that carries the safety id.
    const { events, refused } = parseEvents(
      '{"v":1,"type":"restore.written","path":"/w/a"}\n'
      + 'not json at all\n'
      + '{"v":1,"type":"restore.done","written":1,"deleted":0,"failed":0,"safety":"c3d4"}\n',
    )
    expect(refused).toBe(1)
    expect(lastEvent({ exit: 'ok', code: 0, events, refused, stderr: '' }, 'restore.done'))
      .toMatchObject({ safety: 'c3d4' })
  })

  it('refuses a line that is valid JSON but not one event object', () => {
    const { events, refused } = parseEvents('[1,2,3]\n"a string"\nnull\n{"v":1}\n')
    expect(events).toEqual([])
    expect(refused).toBe(4)
  })

  it('ignores blank lines', () => {
    expect(parseEvents('\n\n   \n')).toEqual({ events: [], refused: 0 })
  })

  it('ignores an unknown field rather than refusing the line', () => {
    // A new field does not bump the version, so a reader pinned to v1 must
    // tolerate one it has never seen.
    const { events, refused } = parseEvents('{"v":1,"type":"capture.done","manifest":"x","newField":9}\n')
    expect(refused).toBe(0)
    expect(events[0]).toMatchObject({ manifest: 'x' })
  })
})

describe('event readers', () => {
  const run = runOf(
    '{"v":1,"type":"restore.written","path":"/w/a"}\n'
    + '{"v":1,"type":"restore.failed","path":"/w/locked","error":"permission denied"}\n'
    + '{"v":1,"type":"restore.done","written":1,"deleted":0,"failed":1,"safety":"c3d4"}\n',
  )

  it('collects every event of a streaming type in order', () => {
    expect(eventsOfType(run, 'restore.failed')).toHaveLength(1)
    expect(eventsOfType(run, 'restore.missing')).toEqual([])
  })

  it('takes the last of a terminal type', () => {
    expect(stringField(lastEvent(run, 'restore.done'), 'safety', '')).toBe('c3d4')
  })

  it('falls back rather than throwing on a field the engine did not send', () => {
    const done = lastEvent(run, 'restore.done')
    expect(numberField(done, 'written', -1)).toBe(1)
    expect(numberField(done, 'absent', -1)).toBe(-1)
    expect(numberField(undefined, 'written', -1)).toBe(-1)
    expect(stringField(done, 'safety', 'none')).toBe('c3d4')
    expect(stringField(done, 'absent', 'none')).toBe('none')
  })

  it('does not read a non-finite number as a count', () => {
    const odd = runOf('{"v":1,"type":"capture.done","dropped":1e999}\n')
    expect(numberField(lastEvent(odd, 'capture.done'), 'dropped', 0)).toBe(0)
  })
})
