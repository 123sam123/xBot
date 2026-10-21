# xBot architecture and conventions

This is the contract every xBot ticket builds against. T1 (XBOT-O61LM8) wrote
it along with the scaffold; T2–T10 work in parallel on top of it. If you need
to break a rule here, change this file in the same PR and say why.

The product brief is [`SPEC.md`](SPEC.md); the measured visual notes are in
[`reference/`](reference/).

## Stack

| Piece | Version | Notes |
|---|---|---|
| Electron | 45.0.0 | Fallback pin if 45 regresses: `electron@44.9.1`. |
| electron-vite / Vite | 6.0 / 8.3 | Rolldown-based. Fallback: electron-vite 5 + Vite 7. |
| React | 19.3 | Renderer only. |
| TypeScript | 6.0.3 | Not 7.x: typescript-eslint 8.72 needs `<6.1`. |
| zod | 4.6 | Bundled into main; never loaded by the preload. |
| better-sqlite3 | 13.0.3 | Ships N-API prebuilds for every platform inside the package, so nothing is rebuilt for Electron. |
| Vitest / Playwright | 5.0 / 1.64 | Unit tests / Electron smoke test. |
| electron-builder | 26.15.3 | Packaging. |
| pnpm | 11.28.6 | Pinned with `packageManager`. Node ≥ 22.12. |

## Layout

```
src/
  main/                      Electron main process (Node)
    index.ts                 entry: userData, single-instance lock, schemes, sandbox
    app.ts                   everything after app.whenReady(), in order
    paths.ts  log.ts  events.ts  menu.ts  tray.ts  security.ts
    windows/                 common.ts (secure prefs, loader, registry), position.ts,
                             composer.ts, studio.ts, hold.ts
    ipc/                     core.ts (pure), register.ts (handle()), index.ts, <domain>.ts
    protocols/media.ts       xbot-media://
    db/                      index.ts, migrate.ts, migrations/*.sql
    services/                index.ts, types.ts, <domain>/index.ts
  preload/                   index.ts (window.xbot), invoke.ts, api/<domain>.ts
  shared/contracts/          <domain>.ts, <domain>.channels.ts, ipc.ts, define.ts,
                             bridge.ts, events.ts, settings.ts (aggregators)
  renderer/
    design-system/           tokens, glass material, shared components (see "Design system")
    common/                  base.css, CompositionPreview, hooks shared by both pages
    preview/                 preview mode's fixed sample content
    composer/, studio/       one Vite page each
resources/                   tray.svg → trayTemplate.png / @2x (pnpm icons)
  fixtures/                  preview mode's sample media (pnpm fixtures)
scripts/                     capture-ui.ts (pnpm capture), render-fixtures.ts, capture-stage.cjs,
                             fixtures/*.html (the fixtures' sources), render-icons.mjs
tests/unit/  tests/e2e/
docs/                        SPEC.md, ARCHITECTURE.md, reference/ (+ captures/)
```

## Process boundaries

- **Main** (`src/main`): tray, windows, persistence, file operations, Ollama,
  FFmpeg, X: everything with side effects.
- **Preload** (`src/preload`): sandboxed and context-isolated. It exposes one
  frozen `window.xbot` object and nothing else: no raw `ipcRenderer`, no Node.
  It imports only **types** plus the zod-free `*.channels.ts` files from the
  contracts, because a sandboxed preload cannot `require()` packages.
- **Renderer** (`src/renderer`): UI and interactive preview. It reaches main only
  through `window.xbot`.
- **Shared** (`src/shared`): schemas, typed contracts and (later) composition
  geometry. It uses no `electron` and no Node built-ins, so it runs on either side.

ESLint enforces all of this. `electron` and Node built-ins are banned in the
renderer and shared code. In the preload, `zod` and value imports from contract
files are banned.

## One domain, one set of files

Every feature domain owns these files. They already exist as stubs, already
imported by every aggregator, so **a sibling ticket edits only its own files**:

