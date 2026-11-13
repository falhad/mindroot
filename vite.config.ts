import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  build: { target: 'safari15', sourcemap: false },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
})
