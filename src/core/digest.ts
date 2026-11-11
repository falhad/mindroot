import { collectLinks, type LinkRef } from './links'
import { collectTasks, type TaskItem } from './tasks'
import { plainTitle } from './tree'
import type { MapDoc } from './types'

/** The small slice of a map that other screens need (links, tasks), so they never load every map in full. */
export interface MapDigest {
  updatedAt: number
  title: string
  links: LinkRef[]
  tasks: TaskItem[]
}

export function digestDoc(doc: MapDoc): MapDigest {
  return { updatedAt: doc.meta.updatedAt, title: plainTitle(doc), links: collectLinks(doc), tasks: collectTasks(doc) }
}
