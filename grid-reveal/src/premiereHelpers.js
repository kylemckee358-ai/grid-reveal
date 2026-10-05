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
 * Returns the fixed Opacity component on a clip's component chain, verifying
 * its display name at runtime rather than trusting a hard-coded index.
 */
async function getOpacityComponent(componentChain) {
  const count = componentChain.getComponentCount();
  for (let i = 0; i < count; i += 1) {
    const component = componentChain.getComponentAtIndex(i);
    const displayName = await component.getDisplayName();
    if (displayName === "Opacity") {
      return component;
    }
  }
  throw new Error("Could not find the built-in Opacity effect on this clip.");
}

/**
 * Returns the Opacity Level parameter (the only animatable param on the
 * fixed Opacity effect) off a resolved Opacity component.
 */
function getOpacityLevelParam(opacityComponent) {
  return opacityComponent.getParam(0);
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
  getOpacityComponent,
  getOpacityLevelParam,
  frameToTickTime,
  ticksEqual,
};