| File | Holds |
|---|---|
| `src/shared/contracts/<domain>.channels.ts` | `<domain>Channels`: `'<domain>:<verb>'` strings (zod-free) |
| `src/shared/contracts/<domain>.ts` | zod payload schemas, `<domain>Settings`, `<Domain>Events`, `<domain>ForwardedEvents`, `<Domain>Api` |
| `src/main/ipc/<domain>.ts` | `register<Domain>Ipc()`, with `handle(channel, schema, fn)` calls |
| `src/preload/api/<domain>.ts` | the `<Domain>Api` implementation, using `invoke()` |
| `src/main/services/<domain>/` | `<domain>Module: ServiceModule` (`init(ctx)`, `dispose()`) plus the logic |
| `src/main/db/migrations/<YYYYMMDDHHmm>_<domain>_<slug>.sql` | that domain's schema changes |

| Domain | Owner |
|---|---|
| `app`, `windows`, `settings`, `events` | T1 (XBOT-O61LM8), the scaffold |
| renderer design system, both surfaces | T2 (XBOT-6AU4BQ) |
| `drafts`, `media` | T3 (XBOT-6F4GAC) |
| `studio` | T4 (XBOT-1N58PP) images; T5 (XBOT-G66JJK) video |
| `ai` | T6 (XBOT-4BCGOR) |
| `projects` | T7 (XBOT-5UVE6R) |
| `reminders` (+ launch at login, global shortcut) | T8 (XBOT-8V5WV5) |
| `x` | T9 (XBOT-OE2XV9) |
| `backup` (+ README, preview mode fixtures, packaging) | T10 (XBOT-1DDYA1). T2 created `src/renderer/preview/` and `resources/fixtures/`; T10 extends them. |

Shared files that several tickets may still touch, so coordinate:
- `package.json` / `pnpm-lock.yaml`, for new dependencies (see below);
- the renderer pages, which T2 restructures (others add to what T2 builds);
- `tray.ts` (T8 adds reminder state), and `windows/composer.ts` (T8 adds a
  `showInactive()` variant for auto-open).

### Adding a call, end to end

```ts
// shared/contracts/drafts.channels.ts
export const draftsChannels = { save: 'drafts:save' } as const;

// shared/contracts/drafts.ts
export const saveDraftSchema = z.strictObject({ id: z.uuid(), text: z.string().max(25_000) });
export interface DraftsApi { save(draft: z.infer<typeof saveDraftSchema>): Promise<IpcResult<null>> }

// main/ipc/drafts.ts
export function registerDraftsIpc(): void {
  handle(draftsChannels.save, saveDraftSchema, (draft) => { drafts().save(draft); return null; });
}

// preload/api/drafts.ts — import the schema's *type* only
export const drafts: DraftsApi = { save: (draft) => invoke(draftsChannels.save, draft) };

// renderer
const result = await window.xbot.drafts.save(draft);
if (!result.ok) showError(result.error);
```

## IPC

- Every renderer → main call is `ipcMain.handle`, registered through
  `handle(channel, schema, fn)` in `src/main/ipc/register.ts`. Never call
  `ipcMain.handle` / `ipcMain.on` directly.
- `handle` checks the **sender** first. It must be the top frame of a known xBot
  window, showing an xBot page: the Vite dev-server origin under `pnpm dev`, or
  a `file:` URL inside `out/renderer` otherwise. Only then does it parse the
  payload with the zod schema, using strict objects.
