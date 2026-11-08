import type { BrowserContext } from '@playwright/test'

/**
 * Simulate clients predating the single-tab gate, solely for protocol tests.
 * Production has no bypass. Keep the real replacement/Drive locks intact.
 */
export async function simulateLegacyConcurrentTabs(context: BrowserContext) {
  await context.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks)
    navigator.locks.request = ((...args: unknown[]) => {
      const name = args[0]
      if (name === 'cubelab-active-tab') {
        const callback = args[args.length - 1] as LockGrantedCallback
        return Promise.resolve(callback({ name, mode: 'exclusive' } as Lock))
      }
      // Preserve both native overloads, including request(name, callback).
      return Reflect.apply(request, navigator.locks, args)
    }) as typeof navigator.locks.request
  })
}
