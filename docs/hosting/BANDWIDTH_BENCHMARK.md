# CubeLab production bandwidth benchmark

- **Measured:** 2026-11-20
- **Application revision:** `b77f7a0` (`feat: add competition sessions with derived rounds`)
- **Scope:** production `dist/` build served over local HTTP with Brotli/gzip and production-like cache headers, exercised with Chromium through Playwright.
- **Units:** MB = 1,000,000 bytes and GB = 1,000,000,000 bytes unless a value is explicitly labelled MiB. Measured transfer includes encoded response bodies plus estimated HTTP/1.1 response headers.

## Key results

| Metric | Result |
| --- | ---: |
| Cold first visit, Brotli, empty cache and service-worker install | **1.4120 MB** |
| Warm returning visit, service worker + Cache Storage | **0.0003 MB** (0.0000–0.0006 MB observed) |
| Normal session: warm load, background checks and every view visited | **0.000629 MB** |
| 100 real solves recorded, plus Analytics | **0.000947 MB** |
| Returning session with 1,000 synthetic solves | **0.000629 MB** |
| Returning session with 10,000 synthetic solves | **0.000629 MB** |
| Real 30-solve session (36.9 min measured) | **0.000947 MB** |
| Cold first visit, gzip instead of Brotli | **1.5552 MB** |
| Estimated 1,000 MAU, moderate 20 visits, 10% cold | **0.154 GB/month** |
| Estimated 10,000 MAU, moderate 20 visits, 10% cold | **1.537 GB/month** |
| Full cold visits supported by a 100 GB allowance | **≈70,821** |
| Third-party/API requests observed | **0** |

Warm figures assume the returning browser already holds the same build that populated its cache. Deploy churn, which can force a new precache, is discussed in §6.1.

The central result is that **first-visit installation traffic dominates**. A returning CubeLab visit is effectively a cache hit: the 2.725 MB application resource set is served from the service worker's Cache Storage, and the only network bytes are zero to two service-worker revalidations (311–318 bytes each). Recording solves, growing a session to 1,000 or 10,000 solves, and navigating every view add no network traffic.

The cold first visit is also smaller than the application's 4.031 MB uncompressed output because Brotli compresses JavaScript, CSS, HTML and SVG. It is larger than the page's visible Network-panel traffic because the service worker precaches 57 resources that the initial document does not request directly.

---

## 1. Test environment and build details

### Application

| Item | Value |
| --- | --- |
| Stack | React 19, TypeScript, Vite 8, `cubing.js` |
| Package manager | npm 12.2.3 with the committed `package-lock.json` |
| Node.js | 26.13.1 |
| Build command | `npm run build` (`tsc -b && vite build`) |
| Vite | 8.3.5 |
| PWA plugin | `vite-plugin-pwa` 2.0.0, Workbox generated worker |
| Output | `dist/`, 75 files, 4,031,177 bytes |
| Entry HTML | `dist/index.html` |
| Main entry chunk | `/assets/index-97z5KJYr.js`, 623,313 bytes raw / 150,227 bytes Brotli |
| Largest chunk | `/assets/cubing-DUp8TEza.js`, 1,829,921 bytes raw / 402,664 bytes Brotli |
| Precache manifest | 77 entries; Workbox deduplicated them to 73 Cache Storage entries |
| Precache payload reported by the build | 3,916.29 KiB |

The production build emitted the existing chunk-size warning for the `cubing` chunk. No application source, dependency, storage schema or production data was changed for this benchmark.

### Serving environment

`docs/hosting/benchmarks/serve-production.mjs` serves the real `dist/` tree on `127.0.0.1`:

- Brotli quality 11 for compressible text assets; gzip level 9 as the fallback.
- Brotli is preferred when the browser advertises it; the gzip run force-negotiated gzip.
- Already-compressed PNG, WOFF2 and similar assets are served as-is.
- Hashed `/assets/*` files: `Cache-Control: public, max-age=31536000, immutable`.
- HTML: `public, max-age=0, must-revalidate`.
- `sw.js`, `registerSW.js`, `manifest.webmanifest`: `no-cache`.
- Icons and other public files: `public, max-age=86400`.
- Strong ETags with `If-None-Match`/304 support.
- HTTP/1.1, no TLS, no CDN, no Vercel edge, no external network.

This is deliberately HTTPS-free and same-machine. It measures application bytes, not the cost of TLS, TCP setup, CDN hops or edge billing.

### Browser

| Item | Value |
| --- | --- |
| Engine | Chromium 156.0.8078.4 (Playwright 1.64.1) |
| Desktop viewport | 1360×900, device scale factor 1 |
| Mobile viewport | Pixel 7 descriptor (412×915, mobile/touch emulation) |
| Profiles | Disposable persistent Chromium profiles under `/tmp/opencode/...` |
| Cache mode | Normal browser cache, service worker allowed, unless stated |
| Test data | Deterministic synthetic sessions, isolated per profile |

Firefox and WebKit were not exercised. The benchmark uses Chromium because the user requested Chromium or Firefox and because service-worker/Cache Storage instrumentation is strongest there.

### Synthetic histories

`docs/hosting/benchmarks/fixtures.mjs` generates sessions schema v7 records:

