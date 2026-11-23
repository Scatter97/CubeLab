import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

const SEARCH_WORKER_FILE_PLACEHOLDER = '__CUBELAB_SEARCH_WORKER_FILE__'
const SEARCH_WORKER_FILE_MODULE = '/src/lib/searchWorkerFile.ts'

/**
 * `cubing.js` resolves its worker entry with `import.meta.resolve`, which keeps
 * the logical filename instead of the hashed production filename. Give the app
 * the emitted chunk URL so the shared scramble coordinator can replace it
 * before constructing the worker. That keeps construction synchronous and
 * therefore attributable to the request that initiated it.
 */
function scrambleWorkerUrlPlugin(): Plugin {
  let building = false
  return {
    name: 'cubelab-scramble-worker-url',
    configResolved(config) {
      building = config.command === 'build'
    },
    transform(code, id) {
      if (!id.endsWith(SEARCH_WORKER_FILE_MODULE)) return null
      // Keep the marker for generateBundle in a production build. Development
      // and tests use cubing.js's own resolved URL directly.
      return building
        ? null
        : code.replace(SEARCH_WORKER_FILE_PLACEHOLDER, '')
    },
    generateBundle(_options, bundle) {
      if (!building) return
      const workerChunk = Object.values(bundle).find(
        (entry) =>
          entry.type === 'chunk' &&
          (entry.name === 'search-worker-entry' ||
            entry.fileName.includes('search-worker-entry')),
      )
      if (!workerChunk) {
        throw new Error('Could not find the emitted cubing.js search worker.')
      }
      let replaced = false
      for (const entry of Object.values(bundle)) {
        if (
          entry.type !== 'chunk' ||
          !entry.code.includes(SEARCH_WORKER_FILE_PLACEHOLDER)
        ) {
          continue
        }
        // Replace the bare marker so it works whether the minifier kept a
        // quoted string or emitted a template literal.
        entry.code = entry.code.replaceAll(
          SEARCH_WORKER_FILE_PLACEHOLDER,
          workerChunk.fileName,
        )
        replaced = true
      }
      if (!replaced) {
        throw new Error('Could not inject the cubing.js search worker URL.')
      }
    },
  }
}

export default defineConfig({
  optimizeDeps: {
    exclude: ['cubing'],
  },
  plugins: [
    scrambleWorkerUrlPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'icon-192.png',
        'icon-512.png',
        'apple-touch-icon.png',
      ],
      manifest: {
        name: 'CubeLab — Speedcubing Timer',
        short_name: 'CubeLab',
        description:
          'A focused, offline-first speedcubing timer with official WCA scrambles for 12 events, inspection, and local solve history.',
        theme_color: '#ffffff',
        background_color: '#e9edf1',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        categories: ['utilities', 'sports'],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,woff,woff2,wasm}',
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // cubing.js creates its worker from a chunk URL, so Vite cannot emit a
    // worker-specific bundle. Dependency preloading is unnecessary here (the
    // PWA precaches every asset) and its browser-only helper cannot run in the
    // worker.
    modulePreload: false,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          // cubing.js instantiates its search worker from a chunk URL rather
          // than through Vite's worker pipeline. Keep the worker entry and its
          // `inside` payload as independent chunks, and keep all other cubing
          // modules together so Rolldown never merges shared worker modules
          // into the browser entry (which would execute React against a missing
          // `document` inside the worker).
          if (
            id.includes(
              '/cubing/dist/lib/cubing/chunks/search-worker-entry.js',
            ) ||
            id.includes('/cubing/dist/lib/cubing/chunks/inside-')
          ) {
            return undefined
          }
          if (id.includes('/node_modules/cubing/')) {
            return 'cubing'
          }
          return undefined
        },
      },
    },
  },
  test: {
    // theme.test.ts reads index.css through a `?raw` import. Vitest stubs CSS
    // imports to an empty string unless CSS processing is enabled.
    css: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
