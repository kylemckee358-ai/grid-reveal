/**
 * Optional grid-outline overlay: places one of the pre-made outline PNGs
 * (see the "Grid Outlines" folder next to this plugin) on its own track,
 * for the exact duration of the reveal, so viewers can see the grid lines
 * while it's assembling. Only available for square grids where a matching
 * asset exists - 2x2, 3x3, 4x4 - in Black or White.
 */

const ppro = require("premierepro");
const { ticksEqual } = require("./premiereHelpers");

// Hardcoded to this plugin's known install location - update this if the
// plugin folder (or the Grid Outlines subfolder) ever moves.
const GRID_OUTLINES_DIR =
  "/Users/kylemckee/Documents/ClaudeCode/Premiere Pro Tools/grid-reveal/Grid Outlines";

const AVAILABLE_SIZES = [2, 3, 4];

function isOutlineAvailable(rows, cols) {
  return rows === cols && AVAILABLE_SIZES.includes(rows);
}

function outlineFileName(size, color) {
  return `${color} ${size} x ${size} Grid.png`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Finds an existing project item by exact name under the project root, or
 * imports the file fresh if it isn't there yet - avoids re-importing (and
 * cluttering the Project panel with duplicates) on repeat runs.
 *
 * importFiles() can resolve successfully before the new item is actually
 * visible via getItems() yet - Premiere's own import pipeline runs behind
 * it - so after a successful import, the project root is re-checked a
 * handful of times with short waits in between rather than just once.
 */
async function findOrImportProjectItem(project, filePath, fileName) {
  const rootItem = await project.getRootItem();
  const existingItems = await rootItem.getItems();
  const existing = existingItems.find((item) => item.name === fileName);
  if (existing) {
    return existing;
  }

  const imported = await project.importFiles(
    [filePath],
    true, // suppressUI
    rootItem, // targetBin - explicit project root
    false // importAsNumberedStills
  );
  if (!imported) {
    throw new Error(`Failed to import grid outline asset: ${fileName}`);
  }

  let newItem = null;
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts && !newItem; attempt += 1) {
    if (attempt > 0) {
      await wait(300);
    }
    const itemsAfterImport = await rootItem.getItems();
    newItem = itemsAfterImport.find((item) => item.name === fileName);
  }
  if (!newItem) {
    throw new Error(`Imported ${fileName} but couldn't find it in the project.`);
  }
  return newItem;
}

/**
 * Adds the outline overlay to its own (absolute) video track, spanning
 * [startTime, endTime).
 *
 * @param {object} project
 * @param {object} sequence
 * @param {object} options
 * @param {number} options.rows
 * @param {number} options.cols
 * @param {string} options.color - "Black" | "White"
 * @param {number} options.trackIndex - absolute video track index to place it on
 * @param {object} options.startTime - TickTime
 * @param {object} options.endTime - TickTime
 * @param {(status: string) => void} options.report
 */
async function addGridOutline(project, sequence, options) {
  const { rows, cols, color, trackIndex, startTime, endTime, report } = options;

  if (!isOutlineAvailable(rows, cols)) {
    throw new Error(
      `Grid outlines are only available for square grids (2x2, 3x3, 4x4) - ` +
        `${rows}x${cols} doesn't have a matching overlay.`
    );
  }

  report("Adding grid outline...");
  const fileName = outlineFileName(rows, color);
  const filePath = `${GRID_OUTLINES_DIR}/${fileName}`;
  const outlineItem = await findOrImportProjectItem(project, filePath, fileName);

  // createSetScaleToFrameSizeAction only exists on a ClipProjectItem, not
  // the plain ProjectItem getItems() hands back - cast first.
  const outlineClipItem = ppro.ClipProjectItem.cast(outlineItem);
  if (!outlineClipItem) {
    throw new Error(`"${fileName}" didn't import as expected (not a clip project item).`);
  }

  project.lockedAccess(() => {
    project.executeTransaction((compoundAction) => {
      compoundAction.addAction(outlineClipItem.createSetScaleToFrameSizeAction());
    }, "Grid Reveal: scale outline to frame");
  });

  const sequenceEditor = ppro.SequenceEditor.getEditor(sequence);
  let placeSuccess = false;
  project.lockedAccess(() => {
    placeSuccess = project.executeTransaction((compoundAction) => {
      const placeAction = sequenceEditor.createOverwriteItemAction(
        outlineItem,
        startTime,
        trackIndex, // absolute video track index
        0 // audio track index - irrelevant for a still image
      );
      compoundAction.addAction(placeAction);
    }, "Grid Reveal: place outline overlay");
  });
  if (!placeSuccess) {
    throw new Error("Failed to place the grid outline overlay on the timeline.");
  }

  // Re-query: find the clip we just placed, then trim it to exactly the
  // reveal window - its default still-image duration will usually run
  // much longer than that.
  const track = await sequence.getVideoTrack(trackIndex);
  const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  let placedItem = null;
  for (const item of items) {
    const itemStart = await item.getStartTime();
    if (ticksEqual(itemStart, startTime)) {
      placedItem = item;
      break;
    }
  }
  if (!placedItem) {
    throw new Error(
      `Placed the grid outline overlay but couldn't locate it again to trim it. ` +
        `Undo (Ctrl+Z / Cmd+Z) and try again.`
    );
  }

  let trimSuccess = false;
  project.lockedAccess(() => {
    trimSuccess = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(placedItem.createSetEndAction(endTime));
    }, "Grid Reveal: trim outline overlay to reveal length");
  });
  if (!trimSuccess) {
    throw new Error("Failed to trim the grid outline overlay to the reveal length.");
  }
}

module.exports = { isOutlineAvailable, addGridOutline };