| Fixture | Sessions | Solves | Serialized localStorage |
| --- | ---: | ---: | ---: |
| 100 real solves | 1 | 100 (recorded during the test) | 59,334 bytes |
| 1,000 solves | 10 | 1,000 | 169,615 bytes (0.162 MiB) |
| 10,000 solves | 20 | 10,000 | 1,698,954 bytes (1.620 MiB) |

Solve durations, scrambles and timestamps are synthetic. They affect rendering and local storage, not network bytes. No real user profile, Google account or production secret was used.

---

## 2. Benchmark methodology

### Network accounting

Each scenario is bracketed in time. A JSONL log on the benchmark server records every HTTP response that actually reached the server:

- `bodyBytes`: exact encoded response body bytes sent.
- `headerBytes`: reconstructed status line and response headers, including `Date`, `Connection` and `Keep-Alive`.
- `totalBytes`: `bodyBytes + headerBytes`.
- Status, `Content-Encoding`, `Cache-Control`, ETag and request metadata.

Requests served from the browser HTTP cache or Cache Storage never reach the server and therefore contribute **zero network bytes**. They are not counted as downloads. They are reported separately as cache hits with their decoded resource sizes.

This distinction matters on the first visit:

- The document requested about 20 resources directly.
- The service worker installation added 57 server-only requests.
- The server log sees both. The page's `PerformanceResourceTiming` buffer and a typical page Network panel do not reliably attribute service-worker precache fetches to the document.

### Page-side instrumentation

For every measured step, Chromium CDP recorded:

- Request URL, resource type, initiator, status, protocol.
- `fromDiskCache`, `fromServiceWorker`, `fromPrefetchCache`, `requestServedFromCache`.
- Encoded transfer sizes and content lengths.
- Service-worker controller/registration and Cache Storage entry counts.

Browser `PerformanceResourceTiming` was captured as a cross-check. Its decoded totals can double-count modules imported both by the page and by the scramble worker (for example the `cubing` chunk). The report uses URL-deduplicated resource sizes instead.

### Scenario definitions

| ID | Scenario |
| --- | --- |
| A | First visit, completely empty persistent profile, service worker installs, onboarding skipped, timer ready |
| A2 | Same cold visit with service workers blocked; foreground-only baseline |
| B | Second visit in the same profile, page closed and reopened, HTTP cache + service worker intact |
| B2 | Second visit with service workers blocked, HTTP cache only |
| C | Close the whole browser context and relaunch the same persistent profile, then open the site |
| D | Reload with Chromium cache disabled through CDP while the service worker is still registered |
| D3 | Reload with cache disabled and service workers blocked (no Cache Storage) |
| E | Warm returning load, 5-second idle observation, then Timer/Sessions, Settings, Data dialog, Analytics/Solves, Analytics/Algorithms, Training, back to Timer |
| F | Warm profile; record 100 solves through the real Space-hold input path; open Analytics |
| G | Warm profile with 1,000 synthetic solves; open Analytics and Training |
| H | Warm profile with 10,000 synthetic solves; open Analytics and Training |
| I | A 30-minute simulated timer session; accelerated 65-second idle + 30 solves, plus a real 30-solve one-per-minute run (36.9 min measured) |
| J | Mobile cold visit and mobile warm visit |

Each measured step waited for the relevant UI and for network idle, plus 0.3–2 seconds of quiescence. Service-worker installation was allowed to finish via `navigator.serviceWorker.ready` before the cold measurement ended.

### Data rules

- Raw solve data is local-only. A solve is never counted as network traffic.
- A cached or service-worker-served resource is counted as **0 transfer bytes** and reported separately as a decoded/cached resource.
- The cold total includes the service worker's background precache, because those bytes really are downloaded on a first visit.
- The foreground-only baseline uses `serviceWorkers: 'block'` and a separate empty profile.
- The hard-reload test distinguishes browser cache from service-worker Cache Storage.
- The 100-solve run uses actual timer key events, not seeded records.
- The 1,000/10,000-solve runs use isolated synthetic local storage; no solve is transmitted.

---

## 3. Measurements

### 3.1 Core first/returning scenarios

Network totals include encoded bodies and estimated response headers. “Uncompressed resources used” is URL-deduplicated and includes resources served from cache; it is not the same as network transfer.

| Scenario | Network requests | Encoded body | Headers | Total network | Uncompressed resources used | Cache / SW hits | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **A. Cold first visit (Brotli)** | 77 | 1,387,423 | 24,578 | **1,412,001** | 4,031,177 | 1 page hit, 0 SW | Includes 57 background precache requests and onboarding |
| A2. Cold, service workers blocked | 19 | 649,461 | 6,190 | 655,651 | 2,769,739 | 0 | Foreground-only; onboarding + timer + worker chunk |
| **B. Warm second visit** | 0 | 0 | 0 | **0** | 2,725,169 | 17 SW hits | All application resources from Cache Storage |
| B2. Warm HTTP cache only, no SW | 2 | 0 | 602 | 602 | 2,725,169 | 15 disk-cache hits | 304 for HTML and `registerSW.js` |
| **C. Warm after browser relaunch** | 1 | 0 | 311 | **311** | 2,725,169 | 17 SW hits | 304 for the navigation |
| **D. Hard reload, cache disabled, SW active** | 2 | 0 | 636 | **636** | 2,725,169 | 17 SW hits | Two `sw.js` 304s; page still came from Cache Storage |
| D3. Hard reload, cache disabled, no SW | 18 | 639,200 | 5,859 | 645,059 | 2,725,169 | 0 | Full foreground re-download |
| **A. Cold first visit (gzip)** | 77 | 1,530,352 | 24,858 | **1,555,210** | 4,031,177 | 0 | Same resources, gzip encoding |

