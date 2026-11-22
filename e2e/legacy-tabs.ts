import type { BrowserContext } from '@playwright/test'

/**
 * Simulate clients predating the single-tab gate, solely for protocol tests.
 * Production has no bypass. Keep the real replacement/Drive locks intact.
 */
export async function simulateLegacyConcurrentTabs(context: BrowserContext) {
  await context.addInitScript(() => {
    // WebKit can hand back a different LockManager wrapper for repeated
    // `navigator.locks` reads, so replace the whole object with a stable one.
    const locks = navigator.locks
    const request = locks.request.bind(locks)
    const fake = {
      request(...args: unknown[]) {
        const name = args[0]
        if (name === 'cubelab-active-tab') {
          const callback = args[args.length - 1] as LockGrantedCallback
          return Promise.resolve(callback({ name, mode: 'exclusive' } as Lock))
        }
        // Preserve both native overloads, including request(name, callback).
        return Reflect.apply(request, locks, args)
      },
      query(...args: unknown[]) {
        return Reflect.apply(locks.query.bind(locks), locks, args)
      },
    } as unknown as LockManager
    Object.defineProperty(navigator, 'locks', { configurable: true, value: fake })
  })
}
