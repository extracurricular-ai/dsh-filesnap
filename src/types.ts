/**
 * The durable record of what this plugin did, and the public view of it.
 *
 * Three log-only session events, declaration-merged into `SessionEventMap`.
 * They carry no `surfaceOp` and contribute nothing to derived model history —
 * a rewind changes which files are on disk and which conversation the user is
 * standing in, and neither of those is a message.
 *
 * The reason they are session events at all, rather than a side table: a fork
 * deep-clones the seed, so a point recorded in the log travels into every child
 * that inherits the turn it belongs to. A side table keyed by session id would
 * not, and the child would offer no rewind points until it had run a turn of
 * its own.
 *
 * @module
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { RewindPoint } from './wire.ts'

export type { FilesnapProjection, RewindPoint, RewindRecord } from './wire.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A snapshot of the workspace was taken for this turn and can be returned
     * to. `point` is the filesnap turn id — the join key back to the store —
     * and it carries the session because a harness turn number is unique only
     * within its own session while filesnap's turn index is shared across every
     * session in one workspace.
     *
     * Appended inside the open turn it describes, after the capture succeeded.
     * A turn with no such event was not captured, and the reason is on stderr.
     */
    'filesnap/point': {
      /** The harness turn this snapshot precedes. */
      turn: number
      /** The filesnap turn id this snapshot is addressed by. */
      point: string
      /** Content-addressed id of the manifest the capture wrote. */
      manifest: string
      /** Files already in the store, kept by reference rather than re-hashed. */
      reused: number
      /** Files read and hashed for this capture. */
      hashed: number
      /** How many files the scan saw and did not store. */
      dropped: number
    }
    /**
     * This session was rewound: the workspace went back to `point` and the
     * conversation continues in `child`. Appended to the session the user
     * rewound *out of*, after the fork, so it is not part of the child's seed —
     * the child's history ends before the turn that was rewound to.
     *
     * `safety` is the point the rewind itself can be reversed to, and it is
     * recorded even when files failed — especially then.
     */
    'filesnap/rewound': {
      /** The filesnap turn id the workspace was returned to. */
      point: string
      /** The harness turn that point precedes. */
      turn: number
      /** The forked session the conversation continues in. */
      child: SessionId
      /** Source event seq the fork cut through, inclusive. */
      boundary: number
      /** Files written by the restore. */
      written: number
      /** Files the restore removed, each licensed by a tombstone. */
      deleted: number
      /** Files the restore could not write; each was named on its own event. */
      failed: number
      /** Manifest id of the safety checkpoint taken before anything was written. */
      safety: string
    }
    /**
     * A rewind was reversed in this session — the workspace returned to the
     * state it held before the restore that landed here.
     *
     * `conflicts` names paths that changed between the rewind and this undo.
     * They are reported rather than refused, because the safety checkpoint
     * captured them before the undo wrote over them, so the work is
     * recoverable; what must not happen is this reading as an uneventful
     * success.
     */
    'filesnap/redone': {
      /** Files written by the undo. */
      written: number
      /** Files the undo removed. */
      deleted: number
      /** Files the undo could not write. */
      failed: number
      /** Manifest id of the safety checkpoint taken before the undo wrote. */
      safety: string
      /** Paths that moved between the rewind and this undo, bounded by the engine. */
      conflicts: string[]
    }
  }
}

/** What a completed rewind did. */
export interface RewindOutcome {
  /** The point the workspace was returned to. */
  readonly point: RewindPoint
  /** The session the conversation continues in. */
  readonly child: SessionId
  /** Files written. */
  readonly written: number
  /** Files removed. */
  readonly deleted: number
  /** Files that could not be written, with the engine's reason for each. */
  readonly failures: readonly { readonly path: string; readonly error: string }[]
  /** Manifest id of the safety checkpoint the rewind can itself be reversed to. */
  readonly safety: string
  /**
   * Seq of the `filesnap/rewound` event in the source session's log. A UI
   * names it rather than parsing the summary text, so the lifecycle of the
   * command and the domain record of what happened stay joined.
   */
  readonly eventSeq: number
}

/**
 * What the store holds for one workspace, and what it does not protect.
 *
 * The unprotected list is the answer to "which files in my project would a
 * rewind not put back, and why" — the question a bound you cannot see always
 * raises. It is complete rather than sampled, because it is asked deliberately
 * rather than printed every turn.
 */
export interface FilesnapStatus {
  /** The workspace the store partitions by. */
  readonly workspace: string
  /** Every session with records in this workspace. */
  readonly sessions: readonly {
    readonly session: string
    readonly turns: number
    readonly earliest: string
    readonly latest: string
  }[]
  /** Bytes this workspace's own records occupy. */
  readonly recordsBytes: number
  /** Bytes in the content store, shared with every other workspace. */
  readonly sharedContentBytes: number
  /** Files the scan saw and did not store, with the engine's reason for each. */
  readonly unprotected: readonly { readonly path: string; readonly reason: string }[]
}

/** What a completed redo did. */
export interface RedoOutcome {
  /** Files written. */
  readonly written: number
  /** Files removed. */
  readonly deleted: number
  /** Files that could not be written, with the engine's reason for each. */
  readonly failures: readonly { readonly path: string; readonly error: string }[]
  /** Manifest id of the safety checkpoint the undo can itself be reversed to. */
  readonly safety: string
  /** Paths that moved between the rewind and this undo. */
  readonly conflicts: readonly string[]
  /** Seq of the `filesnap/redone` event in this session's log. */
  readonly eventSeq: number
}

/**
 * Why an operation could not happen. Returned rather than thrown: every caller
 * — the command handler, the client half — has to render the reason, and an
 * exception would make each of them re-derive it from a message string.
 */
export type RewindRefusal
  = /** This session has no filesnap id, so nothing was ever captured for it. */
    | { readonly kind: 'untracked'; readonly why: string }
    /** No point with that id is in this session's log. */
    | { readonly kind: 'unknown-point'; readonly point: string }
    /** The agent is mid-turn; a rewind would race the work it is doing. */
    | { readonly kind: 'agent-busy' }
    /** The conversation could not be forked at that boundary. */
    | { readonly kind: 'fork-failed'; readonly message: string }
    /** The engine refused or could not run. */
    | { readonly kind: 'engine'; readonly message: string }

/** An operation's result, or the reason it did not happen. */
export type RewindResult<T>
  = | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly refusal: RewindRefusal }
