/* ============================================================================
   input.js
   The whole screen is the robot's "skin". This module turns raw Pointer
   Events into the gestures described in the brief:
     tap, double tap, long-press / petting (incl. dragging while held),
     swipe, repeated taps, and touch-zone awareness (eyes / left / right /
     upper / lower) - plus the four *hidden* gestures that never show any
     on-screen affordance: three-finger tap (mute), long-press on the
     bottom edge (settings), swipe down from the top edge (exit
     fullscreen), and a two-finger double-tap (reset).
   ========================================================================== */
(function () {
  "use strict";
  window.Robot = window.Robot || {};
  var C = Robot.Config;
  var U = Robot.Util;

  function Input(canvas, settingsEl) {
    this.canvas = canvas;
    this.settingsEl = settingsEl;
    this.active = new Map();       // pointerId -> {x,y,t,startX,startY,zone}
    this.longPressTimer = null;
    this.bottomHoldTimer = null;
    this.isPetting = false;
    this.pendingSingleTapTimer = null;
    this.pendingSingleTapMeta = null;
    this.twoFingerLastTapAt = 0;
    this.multiPeak = 0;
    this.multiSessionStart = 0;
    this.settingsOpen = false;

    this._bind();
  }

  Input.prototype._zoneFor = function (x, y) {
    var W = window.innerWidth, H = window.innerHeight;
    var cx = W / 2, cy = H / 2;
    var S = Math.min(W, H);
    var eyeGap = S * C.EYE_GAP_FRAC, eyeW = S * C.EYE_W_FRAC;
    var leftCx = cx - eyeGap / 2 - eyeW / 2;
    var rightCx = cx + eyeGap / 2 + eyeW / 2;
    var nearEyeR = eyeW * 0.9;
    if (Math.hypot(x - leftCx, y - cy) < nearEyeR || Math.hypot(x - rightCx, y - cy) < nearEyeR) return "eyes";
    if (y < H * 0.38) return "upper";
    if (y > H * 0.64) return "lower";
    return x < cx ? "left" : "right";
  };

  Input.prototype._dirFor = function (x, y) {
    var W = window.innerWidth, H = window.innerHeight;
    return {
      x: U.clamp((x - W / 2) / (W / 2), -1, 1),
      y: U.clamp((y - H / 2) / (H / 2), -1, 1) * 0.8
    };
  };

  Input.prototype._inTopEdge = function (y) { return y < window.innerHeight * C.EDGE_ZONE_FRAC; };
  Input.prototype._inBottomEdge = function (y) { return y > window.innerHeight * (1 - C.EDGE_ZONE_FRAC); };

  Input.prototype._bind = function () {
    var self = this;
    var el = this.canvas;

    el.addEventListener("pointerdown", function (e) { self._onDown(e); });
    el.addEventListener("pointermove", function (e) { self._onMove(e); }, { passive: false });
    el.addEventListener("pointerup", function (e) { self._onUp(e); });
    el.addEventListener("pointercancel", function (e) { self._onUp(e); });
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    // Block page scroll/zoom/pull-to-refresh while still letting us read gestures.
    el.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  };

  Input.prototype._onDown = function (e) {
    var now = U.now();
    var rec = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: now, zone: this._zoneFor(e.clientX, e.clientY) };
    this.active.set(e.pointerId, rec);

    if (this.active.size === 1) {
      this.multiSessionStart = now;
      this.multiPeak = 1;
    } else {
      this.multiPeak = Math.max(this.multiPeak, this.active.size);
      // A second finger arriving cancels a pending single-finger long-press.
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
      if (this.bottomHoldTimer) { clearTimeout(this.bottomHoldTimer); this.bottomHoldTimer = null; }
    }

    if (this.active.size === 1) {
      var self = this;

      if (this._inBottomEdge(rec.y)) {
        this.bottomHoldTimer = setTimeout(function () {
          if (self.active.size === 1 && self.active.has(e.pointerId)) self._openSettings();
        }, C.BOTTOM_HOLD_MS);
      } else if (!this._inTopEdge(rec.y)) {
        // Only the plain face (not the reserved top/bottom edge strips) pets.
        this.longPressTimer = setTimeout(function () {
          if (self.active.size === 1 && self.active.has(e.pointerId)) {
            self.isPetting = true;
            Robot.Brain.setPetting(true, {}, U.now());
          }
        }, C.LONG_PRESS_DELAY);
      }
    }
  };

  Input.prototype._onMove = function (e) {
    var rec = this.active.get(e.pointerId);
    if (!rec) return;
    rec.x = e.clientX; rec.y = e.clientY;
    // Petting tolerates - even welcomes - a scratching drag motion.
  };

  Input.prototype._onUp = function (e) {
    var now = U.now();
    var rec = this.active.get(e.pointerId);
    if (!rec) return;
    this.active.delete(e.pointerId);

    if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    if (this.bottomHoldTimer) { clearTimeout(this.bottomHoldTimer); this.bottomHoldTimer = null; }

    if (this.isPetting) {
      if (this.active.size === 0) {
        this.isPetting = false;
        Robot.Brain.setPetting(false, {}, now);
      }
      // If another finger is still down we keep petting going on that one.
      return;
    }

    var dx = rec.x - rec.startX, dy = rec.y - rec.startY;
    var dist = Math.hypot(dx, dy);
    var dur = now - rec.t;
    var wasSoleTouch = (this.multiPeak === 1);

    if (this.active.size === 0) {
      // Evaluate any completed hidden multi-finger gesture for this session.
      if (this.multiPeak === 3 && (now - this.multiSessionStart) < 500) {
        this._toggleMute();
        this.multiPeak = 0;
        return;
      }
      if (this.multiPeak === 2 && (now - this.multiSessionStart) < 450 && dist < C.TAP_MOVE_TOLERANCE * 2) {
        if (now - this.twoFingerLastTapAt < C.DOUBLE_TAP_WINDOW * 1.6) {
          this._resetRobot();
          this.twoFingerLastTapAt = 0;
        } else {
          this.twoFingerLastTapAt = now;
        }
        this.multiPeak = 0;
        return;
      }
      this.multiPeak = 0;
    }

    if (!wasSoleTouch) return; // don't feed multi-finger residue into single-finger gestures

    if (this._inTopEdge(rec.startY) && dy > C.SWIPE_MIN_DIST && dur < C.SWIPE_MAX_DURATION * 1.4) {
      this._topEdgeSwipeDown();
      return;
    }

    if (dist < C.TAP_MOVE_TOLERANCE && dur < C.LONG_PRESS_DELAY) {
      this._handleTap(rec, now);
    } else if (dist > C.SWIPE_MIN_DIST && dur < C.SWIPE_MAX_DURATION) {
      Robot.Brain.onSwipe({ zone: rec.zone, dir: this._dirFor(rec.x, rec.y) }, now);
      if (Robot.Audio) Robot.Audio.unlock();
    }
  };

  Input.prototype._handleTap = function (rec, now) {
    Robot.Audio.unlock();
    var meta = { zone: rec.zone, dir: this._dirFor(rec.x, rec.y) };
    if (this.pendingSingleTapTimer) {
      clearTimeout(this.pendingSingleTapTimer);
      this.pendingSingleTapTimer = null;
      Robot.Brain.onDoubleTap(meta, now);
    } else {
      var self = this;
      this.pendingSingleTapTimer = setTimeout(function () {
        self.pendingSingleTapTimer = null;
        Robot.Brain.onSingleTap(meta, U.now());
      }, C.DOUBLE_TAP_WINDOW);
    }
  };

  Input.prototype._toggleMute = function () {
    var muted = Robot.Audio.toggleMuted();
    Robot.Settings.muted = muted;
    Robot.Settings.save();
    Robot.Brain.notifyInteraction(U.now());
  };

  Input.prototype._resetRobot = function () {
    Robot.Brain.reset(U.now());
    if (this.settingsOpen) this._closeSettings();
  };

  Input.prototype._topEdgeSwipeDown = function () {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      this._openSettings();
    }
  };

  Input.prototype._openSettings = function () {
    if (this.settingsOpen) return;
    this.settingsOpen = true;
    this.settingsEl.classList.add("open");
    this.settingsEl.setAttribute("aria-hidden", "false");
  };
  Input.prototype._closeSettings = function () {
    this.settingsOpen = false;
    this.settingsEl.classList.remove("open");
    this.settingsEl.setAttribute("aria-hidden", "true");
  };

  /* ------------------------- settings panel wiring ------------------------- */
  Input.prototype.wireSettingsPanel = function () {
    var self = this;
    var $ = function (id) { return document.getElementById(id); };

    $("settings-close").addEventListener("click", function () { self._closeSettings(); });

    var soundToggle = $("toggle-sound");
    soundToggle.checked = !Robot.Settings.muted;
    soundToggle.addEventListener("change", function () {
      Robot.Audio.setMuted(!soundToggle.checked);
      Robot.Settings.muted = !soundToggle.checked;
      Robot.Settings.save();
      if (soundToggle.checked) { Robot.Audio.unlock(); Robot.Audio.play("ha"); }
    });

    // Motion/mic/camera are never auto-started from a saved flag - each
    // session starts with all three off, and turning one on here (a real
    // tap on a real button) is the user gesture that authorizes it.
    var motionBtn = $("toggle-motion");
    var motionSensor = Robot.Sensors.Motion;
    var refreshMotionBtn = function () {
      if (!motionSensor.supported) { motionBtn.textContent = "Not available on this device"; motionBtn.disabled = true; return; }
      motionBtn.textContent = motionSensor.active ? "Shake to make dizzy: on" : "Shake to make dizzy: off";
    };
    motionBtn.addEventListener("click", function () {
      if (motionSensor.active) {
        motionSensor.stop();
        refreshMotionBtn();
      } else {
        motionSensor.requestPermission().then(function (result) {
          if (result === "denied") { motionBtn.textContent = "Motion permission denied"; return; }
          motionSensor.start();
          refreshMotionBtn();
        });
      }
    });
    refreshMotionBtn();

    var micBtn = $("toggle-mic");
    var refreshMicBtn = function () {
      if (!Robot.Sensors.Mic.supported) { micBtn.textContent = "Not available on this device"; micBtn.disabled = true; return; }
      micBtn.textContent = Robot.Sensors.Mic.active ? "Listening: on" : "Listening: off";
    };
    micBtn.addEventListener("click", function () {
      if (Robot.Sensors.Mic.active) {
        Robot.Sensors.Mic.stop();
        refreshMicBtn();
      } else {
        Robot.Sensors.Mic.start().then(function () {
          refreshMicBtn();
        }).catch(function () { micBtn.textContent = "Microphone permission denied"; });
      }
    });
    refreshMicBtn();

    var camBtn = $("toggle-camera");
    var refreshCamBtn = function () {
      if (!Robot.Sensors.Camera.supported) { camBtn.textContent = "Not available on this device"; camBtn.disabled = true; return; }
      camBtn.textContent = Robot.Sensors.Camera.active ? "Notices when you're near: on" : "Notices when you're near: off";
    };
    camBtn.addEventListener("click", function () {
      if (Robot.Sensors.Camera.active) {
        Robot.Sensors.Camera.stop();
        refreshCamBtn();
      } else {
        Robot.Sensors.Camera.start().then(function () {
          refreshCamBtn();
        }).catch(function () { camBtn.textContent = "Camera permission denied"; });
      }
    });
    refreshCamBtn();

    var fsBtn = $("toggle-fullscreen");
    fsBtn.addEventListener("click", function () {
      var d = document, el = document.documentElement;
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      } else {
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch(function () {});
      }
    });

    var intensitySlider = $("intensity-slider");
    intensitySlider.value = Robot.Settings.intensity;
    intensitySlider.addEventListener("input", function () {
      Robot.Settings.intensity = parseFloat(intensitySlider.value);
      Robot.Settings.save();
    });

    var resetBtn = $("settings-reset");
    resetBtn.addEventListener("click", function () { self._resetRobot(); });
  };

  Robot.Input = Input;
})();
