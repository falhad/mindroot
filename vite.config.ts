import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

const host = process.env.TAURI_DEV_HOST

// On the website the landing page is at / and the app is at /app/ (scripts/web-layout.mjs). In development the
// app is at / and the landing page at /site/, so the landing page's links to /app/ go to the app.
const appAlias: Plugin = {
  name: 'mindroot-app-alias',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/app' || req.url?.startsWith('/app/')) {
        res.statusCode = 302
        res.setHeader('Location', '/' + req.url.slice(5))
        return res.end()
      }
      next()
    })
  },
}

// `vite build --mode web` also builds the landing page (site/index.html). The desktop app does not need it.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), appAlias],
  // The web version uses it for the download links when GitHub does not answer (src/io/release.ts).
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'safari15',
    sourcemap: false,
    rollupOptions: mode === 'web' ? { input: { index: 'index.html', site: 'site/index.html' } } : undefined,
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
}))