- Every call resolves to an `IpcResult<T>` envelope:
  `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Codes:
  `forbidden_sender`, `invalid_payload`, `internal`, or any domain code thrown as
  `new IpcError('ollama_unavailable', '…')`. Errors are logged, never thrown
  across IPC, and the bridge returns the envelope unchanged.
- Payloads carry data, not paths the renderer made up. Main decides where files
  live.
- Main → renderer pushes go only through `broadcast(name, payload)` on the single
  `xbot:event` channel. The renderer subscribes with
  `window.xbot.events.on(name, cb)`, which returns an unsubscribe function and
  passes only the payload (never the `IpcRendererEvent`).

## Events

`appEvents` (`src/main/events.ts`) is a typed `EventEmitter` from `node:events`.
Its event map is merged from every domain's `<Domain>Events` interface:
`draft:changed`, `post:published`, `export:progress`, `settings:changed` and
`ui:open-settings` exist today. An event listed in a domain's
`<domain>ForwardedEvents` is forwarded to every window automatically.

## Settings

- Declare a key in your domain contract:
  `'reminders.intervalMinutes': defineSetting(z.number().int().min(5).max(240), 30)`.
  Keys are `<domain>.<name>`.
- `settings().get(key)`, `getAll()` and `set(key, value)` live in main
  (`services/settings`). `set` validates, upserts and emits `settings:changed`.
- The renderer uses `window.xbot.settings.getAll()` and `.set(key, value)`. The
  IPC schema accepts only `{ key, value }` pairs where `value` matches that key's
  own schema.
- A stored value that no longer matches its schema reads as the default, and a
  warning is logged.

## Database

- One SQLite file, `userData/xbot.db`, opened with better-sqlite3 using
  `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000` and
  `synchronous=NORMAL`.
- **Migrations** are `src/main/db/migrations/<YYYYMMDDHHmm>_<domain>_<slug>.sql`.
  They are embedded into the main bundle at build time, so nothing is read from
  disk at runtime. The rules:
  - One file per change. Never edit a migration after it has merged; add a new one.
  - A migration is pending when its id is **missing** from `schema_migrations`,
    not when it is newer than the last one, because branches merge out of
    timestamp order. Write migrations that do not depend on a sibling's
    migration running first, unless you name it in a comment.
  - All pending migrations run in **one transaction**, in filename order. Any
    error rolls the whole batch back, and the app shows a dialog and quits
    without touching the file.
  - The batch runs with `foreign_keys` **off**, so a table rebuild's `DROP`
    cannot cascade-delete child rows. `PRAGMA foreign_key_check` must come back
    empty before `COMMIT`, and the pragma is switched back on afterwards.
    Rebuild a table in SQLite's documented order: create `new_X`, copy rows,
    drop `X`, rename `new_X` to `X`, recreate its indexes.
  - Do not put `BEGIN`, `COMMIT` or `PRAGMA foreign_keys` inside a migration file.
  - Ids that are in the database but not in the build (for example from a newer
    branch) are logged and ignored.
- Modules under `db/` import no `electron`, so Vitest can load them.
- Store multi-row writes in one `db.transaction(...)` (atomic draft updates).

## userData and modes

| Mode | userData |
|---|---|
| Packaged app | `~/Library/Application Support/xBot` |
| `pnpm dev`, e2e, any unpackaged run | `~/Library/Application Support/xBot Dev`, so branch migrations never touch real data |
| `--preview` or `XBOT_PREVIEW=1` | `~/Library/Application Support/xBot Preview` |
| `XBOT_USER_DATA_DIR=<dir>` | `<dir>`, honoured only when unpackaged (tests) |

Inside it: `xbot.db`, `media/` (served by `xbot-media://`), `exports/`,
`logs/main.log` (plain append-only log, no telemetry) and `tmp/`. `tmp/` is
emptied at startup when the folder is provably xBot's, meaning it holds
`xbot.db` or this run created it. Never write into the repository or next to
the app bundle.

## Startup order

Defined by `src/main/index.ts` and `src/main/app.ts`:

1. Resolve userData and call `app.setPath('userData')`. This must come first,
   because the single-instance lock is per userData.
