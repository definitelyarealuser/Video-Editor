# Video-Editor

A small local web app that turns a Sunday recording into a finished sermon video, ready to publish.

The rendered output is: **title picture** (held for N seconds) → **crossfade** → **your video** →
**crossfade** → **title picture** (held for N seconds) → **fade to black**.

## The page, in five steps

The weekly page is five numbered steps on one scroll, each ticking green when it is satisfied -
steps to follow for someone who has never seen it, without the Next/Back of a wizard for someone
who does this every week:

1. **Graphics** - the title picture and the square one, both pre-filled with whatever was used last
   time, since they rarely change.
2. **The recording** - the whole service, straight off the camera.
3. **Trim to just the sermon** - two handles, nudge buttons at ±1s and ±5s (±0.1s behind
   **finer**), and the optional section taken out of the middle.
4. **Name it** - series, title, who preached, and the date, a plain `MM DD YY` box filled in with
   the Sunday just gone. (It was a calendar picker briefly; a native date input renders whatever
   format the browser's locale says and can't be told to use another.) Spaces, slashes and dashes
   all work when typing, and the box tidies itself up when you move on. The file name uses the
   same `MM DD YY`, matching every sermon this church has already published.
5. **Where this goes** - switches for Vimeo, SoundCloud and keeping a copy, each with their
   options inline. These remember what you chose last week.

Then **Advanced settings**, collapsed, holding the fade timings and the volume target; and one
button whose label says what pressing it will do - *"Make the video and put it on Vimeo and
SoundCloud"*. Anything that will go public is spelled out in a single confirmation first.

Connecting accounts, choosing save folders, installing the listening tool and managing the saved
graphics all live behind **Settings** (the gear, top right), set up once per machine. Where
something isn't set up, the step that needs it says so in plain words and its button jumps
straight to that part of Settings.

## How it works

- **Frontend**: a single static page (`public/`) laid out as the five steps above. Drag-and-drop zones for the recording and the two graphics, a trim scrubber, the four name fields that combine into the output file name (and the Vimeo/SoundCloud title), and a description field. No build step, no framework.
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

Fully automatic - no button, no steps. Every time you start the app (via the Desktop shortcut or `start.command`), it checks GitHub for a newer version before it even opens the browser tab. If one's available, it pulls it down, reinstalls dependencies if they changed, and restarts itself once to load the new code - you'll just see a few extra seconds of startup, then the app comes up already current. Works the same way on every machine you've installed it on. The self-restart needs the app to have been started via `start.command` (which the Desktop shortcut and manual double-click both use) - that's the loop that relaunches the server process after it exits to apply an update. Started some other way (a bare `npm start`, say), the update is still downloaded and applied, but the running process keeps serving the older code and says so - it takes effect the next time the app starts, rather than the app exiting into nothing.

For an update that lands while the app is already open, a bar appears at the top of the page naming
what changed, with an **Update & Reload** button. It does exactly what startup does - pull, reinstall
if needed, restart - and then waits for the server to come back and reloads the page into the new
version, so a long-running session doesn't have to be closed to pick up a fix. The page checks every
fifteen minutes; a failed check shows nothing at all, since the app works perfectly well on the code
already on disk and there would be nothing to do about it. It refuses to update mid-render: applying
one resets the working tree and restarts the process, which would abandon the render and whatever it
was about to publish.

### About the installer app

`Sermon Video Editor Installer.app` (source in `installer/`, built as `dist/Sermon-Video-Editor-Installer.zip`) is a thin wrapper: double-clicking it just opens Terminal and runs `/bin/bash -c "$(curl -fsSL .../setup.command)"` for you, the same command as the Terminal option above. It fetches `setup.command` fresh from GitHub every time it runs rather than bundling a copy, so it doesn't need rebuilding when `setup.command`'s own logic changes - only rebuild and re-commit the zip if `installer/Sermon Video Editor Installer.app/Contents/{Info.plist,MacOS/run,Resources/bootstrap.command}` themselves change, or once this branch merges to `main` (`bootstrap.command` has the same branch-name `NOTE:` as `setup.command`). To rebuild: `cd installer && zip -r -X ../dist/Sermon-Video-Editor-Installer.zip "Sermon Video Editor Installer.app"`. It's unsigned/not notarized (no Apple Developer account involved), so macOS Gatekeeper blocks a plain double-click the first time - the right-click → Open step in the instructions above is how a user gets past that one-time warning.

