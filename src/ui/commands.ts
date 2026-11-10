import { THEMES } from '../core/themes'
import type { BgKind, EdgeKind, LayoutKind } from '../core/types'
import { modKey } from '../io/env'
import {
  addChild, addFloatAt, addSibling, commit, deleteSelection, duplicateSelection, expandToLevel, floatSelection, groupSelection, indent, outdent, redo, reorder, select,
  selectAll, setConnectFrom, toggleFocus, startEdit, summarizeSelection, toggleCollapse, undo, ungroupSelection, useDoc, primary,
} from '../state/doc'
import { flushSave } from '../state/persist'
import { createMap } from '../state/library'
import { useRegistry } from '../plugins/host'
import { cycleTheme, goTo, toast, ui } from '../state/ui'
import { fitView, screenToWorld, setView, useView, zoomBy } from '../state/view'

export interface Command {
  id: string
  title: string
  group: string
  hint?: string
  run: () => void
}

export const LAYOUTS: { id: LayoutKind; name: string }[] = [
  { id: 'mindmap', name: 'Mind map (both sides)' },
  { id: 'right', name: 'Right tree' },
  { id: 'left', name: 'Left tree' },
  { id: 'down', name: 'Org chart (down)' },
  { id: 'up', name: 'Org chart (up)' },
  { id: 'radial', name: 'Radial' },
]
export const EDGES: { id: EdgeKind; name: string }[] = [
  { id: 'curve', name: 'Curved' },
  { id: 'elbow', name: 'Elbow' },
  { id: 'straight', name: 'Straight' },
]
export const BGS: { id: BgKind; name: string }[] = [
  { id: 'dots', name: 'Dots' },
  { id: 'grid', name: 'Grid' },
  { id: 'none', name: 'Plain' },
]

export const setLayout = (layout: LayoutKind) => {
  commit((d) => void (d.layout = layout))
  setTimeout(fitCurrent, 30)
}
export const setEdge = (edge: EdgeKind) => commit((d) => void (d.edge = edge))
export const setMapTheme = (id: string) => commit((d) => void (d.themeId = id))
export const setBg = (bg: BgKind) => commit((d) => void (d.bg = bg))

export function fitCurrent(animate = true) {
  const l = useDoc.getState().layout
  if (l) fitView(l.bounds, animate)
}