2. Call `app.requestSingleInstanceLock()`; a losing instance quits.
3. Prepare the userData layout and open the log.
4. `protocol.registerSchemesAsPrivileged` (`xbot-media`), then `app.enableSandbox()`.
5. `app.whenReady()`, then:
   1. hide the Dock icon;
   2. open the DB and migrate it;
   3. `initServices()`;
   4. install the security handlers;
   5. `protocol.handle`;
   6. `registerIpc()`;
   7. forward events to the renderers;
   8. `applyAppearance()` (`XBOT_APPEARANCE`), then create both windows, hidden;
   9. create the tray and the app menu;
   10. attach the lifecycle handlers;
   11. log `xBot ready`.

`second-instance` (another launch) and macOS `activate` (reopened from Finder)
both toggle the composer. `before-quit` marks the app as quitting, and only then
do windows really close. `will-quit` disposes services and closes the DB.
`window-all-closed` is ignored, since a menu-bar app runs without windows.

## Windows, tray and menu

- **Composer** (`windows/composer.ts`):
  - It is 420 px wide and starts 635 px tall. It is frameless, non-resizable,
    `skipTaskbar`, and `setAlwaysOnTop(true, 'pop-up-menu')`; on macOS it is
    `type: 'panel'` and hidden in Mission Control.
  - Placement is the pure `computeComposerBounds()` (`windows/position.ts`). It
    centres the window under the tray icon, or under the cursor where the tray
    reports no bounds (Linux), places it just below the menu bar and never above
    the work area, clamps it into the work area of the display nearest the icon,
    shrinks it to fit, and rounds to whole pixels.
  - **Height follows the content.** A `ResizeObserver` in the renderer calls
    `window.xbot.windows.resizeComposer(height)`, and calls it again on
    `visibilitychange`. Main re-clamps the height, so no empty region ever shows
    below the panel. Keep the root element's height equal to the visible content.
  - Show is position, then `show()`, then `focus()`. T8's automatic open must use
    `showInactive()` instead, so the composer never steals focus.
  - **Hide on Escape:** a window-level `keydown` listener (`useEscapeToHide`)
    calls `windows.hide()`. Popovers and sheets that handle Escape themselves
    call `event.preventDefault()` first.
  - **Hide on blur**, except:
    - while the window is **held**: `window.xbot.windows.hold()` / `release()`
      around internal popovers, and `withHold(win, fn)` (`windows/hold.ts`) around
      every main-side `dialog.*` call (file pickers). `withHold` also drops the
      always-on-top level while the dialog is up. The count is per webContents
      and resets on hide and on reload;
    - while DevTools are open (unpackaged).
  - A tray click within 250 ms of a blur-hide is ignored, because it is the click
    that caused the blur.
  - **Fallback** if `type: 'panel'` breaks first-show keyboard focus on a macOS
    version: drop `panel`, use
    `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, and call
    `app.focus({ steal: true })` before `show()`.
- **Studio** (`windows/studio.ts`):
  - It is 790×635 (minimum 720×560), resizable and frameless. The first time it
    opens, it is centred on the display under the cursor.
  - Its top bar has `-webkit-app-region: drag`, and the buttons in it have
    `no-drag`.
  - "Back to post" hides the Studio and shows the composer.
- **Both windows** are created hidden at startup and never destroyed:
  - `close` hides the window unless the app is quitting;
  - a crashed renderer reloads, at most 3 times a minute.
- **Tray** (`tray.ts`):
  - The icon is a template image, so macOS tints it for light and dark menu bars.
    `resources/tray.svg` is rendered by `pnpm icons` to 18×18 and 36×36 PNGs,
    which ship via `extraResources`.
  - Left-click toggles the composer.
  - Right-click shows a menu that is rebuilt on every open: Write Post / Open
    Media Studio / Pause reminders (bound to `reminders.paused`) / Settings… (shows
    the composer and emits `ui:open-settings`) / Quit.
  - On Linux the menu uses `setContextMenu`.
- **App menu** (`menu.ts`) is invisible in a menu-bar app, but its shortcuts
  still work:
  - Edit roles make Cmd+C/V/X/A/Z work;
  - Window → Close makes Cmd+W hide the focused window;
  - Reload and DevTools exist only when unpackaged.
  - Never call `Menu.setApplicationMenu(null)`.

## Native material (spike results)

The brief asks for clear liquid glass using native backdrop effects where they
are supported. This is what Electron 45 offers. **None of it has been observed
on macOS yet**: T1 was built on a Linux machine.

- **Options available:**
  - `vibrancy`: `popover`, `hud`, `under-window` or `fullscreen-ui`, plus
    `titlebar`, `menu`, `sidebar`, `sheet`, `window`, `tooltip`, `content` and
    `under-page`;
  - `visualEffectState: 'active'`, so the material does not dim while the
    window is unfocused;
  - `backgroundColor: '#00000000'`;
  - `roundedCorners`.
- **How the shell uses them:** `materialOptions()` in `windows/common.ts` reads
  `XBOT_VIBRANCY` at startup. Compare the candidates with
  `XBOT_VIBRANCY=hud pnpm dev` (or `popover`, `under-window`, `fullscreen-ui`,
  `none`). The default is `under-window`. These are the NSVisualEffectView
  materials (popover, HUD window, under-window background, full-screen UI); by
  Apple's description, `under-window` is the lightest behind-window blend and
  `hud` the darkest. Pick from captures, not from names.
- **Shadow:** a vibrancy window keeps the native window shadow. A `transparent:
  true` window (`XBOT_VIBRANCY=none`) loses it, and its glass can only be faked
  in CSS, because `backdrop-filter` cannot blur the desktop behind a native
  window.
- **Corners are the known gap.**
  - The material fills the whole window rectangle. A frameless window with
    `roundedCorners: true` gets the system corner radius (about 10 px), and
    Electron has no option to set the radius of the vibrancy view.
  - CSS `border-radius` only clips web content, not the native material.
  - The reference panels have corners of about 40 px.
  - T2's options:
    - accept the system radius;
    - add a tiny native addon that sets `NSVisualEffectView.maskImage` to a
      40 px rounded-rect image (public AppKit API, available since macOS 10.10);
    - or use `none` with CSS-only glass.

  The addon is allowed only if captures show the system radius clearly cannot
  match.
- **Rejected:** NSGlassEffectView exists only on macOS 26, and the human's Mac
  runs 15.5. `electron-liquid-glass` relies on private API.
- **T2's outcome** (still not observed on macOS: T2 also ran on Linux):
  - The default stays `under-window`. Each page is told what it draws over through
    `?material=vibrancy|css` (`rendererMaterial()` in `windows/common.ts`, used
    by `loadPage`). Over `vibrancy` the page adds only translucent, neutral
    layers; over `css` it paints its own neutral graphite base.
    `XBOT_MATERIAL=vibrancy|css` overrides what the page is told, in unpackaged
    runs only: `pnpm capture` uses it to draw the macOS layers on Linux's
    transparent window.
  - `XBOT_APPEARANCE=dark|system` (default `dark`) sets `nativeTheme.themeSource`
    at startup. xBot's text is white, and the light `under-window` material
    under it is the rejected milky-silver look. `themeSource` is app-wide, so
    the tray menu and native dialogs (T3's file pickers) are dark too.
  - Corners: under vibrancy the CSS window radius is the system radius
    (`--radius-window-native`, 10 px; tune it from a Mac capture), so the
    rim follows the native silhouette instead of drawing a 40 px curve inside a
    10 px one. The CSS path keeps 40 px. The `maskImage` addon is the follow-up
    if Mac captures show the system radius is too far from the reference; it
    was not built because it could not be compiled or observed here.
  - Run `pnpm capture --desktop` on a Mac for real captures over four
    wallpapers, per material (`XBOT_CAPTURE_MATERIALS`, default
    `under-window,hud,none`). It needs Screen Recording permission for the
    terminal.

## Design system

T2 (XBOT-6AU4BQ) built it. It is the only source of look-and-feel. Build new
UI from these pieces instead of adding page-local styles that restate them.

### Material and modes

- `design-system/tokens.css` holds every colour, radius, type size, scrim and
  shadow. `glass.css` holds the material:
  - `.glass-panel`, the window shell: neutral tint, scrim, refractive
    highlights, an inner bevel and a 1 px gradient specular rim drawn with
    `mask-composite`;
  - `.glass-card`, lighter inner glass for text-bearing cards;
  - `.glass-float`, popovers and the Studio toolbar.
- Modes are attributes on `<html>`; either source turns a mode on:

  | Attribute | Set by | Also on with |
  |---|---|---|
  | `data-material="vibrancy"\|"css"` | `applyMaterialFromLocation()`, before the first render | — |
  | `data-reduce-transparency="on"` | `useAppearance`, from `ui.reduceTransparency` | `prefers-reduced-transparency: reduce` |
  | `data-contrast="more"` | `useAppearance`, from `ui.increaseContrast` | `prefers-contrast: more` |

  Settings arrive through the forwarded `settings:changed` event and media
  queries update live, so both switch without a reload. Reduced transparency
  is opaque graphite (`#2b2d31`), never navy.
