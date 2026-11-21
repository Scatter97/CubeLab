# Bandwidth benchmark harness

Reproducible measurement of the production CubeLab build. The full report is
[`../BANDWIDTH_BENCHMARK.md`](../BANDWIDTH_BENCHMARK.md).

The harness is deliberately separate from the application:

- It serves the real `dist/` output, not the Vite development server.
- It never edits application source or user data.
- It uses disposable Chromium profiles with deterministic synthetic histories.
- It does not touch Google Drive, DNS, production secrets or real accounts.
- Generated JSON/log output defaults to `/tmp/opencode/` and is not committed.

## Prerequisites

```bash
npm ci
npm run build
npx playwright install chromium
```

## 1. Serve production output

```bash
node docs/hosting/benchmarks/serve-production.mjs \
  --port 4180 \
  --log /tmp/cubelab-server.jsonl
```

The server binds to `127.0.0.1` only. It negotiates Brotli (quality 11) or gzip
(level 9), serves hashed assets as immutable, revalidates HTML/service-worker
files, and writes one JSONL record per HTTP response.

Options:

| Option | Meaning |
| --- | --- |
| `--port` | Local port. Default `4180`. |
| `--encoding br\|gzip\|identity` | Force an encoding for comparison. Default `br` preference. |
| `--root` | Static root. Default `dist/`. |
| `--log` | JSONL response log used for byte accounting. |
| `--quiet` | Suppress the startup asset summary. |
| `--host` | Bind address. Keep the default localhost for isolation. |

For the gzip comparison, start a second server:

```bash
node docs/hosting/benchmarks/serve-production.mjs \
  --port 4181 \
  --encoding gzip \
  --log /tmp/cubelab-gzip-server.jsonl
```

## 2. Run Chromium measurements

```bash
node docs/hosting/benchmarks/benchmark.mjs \
  --base-url http://127.0.0.1:4180 \
  --server-log /tmp/cubelab-server.jsonl \
  --out /tmp/cubelab-bandwidth
```

By default every scenario runs. Useful filters:

```bash
# Core cache/first-visit scenarios only
--scenarios cold,warm,reopen,hard,cold-nosw,warm-nosw,hard-nosw

# Page navigation
--scenarios navigation

# Solve counts
--scenarios solves-100,solves-1000,solves-10000

# Mobile
--scenarios mobile

# Accelerated long-session equivalent
--scenarios long-session

# Real 30-minute session, one solve per minute
--scenarios long-session --long-session-minutes 30
```

`--keep-profiles` retains the disposable Chromium profiles under the output
directory. Without it, profiles are deleted after the run while the JSON
evidence remains.

## Outputs

The benchmark writes:

- `results.json` — metadata, every measurement, server aggregates and page/CDP
  cache classification.
- `summary.json` — key totals in bytes and MB.
- `results.partial.json` — incremental checkpoint after each measurement.
- `performance-<scenario>.json` — browser PerformanceResourceTiming entries and
  navigation timing for each step.

Network totals are derived from the server's JSONL log, so a passing
`--server-log` path is required for meaningful byte measurements. The page-side
capture explains which resources were served by the HTTP cache or service
worker; those resources contribute zero network bytes.

## Scenario notes

- `A` uses a completely empty persistent profile, lets the service worker
  install, dismisses onboarding and waits for the timer.
- `A2` blocks service workers with a separate empty profile to get a
  foreground-only cold baseline.
- `B` closes the tab and reopens it in the same profile. `C` closes the whole
  context and relaunches the same persistent profile.
- `D` disables Chromium's HTTP cache and reloads while the service worker remains
  active. `D3` does the equivalent with service workers blocked.
- `E` visits Timer/Sessions, Settings, the local-data dialog, Analytics/Solves,
  Analytics/Algorithms and Training, then returns to Timer.
- `F` records 100 actual solves through Space-hold/stop input. `G` and `H` seed
  1,000 and 10,000 synthetic solves in isolated localStorage.
- `I` defaults to an accelerated 65-second idle + 30-solve stand-in. Passing
  `--long-session-minutes 30` performs a real one-solve-per-minute session;
  measured wall-clock duration includes solve/UI and settling overhead.
- `J` uses Playwright's Pixel 7 descriptor.

## Safety

The harness only writes inside the configured output/profile directory and the
server log path. It does not write to `src/`, `dist/` (except that `npm run build`
regenerates it), or any real browser profile. Do not point `--out` or
`--profile-root` at a directory containing user data.

See [the full report](../BANDWIDTH_BENCHMARK.md) for measured values,
assumptions and limitations.
