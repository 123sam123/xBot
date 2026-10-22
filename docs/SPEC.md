# xBot — original product brief (verbatim from the human, 2026-10-21)

> Reference image: "xBot final UI reference" (two glass panels, Write Post + Media Studio, on a blue macOS wallpaper). The visual target is authoritative. See ticket artifacts / docs/reference/.

Build **xBot**, a polished macOS menu bar application that helps us turn the small tools we build every day into authentic X posts.

The attached final xBot UI reference is the authoritative visual target. The attached macOS menu bar screenshot shows where this application lives.

Implement the actual application. Do not stop at a plan or static mockup.

## 1. Product and scope

xBot lives in the macOS menu bar.

Clicking its menu bar icon opens a compact "Write Post" dropdown.

At a configurable interval, default 30 minutes, it reminds us to share what we are building. The dropdown can appear automatically when a reminder fires, according to the reminder preferences below.

We can:
- Write a post.
- Get locally generated suggestions about selected projects.
- Drag in screenshots or video.
- Open Media Studio.
- Add browser framing, backgrounds, padding, shadow, and crop.
- Attach the polished result.
- Publish to X.

There are exactly two primary surfaces:
1. Write Post dropdown.
2. Media Studio window.

Settings, onboarding, project selection, drafts, and suggestions use small sheets or popovers inside these surfaces.

No dashboard, permanent navigation sidebar, marketing site, or analytics platform.

## 2. Keep the implementation simple

Use:
- Electron.
- React.
- TypeScript.
- Vite.
- A single shared design system.
- SQLite for structured persistence.
- Application-support directories for media.
- Native Ollama running on the same device.
- Local FFmpeg for video rendering.
- Electron Builder for packaging.
- Vitest and focused UI/integration tests.

Use an Electron main-process service layer with a narrow typed preload bridge.

Do not introduce a local HTTP server unless a specific integration requires one. OAuth may use a short-lived callback listener if supported by the provider.

Do not require Docker, Redis, a cloud backend, accounts for our application, or paid AI APIs.

This supersedes earlier Docker/backend requirements.

Keep the architecture small:
- Main process: tray, windows, persistence, project scanning, Ollama calls, file operations, export jobs, reminders, and X integration.
- Renderer: interface and interactive preview.
- Shared package/module: schemas, composition geometry, and typed contracts.

Avoid unnecessary workspace packages and infrastructure.

Inspect repository instructions first. Preserve unrelated work, secrets, existing user data, and useful functioning integrations. Create a safe local checkpoint before replacing obsolete UI code.

Do not push or deploy.

## 3. Match the final visual reference

Reconstruct the attached final xBot image closely.

Its defining material:
- Clear liquid glass.
- Strongly rounded flowing edges.
- Thin bright specular perimeter.
- Soft refractive highlights.
- Transmitted and blurred background colors.
- White typography and icons.
- Frosted white primary buttons with dark text.
- Subtle layered translucent controls.

Do not recreate earlier rejected opaque navy or milky silver designs.

The reference looks blue because of the wallpaper behind the glass. Do not simply paint the application solid blue.

Implement:
- Neutral transparent material.
- Native backdrop effects where supported.
- Layered edge highlights and restrained shading.
- A reasonable fallback for platforms without native glass effects.

Do not assume CSS backdrop-filter can blur the desktop behind a native window.

Investigate the installed Electron version's supported native materials. Use a small platform-specific bridge only if necessary and maintainable. Do not add fragile private macOS APIs.

Keep text readable against variable wallpapers. Provide a subtle adaptive scrim and reduced-transparency fallback.

Do not blur text, icons, or uploaded media.

The reference presents two windows side by side for demonstration. The actual application uses separate native windows.

Do not bake wallpaper, UI text, or controls into a background image.

## 4. Menu bar behavior

Create a crisp monochrome macOS template tray icon that works in light and dark menu bars.

