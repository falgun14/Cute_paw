/* ============================================================================
   robot.js
   Two cooperating pieces:

   Robot.Brain    - a small reactive state machine. Every tick it looks at
                    a bag of "signals" (touch, anger level, sensors, idle
                    timers, sleep clock) and decides, freshest-and-highest-
                    priority-wins, which named personality state should be
                    showing right now. It never gets stuck: every branch
                    either expires on its own or is only reachable while
                    its underlying condition is still true.

   Robot.Renderer - a plain Canvas 2D drawer. It knows nothing about *why*
                    the robot feels a certain way, only how to smoothly
                    interpolate towards whatever expression the Brain
                    reports and paint two eyes (+ optional mouth / blush /
                    tears / sparkle) on screen.
   ========================================================================== */
(function () {
  "use strict";
  window.Robot = window.Robot || {};
  Robot.Signals = Robot.Signals || {};
  var C = Robot.Config;
  var U = Robot.Util;
  var EXPR = Robot.Expressions;
  var STATES = Robot.States;

  function merge(a, b) {
    var out = {}, k;
    for (k in a) if (a.hasOwnProperty(k)) out[k] = a[k];
    if (b) for (k in b) if (b.hasOwnProperty(k)) out[k] = b[k];
    return out;
  }

  /* ============================== BRAIN ================================ */

  var DAY_POOL = [
    ["idle", 30], ["curious", 13], ["bored", 9], ["calm", 12], ["happy", 7],
    ["veryHappy", 2], ["excited", 4], ["playful", 7], ["mischievous", 5],
    ["thinking", 4], ["proud", 3], ["love", 2], ["sad", 1], ["sickTired", 1]
  ];
  var NIGHT_POOL = [
    ["idle", 24], ["calm", 22], ["bored", 14], ["curious", 7], ["happy", 4],
    ["thinking", 5], ["sad", 2], ["love", 2], ["proud", 2], ["sickTired", 2],
    ["playful", 2], ["mischievous", 2]
  ];

  var Brain = {
    activeKey: null,
    activeExprKey: "normal",
    activeEnteredAt: 0,
    wakePhaseUntil: 0,
    _idleSub: "idle",
    _idleSubUntil: 0,
    _biasNextIdle: null,
    _lastTick: 0,
    _angerWasActive: false,
    _tapTimes: [],
    lookTarget: { x: 0, y: 0 },
    _lookUntil: 0,

    init: function (now) {
      now = now || U.now();
      Robot.Signals.lastInteractionAt = now;
      Robot.Signals.angerLevel = 0;
      this._lastTick = now;
      this.activeKey = null;
      this._idleSub = "idle";
      this._idleSubUntil = 0;
    },

    notifyInteraction: function (now) {
      now = now || U.now();
      var wasAsleep = (this._idleSub === "sleeping" || this._idleSub === "sleepy");
      Robot.Signals.lastInteractionAt = now;
      if (wasAsleep) {
        this.wakePhaseUntil = now + C.WAKE_SEQUENCE_MS;
        this._idleSub = "idle";
        this._idleSubUntil = now;
      }
    },

    _registerTapForAnger: function (now) {
      this._tapTimes.push(now);
      var self = this;
      this._tapTimes = this._tapTimes.filter(function (t) { return now - t < C.RAPID_TAP_WINDOW_MS; });
      if (this._tapTimes.length >= 2) {
        Robot.Signals.angerLevel = U.clamp((Robot.Signals.angerLevel || 0) + C.ANGER_INC, 0, 1);
      }
    },

    onSingleTap: function (meta, now) {
      now = now || U.now();
      this.notifyInteraction(now);
      this._registerTapForAnger(now);
      Robot.Signals.tapNoticeUntil = now + C.TAP_NOTICE_DURATION;
      Robot.Signals.tapNoticeMeta = merge({ kind: "single" }, meta);
    },

    onDoubleTap: function (meta, now) {
      now = now || U.now();
      this.notifyInteraction(now);
      this._registerTapForAnger(now);
      Robot.Signals.tapNoticeUntil = now + C.DOUBLE_TAP_EXCITED_DURATION;
      Robot.Signals.tapNoticeMeta = merge({ kind: "double" }, meta);
    },

    onSwipe: function (meta, now) {
      now = now || U.now();
      this.notifyInteraction(now);
      Robot.Signals.tapNoticeUntil = now + C.TAP_NOTICE_DURATION * 0.8;
      Robot.Signals.tapNoticeMeta = merge({ kind: "swipe" }, meta);
    },

    setPetting: function (active, meta, now) {
      now = now || U.now();
      var S = Robot.Signals;
      if (active) {
        if (!S.pettingActive) S.pettingStartAt = now;
        S.pettingActive = true;
        this.notifyInteraction(now);
      } else if (S.pettingActive) {
        S.pettingActive = false;
        S.pettingReleasedUntil = now + C.PETTING_RELEASE_LINGER_MS;
      }
    },

    reset: function (now) {
      now = now || U.now();
      var S = Robot.Signals;
      S.dizzyUntil = 0; S.pettingActive = false; S.pettingReleasedUntil = 0;
      S.angerLevel = 0; S.calmingUntil = 0; S.tapNoticeUntil = 0;
      S.micListeningUntil = 0; S.micLoudUntil = 0; S.cameraPresentUntil = 0;
      this._tapTimes = [];
      this._angerWasActive = false;
      this.wakePhaseUntil = 0;
      this._idleSub = "idle"; this._idleSubUntil = 0; this.activeKey = null;
      this.notifyInteraction(now);
    },

    _isNight: function () {
      var h = new Date().getHours();
      return h >= C.NIGHT_START_HOUR || h < C.NIGHT_END_HOUR;
    },

    _idleTick: function (now) {
      var S = Robot.Signals;
      var night = this._isNight();
      var sleepyT = night ? C.INACTIVITY_SLEEPY_MS_NIGHT : C.INACTIVITY_SLEEPY_MS_DAY;
      var sleepT = night ? C.INACTIVITY_SLEEP_MS_NIGHT : C.INACTIVITY_SLEEP_MS_DAY;
      var lastInt = S.lastInteractionAt || now;
      var inactiveMs = now - lastInt;

      var cameraBoost = 0;
      if (Robot.Sensors && Robot.Sensors.Camera.active && S.cameraLastSeenAt) {
        if (now - S.cameraLastSeenAt > C.CAMERA_ABSENCE_FOR_SLEEPY_MS) cameraBoost = 15000;
      }

      if (inactiveMs > sleepT + cameraBoost) { this._idleSub = "sleeping"; return { state: "sleeping" }; }
      if (inactiveMs > sleepyT + cameraBoost) { this._idleSub = "sleepy"; return { state: "sleepy" }; }

      if (!this._idleSubUntil || now > this._idleSubUntil) {
        var pool = night ? NIGHT_POOL : DAY_POOL;
        var next = this._biasNextIdle || U.weightedChoice(pool);
        this._biasNextIdle = null;
        this._idleSub = next;
        this._idleSubUntil = now + U.randRange(C.IDLE_SUBSTATE_MIN, C.IDLE_SUBSTATE_MAX);
      }
      return { state: this._idleSub };
    },

    _computeDesired: function (now) {
      var dt = now - (this._lastTick || now);
      this._lastTick = now;
      var S = Robot.Signals;

      if (S.angerLevel > 0) {
        S.angerLevel = Math.max(0, S.angerLevel - C.ANGER_DECAY_PER_SEC * (dt / 1000));
        this._angerWasActive = true;
      } else if (this._angerWasActive) {
        this._angerWasActive = false;
        S.calmingUntil = now + C.CALMING_DURATION_MS;
        this._biasNextIdle = Math.random() < 0.5 ? "shy" : "calm";
      }

      if (S.dizzyUntil && now < S.dizzyUntil) return { state: "dizzy" };
      if (this.wakePhaseUntil && now < this.wakePhaseUntil) return { state: "wakingUp" };

      if (S.pettingActive) {
        var dur = now - (S.pettingStartAt || now);
        return { state: dur > C.MELT_THRESHOLD_MS ? "melting" : "shy", meta: { petting: true } };
      }
      if (S.pettingReleasedUntil && now < S.pettingReleasedUntil) return { state: "shy", meta: { lingering: true } };

      if (S.angerLevel > 0) {
        if (S.angerLevel >= C.ANGER_VERY_ANGRY_T) return { state: "veryAngry" };
        if (S.angerLevel >= C.ANGER_ANGRY_T) return { state: "angry" };
        if (S.angerLevel >= C.ANGER_ANNOYED_T) return { state: "annoyed" };
      }
      if (S.calmingUntil && now < S.calmingUntil) return { state: "calming" };

      if (S.tapNoticeUntil && now < S.tapNoticeUntil) {
        var meta = S.tapNoticeMeta || {};
        var st = meta.kind === "double" ? "excited" : (meta.zone === "eyes" ? "curious" : "surprised");
        return { state: st, meta: meta };
      }

      if (S.micLoudUntil && now < S.micLoudUntil) return { state: "surprised", meta: { source: "mic" } };
      if (S.micListeningUntil && now < S.micListeningUntil) return { state: "listening" };

      if (S.cameraPresentUntil && now < S.cameraPresentUntil) {
        return { state: Math.random() < 0.5 ? "curious" : "happy", meta: { source: "camera" } };
      }

      return this._idleTick(now);
    },

    _enterState: function (key, now) {
      this.activeKey = key;
      this.activeEnteredAt = now;
      var def = STATES[key] || STATES.idle;
      this.activeExprKey = U.choice(def.expr);
      if (def.sounds && def.sounds.length && Math.random() < def.chance) {
        Robot.Audio.play(U.choice(def.sounds));
      }
    },

    _updateLook: function (now, key, meta) {
      var forced = null;
      if (key === "shy" || key === "embarrassed" || key === "melting") forced = { x: 0, y: 1 };
      else if (key === "sleeping" || key === "sleepy") forced = { x: 0, y: 0.25 };
      else if ((key === "surprised" || key === "excited" || key === "curious") && meta && meta.dir) forced = meta.dir;
      else if (key === "thinking") forced = { x: -0.55, y: -0.75 };
      else if (key === "sad" || key === "crying") forced = { x: 0, y: 0.55 };

      if (forced) {
        this.lookTarget = forced;
      } else if (!this._lookUntil || now > this._lookUntil) {
        this.lookTarget = Math.random() < 0.22
          ? { x: 0, y: 0 }
          : { x: U.randRange(-1, 1), y: U.randRange(-0.55, 0.55) };
        this._lookUntil = now + U.randRange(C.IDLE_LOOK_MIN, C.IDLE_LOOK_MAX);
      }
      return this.lookTarget;
    },

    getFrame: function (now) {
      var desired = this._computeDesired(now);
      if (desired.state !== this.activeKey) this._enterState(desired.state, now);
      var look = this._updateLook(now, this.activeKey, desired.meta);
      return {
        key: this.activeKey,
        exprKey: this.activeExprKey,
        expr: EXPR[this.activeExprKey],
        elapsed: now - this.activeEnteredAt,
        look: look
      };
    }
  };

  Robot.Brain = Brain;

  /* ============================== RENDERER ============================== */

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0; this.height = 0; this.dpr = 1;
    this.cur = { sx: 1, sy: 1, radius: 0.5, rot: 0, dy: 0, hue: 205, sat: 88, light: 60, glow: 16, blush: 0, mouthOn: 0 };
    this.curLookX = 0; this.curLookY = 0;
    this.nextBlinkAt = U.now() + U.randRange(C.BLINK_MIN_INTERVAL, C.BLINK_MAX_INTERVAL);
    this.blinkStart = 0; this.blinking = false;
    this.startedAt = U.now();
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.width = w; this.height = h;
  };

  function roundRectPath(ctx, w, h, r) {
    var x = -w / 2, y = -h / 2;
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  Renderer.prototype._intensity = function () {
    var s = window.Robot.Settings;
    return (s && typeof s.intensity === "number") ? s.intensity : 1;
  };

  Renderer.prototype._drawEye = function (cx, cy, w, h, radiusFrac, rotDeg, hue, sat, light, glow) {
    var ctx = this.ctx;
    var intensity = this._intensity();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotDeg * Math.PI / 180);
    var r = (Math.min(w, h) / 2) * U.clamp(radiusFrac, 0, 1);

    if (glow > 0 && intensity > 0.45) {
      ctx.shadowBlur = glow * intensity;
      ctx.shadowColor = "hsla(" + hue + "," + sat + "%," + Math.min(light + 15, 85) + "%,0.85)";
    }
    roundRectPath(ctx, w, h, r);
    var grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, "hsl(" + hue + "," + sat + "%," + Math.min(light + 14, 92) + "%)");
    grad.addColorStop(1, "hsl(" + hue + "," + sat + "%," + Math.max(light - 10, 8) + "%)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  };

  function drawMouthShape(ctx, type, cx, cy, size, opacity, hue, sat, light) {
    if (!type || opacity <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = "hsl(" + hue + "," + Math.max(sat - 20, 0) + "%," + Math.min(light + 20, 92) + "%)";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.lineCap = "round";
    ctx.translate(cx, cy);

    if (type === "flat") {
      ctx.beginPath(); ctx.moveTo(-size * 0.5, 0); ctx.lineTo(size * 0.5, 0); ctx.stroke();
    } else if (type === "smile") {
      ctx.beginPath(); ctx.arc(0, -size * 0.15, size * 0.55, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke();
    } else if (type === "bigSmile") {
      ctx.beginPath(); ctx.arc(0, -size * 0.05, size * 0.7, 0.14 * Math.PI, 0.86 * Math.PI);
      ctx.lineWidth = Math.max(3, size * 0.22); ctx.stroke();
    } else if (type === "frown") {
      ctx.beginPath(); ctx.arc(0, size * 0.55, size * 0.55, 1.18 * Math.PI, 1.82 * Math.PI); ctx.stroke();
    } else if (type === "o") {
      ctx.beginPath(); ctx.ellipse(0, 0, size * 0.28, size * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    } else if (type === "zigzag") {
      ctx.beginPath(); ctx.moveTo(-size * 0.5, 0);
      ctx.lineTo(-size * 0.25, -size * 0.22); ctx.lineTo(0, 0);
      ctx.lineTo(size * 0.25, -size * 0.22); ctx.lineTo(size * 0.5, 0);
      ctx.stroke();
    } else if (type === "smirk") {
      ctx.beginPath(); ctx.moveTo(-size * 0.45, size * 0.05);
      ctx.quadraticCurveTo(size * 0.1, size * 0.05, size * 0.5, -size * 0.28);
      ctx.stroke();
    } else if (type === "wavy") {
      ctx.beginPath(); ctx.moveTo(-size * 0.5, 0);
      ctx.quadraticCurveTo(-size * 0.25, -size * 0.22, 0, 0);
      ctx.quadraticCurveTo(size * 0.25, size * 0.22, size * 0.5, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  Renderer.prototype.draw = function (now) {
    var ctx = this.ctx;
    var W = this.width, H = this.height;
    ctx.clearRect(0, 0, W, H);

    var frame = Robot.Brain.getFrame(now);
    var expr = frame.expr, key = frame.key, elapsed = frame.elapsed;
    var S = Math.min(W, H);
    var gScale = S / 360; // dy/tuning numbers below are authored for a ~360px-wide phone

    // ---- time-varying overrides layered on top of the static preset ----
    var sy = expr.sy, radius = expr.radius, dy = expr.dy;
    if (key === "wakingUp") {
      var t = U.clamp(elapsed / C.WAKE_SEQUENCE_MS, 0, 1);
      sy = U.lerp(0.05, expr.sy, U.easeOutCubic(t));
    } else if (key === "melting") {
      var mt = U.clamp(elapsed / 4200, 0, 1);
      dy = U.lerp(expr.dy, expr.dy + 24, mt);
      sy = U.lerp(expr.sy, expr.sy * 0.72, mt);
      radius = U.lerp(expr.radius, 1, mt);
    } else if (key === "sleeping") {
      sy = expr.sy + Math.sin(now / 900) * 0.02 + 0.02;
    } else {
      // a faint idle "breathing" so nothing ever looks perfectly frozen
      sy = expr.sy + Math.sin(now / 1400) * 0.012;
    }

    var target = { sx: expr.sx, sy: sy, radius: radius, rot: expr.rot, dy: dy * gScale, hue: expr.hue, sat: expr.sat, light: expr.light, glow: expr.glow, blush: expr.blush };

    var dt = now - (this._lastDrawAt || now);
    this._lastDrawAt = now;
    var t1 = U.smooth(7.5, Math.min(dt, C.MAX_DT_MS));
    var tLook = U.smooth(3.4, Math.min(dt, C.MAX_DT_MS));
    var cur = this.cur;
    cur.sx = U.lerp(cur.sx, target.sx, t1);
    cur.sy = U.lerp(cur.sy, target.sy, t1);
    cur.radius = U.lerp(cur.radius, target.radius, t1);
    cur.rot = U.lerp(cur.rot, target.rot, t1);
    cur.dy = U.lerp(cur.dy, target.dy, t1);
    cur.hue = U.lerp(cur.hue, target.hue, t1);
    cur.sat = U.lerp(cur.sat, target.sat, t1);
    cur.light = U.lerp(cur.light, target.light, t1);
    cur.glow = U.lerp(cur.glow, target.glow, t1);
    cur.blush = U.lerp(cur.blush, target.blush, t1);
    cur.mouthOn = U.lerp(cur.mouthOn, expr.mouth ? 1 : 0, U.smooth(9, dt));

    this.curLookX = U.lerp(this.curLookX, frame.look.x, tLook);
    this.curLookY = U.lerp(this.curLookY, frame.look.y, tLook);

    // ---- blink scheduler (skipped while already asleep) ----
    var blinkSquash = 1;
    if (key !== "sleeping") {
      if (!this.blinking && now >= this.nextBlinkAt) { this.blinking = true; this.blinkStart = now; }
      if (this.blinking) {
        var dur = C.BLINK_DURATION * U.clamp(expr.blinkMul, 0.4, 3);
        var bt = (now - this.blinkStart) / dur;
        if (bt >= 1) {
          this.blinking = false;
          this.nextBlinkAt = now + U.randRange(C.BLINK_MIN_INTERVAL, C.BLINK_MAX_INTERVAL) * U.clamp(expr.blinkMul, 0.6, 2);
        } else {
          blinkSquash = bt < 0.5 ? 1 - U.easeInOutCubic(bt * 2) : U.easeInOutCubic((bt - 0.5) * 2);
          blinkSquash = Math.max(blinkSquash, 0.04);
        }
      }
    }

    // ---- base geometry ----
    var baseW = S * Robot.Config.EYE_W_FRAC, baseH = S * Robot.Config.EYE_H_FRAC, gap = S * Robot.Config.EYE_GAP_FRAC;
    var cx = W / 2, cy = H / 2;
    var leftCenterX = cx - gap / 2 - baseW / 2;
    var rightCenterX = cx + gap / 2 + baseW / 2;
    var lookOffX = this.curLookX * S * Robot.Config.LOOK_RANGE_FRAC;
    var lookOffY = this.curLookY * S * Robot.Config.LOOK_RANGE_FRAC * 0.7;

    var jitterAmt = expr.tremble * S * 0.012;
    var jx = jitterAmt ? (Math.random() * 2 - 1) * jitterAmt : 0;
    var jy = jitterAmt ? (Math.random() * 2 - 1) * jitterAmt : 0;

    var spinL = 0, spinR = 0, wobble = 0;
    if (expr.dizzy) {
      spinL = (elapsed / 1000) * 250 % 360;
      spinR = -(elapsed / 1000) * 210 % 360;
      wobble = Math.sin(now / 260) * 2.2;
    }

    ctx.save();
    if (wobble) { ctx.translate(cx, cy); ctx.rotate(wobble * Math.PI / 180); ctx.translate(-cx, -cy); }

    var w = baseW * cur.sx;
    var hL = baseH * cur.sy * blinkSquash;
    var hR = baseH * (expr.asym ? cur.sy * 0.84 : cur.sy) * blinkSquash;
    var dyR = cur.dy + (expr.asym ? 5 * gScale : 0);

    // blush sits on the "cheeks" outside/below each eye, drawn underneath so
    // it reads as a soft glow at the edge rather than a patch on top of it.
    // A radial gradient gives the soft falloff cheaply (no ctx.filter blur,
    // which is heavy on low-end software-rendered canvases).
    if (cur.blush > 0.01) {
      ctx.save();
      var blushR = S * 0.065;
      var by = cy + baseH * 0.46 + cur.dy * 0.5 + lookOffY;
      var bxs = [leftCenterX - baseW * 0.22 + lookOffX, rightCenterX + baseW * 0.22 + lookOffX];
      for (var bi = 0; bi < 2; bi++) {
        var bx = bxs[bi];
        var grad = ctx.createRadialGradient(bx, by, 0, bx, by, blushR);
        grad.addColorStop(0, "hsla(340,90%,80%," + Math.min(cur.blush * 1.15, 0.95) + ")");
        grad.addColorStop(0.6, "hsla(340,90%,78%," + Math.min(cur.blush * 0.7, 0.6) + ")");
        grad.addColorStop(1, "hsla(340,90%,78%,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.ellipse(bx, by, blushR, blushR * 0.78, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    this._drawEye(leftCenterX + lookOffX + jx, cy + cur.dy + lookOffY + jy, w, hL, cur.radius, cur.rot + spinL, cur.hue, cur.sat, cur.light, cur.glow);
    this._drawEye(rightCenterX + lookOffX + jx, cy + dyR + lookOffY + jy, w, hR, cur.radius, -cur.rot + spinR, cur.hue, cur.sat, cur.light, cur.glow);

    // tears
    if (expr.tears) {
      var loopMs = 1400;
      [leftCenterX, rightCenterX].forEach(function (ex, i) {
        var phase = ((now + i * 400) % loopMs) / loopMs;
        var ty = cy + baseH * 0.35 + phase * baseH * 0.9;
        var op = Math.sin(phase * Math.PI);
        ctx.save();
        ctx.globalAlpha = op * 0.8;
        ctx.fillStyle = "hsl(200,80%,80%)";
        ctx.beginPath();
        ctx.ellipse(ex + lookOffX, ty + lookOffY, S * 0.014, S * 0.02, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // sparkle
    if (expr.sparkle) {
      var sOp = 0.5 + Math.sin(now / 220) * 0.5;
      ctx.save();
      ctx.globalAlpha = sOp;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(leftCenterX - w * 0.22 + lookOffX, cy - hL * 0.28 + lookOffY, S * 0.01, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(rightCenterX + w * 0.22 + lookOffX, cy - hR * 0.28 + lookOffY, S * 0.01, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // mouth
    if (cur.mouthOn > 0.02 && expr.mouth) {
      var mouthY = cy + baseH * 0.62 + cur.dy * 0.4 + lookOffY;
      drawMouthShape(ctx, expr.mouth, cx + lookOffX, mouthY, S * 0.06, cur.mouthOn, cur.hue, cur.sat, cur.light);
    }

    ctx.restore();
  };

  Robot.Renderer = Renderer;
})();
