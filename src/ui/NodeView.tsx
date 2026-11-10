import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowUpRight, Hash, Link2, Minus, NotebookText, SquareCheckBig } from 'lucide-react'
import { PLACEHOLDER, type NodeMetrics } from '../core/measure'
import type { Box, MindNode } from '../core/types'
import { isRtl, type NodeVisual } from '../core/visual'
import { addChild, addSibling, endEdit, setDraft, useDoc } from '../state/doc'
import { NodeIcon } from './icons'

export interface NodeViewProps {
  node: MindNode
  box: Box
  m: NodeMetrics
  vis: NodeVisual
  /** Side of the node where its children grow; the collapse button sits there. */
  side: 'left' | 'right' | 'up' | 'down'
  selected: boolean
  editing: boolean
  dim: boolean
  /** Part of the path to a tag-filter match: shown a little faded. */
  soft?: boolean
  /** Not revealed yet in a presentation. */
  stepHidden?: boolean
  /** Another person who has this idea selected (live collaboration). */
  peer?: { name: string; color: string }
  match: boolean
  dropInto: boolean
  dragging: boolean
  connecting: boolean
}

function NodeViewImpl({ node, box, m, vis, side, selected, editing, dim, soft, stepHidden, peer, match, dropInto, dragging, connecting }: NodeViewProps) {
  const plain = !vis.fill && !vis.stroke
  const style: CSSProperties = {
    transform: `translate(${box.x}px, ${box.y}px)`,
    width: box.w,
    height: box.h,
    borderRadius: vis.radius,
    color: vis.text,
    border: vis.stroke ? `${vis.strokeWidth}px solid ${vis.stroke}` : undefined,
    background: vis.gradient ? `linear-gradient(135deg, ${vis.gradient[0]}, ${vis.gradient[1]})` : (vis.fill ?? undefined),
    ['--sel' as string]: vis.accent,
    ...(peer ? { outline: `2.5px solid ${peer.color}`, outlineOffset: 3 } : {}),
    font: `${m.fontWeight} ${m.fontSize}px/${m.lineH}px ${m.family}`,
  }
  const cls = ['node', plain && 'plain', selected && 'selected', dim && 'dim', soft && 'soft', stepHidden && 'step-hidden', match && 'match', dropInto && 'drop-into', dragging && 'dragging', connecting && 'connect-target']
    .filter(Boolean)
    .join(' ')
  const textW = box.w - m.padX * 2 - m.iconW - m.badgeW

  return (
    <div className={cls} style={style} data-node-id={node.id}>
      <div style={{ display: 'flex', padding: `${m.padY}px ${m.padX}px 0`, height: m.lines.length * m.lineH }}>
        {node.icon && (
          <span style={{ width: m.iconW, display: 'grid', placeItems: 'center start', height: m.lineH, flex: 'none' }}>
            <NodeIcon icon={node.icon} size={m.fontSize} />
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          {editing ? (
            <Editor node={node} m={m} width={textW} />
          ) : node.text === '' ? (
            <div className="node-text" style={{ opacity: 0.55, height: m.lineH }}>{PLACEHOLDER}</div>
          ) : (
            m.lines.map((line, i) => (
              <div key={i} className="node-text" dir={isRtl(line) ? 'rtl' : 'ltr'} style={{ height: m.lineH }}>
                {line || '​'}
              </div>
            ))
          )}
        </div>
        {m.badgeW > 0 && (
          <span style={{ width: m.badgeW, flex: 'none', display: 'flex', gap: 2, justifyContent: 'flex-end', alignItems: 'flex-start', height: m.lineH, paddingTop: (m.lineH - 14) / 2 }}>
            {node.notes?.trim() && (
              <span data-badge="notes" title="Has notes" style={badge}><NotebookText size={13} /></span>
            )}
            {node.link && (
              <span data-badge="link" title={node.link} style={badge}><Link2 size={13} /></span>
            )}
            {node.checklist?.length ? (
              <span data-badge="check" title="Checklist" style={badge}><SquareCheckBig size={13} /></span>
            ) : null}
            {node.mapLink ? (
              <span data-badge="maplink" title="Linked map (click to open)" style={badge}><ArrowUpRight size={13} /></span>
            ) : null}
            {node.tags?.length ? (
              <span data-badge="tags" title={node.tags.map((t) => `#${t}`).join(' ')} style={badge}><Hash size={13} /></span>
            ) : null}
          </span>
        )}
      </div>
      {node.image && (
        <img
          src={node.image.src}
          alt=""
          draggable={false}
          style={{ display: 'block', width: m.imgW, height: m.imgH, margin: '8px auto 0', borderRadius: Math.max(4, vis.radius - 6), objectFit: 'cover', pointerEvents: 'none' }}
        />
      )}
      {vis.underline && (
        <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, borderRadius: 2, background: vis.underline }} />
      )}
      {peer && (
        <span data-peer={peer.name} aria-hidden style={{ position: 'absolute', left: 0, bottom: '100%', marginBottom: 5, padding: '1px 6px', borderRadius: 6, fontSize: 11, fontWeight: 600, lineHeight: '16px', color: '#fff', background: peer.color, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {peer.name}
        </span>
      )}
      {node.children.length > 0 && (
        <button
          data-collapse={node.id}
          className={node.collapsed ? 'collapse-dot' : 'collapse-btn'}
          style={{ ['--dotc' as string]: vis.accent, ...buttonPosition(side, box.w, box.h, node.collapsed ? 22 : 20, -6) }}
          aria-label={node.collapsed ? `Expand (${node.children.length} hidden)` : 'Collapse'}
          title={node.collapsed ? 'Expand (Space)' : 'Collapse (Space)'}
        >
          {node.collapsed ? node.children.length : <Minus size={12} strokeWidth={2.75} />}
        </button>
      )}
    </div>
  )
}

/**
 * Place a `size` px button on `side` of a w x h box. A negative `gap` overlaps the edge, so the
 * pointer can move from the node onto the button without leaving the node's hover area.
 * Expanded and collapsed use the same anchor, so the button does not jump when you click it.
 */
function buttonPosition(side: 'left' | 'right' | 'up' | 'down', w: number, h: number, size: number, gap: number): CSSProperties {
  const mid = (len: number) => len / 2 - size / 2
  switch (side) {
    case 'left': return { left: -size - gap, top: mid(h) }
    case 'up': return { top: -size - gap, left: mid(w) }
    case 'down': return { top: h + gap, left: mid(w) }
    default: return { left: w + gap, top: mid(h) }
  }
}

const badge: CSSProperties = { display: 'grid', placeItems: 'center', width: 16, height: 14, opacity: 0.8 }

/** In-place text editor. Its draft text feeds the layout so the node grows while you type. */
function Editor({ node, m, width }: { node: MindNode; m: NodeMetrics; width: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(node.text)
  const rtl = isRtl(value)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.select()
  }, [])

  const finish = (then?: 'sibling' | 'child') => {
    const state = useDoc.getState()
    if (state.editingId !== node.id) return
    const text = ref.current?.value ?? value
    if (text.trim() === '' && state.freshId === node.id) return endEdit(null)
    endEdit(text)
    if (then === 'sibling') addSibling()
    if (then === 'child') addChild()
  }

  return (
    <textarea
      ref={ref}
      className="node-edit"
      value={value}
      dir={rtl ? 'rtl' : 'ltr'}
      rows={m.lines.length}
      spellCheck
      lang={rtl ? 'fa' : undefined}
      placeholder={PLACEHOLDER}
      style={{ font: 'inherit', lineHeight: `${m.lineH}px`, height: m.lines.length * m.lineH, width: Math.max(width, 20) }}
      onChange={(e) => {
        setValue(e.target.value)
        setDraft({ id: node.id, text: e.target.value })
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          finish(e.metaKey || e.ctrlKey ? undefined : 'sibling')
        } else if (e.key === 'Tab') {
          e.preventDefault()
          finish(e.shiftKey ? undefined : 'child')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish()
        }
      }}
      onBlur={() => finish()}
    />
  )
}

export const NodeView = memo(NodeViewImpl)
