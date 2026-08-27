/**
 * The rewind control, one per turn, in the assistant message's own icon row.
 *
 * It sits beside copy and branch and reuses that row's chrome, so it reads as
 * part of the message rather than as a panel bolted next to it. That is also
 * why it is a single icon and not a list: the transcript already *is* the list
 * of points, one per bubble, and a popover repeating it was the thing nobody
 * could read.
 *
 * A message with no point renders nothing. Only the assistant message that
 * closed a turn carries one, so the control appears once per turn — under the
 * last bubble of that turn, which is where "undo this" belongs.
 *
 * @module
 */

import { useCallback, useRef, useState } from 'react'
import { IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RewindPoint } from '../wire.ts'
import type { RewindActions } from './actions.ts'
import css from './RewindAction.module.css'

/** Full props: the owner's message identity, the injected verb, and the locale seat. */
export type RewindActionProps
  = PropsRuntime<'conversation.chat.assistant-actions'> & RewindActions & PropsLocale<'filesnap'>

/**
 * What this turn's snapshot covered, as one line for the tooltip.
 *
 * `reused + hashed` is the file count: every tracked file is one or the other.
 * The split is still worth showing, because a turn that hashed hundreds of
 * files is doing something a turn that reused them is not.
 *
 * @param point - the point under this message.
 * @param t - the locale seat.
 * @returns the summary line, or undefined when the capture predates coverage reporting.
 */
function coverageLine(point: RewindPoint, t: RewindActionProps['t']): string | undefined {
  const coverage = point.coverage
  if (coverage === undefined) return undefined
  const tracked = coverage.reused + coverage.hashed
  const base = t('covered', { tracked: String(tracked), hashed: String(coverage.hashed) })
  return coverage.dropped === 0 ? base : `${base} · ${t('dropped', { dropped: String(coverage.dropped) })}`
}

/**
 * One message's rewind control.
 *
 * @param props - the message identity, the rewind verb, the projection seat, and the locale seat.
 * @returns the icon button, or nothing when this message closes no captured turn.
 */
export function RewindAction({ messageId, onRewind, useProjection, t }: RewindActionProps) {
  const projection = useProjection('filesnap')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // React state disables the control on the next render; the ref closes the
  // same-render window, so a double click cannot start two rewinds.
  const pendingRef = useRef(false)

  const point = projection?.points.find(candidate => candidate.messageId === messageId)

  const run = useCallback(async (target: RewindPoint): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setFailure(null)
    const result = await onRewind(target)
    pendingRef.current = false
    setPending(false)
    if (!result.ok) setFailure(result.error ?? '')
  }, [onRewind])

  // No snapshot for this message: either the host plugin is not loaded, or this
  // is not the message that closed a captured turn. Nothing to offer, and a
  // disabled control would only ask the reader to work out why.
  if (point === undefined) return null

  const covered = coverageLine(point, t)
  const label = point.label === undefined
    ? t('rewindHere')
    : t('rewindTo', { label: point.label })

  return (
    <>
      <Tooltip label={covered === undefined ? label : `${label}\n${covered}`} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.action}
          disabled={pending}
          aria-label={label}
          onClick={() => { void run(point) }}
        >
          <IconRefreshOutline16 size={14} />
        </button>
      </Tooltip>
      {failure !== null && (
        <span className={css.failure} role="alert">{t('failed', { reason: failure })}</span>
      )}
    </>
  )
}
