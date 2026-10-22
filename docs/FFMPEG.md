# FFmpeg in xBot

The Media Studio uses FFmpeg for everything video:
- reading a video's facts (`ffprobe`);
- the timeline's thumbnails;
- the MP4 export (trim, crop, frame, background, mute).

Images never need it.

T5 (XBOT-G66JJK) made the decisions recorded here, on 2026-10-22. The code is in
`src/main/services/ffmpeg/` and `src/main/services/studio/exports.ts`; see
also ARCHITECTURE.md → "Studio".

## Decision: the user installs FFmpeg; xBot doesn't bundle it (v1)

- **xBot looks for an FFmpeg already on the Mac.** It never downloads one, never asks for Docker, and never ships one inside `xBot.app`. `electron-builder.yml` has no FFmpeg in it.
- **Without FFmpeg** everything else keeps working: writing posts, attaching MP4/MOV to a post, and image editing and export. A video opened in the Studio shows read-only, with a card that says how to get FFmpeg and has **Check again** and **Locate FFmpeg…** buttons. Settings → Status shows an "FFmpeg not found" chip.

### Why not bundle

The licence facts were checked on 2026-10-22:

| What | Licence | Source |
|---|---|---|
| FFmpeg itself | LGPL 2.1 or later. It becomes GPL when built with `--enable-gpl` (and non-redistributable with `--enable-nonfree`). | [ffmpeg.org/legal.html](https://ffmpeg.org/legal.html) |
| `libx264` | GPL. It is in configure's `EXTERNAL_LIBRARY_GPL_LIST`, so any build with it is GPL. | FFmpeg's `configure` |
| VideoToolbox (`h264_videotoolbox`) | Apple's system framework. It is only autodetected (`HWACCEL_AUTODETECT_LIBRARY_LIST`) and is in no GPL or nonfree list. | FFmpeg's `configure` |
| `ffmpeg-static` (npm) | GPL-3.0. Its binaries come from johnvansickle.com (GPLv3, Linux), evermeet.cx (Intel Mac) and osxexperts.net (Apple Silicon). | [github.com/eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) |
| evermeet.cx builds | `--enable-gpl --enable-libx264`, Intel only, with no Apple Silicon build planned. | [evermeet.cx/ffmpeg](https://evermeet.cx/ffmpeg/) |
| osxexperts.net builds | Built with `--enable-gpl` and x264, and labelled "for educational purposes only". | [osxexperts.net](https://www.osxexperts.net/) |
| Homebrew `ffmpeg` | GPL-3.0-or-later, built with x264 and x265 (stable 9.0.2 on 2026-10-22). | [formulae.brew.sh/formula/ffmpeg](https://formulae.brew.sh/formula/ffmpeg) |

No ready-made Mac build is LGPL. Shipping one of the GPL builds inside xBot
would mean meeting the GPL for that binary: offering its exact source,
including the licence text, and so on. It would also mean shipping an H.264
encoder (x264) inside a distributed product, which raises patent licensing
questions (FFmpeg's legal page warns about MPEG LA for commercial products).

The only clean bundle would be an LGPL build that we compile ourselves, for
arm64 and x64. It would leave out libx264, encode with VideoToolbox, and come
with its source, a licence notice, an about-box line and EULA changes, as
FFmpeg's compliance checklist asks. It can't be built or tested from the
Linux runner this ticket ran on, and VideoToolbox can't be observed there
either.

Running a GPL FFmpeg that the user installed themselves puts no obligations
on xBot, because xBot doesn't distribute it. It only spawns it as a separate
program.

### If a later release bundles it (T10)

The locator already looks in `<app>/Contents/Resources/ffmpeg/` (that is,
`process.resourcesPath/ffmpeg/{ffmpeg,ffprobe}`) right after the user's own
pick. A compliant bundle needs all of these:

1. **The build.** FFmpeg built from a release tarball with neither
   `--enable-gpl` nor `--enable-nonfree`, with `--enable-videotoolbox` (the
   default on macOS) and the native `aac` encoder.
   - Build arm64 and x64, and ad-hoc sign them like the app.
   - Check the result: `ffmpeg -L` must say LGPL, and `ffmpeg -encoders`
     must list `h264_videotoolbox` and `aac`, but no `libx264`.
2. **Packaging.**
   - Ship it with `extraResources` (from `resources/ffmpeg/${arch}` to
     `ffmpeg`), together with its `LICENSE.md`/`COPYING.LGPLv2.1`, the configure
     line, and the `git diff` of any changes.
   - Unpack it, outside the asar, and keep it executable.
3. **Source and notices.**
   - Host the matching source tarball next to the xBot download, with the
     notices FFmpeg's checklist lists.
   - Add an about-box line: "This software uses libraries from the FFmpeg project under the LGPLv2.1".
4. **The encoder.** A bundle can only use **VideoToolbox**. That path is
   argument-built here (`-c:v h264_videotoolbox -profile:v high -b:v … -allow_sw 1`)
   but has never been run. Run the video tests on a Mac against the bundle
   before shipping it.

## Installing FFmpeg

```sh
brew install ffmpeg     # https://brew.sh
```

Then press **Check again** in the Studio, or reopen the video.

xBot finds FFmpeg on its own in these places, in this order:
1. the program you picked with **Locate FFmpeg…**;
2. a bundled copy (none in v1);
3. `/opt/homebrew/bin` (Apple Silicon Homebrew);
4. `/usr/local/bin` (Intel Homebrew);
5. every folder on `PATH`.

Apps started from Finder get a short `PATH`, which is why the Homebrew folders
are searched explicitly. `ffprobe` must be there too. It is looked for beside
the chosen `ffmpeg` first, then along the same list.

**Locate FFmpeg…** is for a build somewhere else (a download, MacPorts'
`/opt/local/bin`):
- Pick the `ffmpeg` program itself, or the folder that holds it.
- xBot stores the path as you picked it and checks it again every time, so a
  Homebrew symlink keeps working after `brew upgrade`.
- The renderer can't set this path. It is not a regular setting, so a
  compromised page could never make xBot run another program.

### What counts as usable

A candidate is used only if all of these hold:
- `ffmpeg -version` starts with `ffmpeg version`;
- it is version 4.4 or later (`-stats_period`, used for progress, arrived in
  4.4; git builds without a number are accepted);
- `-encoders` lists an H.264 encoder and `aac`;
- an `ffprobe` answers.

Each check has a 15 s timeout. Checking runs in the background at startup, and
again on **Check again**.

### Troubleshooting

| The Studio says | What to do |
|---|---|
| Video editing needs FFmpeg | `brew install ffmpeg`, then **Check again**. |
| FFmpeg was found, but not ffprobe | Install the full FFmpeg (Homebrew's has both). A lone `ffmpeg` download isn't enough. |
| FFmpeg x.y is too old | `brew upgrade ffmpeg`, which needs 4.4 or later. |
| This FFmpeg can't encode H.264 video | Use Homebrew's build. Minimal builds can leave out libx264 and VideoToolbox. |
| macOS stopped … from running | A downloaded binary is quarantined: `xattr -d com.apple.quarantine /path/to/ffmpeg` (and the same for `ffprobe`), then **Check again**. |
| FFmpeg didn't answer in time | The first run after an upgrade can be slow. **Check again**. |

The log at `~/Library/Application Support/xBot/logs/main.log` names the
binary, its version and the encoder that was chosen.

## How xBot runs FFmpeg

**It is always spawned with an argument array and `shell: false`, never a
shell string.** It runs as a child process at a lower priority (`nice` 10),
so the Studio stays responsive.

### Encoder

| Encoder | When it is used | Settings |
|---|---|---|
| `libx264` | Preferred when present (Homebrew's build has it): the best quality per bit, and what the tests exercise. | `-preset veryfast -crf 20 -profile:v high` |
| `h264_videotoolbox` | When libx264 is missing. | `-b:v` ≈ 0.12 bits per pixel per frame, clamped to 2–20 Mbit/s |
| *(neither)* | | The export is refused, with the fix. |

- **Video output:** `yuv420p`, BT.709 limited range (tagged), with
  `+faststart`.
- **Audio** when it is kept: AAC-LC at 160 kbit/s, down-mixed to stereo
  above two channels and resampled above 48 kHz. That is what X expects (AAC
  LC, mono or stereo).

### Import check (ffprobe)

Before a video is stored, ffprobe must:
- find a real video stream (not cover art) with a size and a duration;
- decode its first frame, counted with
  `-select_streams <v> -count_frames -read_intervals %+#1`.

A file that fails is refused with a sentence the user sees, and nothing is
kept. That catches a cut-off download, a damaged `moov`, frames that are
garbage, and an MP4 with sound only.

What ffprobe reports is stored on the Studio document (`source_video_json`):
- the display size (rotation and pixel aspect applied);
- the video stream's duration;
- the frame rate;
- the streams and their colour.

### Export

The renderer draws the whole composition except the video into one RGBA PNG
at the export size (the *frame layer*), with a transparent hole where the
video shows. FFmpeg then:
1. trims with input `-ss` / `-t`;
2. normalises BT.601 and full-range sources to BT.709 limited range;
3. squares non-square pixels at the probed display size;
4. crops (in 4:4:4, so odd offsets stay exact);
5. scales into the hole's box (`videoPlacement`);
6. converts to constant frame rate (`fps`: `r_frame_rate`, at most 60);
7. pads to the canvas;
8. lays the PNG on top (`overlay=eof_action=repeat`).

Only the picture and the chosen audio stream are mapped. Data, subtitle,
chapter and metadata tracks are dropped (`-dn -sn -map_metadata -1
-map_chapters -1`), so a phone's location tag never reaches a post.

The Studio's preview stacks the same layers: a `<video>` under the canvas,
and the canvas with the same hole.

### Jobs, progress and cancel

- **Progress:** `-progress pipe:1 -stats_period 0.25`. The job's progress is
  `out_time_us` over the trimmed length, clamped to 0–1.
- **One job at a time**, in order.
- **Cancel** sends SIGTERM, then SIGKILL after 3 s. The partial
  `tmp/<job>.mp4` and the layer `tmp/<job>.layer.png` are deleted once FFmpeg
  has exited.
- **Quitting** SIGKILLs FFmpeg at once.
- **After a crash:** at the next start a job that was still running is marked
  failed, and its FFmpeg is killed if `ps` shows it is still that job's
  process. FFmpeg does outlive a crashed parent.

## Known limits

- **HDR** (iPhone HLG or PQ HEVC) isn't tone-mapped. The export's colours will
  be off, and the Studio says so when it opens such a video.
- **ProRes and other codecs Chromium can't play** export fine, but the Studio
  can't preview them.
- **Only FFmpeg 6.1.1 has been tested**, on Linux, with libx264. The human's
  Mac runs 8.x/9.x. Before relying on it, run the video tests there:
  `XBOT_REQUIRE_FFMPEG=1 pnpm exec vitest run tests/unit/video-*.test.ts`.
- **X's size limits:** video exports are capped to the 1080p box (1920 × 1080,
  or 1080 × 1920 upright). X's API docs list tighter "advanced" dimensions,
  and T9 checks X's limits when posting.
