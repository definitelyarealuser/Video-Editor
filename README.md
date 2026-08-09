# Video-Editor

A small local web app for bookending a sermon video with a title graphic.

The rendered output is: **PNG** (held for N seconds) → **crossfade** → **your video** → **crossfade** → **PNG** (held for N seconds) → **fade to black**.

## How it works

- **Frontend**: a single static page (`public/`) with a drag-and-drop zone for the video (uploads immediately, then offers a trim scrubber), a drag-and-drop zone for the PNG, number inputs for both bookend durations, the crossfade length, and the final fade-to-black length, plus **Series** / **Sermon Title** / **Speaker's Name** / **Sermon Date** text fields that combine into the output file name (and the Vimeo/SoundCloud title), and a **Core Text** field that becomes the Vimeo/SoundCloud description. No build step, no framework.
- **Backend**: an Express server (`server/`) that probes the video with `ffprobe` (resolution, frame rate, duration, whether it has audio), builds an `ffmpeg` filter graph (`xfade` for video, `acrossfade` for audio, running in parallel so the crossfades stay in sync with silence under the bookend segments), and renders the final MP4. Progress streams back to the browser over Server-Sent Events. Optionally uploads the finished MP4 straight to [Vimeo](#publishing-to-vimeo) and/or the finished MP3 straight to [SoundCloud](#publishing-to-soundcloud), each adding it to their own configured showcases/playlists.

## Prerequisites

- Node.js 18+
- `ffmpeg` and `ffprobe` on your `PATH` (e.g. `sudo apt install ffmpeg` / `brew install ffmpeg`)

## Run it

**On a Mac, for a non-technical install (no Terminal typing):**

1. Download [`Sermon-Video-Editor-Installer.zip`](dist/Sermon-Video-Editor-Installer.zip) and open it (Safari usually unzips it automatically; otherwise double-click the downloaded `.zip`).
2. Double-click **Sermon Video Editor Installer.app**. The first time, macOS will refuse to open it because it's from an unidentified developer - **right-click (or Control-click) the app → Open → Open** to confirm just this once. It'll never ask again for this app.
3. A Terminal window opens and does the work for you: installs Homebrew/Node/ffmpeg/git if needed, downloads the app to `~/Video-Editor`, and adds a **Sermon Video Editor** shortcut to the Desktop. This can take a few minutes on a completely fresh Mac.
4. From then on, just double-click the **Sermon Video Editor** shortcut on the Desktop any time to start the app (it opens a Terminal window and your browser automatically; closing the window stops the app). Re-running the installer app is also safe any time - it updates an existing install in place, same as the automatic update check described below.

**On a Mac, if you're comfortable with Terminal**, paste this once instead (the URL points at the current development branch - update it to `/main/` once this work is merged there):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/definitelyarealuser/Video-Editor/claude/sermon-video-editor-fa7r7w/setup.command)"
```

This does the exact same thing as the installer app above, just without the double-click/Gatekeeper steps.

**Manually, or on any other platform:**

```bash
npm install
npm start
```

Then open http://localhost:3000.

### Updating

Fully automatic - no button, no steps. Every time you start the app (via the Desktop shortcut or `start.command`), it checks GitHub for a newer version before it even opens the browser tab. If one's available, it pulls it down, reinstalls dependencies if they changed, and restarts itself once to load the new code - you'll just see a few extra seconds of startup, then the app comes up already current. Works the same way on every machine you've installed it on. Requires the app to have been started via `start.command` (which the Desktop shortcut and manual double-click both use) - that's what relaunches the server process after it exits to apply an update.

### About the installer app

`Sermon Video Editor Installer.app` (source in `installer/`, built as `dist/Sermon-Video-Editor-Installer.zip`) is a thin wrapper: double-clicking it just opens Terminal and runs `/bin/bash -c "$(curl -fsSL .../setup.command)"` for you, the same command as the Terminal option above. It fetches `setup.command` fresh from GitHub every time it runs rather than bundling a copy, so it doesn't need rebuilding when `setup.command`'s own logic changes - only rebuild and re-commit the zip if `installer/Sermon Video Editor Installer.app/Contents/{Info.plist,MacOS/run,Resources/bootstrap.command}` themselves change, or once this branch merges to `main` (`bootstrap.command` has the same branch-name `NOTE:` as `setup.command`). To rebuild: `cd installer && zip -r -X ../dist/Sermon-Video-Editor-Installer.zip "Sermon Video Editor Installer.app"`. It's unsigned/not notarized (no Apple Developer account involved), so macOS Gatekeeper blocks a plain double-click the first time - the right-click → Open step in the instructions above is how a user gets past that one-time warning.

1. Drop your video (a trimmed clip, or a full multi-hour service recording) into the video dropzone. It uploads right away.
2. If it's a full service file, use the **Trim to just the sermon** panel: drag the two handles to select just the sermon - dragging seeks the preview to that exact frame live (muted), and letting go plays a short unmuted snippet right at the cut point, so you can confirm both picture and audio without a separate step. Once you're close (within a few seconds), use the **-5s/-1s/-0.1s/+0.1s/+1s/+5s** nudge buttons under the Start/End readout to fine-tune each handle precisely - each nudge gives the same live preview as dragging. Below that, **Preview Start** / **Preview End** play a short snippet right at the in- or out-point, and **Play** starts playback from wherever the preview is parked while **Stop** halts it and jumps back to the start of your selection.
3. Drag your bookend PNG into its dropzone, or pick one you've used before from the **library** thumbnails that show up right in the dropzone once you've uploaded at least one - no need to browse for the same title graphic every week. Every graphic you drop in is saved there automatically (deduped by content, so re-uploading the same one doesn't create a duplicate entry). Click **Edit…** next to the thumbnails to delete ones you no longer need - each deletion asks for confirmation first.
4. Set the start PNG duration, end PNG duration, crossfade duration, and fade-to-black duration. Fill in **Series**, **Sermon Title**, **Speaker's Name**, and **Sermon Date (MM DD YY)** - these four combine (in that order, separated by " - ") into both the rendered file name and the title used for Vimeo (and, manually, SoundCloud); a live preview shows the exact file name above the fields. Add **Core Text** below that - it becomes the description on both Vimeo and SoundCloud, so write it once here rather than re-typing it at publish time.
5. Optionally check **Normalize audio** and pick a target loudness (-20 to -10 LUFS, defaults to -14) and/or **Render MP3**. Fill in **Save the MP4 to this folder on this computer** - a full local folder path (e.g. `C:\Users\andyw\Videos\Sermons` or `/Users/andy/Movies/Sermons`); this is required, since the app always saves the render straight to your machine. If **Render MP3** is checked, **Save the MP3 to this folder on this computer** is required too. Click **Browse…** next to either field to pick the folder instead of typing the path by hand - on Windows and Mac this opens the real OS folder picker (Explorer/Finder); anywhere else (or if that fails to launch for some reason) it falls back to a simple in-app browser instead, starting at whatever's already in the field or your home folder if it's empty. This only makes sense because the server runs on your own machine - it copies the finished file(s) there directly, so you don't have to manually move them out of your Downloads folder every time. Both paths are remembered the moment you set them, whether or not you go on to render.
6. Click **Render Video**. If [Vimeo publishing](#publishing-to-vimeo) is set up, you'll be asked right then whether to publish this render; if [SoundCloud publishing](#publishing-to-soundcloud) is set up *and* **Render MP3** is checked, you'll be asked about that too, as a separate dialog right after Vimeo's - each is a deliberate choice every time, and either can be declined independently of the other. If you allow desktop notifications when prompted, you'll get a system notification when the render finishes (or fails) if you've switched away from the tab.

If **Render MP3** is checked, the MP3 renders first - it's just the clip's own audio with no video encoding involved, so it finishes well before the MP4 does. Its save confirmation (and SoundCloud publish, if you opted in) happens right away, while the progress bar switches over to the video and keeps going - you don't have to wait for the video to grab or upload the audio. Once the video's done too, the app copies it to the folder you chose and shows its own confirmation. Download buttons only appear if a local save actually fails, as a fallback way to get the file - otherwise there's nothing to download, since it's already where you asked for it.

Once everything's finished, two buttons appear: **Start Over** clears the whole form for a completely new sermon, while **Re-Edit** jumps straight back into trimming the exact same video - if the start/end points were off, this fixes just that without re-uploading the file or re-typing the bookend image, name fields, Core Text, or any other setting.

The uploaded video is kept on the server for 2 hours after upload regardless of whether the render succeeds, fails, or you use Re-Edit on it more than once - a render error (e.g. a crossfade duration that's too long) or a mis-trimmed cut doesn't force you to re-upload a multi-GB file, just fix the setting and retry. Everything is cleaned up automatically once that window passes.

## Publishing to Vimeo

Optional, and off by default - the app works exactly as before if you skip this section entirely. Two ways to connect an account - pick one:

**Option A - a personal access token (simplest on one machine, manual on every additional one):**

1. Copy `.env.example` to `.env` and fill in `VIMEO_ACCESS_TOKEN`: a personal access token from https://developer.vimeo.com/apps, with the `public`, `private`, `upload`, `edit`, and `interact` scopes. Requires a Vimeo plan that supports API uploads (Pro/Business/Premium - not the free tier).
2. Restart the app (`npm start`) so it picks up `.env`.

This works right away, with nothing further to click in the app - but `.env` is never copied between machines automatically (it's gitignored, and the update mechanism deliberately never touches it), so setting up a second or third machine means manually copying this same value into a new `.env` there too.

**Option B - Connect Vimeo button (a bit more setup once, but each additional machine only needs a login, not a copied secret):**

1. On the same app page at https://developer.vimeo.com/apps where a personal access token is generated, find the app's **Client Identifier** and **Client Secret** instead.
2. In the app's settings, add `http://localhost:3000/api/vimeo/oauth-callback` as a callback/redirect URL.
3. Copy `.env.example` to `.env` and fill in `VIMEO_CLIENT_ID` and `VIMEO_CLIENT_SECRET` with those two values (leave `VIMEO_ACCESS_TOKEN` blank).
4. Restart the app (`npm start`), then click the **Connect Vimeo** link that appears above the Render button, and log in with the Vimeo account once.

Either way, also fill in `VIMEO_SHOWCASE_IDS` in `.env`: comma-separated showcase (album) IDs every published video gets added to - find an ID in the showcase's URL (`vimeo.com/showcase/XXXXXXX`). Update this whenever the year or sermon series changes.

With either option connected, clicking **Render Video** shows a **"Publish to Vimeo?"** dialog - it's a deliberate choice every time, never remembered from a previous render. The title and description aren't re-entered here - they're the file name (Series / Sermon Title / Speaker's Name / Sermon Date) and Core Text you already filled in on the main form. Privacy defaults to Public (adjustable per-render via the dropdown). The dialog just checks every configured showcase by default; uncheck any you don't want this particular video added to. Choose **Render & Publish to Vimeo**, and once rendering finishes, the app uploads the MP4 with that title and description and adds it to whichever showcases were checked - no separate manual step. A results panel shows the Vimeo link and which showcases succeeded or failed (one showcase failing, e.g. a stale ID, doesn't block the others). Choosing **Render Only** just renders normally, same as if Vimeo weren't configured at all. **Cancel** (or clicking outside the dialog, or pressing Escape) backs out entirely - no render happens at all, so you can adjust settings first and click **Render Video** again.