### Uninstalling

Same shape as installing, in reverse:

**On a Mac, no Terminal typing:** download [`Sermon-Video-Editor-Uninstaller.zip`](dist/Sermon-Video-Editor-Uninstaller.zip), open it, and double-click **Sermon Video Editor Uninstaller.app** (same one-time right-click → Open → Open Gatekeeper step as the installer, since it's also unsigned). A Terminal window opens, asks for confirmation, then removes `~/Video-Editor` (the app itself, along with all its local data - remembered render settings, the bookend/square-graphic libraries, and any saved Vimeo/SoundCloud connections) and the Desktop shortcut.

**On a Mac, Terminal:**

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/definitelyarealuser/Video-Editor/claude/sermon-video-editor-fa7r7w/uninstall.command)"
```

Either way, it deliberately leaves a few things alone:
- **Homebrew, Node, ffmpeg, and git** - general-purpose tools this Mac may use for other things too, not something an app uninstaller should assume it's safe to remove. Uninstall those yourself (e.g. `brew uninstall node ffmpeg git`) if you're sure nothing else on the machine needs them.
- **Any videos/audio already saved** to folders you chose while using the app (via "Also save a copy to a folder on this computer," or manually downloaded) - those are your files, living wherever you put them, not the app's.

`uninstall.command` is fetched fresh from GitHub the same way `setup.command` is (see above) - the uninstaller app is a thin wrapper around it, built and rebuilt the same way (`Sermon Video Editor Uninstaller.app` instead of `Installer.app`, `dist/Sermon-Video-Editor-Uninstaller.zip` instead of `-Installer.zip`).

1. Drop your video (a trimmed clip, or a full multi-hour service recording) into the video dropzone. It uploads right away.
2. If it's a full service file, use the **Trim to just the sermon** panel: drag the two handles to select just the sermon - dragging seeks the preview to that exact frame live (muted), and letting go plays a short unmuted snippet right at the cut point, so you can confirm both picture and audio without a separate step. Once you're close (within a few seconds), use the **-5s/-1s/-0.1s/+0.1s/+1s/+5s** nudge buttons under the Start/End readout to fine-tune each handle precisely - each nudge gives the same live preview as dragging. Below that, **Preview Start** / **Preview End** play a short snippet right at the in- or out-point, and **Play** starts playback from wherever the preview is parked while **Stop** halts it and jumps back to the start of your selection.
3. Drag your bookend PNG into its dropzone, or pick one you've used before from the **library** thumbnails that show up right in the dropzone once you've uploaded at least one - no need to browse for the same title graphic every week. Every graphic you drop in is saved there automatically (deduped by content, so re-uploading the same one doesn't create a duplicate entry). Click **Edit…** next to the thumbnails to delete ones you no longer need - each deletion asks for confirmation first. This rectangular graphic also becomes the custom thumbnail on the video once it's published to Vimeo. Directly below it, drop a square version of the same graphic into the **square graphic for SoundCloud** dropzone - it's used as the track artwork when publishing to SoundCloud, since SoundCloud artwork is expected to be square rather than the video's wide aspect ratio. It's required, same as the bookend graphic, and has its own separate library with the same drop-once-reuse-later/Edit…/delete behavior.
4. In **Name it**, fill in **Series**, **Sermon title**, **Who preached** and **Date preached** - these four combine (in that order, separated by " - ") into both the file name and the title used on Vimeo and SoundCloud, with the date written `MM DD YY`; a live preview shows the exact file name under the fields. The **Description** below becomes the text under the video on both services. The fade timings live in **Advanced settings** and are remembered from last time.
5. In **Where this goes**, switch on wherever this sermon should end up. **Keep a copy on this computer** saves the finished files into the folders set in Settings, where **Choose…** opens the real Finder folder picker (falling back to a simple in-app browser if that can't launch). The folders are remembered; the switches remember last week.
6. Click the button at the bottom, whose label says what it will do. If anything is going to be published, one confirmation lists exactly what and where; everything after that runs by itself, so the machine can be left alone. If you allow desktop notifications when prompted, you'll get a system notification when it finishes (or fails) if you've switched away from the tab.

When an MP3 is being made, it renders first - it's just the clip's own audio with no video encoding involved, so it finishes well before the MP4 does. If local saving is on, its save confirmation (and SoundCloud publish, if you opted in) happens right away, while the progress bar switches over to the video and keeps going - you don't have to wait for the video to grab or upload the audio. Once the video's done too, the app copies it to the folder you chose (if local saving is on) and shows its own confirmation. Download buttons appear whenever there's no local copy to point to instead - either a save was never requested, or one was and it failed - so there's always some way to get the finished file(s) out of the app.

Once everything's finished, two buttons appear: **Start Over** clears the whole form for a completely new sermon, while **Re-Edit** jumps straight back into trimming the exact same video - if the start/end points were off, this fixes just that without re-uploading the file or re-typing the bookend image, name fields, Core Text, or any other setting.

The uploaded video is kept on the server for 2 hours after upload regardless of whether the render succeeds, fails, or you use Re-Edit on it more than once - a render error (e.g. a crossfade duration that's too long) or a mis-trimmed cut doesn't force you to re-upload a multi-GB file, just fix the setting and retry. Everything is cleaned up automatically once that window passes.

## Publishing to Vimeo

Optional, and off by default - the app works exactly as before if you skip this section entirely. Everything happens right in the app - no config file to find or edit:

1. Open the app, and next to **Save the MP3 to this folder...** find the **Set up Vimeo publishing…** link and click it. It opens a short numbered walkthrough right there - go to developer.vimeo.com/apps, create a free "app" (any name works, it's just for your own use), add `http://localhost:3000/api/vimeo/oauth-callback` as its redirect URI, then copy its **Client Identifier** and **Client Secret** into the two boxes shown and click **Save**. (Requires a Vimeo plan that supports API uploads - Pro/Business/Premium, not the free tier.)
2. Click the **Connect Vimeo** button that appears next, and log in with the Vimeo account once.
3. Optionally, in that same panel, build the list of showcases (albums) every published video should get added to automatically: paste a showcase's link (or just its ID) into the box under **Showcases** and click **Add**. Each showcase appears as a row with its real name, and **Remove** takes one out. Every add and remove saves on the spot - there's no separate Save step for this list - and the list can be left empty, or changed any time via the same panel (now labeled **Vimeo settings…**).

