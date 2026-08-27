import { describe, expect, it } from 'vitest'
import { isMarked, mark, REWOUND_MARK, unmark } from '../src/mark.ts'

describe('the rewound mark', () => {
  it('adds and removes symmetrically', () => {
    expect(mark('add a rate limiter')).toBe(`${REWOUND_MARK}add a rate limiter`)
    expect(unmark(mark('add a rate limiter'))).toBe('add a rate limiter')
  })

  it('does not stack when a conversation is rewound out of twice', () => {
    expect(mark(mark('x'))).toBe(mark('x'))
  })

  it('leaves an unmarked title alone', () => {
    expect(unmark('x')).toBe('x')
    expect(isMarked('x')).toBe(false)
  })

  it('keeps the mark at the front, where a truncated list still shows it', () => {
    // A session list ellipsizes the tail, so a suffix marker is the first thing
    // to disappear from exactly the place the choice is made.
    expect(mark('a very long conversation title').startsWith(REWOUND_MARK)).toBe(true)
  })
})