`.env` is gitignored - none of these values ever get committed. With Option B, the account-level token itself lives in `data/vimeo-tokens.json`, also gitignored.

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

## Render settings are remembered

Every render feeds a small local history (`data/history.json`, gitignored - nothing leaves your machine): the bookend durations, crossfade length, fade-to-black, audio-crossfade/normalization/MP3 choices from your most recent render pre-fill the form on your next visit, instead of the fixed HTML defaults - so once you've dialed in how you like fades to happen, you don't re-enter it every time.

## Options

- **Apply crossfade to audio too** (checked by default, next to the crossfade field): when checked, the audio under the bookends crossfades the same way the picture does (`acrossfade`). When unchecked, the audio hard-cuts to/from the main video's audio right as the picture's crossfade starts/ends instead of blending — total length is unaffected either way.
- **Normalize audio**: runs the combined audio (video + bookend silence) through `loudnorm` (EBU R128) targeting the chosen integrated loudness before the final fade-out. Single-pass, so expect the result to land within roughly half a LU of the target.
- **Also render an MP3**: exports a second file alongside the MP4 containing just the main clip's audio — the PNG-hold silence at the start and end is excluded, but the clip still fades up from silence and back down over the crossfade duration, so it sounds like a clean standalone edit rather than an abrupt cut. This applies regardless of the "apply crossfade to audio too" setting above (which only affects the audio inside the full MP4).

