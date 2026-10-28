import { defineConfig } from 'vitest/config'

/**
 * Opt-in real Google Drive validation. Kept separate from the normal unit suite
 * so `npm test`, `npm run build`, and `npm run check` never make network calls.
 *
 *   CUBELAB_DRIVE_ACCESS_TOKEN="<token>" npm run validate:drive
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/validation/**/*.validation.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
