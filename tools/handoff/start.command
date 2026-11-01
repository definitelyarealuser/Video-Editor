#!/bin/bash
# Double-click this (or the Desktop shortcut) to start the Sermon Video Editor.
#
# Leave the Terminal window that opens running in the background while you use the app - closing
# it stops the app.
#
# This is the same launcher the app has always used, with one addition: a copy of Node and ffmpeg
# can live in ./runtime, put there by the installer so this Mac needed nothing installed. Those
# are preferred when present and ignored when not, so an install that fell back to Homebrew works
# exactly the same way.
cd "$(dirname "$0")" || exit 1

# Two shapes of bundled runtime, depending on how this was installed:
#   runtime/node, runtime/ffmpeg          - from the handover zip, single copied binaries
#   runtime/node-dist/bin/node            - from the one-script installer, a whole Node release
# Both get looked in, and neither has to exist.
for dir in "$PWD/runtime" "$PWD/runtime/node-dist/bin"; do
  [[ -d "$dir" ]] && PATH="$dir:$PATH"
done
export PATH

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node isn't available, so the app can't start."
  echo "Run the installer again to put it back."
  echo ""
  read -n 1 -s -r -p "Press any key to close this window..."
  echo ""
  exit 1
fi

# Waits for the server to actually be listening before opening the browser tab, rather than
# guessing a fixed delay - the update check that runs on every launch can easily take longer than
# a couple of seconds, and a browser tab opened too early just shows "can't connect" instead of
# the app. Gives up quietly after a minute rather than polling forever if something's wrong.
(
  URL="http://localhost:${PORT:-3000}"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$URL" 2>/dev/null; then
      open "$URL"
      exit 0
    fi
    sleep 1
  done
) &

while true; do
  # Tells the server it's running under this restart loop, so it knows an exit(42) will actually
  # bring it back rather than just killing the app - see canSelfRestart() in server/index.js.
  SERMON_EDITOR_MANAGED=1 node server/index.js
  code=$?
  if [ "$code" -eq 42 ]; then
    echo ""
    echo "Update applied - restarting…"
    echo ""
    continue
  fi
  break
done

echo ""
echo "Sermon Video Editor has stopped."
read -n 1 -s -r -p "Press any key to close this window..."
echo ""