Cold first-visit result was reproduced at 1,412,001 bytes on desktop and mobile and across repeated runs. The warm result varied between 0 bytes (B) and 636 bytes (D) depending on when Chromium revalidated `sw.js`.

### 3.2 Every implemented view

CubeLab has no URL router. `src/components/AppHeader.tsx` defines exactly three views: Timer, Analytics and Training. Settings and Sessions are dialogs/panels rather than routed pages. The navigation test therefore covers all three views plus both named surfaces and the local-data dialog.

| Step | Network requests | Total network | SW/cache hits | Uncompressed loaded | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Warm load | 1 | 311 | 17 | 2,725,169 | 304 navigation |
| 5-second background idle | 1 | 318 | 0 | 0 | One `sw.js` update check |
| Timer + Sessions picker + Session settings | 0 | 0 | 0 | 0 | No request |
| Settings dialog | 0 | 0 | 0 | 0 | No request; static in entry chunk |
| Local data / backup dialog | 0 | 0 | 2 | 11,204 | Lazy `DataDialog` chunk from Cache Storage |
| Analytics — Solves | 0 | 0 | 3 | 76,275 | Lazy Analytics page/charts from Cache Storage |
| Analytics — Algorithms | 0 | 0 | 4 | 17,604 | Lazy Algorithms view from Cache Storage |
| Training Hub | 0 | 0 | 4 | 241,680 | Lazy Training chunks and diagrams from Cache Storage |
| Back to Timer | 0 | 0 | 0 | 0 | No request |
| **Normal session total** | **2** | **629** | — | — | Load + background check; every navigation is free |

The lazy chunks do exist: 11.2 KB for the data dialog, 76.3 KB for Analytics, 17.6 KB for Algorithms and 241.7 KB for Training (uncompressed). They are precached during the first visit and therefore cost no network bytes on a warm visit.

### 3.3 Solve-count scenarios

| Scenario | Load | Usage / navigation | Total network | Stored history | Solve-data traffic |
| --- | ---: | ---: | ---: | ---: | ---: |
| F. 100 real solves | 311 | 2 × `sw.js` 304 = 636; Analytics 0 | **947 bytes** | 100 solves, 59,334 bytes | **0** |
| G. 1,000 synthetic solves | 311 | Analytics step 318 (`sw.js` 304); Training 0 | **629 bytes** | 1,000 solves, 169,615 bytes | **0** |
| H. 10,000 synthetic solves | 311 | Analytics step 318 (`sw.js` 304); Training 0 | **629 bytes** | 10,000 solves, 1,698,954 bytes | **0** |

The 100-solve test recorded 100 genuine solves through the timer's input path in 52 seconds. During that entire period, the only network requests were two service-worker update checks. The 59,334-byte session payload was written to localStorage, never uploaded.

At 10,000 solves the application still opened with one 304 navigation request and one background `sw.js` check. Analytics and Training continued to load from Cache Storage with zero network bytes. The 1.62 MiB localStorage payload changed rendering cost, not transfer.

### 3.4 Long timer session

The accelerated test observed 65 seconds of idle time followed by 30 solves. The only network activity was two `sw.js` 304 checks during the idle window (636 bytes total). The 30 solves generated zero requests.

A real 30-solve session, configured as one solve per minute, was run separately. The measured window was 36.9 minutes (2,216,038 ms) because solve/UI work and post-run settling added overhead beyond the nominal minute. It recorded 30 solves (17,975 bytes in localStorage), made two `sw.js` 304 requests (636 bytes), and transferred no solve data. With the 311-byte warm load, the end-to-end total was 947 bytes. The same pattern held: solve recording is local, and the only network bytes were service-worker revalidation.

### 3.5 Mobile

| Scenario | Network requests | Total network | Uncompressed resources used | Notes |
| --- | ---: | ---: | ---: | --- |
| Mobile cold first visit | 77 | **1,412,001** | 4,031,177 | Identical payload to desktop |
| Mobile warm visit | 1 | **318** | 2,725,169 | 304 service-worker check |

There are no separate mobile images, fonts or route bundles. The responsive layout changes rendering only. Chromium mobile emulation still requested the same 77 cold requests.

### 3.6 Compression: Brotli versus gzip

| Scenario | Brotli total | gzip total | Brotli saving |
| --- | ---: | ---: | ---: |
| Cold first visit | 1,412,001 | 1,555,210 | **143,209 bytes (9.2% less than gzip)** |
| Cold foreground only | 655,651 | 781,351 | **125,700 bytes (16.1% less than gzip)** |

Brotli is 9.2% smaller than gzip on the cold visit; conversely, gzip is 10.1% larger than Brotli. Compressible text assets were served with the negotiated encoding; WOFF2, PNG and other already-compressed assets stayed identity. The CDN must actually negotiate Brotli for these savings to reach users.

### 3.7 Cache hits, cache misses and repeated requests

