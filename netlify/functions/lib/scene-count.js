// lib/scene-count.js — how many images a narrated video needs.
//
// Not a Netlify function. Netlify's bundler only turns a subdirectory of
// netlify/functions into a function when it contains <dir>.js or index.js;
// this file is neither, so it ships as a plain require()d dependency.
//
// ─── The rule this implements ────────────────────────────────────────────────
// Acceptance standard for every video on every channel: no single image may sit
// on screen for more than 15 seconds. A 90-second video gets at least 8 images.
//
// submit-images.js was hard-coded to exactly 8 prompts. That 8 was a placeholder
// for this calculation, which never got written. 8 is right for a 90s video and
// wrong for everything longer: a 180s script on 8 images is 22.5s per image.
//
// SECONDS_PER_SCENE is 12, not 15, deliberately. Scene lengths are not uniform in
// the assemblers — animated scenes are pinned to ANIM_DURATION (5s) and the
// remaining time is split across the stills, so the average is not the maximum.
// Targeting 12 leaves headroom for that spread; in practice stills land ~9-11s.
//
// ─── Where durationSec comes from ────────────────────────────────────────────
// It is ESTIMATED from the script's word count, because at the moment images are
// submitted the narration audio does not exist yet.
//
// Studio's order of operations is: script -> translate -> prompts -> submit-images
// -> check-jobs -> submit-animations -> assemble. Text-to-speech is step 1 of
// *assembly* (src/lib/browser-assembler.js processLanguage(), and the same in
// electron-assembler.js) — the last stage, long after these images are ordered.
// tts.js also streams mp3 bytes straight back to the caller and persists nothing,
// so there is no stored audio for a function to measure even after the fact.
// Real duration is measured, but only in the assembler, by ffmpeg, at the end.
//
// So: estimate here, and let a caller who does know the real number say so.
// WORDS_PER_SECOND = 2.5 is the usual Fish Audio narration pace (~150 wpm).
// Pass durationSec to override the estimate, or sceneCount to override the
// arithmetic entirely.

const SECONDS_PER_SCENE = 12; // targets ~9-11s in practice, never breaches 15s
const MIN_SCENES = 8;
const MAX_SECONDS_ON_SCREEN = 15; // the acceptance standard, asserted below
const WORDS_PER_SECOND = 2.5; // Fish Audio narration pace, ~150 wpm

function countWords(script) {
  if (typeof script !== "string") return 0;
  const trimmed = script.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Approximate narration length from the script. See the note above on why this
// is an estimate and not a measurement.
function estimateDurationSec(script) {
  return countWords(script) / WORDS_PER_SECOND;
}

function isPositiveNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

// Thrown when the 15s ceiling would be breached. Carries `pacing` so the caller
// can report exactly which numbers failed.
class PacingError extends Error {
  constructor(message, pacing) {
    super(message);
    this.name = "PacingError";
    this.pacing = pacing;
  }
}

// Resolve the scene count for one video.
//
//   sceneCount   explicit override; wins over everything
//   durationSec  explicit narration length; wins over the script estimate
//   script       narration text, used to estimate durationSec when nothing else
//
// Returns { sceneCount, durationSec, secondsPerScene, source }. durationSec is
// null when the caller gave neither a duration nor a script — there is then
// nothing to pace against, and sceneCount falls back to MIN_SCENES.
function resolveSceneCount({ sceneCount, durationSec, script } = {}) {
  let duration = null;
  let source;

  if (isPositiveNumber(durationSec)) {
    duration = durationSec;
    source = "durationSec";
  } else if (countWords(script) > 0) {
    duration = estimateDurationSec(script);
    source = "estimated-from-script";
  }

  let count;
  if (sceneCount !== undefined && sceneCount !== null) {
    if (!Number.isInteger(sceneCount) || sceneCount < 1) {
      throw new PacingError("sceneCount must be a positive integer", null);
    }
    count = sceneCount;
    source = source ? `${source}+sceneCount-override` : "sceneCount-override";
  } else if (duration === null) {
    count = MIN_SCENES;
    source = "default-minimum";
  } else {
    count = Math.max(MIN_SCENES, Math.ceil(duration / SECONDS_PER_SCENE));
  }

  const secondsPerScene = duration === null ? null : duration / count;

  // Hard assertion on the acceptance standard. For a computed count this can
  // only fire if the arithmetic above is broken (ceil() guarantees the average
  // never exceeds SECONDS_PER_SCENE); for a caller-supplied sceneCount it fires
  // on a genuinely under-scened request. Either way, fail loudly.
  if (secondsPerScene !== null && secondsPerScene > MAX_SECONDS_ON_SCREEN) {
    throw new PacingError(
      `${count} scene(s) for ${duration.toFixed(1)}s of narration is ` +
        `${secondsPerScene.toFixed(1)}s per image, over the ` +
        `${MAX_SECONDS_ON_SCREEN}s maximum. Need at least ` +
        `${Math.ceil(duration / MAX_SECONDS_ON_SCREEN)}.`,
      { sceneCount: count, durationSec: duration, secondsPerScene, maxSecondsOnScreen: MAX_SECONDS_ON_SCREEN }
    );
  }

  return { sceneCount: count, durationSec: duration, secondsPerScene, source };
}

module.exports = {
  SECONDS_PER_SCENE,
  MIN_SCENES,
  MAX_SECONDS_ON_SCREEN,
  WORDS_PER_SECOND,
  countWords,
  estimateDurationSec,
  resolveSceneCount,
  PacingError,
};
