/**
 * The actual "3x3 Grid" effect.
 *
 * Takes the single selected clip and builds `rows x cols` staggered,
 * cropped copies of it:
 *
 *   1. A grid cell's spatial position is always fixed and row-major: cell
 *      index i = row * cols + col (cell 0 is top-left, the last cell is
 *      bottom-right). That's what determines its crop region - it has
 *      nothing to do with reveal order.
 *   2. Separately, config.revealOrder + config.reverseOrder (see
 *      revealOrder.js) decide which cells reveal together and in what
 *      sequence, as an ordered array of "groups" - each group a set of
 *      cell indices that pop in at the same step. Sequential and spiral
 *      orders use 1-cell groups (cellCount steps total); horizontal and
 *      vertical group a whole column/row together (rows or cols steps
 *      total, whichever applies).
 *   3. The original clip is cloned onto (cellCount - 1) tracks above it,
 *      plus one more dedicated track for a continuation clip if the
 *      footage runs long enough to need one.
 *   4. A shared "split point" is defined at `frameDelay * numGroups` frames
 *      after the clip's start - that's the total reveal window. Every
 *      cell's end gets pulled back to that split point. A cell in the
 *      first-revealed group gets no other change; a cell in a later group
 *      gets its start pushed forward by (its group's index * frameDelay)
 *      frames - because trimming a clip's head moves its timeline start
 *      forward while its end stays anchored, cells in later groups start
 *      later while every cell still ends together, at the split point.
 *   5. If the clip runs longer than the split point, the continuation clone
 *      gets its start pushed forward by the *full* split-point window (the
 *      same head-trim mechanism, just not capped at the far end) - so it
 *      picks up exactly the footage that comes right after the reveal,
 *      rather than restarting from the beginning.
 *   6. Each of the cellCount grid pieces gets cropped to its own 1/N of the
 *      frame using the Crop Left/Top/Right/Bottom controls built into the
 *      clip's own Motion effect - current Premiere versions fold cropping
 *      into Motion rather than exposing it as a separate addable effect.
 *      The continuation clone is left untouched - full frame, uncropped.
 *   7. Optionally (config.gridOutline), a pre-made grid-outline PNG is
 *      placed on one more dedicated track, spanning just the reveal window
 *      (see gridOutline.js) - only available for square grids with a
 *      matching asset (2x2, 3x3, 4x4).
 *
 * The reveal itself needs no opacity/keyframe animation at all - a track is
 * simply empty before its piece's (staggered) start time.
 *
 * The Motion component and its Crop params are looked up by display name at
 * runtime rather than assumed by index, since component-chain order isn't
 * something the API guarantees.
 *
 * Known simplification: frame-offset math assumes the source clip's native
 * frame rate matches the sequence's frame rate. If they differ, trim amounts
 * may be slightly off.
 */

const {
  ppro,
  getSelectedVideoClipTrackItems,
  findComponentByDisplayName,
  findParamByDisplayName,
  frameToTickTime,
  ticksEqual,
} = require("./premiereHelpers");
const { computeRevealGroups, groupIndexByCell } = require("./revealOrder");
const { isOutlineAvailable, addGridOutline } = require("./gridOutline");
const { addFlashEffect } = require("./flashEffect");

/**
 * @param {object} config
 * @param {number} config.rows
 * @param {number} config.cols
 * @param {number} config.frameDelay - frames between each reveal step
 * @param {string} config.revealOrder - "sequential" | "spiral" | "horizontal" | "vertical"
 * @param {boolean} config.reverseOrder - reveal the steps last-to-first
 * @param {boolean} config.gridOutline - overlay grid outline PNG for the reveal duration
 * @param {string} config.outlineColor - "Black" | "White"
 * @param {boolean} config.flash - white flash (Levels) on each cell as it appears
 * @param {(status: string) => void} onProgress - called with short status strings
 */