| Scenario | Network 200s (fresh) | Network 304s (revalidated) | Browser cache hits | Service-worker hits |
| --- | ---: | ---: | ---: | ---: |
| Cold A | 77 | 0 | 1 | 0 |
| Warm B | 0 | 0 | 17 | 17 |
| Warm C | 0 | 1 | 17 | 17 |
| Hard D | 0 | 2 | 17 | 17 |
| HTTP-cache-only B2 | 0 | 2 | 15 | 0 |
| No-SW hard D3 | 18 | 0 | 0 | 0 |

The only repeated paths in the cold run were `/index.html` and `/registerSW.js`, each fetched twice because the document and the service-worker precache both requested them. That is 881 bytes of avoidable duplication. A `search-worker-entry` path can also be requested twice by the scramble worker startup (218 bytes each) depending on worker timing. Neither is material compared with icons or `cubing`.

### 3.8 Background network activity

- Cold first visit: **57 precache requests, 757,615 bytes** after the document loads.
- Warm visit: **0–2 `sw.js` checks**, each 311–318 bytes. These are browser-managed service-worker revalidations; there was no application polling, telemetry, analytics or API traffic.
- 52-second 100-solve run: 2 `sw.js` checks (636 bytes) and no per-solve requests.
- 65-second idle observation: 2 `sw.js` checks (636 bytes).
- Real 30-solve session (36.9 minutes measured): 2 `sw.js` checks (636 bytes); solve traffic remained zero.

### 3.9 Browser-reported sizes versus server accounting

The page's `PerformanceResourceTiming` for the cold visit reported about 610,624 bytes of transfer across its own entries. The server saw 1,412,001 bytes. The 0.8 MB gap is the service-worker precache, which is not reliably attributed to the page's resource timeline. The server log is therefore the authoritative transfer total.

The same API reported 2,725,169 unique decoded bytes for a warm visit, all delivered from Cache Storage with zero transfer. Its raw decoded sum (4,561,254 bytes) double-counts `cubing` and `jsx-runtime` imports from the page and scramble worker; the report uses URL-deduplicated sizes.

Header bytes are reconstructed HTTP/1.1 framing, including `Date`, `Connection` and `Keep-Alive`. They are close to, but not identical to, the bytes a CDN would send over HTTP/2 or HTTP/3, where header compression reduces overhead.

---

## 4. Asset breakdown

### 4.1 Cold first visit by resource type

These are actual cold-visit server bytes, including headers, for all 77 requests. Percentages are of 1,412,001 bytes.

| Type | Requests | Network transfer | Share | Uncompressed unique |
| --- | ---: | ---: | ---: | ---: |
| JavaScript | 39 | 667,809 | 47.3% | 3,019,457 |
| Images (PNG) | 3 | 591,226 | 41.9% | 590,385 |
| Fonts (WOFF2) | 5 | 85,689 | 6.1% | 84,216 |
| SVG | 22 | 30,915 | 2.2% | 145,053 |
| CSS | 1 | 25,866 | 1.8% | 168,768 |
| Service worker | 4 | 7,668 | 0.5% | 20,396 |
| HTML document | 2 | 2,232 | 0.2% | 2,268 |
| Web manifest | 1 | 596 | 0.0% | 634 |
| **Total** | **77** | **1,412,001** | **100%** | **4,031,177** |

JavaScript is the largest category by transfer, but three PNG icons alone account for 41.9% of the cold visit. The JavaScript total includes the 403 KB Brotli `cubing` chunk plus the 150 KB entry chunk and all lazy chunks precached for Analytics, Training and dialogs.

Transfer by type for the headline scenarios (headers included; “Other” is HTML + service worker + manifest):

| Scenario | JavaScript | CSS | Images | Fonts | SVG | Other | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold first visit (Brotli) | 667,809 | 25,866 | 591,226 | 85,689 | 30,915 | 10,496 | **1,412,001** |
| Warm C (relaunch) | 0 | 0 | 0 | 0 | 0 | 311 | **311** |
| F: 100 real solves | 0 | 0 | 0 | 0 | 0 | 947 | **947** |
| G: 1,000 solves | 0 | 0 | 0 | 0 | 0 | 629 | **629** |
| H: 10,000 solves | 0 | 0 | 0 | 0 | 0 | 629 | **629** |
| Mobile cold | 667,809 | 25,866 | 591,226 | 85,689 | 30,915 | 10,496 | **1,412,001** |
| Mobile warm | 0 | 0 | 0 | 0 | 0 | 318 | **318** |

### 4.2 Largest transferred assets

