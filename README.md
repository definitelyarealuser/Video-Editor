# Video-Editor

A small local web app for bookending a sermon video with a title graphic.

The rendered output is: **PNG** (held for N seconds) → **crossfade** → **your video** → **crossfade** → **PNG** (held for N seconds) → **fade to black**.

## How it works

- **Frontend**: a single static page (`public/`) with a drag-and-drop zone for the video (uploads immediately, then offers a trim scrubber), a drag-and-drop zone for the PNG, number inputs for both bookend durations, the crossfade length, the final fade-to-black length, and the output file name. No build step, no framework.
- **Backend**: an Express server (`server/`) that probes the video with `ffprobe` (resolution, frame rate, duration, whether it has audio), optionally transcribes it locally (`@huggingface/transformers` running Whisper, entirely in Node - no Python, no external API calls once the model is cached) to suggest a sermon start/end, then builds an `ffmpeg` filter graph (`xfade` for video, `acrossfade` for audio, running in parallel so the crossfades stay in sync with silence under the bookend segments) and renders the final MP4. Progress streams back to the browser over Server-Sent Events.

## Prerequisites

- Node.js 18+
- `ffmpeg` and `ffprobe` on your `PATH` (e.g. `sudo apt install ffmpeg` / `brew install ffmpeg`)
- Internet access on first use of **Auto-detect sermon** only, to download the speech-recognition model (~40MB, cached locally afterward under your OS's standard cache directory). Rendering itself never needs the network.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

1. Drop your video (a trimmed clip, or a full multi-hour service recording) into the video dropzone. It uploads right away.
2. If it's a full service file, use the **Trim to just the sermon** panel: click the big **Auto-Detect Sermon** button to have it scan the whole file and suggest a start/end, or drag the two handles yourself - dragging seeks the preview to that exact frame live (muted), and letting go plays a short unmuted snippet right at the cut point, so you can confirm both picture and audio without a separate step. Once you're close (within a few seconds), use the **-5s/-1s/-0.1s/+0.1s/+1s/+5s** nudge buttons under the Start/End readout to fine-tune each handle precisely - each nudge gives the same live preview as dragging. Below that, **Preview Start** / **Preview End** play a short snippet right at the in- or out-point, and **Play** starts playback from wherever the preview is parked while **Stop** halts it and jumps back to the start of your selection. Pick a different **detected candidate** chip if the top guess looks wrong (see [Auto-detect sermon](#auto-detect-sermon) below for how this works and its limits).
3. Drag your bookend PNG into its dropzone.
4. Set the start PNG duration, end PNG duration, crossfade duration, fade-to-black duration, and the output file name.
5. Optionally check **Normalize audio** and pick a target loudness (-20 to -10 LUFS, defaults to -14) and/or **Also render an MP3**.
6. Click **Render Video**. A progress bar tracks the ffmpeg render; when it finishes you get an in-browser preview and download buttons (MP4, plus MP3 if requested).

The uploaded video is kept on the server until a render actually succeeds (so a render error - e.g. a crossfade duration that's too long - doesn't force you to re-upload a multi-GB file, just fix the setting and retry). Everything is cleaned up automatically after 2 hours regardless.

## Auto-detect sermon

Full-service files (worship set → announcements/talking heads → sermon → worship → announcements) can be dropped in as-is. **Auto-detect sermon**:

1. Transcribes the whole file locally in 30-second windows using Whisper (`Xenova/whisper-tiny.en`).
2. Scores each window by words-per-minute to tell sustained speech apart from music/singing (low word density) or silence.
3. Merges consecutive speech windows into candidate blocks (tolerating a couple of quiet windows mid-block, so a pause for prayer or a hushed moment doesn't split it), and ranks candidates by how close they are to a typical ~25-minute sermon length.
4. Suggests the top-ranked block and lists the runner-ups as clickable alternatives.

This is a heuristic, not a transcript-perfect analysis - it can't literally identify "the same person talking," so a long single-speaker Q&A or a lengthy testimony could occasionally outrank the sermon. That's exactly why the result is a **suggestion you review and adjust**, not a blind auto-trim: always check the suggested range (the **Preview selection** button scrubs it instantly, no server round-trip) before rendering. Processing time scales with file length - expect several minutes for a full 1.5-2 hour service on a typical laptop CPU.

## Options

- **Apply crossfade to audio too** (checked by default, next to the crossfade field): when checked, the audio under the bookends crossfades the same way the picture does (`acrossfade`). When unchecked, the audio hard-cuts to/from the main video's audio right as the picture's crossfade starts/ends instead of blending — total length is unaffected either way.
- **Normalize audio**: runs the combined audio (video + bookend silence) through `loudnorm` (EBU R128) targeting the chosen integrated loudness before the final fade-out. Single-pass, so expect the result to land within roughly half a LU of the target.
- **Also render an MP3**: exports a second file alongside the MP4 containing just the main clip's audio — the PNG-hold silence at the start and end is excluded, but the clip still fades up from silence and back down over the crossfade duration, so it sounds like a clean standalone edit rather than an abrupt cut. This applies regardless of the "apply crossfade to audio too" setting above (which only affects the audio inside the full MP4).

## Notes / tuning

- The crossfade duration must be shorter than both PNG durations and the video's own length.
- The PNG is letterboxed (scaled + padded with black) to match the video's resolution, so any aspect ratio works.
- Video is re-encoded with `libx264`/`aac` (CRF 18) regardless of the source codec, since a filter graph like this requires decoding and re-encoding anyway.
- `@huggingface/transformers` currently pulls in two transitive dependencies (`onnxruntime-node`'s bundled `adm-zip`, and `sharp`) with known advisories that have no upstream fix yet. Neither is reachable through this app's own code paths (we never extract untrusted zips or process arbitrary images through them), but `npm audit` will flag them - worth knowing if you audit this repo.
