# KvihtAI Web

Lightweight, zero-install web interface for reviewing barbell trajectories, velocity curves, and technical execution metrics.

Designed primarily for in-gym display screens or lifter mobile browsers via local network access.

---

## Features

- **Interactive 2D Trajectory View:** Scaled bar path overlay mapping verticality, loop distance, and catch depth.
- **Kinematic Curves:** Time-series charts for vertical velocity, displacement, and power output.
- **Instant Set Review:** Minimalist session inspector showing reps, velocity loss per set, and rep duration.
- **Low Footprint:** No heavy frontend frameworks or tracking; optimized for instant load on mobile devices.

---

## What is in it

Four views, for a phone at the gym:

- **Now:** the set going on, with the bar's path as the station follows it, and
  the newest set once it is analysed: reps, mean and peak velocity, bar path,
  velocity over time, and the set's video with the path drawn over it. Above
  it, the next set: pick the lift and the weight, and every set that ends from
  then on carries them. Below it, **Keep the recording** for a set the station
  missed: the last five minutes of video are kept for improving it.
- **History:** every set, by day, filtered by lift, with what each was. For a
  lift with weights given, each set's best mean velocity against its weight. A
  set's lift, weight and note can be changed on its card, and its video
  downloaded. **CSV** exports every rep.
- **Camera:** what the camera sees, live, with the plates the station has
  found ringed; tap it for full screen. Below it the setup, in the order it is
  done: picture upright, focus (autofocus or a distance by hand), light, and
  the plate nearer the camera, tapped once.
- **Station:** **Shut down**, **Reboot** and **Restart station**; shut the Pi
  down here before unplugging it, and the page says when it is safe. Then the
  station's state (frame rate, temperature, power supply, memory, recording,
  free space), every problem it has had, its log, the system journal and the
  kernel's messages, filtered to the problems if wanted, and **Download
  diagnostics**, one zip to send with a bug report. Then the recordings on the
  card, to keep or download, and what the station runs on.

Above every view the app says in words what is wrong, if anything: the camera
sending no picture, the station restarting because of it, a power cut or a
crash since it last ran, frames lost, undervoltage, heat, memory, recording
errors. A red dot on **Station** means a problem in the last quarter of an
hour.

It talks only to the kvihtai-core station that serves it: `/api/v1/...` for
status and sets, and the live stream `/ws/live` while a set goes on. Requests
that get no answer are given up after a few seconds, so that a phone that left
the hotspot comes back by itself. Charts are drawn on canvas; there are no
runtime dependencies.

## Develop

Needs Node.js 20 or newer.

```sh
npm ci
KVIHTAI_CORE=http://192.168.1.174:8080 npm run dev
```

`KVIHTAI_CORE` is the station the dev server passes API calls to; it defaults to
`http://localhost:8080`. A station without a camera can run on a laptop from
kvihtai-core, playing a recorded clip in place of the camera:

```sh
KVIHTAI_CAMERA=video:clip.mp4 .venv/bin/uvicorn app.main:app --port 8080
```

## Build and deploy

```sh
npm run build
```

The station serves `dist/`. kvihtai-core's `deploy/push.sh` copies it to the Pi
along with the core; see kvihtai-core's `docs/RASPBERRY_PI.md`.
