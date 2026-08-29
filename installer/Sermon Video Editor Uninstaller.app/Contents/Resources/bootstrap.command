#!/bin/bash
# Downloads and runs the current uninstall.command from GitHub - kept as a tiny fetch-and-run
# wrapper (rather than a copy of the uninstall logic) so this app doesn't need to be rebuilt
# every time uninstall.command itself changes, only if the repo URL or branch below changes.
echo "Sermon Video Editor Uninstaller"
echo ""

REPO_URL="https://raw.githubusercontent.com/definitelyarealuser/Video-Editor"
# NOTE: update this once the app's work has been merged into main, same as setup.command's own note.
BRANCH="claude/sermon-video-editor-fa7r7w"

if ! /bin/bash -c "$(curl -fsSL "$REPO_URL/$BRANCH/uninstall.command")"; then
  echo ""
  echo "Something went wrong during uninstall - check the messages above for details."
  echo "(A common cause is no internet connection.)"
  read -n 1 -s -r -p "Press any key to close this window..."
  echo ""
fi
