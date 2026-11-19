# Arch Linux development environment

**Last verified:** 2026-11-18
**Status:** Primary local development environment
**Scope:** Native Arch Linux with KDE Plasma on Wayland. CubeLab remains a
portable browser application; this guide documents the verified local setup, not
an exclusive platform requirement.

## Verified environment

| Component | Verified value |
| --- | --- |
| Distribution | Arch Linux rolling (`ID=arch`, `BUILD_ID=rolling`) |
| Kernel | `7.3.4-arch1-2` x86_64 |
| Desktop | KDE Plasma 6.8.3, KWin 6.8.3 |
| Display server | Wayland (`XDG_SESSION_TYPE=wayland`, `WAYLAND_DISPLAY=wayland-1`) |
| Init system | systemd 262 |
| Package manager | pacman 7.1.0; `yay` is present but not required |
| Shell / terminal | bash; Konsole |
| Node.js | 26.13.1 from the official `nodejs` package (`/usr/bin/node`) |
| npm | 12.2.2 from the official `npm` package |
| Browser tests | Playwright 1.64.1; Chrome for Testing 156.0.8078.4 and Chromium headless shell |
| GPU / graphics | Intel Arc Graphics 130V/140V (`xe` driver), Mesa 26.2.7 |
| Audio | PipeWire 1.6.11, WirePlumber, PipeWire Pulse |

The locked Vite, Vitest and jsdom toolchain requires Node.js 22.22.2+ in the
22.x line, 24.15+, or 26+. The audit used Node 26.13.1. The official
`nodejs-lts-jod` package currently provides 22.23.5 and also satisfies the
range; install it **or** `nodejs`, not both. Older project notes that require
`~/.nvm/versions/node/v22.23.2` are historical: that path is not present on this
machine and nvm is not required.

## Prerequisites