| Asset | Raw bytes | Brotli | gzip | Cold transfer incl. headers | Share of cold visit |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/icon-512.png` | 449,781 | 449,781 | 449,781 | 450,062 | **31.9%** |
| `/assets/cubing-DUp8TEza.js` | 1,829,921 | 402,664 | 492,060 | 402,996 | **28.5%** |
| `/assets/index-97z5KJYr.js` | 623,313 | 150,227 | 177,487 | 150,559 | **10.7%** |
| `/icon-192.png` | 74,045 | 74,045 | 74,045 | 74,325 | **5.3%** |
| `/apple-touch-icon.png` | 66,559 | 66,559 | 66,559 | 66,839 | **4.7%** |
| `/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2` | 40,404 | 40,404 | 40,404 | 40,699 | 2.9% |
| `/assets/index-BUQHf-_Z.css` | 168,768 | 25,542 | 30,898 | 25,866 | 1.8% |
| `/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2` | 15,196 | 15,196 | 15,196 | 15,491 | 1.1% |
| `/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2` | 12,108 | 12,108 | 12,108 | 12,403 | 0.9% |
| `/assets/AnalyticsPage-DXVlxxtz.js` | 47,106 | 10,318 | 11,586 | 10,649 | 0.8% |

The top five assets account for **1,144,781 bytes, or 81.1% of the cold visit**. The three icons account for 41.9% on their own. The 21 PLL SVGs total 145,053 raw bytes but only 30,915 bytes over the wire because they are text-compressed; they are still downloaded during the first visit solely because they are in the precache.

### 4.3 Background precache

On a completely empty profile the page produced 20 request records (18 unique paths) and the service worker fetched 57 additional resources that the document never asked for. The service-worker-only set was:

| Background type | Requests | Transfer |
| --- | ---: | ---: |
| PNG icons | 3 | 591,226 |
| JavaScript chunks, Workbox and worker entries | 21 | 89,888 |
| SVG diagrams/favicon | 22 | 30,915 |
| WOFF2 font subsets | 4 | 44,990 |
| Web manifest | 1 | 596 |
| **Total** | **57** | **757,615 (53.6% of cold)** |

The cold foreground-only baseline was 655,651 bytes. Cold total minus foreground-only was 756,350 bytes; the small difference from the 757,615 category total is because a few paths (`index.html`, `registerSW.js`) were fetched both by the page and by the precache and are attributed to the foreground set.

`/icon-512.png`, `/icon-192.png` and `/apple-touch-icon.png` alone are 591,226 bytes of the 757,615 background bytes. This is the single largest first-visit cost and is not needed to render the timer.

### 4.4 Cache and service-worker state

After a cold visit:

- Service worker: registered and controlling, scope `/`.
- Cache Storage: 73 entries in `workbox-precache-v2-http://.../`.
- Build-generated precache manifest: 77 entries; Workbox deduplicated repeated icon/manifest entries.
- On a warm visit: 17 page resources served from Cache Storage, 0 network for the document and assets in the best run.

A warm visit loaded 2,725,169 bytes of URL-deduplicated resources from cache, but transferred 0 bytes. The browser's Performance API can report larger decoded totals because the `cubing` chunk and `jsx-runtime` are imported by both the app and worker paths; deduplication by URL gives the 2.725 MB figure.

---

## 5. First visit versus returning visit

| Comparison | Cold | Warm | Change |
| --- | ---: | ---: | ---: |
| Network transfer | 1,412,001 | 0–636 | ≈99.98% reduction |
| Network requests | 77 | 0–2 | — |
| Encoded body | 1,387,423 | 0 | — |
| Headers | 24,578 | 0–636 | — |
| Uncompressed resources used | 4,031,177 | 2,725,169 | Fewer resources because precache-only assets are not re-fetched |
| Cache hits | 1 | 17 | — |
| Service-worker hits | 0 | 17 | — |

The cold visit is not merely a larger version of the warm visit. It includes the one-time cost of installing the offline application:

- **Foreground shell:** 655,651 bytes, mostly the entry chunk, `cubing`, CSS, the Latin font and onboarding.
- **Background precache:** 757,615 bytes, mostly icons, font subsets, PLL diagrams and lazy feature chunks.
- **Warm load:** 0 bytes in the best run; one 311-byte HTML revalidation after a browser relaunch; two 304s (636 bytes) after a cache-disabled reload.

With the service worker blocked but the HTTP cache warm, the browser made two 304 revalidations (602 bytes) and served 15 resources from disk cache. With cache disabled and no service worker, the same returning user paid 645,059 bytes for the foreground shell.

---

## 6. Vercel bandwidth estimates by monthly active users

### 6.1 Formula and assumptions

These estimates are provider-agnostic and use only the measured CubeLab host bytes. They are presented under the Vercel heading because that is the target deployment; no Vercel plan limit, billing rule or edge behavior was researched.

Let:

- `C` = 1.412001 MB, measured cold first visit (Brotli).
- `W` = 0.000629 MB, measured normal returning session; this is the conservative observed high end (one load 304 + one `sw.js` 304). Best observed warm visits were 0–0.000311 MB.
- `V` = visits per user per month: 5 (light), 20 (moderate), 60 (heavy).
- `N` = monthly active users.
- `f` = share of MAU whose first visit in the month is cold (new browser profile, cleared site data, private mode or evicted service worker).

Per-user monthly transfer:

```text
MB_user = f × (C + (V − 1) × W) + (1 − f) × V × W
GB_month = N × MB_user / 1000
```

Base case uses `f = 0.10` (10% of MAU cold in the month, 90% already returning with a warm cache). This is a modeling assumption, not a measured user mix. The 100 GB allowance used below is a **modeling reference**, not a claim about any provider's current plan or billing metric.

Additional assumptions:

- Each visit opens the application once and uses the timer; no file downloads, no Drive sync, no installed-PWA update beyond a normal navigation.
- Browser HTTP cache and Cache Storage persist between visits.
- A returning user's application resources are already precached.
- The application build is stable during the month. A deployment that changes hashed assets can force a new service-worker precache on returning users; deploy churn is modelled separately below rather than hidden inside `W`.
- Solve history is local and is never uploaded unless the user explicitly enables Google Drive.
- Traffic is CubeLab-host static traffic. Google Drive sync, if enabled, is third-party traffic and is excluded.

