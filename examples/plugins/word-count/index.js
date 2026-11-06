// Example Branchmint plugin: a word counter in the header.
// Install: copy this folder into the plugins folder (Settings > Plugins shows where),
// restart Branchmint, then switch the plugin on under Settings > Plugins.
//
// A plugin is an ES module whose default export has activate(ctx).
// ctx.react is the app's React, so no build step or bundling is needed.

export default {
  activate(ctx) {
    const h = ctx.react.createElement
    const { useSyncExternalStore } = ctx.react

    const count = (doc) => {
      if (!doc) return null
      let words = 0
      const nodes = Object.values(doc.nodes)
      for (const n of nodes) {
        const t = (n.text || '').trim()
        if (t) words += t.split(/\s+/).length
      }
      return { words, ideas: nodes.length }
    }

    // useSyncExternalStore re-renders the chip whenever the open map changes
    function Chip() {
      const doc = useSyncExternalStore(
        (notify) => {
          const sub = ctx.docs.subscribe(notify)
          return () => sub.dispose()
        },
        () => ctx.docs.current(),
      )
      const c = count(doc)
      if (!c) return null
      return h('span', { className: 'btn', style: { fontSize: 12, cursor: 'default' }, title: `${c.ideas} ideas` }, `${c.words} words`)
    }

    ctx.status.register({ id: 'chip', order: 50, render: () => h(Chip) })

    ctx.commands.register({
      id: 'copy',
      title: 'Copy word count',
      run() {
        const c = count(ctx.docs.current())
        if (!c) return ctx.ui.toast('Open a map first', 'info')
        navigator.clipboard.writeText(`${c.words} words, ${c.ideas} ideas`)
        ctx.ui.toast(`Copied: ${c.words} words, ${c.ideas} ideas`, 'success')
      },
    })
  },
}
