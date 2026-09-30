# 🚴 Domestique

> **The autonomous AI director that turns hours of raw 360° ride footage into cinematic highlight reels while you recover.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-v22%20LTS-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-v360%20%2B%20VAAPI-red.svg)](https://ffmpeg.org)

In professional cycling, the *domestique* does all the grueling work behind the scenes so the team leader can shine. **Domestique** does the same for your gravel rides and action cam footage: ingest multiple 30-minute 360° video files, track rider action and scenic vistas, select the top highlights chronologically, and render a 16:9 widescreen overview video in under 15 minutes — completely headlessly.

---

## Features

- **Multi-Clip Ride Ingest**: Automatically stitches and normalizes multiple sequential 360° MP4 clips into one unified ride timeline.
- **Mount-Aware Cinematography**:
  - `--mount cockpit` (Handlebars): Balances forward trail action (Yaw 0°), hero rider face cam (Yaw 180°), flank views of riders pulling alongside (Yaw ±60°), and scenic sweeps.
  - `--mount rear` (Seatpost / Above rear): Frames the hero rider in foreground looking ahead (Yaw 0°), pack chase views looking behind (Yaw 180°), and lateral scenic vistas.
- **Action & Pacing Engine**:
  - **85% Clean Cuts**: Natural cuts at scene boundaries (4.0s to 8.5s per shot).
  - **15% Dynamic Sweeps**: Smooth cosine-eased panning transitions with shortest-path angular wrapping across the $\pm 180^\circ$ seam.
- **Multi-Modal Proxy Analysis**:
  - **200 Hz Wind Noise Filter**: Strips gravel wind buffeting while retaining speech, cheers, gear shifts, and tire crunches.
  - **Inter-Frame Motion**: Low-resolution proxy stream (160x90 @ 2fps) for instantaneous speed burst and scene cut detection.
  - **YOLOv11 Rider & Pack Tracking**: Official YOLO11-nano model via `onnxruntime-node` detects fellow cyclists and riders in 360° space.
- **Timecode & Slate HUD Overlay**:
  - In draft mode (`--draft`), burns in an on-screen HUD (`Shot #14/82 | ride_01.mp4 [342.0s-348.5s] | hero_rider | Yaw 180°`) for effortless visual inspection before final render.
- **Hardware-Accelerated Rendering**:
  - FFmpeg native `v360` filter for rectilinear projection (105° FOV).
  - Intel VAAPI hardware acceleration (`h264_vaapi` on Intel UHD Graphics) with software `libx264` fallback.

---

## Quick Start (with `devenv` / `direnv`)

The development environment auto-activates when you `cd` into the directory:

```bash
cd domestique
```

### 1. Autonomous One-Click Mode
Process an entire ride into a 14-minute overview video:
```bash
# Cockpit mount (default)
pnpm domestique auto ride_part1.mp4 ride_part2.mp4 -o overview_14min.mp4

# Rear mount
pnpm domestique auto ride_part1.mp4 ride_part2.mp4 --mount rear -o overview_14min.mp4

# Fast draft preview (720p with on-screen HUD overlay)
pnpm domestique auto ride_part1.mp4 --draft -o preview.mp4
```

### 2. Human-in-the-Loop Mode
Generate and inspect the Edit Decision List (EDL) before committing to a final render:

```bash
# Step 1: Analyze & generate EDL
pnpm domestique plan ride_part1.mp4 ride_part2.mp4 -o edl.json --mount cockpit

# Step 2: Render fast 720p draft with HUD overlay
pnpm domestique render --edl edl.json --draft -o preview.mp4

# Step 3: (Optional) Watch preview.mp4, note any Shot # from the HUD overlay,
#         and adjust timestamps or angles in edl.json

# Step 4: Render final high-res overview (HUD overlay automatically stripped)
pnpm domestique render --edl edl.json -o final_overview.mp4
```

---

## CLI Reference

### `domestique auto <inputs...>`
- `-o, --output <file>`: Output video file path (default: `overview_14min.mp4`)
- `-m, --mount <type>`: Mount position: `cockpit` (default) or `rear`
- `-t, --target-duration <seconds>`: Target overview duration in seconds (default: `840` = 14 min)
- `--draft`: Fast draft mode (720p ultrafast with HUD burn-in)
- `--burn-in`: Force on-screen HUD overlay
- `--no-burn-in`: Force disable HUD overlay
- `--skip-vision`: Skip YOLO rider tracking (use audio/motion heuristics only)
- `--edl-out <file>`: Path to save the generated `edl.json`

### `domestique plan <inputs...>`
- `-o, --output <file>`: Output EDL JSON path (default: `edl.json`)
- `-m, --mount <type>`: Mount position: `cockpit` or `rear`
- `-t, --target-duration <seconds>`: Target overview duration in seconds (default: `840`)
- `--skip-vision`: Skip YOLO rider tracking

### `domestique render [inputs...]`
- `--edl <file>`: Path to Edit Decision List (EDL JSON) **(Required)**
- `-o, --output <file>`: Output video path (default: `final_overview.mp4`)
- `--draft`: Fast draft mode (720p)
- `--burn-in`: Force on-screen HUD overlay
- `--no-burn-in`: Disable HUD overlay (default for non-draft)

---

## Tests

Run the test suite:
```bash
pnpm test
```

---

## License

MIT © [Dilan Pauli](https://github.com/dilan-pauli)
