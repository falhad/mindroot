import { useEffect } from 'react'
import { navigate } from '../core/layout'
import { inTextField, handleCopy, handlePaste } from '../state/clipboard'
import {
  addChild, addSibling, deleteSelection, duplicateSelection, indent, outdent, primary, redo, reorder, select, selectAll,
  setConnectFrom, startEdit, toggleCollapse, undo, useDoc,
} from '../state/doc'
import { flushSave } from '../state/persist'
import { clearSearch, focusNode } from '../state/search'
import { toast, ui, useUi } from '../state/ui'
import { revealBox, zoomBy } from '../state/view'
import { fitCurrent, resetZoom } from './commands'

/** Global keyboard shortcuts while a map is open. Text fields keep their native behaviour. */
export function useEditorHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const ds = useDoc.getState()
      if (!ds.doc) return

      // overlays that own the keyboard
      const u = useUi.getState()
      if (u.paletteOpen || u.exportOpen || u.helpOpen) return

      if (mod && k === 'k') { e.preventDefault(); ui.setPalette(true); return }
      if (mod && k === 'f') { e.preventDefault(); ui.setSearch(true); return }

      const typing = inTextField(e.target)
      if (typing) return

      if (mod) {
        switch (k) {
          case 'z': e.preventDefault(); e.shiftKey ? redo() : undo(); return
          case 'y': e.preventDefault(); redo(); return
          case 'a': e.preventDefault(); selectAll(); return
          case 'd': e.preventDefault(); duplicateSelection(); return
          case 'e': e.preventDefault(); ui.setExport(true); return
          case 'i': e.preventDefault(); ui.toggleInspector(); return
          case 's': e.preventDefault(); void flushSave().then(() => toast('Saved', 'success')); return
          case '0': e.preventDefault(); fitCurrent(); return
          case '1': e.preventDefault(); resetZoom(); return
          case '=': case '+': e.preventDefault(); zoomBy(1.25); return
          case '-': e.preventDefault(); zoomBy(0.8); return
          case '/': e.preventDefault(); ui.setHelp(true); return
        }
        return
      }

      // Tab / Enter / Space belong to focused buttons and links; map shortcuts only fire from the canvas.
      const el = e.target as HTMLElement
      const onCanvas = el === document.body || !!el.closest?.('.canvas')
      if (!onCanvas && ['Tab', 'Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) return

      const sel = primary(ds)
      const layout = ds.layout!
      switch (e.key) {
        case 'Tab': e.preventDefault(); addChild(); return
        case 'Enter': e.preventDefault(); addSibling(e.shiftKey); return
        case 'F2': e.preventDefault(); startEdit(); return
        case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); return
        case ' ': e.preventDefault(); toggleCollapse(); return
        case '?': e.preventDefault(); ui.setHelp(true); return
        case 'Home': e.preventDefault(); select([ds.doc.root]); focusNode(ds.doc.root); return
        case 'Escape':
          if (ds.connectFrom) setConnectFrom(null)
          else if (useUi.getState().searchOpen) { ui.setSearch(false); clearSearch() }
          else select([])
          return
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
          e.preventDefault()
          const dir = e.key.slice(5).toLowerCase() as 'left' | 'right' | 'up' | 'down'
          if (e.altKey) {
            if (dir === 'up') reorder(-1)
            else if (dir === 'down') reorder(1)
            else if (dir === 'left') outdent()
            else indent()
            return
          }
          const from = sel ?? ds.doc.root
          const next = navigate(layout, from, dir)
          if (next) {
            select(e.shiftKey ? [...ds.selection.filter((x) => x !== next), next] : [next])
            const b = useDoc.getState().layout!.boxes[next]
            if (b) revealBox(b)
          }
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    const onCopy = (e: ClipboardEvent) => handleCopy(e)
    const onCut = (e: ClipboardEvent) => handleCopy(e, true)
    const onPaste = (e: ClipboardEvent) => void handlePaste(e)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])
}
