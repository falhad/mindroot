import { linkStatus } from '../core/links'
import type { MapMeta } from '../core/types'
import { useLibrary } from './library'
import { goTo, toast, useUi } from './ui'

/** Open a map (and select a node in it). The selection is applied by the editor once the map has loaded. */
export function openMap(mapId: string, nodeId?: string) {
  useUi.setState({ pendingSelect: nodeId ? { mapId, nodeId } : null })
  goTo({ name: 'editor', id: mapId })
}

/** Follow a node's map link, with a plain message when the target is gone or in the trash. */
export function followMapLink(link: { mapId: string; nodeId?: string }, metas: MapMeta[] = useLibrary.getState().items) {
  const status = metas.length ? linkStatus(link, metas) : 'ok'
  if (status === 'missing') return toast('That map is not in your library any more', 'error')
  if (status === 'trashed') return toast('That map is in the trash. Restore it to open the link', 'error')
  openMap(link.mapId, link.nodeId)
}