Measured uncertainty around the inputs: the Brotli cold visit repeated at exactly 1,412,001 bytes on desktop and mobile; gzip would make it 1,555,210 bytes. Warm visits ranged from 0 to 636 bytes. Reconstructed headers are within a few KB of actual HTTP/1.1 framing and differ again under HTTP/2/3. The largest modeling uncertainty is `f`, not the byte measurements. If a provider counts only response bodies rather than body plus headers, use 1,387,423 bytes per cold visit (24,578 bytes less) and near-zero for warm visits.

Deploy churn is a second uncertainty that the base formula deliberately excludes. CubeLab uses a generated auto-update service worker and hashed Vite assets. A new production build can invalidate most precached URLs; on the next visit the new worker installs the new precache. A conservative planning add-on is roughly one extra cold-install transfer per returning user per deploy that they encounter:

```text
extra GB_month ≈ N × affected_share × deployments × 1.412 / 1000
```

This is a planning identity, not a measured deploy-update result. A stable-build month has zero deploy-churn bytes; a weekly-deploy month can materially exceed the base table.

### 6.2 Base case: 10% cold first visits

Values are GB per month, decimal.

| MAU | Light: 5 visits | Moderate: 20 visits | Heavy: 60 visits |
| ---: | ---: | ---: | ---: |
| 100 | 0.014 | 0.015 | 0.018 |
| 1,000 | 0.144 | **0.154** | 0.179 |
| 5,000 | 0.721 | 0.769 | 0.894 |
| 10,000 | 1.443 | **1.537** | 1.789 |
| 50,000 | 7.214 | 7.686 | 8.944 |
| 100,000 | 14.428 | 15.372 | 17.888 |

At 10,000 MAU the moderate pattern is about **1.5 GB/month**. At 100,000 MAU it is about **15.4 GB/month**. Returning visits are so small relative to a cold install that the visit-count pattern changes the 100,000-MAU estimate by only ~3.5 GB/month across light to heavy.

### 6.3 Upper bound: every MAU has one cold visit in the month

This is the conservative ceiling if every active user arrives with no cache, or if caches/service workers are routinely evicted.

| MAU | Light: 5 visits | Moderate: 20 visits | Heavy: 60 visits |
| ---: | ---: | ---: | ---: |
| 100 | 0.141 | 0.142 | 0.145 |
| 1,000 | 1.415 | 1.424 | 1.449 |
| 5,000 | 7.073 | 7.120 | 7.246 |
| 10,000 | 14.145 | 14.240 | 14.491 |
| 50,000 | 70.726 | 71.198 | 72.456 |
| 100,000 | 141.452 | 142.395 | 144.911 |

Under this ceiling, 100,000 MAU moderate usage is about **142 GB/month**, above a 100 GB reference allowance. The same 100,000 users with a fully warm cache would be only **1.26 GB/month**.

### 6.4 Lower bound: all visits warm

| MAU | Light: 5 visits | Moderate: 20 visits | Heavy: 60 visits |
| ---: | ---: | ---: | ---: |
| 100 | 0.000 | 0.001 | 0.004 |
| 1,000 | 0.003 | 0.013 | 0.038 |
| 5,000 | 0.016 | 0.063 | 0.189 |
| 10,000 | 0.031 | 0.126 | 0.377 |
| 50,000 | 0.157 | 0.629 | 1.887 |
| 100,000 | 0.315 | 1.258 | 3.774 |

The realistic answer sits between the lower and upper tables. At 1,000 MAU moderate, that is **0.013–1.424 GB/month**, with 0.154 GB at the 10% cold assumption. At 10,000 MAU moderate, that is **0.126–14.240 GB/month**, with 1.537 GB at 10% cold. At 100,000 MAU heavy, the range is **3.774–144.911 GB/month**, with 17.888 GB at 10% cold.

### 6.5 Sensitivity to the first-visit share

Moderate 20 visits/user/month, unless noted:

| MAU / pattern | 0% cold | 5% cold | 10% cold | 25% cold | 100% cold |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10,000 / moderate | 0.126 | 0.831 | 1.537 | 3.654 | 14.240 |
| 100,000 / heavy | 3.774 | 10.831 | 17.888 | 39.058 | 144.911 |

The first-visit share is the dominant uncertainty. Visit count, solve history size and page navigation are secondary.

### 6.6 What 100 GB buys

Using the measured Brotli cold visit:

```text
100 GB = 100,000 MB
100,000 / 1.412001 = 70,821 full cold visits
```

- **≈70,821** complete cold first visits under a 100 GB decimal allowance.
- **≈64,300** if the CDN serves gzip instead of Brotli (1.555210 MB per cold visit).
- **≈72,521** if “100 GB” is interpreted as 100 GiB.
- If every visit were a perfect warm cache hit at 0.000629 MB, the same allowance could cover about 159 million visits. That is not a practical planning number because cache eviction, new browsers, private sessions and deploy updates inevitably produce fresh installs.
- These counts assume a stable build. Each deploy that returning users encounter can consume another near-cold precache install, so a deploy-heavy month reduces the number of users a fixed allowance can support.

### 6.7 Host versus third-party traffic

