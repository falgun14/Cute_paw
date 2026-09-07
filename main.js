/* ============================================================================
   main.js
   Boots the whole thing. No visible loading screen, no tutorial, no
   buttons on the face itself - this file just wires the pieces from
   config.js / audio.js / sensors.js / robot.js / input.js together and
   starts the animation loop. It also owns the handful of things that
   only make sense at the top level: persisted settings, the one-time
   "first tap unlocks audio + tries fullscreen + tries a wake lock"
   handshake, resize/orientation handling, service-worker registration,
   and pausing sensors/audio when the tab is hidden.
   ========================================================================== */
(function () {
  "use strict";
  window.Robot = window.Robot || {};
  var C = Robot.Config;
  var U = Robot.Util;

  /* ------------------------------- settings -------------------------------- */
  // Deliberately minimal and local-only: mute state + animation intensity,
  // exactly as much as the brief asks the app to remember.
  var Settings = {
    muted: false,
    intensity: 1,
    save: function () {
      try {
        localStorage.setItem(C.STORAGE_KEY, JSON.stringify({ muted: this.muted, intensity: this.intensity }));
      } catch (e) { /* storage unavailable (private mode etc.) - fine, just don't persist */ }
    },
    load: function () {
      try {
        var raw = localStorage.getItem(C.STORAGE_KEY);
        if (raw) {
          var d = JSON.parse(raw);
          if (typeof d.muted === "boolean") this.muted = d.muted;
          if (typeof d.intensity === "number") this.intensity = d.intensity;
        }
      } catch (e) { /* ignore malformed/blocked storage */ }
    }
  };
  Robot.Settings = Settings;

  var wakeLock = null;
  function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      wakeLock.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () { /* not fatal - the robot just runs without a wake lock */ });
  }

  function tryFullscreen() {
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { req.call(el).catch(function () {}); }
  }

  function tryOrientationLock() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("portrait").catch(function () {});
      }
    } catch (e) { /* not supported everywhere - fine */ }
  }

  function hideAddressBarTrick() {
    // Classic mobile-Chrome trick for when the app is opened as a normal
    // tab rather than installed (installed/standalone mode already has no
    // address bar at all).
    window.scrollTo(0, 1);
    setTimeout(function () { window.scrollTo(0, 1); }, 400);
  }

  var firstGestureDone = false;
  function onFirstGesture() {
    if (firstGestureDone) return;
    firstGestureDone = true;
    Robot.Audio.unlock();
    tryFullscreen();
    tryOrientationLock();
    requestWakeLock();
  }

  /* -------------------------------- bootstrap ------------------------------- */
  function boot() {
    Settings.load();
    Robot.Audio.setMuted(Settings.muted);

    var canvas = document.getElementById("robot-canvas");
    var settingsEl = document.getElementById("settings-panel");

    var renderer = new Robot.Renderer(canvas);
    Robot.Brain.init(U.now());

    var input = new Robot.Input(canvas, settingsEl);
    input.wireSettingsPanel();

    document.addEventListener("pointerdown", onFirstGesture, { once: true });
    hideAddressBarTrick();

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { renderer.resize(); }, 60);
    });
    window.addEventListener("orientationchange", function () {
      setTimeout(function () { renderer.resize(); hideAddressBarTrick(); }, 250);
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        Robot.Audio.suspend();
        if (Robot.Sensors.Mic.active) Robot.Sensors.Mic.stop();
        if (Robot.Sensors.Camera.active) Robot.Sensors.Camera.stop();
      } else {
        Robot.Audio.resume();
        if (wakeLock === null && firstGestureDone) requestWakeLock();
      }
    });

    window.addEventListener("pagehide", function () {
      Robot.Sensors.Motion.stop();
      Robot.Sensors.Mic.stop();
      Robot.Sensors.Camera.stop();
      Robot.Audio.destroy();
    });

    function loop(ts) {
      renderer.draw(ts);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js").catch(function () { /* offline caching just won't be available */ });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
