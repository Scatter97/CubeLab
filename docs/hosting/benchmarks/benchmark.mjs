#!/usr/bin/env node
/**
 * CubeLab production bandwidth benchmark.
 *
 * Runs Chromium against the production `dist/` output using isolated persistent
 * profiles. Network byte counts come from the benchmark server's JSONL log
 * (actual encoded response bodies plus reconstructed response headers).
 * Playwright/CDP supplies cache/service-worker classification, page-observed
 * requests and browser-reported PerformanceResourceTiming sizes.
 *
 * Prerequisites:
 *   npm run build
 *   node docs/hosting/benchmarks/serve-production.mjs --port 4180 --log /tmp/cubelab-server.jsonl
 *   npx playwright install chromium
 *
 * Example:
 *   node docs/hosting/benchmarks/benchmark.mjs \
 *     --base-url http://127.0.0.1:4180 \
 *     --server-log /tmp/cubelab-server.jsonl \
 *     --out /tmp/cubelab-bandwidth
 *
 * The script never writes to application source and never uses a real user
 * profile. All histories are deterministic synthetic fixtures.
 */
import { chromium, devices } from 'playwright'
import { createSessionsFixture, fixtureStats, ONBOARDING_COMPLETED } from './fixtures.mjs'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const DIST_ROOT = join(REPO_ROOT, 'dist')
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1:4180',
    serverLog: null,
    out: join('/tmp/opencode', `cubelab-bandwidth-${TIMESTAMP}`),
    profileRoot: null,
    scenarios: null,
    label: 'br',
    headed: false,
    longSessionMinutes: 0,
    keepProfiles: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`)
      return argv[index]
    }
    if (arg === '--base-url') args.baseUrl = next().replace(/\/$/, '')
    else if (arg === '--server-log') args.serverLog = resolve(next())
    else if (arg === '--out') args.out = resolve(next())
    else if (arg === '--profile-root') args.profileRoot = resolve(next())
    else if (arg === '--scenarios') args.scenarios = next().split(',').map((item) => item.trim()).filter(Boolean)
    else if (arg === '--label') args.label = next()
    else if (arg === '--headed') args.headed = true
    else if (arg === '--long-session-minutes') args.longSessionMinutes = Number(next())
    else if (arg === '--keep-profiles') args.keepProfiles = true
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(import.meta.filename, 'utf8').split('*/')[0])
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  args.profileRoot ??= join(args.out, 'profiles')
  if (!existsSync(DIST_ROOT)) throw new Error('dist/ is missing; run npm run build first')
  if (args.serverLog && !existsSync(args.serverLog)) {
    throw new Error(`Server log does not exist: ${args.serverLog}`)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
mkdirSync(args.out, { recursive: true })
mkdirSync(args.profileRoot, { recursive: true })

const scenarioFilter = args.scenarios ? new Set(args.scenarios) : null
const shouldRun = (id) => !scenarioFilter || scenarioFilter.has(id)

function walkFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

const distFiles = new Map()
for (const file of walkFiles(DIST_ROOT)) {
  const path = `/${relative(DIST_ROOT, file).split(sep).join('/')}`
  distFiles.set(path, { size: statSync(file).size, extension: file.slice(file.lastIndexOf('.')) })
}

const browserReport = {
  node: process.version,
  playwright: JSON.parse(readFileSync(join(REPO_ROOT, 'node_modules/playwright/package.json'), 'utf8')).version,
  packageVersion: JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version,
  build: {
    distIndexMtime: statSync(join(DIST_ROOT, 'index.html')).mtime.toISOString(),
    distBytes: [...distFiles.values()].reduce((sum, file) => sum + file.size, 0),
    distFiles: distFiles.size,
    entry: readFileSync(join(DIST_ROOT, 'index.html'), 'utf8').match(/src="([^"]+)"/)?.[1] ?? null,
  },
  serverEncodingLabel: args.label,
  baseUrl: args.baseUrl,
  userAgent: null,
  chromiumVersion: null,
  startedAt: new Date().toISOString(),
}

function categoryFor(path) {
  if (path === '/' || path.endsWith('.html')) return 'document'
  if (path === '/sw.js' || path === '/registerSW.js' || /\/workbox-[^/]+\.js$/.test(path)) return 'serviceWorker'
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'javascript'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.svg')) return 'svg'
  if (/\.(png|jpe?g|webp|avif|ico)$/i.test(path)) return 'image'
  if (/\.(woff2?|ttf|otf)$/i.test(path)) return 'font'
  if (path.endsWith('.webmanifest') || path.endsWith('.json')) return 'manifestJson'
  if (path.endsWith('.wasm')) return 'wasm'
  return 'other'
}

function urlPath(url) {
  try {
    const parsed = new URL(url)
    return decodeURIComponent(parsed.pathname)
  } catch {
    return url
  }
}

function decodedSizeFor(path) {
  if (path === '/') return distFiles.get('/index.html')?.size ?? 0
  return distFiles.get(path)?.size ?? 0
}

class Collector {
  constructor(context, page) {
    this.context = context
    this.page = page
    this.cdp = null
    this.requests = new Map()
    this.ready = this.#attach()
  }

  async #attach() {
    this.cdp = await this.context.newCDPSession(this.page)
    this.cdp.on('Network.requestWillBeSent', (event) => {
      const existing = this.requests.get(event.requestId)
      if (existing && event.redirectResponse) {
        existing.redirects.push({
          url: event.redirectResponse.url,
          status: event.redirectResponse.status,
        })
      }
      const previous = existing ?? { redirects: [] }
      this.requests.set(event.requestId, {
        ...previous,
        requestId: event.requestId,
        url: event.request.url,
        method: event.request.method,
        resourceType: event.type,
        initiator: event.initiator,
        wallTimeMs: Math.round(event.wallTime * 1000),
        requestHeaders: event.request.headers,
        response: null,
        finished: null,
        failed: null,
        servedFromCache: Boolean(previous.servedFromCache),
      })
    })
    this.cdp.on('Network.responseReceived', (event) => {
      const entry = this.requests.get(event.requestId)
      if (!entry) return
      entry.response = {
        status: event.response.status,
        statusText: event.response.statusText,
        mimeType: event.response.mimeType,
        headers: event.response.headers,
        encodedDataLength: event.response.encodedDataLength,
        fromDiskCache: Boolean(event.response.fromDiskCache),
        fromServiceWorker: Boolean(event.response.fromServiceWorker),
        fromPrefetchCache: Boolean(event.response.fromPrefetchCache),
        protocol: event.response.protocol,
        securityState: event.response.securityState,
      }
    })
    this.cdp.on('Network.requestServedFromCache', (event) => {
      const entry = this.requests.get(event.requestId)
      if (entry) entry.servedFromCache = true
    })
    this.cdp.on('Network.loadingFinished', (event) => {
      const entry = this.requests.get(event.requestId)
      if (!entry) return
      entry.finished = {
        encodedDataLength: event.encodedDataLength,
        timestamp: event.timestamp,
      }
    })
    this.cdp.on('Network.loadingFailed', (event) => {
      const entry = this.requests.get(event.requestId)
      if (!entry) return
      entry.failed = {
        errorText: event.errorText,
        canceled: Boolean(event.canceled),
        blockedReason: event.blockedReason ?? null,
      }
    })
    await this.cdp.send('Network.enable')
  }

  reset() {
    this.requests.clear()
  }

  snapshot() {
    const requests = []
    for (const entry of this.requests.values()) {
      if (!entry.url.startsWith('http')) continue
      const path = urlPath(entry.url)
      const host = (() => {
        try { return new URL(entry.url).host } catch { return '' }
      })()
      const transferBytes = entry.finished?.encodedDataLength ?? 0
      const response = entry.response
      const cacheHit = Boolean(
        response?.fromDiskCache ||
        response?.fromServiceWorker ||
        response?.fromPrefetchCache ||
        entry.servedFromCache,
      )
      requests.push({
        url: entry.url,
        path,
        host,
        external: host !== new URL(args.baseUrl).host,
        method: entry.method,
        resourceType: entry.resourceType,
        status: response?.status ?? null,
        mimeType: response?.mimeType ?? '',
        protocol: response?.protocol ?? '',
        fromDiskCache: Boolean(response?.fromDiskCache),
        fromServiceWorker: Boolean(response?.fromServiceWorker),
        fromPrefetchCache: Boolean(response?.fromPrefetchCache),
        servedFromCache: entry.servedFromCache,
        cacheHit,
        encodedDataLength: response?.encodedDataLength ?? 0,
        transferBytes,
        contentLength: Number(response?.headers?.['content-length'] ?? 0) || 0,
        contentEncoding: response?.headers?.['content-encoding'] ?? '',
        cacheControl: response?.headers?.['cache-control'] ?? '',
        decodedFileBytes: decodedSizeFor(path),
        failed: entry.failed?.errorText ?? null,
        canceled: Boolean(entry.failed?.canceled),
        redirects: entry.redirects,
        initiatorType: entry.initiator?.type ?? '',
        initiatorUrl: entry.initiator?.url ?? entry.initiator?.stack?.callFrames?.[0]?.url ?? '',
      })
    }
    const unique = new Map()
    for (const request of requests) {
      if (!unique.has(request.path)) unique.set(request.path, request)
    }
    const repeated = {}
    for (const request of requests) {
      repeated[request.path] = (repeated[request.path] ?? 0) + 1
    }
    return {
      requestCount: requests.length,
      uniqueResourceCount: unique.size,
      uniqueDecodedBytes: [...unique.values()].reduce((sum, request) => sum + request.decodedFileBytes, 0),
      transferBytes: requests.reduce((sum, request) => sum + request.transferBytes, 0),
      cacheHits: requests.filter((request) => request.cacheHit).length,
      serviceWorkerHits: requests.filter((request) => request.fromServiceWorker).length,
      diskCacheHits: requests.filter((request) => request.fromDiskCache).length,
      networkResponses: requests.filter((request) => !request.cacheHit && request.status !== null).length,
      failedRequests: requests.filter((request) => request.failed && !request.canceled).length,
      externalRequests: requests.filter((request) => request.external).length,
      externalHosts: [...new Set(requests.filter((request) => request.external).map((request) => request.host))],
      repeatedPaths: Object.entries(repeated).filter(([, count]) => count > 1).map(([path, count]) => ({ path, count })),
      byCategory: summarizeByCategory(requests, (request) => request.transferBytes),
      requests,
    }
  }
}

async function attachCollector(context, page) {
  const collector = new Collector(context, page)
  await collector.ready
  return collector
}

function summarizeByCategory(records, bytesFor) {
  const category = {}
  for (const record of records) {
    const key = categoryFor(record.path)
    const bucket = category[key] ?? { requests: 0, bytes: 0, decodedBytes: 0, unique: new Set() }
    bucket.requests += 1
    bucket.bytes += bytesFor(record)
    if (!bucket.unique.has(record.path)) {
      bucket.unique.add(record.path)
      bucket.decodedBytes += record.originalBytes ?? record.decodedFileBytes ?? 0
    }
    category[key] = bucket
  }
  const result = {}
  for (const [key, value] of Object.entries(category)) {
    result[key] = {
      requests: value.requests,
      uniqueResources: value.unique.size,
      transferBytes: value.bytes,
      decodedBytes: value.decodedBytes,
    }
  }
  return result
}

function readServerLog() {
  if (!args.serverLog || !existsSync(args.serverLog)) return []
  const text = readFileSync(args.serverLog, 'utf8')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
}

function serverSlice(startedAt, endedAt) {
  const records = readServerLog().filter(
    (record) => record.timestamp >= startedAt - 25 && record.timestamp <= endedAt + 25,
  )
  const unique = new Map()
  for (const record of records) {
    if (!unique.has(record.path)) unique.set(record.path, record)
  }
  const repeats = {}
  for (const record of records) repeats[record.path] = (repeats[record.path] ?? 0) + 1
  const byCategory = {}
  for (const record of records) {
    const key = categoryFor(record.path)
    const bucket = byCategory[key] ?? { requests: 0, bodyBytes: 0, headerBytes: 0, totalBytes: 0, unique: new Set(), decodedBytes: 0 }
    bucket.requests += 1
    bucket.bodyBytes += record.bodyBytes
    bucket.headerBytes += record.headerBytes
    bucket.totalBytes += record.bodyBytes + record.headerBytes
    if (!bucket.unique.has(record.path)) {
      bucket.unique.add(record.path)
      bucket.decodedBytes += record.originalBytes
    }
    byCategory[key] = bucket
  }
  for (const bucket of Object.values(byCategory)) bucket.uniqueResources = bucket.unique.size
  const byEncoding = {}
  for (const record of records) {
    const key = record.encoding ?? 'identity'
    const bucket = byEncoding[key] ?? { requests: 0, bodyBytes: 0 }
    bucket.requests += 1
    bucket.bodyBytes += record.bodyBytes
    byEncoding[key] = bucket
  }
  const top = [...records]
    .sort((a, b) => (b.bodyBytes + b.headerBytes) - (a.bodyBytes + a.headerBytes))
    .slice(0, 25)
    .map((record) => ({
      path: record.path,
      status: record.status,
      encoding: record.encoding,
      bodyBytes: record.bodyBytes,
      headerBytes: record.headerBytes,
      totalBytes: record.bodyBytes + record.headerBytes,
      originalBytes: record.originalBytes,
    }))
  return {
    requestCount: records.length,
    status200: records.filter((record) => record.status === 200).length,
    status304: records.filter((record) => record.status === 304).length,
    statusOther: records.filter((record) => record.status !== 200 && record.status !== 304).length,
    bodyBytes: records.reduce((sum, record) => sum + record.bodyBytes, 0),
    headerBytes: records.reduce((sum, record) => sum + record.headerBytes, 0),
    totalBytes: records.reduce((sum, record) => sum + record.bodyBytes + record.headerBytes, 0),
    uniqueResourceCount: unique.size,
    uniqueUncompressedBytes: [...unique.values()].reduce((sum, record) => sum + record.originalBytes, 0),
    sumUncompressedBytesAllResponses: records.reduce((sum, record) => sum + record.originalBytes, 0),
    byEncoding,
    byCategory,
    repeatedPaths: Object.entries(repeats)
      .filter(([, count]) => count > 1)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count),
    top,
    paths: [...new Set(records.map((record) => record.path))],
    records,
  }
}

async function capturePerformance(page) {
  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      deliveryType: entry.deliveryType ?? '',
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      duration: entry.duration,
      startTime: entry.startTime,
    }))
    return {
      navigation: nav ? {
        responseEnd: nav.responseEnd,
        domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
        loadEventEnd: nav.loadEventEnd,
        duration: nav.duration,
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
        decodedBodySize: nav.decodedBodySize,
      } : null,
      resources,
    }
  })
  return {
    summary: {
      resourceCount: data.resources.length,
      transferSize: data.resources.reduce((sum, entry) => sum + entry.transferSize, 0),
      encodedBodySize: data.resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      decodedBodySize: data.resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      serviceWorkerDelivery: data.resources.filter((entry) => /service.?worker/i.test(entry.deliveryType)).length,
      cacheDelivery: data.resources.filter((entry) => /cache/i.test(entry.deliveryType)).length,
      deliveryTypes: data.resources.reduce((accumulator, entry) => {
        const key = entry.deliveryType || 'unknown'
        accumulator[key] = (accumulator[key] ?? 0) + 1
        return accumulator
      }, {}),
    },
    navigation: data.navigation,
    resources: data.resources,
  }
}

async function captureServiceWorkerState(page) {
  try {
    return await page.evaluate(async () => {
      const result = {
        controller: null,
        registrations: 0,
        registrationScopes: [],
        caches: {},
        cacheEntryCount: 0,
      }
      if ('serviceWorker' in navigator) {
        result.controller = navigator.serviceWorker.controller?.scriptURL ?? null
        const registrations = await navigator.serviceWorker.getRegistrations()
        result.registrations = registrations.length
        result.registrationScopes = registrations.map((registration) => registration.scope)
      }
      if ('caches' in window) {
        const names = await caches.keys()
        for (const name of names) {
          const cache = await caches.open(name)
          const keys = await cache.keys()
          result.caches[name] = keys.length
          result.cacheEntryCount += keys.length
        }
      }
      return result
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function clearPerformance(page) {
  try {
    await page.evaluate(() => performance.clearResourceTimings())
  } catch {
    // Ignore: a page can disappear between actions.
  }
}

async function waitForAppReady(page, timeout = 90_000) {
  await page.waitForFunction(
    () => {
      const scramble = document.querySelector('.scramble-text')
      return Boolean(scramble && scramble.textContent?.trim())
    },
    null,
    { timeout },
  )
  await page.locator('[data-testid="timer-surface"]').waitFor({ state: 'visible', timeout })
}

async function waitForServiceWorker(page, timeout = 15_000) {
  try {
    return await page.evaluate(async (timeoutMs) => {
      if (!('serviceWorker' in navigator)) return { status: 'unsupported' }
      const timeout = new Promise((resolve) => {
        setTimeout(() => resolve({ status: 'timeout' }), timeoutMs)
      })
      return Promise.race([
        navigator.serviceWorker.ready.then((registration) => ({
          status: 'ready',
          scope: registration.scope,
          active: Boolean(registration.active),
        })),
        timeout,
      ])
    }, timeout)
  } catch {
    return { status: 'error' }
  }
}

async function settle(page, extraMs = 900) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(extraMs)
}

async function dismissOnboardingIfVisible(page) {
  const skip = page.getByTestId('onboarding-skip')
  try {
    await skip.waitFor({ state: 'visible', timeout: 8_000 })
    await skip.click()
    return true
  } catch {
    return false
  }
}

async function prepareProfile(name, {
  fixture = null,
  mobile = false,
  serviceWorkers = 'allow',
} = {}) {
  const profileDir = join(args.profileRoot, name)
  rmSync(profileDir, { recursive: true, force: true })
  const context = await launchPersistent(profileDir, { mobile, serviceWorkers })
  if (fixture) {
    await context.addInitScript(({ payload, onboarding }) => {
      // Run once per tab. A reload inside this preparation tab must not
      // overwrite changes made by the application.
      if (sessionStorage.getItem('cubelab-bench-seeded')) return
      sessionStorage.setItem('cubelab-bench-seeded', '1')
      localStorage.setItem('cubelab:sessions:v1', payload)
      localStorage.setItem('cubelab:onboarding:v1', onboarding)
      localStorage.removeItem('cubelab:settings:v1')
      localStorage.removeItem('cubelab:sync:v1')
    }, { payload: JSON.stringify(fixture), onboarding: ONBOARDING_COMPLETED })
  }
  const page = context.pages()[0] ?? await context.newPage()
  const collector = await attachCollector(context, page)
  collector.reset()
  await page.goto(args.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  if (!fixture) await dismissOnboardingIfVisible(page)
  await waitForAppReady(page)
  await waitForServiceWorker(page, serviceWorkers === 'allow' ? 20_000 : 2_500)
  await settle(page, 1_000)
  const state = await captureServiceWorkerState(page)
  const localStorage = await page.evaluate(() => {
    const sessions = localStorage.getItem('cubelab:sessions:v1')
    return {
      sessionsBytes: sessions ? new Blob([sessions]).size : 0,
      onboarding: localStorage.getItem('cubelab:onboarding:v1'),
    }
  })
  await page.close()
  await context.close()
  await new Promise((resolve) => setTimeout(resolve, 500))
  return { profileDir, preparation: { serviceWorker: state, localStorage } }
}

async function launchPersistent(profileDir, { mobile = false, serviceWorkers = 'allow' } = {}) {
  const descriptor = mobile
    ? devices['Pixel 7']
    : {
        viewport: { width: 1360, height: 900 },
        deviceScaleFactor: 1,
      }
  const context = await chromium.launchPersistentContext(profileDir, {
    ...descriptor,
    headless: !args.headed,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    serviceWorkers,
    args: ['--no-first-run', '--no-default-browser-check'],
  })
  if (!browserReport.chromiumVersion) {
    browserReport.chromiumVersion = context.browser()?.version() ?? null
    browserReport.userAgent = await (await context.newPage()).evaluate(() => navigator.userAgent).catch(() => null)
    await context.pages().at(-1)?.close()
  }
  return context
}

const measurements = []

async function measure({
  id,
  title,
  page,
  collector,
  action,
  extraSettleMs = 900,
  notes = '',
  after = null,
}) {
  await clearPerformance(page)
  collector.reset()
  const startedAt = Date.now()
  await action()
  await settle(page, extraSettleMs)
  const endedAt = Date.now()
  const server = serverSlice(startedAt, endedAt)
  const pageSnapshot = collector.snapshot()
  const performance = await capturePerformance(page)
  const serviceWorker = await captureServiceWorkerState(page)
  const record = {
    id,
    title,
    notes,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: endedAt - startedAt,
    server,
    page: pageSnapshot,
    performance: performance.summary,
    serviceWorker,
  }
  if (after) Object.assign(record, await after())
  measurements.push(record)
  const performanceFile = join(args.out, `performance-${id.replace(/[^a-z0-9_-]/gi, '_')}.json`)
  writeFileSync(performanceFile, JSON.stringify({
    id,
    navigation: performance.navigation,
    resources: performance.resources,
  }, null, 2))
  writeFileSync(join(args.out, 'results.partial.json'), JSON.stringify({
    meta: browserReport,
    measurements,
  }, null, 2))
  console.log(
    `${id.padEnd(24)} req=${String(server.requestCount).padStart(3)} ` +
    `net=${(server.totalBytes / 1e6).toFixed(4)}MB ` +
    `body=${(server.bodyBytes / 1e6).toFixed(4)}MB ` +
    `cache=${pageSnapshot.cacheHits} sw=${pageSnapshot.serviceWorkerHits} ` +
    `duration=${(endedAt - startedAt)}ms`,
  )
  return record
}

async function openAppPage(context, { mobile = false } = {}) {
  await new Promise((resolve) => setTimeout(resolve, 250))
  const page = context.pages().find((candidate) => !candidate.isClosed()) ?? await context.newPage()
  if (mobile) await page.setViewportSize(devices['Pixel 7'].viewport)
  const collector = await attachCollector(context, page)
  return { page, collector }
}

async function measureColdVisit({
  id,
  context,
  mobile = false,
  serviceWorkersBlocked = false,
}) {
  const { page, collector } = await openAppPage(context, { mobile })
  return measure({
    id,
    title: serviceWorkersBlocked
      ? 'Cold first visit with service workers blocked'
      : 'Cold first visit (empty cache, service worker installs)',
    page,
    collector,
    extraSettleMs: serviceWorkersBlocked ? 1_000 : 2_000,
    action: async () => {
      await page.goto(args.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      const skipped = await dismissOnboardingIfVisible(page)
      await waitForAppReady(page)
      await waitForServiceWorker(page, serviceWorkersBlocked ? 2_500 : 25_000)
      if (!skipped) {
        // If onboarding did not appear (already completed), leave it.
      }
    },
  })
}

async function measureWarmVisit(context, id, title, mobile = false) {
  const { page, collector } = await openAppPage(context, { mobile })
  return measure({
    id,
    title,
    page,
    collector,
    extraSettleMs: 1_200,
    action: async () => {
      await page.goto(args.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await waitForAppReady(page)
      await waitForServiceWorker(page, 8_000)
    },
  })
}

async function measureHardReload(context, id, title, { disabled = true } = {}) {
  const page = context.pages().find((candidate) => !candidate.isClosed())
  if (!page) throw new Error('No open page for hard reload')
  const collector = await attachCollector(context, page)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: disabled })
  const record = await measure({
    id,
    title,
    page,
    collector,
    extraSettleMs: 1_500,
    action: async () => {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 })
      await waitForAppReady(page)
      await waitForServiceWorker(page, 5_000)
    },
  })
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  return record
}

async function recordSolves(page, count, { durationMs = 100 } = {}) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  const timer = page.locator('[data-testid="timer-surface"]')
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.down('Space')
    await page.waitForTimeout(360)
    await page.keyboard.up('Space')
    await timer.waitFor({ state: 'visible' })
    await page.waitForTimeout(durationMs)
    await page.keyboard.press('Space')
    await page.waitForFunction(
      () => document.querySelector('[data-testid="timer-surface"]')?.getAttribute('data-phase') === 'idle',
      null,
      { timeout: 5_000 },
    )
    await page.waitForTimeout(20)
  }
}

async function readStoredHistory(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    if (!raw) return { rawBytes: 0, sessions: 0, solves: 0 }
    const parsed = JSON.parse(raw)
    return {
      rawBytes: new Blob([raw]).size,
      sessions: parsed.sessions?.length ?? 0,
      solves: (parsed.sessions ?? []).reduce((sum, session) => sum + (session.solves?.length ?? 0), 0),
      activeSessionId: parsed.activeSessionId ?? null,
    }
  })
}

async function scenarioColdWarm() {
  if (!shouldRun('cold') && !shouldRun('warm') && !shouldRun('reopen') && !shouldRun('hard')) return
  console.log('\n=== Scenarios A-D: cold, warm, reopen, hard reload ===')
  const profileName = 'cold-warm'
  const profileDir = join(args.profileRoot, profileName)
  rmSync(profileDir, { recursive: true, force: true })
  let context = await launchPersistent(profileDir, { serviceWorkers: 'allow' })

  const cold = shouldRun('cold')
    ? await measureColdVisit({ id: 'A-cold-first-visit', context })
    : null

  // Close the first tab so the single-tab Web Lock is released before the
  // second visit. The persistent profile keeps HTTP cache, SW and Cache Storage.
  await context.pages()[0]?.close()
  await new Promise((resolve) => setTimeout(resolve, 400))

  let warm = null
  let reopen = null
  if (shouldRun('warm')) {
    warm = await measureWarmVisit(context, 'B-warm-second-visit', 'Second visit with existing browser cache and service worker')
  }
  await context.pages()[0]?.close()
  await new Promise((resolve) => setTimeout(resolve, 400))

  if (shouldRun('reopen')) {
    await context.close()
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    context = await launchPersistent(profileDir, { serviceWorkers: 'allow' })
    reopen = await measureWarmVisit(context, 'C-warm-reopen', 'Third visit after closing and reopening the browser')
  }

  let hard = null
  if (shouldRun('hard')) {
    hard = await measureHardReload(context, 'D-hard-reload-cache-disabled', 'Hard reload with browser cache disabled (service worker still registered)')
  }

  await context.close()
  return { cold, warm, reopen, hard, profileDir }
}

async function scenarioColdNoSw() {
  if (!shouldRun('cold-nosw')) return
  console.log('\n=== Cold visit with service workers blocked (foreground-only baseline) ===')
  const profileName = 'cold-no-sw'
  const profileDir = join(args.profileRoot, profileName)
  rmSync(profileDir, { recursive: true, force: true })
  const context = await launchPersistent(profileDir, { serviceWorkers: 'block' })
  const cold = await measureColdVisit({
    id: 'A2-cold-first-visit-no-sw',
    context,
    serviceWorkersBlocked: true,
  })
  await context.pages()[0]?.close()
  await new Promise((resolve) => setTimeout(resolve, 400))
  let warm = null
  if (shouldRun('warm-nosw') || shouldRun('hard-nosw')) {
    warm = await measureWarmVisit(context, 'B2-warm-http-cache-no-sw', 'Second visit using the HTTP cache only (service workers blocked)')
  }
  let hard = null
  if (shouldRun('hard-nosw')) {
    hard = await measureHardReload(context, 'D3-hard-reload-no-sw', 'Hard reload with cache disabled and no service worker', { disabled: true })
  }
  await context.close()
  return { cold, warm, hard, profileDir }
}

async function scenarioNavigation() {
  if (!shouldRun('navigation')) return
  console.log('\n=== Scenario E: navigation across every view ===')
  const fixture = createSessionsFixture({ solveCount: 100, sessionCount: 2 })
  const prepared = await prepareProfile('navigation', { fixture })
  const context = await launchPersistent(prepared.profileDir)
  const { page, collector } = await openAppPage(context)
  const load = await measure({
    id: 'E-load',
    title: 'Warm returning load before navigation',
    page,
    collector,
    extraSettleMs: 1_000,
    action: async () => {
      await page.goto(args.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await waitForAppReady(page)
      await waitForServiceWorker(page, 8_000)
    },
  })

  const timerSurface = page.locator('[data-testid="timer-surface"]')
  const settingsButton = page.getByTestId('settings-button')

  // Give the browser a separate window for any delayed service-worker update
  // check or background request, so page-navigation steps are not miscredited.
  const backgroundIdle = await measure({
    id: 'E-background-idle',
    title: 'Five-second idle observation after the warm load',
    page,
    collector,
    extraSettleMs: 0,
    action: async () => {
      await page.waitForTimeout(5_000)
    },
  })

  const steps = []
  if (shouldRun('navigation')) {
    steps.push(await measure({
      id: 'E-timer-sessions',
      title: 'Timer and Sessions panel (session picker + session settings)',
      page,
      collector,
      extraSettleMs: 400,
      action: async () => {
        await page.getByTestId('session-select').click()
        await page.locator('[data-testid^="session-option-"]').first().waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')
        await page.getByTestId('session-settings').click()
        await page.getByRole('dialog', { name: 'Session settings' }).waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')
        await page.getByRole('dialog', { name: 'Session settings' }).waitFor({ state: 'hidden' })
      },
    }))
    steps.push(await measure({
      id: 'E-settings',
      title: 'Settings dialog',
      page,
      collector,
      extraSettleMs: 300,
      action: async () => {
        await settingsButton.click()
        await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'visible' })
        await page.getByTestId('settings-done').click()
        await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'hidden' })
      },
    }))
    steps.push(await measure({
      id: 'E-data-dialog',
      title: 'Local data / backup dialog (lazy DataDialog chunk)',
      page,
      collector,
      extraSettleMs: 400,
      action: async () => {
        await settingsButton.click()
        const settings = page.getByRole('dialog', { name: 'Settings' })
        await settings.waitFor({ state: 'visible' })
        await settings.getByTestId('settings-backup-button').click()
        const dataDialog = page.getByRole('dialog', { name: 'Your local data' })
        await dataDialog.waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')
        await dataDialog.waitFor({ state: 'hidden' })
      },
    }))
    steps.push(await measure({
      id: 'E-analytics',
      title: 'Analytics — Solves view (lazy AnalyticsPage + charts)',
      page,
      collector,
      extraSettleMs: 1_000,
      action: async () => {
        await page.getByTestId('analytics-nav').click()
        await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor({ state: 'visible', timeout: 60_000 })
        await page.getByTestId('analytics-overview').waitFor({ state: 'visible', timeout: 60_000 })
      },
    }))
    steps.push(await measure({
      id: 'E-analytics-algorithms',
      title: 'Analytics — Algorithms view (lazy AlgorithmsAnalytics chunk)',
      page,
      collector,
      extraSettleMs: 500,
      action: async () => {
        await page.getByRole('button', { name: 'Algorithms', exact: true }).click()
        await page.waitForTimeout(500)
      },
    }))
    steps.push(await measure({
      id: 'E-training',
      title: 'Training Hub (lazy TrainingHub chunk)',
      page,
      collector,
      extraSettleMs: 700,
      action: async () => {
        await page.getByTestId('training-nav').click()
        await page.getByRole('heading', { name: 'Training Hub', exact: true }).waitFor({ state: 'visible', timeout: 60_000 })
      },
    }))
    steps.push(await measure({
      id: 'E-back-timer',
      title: 'Return to Timer',
      page,
      collector,
      extraSettleMs: 500,
      action: async () => {
        await page.getByRole('button', { name: 'Timer', exact: true }).click()
        await timerSurface.waitFor({ state: 'visible' })
        await waitForAppReady(page)
      },
    }))
  }

  await page.close()
  await context.close()
  return { load, backgroundIdle, steps }
}

async function scenarioSolveCounts() {
  if (!shouldRun('solves-100') && !shouldRun('solves-1000') && !shouldRun('solves-10000')) return
  console.log('\n=== Scenarios F-H: 100 real solves, 1,000 and 10,000 synthetic solves ===')
  const results = {}

  if (shouldRun('solves-100')) {
    const prepared = await prepareProfile('solves-100', {
      fixture: createSessionsFixture({ solveCount: 0, sessionCount: 1 }),
    })
    const context = await launchPersistent(prepared.profileDir)
    const { page, collector } = await openAppPage(context)
    const load = await measure({
      id: 'F-load',
      title: 'Returning load before recording 100 solves',
      page,
      collector,
      extraSettleMs: 800,
      action: async () => {
        await page.goto(args.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
        await waitForAppReady(page)
        await waitForServiceWorker(page, 8_000)
      },
    })
    const solves = await measure({
      id: 'F-100-solves',
      title: 'Recording 100 real solves through the timer input path',
      page,
      collector,
      extraSettleMs: 700,
      action: async () => {
        await recordSolves(page, 100, { durationMs: 100 })
      },
      after: async () => ({ stored: await readStoredHistory(page) }),
    })
    const navigation = await measure({
      id: 'F-analytics',
      title: 'Open Analytics after the 100-solve session',
      page,
      collector,
      extraSettleMs: 800,
      action: async () => {
        await page.getByTestId('analytics-nav').click()
        await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor({ state: 'visible', timeout: 60_000 })
        await page.getByTestId('analytics-overview').waitFor({ state: 'visible', timeout: 60_000 })
      },
    })
    const after = await readStoredHistory(page)
    await page.close()
    await context.close()
    results.solves100 = { load, solves, navigation, after }
  }

  for (const [key, count, sessionCount] of [
    ['solves1000', 1_000, 10],
    ['solves10000', 10_000, 20],
  ]) {
    if (!shouldRun(count === 1_000 ? 'solves-1000' : 'solves-10000')) continue
    const fixture = createSessionsFixture({ solveCount: count, sessionCount })
    const stats = fixtureStats(fixture)
    console.log(`Preparing ${count} synthetic solves (${stats.jsonMiB.toFixed(2)} MiB localStorage payload)`)
    const prepared = await prepareProfile(`history-${count}`, { fixture })
    const context = await launchPersistent(prepared.profileDir)
    const { page, collector } = await openAppPage(context)
    const load = await measure({
      id: `${count === 1_000 ? 'G' : 'H'}-load-${count}`,
      title: `Returning load with ${count.toLocaleString('en-US')} existing solves`,
      page,
      collector,
      extraSettleMs: 1_000,
      action: async () => {
        await page.goto(args.baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await waitForAppReady(page, 120_000)
        await waitForServiceWorker(page, 8_000)
      },
      after: async () => ({ stored: await readStoredHistory(page), fixture: stats }),
    })
    const analytics = await measure({
      id: `${count === 1_000 ? 'G' : 'H'}-analytics-${count}`,
      title: `Analytics with ${count.toLocaleString('en-US')} solves`,
      page,
      collector,
      extraSettleMs: 1_200,
      action: async () => {
        await page.getByTestId('analytics-nav').click()
        await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor({ state: 'visible', timeout: 120_000 })
        await page.getByTestId('analytics-overview').waitFor({ state: 'visible', timeout: 120_000 })
      },
    })
    const training = await measure({
      id: `${count === 1_000 ? 'G' : 'H'}-training-${count}`,
      title: `Training Hub with ${count.toLocaleString('en-US')} solve history present`,
      page,
      collector,
      extraSettleMs: 600,
      action: async () => {
        await page.getByTestId('training-nav').click()
        await page.getByRole('heading', { name: 'Training Hub', exact: true }).waitFor({ state: 'visible', timeout: 60_000 })
      },
    })
    const after = await readStoredHistory(page)
    await page.close()
    await context.close()
    results[key] = { load, analytics, training, after, fixture: stats }
  }
  return results
}

async function scenarioLongSession() {
  if (!shouldRun('long-session')) return
  console.log(`\n=== Scenario I: ${args.longSessionMinutes > 0 ? `${args.longSessionMinutes}-minute real` : 'accelerated 30-minute-equivalent'} timer session ===`)
  const prepared = await prepareProfile('long-session', {
    fixture: createSessionsFixture({ solveCount: 0, sessionCount: 1 }),
  })
  const context = await launchPersistent(prepared.profileDir)
  const { page, collector } = await openAppPage(context)
  const load = await measure({
    id: 'I-load',
    title: 'Warm load before long-session simulation',
    page,
    collector,
    extraSettleMs: 700,
    action: async () => {
      await page.goto(args.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await waitForAppReady(page)
      await waitForServiceWorker(page, 8_000)
    },
  })
  let idle = null
  let session = null
  if (args.longSessionMinutes > 0) {
    // Real wall-clock session: one solve per minute, with the remaining time
    // spent idle. This is slow but exercises any periodic background request.
    session = await measure({
      id: `I-${args.longSessionMinutes}-minute-session`,
      title: `Real ${args.longSessionMinutes}-minute timer session (one solve per minute)`,
      page,
      collector,
      extraSettleMs: 500,
      action: async () => {
        for (let minute = 0; minute < args.longSessionMinutes; minute += 1) {
          const cycleStart = Date.now()
          await recordSolves(page, 1, { durationMs: 1_000 })
          const remaining = 60_000 - (Date.now() - cycleStart)
          if (remaining > 0) await page.waitForTimeout(remaining)
        }
      },
      after: async () => ({ stored: await readStoredHistory(page) }),
    })
  } else {
    idle = await measure({
      id: 'I-idle-65s',
      title: '65-second idle observation for periodic background traffic',
      page,
      collector,
      extraSettleMs: 0,
      action: async () => {
        await page.waitForTimeout(65_000)
      },
    })
    session = await measure({
      id: 'I-30-solves',
      title: '30 timer solves (accelerated stand-in for a 30-minute session)',
      page,
      collector,
      extraSettleMs: 500,
      action: async () => {
        await recordSolves(page, 30, { durationMs: 1_000 })
      },
      after: async () => ({ stored: await readStoredHistory(page) }),
    })
  }
  await page.close()
  await context.close()
  return { load, idle, session }
}

async function scenarioMobile() {
  if (!shouldRun('mobile')) return
  console.log('\n=== Scenario J: mobile viewport ===')
  const profileName = 'mobile-cold'
  const profileDir = join(args.profileRoot, profileName)
  rmSync(profileDir, { recursive: true, force: true })
  const context = await launchPersistent(profileDir, { mobile: true, serviceWorkers: 'allow' })
  const cold = await measureColdVisit({
    id: 'J-mobile-cold',
    context,
    mobile: true,
  })
  await context.pages()[0]?.close()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const warm = await measureWarmVisit(context, 'J-mobile-warm', 'Mobile second visit with existing cache', true)
  await context.close()
  return { cold, warm, profileDir }
}

async function waitForServer() {
  const deadline = Date.now() + 15_000
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(args.baseUrl, { redirect: 'manual' })
      if (response.ok || response.status === 304) {
        await response.body?.cancel()
        // Keep the readiness probe outside every scenario's timestamp window.
        await new Promise((resolve) => setTimeout(resolve, 200))
        return
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Benchmark server is not reachable at ${args.baseUrl}: ${lastError}`)
}