async function buildGrid(config, onProgress) {
  const rows = config.rows;
  const cols = config.cols;
  const frameDelay = config.frameDelay;
  const cellCount = rows * cols;
  const report = onProgress || (() => {});
  const wantsOutline = Boolean(config.gridOutline);

  if (wantsOutline && !isOutlineAvailable(rows, cols)) {
    throw new Error(
      `Grid outlines are only available for square grids (2x2, 3x3, 4x4) - ` +
        `${rows}x${cols} doesn't have a matching overlay. Uncheck "Grid outlines" ` +
        `or change rows/columns to match.`
    );
  }

  const groups = computeRevealGroups(
    rows,
    cols,
    config.revealOrder,
    config.reverseOrder
  );
  const numGroups = groups.length;
  const cellGroupIndex = groupIndexByCell(groups);

  const project = await ppro.Project.getActiveProject();
  if (!project) {
    throw new Error("No active project. Open a project in Premiere first.");
  }
  const sequence = await project.getActiveSequence();
  if (!sequence) {
    throw new Error("No active sequence. Open a sequence first.");
  }

  const selected = await getSelectedVideoClipTrackItems(sequence);
  if (selected.length !== 1) {
    throw new Error(
      "Select exactly one video clip on the timeline, then click 3x3 Grid again."
    );
  }
  const original = selected[0];

  const settings = await sequence.getSettings();
  const frameRate = await settings.getVideoFrameRate();

  // --- Step 1: the selected clip must be at least frameDelay * numGroups
  // frames long - that's the total reveal window every piece is carved
  // from. Figure out, from that, whether a continuation clip is needed. ---
  const originalTrackIndex = await original.getTrackIndex();
  const originalStart = await original.getStartTime();
  const originalEnd = await original.getEndTime();
  const requiredDurationFrames = frameDelay * numGroups;
  const requiredDurationTicks = frameToTickTime(
    requiredDurationFrames,
    frameRate
  ).ticksNumber;
  const originalDurationTicks =
    originalEnd.ticksNumber - originalStart.ticksNumber;

  if (originalDurationTicks < requiredDurationTicks) {
    throw new Error(
      `Clip too short. At a ${frameDelay}-frame delay, this reveal needs at least ` +
        `${requiredDurationFrames} frames; your selected clip is shorter than that. ` +
        `Pick a longer clip, or lower the frame delay.`
    );
  }

  const needsContinuation = originalDurationTicks > requiredDurationTicks;
  const continuationTrackOffset = cellCount; // one past the last grid cell
  const outlineTrackOffset = cellCount + (needsContinuation ? 1 : 0); // one past that
  const tracksNeeded =
    cellCount + (needsContinuation ? 1 : 0) + (wantsOutline ? 1 : 0);

  // --- Step 2: is there enough room above the clip's own track for all of
  // that (the grid cells, plus the continuation track and/or outline track
  // if needed)? ---
  const videoTrackCount = await sequence.getVideoTrackCount();
  const requiredTrackCount = originalTrackIndex + tracksNeeded;

  if (videoTrackCount < requiredTrackCount) {
    const tracksToAdd = requiredTrackCount - videoTrackCount;
    const extras = [];
    if (needsContinuation) extras.push("1 for the full-footage continuation");
    if (wantsOutline) extras.push("1 for the grid outline overlay");
    const extraNote =
      extras.length > 0
        ? ` (${cellCount} for the grid, plus ${extras.join(" and ")})`
        : "";
    throw new Error(
      `Not enough video tracks. This sequence has ${videoTrackCount}, but the ` +
        `${rows}x${cols} grid needs ${requiredTrackCount}${extraNote} (your clip is on track ` +
        `V${originalTrackIndex + 1}). Right-click the track header area, choose ` +
        `"Add Tracks", add ${tracksToAdd} video track(s), then click 3x3 Grid again.`
    );
  }

  // --- Step 3: make sure the tracks we're about to use are actually empty
  // across the clip's full (pre-trim) span, so we never clobber other work. ---
  for (let k = 1; k < tracksNeeded; k += 1) {
    const targetTrackIndex = originalTrackIndex + k;
    const targetTrack = await sequence.getVideoTrack(targetTrackIndex);
    const existingItems = await targetTrack.getTrackItems(
      ppro.Constants.TrackItemType.CLIP,
      false
    );
    for (const item of existingItems) {
      const itemStart = await item.getStartTime();
      const itemEnd = await item.getEndTime();
      const timeOverlaps =
        itemStart.ticksNumber < originalEnd.ticksNumber &&
        itemEnd.ticksNumber > originalStart.ticksNumber;
      if (timeOverlaps) {
        throw new Error(
          `Track V${targetTrackIndex + 1} already has a clip in this time range. ` +
            `Clear tracks V${originalTrackIndex + 2}-V${originalTrackIndex + tracksNeeded} ` +
            `above your clip, then click 3x3 Grid again.`
        );
      }
    }
  }

  const sequenceEditor = ppro.SequenceEditor.getEditor(sequence);

  // --- Transaction A: clone the original clip, untouched, onto the grid
  // tracks above it, plus the continuation track if needed - all at the
  // same (current, full-length) position as the original. ---
  report(`Cloning clip onto ${tracksNeeded} track(s)...`);
  let cloneSuccess = false;
  project.lockedAccess(() => {
    cloneSuccess = project.executeTransaction((compoundAction) => {
      for (let k = 1; k < tracksNeeded; k += 1) {
        const cloneAction = sequenceEditor.createCloneTrackItemAction(
          original,
          ppro.TickTime.TIME_ZERO, // no time offset - same position as the original
          k, // video track offset, relative to original's track
          0, // audio track offset - see README note on linked audio
          true, // alignToVideo
          false // overwrite (tracks are confirmed empty above)
        );
        compoundAction.addAction(cloneAction);
      }
    }, "Grid Reveal: clone copies");
  });
  if (!cloneSuccess) {
    throw new Error("Failed to clone the clip onto the grid tracks.");
  }

  // --- Re-query: find the real clip on each track. At this point all of
  // them still share the original's start time. ---
  report("Locating clones...");
  async function findCloneOnTrack(trackIndex) {
    const track = await sequence.getVideoTrack(trackIndex);
    const items = await track.getTrackItems(
      ppro.Constants.TrackItemType.CLIP,
      false
    );
    for (const item of items) {
      const itemStart = await item.getStartTime();
      if (ticksEqual(itemStart, originalStart)) {
        return item;
      }
    }
    return null;
  }

  const cellItems = [];
  for (let k = 0; k < cellCount; k += 1) {
    const found = await findCloneOnTrack(originalTrackIndex + k);
    if (!found) {
      throw new Error(
        `Could not locate the clip copy on track V${originalTrackIndex + k + 1} after cloning. ` +
          `Undo (Ctrl+Z / Cmd+Z) and try again.`
      );
    }
    cellItems.push(found);
  }

  let continuationItem = null;
  if (needsContinuation) {
    continuationItem = await findCloneOnTrack(
      originalTrackIndex + continuationTrackOffset
    );
    if (!continuationItem) {
      throw new Error(
        `Could not locate the continuation clip after cloning. ` +
          `Undo (Ctrl+Z / Cmd+Z) and try again.`
      );
    }
  }

  // --- Transaction B: every grid cell's end gets pulled back to the shared
  // split point. A cell in the first-revealed group needs no other change;
  // every other cell also gets its start pushed forward by its group's
  // index * frameDelay frames - same head-trim mechanism either way, just
  // skipped when the offset is zero. The continuation clip (if any) gets
  // the same head-trim, by the *full* split-point window, with its end left
  // untouched, so it picks up exactly where the grid's footage leaves off. ---
  report("Staggering cells...");
  const originalInPoint = await original.getInPoint();
  const splitPointTicks = originalInPoint.ticksNumber + requiredDurationTicks;
  const splitPoint = ppro.TickTime.createWithTicks(String(splitPointTicks));

  const trimData = [];
  for (let i = 0; i < cellCount; i += 1) {
    const headTrimFrames = frameDelay * cellGroupIndex[i];
    let newInPoint = null;
    if (headTrimFrames > 0) {
      const offsetTicks = frameToTickTime(headTrimFrames, frameRate).ticksNumber;
      newInPoint = ppro.TickTime.createWithTicks(
        String(originalInPoint.ticksNumber + offsetTicks)
      );
    }
    trimData.push({ item: cellItems[i], newInPoint, outPoint: splitPoint });
  }

  let staggerSuccess = false;
  project.lockedAccess(() => {
    staggerSuccess = project.executeTransaction((compoundAction) => {
      for (const { item, newInPoint, outPoint } of trimData) {
        if (newInPoint) {
          compoundAction.addAction(item.createSetInPointAction(newInPoint));
        }
        compoundAction.addAction(item.createSetOutPointAction(outPoint));
      }
      if (continuationItem) {
        compoundAction.addAction(continuationItem.createSetInPointAction(splitPoint));
      }
    }, "Grid Reveal: stagger cells");
  });
  if (!staggerSuccess) {
    throw new Error("Failed to stagger the grid cells.");
  }

  // --- Locate each grid cell's Motion component and its built-in Crop
  // params. No separate effect needs adding - Motion is always present, and
  // current Premiere versions carry Crop Left/Top/Right/Bottom directly on
  // it. The continuation clip is deliberately skipped - left uncropped. ---
  report("Locating Crop controls...");
  const paramNames = ["Crop Left", "Crop Top", "Crop Right", "Crop Bottom"];
  const cropParamSets = [];
  for (const item of cellItems) {
    const chain = await item.getComponentChain();
    const motionComponent = await findComponentByDisplayName(chain, "Motion");
    if (!motionComponent) {
      throw new Error(
        `Couldn't find the built-in Motion effect on one of the grid cells. ` +
          `Undo (Ctrl+Z / Cmd+Z) and try again.`
      );
    }
    const params = paramNames.map((name) =>
      findParamByDisplayName(motionComponent, name)
    );
    const missing = paramNames.filter((_, idx) => !params[idx]);
    if (missing.length > 0) {
      throw new Error(
        `Your Premiere version's Motion effect doesn't expose a "${missing[0]}" ` +
          `parameter by that name. Let me know and I'll adjust the lookup.`
      );
    }
    cropParamSets.push(params);
  }

  // --- Transaction C: set each grid cell's Crop percentages, by its fixed
  // row-major spatial position - unrelated to reveal order. ---
  report("Cropping each cell...");
  const cellSize = { w: 100 / cols, h: 100 / rows };
  let cropValueSuccess = false;
  project.lockedAccess(() => {
    cropValueSuccess = project.executeTransaction((compoundAction) => {
      for (let i = 0; i < cellCount; i += 1) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const [leftParam, topParam, rightParam, bottomParam] = cropParamSets[i];

        const left = col * cellSize.w;
        const top = row * cellSize.h;
        const right = (cols - 1 - col) * cellSize.w;
        const bottom = (rows - 1 - row) * cellSize.h;
        const params = [
          [leftParam, left],
          [topParam, top],
          [rightParam, right],
          [bottomParam, bottom],
        ];

        for (const [param, value] of params) {
          compoundAction.addAction(param.createSetTimeVaryingAction(false));
          const keyframe = param.createKeyframe(value);
          compoundAction.addAction(param.createSetValueAction(keyframe, true));
        }
      }
    }, "Grid Reveal: set crop percentages");
  });
  if (!cropValueSuccess) {
    throw new Error("Failed to set the Crop percentages on the grid copies.");
  }

  // --- Optional: a brief white flash (Levels, White Input Level 80 -> 255
  // over 1 frame) on every grid cell, timed to each cell's own start. ---
  if (config.flash) {
    await addFlashEffect(project, cellItems, frameRate, report);
  }

  // --- Optional: overlay a grid outline PNG on its own track, for exactly
  // the reveal window (same start as the grid, same end as the split
  // point). Runs last, after the grid itself is fully built. ---
  if (wantsOutline) {
    await addGridOutline(project, sequence, {
      rows,
      cols,
      color: config.outlineColor || "White",
      trackIndex: originalTrackIndex + outlineTrackOffset,
      startTime: originalStart,
      endTime: splitPoint,
      report,
    });
  }

  const lastGridTrack = originalTrackIndex + cellCount;
  const notes = [];
  if (needsContinuation) {
    notes.push(` Full footage continues on V${originalTrackIndex + continuationTrackOffset + 1} after the reveal.`);
  }
  if (wantsOutline) {
    notes.push(` Grid outline on V${originalTrackIndex + outlineTrackOffset + 1}.`);
  }
  return (
    `Done. Built a ${rows}x${cols} grid on tracks V${originalTrackIndex + 1}-V${lastGridTrack}.` +
    notes.join("")
  );
}

module.exports = { buildGrid };
