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

Three views, for a phone at the gym:

- **Now:** the set going on, with the bar's path as the station follows it, and
  the newest set once it is analysed: reps, mean and peak velocity, bar path,
  velocity over time, and the set's video with the path drawn over it.
- **History:** every set, by day.
- **Camera:** what the camera sees, with the plates the station has found
  ringed, and the settings for aiming it: rotation, focus, exposure and
  brightness. Also the station's state: frame rate, temperature, recording,
  free space, and its log.

It talks only to the kvihtai-core station that serves it: `/api/v1/...` for
status and sets, and the live stream `/ws/live` while a set goes on. Charts are
drawn on canvas; there are no runtime dependencies.

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