- **Scrim.** "Adaptive" means it follows the material, the settings and the OS
  preferences. The renderer cannot sample the wallpaper. Defaults keep editor
  text at 3:1 or better over a light wallpaper under an approximate dark
  native tint; Increase contrast keeps it at 4.5:1 or better with no tint at
  all. `pnpm capture` gates both.
- `backdrop-filter` only blurs in-window content (popovers and the toolbar
  over the canvas). It never applies to text, icons or media.
- Each page's root sets `<html data-ready>` once app info and settings have
  loaded. Captures and tests wait for it.

### Components (`design-system/index.ts`)

Prop changes are additive only; siblings build against these.

- `GlassPanel`, `GlassCard`, `Divider({ vertical? })`, `StatusChip({ tone? })`.
- `FrostedButton`, `GhostButton` and `IconButton({ label, size?, bare? })`.
  `disabled` renders `aria-disabled` and stays focusable, so a `Tooltip` can say
  why. Wrap a disabled control in `Tooltip({ label })`; the label is also its
  accessible description.
- `Popover({ id, anchor, placement?, offset?, crossOffset?, label, role?, testId? })`
  and `Menu({ id, anchor, label, items: { id, label, detail?, disabled?, checked?, onSelect? }[] })`:
  - they render into `document.body` with `position: fixed`, so opening one
    never moves the page (the Studio canvas keeps its rect);
  - one per window is open at a time (`popovers`, a React-free store; open
    with `popovers.open(id)`, `.toggle(id)`, `.closeAll()`);
  - placement is clamped 8 px inside the window and redone on resize;
  - Escape and an outside click close them, and focus returns to the anchor.
