/* ============================================================================
   audio.js
   Every sound the robot makes is synthesized in real time with the Web
   Audio API - short, pitched "chirp" style blips (think BB-8 / EMO, not
   speech). Nothing is recorded, nothing is uploaded, there are no audio
   file assets to download. Sounds are generated fresh each time with a
   small random pitch/timing wobble so they never feel like a looped
   sample. If Web Audio is unavailable the engine simply no-ops - the
   robot stays fully functional and silent.
   ========================================================================== */
(function () {
  "use strict";
  window.Robot = window.Robot || {};
  var U = Robot.Util;

  function AudioEngine() {
    this.ctx = null;
    this.muted = false;
    this.unlocked = false;
    this.lastPlayedAt = 0;
    this.lastSound = null;
  }

  AudioEngine.prototype._ensureContext = function () {
    if (this.ctx) return this.ctx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { this.ctx = new Ctx(); } catch (e) { this.ctx = null; }
    return this.ctx;
  };

  // Must be called from within a real user gesture (tap) to satisfy
  // mobile autoplay policies.
  AudioEngine.prototype.unlock = function () {
    var ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") { ctx.resume().catch(function () {}); }
    this.unlocked = true;
  };

  AudioEngine.prototype.setMuted = function (m) { this.muted = !!m; };
  AudioEngine.prototype.toggleMuted = function () { this.muted = !this.muted; return this.muted; };

  // One short synthesized note: frequency glide + soft envelope.
  AudioEngine.prototype._note = function (opts, startAt) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var filter = ctx.createBiquadFilter();

    osc.type = opts.wave || "sine";
    filter.type = "lowpass";
    filter.frequency.value = opts.filter || 3400;

    var f0 = opts.f0, f1 = opts.f1 !== undefined ? opts.f1 : opts.f0;
    osc.frequency.setValueAtTime(f0, startAt);
    if (f1 !== f0) {
      osc.frequency.linearRampToValueAtTime(f1, startAt + opts.dur);
    }
    if (opts.vibrato) {
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      lfo.frequency.value = opts.vibratoRate || 22;
      lfoGain.gain.value = opts.vibrato;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(startAt);
      lfo.stop(startAt + opts.dur + 0.05);
    }

    var peak = opts.gain !== undefined ? opts.gain : 0.16;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + Math.min(0.03, opts.dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + opts.dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startAt);
    osc.stop(startAt + opts.dur + 0.05);
  };

  // Named "words" built from one or more notes, each with light
  // randomisation so repeats don't feel identical. Pitches chosen per
  // emotional flavour (bright/rising = pleased, low/flat = grumpy, etc).
  var RECIPES = {
    oh:   function () { return [{ wave: "sine", f0: 420, f1: 620, dur: 0.16, gain: 0.15 }]; },
    hmm:  function () { return [{ wave: "triangle", f0: 300, f1: 260, dur: 0.30, gain: 0.12, vibrato: 6 }]; },
    aww:  function () { return [{ wave: "sine", f0: 520, f1: 330, dur: 0.34, gain: 0.15 }]; },
    ha:   function () { return [{ wave: "sine", f0: 620, f1: 700, dur: 0.10, gain: 0.16 }]; },
    mm:   function () { return [{ wave: "triangle", f0: 260, f1: 250, dur: 0.14, gain: 0.10 }]; },
    yeah: function () { return [{ wave: "sine", f0: 440, f1: 520, dur: 0.11, gain: 0.15 },
                                 { wave: "sine", f0: 620, f1: 760, dur: 0.14, gain: 0.16, offset: 0.11 }]; },
    whoa: function () { return [{ wave: "sine", f0: 500, f1: 260, dur: 0.42, gain: 0.14, vibrato: 40, vibratoRate: 14 }]; },
    hmph: function () { return [{ wave: "sawtooth", f0: 260, f1: 200, dur: 0.16, gain: 0.09, filter: 1200 }]; },
    grr:  function () { return [{ wave: "sawtooth", f0: 140, f1: 120, dur: 0.30, gain: 0.10, filter: 900, vibrato: 10, vibratoRate: 30 }]; },
    uh:   function () { return [{ wave: "triangle", f0: 380, f1: 340, dur: 0.12, gain: 0.12 }]; },
    ah:   function () { return [{ wave: "sine", f0: 480, f1: 440, dur: 0.18, gain: 0.13 }]; },
    heh:  function () { return [{ wave: "sine", f0: 560, f1: 600, dur: 0.08, gain: 0.14 },
                                 { wave: "sine", f0: 520, f1: 560, dur: 0.09, gain: 0.13, offset: 0.11 }]; }
  };

  AudioEngine.prototype.play = function (name) {
    if (this.muted) return;
    if (!RECIPES[name]) return;
    var ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") { ctx.resume().catch(function () {}); }

    // Don't let sounds machine-gun on top of each other.
    var now = U.now();
    if (now - this.lastPlayedAt < 90) return;
    this.lastPlayedAt = now;
    this.lastSound = name;

    var jitter = U.randRange(-0.06, 0.06); // +/- semitone-ish pitch wobble
    var notes = RECIPES[name]();
    var t0 = ctx.currentTime + 0.005;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var opts = {
        wave: n.wave,
        f0: n.f0 * (1 + jitter),
        f1: n.f1 * (1 + jitter),
        dur: n.dur * U.randRange(0.92, 1.08),
        gain: n.gain,
        filter: n.filter,
        vibrato: n.vibrato,
        vibratoRate: n.vibratoRate
      };
      this._note(opts, t0 + (n.offset || 0));
    }
  };

  AudioEngine.prototype.suspend = function () {
    if (this.ctx && this.ctx.state === "running") { this.ctx.suspend().catch(function () {}); }
  };
  AudioEngine.prototype.resume = function () {
    if (this.ctx && this.ctx.state === "suspended") { this.ctx.resume().catch(function () {}); }
  };
  AudioEngine.prototype.destroy = function () {
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} }
    this.ctx = null;
  };

  window.Robot.Audio = new AudioEngine();
})();