That's the whole setup, and it only needs doing once per machine - reopen the panel any time to change the showcases, or click **Disconnect & clear** to switch Vimeo accounts. (Advanced/scripted installs can instead set `VIMEO_CLIENT_ID`/`VIMEO_CLIENT_SECRET`/`VIMEO_ACCESS_TOKEN` as environment variables in `.env` - see `.env.example` - which take priority over the in-app panel and lock its fields; this isn't needed for normal use.)

With Vimeo connected, **Put it on Vimeo** appears as a switch in step 5, with its options beside it: who can watch (defaults to Public) and which showcases to add it to. Only a showcase named "Fullerton Free Sermons" is ticked by default - the year and series showcases change often enough that defaulting them on risks quietly adding a sermon to the wrong one. The title and description aren't entered here; they're the file name and description from step 4. The switch remembers what it was set to last week, and anything about to go public is listed in a single confirmation when the button is pressed. Once rendering finishes, the app uploads the MP4 with that title and description, sets the rectangular bookend graphic as the video's thumbnail, and adds it to whichever showcases were checked - no separate manual step. A results panel shows the Vimeo link, whether the custom thumbnail took, and which showcases succeeded or failed (one showcase failing, e.g. a stale ID, doesn't block the others - a thumbnail failure is reported the same way and likewise doesn't block the rest). The thumbnail line is shown on success as well as failure: after setting the picture the app asks Vimeo what the video's thumbnail actually is (`pictures.type` reads `custom` for an uploaded image, `default` for a frame Vimeo picked itself) and says which it got, retrying briefly since the video is usually still transcoding. A silent success and a thumbnail that quietly didn't take used to look identical. Leaving the switch off just makes the video, same as if Vimeo weren't configured at all. **Go back** in the confirmation (or Escape) backs out entirely - no render happens - so you can change something and press the button again.

Everything entered in the Vimeo setup panel is saved locally to `data/vimeo-app-config.json` and `data/vimeo-tokens.json` (both gitignored, never committed) - never to `.env`, and never anywhere that gets copied to GitHub.

## Publishing to SoundCloud

Optional, off by default, and needs a SoundCloud **Artist-Pro** subscription - SoundCloud only opened up self-serve API access to Artist-Pro accounts in 2026, and there's no automated path for accounts below that tier.

