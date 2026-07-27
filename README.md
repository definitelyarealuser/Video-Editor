# Video-Editor

A small local web app for bookending a sermon video with a title graphic.

The rendered output is: **PNG** (held for N seconds) → **crossfade** → **your video** → **crossfade** → **PNG** (held for N seconds) → **fade to black**.

## How it works

- **Frontend**: a single static page (`public/`) with a drag-and-drop zone for the video (uploads immediately, then offers a trim scrubber), a drag-and-drop zone for the PNG, number inputs for both bookend durations, the crossfade length, the final fade-to-black length, and the output file name. No build step, no framework.
- **Backend**: an Express server (`server/`) that probes the video with `ffprobe` (resolution, frame rate, duration, whether it has audio), optionally transcribes it locally (`@huggingface/transformers` running Whisper, entirely in Node - no Python, no external API calls once the model is cached) to suggest a sermon start/end, then builds an `ffmpeg` filter graph (`xfade` for video, `acrossfade` for audio, running in parallel so the crossfades stay in sync with silence under the bookend segments) and renders the final MP4. Progress streams back to the browser over Server-Sent Events. Optionally (see [Publishing to Vimeo](#publishing-to-vimeo)) uploads the finished MP4 straight to Vimeo and adds it to configured showcases.

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
6. Click **Render Video**. If [Vimeo publishing](#publishing-to-vimeo) is set up, you'll be asked right then whether to publish this render - a progress bar tracks the ffmpeg render either way; when it finishes you get an in-browser preview and download buttons (MP4, plus MP3 if requested), and the Vimeo upload (if you opted in) runs automatically afterward with no further clicks needed.

The uploaded video is kept on the server until a render actually succeeds (so a render error - e.g. a crossfade duration that's too long - doesn't force you to re-upload a multi-GB file, just fix the setting and retry). Everything is cleaned up automatically after 2 hours regardless.

## Publishing to Vimeo

Optional, and off by default - the app works exactly as before if you skip this section entirely.

1. Copy `.env.example` to `.env` and fill in:
   - `VIMEO_ACCESS_TOKEN`: a personal access token from https://developer.vimeo.com/apps, with the `public`, `private`, `upload`, `edit`, and `interact` scopes. Requires a Vimeo plan that supports API uploads (Pro/Business/Premium - not the free tier).
   - `VIMEO_SHOWCASE_IDS`: comma-separated showcase (album) IDs every published video gets added to - find an ID in the showcase's URL (`vimeo.com/showcase/XXXXXXX`). Update this whenever the year or sermon series changes.
2. Restart the app (`npm start`) so it picks up `.env`.

With that in place, clicking **Render Video** shows a **"Publish to Vimeo?"** dialog - it's a deliberate choice every time, never remembered from a previous render. The description box starts pre-filled with `Core Text: TBD` ("TBD" pre-selected so typing immediately replaces it) - edit it to the actual passage, and it checks every configured showcase by default; uncheck any you don't want this particular video added to. Choose **Render & Publish to Vimeo**, and once rendering finishes, the app uploads the MP4 with that description, titles it using your output file name, and adds it to whichever showcases were checked - no separate manual step. A results panel shows the Vimeo link and which showcases succeeded or failed (one showcase failing, e.g. a stale ID, doesn't block the others). Choosing **Render Only** just renders normally, same as if Vimeo weren't configured at all. **Cancel** (or clicking outside the dialog, or pressing Escape) backs out entirely - no render happens at all, so you can adjust settings first and click **Render Video** again.

`.env` is gitignored - the token never gets committed. SoundCloud publishing isn't automated (SoundCloud has approved very few new API applications in years); that upload stays a manual step for now.

## Auto-detect sermon

Full-service files (worship set → announcements/talking heads → sermon → worship → announcements) can be dropped in as-is. **Auto-detect sermon**:

1. Transcribes the whole file locally in 30-second windows using Whisper (`Xenova/whisper-tiny.en`) - windows quieter than -40 dBFS (true silence/dead air, not quiet music) are skipped without a transcription call at all, which both speeds things up and avoids a known Whisper failure mode where it hallucinates text on near-silent audio.
2. In parallel, runs one ffmpeg pass computing spectral flatness per window - a measure of how tonal/harmonic (sustained notes, chords) vs. noise-like the audio itself is, independent of what got transcribed.
3. Scores each window by *effective* words-per-minute to tell sustained speech apart from music/singing/silence. Word count alone isn't enough - sung lyrics can transcribe just fine and look like normal speech - so two extra signals discount a window's word count even when the words came through clearly: a low unique-word ratio (a repeated chorus like "Alleluia, alleluia..." has very few distinct words for its length, which natural speech doesn't) and low spectral flatness (tonal/harmonic audio, from step 2).
4. Merges consecutive speech windows into candidate blocks (tolerating a couple of quiet windows mid-block, so a pause for prayer or a hushed moment doesn't split it), and ranks candidates by how close they are to a typical ~35-minute sermon length (30-45 min is treated as comfortably normal).
5. Gives a candidate's score a boost if its opening seconds contain a greeting/self-introduction ("good morning", "my name is...") and a smaller boost if its closing seconds contain prayer language ("let us pray", "amen", "in Jesus' name") - soft signals, not requirements, since neither is guaranteed every week.
6. Suggests the top-ranked block and lists the runner-ups as clickable alternatives. If the full scoring finds nothing at all (the repeated-phrase/flatness discounts turn out too strict for that particular recording), it automatically retries with those discounts disabled, then with a looser speech threshold, before giving up - a lower-confidence suggestion is always better than "trim manually with no starting point."

This is a heuristic, not a transcript-perfect analysis - it can't literally identify "the same person talking," so a long single-speaker Q&A or a lengthy testimony could occasionally outrank the sermon. That's exactly why the result is a **suggestion you review and adjust**, not a blind auto-trim: always check the suggested range (**Preview Start**/**Preview End** scrub it instantly, no server round-trip) before rendering. Processing time scales with file length - expect several minutes for a full 1.5-2 hour service on a typical laptop CPU.

The scoring constants (target length, opening/closing phrase patterns, word-density threshold, repetition/flatness discounts) live at the top of `server/sermonDetect.js` and ship as reasonable starting guesses, not values tuned on a large dataset - if Auto-Detect picks the wrong block on a real file (or falls back to a looser pass, or finds nothing), the terminal running `npm start` logs a summary for that analysis (chunk counts, which fallback tier it landed on). That log line, plus the actual sermon start/end for that file versus what it suggested, is the most useful thing to report back so the constants can be adjusted against real cases instead of guesses.

## Learning from your own renders

Every render also feeds a small local history (`data/history.json`, gitignored - nothing leaves your machine) that two things read back from:

- **Detection self-tunes over time.** Once there are at least 3 renders with a real confirmed trim, the target sermon length (currently a fixed ~35 min guess) gets replaced by the actual mean/spread of *your* past confirmed sermon durations. Once there are at least 3 renders where Auto-Detect actually ran for that file, the speech-vs-music thresholds (word pace, repetition ratio, spectral flatness) get recalibrated the same way, using the real transcribed/flatness data from inside vs. outside your confirmed trim as ground truth instead of the synthetic tone/noise signals they ship calibrated against. Fewer than 3 examples and it just uses the defaults - not enough data to safely override a hand-picked value.
- **Render settings are remembered.** The bookend durations, crossfade length, fade-to-black, audio-crossfade/normalization/MP3 choices from your most recent render pre-fill the form on your next visit, instead of the fixed HTML defaults - so once you've dialed in how you like fades to happen, you don't re-enter it every time.

A fully manual trim (no Auto-Detect run) still contributes its duration to the target-length calibration, since you're still confirming a real sermon length either way - it just can't contribute to the speech/music threshold calibration, since that needs the per-window transcript/flatness data Auto-Detect produces.

## Options

- **Apply crossfade to audio too** (checked by default, next to the crossfade field): when checked, the audio under the bookends crossfades the same way the picture does (`acrossfade`). When unchecked, the audio hard-cuts to/from the main video's audio right as the picture's crossfade starts/ends instead of blending — total length is unaffected either way.
- **Normalize audio**: runs the combined audio (video + bookend silence) through `loudnorm` (EBU R128) targeting the chosen integrated loudness before the final fade-out. Single-pass, so expect the result to land within roughly half a LU of the target.
- **Also render an MP3**: exports a second file alongside the MP4 containing just the main clip's audio — the PNG-hold silence at the start and end is excluded, but the clip still fades up from silence and back down over the crossfade duration, so it sounds like a clean standalone edit rather than an abrupt cut. This applies regardless of the "apply crossfade to audio too" setting above (which only affects the audio inside the full MP4).

## Notes / tuning

- The crossfade duration must be shorter than both PNG durations and the video's own length.
- The PNG is letterboxed (scaled + padded with black) to match the video's resolution, so any aspect ratio works.
- Video is re-encoded with `libx264`/`aac` (CRF 18) regardless of the source codec, since a filter graph like this requires decoding and re-encoding anyway.
- `@huggingface/transformers` currently pulls in two transitive dependencies (`onnxruntime-node`'s bundled `adm-zip`, and `sharp`) with known advisories that have no upstream fix yet. Neither is reachable through this app's own code paths (we never extract untrusted zips or process arbitrary images through them), but `npm audit` will flag them - worth knowing if you audit this repo.