export function fitSelection() {
  const { layout, selection } = useDoc.getState()
  if (!layout) return
  const boxes = selection.map((id) => layout.boxes[id]).filter(Boolean)
  if (!boxes.length) return fitCurrent()
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  fitView({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

export function resetZoom() {
  const { w, h, k, x, y } = useView.getState()
  const cx = (w / 2 - x) / k
  const cy = (h / 2 - y) / k
  setView({ k: 1, x: w / 2 - cx, y: h / 2 - cy })
}

export async function goHome() {
  await flushSave()
  goTo({ name: 'dashboard' })
}

export async function newMapAndOpen() {
  await flushSave()
  const id = await createMap('blank')
  goTo({ name: 'editor', id })
}

/** World position of the middle of the visible canvas. */
function centre(): [number, number] {
  const { w, h } = useView.getState()
  const p = screenToWorld(w / 2, h / 2)
  return [p.x, p.y]
}

export function buildCommands(): Command[] {
  const c = (group: string, id: string, title: string, run: () => void, hint?: string): Command => ({ group, id, title, run, hint })
  const list: Command[] = [
    c('Edit', 'child', 'Add child', () => addChild(), 'Tab'),
    c('Edit', 'sibling', 'Add sibling', () => addSibling(), 'Enter'),
    c('Edit', 'sibling-before', 'Add sibling above', () => addSibling(true), 'Shift Enter'),
    c('Edit', 'edit', 'Edit text', () => startEdit(), 'F2'),
    c('Edit', 'dup', 'Duplicate', duplicateSelection, `${modKey} D`),
    c('Edit', 'del', 'Delete', deleteSelection, 'Del'),
    c('Edit', 'undo', 'Undo', undo, `${modKey} Z`),
    c('Edit', 'redo', 'Redo', redo, `${modKey} ⇧ Z`),
    c('Edit', 'selall', 'Select all', selectAll, `${modKey} A`),
    c('Edit', 'indent', 'Indent (make child of previous)', indent, '⌥ →'),
    c('Edit', 'outdent', 'Outdent (move up a level)', outdent, '⌥ ←'),
    c('Edit', 'up', 'Move up among siblings', () => reorder(-1), '⌥ ↑'),
    c('Edit', 'down', 'Move down among siblings', () => reorder(1), '⌥ ↓'),
    c('Edit', 'connect', 'Link to another node…', () => {
      const p = primary()
      if (p) {
        setConnectFrom(p)
        toast('Click the node to link to · Esc to cancel')
      }
    }),
    c('Arrange', 'group', 'Group selected siblings (boundary)', () => {
      if (!groupSelection()) toast('Select nodes that share the same parent to group them')
    }),
    c('Arrange', 'ungroup', 'Remove group around selection', () => {
      if (!ungroupSelection()) toast('The selection is not in a group')
    }),
    c('Arrange', 'summary', 'Add summary bracket over selected siblings', () => {
      if (!summarizeSelection()) toast('Select two or more neighbouring siblings for a bracket')
    }),
    c('Arrange', 'float', 'Make selection a floating branch', () => {
      if (!floatSelection()) toast('Select a node that is not the central idea')
    }),
    c('Arrange', 'new-float', 'Add floating node', () => addFloatAt(...centre())),
    c('Arrange', 'new-sticky', 'Add sticky note', () => addFloatAt(...centre(), true)),
    c('View', 'focus', 'Focus on selected branch / leave focus', () => { toggleFocus(); setTimeout(fitCurrent, 30) }, `${modKey} .`),
    c('View', 'collapse', 'Collapse / expand', () => toggleCollapse(), 'Space'),
    c('View', 'expand-all', 'Expand all', () => expandToLevel(null)),
    c('View', 'collapse-1', 'Collapse to level 1', () => expandToLevel(1)),
    c('View', 'collapse-2', 'Collapse to level 2', () => expandToLevel(2)),
    c('View', 'fit', 'Fit map to screen', () => fitCurrent(), `${modKey} 0`),
    c('View', 'fit-sel', 'Zoom to selection', fitSelection),
    c('View', 'zoom100', 'Actual size', resetZoom, `${modKey} 1`),
    c('View', 'zin', 'Zoom in', () => zoomBy(1.25), `${modKey} =`),
    c('View', 'zout', 'Zoom out', () => zoomBy(0.8), `${modKey} -`),
    c('View', 'inspector', 'Toggle side panel', ui.toggleInspector, `${modKey} I`),
    c('View', 'theme-mode', 'Switch light / dark / system', cycleTheme),
    c('View', 'clear-tags', 'Clear tag filter', () => ui.setTagFilter([])),
    c('Map', 'search', 'Find in map', () => ui.setSearch(true), `${modKey} F`),
    c('Map', 'export', 'Export…', () => ui.setExport(true), `${modKey} E`),
    c('Map', 'new', 'New map', () => void newMapAndOpen()),
    c('Map', 'home', 'All maps', () => void goHome()),
    c('Help', 'help', 'Keyboard shortcuts', () => ui.setHelp(true), '?'),
    c('Help', 'settings', 'Settings and plugins…', () => ui.setSettings(true, 'general'), `${modKey} ,`),
  ]
  for (const l of LAYOUTS) list.push(c('Layout', `layout-${l.id}`, `Layout: ${l.name}`, () => setLayout(l.id)))
  for (const e of EDGES) list.push(c('Lines', `edge-${e.id}`, `Lines: ${e.name}`, () => setEdge(e.id)))
  for (const t of THEMES) list.push(c('Theme', `theme-${t.id}`, `Colour theme: ${t.name}`, () => setMapTheme(t.id)))
  for (const b of BGS) list.push(c('Theme', `bg-${b.id}`, `Background: ${b.name}`, () => setBg(b.id)))
  for (const p of useRegistry.getState().commands) list.push({ id: p.id, title: p.title, group: p.group, hint: p.hint, run: p.run })
  return list
}

export { select }
