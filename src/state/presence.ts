import { create } from 'zustand'

/** Another person editing the same map. */
export interface Peer {
  id: number
  name: string
  color: string
  selection: string[]
}

interface PresenceState {
  peers: Peer[]
}

/** Who else is in the open map and what they have selected. Written by the collaboration plugin, read by the canvas. */
export const usePresence = create<PresenceState>(() => ({ peers: [] }))
