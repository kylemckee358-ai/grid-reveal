# Grid Reveal

A Premiere Pro panel that turns one clip into a staggered grid of itself.
Select a clip, click one button, and it:

1. Trims the clip down to exactly `frameDelay x cellCount` frames (18 frames
   for the default 3x3 grid at a 2-frame delay) — this becomes cell 1
   (top-left), on the clip's own track.
2. Clones it onto the 8 tracks above it.
3. Trims each clone's head forward by 2 more frames than the last (clone 1
   loses 2 frames, clone 2 loses 4, clone 3 loses 6, ...) — because trimming
   a clip's head moves its timeline start forward while its end stays put,
   this staggers every cell's start time while all 9 keep ending on the
   exact same frame.
4. Crops each of the 9 cells to its 1/9 of the frame (top-left, top-middle,
   top-right, middle-left, ...).

The result: cells pop in one at a time, 2 frames apart, each showing
slightly later footage than the one before it, and all 9 converge on the
same final frame at the same instant — no opacity animation needed, the
reveal timing comes entirely from where each clip starts.

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
   needs to be at least `frameDelay x cellCount` frames long (18 frames for
   the 3x3 default) — if it's longer, the extra gets trimmed off the end
   automatically; if it's shorter, the panel will tell you and stop.
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

**To undo:** press Ctrl+Z (Windows) / Cmd+Z (Mac) up to five times (fewer if
your clip didn't need trimming to start with). The grid build happens as a
handful of grouped steps — trim the base clip, clone it, stagger the clones,
add the Crop effect, set each crop region — so a few undos fully reverts
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
