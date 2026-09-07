/* ============================================================================
   sensors.js
   Three independent, fully optional input sources. None of them start
   automatically - the settings panel turns each on, and each is a plain
   start()/stop() module that writes into the shared Robot.Signals object
   for the brain to read. Every sensor cleans up its listeners/streams on
   stop() so nothing leaks if toggled repeatedly.
   ========================================================================== */
(function () {
  "use strict";
  window.Robot = window.Robot || {};
  Robot.Signals = Robot.Signals || {};
  var C = Robot.Config;
  var U = Robot.Util;

  /* ----------------------------- Motion / shake ----------------------------- */
  var Motion = {
    active: false,
    supported: !!window.DeviceMotionEvent,
    _hits: [],
    _handler: null,

    needsPermission: function () {
      return typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function";
    },

    // Must be called from a user gesture on platforms that require it.
    requestPermission: function () {
      if (!this.needsPermission()) return Promise.resolve("granted");
      return DeviceMotionEvent.requestPermission().catch(function () { return "denied"; });
    },

    start: function () {
      if (this.active || !this.supported) return;
      var self = this;
      this._hits = [];
      this._handler = function (e) {
        var a = e.accelerationIncludingGravity || e.acceleration;
        if (!a) return;
        var mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
        if (self._prevMag !== undefined) {
          var delta = Math.abs(mag - self._prevMag);
          if (delta > C.SHAKE_DELTA_THRESHOLD) {
            var now = U.now();
            self._hits.push(now);
            self._hits = self._hits.filter(function (t) { return now - t < C.SHAKE_WINDOW_MS; });
            if (self._hits.length >= C.SHAKE_HITS_NEEDED) {
              Robot.Signals.dizzyUntil = now + C.DIZZY_DURATION_MS;
              self._hits = [];
            }
          }
        }
        self._prevMag = mag;
      };
      window.addEventListener("devicemotion", this._handler, { passive: true });
      this.active = true;
    },

    stop: function () {
      if (!this.active) return;
      window.removeEventListener("devicemotion", this._handler);
      this._handler = null;
      this._hits = [];
      this.active = false;
    }
  };

  /* ------------------------------- Microphone ------------------------------- */
  var Mic = {
    active: false,
    supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    _stream: null,
    _ctx: null,
    _analyser: null,
    _data: null,
    _raf: null,

    start: function () {
      if (this.active || !this.supported) return Promise.reject("unsupported");
      var self = this;
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (stream) {
        self._stream = stream;
        var Ctx = window.AudioContext || window.webkitAudioContext;
        self._ctx = new Ctx();
        var src = self._ctx.createMediaStreamSource(stream);
        self._analyser = self._ctx.createAnalyser();
        self._analyser.fftSize = 512;
        self._analyser.smoothingTimeConstant = 0.75;
        src.connect(self._analyser);
        self._data = new Uint8Array(self._analyser.frequencyBinCount);
        self.active = true;
        self._loop();
        return true;
      });
    },

    _loop: function () {
      if (!this.active) return;
      var self = this;
      this._analyser.getByteTimeDomainData(this._data);
      var sum = 0;
      for (var i = 0; i < this._data.length; i++) {
        var v = (this._data[i] - 128) / 128;
        sum += v * v;
      }
      var rms = Math.sqrt(sum / this._data.length);
      var now = U.now();
      if (rms > C.MIC_LOUD_THRESHOLD) {
        Robot.Signals.micLoudUntil = now + C.MIC_LOUD_HOLD_MS;
        Robot.Signals.micListeningUntil = now + C.MIC_LISTEN_HOLD_MS;
      } else if (rms > C.MIC_VOLUME_THRESHOLD) {
        Robot.Signals.micListeningUntil = now + C.MIC_LISTEN_HOLD_MS;
      }
      this._raf = setTimeout(function () { self._loop(); }, 90); // local analysis only, nothing recorded/stored
    },

    stop: function () {
      if (!this.active) return;
      this.active = false;
      if (this._raf) clearTimeout(this._raf);
      if (this._stream) { this._stream.getTracks().forEach(function (t) { t.stop(); }); }
      if (this._ctx) { try { this._ctx.close(); } catch (e) {} }
      this._stream = null; this._ctx = null; this._analyser = null; this._data = null;
    }
  };

  /* -------------------------------- Camera --------------------------------- */
  // Lightweight *presence* heuristic only (frame-difference / brightness on a
  // tiny downscaled canvas). This is NOT face recognition and identifies no
  // one - it only asks "did something change in front of the lens". Uses the
  // browser's built-in Shape Detection API for a real face box when the
  // browser happens to support it, otherwise falls back to the heuristic.
  // No frame is ever saved, exported or sent anywhere.
  var Camera = {
    active: false,
    supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    _stream: null,
    _video: null,
    _canvas: null,
    _ctx: null,
    _timer: null,
    _prevFrame: null,
    _faceDetector: null,

    start: function () {
      if (this.active || !this.supported) return Promise.reject("unsupported");
      var self = this;
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 160, height: 120 }, audio: false }).then(function (stream) {
        self._stream = stream;
        self._video = document.createElement("video");
        self._video.setAttribute("playsinline", "");
        self._video.muted = true;
        self._video.srcObject = stream;
        self._video.play().catch(function () {});
        self._canvas = document.createElement("canvas");
        self._canvas.width = 48; self._canvas.height = 36;
        self._ctx = self._canvas.getContext("2d", { willReadFrequently: true });

        if (window.FaceDetector) {
          try { self._faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); }
          catch (e) { self._faceDetector = null; }
        }

        self.active = true;
        self._tick();
        return true;
      });
    },

    _tick: function () {
      if (!this.active) return;
      var self = this;

      var afterSample = function (present) {
        if (present) {
          var now = U.now();
          Robot.Signals.cameraPresentUntil = now + C.CAMERA_PRESENT_HOLD_MS;
          Robot.Signals.cameraLastSeenAt = now;
        }
        self._timer = setTimeout(function () { self._tick(); }, C.CAMERA_SAMPLE_INTERVAL_MS);
      };

      if (this._faceDetector && this._video.readyState >= 2) {
        this._faceDetector.detect(this._video).then(function (faces) {
          afterSample(faces && faces.length > 0);
        }).catch(function () { self._heuristicSample(afterSample); });
      } else {
        this._heuristicSample(afterSample);
      }
    },

    _heuristicSample: function (cb) {
      if (!this._video || this._video.readyState < 2) { cb(false); return; }
      try {
        this._ctx.drawImage(this._video, 0, 0, this._canvas.width, this._canvas.height);
        var frame = this._ctx.getImageData(0, 0, this._canvas.width, this._canvas.height).data;
        var brightness = 0;
        for (var i = 0; i < frame.length; i += 4) {
          brightness += (frame[i] + frame[i + 1] + frame[i + 2]) / 3;
        }
        brightness /= (frame.length / 4);

        var diff = 0;
        if (this._prevFrame) {
          for (var j = 0; j < frame.length; j += 4) {
            diff += Math.abs(frame[j] - this._prevFrame[j]);
          }
          diff /= (frame.length / 4);
        }
        this._prevFrame = frame;

        // "Present" = the scene isn't just a dark/empty static background:
        // reasonably lit AND either currently changing or holding a
        // non-trivial mid-brightness pattern (a face/torso filling the frame).
        var present = brightness > 35 && (diff > 2.2 || brightness > 60);
        cb(present);
      } catch (e) {
        cb(false);
      }
    },

    stop: function () {
      if (!this.active) return;
      this.active = false;
      if (this._timer) clearTimeout(this._timer);
      if (this._stream) { this._stream.getTracks().forEach(function (t) { t.stop(); }); }
      if (this._video) { this._video.pause(); this._video.srcObject = null; }
      this._stream = null; this._video = null; this._canvas = null; this._ctx = null; this._prevFrame = null;
    }
  };

  window.Robot.Sensors = { Motion: Motion, Mic: Mic, Camera: Camera };
})();
