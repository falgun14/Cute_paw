# Companion — a desktop robot that lives in a phone

A full-screen, black-background, glowing-eyes robot face for turning an old
Android phone (built and tuned against a Redmi 4A / 5" portrait screen) into
a little desktop companion. No ESP32, no Arduino, no external hardware, no
paid APIs, no server, no login, no cloud database. Everything - personality,
animation, sound, and any sensing you opt into - runs client-side in the
phone's own browser.

The face shows only two eyes (plus an occasional tiny mouth). There is no
text, no buttons, no menu, no chat interface, and no "Hello sir" - just an
expression engine and a small reactive personality that decides what the
eyes should be doing from one moment to the next.

## What's in this folder

```
index.html      the page shell (canvas + the hidden settings panel)
style.css       full-screen black stage + settings-panel look
config.js       tunable constants, the 30-expression table, the personality-state table
audio.js        Web Audio synthesized "chirp" sounds (no audio files, nothing recorded)
sensors.js      optional shake / microphone / camera-presence modules (all off by default)
robot.js        the personality state machine ("Brain") + the Canvas renderer
input.js        touch-gesture recognition + the hidden-gesture handlers + settings wiring
main.js         bootstrap: settings persistence, first-tap setup, main loop, service worker
manifest.json   PWA manifest (name, icons, standalone/fullscreen display)
sw.js           service worker - caches the app shell for offline use
icon-192.png    home-screen icons
icon-512.png
```

No build step, no bundler, no npm install. It's plain HTML/CSS/JS designed
to run directly in an old mobile browser.

## Installing it on the phone

A couple of the features this app uses (camera, microphone, motion,
installing as a standalone app, the service worker) only work in a
**secure context** - that means `https://` or `localhost`, not a plain
`file://` double-click. Two easy ways to get there:

**Option A — host it for free, then open it on the phone**
Upload this folder to any static host (GitHub Pages, Netlify, Vercel,
Cloudflare Pages, etc. all have free tiers). Open the resulting `https://`
URL in Chrome on the phone.

**Option B — serve it from the phone itself, no internet required**
Install [Termux](https://f-droid.org/packages/com.termux/) from F-Droid,
then inside Termux:
```
pkg install python
cd /path/to/this/folder
python -m http.server 8080
```
Open `http://localhost:8080` in Chrome on the same phone. This keeps
everything fully offline and local to the device.

**Then, either way, install it as a standalone app:**
1. Open the URL in Chrome on the phone.
2. Tap the ⋮ menu → **Add to Home screen** (Chrome may also offer an
   automatic "Install" banner - either works).
3. Launch it from the home screen icon from then on. Installed this way it
   opens with no address bar, no browser chrome, and (after the first
   visit) keeps working with the phone in airplane mode.

Once it's been opened once while online, the service worker has cached the
whole app, so it will keep loading and running with **no network at all**
from then on.

## What works out of the box vs. what needs a permission

| Feature | Needs a permission? |
|---|---|
| Eyes, blinking, all 30 expressions, idle personality, sleep/wake by time of day | No |
| Tap, double-tap, long-press/petting, melting, swipe, repeated-tap anger, calming | No |
| Sound (synthesized chirps) | No — just needs one tap anywhere to unlock audio (a browser requirement, not this app's choice) |
| Fullscreen, keeping the screen awake | Requested automatically on your first tap. If your browser blocks it, the robot still runs fine windowed. |
| Shake-to-get-dizzy | Motion sensor — opt in from the hidden settings panel |
| "Listening" reaction to sound/voice | Microphone — opt in from the hidden settings panel. Audio is analysed locally in real time (volume only) and is never recorded or sent anywhere. |
| Noticing when someone's nearby | Camera — opt in from the hidden settings panel. See the honesty note below. |

Motion, microphone and camera are **off by default every time you open the
app**, on purpose - each one only turns on when you tap its toggle in the
hidden settings panel, which is the deliberate "user gesture" a browser
requires before it will grant that permission.

**Honesty note on the camera feature:** this is a *presence* heuristic, not
face recognition. On a phone this old there's no realistic way to run real
face detection smoothly, so instead it watches a tiny 48×36 downscaled
version of the camera feed for brightness and frame-to-frame change. If
your browser happens to expose the experimental Shape Detection API, it's
used opportunistically for a real face box; otherwise it silently falls
back to the heuristic. No frame is ever saved, displayed, or sent
anywhere - it's read, measured, and thrown away, 1-2 times a second.

## Hidden gestures

None of these show any on-screen button - they're the "secret" controls:

- **Long-press the very bottom edge** of the screen (~⅔ second) → opens the
  hidden settings panel (sound, motion/mic/camera toggles, fullscreen,
  animation intensity, reset).
- **Three-finger tap** anywhere → toggles sound on/off.
- **Two-finger double-tap** anywhere → resets the robot to a neutral idle
  state (clears anger, petting, dizziness, etc).
- **Swipe down from the very top edge** → exits fullscreen (or opens
  settings if it's not currently fullscreen).

## Performance on old hardware

Everything is Canvas 2D (no WebGL, no 3D, no video backgrounds, no image
assets bigger than the two small home-screen icons). If the phone still
feels choppy:
- Open the hidden settings panel and drag **Animation intensity** down -
  below a threshold it turns off the eyes' glow (`shadowBlur`, the single
  most expensive thing this app draws), which is the biggest lever for
  frame rate on a low-end GPU.
- Leave the camera feature off unless you want it - it's the most CPU-
  hungry optional piece (it decodes live video), while motion and
  microphone are both very cheap.

## A note on what "expression engine" means here

Rather than 30 hand-authored drawings, this is a small parametric system:
one renderer, and a table of 30 named presets (shape, roundness, colour,
tilt, droop, tremble, mouth, blush/tears/sparkle flags) that the renderer
smoothly interpolates towards. A personality state machine (idle, curious,
shy, petting → melting, annoyed → angry → very angry → calming, dizzy,
sleepy → sleeping → waking, listening, and a dozen more) decides which
preset should be showing at any instant, reacting to touch, sensors, and a
day/night-aware idle/sleep clock, always in a priority order so a stronger
reaction (a shake) can interrupt a weaker one (idle curiosity) and every
state eventually decays back to idle on its own - nothing ever gets stuck.