1. Open the app, and next to **Save the MP3 to this folder...** find the **Set up SoundCloud publishing…** link and click it. It opens a short numbered walkthrough right there - go to developers.soundcloud.com, register a free "app" (requires Artist-Pro on the SoundCloud account you're registering under; any name works, it's just for your own use), add `http://localhost:3000/api/soundcloud/oauth-callback` as its redirect URI, then copy its **Client ID** and **Client Secret** into the two boxes shown and click **Save**.
2. The same click also kicks off the one-time sign-in: it saves the credentials, then opens SoundCloud in the browser to log into the FF SoundCloud account and approve access (tokens refresh themselves silently afterward; you'll only need to reconnect if access is ever revoked from SoundCloud's side).
3. Optionally, in that same panel, build the list of playlists every published track should get added to automatically: paste a playlist's ordinary web link into the box under **Playlists** and click **Add** - the app looks up its ID and name for you (this only works once connected). Each playlist appears as a row with its real name, and **Remove** takes one out. Every add and remove saves on the spot - there's no separate Save step for this list - and the list can be left empty, or changed any time via the same panel (now labeled **SoundCloud settings…**).

That's the whole setup, and it only needs doing once per machine - reopen the panel any time to change the playlists, or click **Disconnect SoundCloud** to sign out (keeping the saved Client ID/Secret) or **Forget these credentials** to clear everything and start over. (Advanced/scripted installs can instead set `SOUNDCLOUD_CLIENT_ID`/`SOUNDCLOUD_CLIENT_SECRET` as environment variables in `.env` - see `.env.example` - which take priority over the in-app panel and lock those two fields; this isn't needed for normal use. `SOUNDCLOUD_PLAYLIST_IDS`/`VIMEO_SHOWCASE_IDS` behave differently: they only seed the list for an install that has never touched the in-app controls, and the app takes over permanently the first time a playlist or showcase is added or removed there. Managing those lists is routine work, so the app always wins.)

With SoundCloud connected, **Put the audio on SoundCloud** appears as a switch in step 5, with who can listen (defaults to Public) and which playlists to add it to - all of them, by default. SoundCloud needs an MP3 to upload, so switching it on holds the **Make an audio-only MP3 as well** switch on and says why; unticking that switch on its own is how you make the video without an MP3. The square graphic from the main form's SoundCloud artwork dropzone is uploaded as the track's cover art at the same time. A results panel shows the track link and which playlists succeeded or failed.

Everything entered in the SoundCloud setup panel is saved locally to `data/soundcloud-app-config.json` and `data/soundcloud-tokens.json` (both gitignored, never committed) - never to `.env`, and never anywhere that gets copied to GitHub.

## Render settings are remembered

Every render feeds a small local history (`data/history.json`, gitignored - nothing leaves your machine): the bookend durations, crossfade length, fade-to-black, audio-crossfade/normalization/MP3 choices from your most recent render pre-fill the form on your next visit, instead of the fixed HTML defaults - so once you've dialed in how you like fades to happen, you don't re-enter it every time.

## Options

