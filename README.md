# Video-Editor

A small local web app for bookending a sermon video with a title graphic.

The rendered output is: **PNG** (held for N seconds) → **crossfade** → **your video** → **crossfade** → **PNG** (held for N seconds) → **fade to black**.

## How it works

- **Frontend**: a single static page (`public/`) with drag-and-drop zones for the video and PNG, number inputs for both bookend durations, the crossfade length, the final fade-to-black length, and the output file name. No build step, no framework.
- **Backend**: an Express server (`server/`) that accepts the upload, probes the video with `ffprobe` (resolution, frame rate, duration, whether it has audio), builds an `ffmpeg` filter graph (`xfade` for video, `acrossfade` for audio, running in parallel so the crossfades stay in sync with silence under the bookend segments), and renders the final MP4. Progress streams back to the browser over Server-Sent Events.

## Prerequisites

- Node.js 18+
- `ffmpeg` and `ffprobe` on your `PATH` (e.g. `sudo apt install ffmpeg` / `brew install ffmpeg`)

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

1. Drag your bookend PNG into the left dropzone, and your sermon video into the right one.
2. Set the start PNG duration, end PNG duration, crossfade duration, fade-to-black duration, and the output file name.
3. Optionally check **Normalize audio** and pick a target loudness (-20 to -10 LUFS, defaults to -14) and/or **Also render an MP3**.
4. Click **Render Video**. A progress bar tracks the ffmpeg render; when it finishes you get an in-browser preview and download buttons (MP4, plus MP3 if requested).

Uploaded source files are deleted as soon as a render finishes (or fails). Rendered outputs are cleaned up automatically after 2 hours.

## Options

- **Apply crossfade to audio too** (checked by default, next to the crossfade field): when checked, the audio under the bookends crossfades the same way the picture does (`acrossfade`). When unchecked, the audio hard-cuts to/from the main video's audio right as the picture's crossfade starts/ends instead of blending — total length is unaffected either way.
- **Normalize audio**: runs the combined audio (video + bookend silence) through `loudnorm` (EBU R128) targeting the chosen integrated loudness before the final fade-out. Single-pass, so expect the result to land within roughly half a LU of the target.
- **Also render an MP3**: exports a second file alongside the MP4 containing just the main clip's audio — the PNG-hold silence at the start and end is excluded, but the clip still fades up from silence and back down over the crossfade duration, so it sounds like a clean standalone edit rather than an abrupt cut. This applies regardless of the "apply crossfade to audio too" setting above (which only affects the audio inside the full MP4).

## Notes / tuning

- The crossfade duration must be shorter than both PNG durations and the video's own length.
- The PNG is letterboxed (scaled + padded with black) to match the video's resolution, so any aspect ratio works.
- Video is re-encoded with `libx264`/`aac` (CRF 18) regardless of the source codec, since a filter graph like this requires decoding and re-encoding anyway.
