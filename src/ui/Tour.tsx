import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { modKey } from '../io/env'
import { useDoc } from '../state/doc'
import { endTour, startTour, tourEvent, tourSteps, useTour, type TourStep } from '../state/tour'
import { ui, useUi } from '../state/ui'

/** A touch screen or a narrow window has the Child and Sibling buttons, but no key for the command palette. */
const isTouch = () => typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || innerWidth < 640)

/** The first-use tour. It shows one short step at a time and moves on when the user does the step. */
export function Tour() {
  const active = useTour((s) => s.active)
  const step = useTour((s) => s.step)
  const touch = useRef(isTouch()).current

  useEffect(() => startTour(), [])

  // Watch what the user does: a new idea, or the command palette.
  useEffect(() => {
    if (!active) return
    const count = () => Object.keys(useDoc.getState().doc?.nodes ?? {}).length
    let before = count()
    const offDoc = useDoc.subscribe((s, prev) => {
      if (s.doc === prev.doc) return
      const now = count()
      if (now > before) tourEvent({ added: now - before, palette: false }, touch)
      before = now
    })
    const offUi = useUi.subscribe((s, prev) => {
      if (s.paletteOpen && !prev.paletteOpen) tourEvent({ added: 0, palette: true }, touch)
    })
    return () => { offDoc(); offUi() }
  }, [active, touch])

  if (!active) return null
  const steps = tourSteps(touch)
  const at = steps.indexOf(step)
  const text: Record<TourStep, ReactNode> = {
    child: touch
      ? <>Tap <b>Child</b> below to add your first idea.</>
      : <>Press <kbd>Tab</kbd> to add your first idea.</>,
    sibling: touch
      ? <>Type a name. Then tap <b>Sibling</b> for the next idea.</>
      : <>Type a name. Then press <kbd>Enter</kbd> for the next idea.</>,
    palette: <>Press <kbd>{modKey} K</kbd> to see all commands.</>,
    done: touch
      ? <>That is all you need. Select an idea to change its colour, notes and more.</>
      : <>That is all you need. For the shortcut list, press <kbd>?</kbd> or press <kbd>{modKey} K</kbd> and type <b>help</b>.</>,
  }
  return (
    <div
      data-tour={step}
      role="status"
      aria-live="polite"
      aria-label="Quick tour"
      className="glass rise absolute left-1/2 top-[68px] z-20 flex w-max max-w-[min(540px,calc(100vw-24px))] -translate-x-1/2 items-center gap-3 rounded-2xl py-2.5 pl-4 pr-2.5 text-[13.5px]"
      style={{ background: 'var(--panel-solid)', boxShadow: 'var(--shadow-lg)' }}
    >
      <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} className="h-1.5 rounded-full transition-all" style={{ width: i === at ? 14 : 6, background: i <= at ? 'var(--accent)' : 'var(--line)' }} />
        ))}
      </span>
      <span className="sr-only">Step {at + 1} of {steps.length}.</span>
      <span className="min-w-0 leading-relaxed" style={{ textWrap: 'balance' }}>{text[step]}</span>
      {step === 'done' ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {!touch && <button className="btn bordered" style={{ height: 28 }} onClick={() => { endTour(); ui.setHelp(true) }}>Shortcuts</button>}
          <button className="btn primary" style={{ height: 28 }} onClick={endTour}>Got it</button>
        </span>
      ) : (
        <button className="btn icon shrink-0" style={{ width: 28, height: 28 }} aria-label="Skip the tour" title="Skip the tour" onClick={endTour}><X size={14} /></button>
      )}
    </div>
  )
}
