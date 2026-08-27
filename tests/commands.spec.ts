import { describe, expect, it } from 'vitest'
import { parseRewind } from '../src/commands.ts'

describe('parseRewind', () => {
  it('lists when given nothing', () => {
    expect(parseRewind('')).toEqual({ kind: 'list' })
    expect(parseRewind('   ')).toEqual({ kind: 'list' })
  })

  it('takes a turn number or a point id', () => {
    expect(parseRewind('3')).toEqual({ kind: 'rewind', selector: '3' })
    expect(parseRewind(' session-a.t3 ')).toEqual({ kind: 'rewind', selector: 'session-a.t3' })
  })

  it('takes a fork the caller already made', () => {
    expect(parseRewind('3 --into session-b')).toEqual({ kind: 'rewind', selector: '3', into: 'session-b' })
  })

  it('tolerates the whitespace an adapter leaves on rawInput', () => {
    expect(parseRewind('  3   --into   session-b  ')).toEqual({ kind: 'rewind', selector: '3', into: 'session-b' })
  })

  it('refuses a half-written --into rather than forking instead', () => {
    // Silently ignoring it would file the undo record in a fork the caller
    // already made and cannot then reach.
    expect(parseRewind('3 --into')).toEqual({ kind: 'usage' })
    expect(parseRewind('3 --into a b')).toEqual({ kind: 'usage' })
    expect(parseRewind('3 --unknown x')).toEqual({ kind: 'usage' })
    expect(parseRewind('--into session-b')).toEqual({ kind: 'usage' })
  })
})
