#!/usr/bin/env node
/**
 * Production-like static server for CubeLab bandwidth benchmarks.
 *
 * - Serves the real `dist/` output (never the Vite dev server).
 * - Negotiates Brotli or gzip for compressible text assets.
 * - Uses long-lived immutable caching for hashed `/assets/*` files.
 * - Revalidates HTML, the service worker and the web manifest.
 * - Supports ETag/If-None-Match so returning-visit revalidation is measurable.
 * - Binds to 127.0.0.1 only.
 *
 * Usage:
 *   node docs/hosting/benchmarks/serve-production.mjs --port 4180
 *   node docs/hosting/benchmarks/serve-production.mjs --port 4180 --encoding gzip
 *   node docs/hosting/benchmarks/serve-production.mjs --port 4180 --log /tmp/cubelab.jsonl
 *
 * `--encoding` accepts `br` (default preference), `gzip`, or `identity`.
 * Passing `gzip` forces gzip even when the client advertises Brotli, which is
 * used for the gzip-versus-Brotli comparison.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const DEFAULT_ROOT = join(REPO_ROOT, 'dist')

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.wasm', 'application/wasm'],
  ['.txt', 'text/plain; charset=utf-8'],
])

/** Types that benefit from text compression. Already-compressed formats are skipped. */
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
  '.txt',
])

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    host: '127.0.0.1',
    port: 4180,
    encoding: 'br',
    log: null,
    quiet: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`)
      return argv[index]
    }
    if (arg === '--root') args.root = resolve(next())
    else if (arg === '--host') args.host = next()
    else if (arg === '--port') args.port = Number(next())
    else if (arg === '--encoding') args.encoding = next()
    else if (arg === '--log') args.log = resolve(next())
    else if (arg === '--quiet') args.quiet = true
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(import.meta.filename, 'utf8').split('*/')[0])
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!['br', 'gzip', 'identity'].includes(args.encoding)) {
    throw new Error(`Unsupported --encoding: ${args.encoding}`)
  }
  return args
}

function walkFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

function toUrlPath(root, fullPath) {
  const path = relative(root, fullPath).split(sep).join('/')
  return `/${path}`
}

function cacheControlFor(urlPath) {
  if (urlPath.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable'
  }
  if (urlPath === '/' || urlPath.endsWith('.html')) {
    return 'public, max-age=0, must-revalidate'
  }
  if (urlPath === '/sw.js' || urlPath === '/registerSW.js' || urlPath === '/manifest.webmanifest') {
    return 'no-cache'
  }
  return 'public, max-age=86400'
}

function contentTypeFor(urlPath) {
  return MIME.get(extname(urlPath).toLowerCase()) ?? 'application/octet-stream'
}

function encodeBody(buffer, extension, encoding) {
  if (!COMPRESSIBLE.has(extension)) return null
  if (encoding === 'br') {
    const compressed = brotliCompressSync(buffer, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
      },
    })
    return compressed.length < buffer.length ? compressed : null
  }
  if (encoding === 'gzip') {
    const compressed = gzipSync(buffer, { level: 9 })
    return compressed.length < buffer.length ? compressed : null
  }
  return null
}

function chooseEncoding(acceptEncoding, forcedEncoding) {
  const accepted = (acceptEncoding ?? '').toLowerCase()
  if (forcedEncoding === 'identity') return 'identity'
  if (forcedEncoding === 'gzip') {
    return /\bgzip\b/.test(accepted) ? 'gzip' : 'identity'
  }
  if (forcedEncoding === 'br' && /\bbr\b/.test(accepted)) return 'br'
  if (/\bgzip\b/.test(accepted)) return 'gzip'
  return 'identity'
}

function rawHeaderBytes(statusCode, statusMessage, headers) {
  let text = `HTTP/1.1 ${statusCode} ${statusMessage ?? ''}\r\n`
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) text += `${name}: ${item}\r\n`
    } else if (value !== undefined) {
      text += `${name}: ${value}\r\n`
    }
  }
  text += '\r\n'
  return Buffer.byteLength(text, 'utf8')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.root) || !statSync(args.root).isDirectory()) {
    throw new Error(`Static root does not exist: ${args.root}`)
  }

  if (args.log) writeFileSync(args.log, '')
  const files = walkFiles(args.root)
  const assets = new Map()
  for (const file of files) {
    const urlPath = toUrlPath(args.root, file)
    const buffer = readFileSync(file)
    const extension = extname(file).toLowerCase()
    assets.set(urlPath, {
      file,
      buffer,
      extension,
      br: encodeBody(buffer, extension, 'br'),
      gzip: encodeBody(buffer, extension, 'gzip'),
      bodyHash: createHash('sha256').update(buffer).digest('hex').slice(0, 16),
    })
  }

  const server = createServer((request, response) => {
    const startedAt = process.hrtime.bigint()
    let url
    try {
      url = new URL(request.url ?? '/', `http://${args.host}:${args.port}`)
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Bad request')
      return
    }

    let pathname = decodeURIComponent(url.pathname)
    if (pathname.includes('\0') || pathname.includes('..')) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Bad request')
      return
    }

    let asset = assets.get(pathname)
    let isSpaFallback = false
    if (!asset && (pathname === '/' || !extname(pathname))) {
      // Mirror a production SPA rewrite: unknown extension-less paths render
      // the application shell. The app itself uses sessionStorage view state,
      // not URL routes, so this is only for realistic deep-link behaviour.
      asset = assets.get('/index.html')
      isSpaFallback = Boolean(asset)
      if (isSpaFallback) pathname = '/index.html'
    }

    if (!asset) {
      const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      }
      response.writeHead(404, headers)
      response.end('Not found')
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Method not allowed')
      return
    }

    const encoding = chooseEncoding(request.headers['accept-encoding'], args.encoding)
    const encoded = encoding === 'br' ? asset.br : encoding === 'gzip' ? asset.gzip : null
    const body = encoded ?? asset.buffer
    const contentEncoding = encoded ? encoding : 'identity'
    const etag = `"${asset.bodyHash}-${contentEncoding}"`
    const cacheControl = cacheControlFor(pathname)
    const contentType = contentTypeFor(pathname)

    const headers = {
      'Cache-Control': cacheControl,
      'Content-Type': contentType,
      'Vary': 'Accept-Encoding',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (pathname === '/sw.js') headers['Service-Worker-Allowed'] = '/'
    if (contentEncoding !== 'identity') headers['Content-Encoding'] = contentEncoding

    const ifNoneMatch = request.headers['if-none-match']
    if (ifNoneMatch && ifNoneMatch.split(',').map((item) => item.trim()).includes(etag)) {
      const notModifiedHeaders = { ...headers }
      response.writeHead(304, notModifiedHeaders)
      response.end()
      logRequest({
        args,
        request,
        response,
        pathname,
        status: 304,
        encoding: contentEncoding,
        bodyBytes: 0,
        originalBytes: asset.buffer.length,
        cacheControl,
        contentType,
        etag,
        headers: notModifiedHeaders,
        startedAt,
        isSpaFallback,
      })
      return
    }

    headers['Content-Length'] = String(body.length)
    response.writeHead(200, headers)
    if (request.method === 'HEAD') {
      response.end()
    } else {
      response.end(body)
    }
    logRequest({
      args,
      request,
      response,
      pathname,
      status: 200,
      encoding: contentEncoding,
      bodyBytes: request.method === 'HEAD' ? 0 : body.length,
      originalBytes: asset.buffer.length,
      cacheControl,
      contentType,
      etag,
      headers,
      startedAt,
      isSpaFallback,
    })
  })

  function logRequest(entry) {
    if (!args.log) return
    const durationMs = Number(process.hrtime.bigint() - entry.startedAt) / 1e6
    const responseHeaders = {
      ...entry.headers,
      // Node adds these at send time. Include them so the estimate resembles
      // the bytes on the wire; exact HTTP/1.1 framing can still differ slightly.
      Date: new Date().toUTCString(),
      Connection: 'keep-alive',
      'Keep-Alive': 'timeout=5',
    }
    const record = {
      timestamp: Date.now(),
      method: entry.request.method,
      path: entry.pathname,
      query: entry.request.url?.includes('?') ? entry.request.url.slice(entry.request.url.indexOf('?') + 1) : '',
      status: entry.status,
      encoding: entry.encoding,
      bodyBytes: entry.bodyBytes,
      originalBytes: entry.originalBytes,
      headerBytes: rawHeaderBytes(entry.status, entry.response.statusMessage, responseHeaders),
      cacheControl: entry.cacheControl,
      contentType: entry.contentType,
      etag: entry.etag,
      referer: entry.request.headers.referer ?? '',
      secFetchDest: entry.request.headers['sec-fetch-dest'] ?? '',
      secFetchMode: entry.request.headers['sec-fetch-mode'] ?? '',
      userAgent: entry.request.headers['user-agent'] ?? '',
      durationMs: Math.round(durationMs * 1000) / 1000,
      spaFallback: entry.isSpaFallback,
    }
    appendFileSync(args.log, `${JSON.stringify(record)}\n`)
  }

  server.listen(args.port, args.host, () => {
    console.log(`SERVER_READY http://${args.host}:${args.port} root=${args.root} encoding=${args.encoding}`)
    console.log(`ASSETS ${assets.size} totalBytes=${[...assets.values()].reduce((sum, asset) => sum + asset.buffer.length, 0)}`)
    if (!args.quiet) {
      const top = [...assets.entries()]
        .map(([urlPath, asset]) => ({
          urlPath,
          bytes: asset.buffer.length,
          br: asset.br?.length ?? asset.buffer.length,
          gzip: asset.gzip?.length ?? asset.buffer.length,
        }))
        .sort((a, b) => b.bytes - a.bytes)
      for (const item of top.slice(0, 8)) {
        console.log(`  ${item.urlPath} raw=${item.bytes} br=${item.br} gzip=${item.gzip}`)
      }
    }
  })

  const shutdown = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2_000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
