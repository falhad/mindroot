import { beforeEach, describe, expect, it } from 'vitest'
import { endTour, nextStep, startTour, tourEvent, tourSteps, TOUR_KEY, useTour } from '../src/state/tour'

const added = { added: 1, palette: false }
const palette = { added: 0, palette: true }

describe('tour steps', () => {
  it('moves on only when the user does the step', () => {
    expect(nextStep('child', palette, false)).toBe('child')
    expect(nextStep('child', added, false)).toBe('sibling')
    expect(nextStep('sibling', added, false)).toBe('palette')
    expect(nextStep('palette', added, false)).toBe('palette')
    expect(nextStep('palette', palette, false)).toBe('done')
    expect(nextStep('done', added, false)).toBe('done')
  })

  it('has no palette step on a touch screen', () => {
    expect(nextStep('sibling', added, true)).toBe('done')
    expect(tourSteps(true)).toEqual(['child', 'sibling', 'done'])
    expect(tourSteps(false)).toEqual(['child', 'sibling', 'palette', 'done'])
  })

  it('counts a paste of many ideas as one step', () => {
    expect(nextStep('child', { added: 5, palette: false }, false)).toBe('sibling')
  })
})

describe('tour state', () => {
  beforeEach(() => {
    localStorage.clear()
    useTour.setState({ active: false, step: 'child' })
  })

  it('starts for a new user and not again after a skip', () => {
    startTour()
    expect(useTour.getState().active).toBe(true)
    endTour()
    expect(useTour.getState().active).toBe(false)
    expect(localStorage.getItem(TOUR_KEY)).toBe('done')
    startTour()
    expect(useTour.getState().active).toBe(false)
  })

  it('is remembered when the user reaches the last step, before a click on the button', () => {
    startTour()
    tourEvent(added, false)
    tourEvent(added, false)
    expect(localStorage.getItem(TOUR_KEY)).toBeNull()
    tourEvent(palette, false)
    expect(useTour.getState().step).toBe('done')
    expect(localStorage.getItem(TOUR_KEY)).toBe('done')
  })

  it('does not go back to the first step when the editor opens again in the middle', () => {
    startTour()
    tourEvent(added, false)
    startTour()
    expect(useTour.getState().step).toBe('sibling')
  })

  it('starts again on request', () => {
    endTour()
    startTour(true)
    expect(useTour.getState()).toEqual({ active: true, step: 'child' })
  })

  it('ignores events when it is not shown', () => {
    tourEvent(added, false)
    expect(useTour.getState().step).toBe('child')
  })
})
