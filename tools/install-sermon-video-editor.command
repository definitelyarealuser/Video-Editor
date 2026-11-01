#!/bin/bash
#
#   Sermon Video Editor - complete installer for a Mac that has nothing on it
#   ========================================================================
#
#   EASIEST WAY - nothing to download, nothing to double-click. Open Terminal (press Cmd+Space,
#   type Terminal, press Return), paste this one line, and press Return:
#
#       bash -c "$(curl -fsSL https://raw.githubusercontent.com/definitelyarealuser/Video-Editor/claude/sermon-video-editor-fa7r7w/tools/install-sermon-video-editor.command)"
#
#   IF YOU WERE SENT THIS AS A FILE, run it like this - type `bash ` with a space, then drag the
#   file onto the Terminal window, then press Return:
#
#       bash ~/Downloads/install-sermon-video-editor.command
#
#   Do NOT expect double-clicking to work on a file that was emailed or messaged to you. macOS
#   strips the "this is a program" permission off anything that arrives that way, and the error
#   it gives - "could not be executed because you do not have appropriate access privileges" -
#   does not mention permissions you can see in Get Info, because Get Info does not show that
#   particular one. Running it with `bash` sidesteps it entirely.
#
#   It needs no Homebrew, no Xcode tools, no Mac password and nothing installed beforehand. It
#   downloads its own copy of Node and ffmpeg, puts them inside the app's own folder, and leaves
#   the rest of the Mac untouched. Nothing is installed system-wide, so uninstalling is deleting
#   one folder.
#
#   Safe to run again at any time: that is also how you update to a newer version of the app.
#   Your saved graphics, connections and settings are kept.
#
set -uo pipefail

# ─────────────────────────────────────────────────────────────────────────────
#  An already-connected Vimeo and SoundCloud can be handed over with this. Get
#  the line by running tools/print-connections.command on the Mac that is
#  already set up, then either paste it between the quotes below, or hand it in
#  front of the command, which works with the one-line version above too:
#
#      CONNECTIONS="…that line…" bash -c "$(curl -fsSL …)"
#
#  Left empty, the app simply asks whoever uses it to connect their own accounts
#  in Settings. This line is the keys to those accounts: treat it as a password.
# ─────────────────────────────────────────────────────────────────────────────
CONNECTIONS="${CONNECTIONS:-}"

APP_DIR="$HOME/Video-Editor"
REPO="definitelyarealuser/Video-Editor"
# NOTE: update this once this work has been merged into main.
BRANCH="claude/sermon-video-editor-fa7r7w"

# Pinned on purpose rather than resolved live: a version that was tested beats whatever is newest
# on the day someone runs this.
NODE_VERSION="v22.23.4"
FFMPEG_RELEASE="b6.0"
FFPROBE_ARM64="https://registry.npmjs.org/@ffprobe-installer/darwin-arm64/-/darwin-arm64-5.0.1.tgz"
FFPROBE_X64="https://registry.npmjs.org/@ffprobe-installer/darwin-x64/-/darwin-x64-5.1.0.tgz"

STEP=0
TOTAL=7
step() { STEP=$((STEP + 1)); printf '\n[%d/%d] %s\n' "$STEP" "$TOTAL" "$1"; }
say() { printf '        %s\n' "$1"; }

bail() {
  printf '\n❌  %s\n\n' "$1"
  printf 'Nothing on this Mac was changed in a way that matters - the app just is not\n'
  printf 'set up yet. Send this whole window to whoever gave you this file.\n\n'
  read -n 1 -s -r -p "Press any key to close this window..." </dev/tty 2>/dev/null || true
  echo ""
  exit 1
}

printf '\n'
printf '   Sermon Video Editor\n'
printf '   ===================\n'
printf '\n'
printf '   Setting everything up. Takes a few minutes, mostly downloading.\n'
printf '   You will not be asked for a password.\n'

# ─────────────────────────────────────────────────────── 1. which Mac is this
step "Working out what kind of Mac this is…"
case "$(uname -s)" in
  Darwin) ;;
  *) bail "This installer is for a Mac. This computer is running $(uname -s)." ;;
esac
case "$(uname -m)" in
  arm64)  NODE_ARCH="darwin-arm64"; FF_ARCH="darwin-arm64"; FFPROBE_URL="$FFPROBE_ARM64"; CHIP="Apple Silicon" ;;
  x86_64) NODE_ARCH="darwin-x64";   FF_ARCH="darwin-x64";   FFPROBE_URL="$FFPROBE_X64";   CHIP="Intel" ;;
  *) bail "Unexpected kind of Mac processor: $(uname -m)." ;;
esac
say "$CHIP. Everything below is downloaded to match."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# `curl -fL`: fail on an HTTP error instead of saving the error page as if it were the file, and
# follow redirects, which every one of these downloads uses. The reason for a failure is printed
# rather than swallowed - "could not download" on its own sends people looking at their wifi when
# the real answer might be a moved file or a blocked address.
fetch() {
  local url="$1" out="$2" code
  code="$(curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 -o "$out" -w '%{http_code}' "$url" 2>/dev/null)"
  local status=$?
  if [[ $status -ne 0 ]]; then
    printf '        could not fetch %s\n' "$url"
    printf '        (curl gave up with code %s%s)\n' "$status" "$([[ -n "$code" ]] && printf ', HTTP %s' "$code")"
    return 1
  fi
}

# ─────────────────────────────────────────────────────── 2. the app itself
step "Downloading the app…"
fetch "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" "$WORK/app.tar.gz" \
  || bail "Could not download the app. Is this Mac connected to the internet?"