async function main() {
  console.log(`CubeLab bandwidth benchmark (${args.label})`)
  console.log(`Base URL: ${args.baseUrl}`)
  console.log(`Output:   ${args.out}`)
  console.log(`Server:   ${args.serverLog ?? 'no server log supplied (network totals unavailable)'}`)
  await waitForServer()

  const scenarioResults = {}
  if (shouldRun('cold') || shouldRun('warm') || shouldRun('reopen') || shouldRun('hard')) {
    scenarioResults.coldWarm = await scenarioColdWarm()
  }
  if (shouldRun('cold-nosw') || shouldRun('warm-nosw') || shouldRun('hard-nosw')) {
    scenarioResults.coldNoSw = await scenarioColdNoSw()
  }
  if (shouldRun('navigation')) scenarioResults.navigation = await scenarioNavigation()
  if (shouldRun('solves-100') || shouldRun('solves-1000') || shouldRun('solves-10000')) {
    scenarioResults.solveCounts = await scenarioSolveCounts()
  }
  if (shouldRun('long-session')) scenarioResults.longSession = await scenarioLongSession()
  if (shouldRun('mobile')) scenarioResults.mobile = await scenarioMobile()

  const summary = {
    meta: { ...browserReport, finishedAt: new Date().toISOString(), label: args.label },
    scenarioResults,
    measurements,
    keyTotals: {},
  }

  const cold = measurements.find((measurement) => measurement.id === 'A-cold-first-visit')
  const warm = measurements.find((measurement) => measurement.id === 'B-warm-second-visit')
  const reopen = measurements.find((measurement) => measurement.id === 'C-warm-reopen')
  const eLoad = measurements.find((measurement) => measurement.id === 'E-load')
  const eSteps = measurements.filter((measurement) => measurement.id.startsWith('E-') && measurement.id !== 'E-load')
  const fLoad = measurements.find((measurement) => measurement.id === 'F-load')
  const fSolves = measurements.find((measurement) => measurement.id === 'F-100-solves')
  const fAnalytics = measurements.find((measurement) => measurement.id === 'F-analytics')
  const gLoad = measurements.find((measurement) => measurement.id === 'G-load-1000')
  const gAnalytics = measurements.find((measurement) => measurement.id === 'G-analytics-1000')
  const gTraining = measurements.find((measurement) => measurement.id === 'G-training-1000')
  const hLoad = measurements.find((measurement) => measurement.id === 'H-load-10000')
  const hAnalytics = measurements.find((measurement) => measurement.id === 'H-analytics-10000')
  const hTraining = measurements.find((measurement) => measurement.id === 'H-training-10000')

  if (cold) summary.keyTotals.coldFirstVisitBytes = cold.server.totalBytes
  if (warm) summary.keyTotals.warmSecondVisitBytes = warm.server.totalBytes
  if (reopen) summary.keyTotals.warmReopenBytes = reopen.server.totalBytes
  if (eLoad) {
    summary.keyTotals.normalSessionBytes = eLoad.server.totalBytes + eSteps.reduce((sum, step) => sum + step.server.totalBytes, 0)
  }
  if (fLoad) {
    summary.keyTotals.session100SolveBytes = fLoad.server.totalBytes +
      (fSolves?.server.totalBytes ?? 0) + (fAnalytics?.server.totalBytes ?? 0)
  }
  if (gLoad) {
    summary.keyTotals.session1000SolveBytes = gLoad.server.totalBytes +
      (gAnalytics?.server.totalBytes ?? 0) + (gTraining?.server.totalBytes ?? 0)
  }
  if (hLoad) {
    summary.keyTotals.session10000SolveBytes = hLoad.server.totalBytes +
      (hAnalytics?.server.totalBytes ?? 0) + (hTraining?.server.totalBytes ?? 0)
  }
  const coldNoSw = measurements.find((measurement) => measurement.id === 'A2-cold-first-visit-no-sw')
  if (coldNoSw) summary.keyTotals.coldForegroundOnlyBytes = coldNoSw.server.totalBytes
  if (cold && coldNoSw) {
    summary.keyTotals.coldServiceWorkerPrecacheApproxBytes =
      cold.server.totalBytes - coldNoSw.server.totalBytes
  }

  writeFileSync(join(args.out, 'results.json'), JSON.stringify(summary, null, 2))
  writeFileSync(join(args.out, 'summary.json'), JSON.stringify({
    meta: summary.meta,
    keyTotals: summary.keyTotals,
    keyTotalsMB: Object.fromEntries(
      Object.entries(summary.keyTotals).map(([key, value]) => [key, value / 1e6]),
    ),
  }, null, 2))

  console.log('\n=== Key totals (MB = 10^6 bytes, headers + encoded bodies) ===')
  for (const [key, value] of Object.entries(summary.keyTotals)) {
    console.log(`${key.padEnd(40)} ${(value / 1e6).toFixed(4)} MB (${value} bytes)`)
  }
  console.log(`\nResults: ${join(args.out, 'results.json')}`)

  if (!args.keepProfiles) {
    // Profiles are disposable. Keep the JSON evidence, remove browser state.
    rmSync(args.profileRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  // A thrown navigation or locator error can leave a persistent Chromium
  // process alive. Exit explicitly so the harness never hangs a CI shell.
  process.exit(1)
})
