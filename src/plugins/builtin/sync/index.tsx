import type { Plugin } from '../../types'
import { SyncController, setController } from './controller'
import { SyncPanel } from './SyncPanel'
import { SyncStatus } from './SyncStatus'

/** Keeps the vault folder in a private Git repository. The first plugin built on the plugin API. */
export const syncPlugin: Plugin = {
  manifest: {
    id: 'mindroot.sync',
    name: 'Git sync',
    version: '1.0.0',
    description: 'Back up your maps to a private Git repository and keep several computers in step.',
    permissions: ['native'],
  },
  async activate(ctx) {
    ctx.settingsPanel.register({ title: 'Git sync', render: () => <SyncPanel desktop={ctx.isDesktop} /> })
    if (!ctx.isDesktop || !ctx.native) return
    const c = new SyncController(ctx)
    setController(c)
    ctx.status.register({ id: 'status', order: 10, render: () => <SyncStatus /> })
    await c.init()
  },
  deactivate() {
    // timers are cleared; the controller object is dropped
    import('./controller').then((m) => {
      m.getController()?.dispose()
      m.setController(null)
    })
  },
}
