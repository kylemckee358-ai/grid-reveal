/**
 * The actual "3x3 Grid" effect.
 *
 * Takes the single selected clip and builds `rows x cols` staggered,
 * cropped copies of it:
 *
 *   1. The selected clip is trimmed down to exactly `frameDelay * cellCount`
 *      frames (e.g. 2 * 9 = 18), keeping its existing in-point. This becomes
 *      cell 0 (top-left) - the longest piece, on the clip's own track.
 *   2. It's cloned onto the (cellCount - 1) tracks above it.
 *   3. Each clone's head is trimmed forward by `frameDelay * cellIndex`
 *      frames (clone 1 loses the first 2 frames, clone 2 the first 4, ...),
 *      which - because trimming a head moves the timeline start forward
 *      while leaving the end anchored - staggers every piece's start time
 *      while all 9 keep ending on the exact same timeline frame, showing
 *      the exact same final source frame.
 *   4. Each of the 9 pieces gets a Crop effect isolating its 1/9 of the
 *      frame (row-major: cell 0 = top-left, ... last cell = bottom-right).
 *
 * The reveal itself needs no opacity/keyframe animation at all - a track is
 * simply empty before its piece's (staggered) start time.
 *
 * Known simplification: frame-offset math assumes the source clip's native
 * frame rate matches the sequence's frame rate. If they differ, trim amounts
 * may be slightly off.
 */

const {
  ppro,
  getSelectedVideoClipTrackItems,
  resolveMatchName,
  frameToTickTime,
  ticksEqual,
} = require("./premiereHelpers");

const CROP_PREFERRED_MATCH_NAME = "AE.ADBE AECrop";
const CROP_NAME_FALLBACK_SEARCH = "crop";
// Index to insert Crop at: 0 = Motion, 1 = Opacity are always present first.
const CROP_INSERT_INDEX = 2;

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

  report("Resolving effects...");
  const cropMatchName = await resolveMatchName(
    CROP_PREFERRED_MATCH_NAME,
    CROP_NAME_FALLBACK_SEARCH
  );

  const sequenceEditor = ppro.SequenceEditor.getEditor(sequence);

  // --- Transaction A: trim the original clip down to exactly the required
  // window if it's longer (keeps its in-point, pulls the out-point in). ---
  if (originalDurationTicks > requiredDurationTicks) {
    report("Trimming base clip...");
    const originalInPoint = await original.getInPoint();
    const newOutTicks =
      originalInPoint.ticksNumber + requiredDurationTicks;
    const newOutPoint = ppro.TickTime.createWithTicks(String(newOutTicks));

    let trimSuccess = false;
    project.lockedAccess(() => {
      trimSuccess = project.executeTransaction((compoundAction) => {
        compoundAction.addAction(original.createSetOutPointAction(newOutPoint));
      }, "Grid Reveal: trim base clip");
    });
    if (!trimSuccess) {
      throw new Error("Failed to trim the selected clip to the required length.");
    }
  }

  // --- Transaction B: clone the (now correctly-sized) clip onto the
  // (cellCount - 1) tracks above it, at the same position. ---
  report(`Cloning clip onto ${cellCount - 1} tracks...`);
  let cloneSuccess = false;
  project.lockedAccess(() => {
    cloneSuccess = project.executeTransaction((compoundAction) => {
      for (let k = 1; k < cellCount; k += 1) {
        const cloneAction = sequenceEditor.createCloneTrackItemAction(
          original,
          ppro.TickTime.TIME_ZERO, // no time offset - same position as the (trimmed) original
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
  // this point all of them still share the same (trimmed) start time. ---
  report("Locating clones...");
  const trimmedStart = await original.getStartTime();
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
      if (ticksEqual(itemStart, trimmedStart)) {
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

  // --- Transaction C: stagger cells 1..N by trimming each one's head
  // forward by (frameDelay * cellIndex) frames. Out-point is resent
  // unchanged alongside it, matching Adobe's own sample pattern for
  // trim actions (both in and out points set together). ---
  report("Staggering cells...");
  const headTrimData = [];
  for (let i = 1; i < cellCount; i += 1) {
    const item = cellItems[i];
    const inPoint = await item.getInPoint();
    const outPoint = await item.getOutPoint();
    const offsetTicks = frameToTickTime(frameDelay * i, frameRate).ticksNumber;
    const newInPoint = ppro.TickTime.createWithTicks(
      String(inPoint.ticksNumber + offsetTicks)
    );
    headTrimData.push({ item, newInPoint, outPoint });
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

  // --- Transaction D: add a Crop effect to every one of the cellCount copies. ---
  report("Adding Crop effect...");
  // getComponentChain() is async, so fetch every chain before opening the
  // locked transaction below (lockedAccess callbacks must stay synchronous).
  const componentChains = [];
  for (const item of cellItems) {
    componentChains.push(await item.getComponentChain());
  }
  let cropInsertSuccess = false;
  project.lockedAccess(() => {
    cropInsertSuccess = project.executeTransaction((compoundAction) => {
      for (const chain of componentChains) {
        const cropComponent = ppro.VideoFilterFactory.createComponent(
          cropMatchName
        );
        const insertAction = chain.createInsertComponentAction(
          cropComponent,
          CROP_INSERT_INDEX
        );
        compoundAction.addAction(insertAction);
      }
    }, "Grid Reveal: add Crop");
  });
  if (!cropInsertSuccess) {
    throw new Error("Failed to add the Crop effect to the grid copies.");
  }

  // --- Transaction E: set each copy's Crop percentages to its cell. ---
  report("Cropping each cell...");
  const cellSize = { w: 100 / cols, h: 100 / rows };
  let cropValueSuccess = false;
  project.lockedAccess(() => {
    cropValueSuccess = project.executeTransaction((compoundAction) => {
      for (let i = 0; i < cellCount; i += 1) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const chain = componentChains[i];
        const cropComponent = chain.getComponentAtIndex(CROP_INSERT_INDEX);

        const left = col * cellSize.w;
        const top = row * cellSize.h;
        const right = (cols - 1 - col) * cellSize.w;
        const bottom = (rows - 1 - row) * cellSize.h;
        const values = [left, top, right, bottom];

        for (let paramIndex = 0; paramIndex < 4; paramIndex += 1) {
          const param = cropComponent.getParam(paramIndex);
          const keyframe = param.createKeyframe(values[paramIndex]);
          const setValueAction = param.createSetValueAction(keyframe, true);
          compoundAction.addAction(setValueAction);
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
