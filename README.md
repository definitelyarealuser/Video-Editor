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
3. Drag your bookend PNG into its dropzone, or pick one you've used before from the **library** thumbnails that show up right in the dropzone once you've uploaded at least one - no need to browse for the same title graphic every week. Every graphic you drop in is saved there automatically (deduped by content, so re-uploading the same one doesn't create a duplicate entry). Click **Edit…** next to the thumbnails to delete ones you no longer need - each deletion asks for confirmation first. This rectangular graphic also becomes the custom thumbnail on the video once it's published to Vimeo. Directly below it, drop a square version of the same graphic into the **square graphic for SoundCloud** dropzone - it's used as the track artwork when publishing to SoundCloud, since SoundCloud artwork is expected to be square rather than the video's wide aspect ratio. It's required, same as the bookend graphic, and has its own separate library with the same drop-once-reuse-later/Edit…/delete behavior.
4. Set the start PNG duration, end PNG duration, crossfade duration, and fade-to-black duration. Fill in **Series**, **Sermon Title**, **Speaker's Name**, and **Sermon Date (MM DD YY)** - these four combine (in that order, separated by " - ") into both the rendered file name and the title used for Vimeo (and, manually, SoundCloud); a live preview shows the exact file name above the fields. Add **Core Text** below that - it becomes the description on both Vimeo and SoundCloud, so write it once here rather than re-typing it at publish time.
5. Optionally check **Normalize audio** and pick a target loudness (-20 to -10 LUFS, defaults to -14) and/or **Render MP3**. Saving a copy locally is optional and off by default - now that Vimeo/SoundCloud publishing exist, plenty of renders never need a local copy at all. Check **Also save a copy to a folder on this computer** to turn it on, which reveals **Save the MP4 to this folder on this computer** - a full local folder path (e.g. `C:\Users\andyw\Videos\Sermons` or `/Users/andy/Movies/Sermons`) - and, if **Render MP3** is also checked, **Save the MP3 to this folder on this computer** too; both become required once the checkbox is on, same as before. Click **Browse…** next to either field to pick the folder instead of typing the path by hand - on Windows and Mac this opens the real OS folder picker (Explorer/Finder); anywhere else (or if that fails to launch for some reason) it falls back to a simple in-app browser instead, starting at whatever's already in the field or your home folder if it's empty. Both paths are remembered the moment you set them, whether or not you go on to render - so the checkbox resets to off each visit, but the folders themselves don't have to be re-typed once you turn it back on.
6. Click **Render Video**. If [Vimeo publishing](#publishing-to-vimeo) is set up, you'll be asked right then whether to publish this render; if [SoundCloud publishing](#publishing-to-soundcloud) is set up *and* **Render MP3** is checked, you'll be asked about that too, as a separate dialog right after Vimeo's - each is a deliberate choice every time, and either can be declined independently of the other. If you allow desktop notifications when prompted, you'll get a system notification when the render finishes (or fails) if you've switched away from the tab.

If **Render MP3** is checked, the MP3 renders first - it's just the clip's own audio with no video encoding involved, so it finishes well before the MP4 does. If local saving is on, its save confirmation (and SoundCloud publish, if you opted in) happens right away, while the progress bar switches over to the video and keeps going - you don't have to wait for the video to grab or upload the audio. Once the video's done too, the app copies it to the folder you chose (if local saving is on) and shows its own confirmation. Download buttons appear whenever there's no local copy to point to instead - either a save was never requested, or one was and it failed - so there's always some way to get the finished file(s) out of the app.

Once everything's finished, two buttons appear: **Start Over** clears the whole form for a completely new sermon, while **Re-Edit** jumps straight back into trimming the exact same video - if the start/end points were off, this fixes just that without re-uploading the file or re-typing the bookend image, name fields, Core Text, or any other setting.

The uploaded video is kept on the server for 2 hours after upload regardless of whether the render succeeds, fails, or you use Re-Edit on it more than once - a render error (e.g. a crossfade duration that's too long) or a mis-trimmed cut doesn't force you to re-upload a multi-GB file, just fix the setting and retry. Everything is cleaned up automatically once that window passes.

## Publishing to Vimeo

Optional, and off by default - the app works exactly as before if you skip this section entirely. Everything happens right in the app - no config file to find or edit:

1. Open the app, and next to **Save the MP3 to this folder...** find the **Set up Vimeo publishing…** link and click it. It opens a short numbered walkthrough right there - go to developer.vimeo.com/apps, create a free "app" (any name works, it's just for your own use), add `http://localhost:3000/api/vimeo/oauth-callback` as its redirect URI, then copy its **Client Identifier** and **Client Secret** into the two boxes shown and click **Save**. (Requires a Vimeo plan that supports API uploads - Pro/Business/Premium, not the free tier.)
2. Click the **Connect Vimeo** button that appears next, and log in with the Vimeo account once.
3. Optionally, in that same panel, paste in comma-separated showcase (album) IDs every published video should get added to automatically - find one in a showcase's URL (`vimeo.com/showcase/XXXXXXX`). Can be left blank, or added/changed later via the same panel (now labeled **Vimeo settings…**).

That's the whole setup, and it only needs doing once per machine - reopen the panel any time to change the showcases, or click **Disconnect & clear** to switch Vimeo accounts. (Advanced/scripted installs can instead set `VIMEO_CLIENT_ID`/`VIMEO_CLIENT_SECRET`/`VIMEO_ACCESS_TOKEN` as environment variables in `.env` - see `.env.example` - which take priority over the in-app panel and lock its fields; this isn't needed for normal use.)

With Vimeo connected, clicking **Render Video** shows a **"Publish to Vimeo?"** dialog - it's a deliberate choice every time, never remembered from a previous render. The title and description aren't re-entered here - they're the file name (Series / Sermon Title / Speaker's Name / Sermon Date) and Core Text you already filled in on the main form. Privacy defaults to Public (adjustable per-render via the dropdown). The dialog just checks every configured showcase by default; uncheck any you don't want this particular video added to. Choose **Render & Publish to Vimeo**, and once rendering finishes, the app uploads the MP4 with that title and description, sets the rectangular bookend graphic as the video's thumbnail, and adds it to whichever showcases were checked - no separate manual step. A results panel shows the Vimeo link and which showcases succeeded or failed (one showcase failing, e.g. a stale ID, doesn't block the others - a thumbnail failure is reported the same way and likewise doesn't block the rest). Choosing **Render Only** just renders normally, same as if Vimeo weren't configured at all. **Cancel** (or clicking outside the dialog, or pressing Escape) backs out entirely - no render happens at all, so you can adjust settings first and click **Render Video** again.

Everything entered in the Vimeo setup panel is saved locally to `data/vimeo-app-config.json` and `data/vimeo-tokens.json` (both gitignored, never committed) - never to `.env`, and never anywhere that gets copied to GitHub.

## Publishing to SoundCloud

Optional, off by default, and needs a SoundCloud **Artist-Pro** subscription - SoundCloud only opened up self-serve API access to Artist-Pro accounts in 2026, and there's no automated path for accounts below that tier.

1. Open the app, and next to **Save the MP3 to this folder...** find the **Set up SoundCloud publishing…** link and click it. It opens a short numbered walkthrough right there - go to developers.soundcloud.com, register a free "app" (requires Artist-Pro on the SoundCloud account you're registering under; any name works, it's just for your own use), add `http://localhost:3000/api/soundcloud/oauth-callback` as its redirect URI, then copy its **Client ID** and **Client Secret** into the two boxes shown and click **Save**.
2. The same click also kicks off the one-time sign-in: it saves the credentials, then opens SoundCloud in the browser to log into the FF SoundCloud account and approve access (tokens refresh themselves silently afterward; you'll only need to reconnect if access is ever revoked from SoundCloud's side).
3. Optionally, in that same panel, paste in comma-separated playlist IDs every published track should get added to automatically. A playlist's ordinary web link doesn't show its numeric ID, so paste that link into the **Add by link** box right below the field instead and it looks the ID up automatically (only works once connected). Can be left blank, or added/changed later via the same panel (now labeled **SoundCloud settings…**).

That's the whole setup, and it only needs doing once per machine - reopen the panel any time to change the playlists, or click **Disconnect SoundCloud** to sign out (keeping the saved Client ID/Secret) or **Forget these credentials** to clear everything and start over. (Advanced/scripted installs can instead set `SOUNDCLOUD_CLIENT_ID`/`SOUNDCLOUD_CLIENT_SECRET`/`SOUNDCLOUD_PLAYLIST_IDS` as environment variables in `.env` - see `.env.example` - which take priority over the in-app panel and lock its fields; this isn't needed for normal use.)

With SoundCloud connected, clicking **Render Video** shows a **"Publish to SoundCloud?"** dialog - separately from Vimeo's, right after it, and only when **Also render an MP3** is checked (SoundCloud is audio-only, so there's nothing to offer otherwise). Same shape as Vimeo's dialog: a Private/Public privacy choice (defaults to Private), checkboxes for which configured playlists to add it to, and **Cancel** / **Render Only** / **Render & Publish to SoundCloud** buttons that behave exactly like Vimeo's equivalents. The square graphic from the main form's SoundCloud artwork dropzone is uploaded as the track's cover art at the same time. A results panel shows the track link and which playlists succeeded or failed.

Everything entered in the SoundCloud setup panel is saved locally to `data/soundcloud-app-config.json` and `data/soundcloud-tokens.json` (both gitignored, never committed) - never to `.env`, and never anywhere that gets copied to GitHub.

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