## Output quality (CRF presets, file size estimates)

Once a video's uploaded, an **Output quality** panel appears above the render settings, with the video quality and MP3 bitrate dropdowns side by side:

- **Video quality**: High Quality / Balanced / Smaller File - maps to a CRF value for H.264 (the app always encodes with `libx264`; since Vimeo re-transcodes everything you upload anyway, this choice mostly trades your own render time for file size, not what viewers ultimately see).
- **MP3 bitrate**: 128 / 192 (default) / 320 kbps. Spoken-word sermon audio holds up fine at 128-192kbps; 320kbps is mostly only worth it if there's music you want to preserve at higher fidelity.
- **File size estimates**: happen automatically, no button to click. As soon as a video's uploaded, and again whenever the trim range changes, the app encodes a short sample from the middle of your current selection at each video quality preset (instant math for MP3, since CBR MP3 size is just bitrate × duration) and shows the extrapolated full-length size right in each dropdown option, e.g. "Balanced (~650 MB)". This is a real measurement against your specific footage, not a generic guess - CRF encoding has no fixed bitrate, so how well a clip compresses depends entirely on its content.

## Notes / tuning

- The crossfade duration must be shorter than both PNG durations and the video's own length.
- The PNG is letterboxed (scaled + padded with black) to match the video's resolution, so any aspect ratio works.
- Video is re-encoded with `libx264`/`aac` (CRF 18) regardless of the source codec, since a filter graph like this requires decoding and re-encoding anyway.
