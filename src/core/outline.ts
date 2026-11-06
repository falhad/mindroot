import { uid } from './ids'
import { createDoc, orderedIds } from './tree'
import { SCHEMA_VERSION, type MapDoc, type MindNode } from './types'

export interface OutNode {
  text: string
  notes?: string
  link?: string
  checklist?: { text: string; done: boolean }[]
  children: OutNode[]
}

interface Frame {
  key: number
  node: OutNode
}

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const CHECK = /^\[( |x|X)\]\s+(.*)$/
const MD_LINK = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/

function indentWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch === '\t' ? 4 : 1
  return w
}

/**
 * Parse Markdown-ish outlines: `#` headings, `-`/`*`/`1.` bullets, plain indented lines,
 * `> notes` and `- [ ] checklist` items. Returns a forest.
 */
export function parseOutline(text: string): OutNode[] {
  const forest: OutNode = { text: '', children: [] }
  const stack: Frame[] = [{ key: -Infinity, node: forest }]
  let last: OutNode | null = null

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue

    const quote = /^\s*>\s?(.*)$/.exec(raw)
    if (quote && last) {
      last.notes = last.notes ? last.notes + '\n' + quote[1] : quote[1]
      continue
    }

    let key: number
    let body: string
    const h = HEADING.exec(raw)
    if (h) {
      key = -1000 + h[1].length
      body = h[2]
    } else {
      const b = BULLET.exec(raw)
      key = indentWidth(b ? b[1] : /^\s*/.exec(raw)![0])
      body = (b ? b[2] : raw.trim()).trim()
    }

    while (stack.length > 1 && stack[stack.length - 1].key >= key) stack.pop()
    const parent = stack[stack.length - 1].node

    const chk = CHECK.exec(body)
    if (chk && parent !== forest) {
      ;(parent.checklist ??= []).push({ text: chk[2].trim(), done: chk[1].toLowerCase() === 'x' })
      continue
    }

    const node: OutNode = { text: body, children: [] }
    const link = MD_LINK.exec(body)
    if (link) {
      node.text = link[1]
      node.link = link[2]
    }
    parent.children.push(node)
    stack.push({ key, node })
    last = node
  }
  return forest.children
}

/** Build a document from an outline. A single top-level item becomes the root. */
export function docFromOutline(forest: OutNode[], fallbackTitle = 'Imported map'): MapDoc {
  const rootOut: OutNode = forest.length === 1 ? forest[0] : { text: fallbackTitle, children: forest }
  const doc = createDoc(rootOut.text || fallbackTitle)
  const apply = (n: MindNode, o: OutNode) => {
    if (o.notes) n.notes = o.notes
    if (o.link) n.link = o.link
    if (o.checklist?.length) n.checklist = o.checklist.map((c) => ({ id: uid(8), text: c.text, done: c.done }))
  }
  const build = (parentId: string, o: OutNode) => {
    for (const c of o.children) {
      const id = uid()
      doc.nodes[id] = { id, parentId, children: [], text: c.text }
      doc.nodes[parentId].children.push(id)
      apply(doc.nodes[id], c)
      build(id, c)
    }
  }
  apply(doc.nodes[doc.root], rootOut)
  build(doc.root, rootOut)
  return doc
}

