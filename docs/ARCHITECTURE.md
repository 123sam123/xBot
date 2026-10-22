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
    status.ts                integration status registry (see "Registries")
    windows/                 common.ts (secure prefs, loader, registry), position.ts,
                             composer.ts, studio.ts, hold.ts
    ipc/                     core.ts (pure), register.ts (handle()), index.ts, <domain>.ts
    protocols/media.ts       xbot-media://
    db/                      index.ts, migrate.ts, migrations/*.sql
    services/                index.ts, types.ts, <domain>/index.ts; ffmpeg/ (T5, see "Studio video")
    preview/seed.ts          preview mode's sample data (T10, see "Preview mode")
  preload/                   index.ts (window.xbot), invoke.ts, api/<domain>.ts
  shared/contracts/          <domain>.ts, <domain>.channels.ts, ipc.ts, define.ts,
                             bridge.ts, events.ts, settings.ts (aggregators)
  shared/composition/        model.ts, layout.ts (zod-free), schema.ts (zod, main only); see "Studio"
  shared/reminders/          schedule.ts, label.ts, shortcut.ts (zod-free, pure); see "Reminders"
  shared/previewSample.ts    preview mode's sample texts, idea and compositions (zod-free, pure)
  renderer/
    design-system/           tokens, glass material, shared components (see "Design system")
    common/                  base.css, hooks shared by both pages,
                             composition/ (the Studio's draw routine, see "Studio")
    preview/                 preview mode's two renderer-only labels (handle, reminder row)
    composer/, studio/       one Vite page each
    onboarding/, settings/,  the sheet registries and the status chips (see "Registries")
    status/
resources/                   tray.svg → trayTemplate.png / @2x, icon.svg → build/icon.png (pnpm icons)
  fixtures/                  preview mode's sample media: PNG, MP4, framed PNG (pnpm fixtures)
build/icon.png               the app icon electron-builder turns into the .icns
scripts/                     capture-ui.ts (pnpm capture), render-fixtures.ts, capture-stage.cjs,
                             fixtures/*.html (the fixtures' sources), render-icons.mjs,
                             preview-ui.mjs (pnpm preview:ui)
tests/unit/  tests/e2e/
docs/                        SPEC.md, ARCHITECTURE.md, OLLAMA.md, FFMPEG.md, X.md, reference/ (+ captures/)
README.md                    setup, commands, data, backup, offline, preview mode, privacy
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
- **Shared** (`src/shared`): schemas, typed contracts and the composition model
  and geometry. It uses no `electron` and no Node built-ins, so it runs on either side.

ESLint enforces all of this. `electron` and Node built-ins are banned in the
renderer and shared code. In the preload, `zod` and value imports from contract
files are banned. In the renderer, `zod`, contract files and
`shared/composition/schema` may only be imported as types, and
`shared/composition/{model,layout}.ts` may not import zod at all, so zod never
reaches a renderer bundle.

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
| `drafts`, `media` | T3 (XBOT-6F4GAC). T3 also added, additively and for the reasons in "Drafts and media": `emojiPanel` and the status calls to `app`, `showEmojiPanel` and `ui.onboardingSeen` to `windows`, the quit flush to `app.ts`, the menu-bar drop to `tray.ts`, the refocus to `hold.ts`, and the Studio hand-off view to `studio/` |
| `studio` | T4 (XBOT-1N58PP) images; T5 (XBOT-G66JJK) video. T4 also added, additively and for the reasons in "Studio": `importLoose` and an exported `MediaRejected` to the media service, the Studio's quit flush to `app.ts`, full screen to `windows/studio.ts`, moved `useFileDrop` to `renderer/common/`, and the design-system pieces listed under "Components". T5 also added, additively and for the reasons in "Studio video": `services/ffmpeg/` (registered in `services/index.ts` before `media`); the optional `MediaTools.inspectVideo` hook, used by `media/service.ts`, `tools.ts` and `index.ts`; `ffmpeg.org` and `brew.sh` in `security.ts`; `{ hole }` in `drawComposition`; `previewLayout`, `useDevicePixelRatio` and `hole` in `CompositionCanvas`; `SpeakerIcon` and `SpeakerMutedIcon`; and `launch(userData, env?)` in `tests/e2e/studio-harness.ts` |
| `ai` | T6 (XBOT-4BCGOR). T6 also added, additively: the `aiMenu` slot to `ComposerHeader`, `focusSection` to `SettingsSheet`, the ✦ menu, AI status row and suggestions sheet to `composer/App.tsx`, `src/shared/aiEndpoint.ts` and `src/shared/aiCopy.ts`, and the tighter dev CSP in `electron.vite.config.ts` (see "Local AI") |
| `projects` | T7 (XBOT-5UVE6R). T7 also added, additively and for the reasons in "Project context": `generateTask` (with `buildTaskMessages` in `prompts.ts`, an exported `toFormat` in `schemas.ts` and an `'ideas'` running action) to the AI service, the `ideas` slot to `ComposerHeader`, `LightbulbIcon`, the `projects` sheet and Ideas wiring to `composer/App.tsx` (whose AI apply path became the shared `applyText`), `src/shared/ideaCopy.ts`, and the `ignore` devDependency |
| `reminders` (+ launch at login, global shortcut) | T8 (XBOT-8V5WV5). T8 also added, additively and for the reasons in "Reminders": `showComposerInactive`, `isComposerVisible`, `composerDisplay`, the `onComposerHidden` / `onComposerFocused` hooks and the focus-instead-of-hide toggle to `windows/composer.ts`, `startReminders()` and the `fireReminder` test seam to `app.ts`, the `header` prop to the design system's `Menu`, `disabled` to `Toggle`, the reminder row's props, and the `src/shared/reminders/` lint block |
| `x` | T9 (XBOT-OE2XV9). T9 also added, additively and for the reasons in "X publishing": the X wait in `app.ts`'s first `before-quit`, `openExternalIfAllowed` exported from `security.ts`, `db/durable.ts`, the design system's `TextField`, and props on `AccountMenu`, `ComposerHeader`, `ActionRow` and `PublishSheet` |
| `backup` (+ README, preview mode, packaging) | T10 (XBOT-1DDYA1). T2 created `src/renderer/preview/` and `resources/fixtures/`; T10 extends them. **Not additive:** T10 turned preview mode from a renderer-only sample into the real app on a seeded userData (see "Preview mode"). That removed the preview branches T2–T7 had put in `composer/App.tsx`, `composer/ideas/IdeasMenu.tsx`, `studio/App.tsx` and `studio/useStudioEditor.ts`, deleted `common/CompositionPreview.tsx`, and changed preview handling in `ipc/drafts.ts` and `ipc/studio.ts` (quit flushes), `tray.ts` (drop), `services/x/index.ts` (no network) and `services/projects/suggestions.ts` (stored ideas). Additively: `pickPaths` exported from `ipc/media.ts`, the seed call in `app.ts`, the `pnpm capture` waits for seeded media, and the unique `.partial` names in `ffmpeg/frames.ts` (two requests for one clip used to clobber each other) |

Shared files that several tickets may still touch, so coordinate:
- `package.json` / `pnpm-lock.yaml`, for new dependencies (see below);
- the renderer pages, which T2 restructures (others add to what T2 builds);
- `tray.ts` (its "Pause reminders" item is bound to `reminders.paused`; T8
  left it as it was), and `windows/composer.ts` (T8 added the `showInactive()`
  path for auto-open, see "Reminders").

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
`draft:changed`, `draft:studio-target`, `drafts:flush-requested`,
`media:imported`, `studio:opened`, `studio:flush-requested`, `studio:fullscreen`,
`status:changed`, `post:published`, `x:accounts-changed`, `x:job-changed`,
`export:progress` (T5: `{ job }`, a video export job's state), `studio:ffmpeg`,
`settings:changed`, `ui:open-settings`, `ai:state`, `ai:progress`,
`ai:pull-progress`, `projects:changed`, `projects:ideas-changed` and
`reminders:changed` exist today. An event listed in a
domain's `<domain>ForwardedEvents` is forwarded to every window automatically.

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
- `ui.onboardingSeen` (in `windows.ts`) lists the onboarding steps the user has
  moved past or skipped; see "Registries".
- `studio.currentDocumentId` (in `studio.ts`) is the document the Studio
  reopens after a restart.
- The user's FFmpeg (Locate FFmpeg…, T5) is deliberately **not** a registry
  setting. `settings:set` accepts any registry key, and the renderer must
  never choose what main spawns. The ffmpeg service keeps it in the `settings`
  table under `studio.ffmpegPath`, which is not in the registry, and only the
  native picker writes it.

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
- **Durable writes.** `synchronous=NORMAL` lets a power cut roll back the last
  WAL commits. A write that must survive one before something irreversible
  happens (T9: "a create-post request is about to be sent") goes through
  `durable(db, fn)` (`db/durable.ts`): `synchronous=FULL` and `fullfsync=ON`
  for that one transaction. SQLite refuses the pragma inside a transaction, so
  `durable` is never called from inside one.

## userData and modes

| Mode | userData |
|---|---|
| Packaged app | `~/Library/Application Support/xBot` |
| `pnpm dev`, e2e, any unpackaged run | `~/Library/Application Support/xBot Dev`, so branch migrations never touch real data |
| `--preview` or `XBOT_PREVIEW=1` | `~/Library/Application Support/xBot Preview` |
| `pnpm preview:ui` | a fresh folder under the OS temp dir, removed on quit (it sets `XBOT_USER_DATA_DIR`) |
| `XBOT_USER_DATA_DIR=<dir>` | `<dir>`, honoured only when unpackaged (tests) |

Inside it: `xbot.db`, `media/` (served by `xbot-media://`; thumbnails in
`media/thumbs/`, see "Drafts and media"), `exports/`,
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
   7. forward events to the renderers (and status changes as `status:changed`);
   8. preview mode only: seed a fresh preview userData (`seedPreview`, on the
       drafts queue; see "Preview mode"). The first preview launch waits for it,
       FFmpeg's detection included;
   9. `applyAppearance()` (`XBOT_APPEARANCE`), then create both windows, hidden;
   10. create the tray and the app menu;
   11. `startReminders()`: the reminder timer, powerMonitor, notifications and
       the global shortcut, which need the windows, the tray and the forwarded
       events (see "Reminders");
   12. attach the lifecycle handlers;
   13. log `xBot ready`.

`second-instance` (another launch) and macOS `activate` (reopened from Finder)
both toggle the composer. The first `before-quit` is prevented: main asks the
composer to save text, and the Studio to save edits, still inside their
autosave debounce and waits for both acks (each at most 1 s, skipped when that
page is not loaded; preview mode flushes too) and, only while a create-post request is in
flight, for X to answer it (at most 10 s, `settleXForQuit`; past that the
request is aborted and launch reconciles the job), then
quits again. That second `before-quit` marks the app as quitting, and only then
do windows really close. `will-quit` disposes services, then closes the DB.
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
  - Show is position, then `show()`, then `focus()`. T8's automatic open uses
    `showComposerInactive()` (position, then `showInactive()`), so the composer
    never steals focus. While a composer shown that way has not been focused,
    `toggleComposer()` (tray click, the global shortcut, `second-instance`,
    `activate`) focuses it instead of hiding it; any other visible composer
    toggles closed as before.
  - The panel does not activate xBot. Anything that needs xBot to be the
    active app (a parentless `dialog.showOpenDialog`, `app.showEmojiPanel()`)
    calls `app.focus({ steal: true })` first.
  - **Hide on Escape:** a window-level `keydown` listener (`useEscapeToHide`)
    calls `windows.hide()`. Popovers and sheets that handle Escape themselves
    call `event.preventDefault()` first. An Escape that ends IME composition
    (`event.isComposing`, e.g. CJK input) is left to the input method.
  - **Hide on blur**, except:
    - while the window is **held**: `window.xbot.windows.hold()` / `release()`
      while any popover, menu or sheet is open (`useHoldWhile` in
      `composer/App.tsx`, asked for again when the window shows with a sheet
      still open), and `withHold(win, fn)` (`windows/hold.ts`) around every
      main-side `dialog.*` call (file pickers). `withHold` also drops the
      always-on-top level while the dialog is up, and refocuses a still-visible
      window afterwards so the next outside click blurs it again. The count is
      per webContents and resets on hide and on reload;
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
  - The footer's full-screen button toggles `setSimpleFullScreen` on macOS (no
    new Space for a menu-bar app) and `setFullScreen` elsewhere, and broadcasts
    `studio:fullscreen`. Hiding the window, by any route, leaves full screen;
    while it is on, Escape leaves it instead of hiding the window.
- **Both windows** are created hidden at startup and never destroyed:
  - `close` hides the window unless the app is quitting;
  - a crashed renderer reloads, at most 3 times a minute.
- **Tray** (`tray.ts`):
  - The icon is a template image, so macOS tints it for light and dark menu bars.
    `resources/tray.svg` is rendered by `pnpm icons` to 18×18 and 36×36 PNGs,
    which ship via `extraResources`.
  - Left-click toggles the composer.
  - On macOS it is also a drop target: dragging files over it shows the
    composer, and dropping them on it attaches them to the current draft
    (`importDroppedOnTray`). A drag that starts in Finder can activate Finder
    and blur (hide) the composer before it reaches the window; the icon, or a
    Cmd-drag from Finder, avoids that.
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
- `Popover({ id, anchor, placement?, offset?, crossOffset?, label, role?, testId?, keepOpenWithin? })`
  and `Menu({ id, anchor, label, items: { id, label, detail?, disabled?, checked?, onSelect? }[], header? })`
  (`header`, T8: non-interactive text above the items):
  - they render into `document.body` with `position: fixed`, so opening one
    never moves the page (the Studio canvas keeps its rect);
  - one per window is open at a time (`popovers`, a React-free store; open
    with `popovers.open(id)`, `.toggle(id)`, `.closeAll()`);
  - placement is clamped 8 px inside the window and redone on resize;
  - Escape and an outside click close them, and focus returns to the anchor;
    a pointer-down inside a `keepOpenWithin` element does not (the crop
    overlay the Crop popover controls).
- `Sheet({ open, title, onClose })` covers its positioned parent (the panel)
  without changing the window size.
- Escape goes through `useEscapeLayer(active, onEscape)`: the top-most layer
  closes first and the event is marked handled, so `useEscapeToHide` only
  hides the window when nothing is open.
- `Slider({ …, onCommit?, testId? })` (`<input type="range">`; `onCommit` fires
  on pointer-up and key-up, so a drag is one undo step), `SwatchGroup`,
  `Segmented` (radiogroups; an option may be `disabled` with a `reason`
  tooltip), `Toggle` (`role="switch"`; T8 added `disabled`, shown but inert), `TextField({ label, value, onChange,
  onCommit?, stacked?, description?, error?, readOnly?, selectOnFocus?, code? })`
  (commits on blur and Enter; T9 added `stacked` (label above a full-width
  input) through `code`), `NumberField({ label, value, min,
  max, onChange })` (whole numbers, clamped on blur and Enter), `ColorField`
  (the system colour picker in a swatch), and the inline SVG icons in
  `icons.tsx`.
- The composer holds its window (`windows.hold()`) while any popover is open,
  and closes every popover when it hides (main resets the hold then).

### Surfaces and their props

- **Composer** (`composer/`):
  - `ComposerHeader({ account, onConnect?, menuItems?, aiMenu?, ideas?, accountEntries?, onAccountAction? })`: the xBot mark and
    name are the app menu's trigger (New draft, Draft history…, Settings…);
    `aiMenu` (a node, T6's ✦ button) sits just left of the account control,
    and `ideas` (T7's bulb) just left of that;
    `AccountMenu({ account: { kind: 'disconnected' | 'connecting' } | { kind: 'connected', handle, reconnect? } | { kind: 'preview', handle }, entries?, onAction? })`.
    `entries` (T9, `composer/account/accountMenu.ts`) lists the real accounts with
    switch / add / reconnect / disconnect actions;
  - `PostEditor({ value, onChange, readOnly?, maxLength?, saveState?, onEmoji?, editorRef? })`.
    `maxLength` is only the 25 000-character storage bound; the counter shows
    X's over-limit state. The count is X's weighted length
    (`src/shared/postLength.ts`, `twitter-text`);
  - `AttachmentList({ attachments, onRemove(id), onReorder(from, to), onEditInStudio(id) })`:
    drag or ↑/↓ to reorder; more than two cards scroll inside the panel;
  - `UploadZone({ onAdd?, disabledReason?, dragActive?, busy? })`;
  - `ActionRow({ count, limit, canPost, postDisabledReason?, onPost, notice?, busy? })`;
    `busy` reads "Posting…";
  - `publish/PublishStatus({ job, now, draftLabel?, onAction })` (T9): the job row
    above the action row;
  - `ReminderRow({ label, muted?, onClick?, buttonRef?, expanded?, idea?, hint? })`,
    driven by T8's `ReminderControl` (`composer/reminders/`);
  - sheets, one open at a time: `OnboardingSheet`, `SettingsSheet({ open, onClose, focusSection? })`
    (`settings/`; `focusSection` scrolls that section into view), `HistorySheet`,
    `PublishSheet({ lede?, onConnect?, … })` (post it yourself), `SuggestionsSheet`
    (`composer/ai/`, see "Local AI"), `publish/ReconcileSheet` (T9: "Did it post?")
    and `ProjectsSheet` (`composer/ideas/`, see "Project context").

  The draft is persisted (`composer/useDraft.ts`, see "Drafts and media"), in
  preview mode too, where it is the seeded sample.
- **Studio** (`studio/`):
  - `StudioTopBar({ onBack, onAdd, addDisabledReason?, badge?, notice?, actions?, addLabel? })`
    (`actions`: undo, redo and the More menu);
  - `StudioToolbar({ items, active, onSelect })`;
  - `ToolPopovers` (Background, Frame, Padding, Shadow, Crop), `OutputPopover`,
    `PresetsPopover`, `CropOverlay`;
  - `Timeline({ duration, current, trim, frames, playing, onTogglePlay, label?, onSeek?, onTrim?, onTrimEnd?, minTrim?, muted?, onToggleMute?, muteDisabledReason? })`.
    Without the optional handlers it only shows.
    `onSeek` scrubs, `onTrim` drags the handles and takes arrow keys (0.1 s,
    Shift 1 s), and `onToggleMute` adds the mute button;
  - `StudioFooter({ dimensions, fit, zoom, onFit?, onZoom?, dimsAnchor?, onDimensions?, fullscreen?, onFullscreen? })`;
    `fit` is null while a zoom level is chosen.
- **Honest states.** In normal mode the header reads "Connect X" until an
  account is connected, then its real handle. Without an account, Post opens
  the publish-options sheet (Copy text / Export media / Open X, plus Connect X);
  with one, it starts a publish job (see "X publishing"). Post is disabled with
  a reason while the draft loads ("Loading your draft…"), when the draft is
  empty ("Write something or add media first"), over the limit ("Over the
  280-character limit"), when X would refuse the media (`src/shared/xRules.ts`),
  while media is being added, and while the draft's post is on its way or
  waiting to be checked. The Studio's tools and "Add to post" are
  disabled with a reason until an image or video is open (a video needs FFmpeg),
  and the reminder row shows the real schedule ("Next reminder in 24 min",
  "Reminders paused", …). The sample handle and media exist only in preview
  mode, labelled "Preview", where Post opens the post-it-yourself sheet with
  "Posting to X is off in preview. You can post it yourself." and no Connect X.
- **Studio hand-off.** "Edit in Studio ↗" calls `drafts.openInStudio({ draftId, attachmentId })`;
  the studio module answers T3's `draft:studio-target` by opening that
  attachment's document (see "Studio").

### Visual verification

`pnpm capture` writes to `test-results/captures/` and copies the comparisons
the PR carries to `docs/reference/captures/`. It exits non-zero on any failed
assertion. Its preview runs are seeded (see "Preview mode"): it waits for the
composer's framed screenshot and for the sample video's first frame and
filmstrip, and scrubs to the reference's playhead, so it needs FFmpeg. Its
limits:
- Linux captures use Inter, so text runs a little wider than SF Pro.
- The behind-window blur and the native tint are simulated (blur 24 px,
  saturate 1.3, with and without an approximate dark tint). Only
  `pnpm capture --desktop` on a Mac shows the real material.

## Drafts and media

T3 (XBOT-6F4GAC). Migration `202610212200_drafts_media.sql`.

- **Tables.** `drafts` (one row has `is_current = 1`: the draft the composer
  edits; the rest are history), `media` (one row per imported file, unique by
  sha256; `path` / `thumb_path` relative to `userData/media`) and
  `draft_attachments` (a draft's media in `position` order; `UNIQUE(draft_id,
  position)`, renumbered through negative values). T4 added
  `studio_document_id TEXT REFERENCES studio_documents(id) ON DELETE SET NULL`
  with `ALTER TABLE` (see "Studio").
- **Service.** `services/drafts/service.ts` and `services/media/service.ts` are
  electron-free (`createDraftsService`, `createMediaService({ db, paths, log,
  tools, drafts, now })`); Electron decoding lives in `services/media/tools.ts`.
  Every write is one transaction. Calls that change a draft's structure and
  media imports run through one serial queue (`services/drafts/queue.ts`),
  enqueued only at the entry points (IPC handlers, the menu-bar drop).
- **Autosave.** `composer/useDraft.ts` saves 400 ms after the last keystroke,
  and at once on blur, hide, `pagehide`, before restore / new / copy /
  open-in-Studio, and on `drafts:flush-requested` (quit). `data-ready` waits
  for the draft; the editor is read-only until then. A change made in main
  (`draft:changed`) reloads the attachments but never overwrites unsaved text
  of the same draft.
- **Import.** By content, never extension (`services/media/sniff.ts`): PNG,
  JPEG, GIF, WebP, MP4, MOV. Sizes come from the headers (EXIF orientation,
  the `tkhd` rotation); images are capped at 20 MB and 16 384 px a side, video
  at 1 GB, and an MP4/MOV must have a `moov` box and no box past the end of the
  file. The file streams into `tmp/` while hashing, then the row is reused by
  sha256 or the file is renamed into `media/<uuid>.<ext>` (thumbnail
  `media/thumbs/<uuid>.png`) inside the transaction that attaches it. A
  rejected file leaves nothing behind and is named in an inline error.
  `importLoose({ name, path })` (T4) runs the same path without attaching, for
  the Studio's sources, background images and exports; it throws
  `MediaRejected` with the sentence the user sees.
- **Video check** (T5). When FFmpeg is there, a video's temp copy also goes
  through `MediaTools.inspectVideo` before anything is stored: ffprobe must
  find a real video stream and decode its first frame. A damaged `moov`,
  frames that don't decode, or an MP4 with no picture is refused. The row
  then takes ffprobe's display size and duration (an existing row matched by
  sha256 is updated too). The check waits for an FFmpeg detection still
  running. Without FFmpeg the box check stands alone, so the composer
  attaches MP4/MOV as before.
- **Thumbnails.** QuickLook (`nativeImage.createThumbnailFromPath`, 10 s
  timeout) on macOS; otherwise `nativeImage` for PNG / JPEG, the located
  FFmpeg's first frame for video, a video tile, or the image itself.
- **Ownership and cleanup.** Every table that refers to media must do so with
  a declared foreign key to `media(id)`; every file at the root of `media/` and
  in `media/thumbs/` belongs to a media row. Other files go in subfolders. At
  startup the media service deletes rows that no foreign key references and
  `<uuid>.<ext>` files no row names, both only when older than 24 h, and logs
  each deletion.
- **Export.** `media.exportForDraft` copies a draft's media in order as
  `01-<name>.<ext>` into a folder the user picks, never overwriting (a
  `.partial` file, then a link to the first free name), and reports "Export
  running" through the status registry while it copies.

## Studio

T4 (XBOT-1N58PP): non-destructive screenshot editing. Migration
`202610220100_studio_documents.sql`. T5 (XBOT-G66JJK) adds video on top.

- **One composition** (`src/shared/composition/`). `model.ts` holds the
  `Composition` type: source (media id and size), crop (fractions of the
  source) and its aspect lock, frame, canvas ratio, padding, shadow,
  background, output format and scale, and an optional `video` block
  (`trimStartMs`, `trimEndMs`, `muted`), present exactly when the source is a
  video (T5). It also holds the defaults, the curated gradients (T2's CSS ported
  stop for stop), the shadow presets, the chrome constants and the style
  helpers. `schema.ts` is its zod schema (main only; compile-time checks keep
  the two identical). Units are resolution-independent: with W the cropped
  source width and S the longer side of the framed picture, padding is a
  fraction of S, and radius, shadow blur and distance are fractions of W.
- **One geometry.** `layout.ts`'s pure `computeLayout(comp, { scale, maxSide, maxShortSide? })`
  returns every rect in output px: canvas (integers, even for a video), frame,
  chrome and its parts, content and the source crop. `exportLayout(comp)` is
  the layout an export renders. The footer, the Output popover, both renderers
  and main's checks use it. It fits the padded frame uniformly into
  the canvas, so the content always keeps the crop's aspect. Sizes over 8192 px
  a side are scaled down uniformly and flagged `capped`. Output size at 1×:
  `original` is the padded frame at source resolution; 16:9, 1:1 and 4:5 are
  the smallest canvas of that ratio around it; `custom` is the chosen W×H.
- **One draw routine** (`renderer/common/composition/draw.ts`):
  `drawComposition(ctx, comp, layout, assets)` draws the background, the
  shadow (shape off-canvas, so only the shadow lands), then the frame clipped
  to its rounded rect (chrome as vectors, the source from its crop rect), and
  only that. The preview (`CompositionCanvas`) calls it at display size ×
  `devicePixelRatio` (backing capped at 4096 px); the export
  (`render.ts`) calls it on an `OffscreenCanvas` at the output size and
  encodes PNG or JPEG. Images are decoded once per media id
  (`assets.ts`: `xbot-media:` URLs are fetched, anything else goes through an
  `<img>`). Transparent backgrounds show CSS checks behind the
  preview canvas, never in it, and export as PNG; GIF sources export their first
  frame, as PNG. Colour: Chromium converts Display P3 sources to the sRGB
  canvas on decode, so exports are sRGB.
- **Tables.** `studio_documents` (one source image and its composition JSON;
  `revision` refuses stale saves; `composition_backup` keeps unreadable JSON
  that the defaults replaced; `background_media_id` mirrors an image
  background), `studio_exports` (a rendered export of a document) and
  `studio_presets` (a saved style: frame, canvas, padding, shadow,
  background). Every media reference is a foreign key, so the media cleanup
  keeps it. Documents no attachment refers to (directly, or by holding one of
  their exports), not current, and untouched for 30 days are deleted at
  startup; their media is collected by a later launch's media cleanup.
- **Opening.** The studio module answers `draft:studio-target`: the
  attachment's linked document, else the document of the export it holds,
  else a new document linked at once. Picking or dropping an image in the
  Studio reopens the newest document for that image (or for the export it
  is), else creates one. Videos too (see "Studio video").
  `studio.currentDocumentId` brings the document back after a restart.
- **Saving.** The renderer keeps undoable snapshots (100) and saves through
  one serial queue, 500 ms after the last change and at once on hide, before
  switching documents and on `studio:flush-requested`; each save names its base
  revision. A slider drag or a typing run is one undo step.
- **Add to post** (`studio:add-to-post`, on the drafts queue): main saves the
  composition, checks the bytes' real format and size against
  `exportLayout`, imports them (`importLoose`, at most 20 MB), records the
  export, and on the current draft swaps it into the attachment that opened
  the document (else the one linked to it), keeping its position, or appends a
  linked attachment; export rows no draft uses any more are deleted. The
  Studio then hides and the composer shows; `draft:changed` reloads its
  attachments and never touches its text. X takes images up to about 5 MB, so
  T9 checks the size when posting.

## Studio video

T5 (XBOT-G66JJK): playback, trim, mute and MP4 export through local FFmpeg.
The packaging and licence decision, setup and troubleshooting are in
[`FFMPEG.md`](FFMPEG.md): v1 uses the FFmpeg the user installs, and bundles
none. Migration `202610221200_studio_export_jobs.sql`.

- **FFmpeg** (`services/ffmpeg/`, electron-free apart from `index.ts`).
  - `locate.ts` searches, in order: the user's pick, `<resources>/ffmpeg/`,
    `/opt/homebrew/bin`, `/usr/local/bin`, then `PATH`. It runs `-version` and
    `-encoders` in the background with a 15 s timeout. It needs FFmpeg 4.4 or
    later with libx264 (preferred) or `h264_videotoolbox`, plus `aac` and an
    ffprobe. Otherwise it reports a `missing` status with a reason and the fix.
  - `probe.ts`: ffprobe JSON (zod-parsed) and the first-frame decode check.
  - `export.ts`: the pure argument builder.
  - `frames.ts`: filmstrip frames.
  - `run.ts`: `execFile` with an argument array, never a shell.
  - `XBOT_E2E_NO_FFMPEG=1` (unpackaged only) simulates a Mac without FFmpeg.
- **Composition and geometry.**
  - A video's canvas has even sides (4:2:0).
  - A video exports at 1× inside the 1080p box (`MAX_VIDEO_OUTPUT`: 1920 ×
    1080, or 1080 × 1920 upright). Its `output.format` and `output.scale` are
    ignored.
  - The trim is whole milliseconds, at least `MIN_TRIM_MS` (500, or the whole
    clip), validated against the clip in main.
  - `videoPlacement(layout, source)` is where FFmpeg puts the video: the
    content rect rounded outward to whole pixels and clamped to the canvas,
    with an integer source crop.
- **The frame layer.** `drawComposition(…, { hole: true })` draws background,
  shadow, frame and chrome, cuts the content out (inside the frame's rounded
  clip), then strokes the border.
  - The preview stacks it as the export does: `VideoStage` puts a `<video>`
    *under* a `CompositionCanvas` drawn with the hole, sized `source × k` and
    offset by `−crop × k`, so the crop fills the content rect at one scale.
  - Layout rects map to CSS px by `canvas.width / cssWidth`, never by the
    device pixel ratio, because the backing store is capped.
  - `useCompositionAssets` never decodes a video source.
  - `renderVideoLayer` encodes the same layer as an RGBA PNG at the export
    size.
- **Documents.** A video document stores ffprobe's facts in
  `studio_documents.source_video_json`: display size (rotation and SAR
  applied), the video stream's duration, fps, streams and colour. These are
  `StudioDocument.video`.
  - Saves validate against that record, never against `media.width`/`height`:
    same source, trim inside the clip, `video` present.
  - The open paths are async: probe outside the transaction, then create and
    link inside one. Opens are numbered, so a slow open that a newer one
    overtook is dropped.
  - Without FFmpeg a video opens as a read-only `{ view }`, whose attachment is
    now nullable. When `studio:ffmpeg` turns `ready`, main re-runs that open
    and emits `studio:opened`.
  - "Replace source…" is images only. The "None" background is disabled for
    video, and main refuses a transparent video export.
- **Export jobs** (`services/studio/exports.ts`, table `export_jobs`).
  - `studio:export-video` saves, checks the layer PNG (IHDR size against
    `exportLayout`, colour type 6) and queues a job. It resolves
    `{ job, revision }`.
  - Jobs run one at a time, in order. A second export of a document already
    queued or running is refused.
  - FFmpeg runs off the drafts queue at `nice` 10. Only the import of the
    finished MP4 (`importLoose`) and the attach go on the drafts queue. The
    attach is the same path as images, refactored into `attachExport`. The
    MP4 goes to the draft the user asked from (else the current one).
  - Progress (`-progress pipe:1`, `out_time_us` over the trim length, clamped)
    goes to the row and to `export:progress { job }`. The "Export running"
    chip comes from status provider `studio-export` (order 91).
  - Cancel (`studio:cancel-export`) sends SIGTERM, then SIGKILL after 3 s. It
    resolves once FFmpeg has exited, and `tmp/<job>.mp4` and
    `tmp/<job>.layer.png` are deleted however a job ends.
  - Quitting SIGKILLs FFmpeg and records `canceled` before the database
    closes.
  - At startup, jobs left `queued` or `running` become `failed`. A leftover
    FFmpeg is killed if `ps` shows it is still writing that job's output (pids
    get reused). Finished jobs older than 30 days are pruned.
  - `export_id` points at `studio_exports` (now also `mp4`), never at
    `media`, so a job doesn't pin its output from the media cleanup.
  - `XBOT_E2E_FFMPEG_REALTIME=1` (unpackaged only) adds `-re`, so an export
    takes as long as its trim.
- **Studio UI** (`renderer/studio/`).
  - Hooks: `useVideoPlayback` (play inside the trim, pause at its end, muted
    as the export will be) and `useFilmstrip` (`studio:filmstrip` JPEG bytes
    as `blob:` URLs; `xbot-media:` serves only the media folder).
  - Components: `FfmpegCard` (with `useFfmpegStatus`) and `VideoStage`.
  - "Add to post" reads "Exporting… N%". A chip with Cancel sits over the
    canvas. A running job doesn't set `busy`, so editing stays live.
  - On success the Studio hides only while it is visible and still shows that
    document. Otherwise `draft:changed` just swaps the attachment in.
  - The Output popover shows MP4, the size, the clip length and the sound.
  - HDR sources get a notice: there is no tone mapping.

## Local AI

T6 (XBOT-4BCGOR). Native Ollama on this Mac, called only from main. The
verified Ollama API, setup, troubleshooting and known limits are in
[`OLLAMA.md`](OLLAMA.md).

- **Endpoint.** `ai.endpoint` accepts only `http://127.0.0.1:<port>`,
  `http://localhost:<port>` or `http://[::1]:<port>` (`src/shared/aiEndpoint.ts`,
  shared by the setting's schema, main and the settings UI). Requests to
  `localhost` go to `127.0.0.1`. Every request is re-checked, sent with
  `redirect:'manual'` (any 3xx is refused) and bounded by a typed timeout; a
  proxy configured for the process makes xBot refuse instead of sending.
- **Files.** `services/ai/`: `ollamaClient.ts` (the only transport; Node's
  `fetch`, never `net.fetch`), `locality.ts`, `catalog.ts`, `schemas.ts`,
  `partial.ts`, `prompts.ts`, `generate.ts`, `runtime.ts`, `queue.ts`,
  `voice.ts`, `errors.ts`, `status.ts`, `service.ts` (electron-free) and
  `index.ts`. Migration `202610220000_ai_voice.sql` adds `voice_profile` (one
  seeded row) and `voice_examples`.
- **Locality.** Only models whose verdict is `local` generate: no
  `remote_host`/`remote_model` on `/api/tags` or `/api/show`, not a
  cloud-sourced name (Ollama's own `:cloud` / `-cloud` rule), `capabilities`
  present and including `completion`, and at least 50 MB of weights. Anything
  else is `remote`, `unverifiable` or `unsuitable`, and is refused before
  `/api/chat`. A stream chunk carrying remote fields aborts the request.
- **Generation.** `/api/chat` streams with a JSON-schema `format` derived from
  zod, `truncate:false`, `think:false` only for thinking models, a per-action
  `num_predict`, and a byte-budgeted prompt (the user's text sits in
  delimited DATA blocks that are never instructions). Complete fields are
  forwarded as `ai:progress` while streaming; the result is validated with
  zod and repaired at most twice. Only invalid output is retried.
- **Memory.** `/api/ps` is read once per action. A model xBot loads gets
  `keep_alive:"5m"` and `num_ctx` 4096 (low-resource mode: `0` and 2048). A
  model other work had loaded keeps its remaining keep-alive and its
  `context_length`, and `shift` is never sent, so xBot doesn't unload, shorten
  or reload it; a load that could evict other models is refused.
- **Queue.** One generation at a time (`queue.ts`). Interactive requests go
  ahead of background ones and pre-empt a running background job; every
  request can be cancelled by `requestId`, queued or running. Cancel aborts
  the fetch, which stops generation in Ollama.
- **For T7.** T7 ended up using `ai().generateTask()` (see "Project
  context"): its own instructions and schema through this queue, model
  checks, memory rules and DATA fencing. `generate({ action: 'story' })`
  remains the composer's "Suggest a post". `generate` resolves `{ status:
  'done', options }` or `{ status: 'cancelled' }` (pre-empted by the user);
  both throw an `IpcError` whose code and text come
  from `src/shared/aiCopy.ts`: `ollama_unavailable`, `model_needed`,
  `model_unverifiable`, `remote_refused`, `endpoint_*`, `ai_timeout`,
  `ai_stopped`, `ai_input_too_long`, `ai_would_evict`, `ai_malformed`,
  `ai_failed`, `ai_busy`. Every option carries `flags` (numbers absent from
  the sources, generic or banned phrases, stripped hashtags).
- **Renderer.** `composer/ai/`: the ✦ `AiMenu` in the header, the
  `AiStatusRow` above the action row ("Running locally · Cancel", "Suggestions
  ready · View", "Undo AI change", errors), and `SuggestionsSheet`. An applied
  suggestion goes through the editor (`execCommand('insertText')`), so it
  autosaves and Cmd+Z reverts it; "Undo AI change" shows until the user edits.
  Onboarding steps `ollama` (10) and `model` (20); settings sections `ai`
  (10, "Local AI") and `voice` (20). The `ai` status chip reads "Local AI
  ready", "Ollama not running" or "Model needed". Preview mode never probes
  and has no AI.

## Project context

T7 (XBOT-5UVE6R): the folders the user approves, what is read from them,
and the story ideas found in them (SPEC §11, §12 and §19's project
privacy). Migration `202610220300_projects_context.sql`. Everything under
`services/projects/` except `index.ts` is electron-free.

- **Tables.** `projects` (one approved folder: its path and realpath, brief,
  options, scan state, Git checkpoint, cached digest and doc cache),
  `project_events` (what scans and notes found: `commit`, `doc`, `files`,
  `note`; unique per scope by fingerprint through an `ifnull(project_id, '')`
  index, since a note may have no project), `suggestions` (ideas with their
  sources, claims and status) and `dismissed_suggestions` (keys and texts of
  dismissed stories, not tied to a project, so re-adding a folder never
  brings one back).
- **Reading** (`safeFs.ts`, `ignoreRules.ts`). Paths are relative to the
  folder's realpath; `..`, absolute paths and NUL are refused before any fs
  call. Symlinked folders are never entered; every opened file must resolve
  inside the folder, pass the ignore rules under every name it goes by, be
  a regular single-link file that isn't an iCloud placeholder, and match its
  `lstat` after `open(O_NOFOLLOW | O_NONBLOCK)`. Budgets per scan: 256 KB a
  file, 2 MB, 2000 listed entries, 5 s; hitting one marks the scan partial.
  The built-in deny list (secrets, keys, dumps, dependencies, build output,
  editor churn, media, binaries) comes first; each `.gitignore`,
  `.git/info/exclude` and `.xbotignore` is its own layer and a path is out
  when any layer says so, so a `!` never re-includes across files. What is
  read: README, and with "Read docs" the changelog and `docs/` (12 files,
  newest first), package manifests, and Git metadata; without Git, also the
  names of recently changed source and doc files (one event a day).
- **Git** (`git.ts`). Only when `<root>/.git` is a real directory owned by
  the user with every part inside it (`commondir`, alternates, linked
  worktrees and symlinked parts make the folder non-Git). An absolute git
  binary (`/usr/bin/git` on macOS only when `xcode-select -p` succeeds, so
  the CLT installer never pops up), an argument array, `--git-dir`, an env
  built from scratch, and `-c` overrides for every setting a repository can
  use to run a program. `GIT_ALLOW_PROTOCOL=none` is the control that stops
  a repo-level `protocol.ext.allow=always` partial-clone remote (`-c
  protocol.allow=never` alone does not; `GIT_NO_LAZY_FETCH` helps from git
  2.44 and distro backports). Read commands only: `rev-parse`,
  `merge-base`, `log -z --numstat` (newest 30 since the checkpoint; 7 days
  on a first scan or after a rebase) and, with diff excerpts on, `show
  --submodule=short` limited to allowed paths. Never `status`, a
  working-tree diff, npm or a project script.
  `tests/unit/projects-safety.test.ts` arms a repository with fsmonitor,
  hooks, a gpg signature, textconv, a submodule diff and a lazy-fetch
  remote, checks each fires for plain git, and that none fires for xBot.
- **Redaction** (`redact.ts`): token patterns, private-key blocks, URL
  credentials, secret-named assignments and high-entropy runs become
  `[redacted]`. Whole buffers are redacted before any excerpt is cut, at
  ingest and again in `buildIdeaSources()`, the one place project text
  becomes model input.
- **Scans** (`scanner.ts`, `service.ts`). On adding a folder and on
  Rescan, at launch for folders not read in 15 min, and every 15 min after
  (a folder macOS denied waits for Rescan). One at a time across folders;
  Git first, with its own 3 s; results written in one transaction with
  `INSERT OR IGNORE`, so unchanged history adds nothing. The digest
  (README excerpt and manifests) is stored with the hash of its inputs.
  The checkpoint moves only when a `log` call finished.
- **Ideas** (`ideas.ts`, `suggestions.ts`). Sources go to the model as DATA
  blocks: `BRIEF`, `F1…` (confirmed facts) and `N1…` (notes) are the user's
  words; `DIGEST` and `E1…` (commits, docs, files) come from the folder.
  Each group has a share of the prompt budget, activity first. The answer
  (`{ ideas: [{ kind, text, sources, claims: [{ text, basis }] }] }`, 3 or
  2 by context size) is checked by xBot: an idea must cite an included
  event or note (not just changed file names), a number in none of the
  blocks discards it, a claim is confirmed only when its basis is a user
  block that says it, commit-only "shipped/works" wording and unknown URLs
  or @mentions become claims to confirm, banned phrases discard. `auto`
  (the Ideas popover opening, T8) uses only events no generation has used;
  `force` ("Refresh ideas", a new note) uses the recent ones; with nothing
  useful the answer is `needs_context` and no AI call is made. A failed
  background run marks its events attempted so it isn't repeated every
  interval. Duplicates are skipped by fingerprint; dismissed stories by key
  or text similarity.
- **For T8.** `projects().hasNewActivitySince(ts)` (useful events recorded
  after `ts`, never a commit's own date), `suggestions().getTopRelevant()`
  and `suggestions().refresh('auto', 'background')`, from
  `services/projects`.
- **Renderer** (`composer/ideas/`): the header bulb and the Ideas popover
  (cards, "Confirm before posting", "Why this suggestion?", Use through the
  composer's undoable `applyText`, Dismiss, the "What did you build today?"
  note), the projects sheet with the brief editor, and onboarding step
  `projects` (30). The folder picker runs in main; `folderPolicy.ts`
  refuses `/`, the home folder and its ancestors, private and system
  folders, whole disks and xBot's data folder. Preview mode reads nothing; its
  Ideas popover lists the one seeded sample idea, labelled, without Refresh or
  the note field.

## X publishing

T9 (XBOT-OE2XV9). Migration `202610221200_x_publish.sql`; the verified X API
behaviour, setup and troubleshooting are in [`X.md`](X.md).

- **Files.** `services/x/`: `api.ts` (the X API over an injected fetch; zod
  at the boundary; the only error it throws is a sanitised `XApiError`),
  `oauth.ts` + `loopback.ts` (PKCE S256 sign-in), `accounts.ts` (rows and
  tokens), `vault.ts` (safeStorage), `publish.ts` (the job state machine),
  `reconcile.ts` (finding a post on X), `errors.ts` (the error catalog),
  `service.ts` (the facade), `handlers.ts` (the `x:*` IPC table). Only
  `index.ts` imports `electron` (`net.fetch` with `credentials: 'omit'`,
  `safeStorage`, `shell` through `openExternalIfAllowed`, the composer's
  hide/show). Rules shared with the renderer are zod-free in
  `src/shared/xRules.ts`.
- **Tables.** `x_accounts` (one row per X user; `token_blob` is safeStorage
  ciphertext; `client_id` is the app the tokens were issued to; at most one
  `is_active`), `publish_jobs` (one per Post ↑, with its frozen account,
  text and idempotency key), `publish_job_media` (the frozen media in order;
  its `media_id` is the foreign key that keeps T3's GC away from a file a job
  may still upload, nulled once the job is published, canceled or dismissed)
  and `publish_job_events` (every transition).
- **States.** `queued → uploading → processing → publishing → published`, plus
  `failed`, `canceled` and `needs_reconciliation`; the active set (one per
  draft, a partial unique index) is everything but `published`, `failed` and
  `canceled`. Every transition is a compare-and-swap `UPDATE … WHERE status = ?`
  logged in `publish_job_events` and pushed as `x:job-changed`. Jobs upload
  one at a time; reconcile and Retry post are serialised per job.
- **Never twice.** The same draft content maps to one job (repeat clicks get
  it back). The move into `publishing` is a durable write made before the
  create request; a timeout, network error, 5xx or quit after it leaves the
  job `needs_reconciliation` (`uncertain_since`), and nothing sends that
  create again except an explicit Retry post, which first looks on X. Launch
  turns `publishing` into `needs_reconciliation` and earlier interrupted states
  into `failed` (`x_interrupted`); nothing is resumed on its own.
- **Seams for siblings.**
  - T4/T5: `createPublisher({ resolvePostMedia })` decides which file is
    uploaded for a frozen attachment: the attachment's own media file. T4's
    "Add to post" swaps the rendered export into the attachment, so an edit is
    what gets posted; an edited attachment that has not been added to the post
    posts its current media.
  - T10: `x_accounts.token_blob` only decrypts on the Mac that wrote it. A backup
    should leave it out; a restored account reads as "Reconnect".
- **Settings.** `x.clientId` (the user's OAuth 2.0 Client ID; '' until set) and
  `x.callbackPort` (default 47813; the callback is
  `http://127.0.0.1:<port>/callback`). Settings → X (`settings/sections/x.tsx`)
  and onboarding step 5 (`onboarding/steps/x.tsx`) share `composer/account/XSetup.tsx`.
- **Status chip** (`id: 'x'`, from the database only): X not set up / X
  disconnected / X: @handle / Reconnect X / Posting to X / A post needs checking.

## Backup

T10 (XBOT-1DDYA1): "Settings → Data → Back up data…" (SPEC §19). No
migration. `services/backup/service.ts` is electron-free;
`services/backup/index.ts` gives it the app version; `ipc/backup.ts` asks for
the folder with the composer's `pickPaths` (held, so the picker doesn't hide
the panel).

- **Calls.** `backup:create` (no payload: main shows the folder picker; null
  when it is cancelled) resolves `BackupResult { folderName, tables, rows,
  mediaFiles, bytes, missing }`. `backup:reveal` shows the last backup in
  Finder; main remembers its path, so the renderer never sends one.
- **What a backup is.** A folder `xBot Backup YYYY-MM-DD HH.MM.SS` (local time;
  ` 2`, ` 3`… on a clash), built as `<name>.partial` and renamed when
  complete:
  - `xbot.db`: `VACUUM INTO`, one consistent snapshot even while the app
    writes. In the copy (`journal_mode=DELETE`, `secure_delete=ON`) every
    `x_accounts.token_blob` is blanked and `reconnect_required` set, then the
    copy is vacuumed again so no ciphertext survives in free pages. Tokens
    only decrypt on the Mac that made them anyway; a restored account reads
    "Reconnect";
  - `media/`: only the files the copy's `media.path` / `thumb_path` name,
    cloned with `COPYFILE_FICLONE` where the volume can (APFS). Files that
    are gone are listed, not fatal;
  - `manifest.json` (app version, time, migration ids, per-table row counts,
    media files and bytes, missing files, what was left out) and
    `RESTORE.txt`.
- **Failure.** Any error removes only the `.partial` folder this run made; the
  IPC layer turns ENOSPC, EACCES/EPERM, EROFS and ENOENT into sentences. A
  second backup while one runs is refused (`backup_running`). Quitting
  stops a running backup and removes its `.partial` synchronously (the backup
  module is the last in `services/index.ts`, so it is disposed first).
- **Restore** is manual and documented (`RESTORE.txt`, README): quit, move the
  `xBot` folder aside, copy `xbot.db` and `media/` into a new one, reopen. No
  in-app restore in v1.
- **Test.** `tests/unit/backup.test.ts`: every table's row count matches,
  `integrity_check` is ok, the media files match byte for byte, the token
  bytes are nowhere in the file, the manifest matches; missing files, name
  clashes, a concurrent backup and unwritable or failing targets leave no
  `.partial`.

## Preview mode

T10 (XBOT-1DDYA1): SPEC §20's "deterministic visual-preview mode using local
sample media and no external publishing". `pnpm preview:ui` (a fresh
temporary userData every run), `--preview` or `XBOT_PREVIEW=1` (the
persistent `xBot Preview` folder; see "userData and modes").

- **The real app on seeded data.** Preview used to be a renderer-only sample
  in React state, so attaching, history, the Studio and Add to post couldn't
  run in it. Now `src/main/preview/seed.ts` (electron-free) seeds a fresh
  preview userData (no media rows and no `preview.seededAt` row in
  `settings`, a raw key outside the registry like `studio.ffmpegPath`)
  through the services' own paths, on the drafts queue, before the first
  window:
  1. the current draft gets the video text and `media().importFiles()` the
     MP4; with FFmpeg, `openForAttachment()` + `save()` give its document
     `previewStudioComposition` and the trim (1560–8520 ms of 12 000, the
     reference's 0.13–0.71);
  2. `drafts().startNew()` (the video draft goes to history), the reference
     text and the PNG; its document gets `previewThumbnailComposition`
     (1540 × 1000);
  3. if `my-tiny-tool-framed.png` exists, `studio().addToPost()` with its
     bytes: the same size check against `exportLayout` as a real Add to post,
     so a stale fixture keeps the plain screenshot and logs a warning;
  4. one `suggestions` row (kind `demo`, source "Preview sample");
  5. `setStudioDocument()`: the video document, else the screenshot's;
  6. `preview.seededAt`, and the log line `preview: seeded {…}`.

  A failed step is logged and skipped. Fixtures are found like the tray icon:
  `process.resourcesPath/fixtures` when packaged, `<app>/resources/fixtures`
  otherwise. The texts, idea and compositions live in
  `src/shared/previewSample.ts`; the renderer keeps only the header's sample
  handle and the reminder row's label (`renderer/preview/fixtures.ts`).
- **What runs and what doesn't.** Drafts, history, media import (pickers,
  drops, the menu-bar drop), the Studio (every tool, presets, Open, Replace,
  Add to post, video export) and the quit flushes run as in normal mode. Off:
  AI (never probes), X (every call refused with `preview_mode`, and its
  `fetch` rejects outright, so nothing reaches the network), project scanning
  and refreshing ideas, reminders, the global shortcut, onboarding. Post ↑
  opens the post-it-yourself sheet with "Posting to X is off in preview. You
  can post it yourself." and no Connect X. The header shows `@samuelbuilds`
  with a "Preview" badge, and the Studio title a "Preview" badge.
- **Fixtures** (`resources/fixtures/`, `pnpm fixtures`): `my-tiny-tool.png`
  (1440 × 800, from HTML), `my-tiny-tool.mp4` (12.0 s, 30 fps, H.264
  yuv420p, faststart, no audio, a cursor dot passing the Process button;
  about 72 KB) and `my-tiny-tool-framed.png` (the app's own Studio export of
  the screenshot's document, about 1 MB: the gradient doesn't compress).
- **Tests.** `tests/e2e/journey.spec.ts` runs the whole journey on it;
  `tests/e2e/studio.spec.ts` runs on the seeded video document.

## Registries

Later tickets add onboarding steps, settings sections and status chips by
adding their own files; nobody edits a shared list.

- **Onboarding** (`renderer/onboarding/`): each `steps/<id>.tsx` default-exports
  `{ id, order, title, Component({ next, skip, isLast }) }`, collected with
  `import.meta.glob`. The sheet shows, in order (`order`, then `id`), the steps
  whose ids are not in `ui.onboardingSeen`, on the composer's first load, never
  in preview. Moving past a step marks it seen; Skip, the close button and
  Escape mark the whole run seen. Welcome is `order: 0`; Ollama 10, model 20,
  project folders 30, X 40, reminder hours 50.
- **Settings** (`renderer/settings/`): each `sections/<id>.tsx` default-exports
  `{ id, order, title, Component }`; the component reads its own state. A
  section that renders nothing is hidden. Built in: Status (0), Appearance (100).
  Others: Local AI 10, Voice 20, Reminders 30, X 40, Startup and shortcut 90,
  Data 95 (T10's backup, `sections/backup.tsx`).
- **Status** (`src/main/status.ts`, electron-free): a domain calls
  `registerStatusProvider({ id, order, get })` once, where `get()` returns an
  `IntegrationStatus { id, label, tone: 'ok' | 'neutral' | 'warning' | 'busy', detail? }`
  or null from cached state, and calls `statusChanged()` when it moves. The
  renderer reads `app.getStatus()` and the `status:changed` event
  (`status/useIntegrationStatus.ts`); Settings → Status shows the chips, so the
  default view stays as in the reference. Ids in use: T3's `media-export`
  (90), and T5's `studio-export` (91, "Export running") and `ffmpeg` (92,
  "FFmpeg not found" plus the fix).

## Reminders

T8 (XBOT-8V5WV5): SPEC §13, plus launch at login and the global shortcut
from §4. Migration `202610221330_reminders_state.sql`.

- **Files.**
  - `src/shared/reminders/` is pure and zod-free, so the renderer imports it as values (an `eslint.config.mjs` block keeps zod and contract values out):
    - `schedule.ts`: `nextDue`, the state transitions and `decideDelivery`;
    - `label.ts`: the row's words;
    - `shortcut.ts`: accelerators.
  - `services/reminders/`:
    - `service.ts`: the scheduler, electron-free;
    - `store.ts`: the `reminder_state` row;
    - `timeZone.ts`;
    - `index.ts`: the only Electron glue.
  - `composer/reminders/` holds the row, its menu and the fields that Settings and onboarding share. The settings sections are `reminders` and `startup`; the onboarding step is `reminders`.
- **Settings and state.**
  - Preferences are `reminders.*` settings:
    - `intervalMinutes`;
    - `workStart` / `workEnd` (`HH:MM`);
    - `days` (ISO, 1 = Monday);
    - `dailyCap`;
    - `paused`, which the tray menu also toggles;
    - `autoOpen`, `notificationOnly`;
    - `shortcut`.
  - What changes on every fire lives in the one-row `reminder_state` table. Times are ISO, all of them except `snoozed_until` are clamped to now when the clock goes backwards, and `snoozed_until` is capped at now + 8 days.
- **The schedule** (`nextDue`). The rules:
  - Nothing is due while paused, or until the `reminders` onboarding step is in `ui.onboardingSeen`. Moving past that step restarts the interval.
  - Otherwise the latest of these applies:
    - `interval_from` + interval. The interval restarts on a fire, a dismissal, unpausing, clearing a snooze, the end of onboarding and the first run;
    - the snooze;
    - `last_published_at` + 60 min;
    - 2 min after launch;
    - 1 min after a `reminders.*` settings change.
  - That time then moves into the next working window: the start's local day must be a working day; end ≤ start runs past midnight; end == start is all day. A due time that falls past a window's end moves to the next window's start.
  - A local day whose cap is reached moves on to the next day.
  - Zone math uses `Intl` with the detected zone. A DST gap moves forward; an overlap takes the earlier instant.
  - `nextDue` returns the rule that set the time (`reason`), which the labels use.
- **The timer.** One `setTimeout`, re-armed at most 60 s ahead:
  - every tick reads the zone again from the `/etc/localtime` link (not V8's cached zone) and the wall clock;
  - a tick more than 90 s late counts as a wake from sleep;
  - `resume`, `unlock-screen` and `user-did-become-active` wait 30 s, then tick;
  - a tick fires only when `nextDue(now) ≤ now`, so any amount of missed time collapses into at most one reminder, and only inside working hours;
  - state is written before delivery.
- **Delivery** (`decideDelivery`):
  1. The composer is already visible: nothing pops up. The reminder still counts.
  2. Nobody is there (idle ≥ 5 min, a locked screen, or another macOS user active): the reminder waits and is checked on each tick.
  3. Notification-only: a notification.
  4. "Open dropdown" off: a notification, and the dropdown (when safe) only if that notification fails or none can be shown.
  5. Otherwise the dropdown, unless an xBot modal is up or full-screen work is likely; then a notification.
- **The cycle.**
  - A fire opens a cycle: an id, the delivery and T7's top idea, which `projects:ideas-changed` keeps current.
  - It ends on a dismissal, either Skip, a snooze, pause, `post:published` or the next fire. The end closes the notification.
  - A composer hide during a cycle is a dismissal: the next reminder waits a full interval, and a cycle never reopens.
  - An auto-opened composer nobody focuses hides itself after 2 min. An unfocused panel gets no blur, so an outside click can't close it.
- **Notifications.**
  - Each carries the fixed id `xbot-reminder`: the newest replaces the last, and the stale one is removed at launch.
  - Actions are Write Post / Snooze 30 min / Skip. A click or Write Post always opens the composer; Snooze and Skip act only on their own cycle.
  - No `show` within 10 s counts as failed. When reminders depend on notifications (notification-only, or "Open dropdown" off), the row and Settings then say notifications are off.
  - Electron 45 notes that macOS notifications need a signed app, so the ad-hoc signed build may fail here.
  - Onboarding's test notification asks for permission early.
  - Notifications never carry idea text, which comes from project files. An auto-opened dropdown shows "An idea is ready" until it is focused.
- **Ideas and AI.** On a fire, `suggestions().refresh('auto', 'background')` runs only when all of these hold:
  - local AI is ready;
  - `projects().hasNewActivitySince(last_generation_at)`;
  - at least 2 h have passed since the last generation a reminder started.

  `last_generation_at` is written when the refresh starts. It is put back after `ai_busy`, Ollama or model errors, and after a cancellation.
- **What can and can't be detected.**
  - **Can:** a locked screen (`getSystemIdleState`, lock events), fast user switching, user idle time, xBot's own modals (a held window or native dialog, the Studio, shortcut recording) and the composer being open.
  - **Best effort, unverified on a Mac:** native full screen. The guess is that the display under the tray has no menu bar (its work area equals its bounds). With the menu bar set to always auto-hide, this always says "full screen", so xBot sends notifications instead. Chromium may also not refresh display info when Spaces change. A `panel` window floats over full-screen apps, so a miss shows the dropdown over them, unfocused, for at most 2 min.
  - **Can't with public APIs:** Focus / Do Not Disturb, screen sharing, other apps' modal dialogs and browser-only full screen.
  - Nothing captures the screen or watches other apps.
- **`post:published`** starts the cooldown when the event arrives. Reconciliation (T9) can emit it hours after the post.
- **Launch at login** is the OS login item (`app.get/setLoginItemSettings`), read back after each change because the call fails silently. It is offered only in the packaged app (a dev run would register the Electron binary), inside /Applications, on macOS and Windows. "Requires approval" points to System Settings → Login Items.
- **The global shortcut** (default ⌥⌘X, `Alt+CommandOrControl+X`) toggles the composer.
  - Every change goes through one register-first path, including a generic `settings:set`: a failure keeps the old shortcut and writes the old value back after the renderers have the rejected one.
  - xBot refuses combos without two modifiers including ⌘/⌃ (function keys excepted), and macOS-reserved ones (⌃⌘Space, ⌥⌘Esc, ⇧⌘Q, …), which `register()` accepts.
  - The settings field records from `event.code` while global shortcuts are suspended. The suspension is lifted on hide, on reload and before registering.
  - A stored shortcut that fails at launch is kept, and its error is shown.
- **Preview mode** has no timer, notifications or shortcut; the row keeps its sample label.
- **Tests.**
  - `tests/unit/reminders-schedule.test.ts` covers hours, days, DST and zones, snooze, pause, the cap and the cooldown.
  - `tests/unit/reminders-service.test.ts` covers sleep recovery, restart, dismissal, and no AI call without new activity.

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

  Dev adds only what Vite needs: inline scripts and styles, and the dev
  server's own HMR websocket (`ws://localhost:<its port>`, read from the
  running server). No other localhost port is reachable, so the renderer can
  never call Ollama directly, and no `eval` or remote origins. If you need a new source, change
  the plugin and say why in the PR.
- **Navigation:**
  - `will-navigate` is always blocked;
  - `will-redirect` is blocked across origins;
  - `<webview>` is blocked;
  - `setWindowOpenHandler` always denies.
  - Links to the allowlist (`https:` on `x.com`, `twitter.com`, `ollama.com`,
    `github.com`, `ffmpeg.org`, `brew.sh` and their subdomains) open in the user's browser through
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
- **Clipboard:** xBot only writes it (`drafts.copyText`, on a click) and never
  reads it.
- **Credentials:** tokens are stored only through Electron `safeStorage`. If
  `safeStorage.isEncryptionAvailable()` is false, refuse to store them and say
  why; never fall back to plaintext. T9's vault (`services/x/vault.ts`) also
  refuses Linux's `basic_text` backend (a hard-coded key), uses Electron 45's
  async calls, and never touches safeStorage at launch (no Keychain prompt).
- **Untrusted input:** treat project files, model output and X API responses as
  untrusted. Validate them with zod at the boundary.
- **Network:** no local HTTP server, no telemetry, no remote AI. Network access
  is only for explicitly requested model downloads and X. The one exception to
  "no local HTTP server" (SPEC §2 allows it for OAuth) is T9's sign-in
  callback (`services/x/loopback.ts`): it binds `127.0.0.1` only, answers only
  `GET /callback` with the expected `Host` and `state`, and lives only while a
  sign-in waits (closed after the callback, on cancel, or after 5 min).

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
- `twitter-text` (the counter) is bundled into the composer and, since T9,
  into main (validation before posting, URL matching for reconciliation). Its
  core-js@2 polyfills patch no globals on Electron's V8 (checked). Its
  `core-js@2` dependency's postinstall only prints a banner, so it is listed
  as `core-js: false` under `allowBuilds`. Renderer code never imports values
  from contract files (they pull in zod); types only.
- `pixelmatch` and `pngjs` are devDependencies for the Studio's export
  agreement tests only (T5's video tests use `pngjs` too).
- `ignore` (gitignore matching for project folders) is bundled into main.
- **Native modules** must ship N-API prebuilds, or be rebuilt for Electron. Add a
  `files` filter in `electron-builder.yml` so only the target platform's binary
  ships.

## Scripts and tests

| Command | Does |
|---|---|
| `pnpm dev` | electron-vite dev server plus Electron, with hot reload for the renderer |
| `pnpm build` | builds `out/main`, `out/preload` and `out/renderer` |
| `pnpm test` | Vitest unit tests (`tests/unit/**/*.test.ts`, Node environment) |
| `pnpm test:e2e` | builds, then runs the Playwright `_electron` tests (`tests/e2e`), including the preview-mode journey |
| `pnpm typecheck` | `tsc` for `tsconfig.node.json` (main, preload, shared, tests), `tsconfig.web.json` (renderer, shared) and `tsconfig.scripts.json` (`scripts/**/*.ts`, with the DOM lib for `page.evaluate` bodies) |
| `pnpm lint` | ESLint, including the process-boundary rules |
| `pnpm package` | build plus electron-builder: `dist/*.dmg` and `dist/*.zip` on macOS, `dist/*.zip` on Linux |
| `pnpm icons` | re-renders the tray PNGs from `resources/tray.svg` and `build/icon.png` (1024²) from `resources/icon.svg` |
| `pnpm fixtures` | builds, then re-renders `resources/fixtures/`: the PNG from `scripts/fixtures/my-tiny-tool.html`, the MP4 from it with FFmpeg, and the framed PNG through the app's own Add to post. Needs FFmpeg with libx264 |
| `pnpm preview:ui` | builds, then opens preview mode on a fresh temporary userData (see "Preview mode") |
| `pnpm capture` | builds, then captures both surfaces and compares them with the reference (see "Design system → Visual verification"). Needs FFmpeg |

- Modules that unit tests import must not import `electron`. Put the logic in a
  pure module, as `position.ts`, `ipc/core.ts` and `db/` do, and pass in the
  logger and similar dependencies.
- The e2e test launches `electron .` with `XBOT_E2E=1` and a temporary
  `XBOT_USER_DATA_DIR`. In unpackaged runs only, `XBOT_E2E=1` exposes
  `globalThis.__xbotTest` (`toggleComposer`, `openStudio`, `fireReminder`), so
  tests can drive the real code paths. Under `XBOT_E2E=1` the reminder timer
  never fires on its own; `fireReminder` fires one through the real delivery
  rules.
- The video tests (T5) run real FFmpeg:
  - `tests/unit/video-{export,import}.test.ts` run on the electron-free
    pipeline, with fixtures made by lavfi in `beforeAll`, never committed;
  - `tests/e2e/studio-video.spec.ts` drives the real Studio. It writes
    `test-results/captures/studio-video.png`.

  They skip with a message when FFmpeg is missing, and
  `XBOT_REQUIRE_FFMPEG=1` turns that skip into a failure. So does
  `tests/e2e/journey.spec.ts` (T10), the whole user journey in preview mode:
  write and attach, edit in the Studio and add to post, reopen the same
  document, restore the video draft and export it, relaunch, and the
  post-it-yourself path with nothing reaching X. The helpers are in
  `tests/unit/helpers/video.ts` (services) and `videoFixtures.ts` (fixtures
  and readers, also used by the e2e, so they import no database code).
- The Studio specs (`tests/e2e/studio-*.spec.ts`, helpers in
  `studio-harness.ts`) also pass `--force-device-scale-factor=1`, so a 100 %
  preview canvas has the export's pixel size, wait for the preview canvas's
  `data-drawn-key` to equal its `data-want-key`, and read `xbot.db` read-only
  from the test process.
- **On Linux CI:**
  - run e2e under `xvfb-run -a`;
  - Ubuntu's AppArmor blocks Chromium's sandbox for an unpackaged Electron, so
    the e2e test passes `--no-sandbox` on Linux, and `pnpm dev --noSandbox`
    starts dev;
  - never add `--no-sandbox` to app code.

## Packaging

`electron-builder.yml` builds an unsigned app; code signing and notarization
are optional and not set up (its comments say what to change, and the README
how to open the unsigned app):
- **Targets:** on macOS a `dmg` and a `zip` for each of `arm64` and `x64`. Not
  universal: each build ships only its own better-sqlite3 prebuild, which a
  universal merge can't reconcile. Linux makes a `zip`, for CI only.
- **Icon:** `build/icon.png` (from `resources/icon.svg`, the AppMark on the
  macOS icon grid), turned into the `.icns`.
- **Signing:** mac uses `identity: '-'` (ad-hoc) because Apple Silicon refuses
  fully unsigned binaries, with `hardenedRuntime: false`.
- **Info.plist:** `mac.extendInfo.LSUIElement: true` means no Dock icon and no
  app-switcher entry.
- **Fuses:** `runAsNode`, `NODE_OPTIONS` and `--inspect` are off, and the app
  loads only from the asar.
- **Native code:** `asarUnpack` covers `*.node`, and `npmRebuild: false`.
- **Prebuilds:** only the target platform's better-sqlite3 prebuild ships.
- **Tray PNGs** go to `Contents/Resources` via `extraResources`, and preview
  mode's three fixtures to `Contents/Resources/fixtures/`.
- **FFmpeg** is not bundled (`docs/FFMPEG.md`); the packaged app shows the
  "FFmpeg not found" guidance until the user installs it.
- **Checked on Linux only** (T10's runner): `pnpm package` makes
  `dist/xbot-<version>.zip` with exactly one prebuild (`linux-x64.node`), the
  fixtures and no FFmpeg, and the packaged binary logs `xBot ready` (and, with
  `--preview`, `preview: seeded`). The macOS `.dmg`/`.app` has not been built
  or launched by a ticket yet.
