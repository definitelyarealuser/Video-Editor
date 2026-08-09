#!/bin/bash
# One-time setup for a Mac that's never run this app before.
#
# Run it with (update this URL to the /main/ branch once this work is merged there):
#   curl -fsSL https://raw.githubusercontent.com/definitelyarealuser/Video-Editor/claude/sermon-video-editor-fa7r7w/setup.command | bash
#
# It installs Homebrew (if needed), Node/ffmpeg/git via Homebrew, downloads the app to
# ~/Video-Editor, installs its dependencies, and adds a double-click shortcut to the Desktop.
# Safe to re-run any time - it updates an existing install instead of duplicating it.
set -e

APP_DIR="$HOME/Video-Editor"
REPO_URL="https://github.com/definitelyarealuser/Video-Editor.git"
# NOTE: update this once the app's work has been merged into main.
BRANCH="claude/sermon-video-editor-fa7r7w"

echo "Setting up Sermon Video Editor in $APP_DIR..."
echo ""

if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew - this may ask for your Mac password..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -d /opt/homebrew/bin ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -d /usr/local/bin ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

echo "Installing Node.js, ffmpeg, and git (skips anything already installed)..."
brew install node ffmpeg git

if [[ -d "$APP_DIR/.git" ]]; then
  echo "Already installed at $APP_DIR - updating instead of re-downloading..."
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo "Downloading the app..."
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "Installing app dependencies..."
npm install

chmod +x start.command

DESKTOP_LINK="$HOME/Desktop/Sermon Video Editor.command"
cat > "$DESKTOP_LINK" <<EOF
#!/bin/bash
cd "$APP_DIR" && ./start.command
EOF
chmod +x "$DESKTOP_LINK"

echo ""
echo "Done! A 'Sermon Video Editor' shortcut was added to your Desktop - double-click it any"
echo "time to start the app. Once it's running, the in-app 'Check for Updates' button will"
echo "pull down any future changes without needing to run this script again."
echo ""
echo "Optional: to publish to Vimeo/SoundCloud, see the README at"
echo "$APP_DIR/README.md for the .env setup steps."
echo ""
read -n 1 -s -r -p "Press any key to close this window..."
echo ""
