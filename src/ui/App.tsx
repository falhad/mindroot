import { useEffect } from 'react'
import { isTauri } from '../io/env'
import { builtinPlugins } from '../plugins/builtin'
import { discoverPlugins, importFromBlob, tauriPluginFiles } from '../plugins/external'
import { emitAndWait, startPlugins } from '../plugins/host'
import type { Plugin } from '../plugins/types'
import { flushSave, startAutosave } from '../state/persist'
import { applyTheme, parseRoute, ui, useUi } from '../state/ui'
import { Dashboard } from './Dashboard'
import { TasksView } from './TasksView'
import { Editor } from './Editor'
import { ConfirmDialog, HelpDialog, Toasts } from './Overlays'
import { SettingsDialog } from './SettingsDialog'

let started = false

async function boot() {
  startAutosave()
  const list: { plugin: Plugin; builtin: boolean; error?: string }[] = builtinPlugins.map((plugin) => ({ plugin, builtin: true }))
  if (isTauri) {
    const external = await discoverPlugins(await tauriPluginFiles(), importFromBlob, new Set(builtinPlugins.map((p) => p.manifest.id)))
    list.push(...external)
  }
  await startPlugins(list)
  if (isTauri) await installCloseHandler()
}

/** On close: save, let plugins finish (the Git sync pushes), then really quit. */
async function installCloseHandler() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  let closing = false
  await win.onCloseRequested(async (e) => {
    if (closing) return
    closing = true
    e.preventDefault()
    try {
      await flushSave()
      await emitAndWait('app:before-quit', undefined, 10_000)
    } finally {
      await win.destroy()
    }
  })
}

export function App() {
  const route = useUi((s) => s.route)

  useEffect(() => {
    if (!started) {
      started = true
      void boot().catch((e) => console.error('startup failed', e))
    }
    const onPop = () => useUi.setState({ route: parseRoute(location.hash) })
    addEventListener('popstate', onPop)
    addEventListener('hashchange', onPop)
    // follow the OS appearance while in "system" mode
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      if (useUi.getState().themeMode === 'system') applyTheme('system')
    }
    mq.addEventListener('change', onScheme)
    // never let a dropped file navigate the webview away from the app
    const stop = (e: DragEvent) => e.preventDefault()
    addEventListener('dragover', stop)
    addEventListener('drop', stop)
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        ui.setSettings(!useUi.getState().settingsOpen, 'general')
      }
    }
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('popstate', onPop)
      removeEventListener('hashchange', onPop)
      mq.removeEventListener('change', onScheme)
      removeEventListener('dragover', stop)
      removeEventListener('drop', stop)
      removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <>
      {route.name === 'editor' ? <Editor key={route.id} id={route.id} /> : route.name === 'tasks' ? <TasksView /> : <Dashboard />}
      {route.name === 'editor' && <Toasts />}
      <HelpDialog />
      <SettingsDialog />
      <ConfirmDialog />
    </>
  )
}
