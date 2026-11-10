import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react'
import { boundsOf } from '../core/layout'
import { goToStep, nextStep, prevStep, stopPresentation, usePresent } from '../state/present'
import { useDoc } from '../state/doc'
import { animateTo, fitTarget } from '../state/view'

/** Full-screen walk-through controls. The canvas hides what is not revealed yet (see Canvas). */
export function Presentation() {
  const active = usePresent((s) => s.active)
  const step = usePresent((s) => s.step)
  const steps = usePresent((s) => s.steps)
  const mode = usePresent((s) => s.mode)
  const [idle, setIdle] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // move the camera to what this step reveals (with its parents, so you see where it belongs)
  useEffect(() => {
    if (!active) return
    const { layout, doc } = useDoc.getState()
    if (!layout || !doc) return
    const ids = steps[step] ?? []
    const around = ids.flatMap((id) => [id, doc.nodes[id]?.parentId ?? id])
    const boxes = around.map((id) => layout.boxes[id]).filter(Boolean)
    if (boxes.length) animateTo(fitTarget(boundsOf(boxes), 150, 1.8), 420)
  }, [active, step, steps])

  // keys: they belong to the presentation while it runs
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') nextStep()
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') prevStep()
      else if (k === 'Home') goToStep(0)
      else if (k === 'End') goToStep(Infinity)
      else if (k === 'Escape') stopPresentation()
      else if (k === 'f' || k === 'F') void toggleFullscreen()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])

  // leave full screen when the walk-through ends
  useEffect(() => {
    if (!active && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }, [active])

  // hide the controls when the pointer rests
  useEffect(() => {
    if (!active) return
    const wake = () => {
      setIdle(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setIdle(true), 2500)
    }
    wake()
    window.addEventListener('pointermove', wake)
    return () => {
      window.removeEventListener('pointermove', wake)
      clearTimeout(timer.current)
    }
  }, [active])

  if (!active) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-40 flex justify-center px-3" style={{ opacity: idle ? 0 : 1, transition: 'opacity 0.3s' }} data-testid="presentation-controls">
      <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5" role="toolbar" aria-label="Presentation">
        <button className="btn icon" aria-label="Previous step" disabled={step === 0} onClick={prevStep}><ChevronLeft size={17} /></button>
        <span className="min-w-[84px] px-2 text-center text-[13px] tabular-nums" aria-live="polite">
          {step + 1} / {steps.length}
        </span>
        <button className="btn icon" aria-label="Next step" disabled={step >= steps.length - 1} onClick={nextStep}><ChevronRight size={17} /></button>
        <span className="mx-1 h-5 w-px bg-line" />
        <span className="px-1 text-[12px] text-muted">{mode === 'node' ? 'By idea' : 'By branch'}</span>
        <button className="btn icon" aria-label="Full screen (F)" title="Full screen (F)" onClick={() => void toggleFullscreen()}><Maximize2 size={15} /></button>
        <button className="btn icon" aria-label="End presentation" title="End (Esc)" onClick={stopPresentation}><X size={16} /></button>
      </div>
    </div>
  )
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    /* not allowed (for example in a test browser): the walk-through still works */
  }
}
