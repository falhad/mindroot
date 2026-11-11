export const SCHEMA_VERSION = 1

export type FontId = 'inter' | 'vazirmatn' | 'serif' | 'mono'

export type LayoutKind = 'mindmap' | 'right' | 'left' | 'down' | 'up' | 'radial'
export type EdgeKind = 'curve' | 'elbow' | 'straight'
export type ShapeKind = 'pill' | 'rounded' | 'rect' | 'plain'
export type BgKind = 'dots' | 'grid' | 'none'
export type Side = 'left' | 'right'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface NodeImage {
  /** data: URL (downscaled on import) */
  src: string
  w: number
  h: number
}

export interface Attachment {
  id: string
  name: string
  /** File name inside the vault `assets/` folder (SHA-256 + extension). */
  asset: string
  mime: string
  size: number
}

export interface MindNode {
  id: string
  parentId: string | null
  children: string[]
  text: string
  collapsed?: boolean
  /** palette slot ("0".."7") or a "#rrggbb" hex. Undefined = inherit / automatic. */
  color?: string
  shape?: ShapeKind
  /** "emoji:🚀" or "lucide:rocket" */
  icon?: string
  notes?: string
  link?: string
  image?: NodeImage
  checklist?: ChecklistItem[]
  /** Only used on root children in the "mindmap" layout. */
  side?: Side
  tags?: string[]
  /** Due date, `YYYY-MM-DD` (local calendar day). */
  due?: string
  /** Task state. Present (true or false) means the node is a task. */
  done?: boolean
  /** Link to a node (or just a map) in a map of this vault, by map id. */
  mapLink?: { mapId: string; nodeId?: string }
  attachments?: Attachment[]
  /** Set only on floating nodes (`parentId: null`, not the root): where their subtree starts. */
  pos?: { x: number; y: number }
  /** Sticky note: no connector line to a parent. */
  sticky?: boolean
  /** `'md'` = notes are Markdown. */
  notesFmt?: 'md'
}

/** A free-form cross link between two nodes (dashed line, not part of the tree). */
export interface Relation {
  id: string
  from: string
  to: string
  label?: string
  arrow?: 'end' | 'both' | 'none'
  dash?: 'dashed' | 'solid' | 'dotted'
}

/** A boundary drawn around sibling nodes (and their subtrees). */
export interface Group {
  id: string
  /** Sibling node ids (same parent). */
  ids: string[]
  label?: string
  color?: string
}

/** A bracket over consecutive siblings with a short label. */
export interface Summary {
  id: string
  parentId: string
  from: string
  to: string
  label: string
}

export interface MapMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  starred?: boolean
  tags: string[]
  /** Set when the map is in the trash. */
  trashedAt?: number | null
  /** Tiny SVG preview for dashboard cards. */
  thumb?: string
  /** Lower-cased text excerpt used for dashboard search. */
  search?: string
}

export interface MapDoc {
  v: number
  meta: MapMeta
  root: string
  nodes: Record<string, MindNode>
  relations: Relation[]
  layout: LayoutKind
  edge: EdgeKind
  themeId: string
  bg: BgKind
  groups?: Group[]
  summaries?: Summary[]
  font?: FontId
  /** `'rtl'` mirrors the whole layout. */
  dir?: 'ltr' | 'rtl'
  /** Eight `#rrggbb` colours replacing the theme palette. */
  customTheme?: string[]
  /** Data this version does not know. Kept and written back so older/newer files lose nothing. */
  extra?: { header?: Record<string, unknown>; records?: string[] }
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Direction = 'left' | 'right' | 'down' | 'up'
