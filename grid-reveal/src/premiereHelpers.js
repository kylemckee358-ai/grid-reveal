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
 * Finds a component in a chain by its display name (not by index - component
 * chain order isn't something we should assume). Used to find the built-in
 * "Motion" effect, which is always present on a video clip and - in current
 * Premiere versions - carries the Crop Left/Top/Right/Bottom controls
 * directly, rather than those living on a separate "Crop" effect.
 */
async function findComponentByDisplayName(componentChain, displayName) {
  const count = componentChain.getComponentCount();
  for (let i = 0; i < count; i += 1) {
    const component = componentChain.getComponentAtIndex(i);
    const name = await component.getDisplayName();
    if (name === displayName) {
      return component;
    }
  }
  return null;
}

/**
 * Finds a param on a component by display name (case-insensitive), not by
 * index - param order isn't something we should assume either.
 */
function findParamByDisplayName(component, displayName) {
  const count = component.getParamCount();
  const needle = displayName.toLowerCase();
  for (let i = 0; i < count; i += 1) {
    const param = component.getParam(i);
    if ((param.displayName || "").toLowerCase() === needle) {
      return param;
    }
  }
  return null;
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
  findComponentByDisplayName,
  findParamByDisplayName,
  frameToTickTime,
  ticksEqual,
};
