import { create } from 'zustand'

/** The first-use tour: a short card on the map that moves on when the user does each step. */
export type TourStep = 'child' | 'sibling' | 'palette' | 'done'

export const TOUR_KEY = 'mr.tour'

export interface TourEvent {
  /** Ideas added to the map since the last event. */
  added: number
  /** The command palette was opened. */
  palette: boolean
}

/** The step after an event. Touch screens have no command palette key, so they skip that step. */
export function nextStep(step: TourStep, ev: TourEvent, touch: boolean): TourStep {
  if (step === 'child' && ev.added > 0) return 'sibling'
  if (step === 'sibling' && ev.added > 0) return touch ? 'done' : 'palette'
  if (step === 'palette' && ev.palette) return 'done'
  return step
}

/** The steps a user sees, in sequence. */
export const tourSteps = (touch: boolean): TourStep[] => (touch ? ['child', 'sibling', 'done'] : ['child', 'sibling', 'palette', 'done'])

interface TourState {
  active: boolean
  step: TourStep
}

export const useTour = create<TourState>(() => ({ active: false, step: 'child' }))

function seen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done'
  } catch {
    return true // no storage: do not show the tour on each visit
  }
}

function remember() {
  try {
    localStorage.setItem(TOUR_KEY, 'done')
  } catch {
    /* ignore */
  }
}

/** Start the tour if this user has not seen it. `force` starts it again (the command "Show the quick tour"). */
export function startTour(force = false) {
  if (!force && (seen() || useTour.getState().active)) return
  useTour.setState({ active: true, step: 'child' })
}

export function tourEvent(ev: TourEvent, touch: boolean) {
  const s = useTour.getState()
  if (!s.active) return
  const step = nextStep(s.step, ev, touch)
  if (step === s.step) return
  if (step === 'done') remember() // the user did all steps: never show it again, also without a click on "Got it"
  useTour.setState({ step })
}

/** Close the tour for good (skip, or the last button). */
export function endTour() {
  remember()
  useTour.setState({ active: false, step: 'child' })
}