- **Apply crossfade to audio too** (checked by default, next to the crossfade field): when checked, the audio under the bookends crossfades the same way the picture does (`acrossfade`). When unchecked, the audio hard-cuts to/from the main video's audio right as the picture's crossfade starts/ends instead of blending — total length is unaffected either way.
- **Remove a section from the middle**: cuts a span out of the sermon and crossfades the two remaining pieces together - for a video clip played during the service that can't be published. Tick the box under the trim controls and a second pair of handles appears on the same timeline, marking the span to drop (shown hatched in red). The readout says how much is being removed and how much sermon is left. **Preview the Join** plays the run-up to the cut and then jumps to just after it, which is what the crossfade will stitch together. The join uses the same **Crossfade duration** as the bookends, and both kept pieces have to be longer than it - the app says so, and blocks the render, rather than letting ffmpeg fail minutes in. The MP3 gets the same cut at the same moment.
- **Normalize audio**: runs the sermon's own audio through `loudnorm` (EBU R128) targeting the chosen integrated loudness, before the silent bookend holds are attached. Single-pass, so expect the result to land within roughly half a LU of the target. (It used to normalize the combined audio *after* the bookend silence was added, which left the video under-corrected - the quieter the week, the worse it got, while the MP3 landed on target. Same sermon, two different levels. Fixed.)
- **Sound level**: measures the clip so "does this week sound quieter than last week?" has an answer instead of being judged by ear each Sunday, and then acts on it. When the sermon is more than 3 LU off target, or its peaks are above -1 dBTP (which risks distortion once Vimeo and SoundCloud re-encode it), the app **ticks "Even out the volume" by itself** and says why - untick it to leave the sound as recorded. It used to only advise, which is no use to someone who doesn't know what normalizing is: the recommendation went unread and the sermon went out quiet. The real figures (LUFS, dBTP, the gain it would apply) are still printed under the verdict for anyone who wants to check it.
  - It lives at the end of the form, just above the button, because that is where the decision is made - but nothing has to be clicked to get it. It measures on its own as soon as the video finishes uploading, and re-measures whenever the trim changes by any route (dragging a handle, the nudge buttons, Re-Edit), so the answer is already waiting by the time anyone scrolls to it and always describes the range actually being published rather than the raw upload. **Measure again**, in Advanced settings, is only there for when you want to force it. A trim landing mid-measurement cancels the run it invalidated - the browser drops the request and the server kills the ffmpeg behind it - rather than queueing the new measurement behind a result already known to be stale, which on a 45-minute service would be another ten seconds of waiting for an answer nobody would read.
  - Speed: clips up to an hour are measured straight through, which is exact. Longer ones are sampled at up to 120 short windows spread evenly across the trimmed range, seeked to directly and concatenated into one pass, so the answer arrives in seconds whatever the length. The line under the recommendation says which of the two happened and how long it took. Measured on a 4-core machine, a 45-minute service takes ~10s exact (it was 35s before the analysis moved off `loudnorm` onto `ebur128`, which reports the same figures about three times faster).
  - Why many short windows and not one long chunk, on the sampled path: coverage is what catches a one-off loud moment. Sampling a 45-minute test clip with 12 x 20s windows walked straight past a 60-second burst and under-read its peak by 17 dB; ~90 short windows caught it to within 0.3 dB, for about the same total audio. A sampled peak is still a lower bound - if it says peaks are too hot they certainly are, but a brief spike between windows can be missed. Anything an hour or under avoids that entirely by being measured in full.
- **Keep an audio-only MP3 too** (under "Keep a copy on this computer", on by default): a second file alongside the MP4 containing just the sermon's audio — the held-picture silence at each end is excluded, but it still fades up from silence and back down over the crossfade duration, so it sounds like a clean standalone edit rather than an abrupt cut. This applies regardless of "fade the sound along with the picture" (which only affects the audio inside the full MP4). Publishing to SoundCloud holds this switch on, since there would be nothing to upload otherwise. It only appears alongside the local copy, because that is the only time the choice is yours to make; an MP3 is made (and downloadable) either way.

## Suggesting a sermon title

Under the **Sermon Title** field there's a **Suggest a title** button. It reads the sermon back and
offers a title from what was actually preached. Press it again for the next suggestion; there are up
to ten, and it rolls back round to the first rather than running out. Nothing is filled in unless
the button is pressed, and whatever it puts there can be typed over.

Suggestions are always made from the whole sermon, never from the part transcribed so far - a title
drawn from the first five minutes is a title about the introduction. Press the button before the
transcript has finished and the request is held rather than refused: the button says it's waiting,
and the title appears on its own the moment the last of the sermon has been heard. Pressing it again
while it waits calls it off; transcribing carries on either way.

