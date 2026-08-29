#!/bin/bash
# Uninstalls Sermon Video Editor from this Mac.
#
# Run it with (update this URL to the /main/ branch once this work is merged there):
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/definitelyarealuser/Video-Editor/claude/sermon-video-editor-fa7r7w/uninstall.command)"
#
# Removes the app folder (~/Video-Editor - including all its local data: remembered render
# settings, the bookend/square-art image libraries, and any saved Vimeo/SoundCloud connections)
# and the Desktop shortcut. Does NOT touch anything the app itself doesn't own: Homebrew, Node,
# ffmpeg, and git are general-purpose tools this Mac may use for other things too, so they're
# left installed; the same goes for any rendered videos/audio saved to folders you chose via the
# app - those are your files, not the app's, and this never looks at them.
#
# NOTE: deliberately `bash -c "$(curl ...)"`, not `curl ... | bash` - see setup.command for why
# (short version: a piped script and an interactive `read` inside it can't coexist, since both
# want to read from stdin).
set -e

APP_DIR="$HOME/Video-Editor"
DESKTOP_LINK="$HOME/Desktop/Sermon Video Editor.command"

echo "This will remove Sermon Video Editor and all its local settings from this Mac -"
echo "including the bookend/square graphic libraries and any saved Vimeo/SoundCloud"
echo "connections. It will NOT touch any videos/audio you've already saved elsewhere,"
echo "or Homebrew/Node/ffmpeg/git (other things on this Mac may use those too)."
echo ""
read -r -p "Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Cancelled - nothing was removed."
  read -n 1 -s -r -p "Press any key to close this window..."
  echo ""
  exit 0
fi
echo ""

if pgrep -f "$APP_DIR/server/index.js" >/dev/null 2>&1; then
  echo "Stopping the running app..."
  pkill -f "$APP_DIR/server/index.js" || true
  sleep 1
fi

if [[ -d "$APP_DIR" ]]; then
  echo "Removing $APP_DIR..."
  rm -rf "$APP_DIR"
else
  echo "$APP_DIR not found - already removed."
fi

if [[ -f "$DESKTOP_LINK" ]]; then
  echo "Removing the Desktop shortcut..."
  rm -f "$DESKTOP_LINK"
fi

echo ""
echo "Done. Sermon Video Editor has been removed from this Mac."
echo ""
echo "Homebrew, Node, ffmpeg, and git were left installed since other things on this Mac may"
echo "use them - if you're sure nothing else does and want to remove them too, that's a manual"
echo "step of your own (e.g. 'brew uninstall node ffmpeg git'), not something this does for you."
echo ""
read -n 1 -s -r -p "Press any key to close this window..."
echo ""
