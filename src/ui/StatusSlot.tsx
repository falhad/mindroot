import { useRegistry } from '../plugins/host'

/** Renders status chips contributed by plugins. */
export function StatusSlot() {
  const items = useRegistry((s) => s.status)
  if (!items.length) return null
  return (
    <div className="no-drag flex items-center gap-1">
      {items.map((i) => (
        <span key={i.id}>{i.render()}</span>
      ))}
    </div>
  )
}
