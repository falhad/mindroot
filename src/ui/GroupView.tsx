import { memo } from 'react'
import { bracketPath } from '../core/edges'
import type { LayoutResult } from '../core/layout'
import { getTheme, resolveColor } from '../core/themes'
import { isRtl } from '../core/visual'
import type { MapDoc } from '../core/types'

/** Group boundaries (behind the nodes). Pointer events pass through to the canvas. */
export const GroupBoxes = memo(function GroupBoxes({ doc, layout, dark }: { doc: MapDoc; layout: LayoutResult; dark: boolean }) {
  const groups = doc.groups ?? []
  if (!groups.length) return null
  const theme = getTheme(doc.themeId)
  return (
    <>
      {groups.map((g) => {
        const b = layout.groupBoxes[g.id]
        if (!b) return null
        const c = resolveColor(g.color, theme, dark) ?? 'var(--muted)'
        return (
          <div
            key={g.id}
            data-group={g.id}
            style={{
              position: 'absolute', left: 0, top: 0, transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h, borderRadius: 16, boxSizing: 'border-box',
              border: `1.5px dashed ${c}`, background: `color-mix(in srgb, ${c} 8%, transparent)`, pointerEvents: 'none',
            }}
          >
            {g.label && (
              <span dir="auto" style={{ position: 'absolute', left: 12, top: 6, fontSize: 12, fontWeight: 600, color: c, maxWidth: b.w - 24, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {g.label}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
})

/** Summary braces, drawn inside the edges SVG. */
export function SummaryBraces({ doc, layout }: { doc: MapDoc; layout: LayoutResult }) {
  return (
    <>
      {(doc.summaries ?? []).map((s) => {
        const sb = layout.summaryBoxes[s.id]
        if (!sb) return null
        return (
          <g key={s.id} data-summary={s.id}>
            <path d={bracketPath(sb.bracket, sb.side)} stroke="var(--muted)" strokeWidth={2} />
            {s.label && (
              <text x={sb.label.x + sb.label.w / 2} y={sb.label.y + sb.label.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={500} fill="var(--ink)"
                strokeWidth={0} direction={isRtl(s.label) ? 'rtl' : 'ltr'} style={{ fontFamily: 'var(--font-sans)' }}>
                {s.label}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
}
