/**
 * The rewind affordance in the session header: a button that opens the list of
 * points this session can return to, and picks one.
 *
 * Live state arrives as the projected whole value (`useProjection('filesnap')`);
 * the two verbs are the injected face. The component owns nothing but which
 * list is open and which pick is in flight.
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FilesnapProjection, RewindPoint } from '../wire.ts'
import type { RewindActions } from './actions.ts'
import css from './RewindMenu.module.css'

/** How a point's timestamp reads in the list. */
const WHEN = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** Everything the menu renders from. */
export interface RewindMenuProps extends RewindActions {
  /** The projected value; undefined means the capability is absent or still loading. */
  projection: FilesnapProjection | undefined
}

/**
 * The list and its trigger.
 *
 * @param props - projected points, the two verbs, and the locale seat.
 * @returns the header entry, or nothing when the plugin is not loaded on the host.
 */
export function RewindMenu({ projection, onRewind, onRedo, t }: RewindMenuProps & PropsLocale<'filesnap'>) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  // React state disables the controls on the next render; the ref closes the
  // same-render window, so a double click cannot start two rewinds.
  const pendingRef = useRef(false)

  // A click anywhere else closes the list. Registered only while it is open,
  // so a closed menu costs no document listener.
  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return
      if (root.current?.contains(event.target) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    return () => { document.removeEventListener('mousedown', dismiss) }
  }, [open])

  const run = useCallback(async (action: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setFailure(null)
    const result = await action()
    pendingRef.current = false
    setPending(false)
    if (result.ok) {
      setOpen(false)
      return
    }
    setFailure(t('failed', { reason: result.error ?? '' }))
  }, [t])

  // The host plugin is not loaded, or the projection has not arrived. Either
  // way there is nothing to offer and no button to explain.
  if (projection === undefined) return null

  const points = projection.points
  const redoable = projection.lastRewind !== undefined

  return (
    <div className={css.root} ref={root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => { setOpen(current => !current) }}
      >
        {pending ? t('working') : t('open')}
      </button>

      {open && (
        <div className={css.panel} role="menu" aria-label={t('title')}>
          <div className={css.heading}>{t('title')}</div>
          {points.length === 0
            ? <div className={css.empty}>{t('empty')}</div>
            : (
                <ul className={css.list}>
                  {points.map(point => (
                    <li key={point.point}>
                      <button
                        type="button"
                        role="menuitem"
                        className={css.item}
                        disabled={pending}
                        onClick={() => { void run(() => onRewind(point)) }}
                      >
                        <span className={css.turn}>{t('turn', { turn: String(point.turn) })}</span>
                        <span className={css.label}>{point.label ?? t('noLabel')}</span>
                        <span className={css.when}>{WHEN.format(point.at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          {redoable && (
            <button
              type="button"
              role="menuitem"
              className={css.redo}
              disabled={pending}
              onClick={() => { void run(() => onRedo()) }}
            >
              {t('redo')}
            </button>
          )}
          {failure !== null && <div className={css.failure} role="alert">{failure}</div>}
        </div>
      )}
    </div>
  )
}

/** Full props of the header entry: the owner share, the injected verbs, and the locale seat. */
export type RewindHeaderProps
  = PropsRuntime<'conversation.session.header.actions'> & RewindActions & PropsLocale<'filesnap'>

/**
 * Header adapter: reads the host-computed `filesnap` projection and hands the
 * whole value down.
 *
 * @param props - the runtime share, the verbs, and the locale seat.
 * @returns the rendered menu.
 */
export function RewindHeaderEntry({ useProjection, onRewind, onRedo, t }: RewindHeaderProps) {
  const projection = useProjection('filesnap')
  return <RewindMenu projection={projection} onRewind={onRewind} onRedo={onRedo} t={t} />
}

export type { RewindPoint }
