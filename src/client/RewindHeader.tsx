/**
 * Two session-level controls in the header's action strip.
 *
 * Neither belongs on a message. **Undo** reverses the rewind that landed in
 * *this* session — a fact about the session, not about any one turn — and it is
 * rendered only when there is one, so the strip stays empty until it means
 * something. **Status** asks the engine what it holds and what it does not
 * protect; its answer lands in the transcript, where a long list belongs.
 *
 * The per-turn rewind is deliberately not here. It is one icon per bubble in
 * {@link ../client/RewindAction.tsx}, because the transcript already is the
 * list of points.
 *
 * @module
 */

import { useCallback, useRef, useState } from 'react'
import { IconDataOutline16, IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RewindHeaderActions } from './actions.ts'
import css from './RewindAction.module.css'

/** Full props: the owner share, the injected verbs, and the locale seat. */
export type RewindHeaderProps
  = PropsRuntime<'conversation.session.header.actions'> & RewindHeaderActions & PropsLocale<'filesnap'>

/**
 * The session-level strip.
 *
 * @param props - the runtime share, the two verbs, and the locale seat.
 * @returns the status control, plus the undo control when a rewind landed here.
 */
export function RewindHeader({ onRedo, onStatus, useProjection, t }: RewindHeaderProps) {
  const projection = useProjection('filesnap')
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  const run = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    await action()
    pendingRef.current = false
    setPending(false)
  }, [])

  // The host plugin is not loaded, or the projection has not arrived. Either
  // way there is nothing to offer and no control to explain.
  if (projection === undefined) return null

  const landed = projection.lastRewind
  const undoLabel = landed === undefined ? t('undo') : t('undoFrom', { label: String(landed.turn) })

  return (
    <>
      {landed !== undefined && (
        <Tooltip label={undoLabel} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.action}
            disabled={pending}
            aria-label={undoLabel}
            onClick={() => { void run(onRedo) }}
          >
            <IconRefreshOutline16 size={14} />
          </button>
        </Tooltip>
      )}
      <Tooltip label={t('status')} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.action}
          disabled={pending}
          aria-label={t('status')}
          onClick={() => { void run(onStatus) }}
        >
          <IconDataOutline16 size={14} />
        </button>
      </Tooltip>
    </>
  )
}