| Traffic source | Observed in this benchmark | Included in host estimate |
| --- | --- | --- |
| CubeLab static HTML/JS/CSS/fonts/images/SVG | 1.412 MB cold; ~0.0003–0.0006 MB warm | Yes |
| API calls | None | — |
| Analytics/telemetry | None | — |
| Google Fonts/CDN | None; fonts are bundled | — |
| Google Drive sync | Not exercised; requires a real account and explicit connection | No |
| Software update checks | `sw.js` 304, 311–318 bytes each | Yes |

Google Drive is the only designed third-party integration found. It is off by default. If a user connects it, synchronization content goes directly between the browser and Google; it is not CubeLab host bandwidth. The 10,000-solve fixture serializes to 1.70 MB, so a full Drive snapshot upload/download of that history would be roughly that size per transfer, but the sync schedule and conflict behavior were not measured. No account was touched.

---

## 7. Biggest bandwidth contributors

1. **PWA icons — 591,226 bytes (41.9% of cold).**
   `/icon-512.png` alone is 449,781 bytes and is a 16-bit RGBA PNG. It is served uncompressed because PNG is already compressed. The three icons are fetched by the service-worker precache on the first visit, not by the initial document.

2. **`cubing.js` chunk — 402,996 bytes (28.5% of cold).**
   1,829,921 bytes raw, 402,664 bytes Brotli. It is statically imported by the production entry and is also needed for official scrambles.

3. **Main entry chunk — 150,559 bytes (10.7%).**
   623,313 bytes raw. This includes React, application wiring, settings and the timer shell.

4. **Background precache as a whole — 757,615 bytes (53.6%).**
   Of this, icons are 591,226 bytes; lazy feature chunks, font subsets, PLL SVGs and Workbox account for the rest. This is the deliberate offline-first trade-off: it makes every later view free but makes the first visit expensive.

5. **Fonts — 85,689 bytes (6.1%).**
   Five WOFF2 subsets are precached. The page itself uses the Latin subset (40,404 bytes); Latin-ext, Cyrillic, Greek and Vietnamese are background-only for an English UI.

6. **CSS — 25,866 bytes (1.8%).**
   168,768 bytes raw, 25,542 bytes Brotli. The stylesheet also carries a small base64 font subset.

7. **PLL SVG diagrams — 30,915 bytes (2.2%).**
   21 files, 145,053 bytes raw, precached for Training even when Training is never opened.

No API, external service, image CDN or telemetry request appeared in any run.

---

## 8. Potential optimizations

These are measured opportunities, not implemented changes. Savings are relative to the 1,412,001-byte cold first visit unless noted. Some trade against the application's offline-first guarantee.

| Opportunity | Measured baseline | Potential saving | Caveat |
| --- | ---: | ---: | --- |
| Re-encode the three PNG icons as 8-bit PNG | 590,385 raw bytes | 473,223 bytes (33.5%); cold → 0.939 MB | Exploratory `/tmp` re-encode measured 117,162 bytes total; visual QA and manifest compatibility required |
| Serve AVIF icons with a compatible fallback | 590,385 raw bytes | 580,594 bytes (41.1%); cold → 0.831 MB | Exploratory AVIF re-encode measured 9,791 bytes total; manifest/apple-touch support and visual QA not validated |
| Stop precaching PWA icons | 591,226 transfer bytes | 591,226 bytes (41.9%); cold → 0.821 MB | Icons may still be fetched on install/PWA prompt; offline install icon behavior must be checked |
| Precache only the core shell, runtime-cache the rest | 757,615 background bytes | Up to 757,615 bytes (53.6%); cold → 0.654 MB | First offline use of Analytics/Training/dialogs would fail until visited online |
| Defer the `cubing` chunk off the startup path | 402,996 bytes | Up to 402,996 bytes off startup (28.5%) | It is still needed for the first official scramble; total first-visit bytes only fall if no timer use occurs |
| Precache only the Latin font | 44,990 bytes of non-Latin subsets | 44,990 bytes (3.2%); cold → 1.367 MB | Non-Latin users fetch their subset on demand |
| Runtime-cache Training assets | 69,031 bytes | 69,031 bytes (4.9%) | Training first open requires a network fetch |
| Runtime-cache Analytics assets | 19,180 bytes | 19,180 bytes (1.4%) | Analytics first open requires a network fetch |
| Ensure Brotli at the edge | gzip 1,555,210 | 143,209 bytes (9.2% versus gzip) | CDN must negotiate and not recompress poorly |
| Remove duplicate precache fetches of `index.html`/`registerSW.js` | 881 bytes | 881 bytes (0.06%) | Minimal; Workbox cache mode causes it |
| Avoid duplicate `search-worker-entry` fetches | 218 bytes each | ≤436 bytes | Minor worker startup behavior |

Priority order supported by the measurements:

1. **Fix icon weight or remove icons from the first-visit precache.** This is the largest safe-looking win. The icons are 41.9% of cold transfer and are not needed to render the timer.
2. **Segment the service-worker precache.** Core timer assets on install; Analytics, Training, PLL SVGs, dialogs and non-Latin fonts on first use. This could halve the cold visit at the cost of partial offline coverage.
3. **Keep Brotli enabled at the host/CDN.** It saves 9.2% of the cold visit and 16.1% of foreground-only traffic versus gzip.
4. **Trim font subsets from precache.** Only the Latin subset is used by the default English UI.
5. **Review the `cubing` startup import.** It is a large parse/transfer cost, though it is needed before the first scramble. Moving it later improves startup, not necessarily total first-visit bytes.
6. **Leave the hashed-asset cache policy alone.** The measured warm cache behavior is already excellent: 0–636 bytes per returning visit.

