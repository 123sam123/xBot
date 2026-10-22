# xBot final UI reference — measured notes

The orchestrator measured these from the human's reference image on 2026-10-21. The committed image, `docs/reference/xbot-final-ui.png`, is 1900×1046 px, with two glass panels side by side on a blue macOS wallpaper.
The scale is ≈1.483 image px per CSS px, derived from the 420-CSS-px composer width:
- the composer spans image px (44,54)–(667,1003);
- the Media Studio spans (684,54)–(1852,1003).

Every value is **approximate**: always check it against the PNG. T2 (XBOT-6AU4BQ) re-measured the PNG; where its numbers differ from the notes below, the table at the end wins.
## Material (both panels)
- A clear, neutral glass. The blue comes from the wallpaper, so never paint the panels blue.
- Outer corner radius is about 40 CSS px, with soft continuous corners.
- Thin bright specular rim: a 1 px inner edge, brightest at the top-left (≈ rgba(255,255,255,.65)), fading to ≈ .15 at the bottom-right. Add a faint 0.5 px darker outer hairline.
- Soft refractive highlights: large, low-opacity radial white glows near the top-left and the top edge, plus a very slight inner shadow at the bottom.
- Inner cards (editor, attachment card, timeline) are lighter glass: ≈ rgba(255,255,255,.08–.12) fill, a 1 px rgba(255,255,255,.22–.3) border with a top highlight, radius ≈ 18–20 CSS px.
- All text and icons are white. Primary text is #fff; secondary is ≈ rgba(255,255,255,.65–.75).
- Primary buttons are frosted white pills: ≈ rgba(255,255,255,.92) fill with dark navy text (#0d1b3a), semibold, and a soft drop shadow.
- Font: SF Pro (system-ui / -apple-system).

## Write Post composer — about 420 × 635 CSS px
- Content inset is about 36 CSS px left and right; the header row sits ≈ 36 px from the top.
- Header, left: the app icon is a white rounded square (≈32 px, radius ≈8) with blue vertical "audio bars", followed by "xBot" at ≈20 px, medium weight. Header, right: the account handle (≈19 px) plus a chevron-down.
- "Write Post" heading: ≈27 px, semibold/bold, ≈24 px below the header.
- Editor card: about 348 × 128 CSS px with ≈17 px inner padding. Text is ≈20 px with ≈1.3 line-height and a visible white caret. The sample text is "Built a tiny tool because I was tired of doing this manually. Here's how it works."
- Attachment card: ≈100 px tall. It holds a thumbnail (≈152 × 100, radius ≈16) showing the framed screenshot, an "Edit in Studio ↗" label (≈15 px), and a circular ✕ remove button (≈30 px, glass) on the right.
- Dashed upload area: ≈94 px tall with a 1.5 px dashed rgba(255,255,255,.4) border, radius ≈16. Centred inside are a ⊕ glass circle (≈31 px) and the label "Add screenshots or video" (≈16 px).
- Action row: the counter "92 / 280" (≈16 px, white ~60%) on the left, and the "Post ↑" frosted pill (≈136 × 42) on the right.
- A hairline divider (white ~15%), then the reminder row: a clock icon (≈19 px) and "Next reminder in 30 min" (≈15 px, white ~80%).
- There is **no** empty opaque region below the content. The window height fits the content.

## Media Studio — about 790 × 635 CSS px (resizable)
- Top bar ≈ 48 px from the top: "‹ Back to post" (≈17 px) on the left, "Media Studio" centred (≈23 px semibold), and the "Add to post" frosted pill (≈116 × 42) on the right.
- Preview canvas area: ≈711 × 344, radius ≈13. It shows a blue→violet gradient background with the browser-framed screenshot centred (≈481 × 304).
- Browser frame (dark chrome): ≈35 px chrome bar with traffic lights on the left, a centred address pill "🔒 mytool.app", and share / + / tabs icons on the right.
- Floating toolbar: a glass pill (≈581 × 70) overlapping the canvas bottom by about 7 px. It holds 5 items, each an icon (≈20 px) over a label (≈15 px): Background, Frame, Padding, Shadow, Crop. The active item has a lighter glass pill behind it, and thin vertical dividers separate the items.
- Anchored popover: a glass card (≈195 × 118) above and left of the toolbar's Background button, overlapping the canvas. Its title is "Background". Below are 5 colour swatches (≈27 px circles: blue (selected, white ring), violet, lilac, cream, near-black), then a slider with a sun icon at its right end.
- Video timeline (only for video): a glass bar ≈62 px tall containing a play button circle (≈35 px), the time "00:04 / 00:12" (≈16 px), and a filmstrip of thumbnails. The selected trim range has a white 2–3 px rounded border with side handles, and a white playhead line with dots at both ends.
- Footer: an image icon and "1920 × 1080" on the left. On the right, "Fit ⌄" | "75% ⌄" | a fullscreen icon, separated by thin dividers.

## Anti-reference
- An earlier rejected attempt ("Buildlog") used an opaque navy panel, a muted teal Post button, and left a large empty opaque region below the composer. Do not reproduce any of these.
- The milky silver look was also rejected.

## Re-measured by T2 (XBOT-6AU4BQ)

T2 measured the committed PNG at 1.483 image px per CSS px, using text widths and cap heights. The type is smaller than the estimates above. `src/renderer/design-system/tokens.css` and the page styles use these values.

| Element | CSS px |
|---|---|
| Composer | 420 × 640, content inset 36, header icon 30 at y≈40 |
| "xBot" / handle | 18 medium / 17.5 |
| "Write Post" | 25.5 bold |
| Editor card | 348 × 128 at y≈148, text 20/26 |
| Attachment card / thumbnail | 100 tall / 154 × 100 |
| "Edit in Studio ↗", "Add screenshots or video" | 14.5, 15 |
| Dashed zone | 95 tall, dashes ≈ 6 on 5 |
| Counter / reminder text | 14.5 / 14 |
| Post pill | 137 × 42, "Post" 17 semibold |
| Divider / reminder row | y≈573 / y≈603 |
| Studio | 788 × 640 (the window is 790 × 635) |
| "‹ Back to post" / "Media Studio" / "Add to post" | 16.5 / 23 semibold / 116 × 42, label 16 |
| Canvas | 712 × 346 at y≈88 (inset 38–39 per side) |
| Toolbar | 583 × 72, overlaps the canvas by ≈9; labels 12 |
| Background popover | 196 × 118, 12 above the toolbar; title 14; swatches 27 with 6 gaps |
| Timeline | 740 × 65 (inset 24); time 13.5; filmstrip ≈7 frames, trim ≈0.13–0.71 |
| Footer | centred at y≈603; "1920 × 1080", "Fit", "75%" at 14 |

The reference's toolbar sits ≈6 px left of the canvas centre. xBot keeps it centred.

