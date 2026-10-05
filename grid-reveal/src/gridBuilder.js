/**
 * The actual "3x3 Grid" effect.
 *
 * Takes the single selected clip and turns it into `rows x cols` stacked,
 * cropped copies of itself that reveal one at a time, row-major, at a fixed
 * frame delay — see /Users/kylemckee/.claude/plans/i-want-you-to-glistening-kitten.md
 * for the full design writeup.
 */

const {
  ppro,
  getSelectedVideoClipTrackItems,
  resolveMatchName,
  getOpacityComponent,
  getOpacityLevelParam,
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
 * @param {number} config.frameDelay - frames between each cell's reveal
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

  // --- Step 2: make sure the tracks we're about to use are actually empty
  // where this clip sits, so we never clobber other work. ---
  const originalStart = await original.getStartTime();
  const originalEnd = await original.getEndTime();

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
  const settings = await sequence.getSettings();
  const frameRate = await settings.getVideoFrameRate();

  // --- Transaction A: clone the clip onto the (cellCount - 1) tracks above it. ---
  report(`Cloning clip onto ${cellCount - 1} tracks...`);
  let cloneSuccess = false;
  project.lockedAccess(() => {
    cloneSuccess = project.executeTransaction((compoundAction) => {
      for (let k = 1; k < cellCount; k += 1) {
        const cloneAction = sequenceEditor.createCloneTrackItemAction(
          original,
          ppro.TickTime.TIME_ZERO, // no time offset - same position as original
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

  // --- Re-query: find the real clip on each of the cellCount tracks. ---
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

  // --- Transaction B: add a Crop effect to every one of the 9 copies. ---
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

  // --- Transaction C: set each copy's Crop percentages to its cell. ---
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

  // --- Transaction D: reveal keyframes on Opacity for cells 2..N. ---
  report("Setting reveal timing...");
  const opacityParams = [];
  for (const item of cellItems) {
    const chain = await item.getComponentChain();
    const opacityComponent = await getOpacityComponent(chain);
    opacityParams.push(getOpacityLevelParam(opacityComponent));
  }

  let revealSuccess = false;
  project.lockedAccess(() => {
    revealSuccess = project.executeTransaction((compoundAction) => {
      for (let i = 1; i < cellCount; i += 1) {
        const param = opacityParams[i];
        const revealFrame = i * frameDelay;
        const revealTime = frameToTickTime(revealFrame, frameRate);

        compoundAction.addAction(param.createSetTimeVaryingAction(true));

        const hiddenKeyframe = param.createKeyframe(0);
        hiddenKeyframe.position = ppro.TickTime.TIME_ZERO;
        compoundAction.addAction(param.createAddKeyframeAction(hiddenKeyframe));

        const visibleKeyframe = param.createKeyframe(100);
        visibleKeyframe.position = revealTime;
        compoundAction.addAction(param.createAddKeyframeAction(visibleKeyframe));

        compoundAction.addAction(
          param.createSetInterpolationAtKeyframeAction(
            ppro.TickTime.TIME_ZERO,
            ppro.Constants.InterpolationMode.HOLD
          )
        );
        compoundAction.addAction(
          param.createSetInterpolationAtKeyframeAction(
            revealTime,
            ppro.Constants.InterpolationMode.HOLD
          )
        );
      }
    }, "Grid Reveal: reveal keyframes");
  });
  if (!revealSuccess) {
    throw new Error("Failed to set the reveal keyframes on the grid copies.");
  }

  const lastTrack = originalTrackIndex + cellCount;
  return `Done. Built a ${rows}x${cols} grid on tracks V${originalTrackIndex + 1}-V${lastTrack}.`;
}

module.exports = { buildGrid };