export function toMarkdown(doc: MapDoc): string {
  const out: string[] = []
  const label = (n: MindNode) => {
    const t = n.text.replace(/\n+/g, ' ').trim() || 'Untitled'
    return n.link ? `[${t.replace(/[\[\]]/g, '')}](${n.link})` : t
  }
  const extras = (n: MindNode, pad: string) => {
    for (const line of (n.notes ?? '').split('\n')) if (line.trim()) out.push(`${pad}> ${line}`)
    for (const c of n.checklist ?? []) out.push(`${pad}- [${c.done ? 'x' : ' '}] ${c.text}`)
  }
  const root = doc.nodes[doc.root]
  out.push(`# ${label(root)}`, '')
  extras(root, '')
  const rec = (id: string, level: number) => {
    const n = doc.nodes[id]
    const pad = '  '.repeat(level)
    out.push(`${pad}- ${label(n)}`)
    extras(n, pad + '  ')
    for (const c of n.children) rec(c, level + 1)
  }
  for (const c of root.children) rec(c, 0)
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

// ---------- JSON ----------

const LAYOUTS = ['mindmap', 'right', 'left', 'down', 'up', 'radial']
const EDGES = ['curve', 'elbow', 'straight']
const BGS = ['dots', 'grid', 'none']

/**
 * Validate and repair a stored/imported document. Throws only when no usable tree remains.
 * Unknown ids in `children` are dropped; unreachable nodes are discarded.
 */
export function sanitizeDoc(raw: unknown): MapDoc {
  const r = raw as Partial<MapDoc> | null
  if (!r || typeof r !== 'object' || typeof r.nodes !== 'object' || !r.nodes || typeof r.root !== 'string' || !r.nodes[r.root]) {
    throw new Error('Not a Branchmint map')
  }
  const nodes: Record<string, MindNode> = {}
  const seen = new Set<string>()
  const visit = (id: string, parentId: string | null) => {
    const src = r.nodes![id]
    if (!src || seen.has(id)) return
    seen.add(id)
    const n: MindNode = { ...src, id, parentId, text: typeof src.text === 'string' ? src.text : '', children: [] }
    nodes[id] = n
    for (const c of Array.isArray(src.children) ? src.children : []) {
      if (typeof c === 'string' && r.nodes![c] && !seen.has(c)) {
        n.children.push(c)
        visit(c, id)
      }
    }
    n.children = n.children.filter((c) => nodes[c])
  }
  visit(r.root, null)

  const now = Date.now()
  const meta = r.meta ?? ({} as Partial<MapDoc['meta']>)
  const doc: MapDoc = {
    v: SCHEMA_VERSION,
    meta: {
      id: typeof meta.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(meta.id) ? meta.id : uid(12),
      title: typeof meta.title === 'string' ? meta.title : '',
      createdAt: Number(meta.createdAt) || now,
      updatedAt: Number(meta.updatedAt) || now,
      nodeCount: Object.keys(nodes).length,
      starred: !!meta.starred,
      tags: Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [],
      trashedAt: meta.trashedAt ?? null,
    },
    root: r.root,
    nodes,
    relations: (Array.isArray(r.relations) ? r.relations : []).filter(
      (x) => x && nodes[x.from] && nodes[x.to] && x.from !== x.to,
    ),
    layout: LAYOUTS.includes(r.layout as string) ? r.layout! : 'mindmap',
    edge: EDGES.includes(r.edge as string) ? r.edge! : 'curve',
    themeId: typeof r.themeId === 'string' ? r.themeId : 'mint',
    bg: BGS.includes(r.bg as string) ? r.bg! : 'dots',
  }
  return doc
}

function genericToOutline(v: unknown, depth = 0): OutNode | null {
  if (depth > 200 || !v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const text = [o.text, o.title, o.name, o.topic, o.label].find((x) => typeof x === 'string') as string | undefined
  const kids = [o.children, o.nodes, o.topics, o.items].find(Array.isArray) as unknown[] | undefined
  if (text === undefined && !kids) return null
  return {
    text: text ?? '',
    notes: typeof o.notes === 'string' ? o.notes : undefined,
    children: (kids ?? []).map((k) => genericToOutline(k, depth + 1)).filter((x): x is OutNode => !!x),
  }
}

/** Import JSON text: a Branchmint export, or any `{text|title, children}` tree. Always assigns a fresh map id. */
export function importJson(text: string): MapDoc {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON')
  }
  const d = data as Partial<MapDoc>
  if (d && typeof d === 'object' && d.nodes && d.root) {
    const doc = sanitizeDoc(d)
    doc.meta.id = uid(12)
    doc.meta.createdAt = doc.meta.updatedAt = Date.now()
    doc.meta.trashedAt = null
    return doc
  }
  const tree = genericToOutline(Array.isArray(data) ? { text: 'Imported map', children: data } : data)
  if (!tree) throw new Error('Could not find a tree of nodes in this JSON')
  return docFromOutline([tree])
}

export function importMarkdown(text: string, title = 'Imported map'): MapDoc {
  const forest = parseOutline(text)
  if (!forest.length) throw new Error('Nothing to import: the file has no text')
  return docFromOutline(forest, title)
}

export function exportJson(doc: MapDoc): string {
  return JSON.stringify(doc, null, 2)
}

export function allText(doc: MapDoc): string {
  return orderedIds(doc)
    .map((id) => doc.nodes[id].text)
    .join('\n')
}