The repository needs only official Arch packages. No AUR package is required
for the verified Chromium path. Firefox/WebKit fallback builds may expect older
library sonames that are not in the official repositories; see
[Browser checks on Arch](#browser-checks-on-arch).

```bash
sudo pacman -S --needed base-devel git nodejs npm
```

`npm` is a separate Arch package from `nodejs`. Installing only `nodejs` leaves
the repository without `npm`, `npx`, or the documented verification commands.
If you prefer the 22.x LTS line, install `nodejs-lts-jod` instead of `nodejs`;
the two packages conflict, and `npm` is satisfied by either provider.

Optional desktop packages already provided by a normal KDE Plasma installation:

| Package | Purpose |
| --- | --- |
| `plasma-desktop`, `konsole` | Desktop and terminal |
| `xdg-desktop-portal`, `xdg-desktop-portal-kde` | KDE file dialogs and portal integration |
| `xorg-xwayland` | Headed Chromium launched through XWayland on a Wayland session |
| `pipewire`, `pipewire-pulse`, `wireplumber` | Desktop audio for alerts and headed browser checks |
| `vulkan-intel` | Intel GPU acceleration for 3D views when available |
| `xorg-server-xvfb` | Optional virtual X server for headed checks that cannot use the desktop display |

## Install dependencies

From the repository root:

```bash
npm ci
```

Use `npm ci` for a clean, lockfile-reproducible checkout. Use `npm install` only
when intentionally adding or updating dependencies; dependency changes require
project approval.

The application itself is a static Vite build. There is no system service,
database, container, or backend to configure.

## Dependency management

- `package-lock.json` is the reproducible dependency record. Use `npm ci` for
  routine setup and verification.
- Do not add or upgrade dependencies without project approval. When a change is
  approved, use `npm install` so the lockfile is updated deliberately, then run
  the affected checks and production build.
- Audit production and development trees separately:
  `npm audit --omit=dev` and `npm audit`. The current development-only advisory
  set is recorded in [KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md); do not
  apply a forced upgrade that breaks the PWA without reviewing the pipeline.
- `package.json` records the Node engine intersection required by the locked
  Vite, Vitest and jsdom versions. Do not lower it without rechecking those
  packages.

## Run and build

```bash
npm run dev       # Vite development server
npm run build     # TypeScript project build + production PWA
npm run preview   # Serve the production build
```

Open the URL printed by Vite. The production build emits `dist/`, a Workbox
service worker, and the web app manifest. Development-server behavior does not
prove offline PWA behavior; use the production build for that check.

## Debugging

- **Application/HMR:** `npm run dev` serves the app with Vite HMR. Use the
  Chromium DevTools console and the React component tree; source maps are
  enabled by default in development.
- **Playwright failures:** the config retains a trace on failure under
  `test-results/`. Open it with
  `npx playwright show-trace test-results/<case>/trace.zip`. Use
  `DEBUG=pw:api` for protocol-level logs and `--debug` for the Playwright
  Inspector; headed inspector runs depend on the desktop session and were not
  exercised under KDE Wayland in this audit.
- **PWA/service worker:** build and preview before testing offline behavior.
  The dev server does not prove service-worker caching. Use DevTools →
  Application → Service Workers/Cache Storage against `npm run preview`.
- **Google Drive UI:** `VITE_DRIVE_MOCK=true npm run dev` enables the mock
  transport for UI checks. Never use real solve history for destructive or
  conflict tests.
- **Wayland/KDE session state:** inspect `XDG_SESSION_TYPE`, `WAYLAND_DISPLAY`,
  `DISPLAY` and `loginctl show-session "$XDG_SESSION_ID" -p Type`; use
  `journalctl --user -b` for compositor/portal errors. Do not change the desktop
  session or install an X11 replacement merely to make a headless test pass.
- **Font/layout differences:** pin the browser build, viewport, device scale
  factor and interface zoom. KDE fractional scaling affects headed windows;
  headless fixed-viewport runs remain the reference for automated checks.

## Static and unit checks

```bash
npm run typecheck
npm run lint
npm test
```

`npm run lint` currently reports pre-existing warnings in archived evidence
scripts and React Compiler ref/purity checks in `App.tsx` and `SessionPanel.tsx`.
Treat new warnings as regressions; the existing warning set is recorded in
[STATUS.md](../../STATUS.md).

## Browser checks on Arch

Playwright browsers are not installed by `npm ci`. Install the Chromium build and
its headless shell once per Playwright version:

```bash
npx playwright install chromium
```

If the headless shell is missing after an interrupted download:

```bash
npx playwright install chromium-headless-shell
```

Playwright reports `BEWARE: your OS is not officially supported` on Arch and
downloads its Ubuntu 24.04 fallback build. That is expected. The fallback build
passed the focused Chromium checks recorded below, but it is not a claim of
official Playwright support for Arch. Pin Playwright through the lockfile and
report the exact browser version when recording results.

Do **not** run `npx playwright install-deps` or `npx playwright install
--with-deps` on Arch. Both assume Debian/Ubuntu packaging and invoke `apt-get`;
`install-deps --dry-run` also invokes `apt-get` and is not an Arch dry run.
Install the shared libraries from official Arch packages instead:

```bash
sudo pacman -S --needed \
  nss libx11 libxcb libxcomposite libxdamage libxext libxfixes libxrandr \
  libxkbcommon at-spi2-core gtk3 pango cairo alsa-lib libcups nspr expat \
  dbus libdrm mesa fontconfig
```

`mesa` provides `libgbm`; there is no separate Arch `libgbm` package.
Playwright downloads and uses its own FFmpeg binary for video capture, not the
system `ffmpeg` package. The repository's normal trace/screenshot configuration
does not require video capture.

Focused browser run:

```bash
npm run test:e2e -- e2e/onboarding.spec.ts --project=chromium --workers=4
```

The Playwright server command builds with mock Drive and starts
`127.0.0.1:4173`. After a mock-Drive browser run, restore ordinary production
output with:

```bash
npm run build
```

Firefox and WebKit are additional Playwright projects. `npm run test:e2e` and
`npm run check` select all three projects by default, so a Chromium-only Arch
install fails those commands at the Firefox/WebKit stage. Always pass a focused
`--project=...` for routine Arch runs, or install the other engines.

```bash
npx playwright install firefox webkit
```

Firefox 157 launched normally and passed the same 15 focused
onboarding/accessibility cases as Chromium. WebKit 27.2 required compatibility
libraries:

- official Arch `libxml2-legacy` (provides `libxml2.so.2`) and `flite`;
- ICU 74, available as AUR `icu74`, because the Ubuntu 24.04 WebKit fallback
  expects `libicu*.so.74` while rolling Arch ships ICU 78.

```bash
sudo pacman -S --needed libxml2-legacy flite
yay -S icu74
```

These are compatibility libraries for Playwright's fallback WebKit build, not
CubeLab runtime dependencies. Prefer the official packages; install the AUR
package only if you deliberately need WebKit validation.

With those libraries available, the focused WebKit suite passed 15/15; the
dated audit used isolated extracted libraries in the Playwright WebKit bundle
and `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` because system package
authentication was unavailable. That skip is evidence-only, not a general
recommendation. WebKit may also expect older libvpx/libavcodec sonames in
broader flows. For a full three-engine matrix, use a Debian/Ubuntu VM or
Playwright's official Docker image; neither Docker nor Podman is installed on
the verified machine.

## KDE Plasma and Wayland notes

- **Headless tests do not need a display server.** Playwright launches the
  Chromium headless shell directly. A Wayland or X11 session is not a
  prerequisite for focused browser validation.
- **Headed Chromium is verified on a nested KDE Wayland display.** Chromium 156
  rendered the real timer at 1360×860 using `kwin_wayland --virtual` with
  `--ozone-platform=wayland`. This validates the headed Wayland path without
  taking over the user's desktop. Clipboard, portals, audio and physical input
  still require deliberate manual checks.
- **Do not force the Ozone Wayland backend for routine checks.** Adding
  `--ozone-platform=wayland` changes compositor behavior and can change window
  geometry. Use it only for a deliberate Wayland-specific investigation, and do
  not treat the result as equivalent to the default headless run.
- **Fractional scaling affects headed windows, not fixed test viewports.** KDE
  display scaling can change a headed window's physical size. The Playwright
  suite sets explicit viewport sizes; screenshot comparisons should still use a
  pinned scale and browser version.
- **Portals are not required for most tests.** Playwright sets input files
  directly and grants Chromium clipboard permissions. KDE portal dialogs are
  relevant to manual file-picker, screen-sharing, or desktop-integration checks,
  not the normal unit or timer flows.
- **GPU rendering differs between headless and headed runs.** The machine uses
  Mesa on Intel Arc graphics. Headless Chromium may use a software path. A
  non-zero 3D canvas or a passing DOM assertion does not establish physical GPU
  performance or pixel correctness on every device.
- **Audio and haptics need physical verification.** PipeWire is present for
  desktop audio, but automated checks do not establish audible output, haptic
  feedback, or physical keyboard/pointer latency.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `npm: command not found` | `sudo pacman -S --needed npm` |
| `node: command not found` | `sudo pacman -S --needed nodejs` |
| Wrong Node version from an old shell profile | Check `command -v node` and `node --version`; remove stale nvm/PATH entries if they shadow `/usr/bin/node` |
| `Executable doesn't exist ... chrome-headless-shell` | `npx playwright install chromium` or `npx playwright install chromium-headless-shell` |
| `BEWARE: your OS is not officially supported` | Expected on Arch; use the fallback build and report the version |
| Missing `lib*.so` at browser launch | Inspect with `ldd <chrome-binary> \| grep 'not found'`; install the owning official package |
| FFmpeg download fails | Retry the install; ordinary traces/screenshots do not require video capture |
| Headed browser cannot connect to a display | Confirm `XDG_SESSION_TYPE`/`WAYLAND_DISPLAY`; keep `xorg-xwayland` installed; run as your normal user, not root |
| Chromium sandbox error | Run as a normal user; use `--no-sandbox` only in a disposable container, never as the normal local workaround |
| Fonts or screenshots differ | Keep the pinned browser and scale; `system-ui` resolves to Noto Sans on this KDE host, and `ttf-liberation` is optional for Arial-metric fallback. Run geometry-heavy specs rather than adopting host-specific tolerances |

## Verification record

The following checks were run on the verified environment on 2026-11-18:

| Command | Result |
| --- | --- |
| `npm ci` | 445 packages installed from the lockfile |
| `npm audit --omit=dev` / `npm audit` | 0 production advisories; four development-only moderate advisories |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with the existing warnings described above |
| `npm test` | 103 files, 1,341 executed tests (1,216 named definitions; parameterized cases expand) |
| `npm run build` | Passed; PWA generated 78 precache entries; existing chunk-size warning retained |
| Chromium onboarding/accessibility | 15/15 passed |
| Firefox onboarding/accessibility | 15/15 passed |
| WebKit onboarding/accessibility with compatibility libraries | 15/15 passed |
| Chromium installed-app offline case | 1/1 passed |
| Headed Chromium on nested KWin Wayland, 1360×860 | Real timer rendered and captured |
| `node scripts/training/generate-diagrams.mjs --all --check` | 78 SVGs and the complete contact sheet verified |
| `npm run build` after the mock-Drive browser run | Passed; ordinary production output restored |

Not run in this pass: the full Playwright suite, Firefox, WebKit, live Google
Drive, physical touch/keyboard/audio hardware, screen readers, and the
7,000–10,000-solve profiling matrix. See
[KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md) for the project-wide boundaries.

## Other platforms

The commands in this guide use npm and Playwright directly and remain portable
across Linux and macOS. Several examples use POSIX environment prefixes
(`VITE_DRIVE_MOCK=true ...`, `PLAYWRIGHT_WORKERS=4 ...`) and `/tmp` evidence
paths; Windows contributors should use WSL/Git Bash or adapt those commands with
PowerShell/`cross-env` and platform-appropriate temporary paths. Do not replace
portable repository commands with Arch-only wrappers merely because Arch is the
current primary local environment.

For the required verification tiers and destructive-path coverage, see
[AGENTS.md](../../AGENTS.md). For product behavior and setup, see
[README.md](../../README.md).