Click:
- Toggle the composer.
- Position it below the tray icon.
- Clamp within the active display's usable bounds.
- Handle display scaling and multiple monitors.

Right-click menu:
- Write Post.
- Open Media Studio.
- Pause reminders.
- Settings.
- Quit.

The composer:
- Approximately 420 CSS pixels wide.
- Fits its content.
- Does not leave a large opaque empty region underneath.
- Has transparent rounded outer corners.
- Remembers its draft.
- Closes on Escape.
- Closes on outside click when appropriate.
- Does not close during file pickers or internal popovers.

Support optional launch at login and a configurable global shortcut.

Use one application instance.

Closing a window does not quit the app or delete work.

## 5. Write Post layout

Match the reference hierarchy.

Header:
- Small xBot icon and "xBot".
- Actual selected account handle with dropdown.

Heading:
"Write Post"

Text editor:
- Comfortable multiline input.
- Autosave.
- Clear cursor/focus treatment.
- Functional emoji picker or omit the emoji button.
- No large AI interface occupying the default layout.

Attachment section:
- Media thumbnail.
- Remove action.
- "Edit in Studio ↗".
- Additional attachments with reorder/remove controls.
- Dashed upload area:
"Add screenshots or video"

Bottom action row:
- Accurate character counter.
- Frosted white "Post ↑" button.

Bottom reminder row:
- Clock icon.
- "Next reminder in 30 min".
- Click to configure/snooze/pause.

Expose draft history, project ideas, and settings through restrained header menus or sheets. Keep the default view visually faithful.

Do not show a fake account as connected. Sample handles belong only in clearly labeled preview fixtures.

## 6. Frictionless onboarding

Make onboarding short and skippable.

Steps:
1. Welcome: "Share what you're building."
2. Check local Ollama.
3. Select an installed local model or set one up.
4. Optionally choose project folders.
5. Optionally connect X.
6. Choose reminder hours.

Allow manual writing and media editing immediately, even if Ollama or X is not configured.

Show clear status:
- Local AI ready.
- Ollama not running.
- Model needed.
- X disconnected.
- Export running.

Avoid asking for an AI API key.

## 7. Fully local Ollama

All AI inference must use local Ollama.

No OpenAI, Anthropic, remote Ollama, or other hosted fallback.
No silent cloud routing.

Default endpoint:
http://127.0.0.1:11434

Call it from the main process, not directly from the renderer.

Before coding, verify current official Ollama documentation for:
- Installed model listing.
- Model inspection and capabilities.
- Chat generation.
- Structured outputs.
- Streaming.
- Model downloads.
- Request cancellation.
- Model lifecycle controls.
- Disabling cloud functionality.

Document the verified API behavior.

Local-only enforcement:
- Allow only loopback endpoint configuration.
- Reject redirects to nonlocal hosts.
- Do not accept cloud-backed models merely because they appear through a localhost API.
- Inspect model metadata where available.
- Explain how to configure Ollama's official local-only/cloud-disabled mode.
- If locality cannot be established, do not generate; show actionable setup guidance.
- Never change the user's global Ollama configuration silently.

Network access is allowed for explicitly requested model downloads and X integration. Project context must never be sent externally.

AI should work offline after the model is downloaded.

Be accurate about "free": no per-request AI fees, but the device uses memory, compute, storage, and electricity.

## 8. Model setup and performance

Detect:
- Whether Ollama is reachable.
- Installed models.
- Whether the selected model is suitable for text generation.
- Approximate device memory.

Offer a small set of verified local model options appropriate to hardware. Verify current exact model identifiers rather than guessing.

Default to an already installed suitable small model where possible.

Before downloading:
- Show model name.
- Approximate download size if available.
- Explain local resource usage.
- Require an explicit Download action.

Show download progress and cancel/retry.

Do not download several huge models automatically.

