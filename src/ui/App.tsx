import { useEffect } from 'react'
import { startAutosave } from '../state/persist'
import { applyTheme, parseRoute, useUi } from '../state/ui'
import { Dashboard } from './Dashboard'
import { Editor } from './Editor'
import { ConfirmDialog, HelpDialog, Toasts } from './Overlays'

let started = false

export function App() {
  const route = useUi((s) => s.route)

  useEffect(() => {
    if (!started) {
      started = true
      startAutosave()
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
    return () => {
      removeEventListener('popstate', onPop)
      removeEventListener('hashchange', onPop)
      mq.removeEventListener('change', onScheme)
      removeEventListener('dragover', stop)
      removeEventListener('drop', stop)
    }
  }, [])

  return (
    <>
      {route.name === 'editor' ? <Editor key={route.id} id={route.id} /> : <Dashboard />}
      {route.name === 'editor' && <Toasts />}
      <HelpDialog />
      <ConfirmDialog />
    </>
  )
}