- `Sheet({ open, title, onClose })` covers its positioned parent (the panel)
  without changing the window size.
- Escape goes through `useEscapeLayer(active, onEscape)`: the top-most layer
  closes first and the event is marked handled, so `useEscapeToHide` only
  hides the window when nothing is open.
- `Slider` (`<input type="range">`), `SwatchGroup`, `Segmented` (radiogroups),
  `Toggle` (`role="switch"`), and the inline SVG icons in `icons.tsx`.
- The composer holds its window (`windows.hold()`) while any popover is open,
  and closes every popover when it hides (main resets the hold then).

### Surfaces and their props

- **Composer** (`composer/`):
  - `ComposerHeader` and `AccountMenu({ account: { kind: 'disconnected' } | { kind: 'connected' | 'preview', handle } })`;
  - `PostEditor({ value, onChange })`, with no `maxLength`; the counter shows the
    over-limit state. The count is code points until T9 adds X's weighting;
  - `AttachmentList({ attachments, onRemove(id), onReorder(from, to), onEditInStudio(id) })`;
  - `UploadZone({ onAdd?, disabledReason? })`;
  - `ActionRow({ count, limit, canPost, postDisabledReason?, onPost, notice? })`;
  - `ReminderRow({ label, muted?, onClick? })`;
  - `SettingsSheet`, which holds the Appearance toggles; T3 adds its sections.

  The draft is local state in `composer/App.tsx` until T3.