Performance:
- One generation at a time by default.
- Bounded context.
- Cache unchanged project summaries.
- Generate only on meaningful changes or explicit request.
- Cancel button.
- Timeouts with recovery.
- Avoid holding models in memory indefinitely.
- Do not unload models belonging to unrelated active Ollama work.
- Keep the UI responsive while generating.
- Low-resource mode.

Explain small models may produce weaker drafts. Make editing easy rather than pretending all hardware produces identical results.

Text-only AI is sufficient for the first version. Do not require a vision model or send images for analysis by default.

## 9. Local AI experience

Provide:
- "Suggest a post."
- "Make shorter."
- "More casual."
- "Different angle."
- Optional selected-text rewriting.

Do not overwrite manually edited text without a reversible action.

For a story, offer three options:
1. Problem → solution.
2. Honest progress or lesson.
3. Funny or surprising observation.

Show concise drafts, not essays.

During generation:
- Indicate that it is running locally.
- Keep existing content editable.
- Allow cancellation.
- Show suggestions as they become available where compatible with structured validation.
- Preserve input and drafts on failure.

Use validated structured output with bounded retries. Do not let malformed model output crash the interface.

## 10. Voice

General build-in-public style:
- Casual.
- Short.
- Specific.
- Personal.
- Occasionally funny.
- Grounded in our actual experience.

Use broad indie-builder traits rather than closely imitating a particular creator.

Avoid:
- Corporate announcements.
- Generic AI phrases.
- Forced inspiration.
- Fake revenue.
- Fake customers.
- Unsupported time savings.
- Fake vulnerability.
- Claims of guaranteed virality.
- Repetitive hooks.
- Default hashtag piles.

Voice preferences:
- Casual/polished.
- Dry/playful.
- Technical/accessible.
- Emoji preference.
- Profanity preference.
- Banned phrases.
- Approved examples.

Store locally.

Learn through an editable style brief derived from examples we explicitly approve. No training pipeline is needed.

## 11. Understand selected projects

Let users select folders through the native file picker.

Read only approved folders.

Inspect bounded relevant information:
- README.
- Approved documentation.
- Package manifests.
- Recent Git commit messages.
- Changed filenames.
- Diff statistics.
- Optional sanitized diff excerpts.

Provide an editable project brief:
- Name.
- What it does.
- Why we built it.
- Intended users.
- Current stage.
- Public URL.
- Public-sharing restrictions.
- Confirmed facts.

Also provide quick manual context:
"What did you build today?"

Track scan checkpoints and deduplicate events.

For non-Git folders, use approved docs, bounded file metadata, and manual notes.

Do not execute repository code.

A commit does not establish that something shipped or worked. Mark inferred claims for confirmation.

## 12. Story suggestions

Find:
- Annoying problem solved.
- Small feature finished.
- Before/after.
- Bug and fix.
- Funny failure.
- Useful lesson.
- Demo.
- Real question for other builders.

Keep source references available in a compact "Why this suggestion?" view.

Never fabricate measurable claims.

If no useful activity exists, ask for one sentence of context instead of producing repetitive filler.

Dismissed stories should not keep returning.

## 13. Reminders and automatic dropdown

Default interval: 30 minutes.

Default working hours: a reasonable editable daytime range using the detected OS timezone.

Settings:
- Interval.
- Working hours.
- Days.
- Pause.
- Snooze.
- Daily cap.
- Notification-only mode.
- "Open dropdown on reminder" toggle.

Match the requested behavior:
- Menu bar click opens dropdown.
- With automatic dropdown enabled, a due reminder opens it without stealing keyboard focus when the OS allows.
- Never start typing into the app on the user's behalf.
- If automatic display cannot be done safely, show a notification that opens the composer when clicked.
- Suppress automatic opening during detected full-screen work, locked screen, or active modal interactions where feasible.
- Do not use invasive screen monitoring.
- Never repeatedly reopen a dismissed dropdown.
- Coalesce missed reminders after sleep.
- Persist cooldowns across restart.
- Suppress reminders shortly after publishing.
- Do not queue a burst of old reminders.

