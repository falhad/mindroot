export const SCHEMA_VERSION = 1

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
}

/** A free-form cross link between two nodes (dashed line, not part of the tree). */
export interface Relation {
  id: string
  from: string
  to: string
  label?: string
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
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Direction = 'left' | 'right' | 'down' | 'up'
