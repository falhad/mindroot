import type { MapDoc } from './types'

export interface TaskItem {
  nodeId: string
  text: string
  /** `YYYY-MM-DD`, local calendar day. */
  due?: string
  done: boolean
  checklist?: { done: number; total: number }
}

export interface MapTask extends TaskItem {
  mapId: string
  mapTitle: string
}

export interface TaskBuckets {
  overdue: MapTask[]
  today: MapTask[]
  /** Due in the next 7 days (after today). */
  week: MapTask[]
  later: MapTask[]
  noDate: MapTask[]
  done: MapTask[]
}

/** A real calendar date in `YYYY-MM-DD` form (so `2026-02-30` is not one). */
export function isDueDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/** Today in the user's local calendar, as `YYYY-MM-DD`. */
export function todayString(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** Calendar arithmetic on date strings (no time zones involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Nodes with a due date or a done state. */
export function collectTasks(doc: MapDoc): TaskItem[] {
  const out: TaskItem[] = []
  for (const n of Object.values(doc.nodes)) {
    if (n.due === undefined && n.done === undefined) continue
    const total = n.checklist?.length ?? 0
    out.push({
      nodeId: n.id,
      text: n.text.replace(/\s+/g, ' ').trim() || 'New idea',
      ...(n.due ? { due: n.due } : {}),
      done: n.done === true,
      ...(total ? { checklist: { done: n.checklist!.filter((c) => c.done).length, total } } : {}),
    })
  }
  return out
}

/** Group tasks for the tasks view. `today` is passed in, so the result does not depend on the clock. */
export function bucketTasks(tasks: MapTask[], today: string): TaskBuckets {
  const out: TaskBuckets = { overdue: [], today: [], week: [], later: [], noDate: [], done: [] }
  const weekEnd = addDays(today, 7)
  for (const t of tasks) {
    if (t.done) out.done.push(t)
    else if (!t.due) out.noDate.push(t)
    else if (t.due < today) out.overdue.push(t)
    else if (t.due === today) out.today.push(t)
    else if (t.due <= weekEnd) out.week.push(t)
    else out.later.push(t)
  }
  const cmp = (a: MapTask, b: MapTask) => (a.due ?? '').localeCompare(b.due ?? '') || a.text.localeCompare(b.text) || a.mapTitle.localeCompare(b.mapTitle)
  for (const k of Object.keys(out) as (keyof TaskBuckets)[]) out[k].sort(cmp)
  return out
}