Show a useful relevant suggestion when possible.

Do not run expensive AI generation at every interval if nothing changed.

Reminder actions:
- Write Post.
- Snooze.
- Skip.

## 14. Media Studio

Open a separate resizable window.

Match reference:
- Liquid-glass shell.
- "Back to post" upper left.
- "Media Studio" centered.
- "Add to post" upper right.
- Large central preview.
- Floating glass action bar.
- Anchored settings popover.
- Slim video timeline when applicable.
- Dimensions and zoom footer.

Toolbar:
- Background.
- Frame.
- Padding.
- Shadow.
- Crop.

No permanent sidebar.

One settings popover open at a time.

Do not shift the canvas when opening a popover.

Upload images or video through drag-and-drop or file picker.

Preserve aspect ratio by default.

## 15. Editing features

Background:
- Curated gradients.
- Solid color.
- Uploaded image.
- Gradient angle/colors.
- Optional background-image blur.
- Transparent image output.

Frame:
- Browser.
- Minimal window.
- None.
- Light/dark chrome.
- Editable display address.
- Show/hide address and traffic lights.
- Corner radius and fine border.

The browser frame is decorative; it is not a web browser.

Padding:
- Linked slider.
- Optional horizontal/vertical controls.
- Centering.
- Output ratio: original, 16:9, 1:1, 4:5, custom.

Shadow:
- None.
- Soft.
- Elevated.
- Adjustable blur, distance, opacity.

Crop:
- Interactive non-destructive crop.
- Aspect lock.
- Apply/cancel/reset.

Also:
- Undo/redo.
- Reset style.
- Save visual preset.
- Autosave.
- Replace source while preserving compatible styling.

Keep controls compact and obvious.

## 16. Export

Images:
- PNG and JPEG.
- Output dimensions.
- 1×/2× where practical.
- Transparent PNG when selected.
- Real export of the composition only.

Video:
- MP4 input first.
- MOV when supported.
- Playback.
- Thumbnail timeline.
- Trim handles.
- Mute/unmute.
- MP4 export.
- Preserve audio when unmuted.
- Progress and cancellation.

Use local FFmpeg with a documented packaging/license approach. Never require the user to have Docker running for export.

Spawn argument arrays rather than interpolated shell commands.

Use one shared composition model for preview and exports:
- Source dimensions.
- Crop.
- Frame.
- Canvas.
- Padding.
- Shadow.
- Background.
- Video trim.
- Audio settings.

Do not export the application controls.
Do not distort source media.
Test preview/export agreement.

"Add to post":
- Render.
- Save attachment.
- Return to existing composer.
- Preserve text.
- Keep the editable composition linked to its export.

"Edit in Studio" must reopen the original editable document.

## 17. X integration

Use official APIs and user authorization.

Verify current official documentation before implementing:
- Developer access requirements.
- OAuth and native app support.
- PKCE where appropriate.
- Callback restrictions.
- Token refresh.
- Create post.
- Image/video upload and processing.
- Limits and rate handling.

Do not embed a supposedly secret application credential in a distributed desktop binary. Choose a supported public-client flow, or document a user-owned developer-app setup if needed. If secure publishing requires a hosted component, explain that clearly rather than silently adding one.

Keep inference entirely local regardless of publishing architecture.

Provide:
- Connect account.
- Actual handle.
- Switch/disconnect.
- Secure token storage.
- Upload progress.
- Video processing status.
- Success with real URL.
- Actionable errors.

Validate weighted text length and media combinations using verified platform constraints.

Never automate X through stored passwords or session cookies.

If access is missing, preserve the draft and offer:
- Copy text.
- Export media.
- Open X.

Explain manual media attachment where required.

Do not claim X publishing is free because local AI is free.

