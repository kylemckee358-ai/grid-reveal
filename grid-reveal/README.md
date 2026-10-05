# Grid Reveal

A Premiere Pro panel that turns one clip into a staggered grid of itself.
Select a clip, click one button, and it:

1. Every cell's spatial position is fixed, row-major (cell 1 = top-left,
   the last cell = bottom-right) — that's what the crop is based on, and
   it's separate from reveal order.
2. The **reveal order** setting decides which cells pop in together and in
   what sequence, as a series of steps — each step can be a single cell or
   a whole group:
   - **Sequential:** one cell per step, 1→2→3→...
   - **Spiral:** one cell per step, clockwise from top-left into the center
     (for 3x3: 1,2,3,6,9,8,7,4,5).
   - **Horizontal:** one *column* per step — all of column 1 pops in
     together, then column 2, then column 3.
   - **Vertical:** one *row* per step, top to bottom.
   - **Reverse order** (checkbox) flips the step sequence — last step
     first — without changing which cells are grouped together.
3. The clip gets cloned onto a track for every grid cell, plus one more
   dedicated track for a continuation clip if the footage runs long enough
   to need one.
4. A shared "split point" is defined at `frameDelay x number-of-steps`
   frames after the clip's start — that's the whole reveal window. Every
   cell's end gets pulled back to that split point. A cell in the
   first-revealed step needs no other change; every other cell also gets
   its start pushed forward by (its step's position x frameDelay) frames —
   because trimming a clip's head moves its timeline start forward while
   its end stays put, cells in later steps start later while every cell
   still ends together, at the split point.
5. If the clip runs longer than the split point, the continuation clip gets
   its start pushed forward by the *full* split-point window (the same
   trimming move, just not capped at the far end) — which both moves it to
   start exactly at the split point *and* makes it continue playing the
   footage that comes right after, rather than restarting from the
   beginning.
6. Crops every grid cell (not the continuation) to its fixed 1/N of the
   frame.
7. If **Grid outlines** is checked, one of the pre-made outline PNGs (see
   `Grid Outlines/` next to this plugin) is placed on one more dedicated
   track, spanning exactly the reveal window (same start as the grid, same
   end as the split point) — so the grid lines are visible while it's
   assembling, then disappear once it converges.
8. If **Flash** is checked, every grid cell (not the continuation) gets a
   Levels effect with its White Input Level keyframed from 80 at the cell's
   own start up to 255 one frame later — a quick blown-out flash that
   settles to normal right as each cell pops in. Keyframe positions on a
   component param are relative to the clip's own start, so this lines up
   automatically with each cell's staggered start, no extra math needed.

The result: cells pop in by step, `frameDelay` frames apart, each showing a
short, slightly later window of the same footage, all converging together
at the split-point frame — and right at that instant, the view snaps to the
full, uncropped frame and keeps playing normally for the rest of the clip.
No opacity animation needed anywhere; the reveal timing comes entirely from
where each clip starts and ends. The reveal-order logic lives on its own in
`src/revealOrder.js`, separate from the grid-building mechanics.

## What you need

- Premiere Pro **26.3.0** or newer (this is confirmed on your machine already).
- **Adobe UXP Developer Tool (UDT)** — free, installed through Creative Cloud
  Desktop:
  1. Open the Creative Cloud desktop app.
  2. Go to the **Apps** tab, search for "UXP Developer Tool".
  3. Install it like any other Creative Cloud app.

You do **not** need Node, npm, or any build tools — this plugin is plain
HTML/JavaScript and loads directly.

## Installing the panel (one-time setup)

1. Open **Premiere Pro** and the **UXP Developer Tool** (UDT) — both at once.
2. In UDT, click **Add Plugin**.
3. Browse to this folder and select `manifest.json`:
   `/Users/kylemckee/Documents/ClaudeCode/Premiere Pro Tools/grid-reveal/manifest.json`
4. The plugin "Grid Reveal" now appears in UDT's plugin list. Click **Load**
   next to it.
5. A new panel tab called **Grid Reveal** appears inside Premiere. Drag it
   next to your Effect Controls panel, or wherever's convenient — Premiere
   remembers where you put it.

Keep UDT open in the background while you edit. You don't need to touch UDT
again unless you quit it, restart your computer, or I update the plugin's
code — in any of those cases, just reopen UDT and click **Load** again (or
**Reload** if it's already in the list).

## Using it

1. On your timeline, select the one clip you want to turn into a grid. It
   needs to be at least `frameDelay x number-of-steps` frames long (18
   frames for the 3x3 Sequential/Spiral default, 6 frames for Horizontal/
   Vertical at a 2-frame delay, since those only take 3 steps) so there's
   room for the split point — if it's shorter, the panel will tell you and
   stop. If it's longer, the extra footage automatically continues,
   full-frame, after the grid finishes revealing.
2. Make sure there are enough **empty video tracks directly above it** —
   for the default 3x3 grid, that's 8 empty tracks for the grid cells, plus
   1 more if your clip is long enough to need a continuation track, plus 1
   more again if Grid outlines is checked (9 to 11 total depending on which
   apply). If there aren't enough, the panel will tell you exactly how many
   to add: right-click the track header area on the left of the timeline →
   **Add Tracks**.
3. In the Grid Reveal panel, leave the defaults (3 rows, 3 columns, 2 frame
   delay, Sequential order, Instant pop) or change them.
4. Click **3x3 Grid** (the button relabels itself if you change rows/columns).
5. Done. The status box tells you which tracks got used. Scrub the timeline
   to watch the cells pop in.

**To undo:** press Ctrl+Z (Windows) / Cmd+Z (Mac) a handful of times — three
as a baseline (clone, stagger, set Crop values), plus one if a continuation
clip was added, plus a few more (import/scale, place, trim) if a grid
outline was added. A few undos fully reverts back to your original single
clip either way.

## Things to know

- **Audio:** this tool only touches the video image. If your clip has audio
  attached, mute or detach it before running the effect — cloning the clip
  may carry a copy of the audio onto a new track too, and 9 overlapping
  copies of the same audio will sound wrong. This wasn't part of the
  original effect, so it's left for you to handle however you'd normally
  mute a clip.
- **Reveal style:** only "Instant pop" (hard cut, no fade) is wired up for
  now. "Fade" is shown in the dropdown as a placeholder for later.
- **Where the crop actually lives:** this tool crops each cell using the
  Crop Left/Top/Right/Bottom controls built into the clip's own **Motion**
  effect (visible in Effect Controls under Motion, alongside Position/
  Scale/Rotation) — not a separately-listed "Crop" effect. If you ever see
  an error mentioning it couldn't find a Crop parameter by name, your
  Premiere version may expose Motion's crop controls differently; let me
  know and I'll adjust the lookup.
- **Grid outlines** only cover square grids with a matching asset in
  `Grid Outlines/` — 2x2, 3x3, 4x4, in Black or White. The checkbox
  disables itself automatically if your rows/columns don't match one of
  those. The first time you use a given size/color, it gets imported into
  your Project panel; after that, the same project item is reused rather
  than importing duplicates on every run. If you add more outline PNGs
  later (say, a 5x5), they need to be dropped into `Grid Outlines/` named
  exactly `Black 5 x 5 Grid.png` / `White 5 x 5 Grid.png`, and `AVAILABLE_SIZES`
  in `src/gridOutline.js` needs `5` added to it.
- **Flash is per-cell, not global.** A single flash over the *entire*
  composited grid at once would need an adjustment layer, and Premiere's
  current scripting API has no supported way to add effects to one — so
  instead, every cell gets its own Levels effect, each flashing right as
  that cell appears. The continuation clip is left out, same as Crop.
  80 → 255 and the 1-frame duration are fixed in `src/flashEffect.js` for
  now (`FLASH_START_VALUE`, `FLASH_END_VALUE`, `FLASH_DURATION_FRAMES`) —
  not exposed as panel fields yet.

## Changing the defaults

Rows, columns, frame delay, reveal order, and reverse are all editable
right in the panel before you click the button — no code changes needed for
everyday use. If you want to add a new reveal order of your own, it's a
self-contained addition to `src/revealOrder.js` (add a case to
`computeRevealGroups` returning an array of cell-index groups, then add it
to the dropdown in `index.html`) — the grid-building logic in
`src/gridBuilder.js` doesn't need to change at all. For deeper changes (e.g.
which track direction it stacks on, or how the crop math works), that logic
is in `src/gridBuilder.js`, laid out in the same order as the steps above.
