import { visibleChildren } from './tree'
import type { MapDoc } from './types'

export type PresentMode = 'node' | 'branch'

/**
 * The walk-through of a map. Each step lists the ids that appear *in addition to* all earlier steps.
 *  - `node`: the central idea, then every visible node in reading order, one per step.
 *  - `branch`: the central idea, then one whole first-level branch per step.
 * A collapsed node counts as one step and its hidden children are not opened. Floating nodes are left out.
 * A map with no text and no branches has no steps.
 */
export function presentationSteps(doc: MapDoc, mode: PresentMode): string[][] {
  const root = doc.nodes[doc.root]
  if (!root || (!root.text.trim() && root.children.length === 0)) return []
  const steps: string[][] = [[doc.root]]
  if (mode === 'node') {
    const walk = (id: string) => {
      for (const c of visibleChildren(doc, id)) {
        steps.push([c])
        walk(c)
      }
    }
    walk(doc.root)
  } else {
    const collect = (id: string, out: string[]) => {
      out.push(id)
      for (const c of visibleChildren(doc, id)) collect(c, out)
    }
    for (const c of visibleChildren(doc, doc.root)) {
      const ids: string[] = []
      collect(c, ids)
      steps.push(ids)
    }
  }
  return steps
}
