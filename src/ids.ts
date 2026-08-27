/**
 * The two ids filesnap takes from outside, minted from harness identities.
 *
 * filesnap never generates a turn id (filesnap D6): a turn id is the join key
 * back to the conversation, and minting one severs the only thing it is for.
 * It also refuses an id it cannot use rather than rewriting it (filesnap D7),
 * because a rewrite is what turns a typo into two conversations sharing one
 * undo stack. So the mapping from harness identity to filesnap id belongs
 * here, stated once, and every id this module produces is checked against the
 * same rule the engine applies.
 *
 * @module
 */

/**
 * Characters an id may hold. Mirrors `is_admissible` in the engine's `id.rs`:
 * ASCII alphanumerics plus `-`, `_` and `.`.
 */
const ADMISSIBLE = /^[A-Za-z0-9._-]+$/u

/**
 * The longest id filesnap stores. The engine caps a single path component at
 * 200 bytes so the record suffix and a `.tmp` still fit beside it.
 */
const MAX_ID_BYTES = 200

/** What the engine reserves for the ids it mints; an external id may not lead with it. */
const INTERNAL_PREFIX = '_'

/** Separator between a session id and its turn number in a point id. */
const TURN_INFIX = '.t'

/**
 * Why a harness identity cannot become a filesnap id. Carried rather than
 * thrown so the caller can disable tracking for one session and say why,
 * instead of failing a turn over a name it does not control.
 */
export type IdRefusal
  = | { readonly reason: 'empty' }
    | { readonly reason: 'dot-name' }
    | { readonly reason: 'inadmissible-characters' }
    | { readonly reason: 'reserved-prefix' }
    | { readonly reason: 'too-long'; readonly bytes: number }

/** An accepted id, or the reason it was refused. */
export type IdResult
  = | { readonly ok: true; readonly id: string }
    | { readonly ok: false; readonly refusal: IdRefusal }

/**
 * Apply the engine's own admission rule to a candidate external id.
 *
 * @param candidate - the string about to be handed to `filesnap`.
 * @returns the accepted id, or the reason the engine would refuse it.
 */
export function admit(candidate: string): IdResult {
  if (candidate.length === 0) return { ok: false, refusal: { reason: 'empty' } }
  if (candidate === '.' || candidate === '..') return { ok: false, refusal: { reason: 'dot-name' } }
  if (!ADMISSIBLE.test(candidate)) return { ok: false, refusal: { reason: 'inadmissible-characters' } }
  if (candidate.startsWith(INTERNAL_PREFIX)) return { ok: false, refusal: { reason: 'reserved-prefix' } }
  const bytes = Buffer.byteLength(candidate, 'utf8')
  if (bytes > MAX_ID_BYTES) return { ok: false, refusal: { reason: 'too-long', bytes } }
  return { ok: true, id: candidate }
}

/**
 * The filesnap session id for one harness session.
 *
 * Passed through unchanged rather than hashed or prefixed. A filesnap session
 * is bound to one working directory forever (filesnap D4) and a harness
 * session is too, so the two identities describe the same thing and giving
 * them different names would only make a store hard to read against a
 * transcript.
 *
 * @param sessionId - the harness session id.
 * @returns the accepted filesnap session id, or the reason it was refused.
 */
export function sessionId(sessionId: string): IdResult {
  return admit(sessionId)
}

/**
 * The filesnap turn id — this plugin calls it a *point* — for one turn of one
 * session.
 *
 * The session has to be in it. A harness turn number is unique only inside its
 * own session, while filesnap's turn index is shared by every session working
 * in one directory (filesnap D19 partitions records per workspace, not per
 * session), so two conversations in one project would both claim `3` and the
 * second would resolve the first's manifest. Forking makes that certain rather
 * than unlikely: a child session inherits its parent's turn numbering.
 *
 * @param session - the accepted filesnap session id that owns the turn.
 * @param turn - the harness turn number.
 * @returns the accepted point id, or the reason it was refused.
 */
export function pointId(session: string, turn: number): IdResult {
  if (!Number.isSafeInteger(turn) || turn < 0) {
    throw new TypeError(`filesnap: turn must be a non-negative safe integer, got ${String(turn)}`)
  }
  return admit(`${session}${TURN_INFIX}${String(turn)}`)
}

/**
 * Human-readable reason an id was refused, for the one stderr line that says
 * this session is not being tracked.
 *
 * @param refusal - why the id was refused.
 * @returns a sentence fragment naming the rule the id broke.
 */
export function explain(refusal: IdRefusal): string {
  switch (refusal.reason) {
    case 'empty': return 'it is empty'
    case 'dot-name': return 'it is `.` or `..`, which name a directory rather than a record'
    case 'inadmissible-characters': return 'it holds characters outside letters, digits, `-`, `_` and `.`'
    case 'reserved-prefix': return 'it begins with `_`, which filesnap reserves for the ids it mints'
    case 'too-long': return `it is ${String(refusal.bytes)} bytes, past the 200-byte limit a filesystem path component allows`
    /* v8 ignore next 2 -- IdRefusal is closed and every member is handled above */
    default: throw new TypeError(`unknown refusal: ${String(refusal)}`)
  }
}
