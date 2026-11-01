import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  optimizeDeps: {
    exclude: ['cubing'],
  },
  plugins: [
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
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
