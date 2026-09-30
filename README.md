# Insta360 Gravel Cycling Director Agent

An automated, intelligent Director Agent built in **TypeScript (Node.js 22 LTS)** that analyzes long 360° video recordings of gravel cycling rides and edits them down into an engaging, cohesive 16:9 widescreen overview video (under 15 minutes).

---

## Key Features

- **Multi-Clip / Whole-Ride Support**: Ingests single or multiple sequential 360° MP4 files (exported with FlowState stabilization from Insta360 Studio/app). Automatically allocates the overview duration proportionally across the entire ride.
- **Mount-Aware Cinematography**:
  - `--mount cockpit` (Handlebars): Balances forward trail action (Yaw 0°), hero rider face cam (Yaw 180°), flank views of riders pulling alongside (Yaw ±60°), and scenic pans.
  - `--mount rear` (Seatpost / Above rear): Frames the hero rider in foreground looking ahead (Yaw 0°), pack chase views looking behind (Yaw 180°), and lateral scenic vistas.
- **Action & Pacing Engine**:
  - **85% Clean Cuts**: Natural cuts at scene boundaries (4s to 8.5s per shot).
  - **15% Dynamic Sweeps**: Smooth cosine-eased panning transitions with shortest-path angular wrapping across the $\pm 180^\circ$ seam.
- **Multi-Modal Proxy Analysis**:
  - **Wind Noise Filter**: 200 Hz IIR high-pass filter attenuates cycling wind drone while preserving speech, cheers, and action acoustic surges.
  - **Inter-Frame Motion**: Downsampled motion magnitude detects speed bursts, turns, and stops.
  - **YOLOv11 Rider & Pack Tracking**: Uses `onnxruntime-node` with official YOLO11-nano to detect fellow cyclists and riders in the 360 sphere.
- **Flexible Workflow**:
  - **Autonomous Mode (`auto`)**: One-click analyze, plan, and render.
  - **Human-in-the-Loop Mode (`plan` $\to$ `render`)**: Exports an inspectable/editable `edl.json` with a rich terminal cutlist table before rendering.
- **Hardware-Accelerated Rendering**:
  - FFmpeg native `v360` filter for rectilinear projection (105° FOV).
  - Automatic Intel VAAPI hardware acceleration (`h264_vaapi`) on Intel UHD 620 with fallback to `libx264`.

---

## Quick Start (with `devenv`)

Enter the development environment:
```bash
devenv shell
```

### 1. Autonomous One-Click Mode
Process a single or multiple 360 MP4 clips into a 14-minute overview:
```bash
# Cockpit mount (default)
pnpm director auto ride_part1.mp4 ride_part2.mp4 -o overview_14min.mp4

# Rear mount
pnpm director auto ride_part1.mp4 ride_part2.mp4 --mount rear -o overview_14min.mp4

# Fast draft preview (720p)
pnpm director auto ride_part1.mp4 --draft -o preview.mp4
```

### 2. Human-in-the-Loop Mode
Generate and inspect the Edit Decision List (EDL) before committing to a final render:

```bash
# Step 1: Analyze & generate EDL
pnpm director plan ride_part1.mp4 ride_part2.mp4 -o edl.json --mount cockpit

# Step 2: Render fast 720p draft with HUD overlay
pnpm director render --edl edl.json --draft -o preview.mp4

# Step 3: (Optional) Inspect preview.mp4, note any Shot # from the HUD overlay,
#         and adjust timestamps or angles in edl.json

# Step 4: Render final high-res overview (HUD overlay automatically stripped)
pnpm director render --edl edl.json -o final_overview.mp4
```

#### Timecode & Slate HUD Overlay (Burn-in)
In `--draft` mode (or via `--burn-in`), each shot displays an on-screen HUD in the top-left corner:
```text
Shot #14/82 | ride_part1.mp4 [342.0s-348.5s] | hero_rider | Yaw 180°
```
This lets you instantly identify which shot you're looking at when watching `preview.mp4` so you can jump straight to that segment in `edl.json` to change the angle, trim it, or delete it. When rendering without `--draft`, the overlay is omitted.

---

## CLI Reference

### `director auto <inputs...>`
- `-o, --output <file>`: Output video file path (default: `overview_14min.mp4`)
- `-m, --mount <type>`: Mount position: `cockpit` (default) or `rear`
- `-t, --target-duration <seconds>`: Target overview duration in seconds (default: `840` = 14 min)
- `--draft`: Fast draft mode (720p ultrafast)
- `--skip-vision`: Skip YOLO rider tracking (use audio/motion heuristics only)
- `--edl-out <file>`: Path to save the generated `edl.json`

### `director plan <inputs...>`
- `-o, --output <file>`: Output EDL JSON path (default: `edl.json`)
- `-m, --mount <type>`: Mount position: `cockpit` or `rear`
- `-t, --target-duration <seconds>`: Target overview duration in seconds (default: `840`)
- `--skip-vision`: Skip YOLO rider tracking

### `director render [inputs...]`
- `--edl <file>`: Path to Edit Decision List (EDL JSON) **(Required)**
- `-o, --output <file>`: Output video path (default: `final_overview.mp4`)
- `--draft`: Fast draft mode (720p)

---

## Running Tests

Run the Vitest test suite:
```bash
pnpm test
```
