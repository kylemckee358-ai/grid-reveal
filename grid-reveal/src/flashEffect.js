/**
 * Optional "Flash" accent: adds a Levels effect to every grid cell (not the
 * continuation clip) with its White Input Level keyframed from 80 at the
 * cell's own start up to 255 one frame later - a quick blown-out flash
 * that settles to normal, right as each cell pops in.
 *
 * Applied per-cell (in each cell's own local/relative time, so it lines up
 * with wherever that cell's staggered start lands) rather than as a single
 * global flash over the whole composite - Premiere's scripting API has no
 * supported way to add effects to an adjustment layer, so a true "flash
 * everything at once" overlay isn't buildable; flashing every cell as it
 * individually appears is the deliverable alternative, and arguably a
 * nicer effect anyway.
 */

const ppro = require("premierepro");
const { findComponentByDisplayName, findParamByDisplayName, frameToTickTime } =
  require("./premiereHelpers");

const LEVELS_PREFERRED_MATCH_NAME = "PR.ADBE Levels";
const LEVELS_DISPLAY_NAME = "Levels";
const WHITE_INPUT_PARAM_NAMES = [
  "(RGB) White Input Level",
  "RGB White Input Level",
  "White Input Level",
];
const FLASH_START_VALUE = 80;
const FLASH_END_VALUE = 255;
const FLASH_DURATION_FRAMES = 1;

async function resolveLevelsMatchName() {
  const allNames = await ppro.VideoFilterFactory.getMatchNames();
  if (allNames.includes(LEVELS_PREFERRED_MATCH_NAME)) {
    return LEVELS_PREFERRED_MATCH_NAME;
  }
  const fallback = allNames.find((name) => name.toLowerCase().includes("level"));
  if (!fallback) {
    throw new Error(`Could not find a "Levels" video effect on this system.`);
  }
  return fallback;
}

function findWhiteInputParam(levelsComponent) {
  for (const name of WHITE_INPUT_PARAM_NAMES) {
    const param = findParamByDisplayName(levelsComponent, name);
    if (param) {
      return param;
    }
  }
  return null;
}

/**
 * @param {object} project
 * @param {object[]} cellItems - the grid cells (not the continuation clip)
 * @param {object} frameRate - sequence FrameRate, for the 1-frame offset
 * @param {(status: string) => void} report
 */
async function addFlashEffect(project, cellItems, frameRate, report) {
  report("Adding flash effect...");
  const matchName = await resolveLevelsMatchName();

  // getComponentChain() is async; fetch every chain before the locked,
  // synchronous transaction callback below.
  const componentChains = [];
  for (const item of cellItems) {
    componentChains.push(await item.getComponentChain());
  }

  let insertSuccess = false;
  project.lockedAccess(() => {
    insertSuccess = project.executeTransaction((compoundAction) => {
      for (const chain of componentChains) {
        const levelsComponent = ppro.VideoFilterFactory.createComponent(matchName);
        compoundAction.addAction(chain.createAppendComponentAction(levelsComponent));
      }
    }, "Grid Reveal: add flash effect");
  });
  if (!insertSuccess) {
    throw new Error("Failed to add the flash (Levels) effect to the grid cells.");
  }

  // Re-resolve: find the Levels component we just added on each chain by
  // display name, and its White Input Level param by display name.
  const whiteInputParams = [];
  for (const chain of componentChains) {
    const levelsComponent = await findComponentByDisplayName(chain, LEVELS_DISPLAY_NAME);
    if (!levelsComponent) {
      throw new Error(
        `Added the Levels effect but couldn't find it again on the component chain. ` +
          `Undo (Ctrl+Z / Cmd+Z) and try again.`
      );
    }
    const whiteInputParam = findWhiteInputParam(levelsComponent);
    if (!whiteInputParam) {
      throw new Error(
        `Your Premiere version's Levels effect doesn't expose a White Input Level ` +
          `parameter by a recognized name. Let me know and I'll adjust the lookup.`
      );
    }
    whiteInputParams.push(whiteInputParam);
  }

  // Keyframe positions on a component param are relative to the track
  // item's own start, not absolute sequence time - so TIME_ZERO here means
  // "this cell's own first frame," correctly lining up with each cell's
  // staggered start with no extra offset math needed.
  const flashEndTime = frameToTickTime(FLASH_DURATION_FRAMES, frameRate);

  let keyframeSuccess = false;
  project.lockedAccess(() => {
    keyframeSuccess = project.executeTransaction((compoundAction) => {
      for (const param of whiteInputParams) {
        compoundAction.addAction(param.createSetTimeVaryingAction(true));

        const startKeyframe = param.createKeyframe(FLASH_START_VALUE);
        startKeyframe.position = ppro.TickTime.TIME_ZERO;
        compoundAction.addAction(param.createAddKeyframeAction(startKeyframe));

        const endKeyframe = param.createKeyframe(FLASH_END_VALUE);
        endKeyframe.position = flashEndTime;
        compoundAction.addAction(param.createAddKeyframeAction(endKeyframe));

        compoundAction.addAction(
          param.createSetInterpolationAtKeyframeAction(
            ppro.TickTime.TIME_ZERO,
            ppro.Constants.InterpolationMode.LINEAR
          )
        );
        compoundAction.addAction(
          param.createSetInterpolationAtKeyframeAction(
            flashEndTime,
            ppro.Constants.InterpolationMode.LINEAR
          )
        );
      }
    }, "Grid Reveal: keyframe flash");
  });
  if (!keyframeSuccess) {
    throw new Error("Failed to keyframe the flash effect.");
  }
}

module.exports = { addFlashEffect };
