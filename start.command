#!/bin/bash
# Double-click this file to start (or restart) the Sermon Video Editor.
#
# Leave the Terminal window that opens running in the background while you use the app -
# closing it stops the app. On every launch, the server automatically checks GitHub for a
# newer version and, if one exists, pulls it down and deliberately exits with code 42 to ask
# for a restart - this loop is what relaunches it right away with the fresh code, so an update
# never needs a click to take effect.
cd "$(dirname "$0")" || exit 1

# Waits for the server to actually be listening before opening the browser tab, rather than
# guessing a fixed delay - the update check that runs on every launch (git fetch, and sometimes
# a full update + npm ci) can easily take longer than a couple of seconds, and a browser tab
# opened too early just shows "can't connect" instead of the app. Gives up quietly after a
# minute rather than polling forever if something's genuinely wrong.
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
