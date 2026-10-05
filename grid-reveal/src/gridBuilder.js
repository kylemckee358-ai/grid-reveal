/**
 * The actual "3x3 Grid" effect.
 *
 * Takes the single selected clip and builds `rows x cols` staggered,
 * cropped copies of it:
 *
 *   1. Cell 0 (top-left) is the selected clip itself, completely untouched -
 *      full original length, full original in/out points.
 *   2. It's cloned onto the (cellCount - 1) tracks above it, each clone
 *      initially identical to the original.
 *   3. A shared "split point" is defined at `frameDelay * cellCount` frames
 *      (e.g. 2 * 9 = 18) after cell 0's start. Every clone (cells 1..N) gets
 *      its OUT point pulled back to that same split point, and its IN point
 *      pushed forward by `frameDelay * cellIndex` frames (clone 1 loses the
 *      first 2 frames, clone 2 the first 4, ...). Because a head-trim moves
 *      a clip's timeline start forward while its end stays anchored, this
 *      staggers every clone's start time while all of them end together,
 *      exactly at the moment cell 0 (still playing its full length) reaches
 *      the split point itself.
 *   4. Each of the cellCount pieces gets cropped to its own 1/N of the frame
 *      (row-major: cell 0 = top-left, ... last cell = bottom-right) using
 *      the Crop Left/Top/Right/Bottom controls built into the clip's own
 *      Motion effect - current Premiere versions fold cropping into Motion
 *      rather than exposing it as a separate addable effect.
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

/**
 * @param {object} config
 * @param {number} config.rows
 * @param {number} config.cols
 * @param {number} config.frameDelay - frames each successive cell is staggered by
 * @param {(status: string) => void} onProgress - called with short status strings
 */
async function buildGrid(config, onProgress) {
  const rows = config.rows;
  const cols = config.cols;
  const frameDelay = config.frameDelay;
  const cellCount = rows * cols;
  const report = onProgress || (() => {});

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

  // --- Step 1: figure out which track the clip is on, and whether there's
  // enough room above it for the other (cellCount - 1) copies. ---
  const originalTrackIndex = await original.getTrackIndex();
  const videoTrackCount = await sequence.getVideoTrackCount();
  const requiredTrackCount = originalTrackIndex + cellCount;

  if (videoTrackCount < requiredTrackCount) {
    const tracksToAdd = requiredTrackCount - videoTrackCount;
    throw new Error(
      `Not enough video tracks. This sequence has ${videoTrackCount}, but the ` +
        `${rows}x${cols} grid needs ${requiredTrackCount} (your clip is on track ` +
        `V${originalTrackIndex + 1}). Right-click the track header area, choose ` +
        `"Add Tracks", add ${tracksToAdd} video track(s), then click 3x3 Grid again.`
    );
  }

  // --- Step 2: the selected clip must be at least frameDelay * cellCount
  // frames long - that's the window every staggered piece is carved from. ---
  const originalStart = await original.getStartTime();
  const originalEnd = await original.getEndTime();
  const requiredDurationFrames = frameDelay * cellCount;
  const requiredDurationTicks = frameToTickTime(
    requiredDurationFrames,
    frameRate
  ).ticksNumber;
  const originalDurationTicks =
    originalEnd.ticksNumber - originalStart.ticksNumber;

  if (originalDurationTicks < requiredDurationTicks) {
    throw new Error(
      `Clip too short. At a ${frameDelay}-frame delay, a ${rows}x${cols} grid needs ` +
        `at least ${requiredDurationFrames} frames; your selected clip is shorter than that. ` +
        `Pick a longer clip, or lower the frame delay / grid size.`
    );
  }

  // --- Step 3: make sure the tracks we're about to use are actually empty
  // across the clip's full (pre-trim) span, so we never clobber other work. ---
  for (let k = 1; k < cellCount; k += 1) {
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
            `Clear tracks V${originalTrackIndex + 2}-V${originalTrackIndex + cellCount} ` +
            `above your clip, then click 3x3 Grid again.`
        );
      }
    }
  }

  const sequenceEditor = ppro.SequenceEditor.getEditor(sequence);

  // --- Transaction A: clone the original clip, untouched, onto the
  // (cellCount - 1) tracks above it, at the same position. ---
  report(`Cloning clip onto ${cellCount - 1} tracks...`);
  let cloneSuccess = false;
  project.lockedAccess(() => {
    cloneSuccess = project.executeTransaction((compoundAction) => {
      for (let k = 1; k < cellCount; k += 1) {
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

  // --- Re-query: find the real clip on each of the cellCount tracks. At
  // this point all of them still share the original's start time. ---
  report("Locating clones...");
  const cellItems = [];
  for (let k = 0; k < cellCount; k += 1) {
    const trackIndex = originalTrackIndex + k;
    const track = await sequence.getVideoTrack(trackIndex);
    const items = await track.getTrackItems(
      ppro.Constants.TrackItemType.CLIP,
      false
    );
    let found = null;
    for (const item of items) {
      const itemStart = await item.getStartTime();
      if (ticksEqual(itemStart, originalStart)) {
        found = item;
        break;
      }
    }
    if (!found) {
      throw new Error(
        `Could not locate the clip copy on track V${trackIndex + 1} after cloning. ` +
          `Undo (Ctrl+Z / Cmd+Z) and try again.`
      );
    }
    cellItems.push(found);
  }

  // --- Transaction B: stagger cells 1..N. Every clone's OUT point gets
  // pulled back to the shared split point (cell 0's in-point + the required
  // window), and its IN point pushed forward by (frameDelay * cellIndex)
  // frames - both set together, matching Adobe's own sample pattern for
  // trim actions. Cell 0 itself is never touched. ---
  report("Staggering cells...");
  const originalInPoint = await original.getInPoint();
  const splitPointTicks = originalInPoint.ticksNumber + requiredDurationTicks;
  const splitPoint = ppro.TickTime.createWithTicks(String(splitPointTicks));

  const headTrimData = [];
  for (let i = 1; i < cellCount; i += 1) {
    const item = cellItems[i];
    const offsetTicks = frameToTickTime(frameDelay * i, frameRate).ticksNumber;
    const newInPoint = ppro.TickTime.createWithTicks(
      String(originalInPoint.ticksNumber + offsetTicks)
    );
    headTrimData.push({ item, newInPoint, outPoint: splitPoint });
  }

  let staggerSuccess = false;
  project.lockedAccess(() => {
    staggerSuccess = project.executeTransaction((compoundAction) => {
      for (const { item, newInPoint, outPoint } of headTrimData) {
        compoundAction.addAction(item.createSetInPointAction(newInPoint));
        compoundAction.addAction(item.createSetOutPointAction(outPoint));
      }
    }, "Grid Reveal: stagger cells");
  });
  if (!staggerSuccess) {
    throw new Error("Failed to stagger the grid cells.");
  }

  // --- Locate each cell's Motion component and its built-in Crop params.
  // No separate effect needs adding - Motion is always present, and current
  // Premiere versions carry Crop Left/Top/Right/Bottom directly on it. ---
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

  // --- Transaction C: set each cell's Crop percentages. ---
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

  const lastTrack = originalTrackIndex + cellCount;
  return `Done. Built a ${rows}x${cols} grid on tracks V${originalTrackIndex + 1}-V${lastTrack}.`;
}

module.exports = { buildGrid };
