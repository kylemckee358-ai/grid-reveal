/**
 * Shared helpers for talking to the Premiere Pro UXP API.
 * Kept separate from gridBuilder.js so the effect logic reads top-to-bottom
 * without the plumbing in the way.
 */

const ppro = require("premierepro");

/**
 * Returns the VideoClipTrackItems currently selected in the given sequence.
 */
async function getSelectedVideoClipTrackItems(sequence) {
  const selection = await sequence.getSelection();
  const items = await selection.getTrackItems();
  return items.filter((item) => item instanceof ppro.VideoClipTrackItem);
}

/**
 * Finds the first project item whose match name contains the given needle
 * (case-insensitive). Used to resolve the Crop effect's real match name at
 * runtime instead of hard-coding it, so a naming difference fails with a
 * clear error instead of silently applying the wrong effect.
 */
async function resolveMatchName(preferredMatchName, nameContains) {
  const allMatchNames = await ppro.VideoFilterFactory.getMatchNames();
  if (allMatchNames.includes(preferredMatchName)) {
    return preferredMatchName;
  }
  const needle = nameContains.toLowerCase();
  const fallback = allMatchNames.find((name) =>
    name.toLowerCase().includes(needle)
  );
  if (!fallback) {
    throw new Error(
      `Could not find a video effect matching "${nameContains}" (looked for "${preferredMatchName}"). ` +
        `Your Premiere version may expose it under a different name.`
    );
  }
  return fallback;
}

/**
 * Converts a frame number (at the sequence's frame rate) to a TickTime.
 */
function frameToTickTime(frameNumber, frameRate) {
  return ppro.TickTime.createWithFrameAndFrameRate(frameNumber, frameRate);
}

/**
 * True if two TickTimes represent the same instant.
 */
function ticksEqual(a, b) {
  return a.ticksNumber === b.ticksNumber;
}

module.exports = {
  ppro,
  getSelectedVideoClipTrackItems,
  resolveMatchName,
  frameToTickTime,
  ticksEqual,
};
