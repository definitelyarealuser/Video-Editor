# Video-Editor

A small local web app for bookending a sermon video with a title graphic.

The rendered output is: **PNG** (held for N seconds) → **crossfade** → **your video** → **crossfade** → **PNG** (held for N seconds) → **fade to black**.

## How it works

- **Frontend**: a single static page (`public/`) with a drag-and-drop zone for the video (uploads immediately, then offers a trim scrubber), a drag-and-drop zone for the PNG, number inputs for both bookend durations, the crossfade length, and the final fade-to-black length, plus **Series** / **Sermon Title** / **Speaker's Name** / **Sermon Date** text fields that combine into the output file name (and the Vimeo/SoundCloud title), and a **Core Text** field that becomes the Vimeo/SoundCloud description. No build step, no framework.
- **Backend**: an Express server (`server/`) that probes the video with `ffprobe` (resolution, frame rate, duration, whether it has audio), optionally transcribes it locally (`@huggingface/transformers` running Whisper, entirely in Node - no Python, no external API calls once the model is cached) to suggest a sermon start/end, then builds an `ffmpeg` filter graph (`xfade` for video, `acrossfade` for audio, running in parallel so the crossfades stay in sync with silence under the bookend segments) and renders the final MP4. Progress streams back to the browser over Server-Sent Events. Optionally uploads the finished MP4 straight to [Vimeo](#publishing-to-vimeo) and/or the finished MP3 straight to [SoundCloud](#publishing-to-soundcloud), each adding it to their own configured showcases/playlists.

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
3. Drag your bookend PNG into its dropzone, or pick one you've used before from the **library** thumbnails that show up right in the dropzone once you've uploaded at least one - no need to browse for the same title graphic every week. Every graphic you drop in is saved there automatically (deduped by content, so re-uploading the same one doesn't create a duplicate entry). Click **Edit…** next to the thumbnails to delete ones you no longer need - each deletion asks for confirmation first.
4. Set the start PNG duration, end PNG duration, crossfade duration, and fade-to-black duration. Fill in **Series**, **Sermon Title**, **Speaker's Name**, and **Sermon Date (MM DD YY)** - these four combine (in that order, separated by " - ") into both the rendered file name and the title used for Vimeo (and, manually, SoundCloud); a live preview shows the exact file name above the fields. Add **Core Text** below that - it becomes the description on both Vimeo and SoundCloud, so write it once here rather than re-typing it at publish time.
5. Optionally check **Normalize audio** and pick a target loudness (-20 to -10 LUFS, defaults to -14) and/or **Also render an MP3**. Optionally fill in **Also save the MP4/MP3 to this folder on this computer** - full local folder paths (e.g. `C:\Users\andyw\Videos\Sermons` or `/Users/andy/Movies/Sermons`); leave either blank to skip. Click **Browse…** next to either field to pick the folder instead of typing the path by hand - on Windows and Mac this opens the real OS folder picker (Explorer/Finder); anywhere else (or if that fails to launch for some reason) it falls back to a simple in-app browser instead, starting at whatever's already in the field or your home folder if it's empty. This only makes sense because the server runs on your own machine - it copies the finished file(s) there directly, in addition to the in-browser download buttons, so you don't have to manually move them out of your Downloads folder every time. Both paths are remembered the moment you set them, whether or not you go on to render.
6. Click **Render Video**. If [Vimeo publishing](#publishing-to-vimeo) is set up, you'll be asked right then whether to publish this render; if [SoundCloud publishing](#publishing-to-soundcloud) is set up *and* **Also render an MP3** is checked, you'll be asked about that too, as a separate dialog right after Vimeo's - each is a deliberate choice every time, and either can be declined independently of the other. A progress bar tracks the ffmpeg render either way; when it finishes you get download buttons (MP4, plus MP3 if requested), and any publishing you opted into runs automatically afterward with no further clicks needed - Vimeo and SoundCloud upload in parallel, so one doesn't wait on the other.

The uploaded video is kept on the server until a render actually succeeds (so a render error - e.g. a crossfade duration that's too long - doesn't force you to re-upload a multi-GB file, just fix the setting and retry). Everything is cleaned up automatically after 2 hours regardless.

## Publishing to Vimeo

Optional, and off by default - the app works exactly as before if you skip this section entirely.

1. Copy `.env.example` to `.env` and fill in:
   - `VIMEO_ACCESS_TOKEN`: a personal access token from https://developer.vimeo.com/apps, with the `public`, `private`, `upload`, `edit`, and `interact` scopes. Requires a Vimeo plan that supports API uploads (Pro/Business/Premium - not the free tier).
   - `VIMEO_SHOWCASE_IDS`: comma-separated showcase (album) IDs every published video gets added to - find an ID in the showcase's URL (`vimeo.com/showcase/XXXXXXX`). Update this whenever the year or sermon series changes.
2. Restart the app (`npm start`) so it picks up `.env`.

With that in place, clicking **Render Video** shows a **"Publish to Vimeo?"** dialog - it's a deliberate choice every time, never remembered from a previous render. The title and description aren't re-entered here - they're the file name (Series / Sermon Title / Speaker's Name / Sermon Date) and Core Text you already filled in on the main form. The dialog just checks every configured showcase by default; uncheck any you don't want this particular video added to. Choose **Render & Publish to Vimeo**, and once rendering finishes, the app uploads the MP4 with that title and description and adds it to whichever showcases were checked - no separate manual step. A results panel shows the Vimeo link and which showcases succeeded or failed (one showcase failing, e.g. a stale ID, doesn't block the others). Choosing **Render Only** just renders normally, same as if Vimeo weren't configured at all. **Cancel** (or clicking outside the dialog, or pressing Escape) backs out entirely - no render happens at all, so you can adjust settings first and click **Render Video** again.

`.env` is gitignored - the token never gets committed.

## Publishing to SoundCloud

Optional, off by default, and needs a SoundCloud **Artist-Pro** subscription - SoundCloud only opened up self-serve API access to Artist-Pro accounts in 2026, and there's no automated path for accounts below that tier.

1. Register an app at https://developers.soundcloud.com (requires Artist-Pro on the SoundCloud account you're registering under) to get a Client ID and Client Secret.
2. Copy `.env.example` to `.env` (if you haven't already for Vimeo) and fill in:
   - `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET`: from the app you just registered.
   - `SOUNDCLOUD_REDIRECT_URI`: only needed if this app isn't reachable at `http://localhost:3000` - must exactly match what you registered.
   - `SOUNDCLOUD_PLAYLIST_IDS`: comma-separated playlist IDs every published track gets added to (e.g. the current year's sermons and the current series) - find an ID in the playlist's URL. Update this whenever the year or series changes.
3. Restart the app (`npm start`) so it picks up `.env`.

Unlike Vimeo's single access token, SoundCloud needs an actual sign-in: once configured, a **Connect SoundCloud** link appears above the Render button. Click it, log into the FF SoundCloud account in the browser tab that opens, and approve access - that's a one-time step (tokens refresh themselves silently afterward; you'll only need to reconnect if access is ever revoked from SoundCloud's side).

With that done, clicking **Render Video** shows a **"Publish to SoundCloud?"** dialog - separately from Vimeo's, right after it, and only when **Also render an MP3** is checked (SoundCloud is audio-only, so there's nothing to offer otherwise). Same shape as Vimeo's dialog: a Private/Public privacy choice (defaults to Private), checkboxes for which configured playlists to add it to, and **Cancel** / **Render Only** / **Render & Publish to SoundCloud** buttons that behave exactly like Vimeo's equivalents. A results panel shows the track link and which playlists succeeded or failed.

`.env` is gitignored, same as the Vimeo token; the OAuth tokens themselves live in `data/soundcloud-tokens.json`, also gitignored.

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

## Output quality (codec/CRF presets, file size estimates)

Once a video's uploaded, an **Output quality** panel appears above the render settings:

- **Video codec**: H.264 (default - the most universally compatible) or H.265/HEVC (noticeably smaller files at the same visual quality, but 2-4x slower to encode in software). Since Vimeo re-transcodes everything you upload anyway, this choice mostly trades your own render/upload time for file size - it doesn't change what viewers ultimately see on Vimeo either way.
- **Video quality**: High Quality / Balanced / Smaller File - maps to a CRF value per codec (H.265 uses higher CRF numbers than H.264 for comparable perceived quality, since it needs less data to represent the same detail).
- **MP3 bitrate**: 128 / 192 (default) / 320 kbps. Spoken-word sermon audio holds up fine at 128-192kbps; 320kbps is mostly only worth it if there's music you want to preserve at higher fidelity.
- **Estimate File Sizes**: actually encodes a short sample from the middle of your current trim selection at each preset (six short test encodes for video, instant math for MP3, since CBR MP3 size is just bitrate × duration) and shows the extrapolated full-length size right in each dropdown option, e.g. "Balanced (~650 MB)". This is a real measurement against your specific footage, not a generic guess - CRF encoding has no fixed bitrate, so how well a clip compresses depends entirely on its content. Takes anywhere from several seconds to a minute or so depending on resolution/codec. Changing the trim range afterward clears the estimates (they're no longer valid for a different-length clip) - just click the button again.

## Notes / tuning

- The crossfade duration must be shorter than both PNG durations and the video's own length.
- The PNG is letterboxed (scaled + padded with black) to match the video's resolution, so any aspect ratio works.
- Video is re-encoded with `libx264`/`aac` (CRF 18) regardless of the source codec, since a filter graph like this requires decoding and re-encoding anyway.
- `@huggingface/transformers` currently pulls in two transitive dependencies (`onnxruntime-node`'s bundled `adm-zip`, and `sharp`) with known advisories that have no upstream fix yet. Neither is reachable through this app's own code paths (we never extract untrusted zips or process arbitrary images through them), but `npm audit` will flag them - worth knowing if you audit this repo.