mkdir -p "$APP_DIR" || bail "Could not create $APP_DIR."
# --strip-components=1 drops the single wrapper folder GitHub puts inside its tarballs. Only the
# program's own files are replaced, so data/, uploads/ and output/ survive an update untouched.
tar xzf "$WORK/app.tar.gz" -C "$APP_DIR" --strip-components=1 \
  || bail "Could not unpack the app into $APP_DIR."
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads" "$APP_DIR/output" "$APP_DIR/runtime"
say "Installed into $APP_DIR"

# ─────────────────────────────────────────────────────── 3. Node
step "Downloading Node (the thing that runs the app)…"
if "$APP_DIR/runtime/node-dist/bin/node" -v >/dev/null 2>&1; then
  say "Already here - $("$APP_DIR/runtime/node-dist/bin/node" -v)"
else
  fetch "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$NODE_ARCH.tar.gz" "$WORK/node.tar.gz" \
    || bail "Could not download Node."
  rm -rf "$APP_DIR/runtime/node-dist"
  mkdir -p "$APP_DIR/runtime/node-dist"
  tar xzf "$WORK/node.tar.gz" -C "$APP_DIR/runtime/node-dist" --strip-components=1 \
    || bail "Could not unpack Node."
  say "Installed $NODE_VERSION, inside the app's own folder only."
fi
NODE_BIN="$APP_DIR/runtime/node-dist/bin"
export PATH="$NODE_BIN:$PATH"
"$NODE_BIN/node" -v >/dev/null 2>&1 || bail "Node downloaded but will not run on this Mac."

# ─────────────────────────────────────────────────────── 4. ffmpeg and ffprobe
step "Downloading ffmpeg (the thing that edits the video)…"
if ! "$APP_DIR/runtime/ffmpeg" -version >/dev/null 2>&1; then
  fetch "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_RELEASE/ffmpeg-$FF_ARCH" "$APP_DIR/runtime/ffmpeg" \
    || bail "Could not download ffmpeg."
  chmod +x "$APP_DIR/runtime/ffmpeg"
fi
if ! "$APP_DIR/runtime/ffprobe" -version >/dev/null 2>&1; then
  fetch "$FFPROBE_URL" "$WORK/ffprobe.tgz" || bail "Could not download ffprobe."
  # The matching ffprobe comes from a different place to ffmpeg: the obvious companion package
  # ships an Intel binary in its Apple Silicon folder, which then needs Rosetta to run at all.
  tar xzf "$WORK/ffprobe.tgz" -C "$WORK" || bail "Could not unpack ffprobe."
  FOUND_FFPROBE="$(find "$WORK/package" -name ffprobe -type f 2>/dev/null | head -1)"
  [[ -n "$FOUND_FFPROBE" ]] || bail "Could not find ffprobe inside its download."
  cp "$FOUND_FFPROBE" "$APP_DIR/runtime/ffprobe"
  chmod +x "$APP_DIR/runtime/ffprobe"
fi
# macOS refuses to run downloaded programs until the "came from the internet" mark is cleared.
xattr -dr com.apple.quarantine "$APP_DIR/runtime" 2>/dev/null || true
"$APP_DIR/runtime/ffmpeg" -version >/dev/null 2>&1 || bail "ffmpeg downloaded but will not run on this Mac."
"$APP_DIR/runtime/ffprobe" -version >/dev/null 2>&1 || bail "ffprobe downloaded but will not run on this Mac."
say "Both working."

# ─────────────────────────────────────────────────────── 5. the app's own parts
step "Installing the app's components…"
( cd "$APP_DIR" && "$NODE_BIN/npm" ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) \
  || ( cd "$APP_DIR" && "$NODE_BIN/npm" install --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) \
  || bail "Could not install the app's components."
# The launcher that knows to look in runtime/ first.
if [[ -f "$APP_DIR/tools/handoff/start.command" ]]; then
  cp "$APP_DIR/tools/handoff/start.command" "$APP_DIR/start.command"
fi
chmod +x "$APP_DIR/start.command"
say "Done."

# ─────────────────────────────────────────────────────── 6. connections
step "Setting up Vimeo and SoundCloud…"
if [[ -n "$CONNECTIONS" ]]; then
  if printf '%s' "$CONNECTIONS" | base64 --decode 2>/dev/null | tar xzf - -C "$APP_DIR/data" 2>/dev/null; then
    chmod -R go-rwx "$APP_DIR/data" 2>/dev/null || true
    say "Connected and ready - no accounts to set up."
  else
    say "The connections line didn't make sense, so it was skipped."
    say "Everything else is fine; connect the accounts in the app's Settings."
  fi
else
  say "None were supplied - open Settings in the app to connect them."
fi

# ─────────────────────────────────────────────────────── 7. the shortcut
step "Putting a shortcut on the Desktop…"
SHORTCUT="$HOME/Desktop/Sermon Video Editor.command"
cat > "$SHORTCUT" <<EOF
#!/bin/bash
# Double-click to start the Sermon Video Editor.
cd "$APP_DIR" && ./start.command
EOF
chmod +x "$SHORTCUT" || bail "Could not put the shortcut on the Desktop."
say "Double-click 'Sermon Video Editor' on the Desktop to start it, any time."

printf '\n'
printf '   ────────────────────────────────────────────────────────────\n'
printf '   All set.\n'
printf '\n'
printf '   The app is about to open in your web browser.\n'
printf '   Leave the black Terminal window that appears running while you\n'
printf '   use it - closing that window stops the app.\n'
printf '   ────────────────────────────────────────────────────────────\n'
printf '\n'
sleep 2
open "$SHORTCUT" 2>/dev/null || say "Start it from the Desktop shortcut."
sleep 3