## 18. Safe and reliable publishing

Post only after explicit user action.

Persist:
draft → queued → uploading → processing → publishing → published.

Also:
failed, canceled, needs reconciliation.

Prevent repeated clicks from creating duplicate jobs.

Freeze account/content/media for each job.

If the remote outcome is uncertain after a timeout, do not blindly retry create-post. Show verification/reconciliation.

Store real returned IDs.

Do not fabricate success, URLs, or analytics.

Scheduling is optional secondary scope; finish immediate posting first.

## 19. Local persistence and security

Store data in the proper application support directory, not the repository.

Use:
- SQLite migrations.
- Atomic draft updates.
- Foreign keys.
- Clear media ownership.
- Temporary-file cleanup.
- Backup/export capability.

Use OS-protected storage for tokens where available. Detect insecure fallback behavior and do not silently store credentials as plaintext.

Electron:
- contextIsolation.
- nodeIntegration disabled.
- Narrow validated preload bridge.
- Validate IPC sender and payloads.
- Block unexpected navigation.
- Restrict external links.
- CSP.

Project privacy:
- Respect .gitignore and app-specific ignore rules.
- Exclude secrets, .env, private keys, dumps, dependencies, build output.
- Prevent path traversal/symlink escapes.
- Bound file sizes and scan work.
- Treat repository content as untrusted model input.
- Do not record screens, keystrokes, clipboard, or browser history.
- No telemetry by default.

## 20. Setup and developer experience

Provide:
- Clear README.
- Lockfile.
- Exact development commands.
- Build/package scripts.
- Ollama troubleshooting.
- Model setup.
- X setup.
- FFmpeg setup and packaging.
- Local storage locations.
- Backup instructions.

Aim for:
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm package

Use exact scripts that actually work.

Provide a deterministic visual-preview mode using local sample media and no external publishing.

The application must remain usable without:
- Ollama installed.
- A downloaded model.
- X credentials.
- Network access.

Clearly distinguish unavailable integrations from working manual features.

No fake AI or fake publishing in normal mode.

## 21. Verify the actual UI

Capture both implemented surfaces.

Compare against the attached final xBot reference at matching logical dimensions.

Iterate on:
- Window bounds.
- Glass appearance.
- Reflected edges.
- Typography.
- Spacing.
- Button appearance.
- Attachment card.
- Floating toolbar.
- Popover.
- Timeline.

Use side-by-side or overlay comparisons.

Also check against different backgrounds so the glass is genuinely responsive to its backdrop rather than a fixed blue fill.

Do not claim exact visual fidelity without inspecting captures.

If macOS native capture is unavailable, verify renderer geometry and state the remaining native-material check honestly.

## 22. Meaningful tests

Cover:
- Draft restart recovery.
- Composer/Studio round trip.
- Non-destructive edits.
- Image/video export.
- Canceling exports.
- Invalid media.
- Ignore rules and secret redaction.
- Ollama unavailable/model missing.
- Nonlocal endpoint rejection.
- Cloud-model rejection.
- Generation cancellation and malformed responses.
- Reminder quiet hours, snooze, and sleep recovery.
- X account isolation.
- Duplicate posting prevention.
- Uncertain remote outcomes.

Never publish a real test post without approval of the concrete content.

## 23. Implementation order

1. Inspect/checkpoint.
2. Build both visual surfaces closely matching reference.
3. Persistent manual composer.
4. Screenshot editing/export.
5. Video editing/export.
6. Local Ollama onboarding and suggestions.
7. Project context.
8. Reminders.
9. X publishing.
10. Packaging and verification.

Keep scope focused. Finish the complete user journey.

Do not stop at attractive screens with placeholder buttons.

When finished, provide:
- What works.
- Exact run commands.
- Where to configure Ollama and X.
- Actual screenshots of both surfaces.
- Tests run.
- Remaining limitations or unverified integrations.
