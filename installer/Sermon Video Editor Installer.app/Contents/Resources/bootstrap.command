#!/bin/bash
# Downloads and runs the current setup.command from GitHub - kept as a tiny fetch-and-run
# wrapper (rather than a copy of the setup logic) so this installer app doesn't need to be
# rebuilt every time setup.command itself changes, only if the repo URL or branch below changes.
echo "Setting up Sermon Video Editor..."
echo ""

REPO_URL="https://raw.githubusercontent.com/definitelyarealuser/Video-Editor"
# NOTE: update this once the app's work has been merged into main, same as setup.command's own note.
BRANCH="claude/sermon-video-editor-fa7r7w"

if ! curl -fsSL "$REPO_URL/$BRANCH/setup.command" | bash; then
  echo ""
  echo "Something went wrong during setup - check the messages above for details."
  echo "(A common cause is no internet connection.)"
fi

read -n 1 -s -r -p "Press any key to close this window..."
echo ""