Code splitting is already effective for pages: Analytics, Algorithms, Training, Data and other dialogs are separate chunks. The remaining issue is not missing code splitting; it is that the service worker downloads all of those chunks on the first visit.

---

## 9. Measurement limitations

- **Chromium only.** Firefox and WebKit service-worker/cache behavior was not measured.
- **Localhost HTTP/1.1, no TLS, no CDN.** TCP/TLS setup, CDN hops and HTTP/2/3 header compression are excluded. The 24.6 KB header total is reconstructed HTTP/1.1 framing and is an estimate, not an exact wire capture.
- **No Vercel edge and no zstd measurement.** The server's Brotli quality 11 and cache headers are reasonable production-like settings, but a real Vercel deployment may use different compression levels, caching defaults and billing counters. Brotli and gzip were measured; zstd was not.
- **Cache state is synthetic.** Persistent Playwright profiles were used to make warm visits realistic, but real browser cache eviction, private windows, storage pressure, enterprise policies and service-worker unregistering will move users toward the cold case.
- **Deploy updates were not measured.** The warm runs kept one build hash. With `autoUpdate` and hashed assets, a new deploy can cause returning users to download a new precache; the estimates assume no deploy during the measured month unless the deploy-churn add-on is applied.
- **Service-worker update checks vary.** Warm runs produced 0, 1 or 2 `sw.js` 304s (0–636 bytes). The report's warm estimate uses the conservative 0.000629 MB normal-session figure.
- **Synthetic solves.** Durations and scrambles are synthetic; network totals are independent of solve times. The 100-solve run used real timer input but 100 ms solve durations.
- **10,000-solve fixture is 1.70 MB of localStorage.** Real histories with long comments or unusually large scrambles may be larger locally, but they are not network traffic unless Drive sync is enabled.
- **30-minute long-session test.** An accelerated 65-second idle + 30-solve run was performed, plus a real 30-solve session configured at one solve per minute. The real run's measured window was 36.9 minutes because of solve/UI and settling overhead; it transferred 636 bytes of service-worker revalidation and zero solve data. Exact service-worker check counts can vary by browser scheduling.
- **Google Drive excluded.** No account, OAuth token or remote file was touched. Drive transfer is third-party traffic and its schedule was not measured.
- **No physical devices or network shaping.** Mobile results are Chromium emulation. Bytes are valid; latency, radio state and connection overhead are not measured.
- **Browser-internal traffic is outside scope.** The capture covers page, worker and service-worker requests to the CubeLab origin plus page-originated external requests. Chromium component updates, Safe Browsing and other browser-internal traffic were not treated as CubeLab bandwidth.
- **Vercel estimates are models.** The 100 GB figure is a reference assumption, not a statement about current provider limits. Provider billing may count edges, requests, cache hits or compressed bytes differently from client-observed response bytes.
- **No generated results are committed.** Raw JSON/log evidence lives under `/tmp/opencode/` for this run and is intentionally excluded from the repository.

---

## 10. Reproducing the benchmark

From the repository root:

```bash
npm ci
npm run build
npx playwright install chromium
```

Start the production-like server in one terminal:

```bash
node docs/hosting/benchmarks/serve-production.mjs \
  --port 4180 \
  --log /tmp/cubelab-server.jsonl
```

Run the benchmark in another:

```bash
node docs/hosting/benchmarks/benchmark.mjs \
  --base-url http://127.0.0.1:4180 \
  --server-log /tmp/cubelab-server.jsonl \
  --out /tmp/cubelab-bandwidth
```

The default action runs all scenarios. Use `--scenarios` to target a subset (for example `cold,warm,navigation`), `--keep-profiles` to retain disposable browser profiles, and `--encoding gzip` on the server plus `--label gzip` on the benchmark for the gzip comparison. The real long-session run is:

```bash
node docs/hosting/benchmarks/benchmark.mjs \
  --base-url http://127.0.0.1:4180 \
  --server-log /tmp/cubelab-server.jsonl \
  --out /tmp/cubelab-bandwidth-long \
  --scenarios long-session \
  --long-session-minutes 30
```

Benchmark scripts and fixtures:

- `docs/hosting/benchmarks/serve-production.mjs` — compression, cache headers, ETags and JSONL server log.
- `docs/hosting/benchmarks/benchmark.mjs` — Chromium/Playwright scenarios, CDP cache classification and report generation.
- `docs/hosting/benchmarks/fixtures.mjs` — deterministic schema-v7 synthetic histories.
- `docs/hosting/benchmarks/README.md` — short usage notes.

### Raw evidence from this run

These are disposable, machine-local files and are not committed:

- `/tmp/opencode/cubelab-run2/results.json` — cold/warm/reopen/hard/no-service-worker/navigation.
- `/tmp/opencode/cubelab-run-f/results.json` — 100 real solves.
- `/tmp/opencode/cubelab-run-gh/results.json` — 1,000 and 10,000 synthetic solves.
- `/tmp/opencode/cubelab-run-mobile-long/results.json` — mobile and accelerated long-session run.
- `/tmp/opencode/cubelab-run-gzip/results.json` — forced-gzip cold comparison.
- `/tmp/opencode/cubelab-run-long-real/results.json` — real 30-minute session.
