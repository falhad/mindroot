import { useEffect, useMemo } from 'react'
import { ArrowLeft, CalendarClock, CheckCircle2, Circle, Inbox, ListChecks } from 'lucide-react'
import { bucketTasks, todayString, type MapTask, type TaskBuckets } from '../core/tasks'
import { useDigest } from '../state/digest'
import { mutate, refreshLibrary, useLibrary } from '../state/library'
import { openMap } from '../state/links'
import { goTo, toast } from '../state/ui'
import { StatusSlot } from './StatusSlot'

const SECTIONS: { key: keyof TaskBuckets; title: string; tone?: 'danger' | 'accent' }[] = [
  { key: 'overdue', title: 'Overdue', tone: 'danger' },
  { key: 'today', title: 'Today', tone: 'accent' },
  { key: 'week', title: 'Next 7 days' },
  { key: 'later', title: 'Later' },
  { key: 'noDate', title: 'No date' },
  { key: 'done', title: 'Done' },
]

/** Every task from every map (nodes with a due date or a done state), grouped by when they are due. */
export function TasksView() {
  const byMap = useDigest((s) => s.byMap)
  const ready = useDigest((s) => s.ready)
  const loaded = useLibrary((s) => s.loaded)
  useEffect(() => {
    void refreshLibrary()
  }, [])

  const today = todayString()
  const buckets = useMemo(() => {
    const all: MapTask[] = []
    for (const [mapId, g] of Object.entries(byMap)) for (const t of g.tasks) all.push({ ...t, mapId, mapTitle: g.title })
    return bucketTasks(all, today)
  }, [byMap, today])
  const total = Object.values(buckets).reduce((n, l) => n + l.length, 0)

  const toggle = async (t: MapTask) => {
    try {
      await mutate(t.mapId, (d) => {
        const n = d.nodes[t.nodeId]
        if (n) n.done = !t.done
      })
    } catch (e) {
      toast(`Could not update the task: ${e instanceof Error ? e.message : e}`, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <button className="btn icon" aria-label="All maps" onClick={() => goTo({ name: 'dashboard' })}><ArrowLeft size={17} /></button>
        <h1 className="flex items-center gap-2 text-[15px] font-semibold"><ListChecks size={18} className="text-accent" /> Tasks</h1>
        <div className="flex-1" />
        <StatusSlot />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-5 py-6">
          {total === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-[var(--line-strong)] px-6 py-16 text-center">
              <Inbox size={34} className="mb-3 text-muted" />
              <p className="text-[14px] font-medium">{ready || loaded ? 'No tasks yet' : 'Reading your maps…'}</p>
              <p className="mt-1 max-w-sm text-[13px] text-muted">Select an idea, open the side panel, and give it a due date or switch on “Track as task”. It shows up here, from every map.</p>
            </div>
          ) : (
            SECTIONS.map(({ key, title, tone }) =>
              buckets[key].length ? (
                <section key={key} className="mb-7" aria-label={title} data-bucket={key}>
                  <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold" style={{ color: tone === 'danger' ? 'var(--danger)' : undefined }}>
                    {title} <span className="text-[12px] font-normal tabular-nums text-muted">{buckets[key].length}</span>
                  </h2>
                  <ul className="overflow-hidden rounded-xl border border-line">
                    {buckets[key].map((t) => (
                      <li key={`${t.mapId}:${t.nodeId}`} data-task={t.nodeId} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-hover">
                        <button className="shrink-0 text-muted hover:text-accent" aria-label={t.done ? `Mark “${t.text}” not done` : `Mark “${t.text}” done`} aria-pressed={t.done} onClick={() => void toggle(t)}>
                          {t.done ? <CheckCircle2 size={19} className="text-accent" /> : <Circle size={19} />}
                        </button>
                        <button className="min-w-0 flex-1 text-left" onClick={() => openMap(t.mapId, t.nodeId)}>
                          <span className={`block truncate text-[14px] ${t.done ? 'text-muted line-through' : ''}`} dir="auto">{t.text}</span>
                          <span className="block truncate text-[12px] text-muted" dir="auto">{t.mapTitle}{t.checklist ? ` · ${t.checklist.done}/${t.checklist.total} checklist` : ''}</span>
                        </button>
                        {t.due && (
                          <span className="flex shrink-0 items-center gap-1 text-[12px] tabular-nums" style={{ color: key === 'overdue' ? 'var(--danger)' : 'var(--muted)' }}>
                            <CalendarClock size={13} /> {t.due}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null,
            )
          )}
        </div>
      </main>
    </div>
  )
}