- **Studio** (`studio/`):
  - `StudioTopBar`;
  - `StudioToolbar({ items, active, onSelect })`;
  - `ToolPopovers` (Background, Frame, Padding, Shadow, Crop);
  - `Timeline({ duration, current, trim, frames, playing, onTogglePlay })`;
  - `StudioFooter({ dimensions, fit, zoom, onFit?, onZoom? })`.
- `common/CompositionPreview({ composition, source, zoom? })` draws a
  composition as DOM (only the media is an image) at any size, using container
  query units. `common/previewComposition.ts` is a placeholder model; T4
  replaces it with the shared composition model.
- **Honest states.** In normal mode the header reads "Connect X", Post is
  disabled ("Connect X to post"), the upload zone and the Studio tools are
  inert with a tooltip, and the reminder row says reminders aren't set up. The
  sample handle and media exist only in preview mode, labelled "Preview".

### Visual verification

`pnpm capture` writes to `test-results/captures/` and copies the comparisons
the PR carries to `docs/reference/captures/`. It exits non-zero on any failed
assertion. Its limits:
- Linux captures use Inter, so text runs a little wider than SF Pro.
- The behind-window blur and the native tint are simulated (blur 24 px,
  saturate 1.3, with and without an approximate dark tint). Only
  `pnpm capture --desktop` on a Mac shows the real material.

## Security rules

- **Web preferences:** every window uses `secureWebPreferences()`:
  `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity` on. The app
  also calls `app.enableSandbox()`.
- **CSP:** each page gets a `<meta>` Content-Security-Policy injected by the
  `xbot-csp` Vite plugin (`electron.vite.config.ts`). The production policy:

  ```
  default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' data: blob: xbot-media:; media-src 'self' blob: xbot-media:;
  font-src 'self' data:; connect-src 'self' xbot-media:;
  base-uri 'none'; form-action 'none'
  ```

  Dev adds only what Vite needs: inline scripts and styles, and the localhost
  websocket. No `eval`, and no remote origins. If you need a new source, change
  the plugin and say why in the PR.
- **Navigation:**
  - `will-navigate` is always blocked;
  - `will-redirect` is blocked across origins;
  - `<webview>` is blocked;
  - `setWindowOpenHandler` always denies.
  - Links to the allowlist (`https:` on `x.com`, `twitter.com`, `ollama.com`,
    `github.com` and their subdomains) open in the user's browser through
    `shell.openExternal`. Extend the list in `security.ts`, not per call site.
- **Permissions:** every permission request and check is denied. So clipboard
  writes go through an IPC call to Electron's `clipboard` module in main, not
  `navigator.clipboard`.
