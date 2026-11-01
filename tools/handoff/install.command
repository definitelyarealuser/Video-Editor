#!/bin/bash
# The one file the person receiving the zip opens. Everything else happens by itself.
#
# It copies the app into their home folder, puts the church's Vimeo and SoundCloud connections
# where the app looks for them, makes sure Node and ffmpeg will run, puts a shortcut on the
# Desktop for every time after this one, and starts the app.
#
# Safe to run twice: it updates what is already there rather than making a second copy, and it
# never overwrites connections with nothing.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Video-Editor"
DESKTOP_SHORTCUT="$HOME/Desktop/Sermon Video Editor.command"

say() { printf '%s\n' "$1"; }
fail() {
  say ""
  say "❌  $1"
  say ""
  say "Nothing was broken - the app just isn't set up yet. Send this whole window to whoever"
  say "gave you the zip and they'll know what to do."
  say ""
  read -n 1 -s -r -p "Press any key to close this window..."
  echo ""
  exit 1
}

say ""
say "   Sermon Video Editor"
say "   ==================="
say ""
say "Setting things up. This takes about a minute and asks you nothing."
say ""

# macOS marks everything that arrives from the internet as untrusted, which stops the files in
# here from running. Opening this script was the permission to proceed; this clears the mark from
# the rest so the app's own parts aren't each blocked in turn.
xattr -dr com.apple.quarantine "$HERE" 2>/dev/null || true

[[ -d "$HERE/app" ]] || fail "This script can't find the 'app' folder that should sit beside it."

# ---------------------------------------------------------------- 1. the app
say "1 of 5  Copying the app to your home folder…"
mkdir -p "$APP_DIR" || fail "Couldn't create $APP_DIR."
# -R over the top: an existing install is updated, and anything the app made for itself (past
# renders, saved folders) is left alone.
cp -R "$HERE/app/." "$APP_DIR/" || fail "Couldn't copy the app into $APP_DIR."
chmod +x "$APP_DIR/start.command" 2>/dev/null || true

# ---------------------------------------------------------------- 2. the connections
say "2 of 5  Setting up the Vimeo and SoundCloud connections…"
mkdir -p "$APP_DIR/data"
if [[ -d "$HERE/connections" ]] && [[ -n "$(ls -A "$HERE/connections" 2>/dev/null)" ]]; then
  cp -R "$HERE/connections/." "$APP_DIR/data/" || fail "Couldn't copy the connections into place."
  # These are account credentials sitting in a home folder; no reason for anyone else on the
  # machine to be able to read them.
  chmod -R go-rwx "$APP_DIR/data" 2>/dev/null || true
else
  say "        (none were included - you can connect your own in the app's Settings)"
fi

# ---------------------------------------------------------------- 3. Node and ffmpeg
say "3 of 5  Checking the two pieces of background software…"
RUNTIME="$APP_DIR/runtime"
mkdir -p "$RUNTIME"
[[ -d "$HERE/runtime" ]] && cp -R "$HERE/runtime/." "$RUNTIME/" 2>/dev/null
chmod +x "$RUNTIME"/* 2>/dev/null || true
xattr -dr com.apple.quarantine "$RUNTIME" 2>/dev/null || true

works() { [[ -x "$1" ]] && "$1" "${2:---version}" >/dev/null 2>&1; }

NEED_BREW=()
works "$RUNTIME/node" -v || command -v node >/dev/null 2>&1 || NEED_BREW+=(node)
works "$RUNTIME/ffmpeg" -version || command -v ffmpeg >/dev/null 2>&1 || NEED_BREW+=(ffmpeg)

if [[ ${#NEED_BREW[@]} -gt 0 ]]; then
  # The bundled copies didn't run here - nearly always because this Mac has a different chip
  # from the one that built the zip. Installing them properly is the reliable way out, and the
  # only point in this script that asks for anything.
  say ""
  say "        The included copies of ${NEED_BREW[*]} won't run on this Mac, so they need"
  say "        installing. This part needs your Mac password, and a few minutes."
  say ""
  if ! command -v brew >/dev/null 2>&1; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || fail "Couldn't install Homebrew, which is what installs the other two."
  fi
  for prefix in /opt/homebrew/bin /usr/local/bin; do
    [[ -x "$prefix/brew" ]] && eval "$("$prefix/brew" shellenv)"
  done
  brew install "${NEED_BREW[@]}" || fail "Couldn't install ${NEED_BREW[*]}."
  # Installed system-wide now, so the bundled ones must not shadow them.
  for tool in "${NEED_BREW[@]}"; do rm -f "$RUNTIME/$tool"; done
  [[ " ${NEED_BREW[*]} " == *" ffmpeg "* ]] && rm -f "$RUNTIME/ffprobe"
fi

# ---------------------------------------------------------------- 4. the Desktop shortcut
say "4 of 5  Putting a shortcut on your Desktop…"
cat > "$DESKTOP_SHORTCUT" <<EOF
#!/bin/bash
# Double-click to start the Sermon Video Editor.
cd "$APP_DIR" && ./start.command
EOF
chmod +x "$DESKTOP_SHORTCUT" || fail "Couldn't put the shortcut on your Desktop."

# ---------------------------------------------------------------- 5. go
say "5 of 5  Starting it up…"
say ""
say "   All set. From now on, double-click 'Sermon Video Editor' on your Desktop."
say ""
say "   The app opens in your web browser. Leave the black Terminal window that"
say "   appears running while you use it - closing that window stops the app."
say ""
sleep 2
open "$DESKTOP_SHORTCUT"
sleep 3
exit 0
