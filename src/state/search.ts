import { create } from 'zustand'
import { revealPath, searchNodes, type Hit } from '../core/search'
import { commit, select, useDoc } from './doc'
import { centerOnBox } from './view'

interface SearchState {
  query: string
  hits: Hit[]
  index: number
}

export const useSearch = create<SearchState>(() => ({ query: '', hits: [], index: 0 }))

/** Select a node, expanding collapsed ancestors, and bring it to the middle of the screen. */
export function focusNode(id: string) {
  const s = useDoc.getState()
  if (!s.doc?.nodes[id]) return
  if (!s.layout?.boxes[id]) commit((d) => revealPath(d, id), { silent: true })
  select([id])
  const box = useDoc.getState().layout?.boxes[id]
  if (box) centerOnBox(box)
}

export function runSearch(query: string) {
  const doc = useDoc.getState().doc
  const hits = doc ? searchNodes(doc, query) : []
  useSearch.setState({ query, hits, index: 0 })
  if (hits.length) focusNode(hits[0].id)
}

export function stepSearch(delta: 1 | -1) {
  const { hits, index } = useSearch.getState()
  if (!hits.length) return
  const next = (index + delta + hits.length) % hits.length
  useSearch.setState({ index: next })
  focusNode(hits[next].id)
}

export function clearSearch() {
  useSearch.setState({ query: '', hits: [], index: 0 })
}
