/* ============================================================================
   config.js
   Shared namespace, tunable constants, the expression table (30 visual
   presets) and the personality-state table (which expressions each named
   behaviour uses). Nothing in this file touches the DOM or the canvas -
   it is pure data + small helpers, loaded first so every other script can
   rely on it.
   ========================================================================== */
(function () {
  "use strict";

  window.Robot = window.Robot || {};

  /* ---------------------------------------------------------------------
     Small math / random helpers used everywhere.
  --------------------------------------------------------------------- */
  var Util = {
    clamp: function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    // Frame-rate independent smoothing: returns the interpolation factor
    // to use for a given "speed" (per-second) and delta time in ms.
    smooth: function (speedPerSec, dtMs) {
      var dt = dtMs / 1000;
      return 1 - Math.pow(1 - Util.clamp(speedPerSec, 0.01, 0.99), dt * 60);
    },
    randRange: function (min, max) { return min + Math.random() * (max - min); },
    randInt: function (min, max) { return Math.floor(Util.randRange(min, max + 1)); },
    choice: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    weightedChoice: function (pairs) {
      // pairs: [[value, weight], ...]
      var total = 0, i;
      for (i = 0; i < pairs.length; i++) total += pairs[i][1];
      var r = Math.random() * total;
      for (i = 0; i < pairs.length; i++) {
        r -= pairs[i][1];
        if (r <= 0) return pairs[i][0];
      }
      return pairs[pairs.length - 1][0];
    },
    easeInOutCubic: function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    easeOutCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    now: function () { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  };

  /* ---------------------------------------------------------------------
     Tunable timings / thresholds. Adjust these to change personality
     pacing without touching logic elsewhere.
  --------------------------------------------------------------------- */
  var Config = {
    STORAGE_KEY: "companion_robot_settings_v1",

    // --- geometry (fractions of min(screenW, screenH)) ---
    EYE_W_FRAC: 0.30,
    EYE_H_FRAC: 0.34,
    EYE_GAP_FRAC: 0.11,
    LOOK_RANGE_FRAC: 0.10,

    // --- blinking ---
    BLINK_MIN_INTERVAL: 2200,
    BLINK_MAX_INTERVAL: 6800,
    BLINK_DURATION: 130,

    // --- idle look-around ---
    IDLE_LOOK_MIN: 1400,
    IDLE_LOOK_MAX: 4200,
    IDLE_SUBSTATE_MIN: 2600,
    IDLE_SUBSTATE_MAX: 6200,

    // --- taps ---
    DOUBLE_TAP_WINDOW: 320,
    LONG_PRESS_DELAY: 420,
    TAP_MOVE_TOLERANCE: 14,
    SWIPE_MIN_DIST: 55,
    SWIPE_MAX_DURATION: 320,
    TAP_NOTICE_DURATION: 1000,
    DOUBLE_TAP_EXCITED_DURATION: 1500,

    // --- petting / melting ---
    MELT_THRESHOLD_MS: 3200,
    PETTING_RELEASE_LINGER_MS: 2200,

    // --- repeated tap -> anger ---
    RAPID_TAP_WINDOW_MS: 700,
    ANGER_INC: 0.30,
    ANGER_DECAY_PER_SEC: 0.20,
    ANGER_ANNOYED_T: 0.24,
    ANGER_ANGRY_T: 0.58,
    ANGER_VERY_ANGRY_T: 0.88,
    CALMING_DURATION_MS: 1500,

    // --- microphone ---
    MIC_VOLUME_THRESHOLD: 0.085,
    MIC_LOUD_THRESHOLD: 0.32,
    MIC_LISTEN_HOLD_MS: 1100,
    MIC_LOUD_HOLD_MS: 900,

    // --- camera (heuristic presence, not real face ID) ---
    CAMERA_PRESENT_HOLD_MS: 2600,
    CAMERA_SAMPLE_INTERVAL_MS: 700,
    CAMERA_ABSENCE_FOR_SLEEPY_MS: 40000,

    // --- shake / dizzy ---
    SHAKE_DELTA_THRESHOLD: 15,
    SHAKE_HITS_NEEDED: 3,
    SHAKE_WINDOW_MS: 1200,
    DIZZY_DURATION_MS: 3000,

    // --- sleep / wake ---
    INACTIVITY_SLEEPY_MS_DAY: 75000,
    INACTIVITY_SLEEP_MS_DAY: 130000,
    INACTIVITY_SLEEPY_MS_NIGHT: 30000,
    INACTIVITY_SLEEP_MS_NIGHT: 60000,
    NIGHT_START_HOUR: 22,
    NIGHT_END_HOUR: 7,
    WAKE_SEQUENCE_MS: 900,

    // --- hidden gestures ---
    EDGE_ZONE_FRAC: 0.07,
    BOTTOM_HOLD_MS: 850,
    MULTI_TAP_MAX_GAP_MS: 260,

    MAX_DT_MS: 48 // clamp huge frame gaps (tab switches) so animations don't jump
  };

  /* ---------------------------------------------------------------------
     Expression table. Each entry is a pure set of numbers describing the
     shape/colour/mouth of both eyes for that instant. The renderer
     interpolates the *currently displayed* values toward whichever
     expression is active, then layers blink / look / tremble / droop on
     top. rot is mirrored automatically (left = +rot, right = -rot) so a
     single number produces a symmetric "angry brows" / "sad brows" look;
     asym:true adds a small built-in left/right difference for a
     lopsided, quizzical read.
  --------------------------------------------------------------------- */
  var Expressions = {
    normal:      { sx: 1.00, sy: 1.00, radius: 0.50, rot: 0,   dy: 0,  hue: 205, sat: 88, light: 60, glow: 16, mouth: null,     blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.0 },
    happy:       { sx: 1.00, sy: 0.80, radius: 0.65, rot: 0,   dy: -2, hue: 200, sat: 90, light: 64, glow: 20, mouth: "smile",  blush: 0.10, tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.0 },
    veryHappy:   { sx: 1.05, sy: 0.42, radius: 1.00, rot: 0,   dy: -4, hue: 195, sat: 95, light: 68, glow: 26, mouth: "bigSmile",blush: 0.20, tears: false, sparkle: true,  tremble: 0,    dizzy: false, blinkMul: 0.8 },
    curious:     { sx: 1.12, sy: 1.12, radius: 0.50, rot: 5,   dy: -2, hue: 205, sat: 90, light: 62, glow: 20, mouth: null,     blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 0.7 },
    confused:    { sx: 1.00, sy: 0.95, radius: 0.40, rot: 12,  dy: 0,  hue: 205, sat: 70, light: 58, glow: 14, mouth: "zigzag", blush: 0,    tears: false, sparkle: false, tremble: 0.15, dizzy: false, blinkMul: 1.0, asym: true },
    shy:         { sx: 0.85, sy: 0.55, radius: 0.75, rot: 0,   dy: 10, hue: 205, sat: 68, light: 55, glow: 14, mouth: "flat",   blush: 0.65, tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.3 },
    embarrassed: { sx: 0.80, sy: 0.45, radius: 0.80, rot: 0,   dy: 12, hue: 205, sat: 60, light: 52, glow: 12, mouth: "o",      blush: 0.90, tears: false, sparkle: false, tremble: 0.10, dizzy: false, blinkMul: 1.4 },
    sleepy:      { sx: 1.00, sy: 0.32, radius: 0.30, rot: 0,   dy: 4,  hue: 210, sat: 55, light: 38, glow: 8,  mouth: null,     blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 2.2 },
    sleeping:    { sx: 0.95, sy: 0.05, radius: 0.20, rot: 0,   dy: 6,  hue: 215, sat: 45, light: 24, glow: 5,  mouth: "flat",   blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.0 },
    wakingUp:    { sx: 1.00, sy: 0.50, radius: 0.50, rot: 0,   dy: 0,  hue: 205, sat: 80, light: 55, glow: 14, mouth: "o",      blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.0 },
    excited:     { sx: 1.15, sy: 1.18, radius: 0.60, rot: 0,   dy: -3, hue: 195, sat: 95, light: 66, glow: 26, mouth: "bigSmile",blush: 0,    tears: false, sparkle: true,  tremble: 0,    dizzy: false, blinkMul: 0.6 },
    surprised:   { sx: 1.22, sy: 1.32, radius: 0.90, rot: 0,   dy: -4, hue: 200, sat: 90, light: 68, glow: 24, mouth: "o",      blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 0.5 },
    scared:      { sx: 0.88, sy: 1.25, radius: 0.55, rot: 0,   dy: -2, hue: 215, sat: 70, light: 62, glow: 16, mouth: "o",      blush: 0,    tears: false, sparkle: false, tremble: 0.35, dizzy: false, blinkMul: 1.5 },
    sad:         { sx: 0.95, sy: 0.55, radius: 0.35, rot: 12,  dy: 8,  hue: 220, sat: 55, light: 45, glow: 10, mouth: "frown",  blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.4 },
    crying:      { sx: 0.90, sy: 0.50, radius: 0.35, rot: 12,  dy: 8,  hue: 220, sat: 55, light: 45, glow: 10, mouth: "frown",  blush: 0,    tears: true,  sparkle: false, tremble: 0.10, dizzy: false, blinkMul: 1.6 },
    angry:       { sx: 1.00, sy: 0.65, radius: 0.15, rot: -18, dy: 0,  hue: 2,   sat: 80, light: 55, glow: 22, mouth: "flat",   blush: 0,    tears: false, sparkle: false, tremble: 0.20, dizzy: false, blinkMul: 1.0 },
    veryAngry:   { sx: 1.05, sy: 0.55, radius: 0.05, rot: -24, dy: 0,  hue: 2,   sat: 85, light: 48, glow: 28, mouth: "zigzag", blush: 0,    tears: false, sparkle: false, tremble: 0.40, dizzy: false, blinkMul: 0.9 },
    annoyed:     { sx: 1.00, sy: 0.60, radius: 0.30, rot: -10, dy: 0,  hue: 10,  sat: 60, light: 55, glow: 16, mouth: "flat",   blush: 0,    tears: false, sparkle: false, tremble: 0.12, dizzy: false, blinkMul: 1.1 },
    bored:       { sx: 1.00, sy: 0.40, radius: 0.40, rot: 0,   dy: 2,  hue: 205, sat: 40, light: 50, glow: 10, mouth: "flat",   blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.6 },
    dizzy:       { sx: 0.90, sy: 0.90, radius: 0.80, rot: 0,   dy: 0,  hue: 205, sat: 70, light: 62, glow: 18, mouth: "wavy",   blush: 0,    tears: false, sparkle: false, tremble: 0.20, dizzy: true,  blinkMul: 1.0 },
    melting:     { sx: 1.05, sy: 0.50, radius: 0.85, rot: 0,   dy: 18, hue: 205, sat: 75, light: 60, glow: 16, mouth: "flat",   blush: 0.50, tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.3 },
    love:        { sx: 1.12, sy: 1.12, radius: 1.00, rot: 0,   dy: -2, hue: 232, sat: 78, light: 66, glow: 26, mouth: "smile",  blush: 0.30, tears: false, sparkle: true,  tremble: 0,    dizzy: false, blinkMul: 0.8 },
    proud:       { sx: 1.05, sy: 1.00, radius: 0.60, rot: 0,   dy: -6, hue: 205, sat: 90, light: 62, glow: 20, mouth: "smile",  blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.0 },
    thinking:    { sx: 1.00, sy: 0.85, radius: 0.40, rot: 8,   dy: -4, hue: 205, sat: 80, light: 58, glow: 16, mouth: "flat",   blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.0, asym: true },
    listening:   { sx: 1.06, sy: 1.06, radius: 0.55, rot: 0,   dy: 0,  hue: 200, sat: 90, light: 64, glow: 22, mouth: null,     blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 0.8 },
    focused:     { sx: 1.00, sy: 0.68, radius: 0.25, rot: 0,   dy: 0,  hue: 205, sat: 90, light: 58, glow: 16, mouth: "flat",   blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 0.6 },
    sickTired:   { sx: 0.95, sy: 0.38, radius: 0.30, rot: 8,   dy: 4,  hue: 185, sat: 30, light: 45, glow: 8,  mouth: "wavy",   blush: 0,    tears: false, sparkle: false, tremble: 0.05, dizzy: false, blinkMul: 1.8, asym: true },
    playful:     { sx: 1.08, sy: 1.00, radius: 0.60, rot: 0,   dy: -2, hue: 198, sat: 92, light: 64, glow: 20, mouth: "smirk",  blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 0.7 },
    mischievous: { sx: 1.00, sy: 0.68, radius: 0.50, rot: -10, dy: 0,  hue: 205, sat: 85, light: 58, glow: 18, mouth: "smirk",  blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.0 },
    calm:        { sx: 1.00, sy: 0.88, radius: 0.55, rot: 0,   dy: 0,  hue: 205, sat: 80, light: 58, glow: 14, mouth: null,     blush: 0,    tears: false, sparkle: false, tremble: 0,    dizzy: false, blinkMul: 1.1 }
  };

  /* ---------------------------------------------------------------------
     Personality-state table. Each named behaviour picks one (or randomly
     among several) expression(s) and has a small chance to play a sound
     each time it is (re)entered. Priority tiers follow the brief:
       1 shake/dizzy  2 petting/melting  3 anger family  4 single tap
       5 microphone   6 camera           7 idle family
     The tier is attached where the state is *requested* (see robot.js)
     rather than hard-coded here, since a few expressions (e.g. "curious")
     are reused by more than one tier.
  --------------------------------------------------------------------- */
  var States = {
    idle:        { expr: ["normal", "normal", "curious", "bored", "calm"], sounds: [], chance: 0.04 },
    curious:     { expr: ["curious"], sounds: ["oh", "hmm"], chance: 0.45 },
    happy:       { expr: ["happy"], sounds: ["heh", "yeah"], chance: 0.45 },
    veryHappy:   { expr: ["veryHappy"], sounds: ["yeah", "aww"], chance: 0.65 },
    excited:     { expr: ["excited"], sounds: ["yeah", "aww"], chance: 0.75 },
    shy:         { expr: ["shy", "embarrassed"], sounds: ["mm", "aww"], chance: 0.30 },
    melting:     { expr: ["melting"], sounds: ["aww", "mm", "hmm"], chance: 0.45 },
    annoyed:     { expr: ["annoyed"], sounds: ["hmph"], chance: 0.55 },
    angry:       { expr: ["angry"], sounds: ["hmph", "grr"], chance: 0.65 },
    veryAngry:   { expr: ["veryAngry"], sounds: ["grr"], chance: 0.75 },
    calming:     { expr: ["annoyed", "shy"], sounds: [], chance: 0.08 },
    dizzy:       { expr: ["dizzy"], sounds: ["whoa"], chance: 0.55 },
    surprised:   { expr: ["surprised"], sounds: ["oh", "uh"], chance: 0.55 },
    scared:      { expr: ["scared"], sounds: ["uh", "oh"], chance: 0.45 },
    sad:         { expr: ["sad"], sounds: ["hmm"], chance: 0.25 },
    crying:      { expr: ["crying"], sounds: ["hmm"], chance: 0.25 },
    bored:       { expr: ["bored"], sounds: [], chance: 0.04 },
    calm:        { expr: ["calm"], sounds: [], chance: 0.04 },
    sleepy:      { expr: ["sleepy"], sounds: ["hmm"], chance: 0.12 },
    sleeping:    { expr: ["sleeping"], sounds: [], chance: 0.02 },
    wakingUp:    { expr: ["wakingUp"], sounds: ["hmm", "oh"], chance: 0.55 },
    listening:   { expr: ["listening"], sounds: ["hmm"], chance: 0.18 },
    love:        { expr: ["love"], sounds: ["aww"], chance: 0.35 },
    proud:       { expr: ["proud"], sounds: ["heh"], chance: 0.25 },
    thinking:    { expr: ["thinking"], sounds: [], chance: 0.08 },
    focused:     { expr: ["focused"], sounds: [], chance: 0.04 },
    sickTired:   { expr: ["sickTired"], sounds: ["hmm"], chance: 0.18 },
    playful:     { expr: ["playful"], sounds: ["heh", "ha"], chance: 0.35 },
    mischievous: { expr: ["mischievous"], sounds: ["heh"], chance: 0.35 }
  };

  window.Robot.Util = Util;
  window.Robot.Config = Config;
  window.Robot.Expressions = Expressions;
  window.Robot.States = States;
})();
