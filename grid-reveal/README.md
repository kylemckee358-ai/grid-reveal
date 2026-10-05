# Grid Reveal

A Premiere Pro panel that turns one clip into a grid of itself, revealing one
cell at a time. Built for the "3x3 grid reveal" effect: select a clip, click
one button, get 9 cropped copies stacked on 9 tracks that pop in one at a
time, 2 frames apart, until the full frame has assembled.

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

1. On your timeline, select the one clip you want to turn into a grid.
2. Make sure there are enough **empty video tracks directly above it** —
   for the default 3x3 grid, that's 8 empty tracks above the clip's own
   track (9 total). If there aren't enough, the panel will tell you exactly
   how many to add: right-click the track header area on the left of the
   timeline → **Add Tracks**.
3. In the Grid Reveal panel, leave the defaults (3 rows, 3 columns, 2 frame
   delay, Instant pop) or change them.
4. Click **3x3 Grid** (the button relabels itself if you change rows/columns).
5. Done. The status box tells you which tracks got used. Scrub the timeline
   to watch the cells pop in.

**To undo:** press Ctrl+Z (Windows) / Cmd+Z (Mac) four times. The grid build
happens as four grouped steps (clone the copies, add the Crop effect, set
each crop region, set the reveal keyframes), so four undos fully reverts
back to your original single clip.

## Things to know

- **Audio:** this tool only touches the video image. If your clip has audio
  attached, mute or detach it before running the effect — cloning the clip
  may carry a copy of the audio onto a new track too, and 9 overlapping
  copies of the same audio will sound wrong. This wasn't part of the
  original effect, so it's left for you to handle however you'd normally
  mute a clip.
- **Reveal order** is currently always row-major: 1→2→3 / 4→5→6 / 7→8→9,
  matching the original spec. The code is structured so a future "reveal
  order" control just needs to supply a different ordering — no rewrite.
- **Reveal style:** only "Instant pop" (hard cut, no fade) is wired up for
  now. "Fade" is shown in the dropdown as a placeholder for later.
- If you ever see an error mentioning it couldn't find the "Crop" effect,
  your Premiere version may have renamed it — the panel will say so
  explicitly rather than silently doing the wrong thing; let me know and
  I'll adjust the match name.

## Changing the defaults

Rows, columns, and frame delay are editable right in the panel before you
click the button — no code changes needed for everyday use. If you want to
change deeper behavior (e.g. which track direction it stacks on, or how the
crop math works), the logic is in `src/gridBuilder.js`, laid out in the same
order as the steps above.
