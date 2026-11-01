#!/bin/bash
# Double-click this to build a zip you can hand to someone else, with everything they need in it.
#
# This has to run on YOUR Mac, because the two things that make the result useful - your Vimeo and
# SoundCloud connections, and a copy of ffmpeg and Node for a Mac - only exist here. The result is
# "Sermon Video Editor.zip" on your Desktop.
#
# WHAT GOES IN THE ZIP, and why it matters:
#   - The app itself, with its dependencies already installed.
#   - Node and ffmpeg, so nothing has to be installed on the other Mac.
#   - Your saved graphics, so their step 1 is already filled in.
#   - YOUR VIMEO AND SOUNDCLOUD CONNECTIONS. These are live credentials for the church's
#     accounts. Anyone holding this zip can publish to them. Send it the way you would send a
#     password - directly to the person, not to a group, a public channel, or anywhere it gets
#     backed up on its own. Revoking is in the README, under "Handing the app to someone else".
#
# Your Anthropic API key is NOT included - it bills per use, and title suggestions work without
# it. Pass --with-claude-key if you want it in there too.

set -euo pipefail

cd "$(dirname "$0")/.." || exit 1
APP_ROOT="$PWD"
STAGE="$(mktemp -d)"
BUNDLE="$STAGE/Sermon Video Editor"
OUT="$HOME/Desktop/Sermon Video Editor.zip"
INCLUDE_CLAUDE_KEY=false
for arg in "$@"; do
  [[ "$arg" == "--with-claude-key" ]] && INCLUDE_CLAUDE_KEY=true
done

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

say() { printf '%s\n' "$1"; }

say ""
say "Building a handover copy of the Sermon Video Editor…"
say ""

# ---------------------------------------------------------------- the app itself
mkdir -p "$BUNDLE/app"
# Everything the app needs to run, and nothing else: no git history, no previous uploads or
# renders, and no node_modules (a clean set is installed below instead of copying whatever
# state this machine's happens to be in).
for item in server public package.json package-lock.json start.command README.md; do
  [[ -e "$APP_ROOT/$item" ]] && cp -R "$APP_ROOT/$item" "$BUNDLE/app/"
done
mkdir -p "$BUNDLE/app/uploads" "$BUNDLE/app/output" "$BUNDLE/app/data"
touch "$BUNDLE/app/uploads/.gitkeep" "$BUNDLE/app/output/.gitkeep"

say "Installing the app's dependencies into the bundle…"
( cd "$BUNDLE/app" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) \
  || ( cd "$BUNDLE/app" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 )

# ---------------------------------------------------------------- Node and ffmpeg
# Bundled so the other Mac needs no Homebrew, no admin password and no internet. The installer
# checks they actually run there and falls back to installing them properly if they don't - a
# binary built for Apple Silicon will not run on an Intel Mac, and vice versa.
mkdir -p "$BUNDLE/runtime"
uname -m > "$BUNDLE/runtime/BUILT-FOR-ARCH"

if NODE_BIN="$(command -v node)"; then
  # The official Node binary is self-contained: it needs the rest of its install only for npm,
  # which nothing here uses once the dependencies are in place.
  REAL_NODE="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")"
  cp "$REAL_NODE" "$BUNDLE/runtime/node"
  say "Included Node $("$BUNDLE/runtime/node" -v 2>/dev/null || echo '(unknown version)')"
else
  say "No Node found here - the other Mac will install it on first run instead."
fi

say "Fetching a self-contained ffmpeg for the bundle…"
FFSTAGE="$STAGE/ff"
mkdir -p "$FFSTAGE"
if ( cd "$FFSTAGE" && npm init -y >/dev/null 2>&1 && npm install ffmpeg-static ffprobe-static --no-audit --no-fund >/dev/null 2>&1 ); then
  FFMPEG_PATH="$(cd "$FFSTAGE" && node -p "require('ffmpeg-static')" 2>/dev/null || true)"
  FFPROBE_PATH="$(cd "$FFSTAGE" && node -p "require('ffprobe-static').path" 2>/dev/null || true)"
  [[ -n "${FFMPEG_PATH:-}" && -f "$FFMPEG_PATH" ]] && cp "$FFMPEG_PATH" "$BUNDLE/runtime/ffmpeg"
  [[ -n "${FFPROBE_PATH:-}" && -f "$FFPROBE_PATH" ]] && cp "$FFPROBE_PATH" "$BUNDLE/runtime/ffprobe"
fi
if [[ -f "$BUNDLE/runtime/ffmpeg" ]]; then
  say "Included ffmpeg."
else
  # Not fatal: the installer falls back to Homebrew, which is how this app has always been set up.
  say "Couldn't fetch ffmpeg (no internet?) - the other Mac will install it on first run instead."
fi
chmod +x "$BUNDLE/runtime/"* 2>/dev/null || true

# ---------------------------------------------------------------- your connections and graphics
mkdir -p "$BUNDLE/connections"
COPIED=()
copy_if_present() {
  if [[ -e "$APP_ROOT/data/$1" ]]; then
    cp -R "$APP_ROOT/data/$1" "$BUNDLE/connections/"
    COPIED+=("$1")
  fi
}
copy_if_present vimeo-app-config.json
copy_if_present vimeo-tokens.json
copy_if_present soundcloud-app-config.json
copy_if_present soundcloud-tokens.json
# The graphics library, so their step 1 arrives already filled in.
copy_if_present bookend-images.json
copy_if_present bookend-images
copy_if_present square-art-images.json
copy_if_present square-art-images
# Fade timings and the rest, so the first video they make matches the last one you made.
copy_if_present history.json
# Deliberately not copied: save-paths.json (folders that won't exist on their Mac), the
# transcripts cache, and the downloaded Whisper model (large, and it fetches its own).
if [[ "$INCLUDE_CLAUDE_KEY" == true ]]; then
  copy_if_present claude-config.json
fi

# ---------------------------------------------------------------- the parts they interact with
cp "$APP_ROOT/tools/handoff/install.command" "$BUNDLE/START HERE - Install Sermon Video Editor.command"
cp "$APP_ROOT/tools/handoff/start.command" "$BUNDLE/app/start.command"
cp "$APP_ROOT/tools/handoff/READ ME FIRST.txt" "$BUNDLE/READ ME FIRST.txt"
chmod +x "$BUNDLE/START HERE - Install Sermon Video Editor.command" "$BUNDLE/app/start.command"

# ---------------------------------------------------------------- zip it
rm -f "$OUT"
( cd "$STAGE" && zip -q -r -X "$OUT" "Sermon Video Editor" )

SIZE="$(du -h "$OUT" | cut -f1 | tr -d ' ')"
say ""
say "Done. 'Sermon Video Editor.zip' ($SIZE) is on your Desktop."
say ""
if [[ ${#COPIED[@]} -gt 0 ]]; then
  say "It contains these of your settings:"
  for item in "${COPIED[@]}"; do say "   - $item"; done
  say ""
fi
if [[ -e "$BUNDLE/connections/vimeo-tokens.json" || -e "$BUNDLE/connections/soundcloud-tokens.json" ]]; then
  say "IMPORTANT: this zip contains live logins for the church's Vimeo and/or SoundCloud."
  say "Anyone who has it can publish to those accounts. Send it straight to the person who"
  say "needs it - not to a group chat, a shared drive, or anywhere it sits around afterwards."
  say ""
fi
say "They should: double-click the zip, then right-click 'START HERE' inside it and choose Open."
say ""
read -n 1 -s -r -p "Press any key to close this window..."
echo ""