- **Media:**
  - Pages load user media only via
    `xbot-media://media/<path relative to userData/media>`. The handler serves a
    file only if its realpath stays inside `userData/media`, which rules out
    traversal and symlink escapes. It answers single byte ranges with `206` (for
    video seeking), adds `Access-Control-Allow-Origin: *` so canvases stay
    untainted (only xBot's own pages can reach the scheme), and returns 404 for
    everything else.
  - Do not load `file://` media from the renderer.
- **Drag-in:** `File.path` no longer exists. The preload calls
  `webUtils.getPathForFile(file)`, and main validates and copies the file into
  `userData/media` before anything else uses it.
- **Credentials:** tokens are stored only through Electron `safeStorage`. If
  `safeStorage.isEncryptionAvailable()` is false, refuse to store them and say
  why; never fall back to plaintext.
- **Untrusted input:** treat project files, model output and X API responses as
  untrusted. Validate them with zod at the boundary.
- **Network:** no local HTTP server, no telemetry, no remote AI. Network access
  is only for explicitly requested model downloads and X.

## Dependencies and the lockfile

- `dependencies` holds only native modules that must be loaded from
  `node_modules` at runtime; today that is `better-sqlite3`. Everything else is a
  `devDependency` and gets bundled. electron-vite externalizes exactly
  `dependencies`.
- **Lockfile:** never hand-merge `pnpm-lock.yaml`. Rebase, then run
  `pnpm install`, then commit the result.
- pnpm 11 refuses unapproved install scripts (`strictDepBuilds`). A new
  dependency with an install script needs an `allowBuilds` entry in
  `pnpm-workspace.yaml`, and `pnpm ignored-builds` must list nothing.
- pnpm 11 also refuses versions published in the last day
  (`minimumReleaseAge`). Commit whatever `minimumReleaseAgeExclude` entry it adds.
- **Native modules** must ship N-API prebuilds, or be rebuilt for Electron. Add a
  `files` filter in `electron-builder.yml` so only the target platform's binary
  ships.

## Scripts and tests

| Command | Does |
|---|---|
| `pnpm dev` | electron-vite dev server plus Electron, with hot reload for the renderer |
| `pnpm build` | builds `out/main`, `out/preload` and `out/renderer` |
| `pnpm test` | Vitest unit tests (`tests/unit/**/*.test.ts`, Node environment) |
| `pnpm test:e2e` | builds, then runs the Playwright `_electron` smoke test (`tests/e2e`) |
| `pnpm typecheck` | `tsc` for `tsconfig.node.json` (main, preload, shared, tests), `tsconfig.web.json` (renderer, shared) and `tsconfig.scripts.json` (`scripts/**/*.ts`, with the DOM lib for `page.evaluate` bodies) |
| `pnpm lint` | ESLint, including the process-boundary rules |
| `pnpm package` | build plus electron-builder: `dist/*.dmg` and `dist/*.zip` on macOS, `dist/*.zip` on Linux |
| `pnpm icons` | re-renders the tray PNGs from `resources/tray.svg` |
| `pnpm fixtures` | re-renders `resources/fixtures/*.png` from `scripts/fixtures/*.html` |
| `pnpm capture` | builds, then captures both surfaces and compares them with the reference (see "Design system → Visual verification") |

- Modules that unit tests import must not import `electron`. Put the logic in a
  pure module, as `position.ts`, `ipc/core.ts` and `db/` do, and pass in the
  logger and similar dependencies.
- The e2e test launches `electron .` with `XBOT_E2E=1` and a temporary
  `XBOT_USER_DATA_DIR`. In unpackaged runs only, `XBOT_E2E=1` exposes
  `globalThis.__xbotTest` (`toggleComposer`, `openStudio`), so tests can drive
  the real code paths.
- **On Linux CI:**
  - run e2e under `xvfb-run -a`;
  - Ubuntu's AppArmor blocks Chromium's sandbox for an unpackaged Electron, so
    the e2e test passes `--no-sandbox` on Linux, and `pnpm dev --noSandbox`
    starts dev;
  - never add `--no-sandbox` to app code.

## Packaging

`electron-builder.yml` builds an unsigned app, and code signing and
notarization are out of scope:
- **Signing:** mac uses `identity: '-'` (ad-hoc) because Apple Silicon refuses
  fully unsigned binaries, with `hardenedRuntime: false`.
- **Info.plist:** `mac.extendInfo.LSUIElement: true` means no Dock icon and no
  app-switcher entry.
- **Fuses:** `runAsNode`, `NODE_OPTIONS` and `--inspect` are off, and the app
  loads only from the asar.
- **Native code:** `asarUnpack` covers `*.node`, and `npmRebuild: false`.
- **Prebuilds:** only the target platform's better-sqlite3 prebuild ships.
- **Tray PNGs** go to `Contents/Resources` via `extraResources`.
