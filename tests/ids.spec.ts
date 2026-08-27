import { describe, expect, it } from 'vitest'
import { admit, explain, pointId, sessionId } from '../src/ids.ts'

describe('admit', () => {
  it('accepts the ids a harness actually mints', () => {
    for (const id of ['session-1', 'session-3f8a2b10-4c5d-4e6f-8a9b-0c1d2e3f4a5b', 'a.b_c-1']) {
      expect(admit(id)).toEqual({ ok: true, id })
    }
  })

  it('refuses an id that would resolve to a directory rather than a record', () => {
    expect(admit('.')).toEqual({ ok: false, refusal: { reason: 'dot-name' } })
    expect(admit('..')).toEqual({ ok: false, refusal: { reason: 'dot-name' } })
    expect(admit('')).toEqual({ ok: false, refusal: { reason: 'empty' } })
  })

  it('refuses rather than rewrites, so two ids cannot merge into one', () => {
    // The engine used to map every inadmissible character to `_`, which turned
    // these three distinct sessions into one log and one undo stack.
    for (const id of ['my session', 'my/session', 'my:session']) {
      expect(admit(id)).toEqual({ ok: false, refusal: { reason: 'inadmissible-characters' } })
    }
  })

  it('refuses the namespace the engine mints into', () => {
    expect(admit('_safety-restore')).toEqual({ ok: false, refusal: { reason: 'reserved-prefix' } })
  })

  it('refuses an id no filesystem would store as one path component', () => {
    const long = 'a'.repeat(201)
    expect(admit(long)).toEqual({ ok: false, refusal: { reason: 'too-long', bytes: 201 } })
    expect(admit('a'.repeat(200)).ok).toBe(true)
  })

  it('counts bytes rather than code units', () => {
    // 100 three-byte characters is 300 bytes but only 100 UTF-16 units — and
    // it is the filesystem's byte limit that decides. (It is refused for its
    // characters first; the length rule is what the check would reach next.)
    expect(admit('あ'.repeat(100)).ok).toBe(false)
  })
})

describe('pointId', () => {
  it('carries the session, because a turn number is unique only inside one', () => {
    // filesnap partitions records per workspace, not per session, so two
    // conversations in one project both reach turn 3 and the second would
    // resolve the first's manifest.
    expect(pointId('session-a', 3)).toEqual({ ok: true, id: 'session-a.t3' })
    expect(pointId('session-b', 3)).toEqual({ ok: true, id: 'session-b.t3' })
  })

  it('stays unambiguous when a session id already looks like a point id', () => {
    expect(pointId('x.t1', 2)).toEqual({ ok: true, id: 'x.t1.t2' })
    // Nothing else produces that spelling: reaching it from `x` would need a
    // turn of "1.t2", and a turn is digits.
    expect(pointId('x', 1)).toEqual({ ok: true, id: 'x.t1' })
  })

  it('refuses a point id whose session pushes it past the length limit', () => {
    const result = pointId('s'.repeat(199), 12)
    expect(result.ok).toBe(false)
  })

  it('rejects a turn that is not a turn', () => {
    expect(() => pointId('s', -1)).toThrow(TypeError)
    expect(() => pointId('s', 1.5)).toThrow(TypeError)
  })
})

describe('sessionId', () => {
  it('passes a harness session id through unchanged', () => {
    expect(sessionId('session-7')).toEqual({ ok: true, id: 'session-7' })
  })
})

describe('explain', () => {
  it('names the rule for every refusal the checker can produce', () => {
    const refusals = [
      { reason: 'empty' },
      { reason: 'dot-name' },
      { reason: 'inadmissible-characters' },
      { reason: 'reserved-prefix' },
      { reason: 'too-long', bytes: 201 },
    ] as const
    for (const refusal of refusals) {
      expect(explain(refusal)).toMatch(/\S/u)
    }
    expect(explain({ reason: 'too-long', bytes: 201 })).toContain('201')
  })
})