The sermon has to be turned into text first, which happens on this Mac with
[Whisper](https://github.com/ggerganov/whisper.cpp) - the recording is never uploaded for this.
Install it once with `brew install whisper-cpp`; the app finds it on its own. The 142 MB language
model is the app's own job - it fetches it the first time it transcribes, and the setup dialog
starts it and shows the percentage rather than reporting the model as missing again. Until Whisper
itself is installed the button explains what to run instead of failing. If the download can't get
through, it says so and stops rather than sitting at 0%.

Transcribing runs in the background while you trim, so by the time the title matters the words are
usually already there. The line under the button says how much has been listened to so far. It is
incremental: the source file is cut into five-minute windows on a fixed grid and each window's text
is cached against the file it came from, so nudging a trim handle re-uses everything already
transcribed and normally costs nothing. A window has to be at least three-quarters inside the
trimmed range to count, which keeps the pre-roll announcements and the post-service chatter out of
the transcript - the cost is up to a minute of the sermon's own words at each end, which is a good
trade for a title. A section removed from the middle is left out too. Transcripts live in
`data/transcripts/` (gitignored) and are cleared when the app shuts down, along with the uploads
they belong to.

### The two suggestion engines

The toggle under the button chooses where suggestions come from. Both read the same local
transcript; they differ in what turns it into a title.

- **This Mac** (the default): no account, no API key, nothing sent anywhere, instant. It works
  theme first. The words carrying a sermon's themes are the ones that are both frequent *and*
  spread right across it - a word used throughout is a theme, a word used heavily for one minute is
  an anecdote - so it ranks words by how often they were said multiplied by how much of the sermon
  they were said across, and then gives each theme a suggestion of its own: the best real phrase
  the sermon said about it. Taking the best phrase per theme rather than the best phrases overall
  is what makes the list ten different angles on the sermon instead of one sentence worded ten
  ways. Nothing is invented - every suggestion is words that were actually said, in the order they
  were said in. Phrases are not
  allowed to run across a sentence boundary or to be the tail end of a longer phrase, which is what
  separates "By Grace You Have Been Saved" from "Grace You Have Been Saved". Nor may they read as
  the middle of a sentence someone was quoting: a relative pronoun or a stray "what"/"why"/"I"
  anywhere but the first word, or a last word still waiting for the rest of its sentence, is what
  turns "Ask What Am I Supposed" into something nobody would publish, so those are thrown out. If
  the sermon doesn't repeat itself enough - a short clip, say - it falls back to phrases said once
  whose every word is one the sermon dwells on, and then to the book of the Bible being preached
  ("A Study in Ephesians"); but only far enough to offer six, because ten suggestions with a
  clunker at number five is worse than seven good ones. Ten is a limit, not a quota, and a short or
  narrative sermon will often give seven or eight rather than ten. It will never write as well as a
  person; it is a starting point that is usually in the right territory.
- **Claude**: better titles, because it actually reads the sermon rather than counting it. It needs
  an Anthropic API key (the app walks you through getting one, and saves it to
  `data/claude-config.json`, gitignored) and it sends the transcript to Anthropic to be read, which
  is the real difference between the two - a suggestion costs a few cents. It is asked to settle
  what the sermon is about before writing anything, and to make the ten cover the sermon's
  different threads rather than one idea reworded. All ten come back in one request, so cycling
  through them is free.

Both are offered so they can be compared on actual sermons. The choice is remembered in the browser
and is never changed for you.

## Handing the app to someone else

Two ways, depending on whether you can send a 100 MB file.

### One script they run in Terminal (no file to send)

The least that can go wrong is one line pasted into Terminal, with no file to send at all:

```
bash -c "$(curl -fsSL https://raw.githubusercontent.com/definitelyarealuser/Video-Editor/claude/sermon-video-editor-fa7r7w/tools/install-sermon-video-editor.command)"
```

To hand your connections over at the same time, put the line from `print-connections.command` in
front of it: `CONNECTIONS="…" bash -c "$(curl …)"`.

That runs `tools/install-sermon-video-editor.command`, which can equally be sent as a file - but
if you do send it, tell them to run it as `bash <the file>` rather than double-clicking it.
Email and chat apps strip the execute permission off attachments, and the error macOS then gives
("could not be executed because you do not have appropriate access privileges") sends people to
Get Info, which doesn't show that permission at all. Prefixing with `bash` ignores it entirely.

Either way it sets up a Mac that has nothing on it, start to finish, and asks for nothing - **no Homebrew, no Xcode tools, no Mac password**. It works out whether the Mac
is Apple Silicon or Intel, downloads a matching Node and ffmpeg *into the app's own folder*,
downloads the app, installs its components, puts a **Sermon Video Editor** shortcut on the
Desktop, and starts it. Nothing goes anywhere else on the machine, so uninstalling is deleting
`~/Video-Editor`. Running it again is also how you update.

To hand over your Vimeo and SoundCloud at the same time: double-click
`tools/print-connections.command` on your Mac, copy the single line it prints, and paste it into
the installer at the line reading `CONNECTIONS=""`. That line is a live login for the church's
accounts - see the warning below.

### A zip with everything already in it

`tools/make-handoff-zip.command` (double-click it) builds **Sermon Video Editor.zip** on your
Desktop: one file to send to someone who needs to make a sermon video and shouldn't have to set
anything up.

It has to run on your Mac, because the things that make the result useful only exist there - your
Vimeo and SoundCloud connections, and a copy of Node and ffmpeg for a Mac. What goes in:

- the app with its dependencies already installed, so nothing is fetched from npm;
- **Node and ffmpeg**, so the other Mac needs no Homebrew, no admin password and no internet;
- **your Vimeo and SoundCloud connections**, so publishing works immediately;
- your saved graphics and the last render's fade timings, so step 1 and Advanced arrive filled in.

Not included: your Anthropic API key (it bills per use, and title suggestions work without it -
pass `--with-claude-key` if you want it in), your save folders (they're paths on *your* Mac), and
the transcript cache and Whisper model.

On the other Mac it is two actions: double-click the zip, then **right-click the file called
"START HERE" and choose Open**. The right-click is needed only the first time, and only because
macOS blocks anything unsigned that arrived from the internet - double-clicking shows the same
warning with no way past it. From there it runs on its own: it copies the app into their home
folder, puts the connections where the app looks for them, checks Node and ffmpeg actually run on
that machine, puts a **Sermon Video Editor** shortcut on their Desktop for every launch after
this one, and starts the app. It's safe to run again, and running a newer zip's installer updates
an existing install in place rather than making a second one.

If the two Macs have different chips (Apple Silicon vs Intel) the bundled Node and ffmpeg won't
run there. The installer notices, says so, and installs them with Homebrew instead - the one
point where it asks for their Mac password.

**The zip contains live credentials.** Anyone holding it can publish to the church's Vimeo and
SoundCloud. Send it directly to the person, not to a channel or a shared drive. It is still a
better thing to hand over than the account passwords, because it can be revoked without changing
them:

- **Vimeo**: go to [developer.vimeo.com/apps](https://developer.vimeo.com/apps), open the app you
  made during setup, and reset the Client Secret. Every copy of the app stops publishing, including
  yours, so reconnect afterwards in Settings.
- **SoundCloud**: the same, from
  [developers.soundcloud.com](https://developers.soundcloud.com) - regenerate the client secret.

A handed-off copy has no git history, so it does not update itself the way an installed-from-source
copy does. To give them a new version: with the script, they re-run it; with the zip, build a new
one and have them run its installer again. Either way an existing install is updated in place and
their graphics, connections and settings are kept.

## Output quality

Fixed, with nothing to choose: H.264 at CRF 18 (`libx264`) for video, 192 kbps for MP3. There used
to be an **Output quality** panel with video-quality and MP3-bitrate dropdowns, labelled with real
file-size estimates measured by test-encoding a sample of your footage on every trim change. It was
removed: Vimeo and SoundCloud re-encode whatever they are given, so the choice traded render time
for file size without changing what anyone ends up watching or hearing - and the estimates cost a
round of ffmpeg sample encodes each time the trim moved to label a dropdown nobody needed to touch.

### Checking which videos have the right thumbnail

`node tools/check-vimeo-thumbnails.js` (run from the app's folder) lists your recent Vimeo videos
and says for each whether the thumbnail is the graphic uploaded with it or a frame Vimeo picked
itself, flagging any published before the 2026-09-06 fix as explained rather than mysterious. Pass
a number to check more than the default 25. It's read-only - it fetches metadata and changes
nothing. Use it to find the backlog worth re-publishing or fixing by hand on vimeo.com.

It also counts spare thumbnails. Vimeo keeps every picture ever attached to a video and offers all
of them in its thumbnail picker, so a video typically carries the uploaded graphic *and* the frame
Vimeo generated for itself - near-identical on these sermons, since the video opens on that very
graphic. Videos published from now on are tidied automatically (the app deletes the leftovers once
its own picture is confirmed to be the one showing). For the existing backlog, re-run the tool with
`--tidy` to do the same: it deletes only non-active pictures, and only on videos whose active
thumbnail is an uploaded one, so it can never leave a video without the picture it's displaying.

## Notes / tuning

- The crossfade duration must be shorter than both PNG durations and the video's own length.
- The PNG is letterboxed (scaled + padded with black) to match the video's resolution, so any aspect ratio works.
- Video is re-encoded with `libx264`/`aac` (CRF 18) regardless of the source codec, since a filter graph like this requires decoding and re-encoding anyway.
