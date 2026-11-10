import { create } from 'zustand'
import { presentationSteps, type PresentMode } from '../core/present'
import { useDoc } from './doc'

interface PresentState {
  active: boolean
  mode: PresentMode
  step: number
  steps: string[][]
}

export const usePresent = create<PresentState>(() => ({ active: false, mode: 'node', step: 0, steps: [] }))
const set = usePresent.setState

/** Ids visible at the current step (all earlier steps plus this one), or null when not presenting. */
export function revealed(s: PresentState): Set<string> | null {
  if (!s.active) return null
  return new Set(s.steps.slice(0, s.step + 1).flat())
}

/** Begin the walk-through. False (and nothing happens) when the map has nothing to show. */
export function startPresentation(mode: PresentMode = 'node'): boolean {
  const doc = useDoc.getState().doc
  if (!doc) return false
  const steps = presentationSteps(doc, mode)
  if (!steps.length) return false
  set({ active: true, mode, step: 0, steps })
  return true
}

export const nextStep = () => set((s) => ({ step: Math.min(s.step + 1, s.steps.length - 1) }))
export const prevStep = () => set((s) => ({ step: Math.max(s.step - 1, 0) }))
export const goToStep = (n: number) => set((s) => ({ step: Math.max(0, Math.min(n, s.steps.length - 1)) }))
export const stopPresentation = () => set({ active: false, step: 0, steps: [] })
