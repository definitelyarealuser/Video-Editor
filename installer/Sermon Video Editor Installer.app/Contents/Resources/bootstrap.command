#!/bin/bash
# Downloads and runs the current installer from GitHub - kept as a tiny fetch-and-run wrapper
# (rather than a copy of the setup logic) so this app doesn't need rebuilding every time the
# installer itself changes, only if the repo URL or branch below changes.
#
# Fetching rather than bundling also sidesteps the thing that trips people up with a script sent
# as a file: nothing here is executed from disk except this wrapper, so the execute permission
# that email and chat strip off attachments never matters.
echo "Setting up Sermon Video Editor..."
echo ""

REPO_URL="https://raw.githubusercontent.com/definitelyarealuser/Video-Editor"
# NOTE: update this once the app's work has been merged into main, same as setup.command's own note.
BRANCH="claude/sermon-video-editor-fa7r7w"

if ! /bin/bash -c "$(curl -fsSL "$REPO_URL/$BRANCH/tools/install-sermon-video-editor.command")"; then
  echo ""
  echo "Something went wrong during setup - check the messages above for details."
  echo "(A common cause is no internet connection.)"
fi

read -n 1 -s -r -p "Press any key to close this window..."
echo ""
