#!/bin/bash
# Double-click this file to start (or restart) the Sermon Video Editor.
#
# Leave the Terminal window that opens running in the background while you use the app -
# closing it stops the app. On every launch, the server automatically checks GitHub for a
# newer version and, if one exists, pulls it down and deliberately exits with code 42 to ask
# for a restart - this loop is what relaunches it right away with the fresh code, so an update
# never needs a click to take effect.
cd "$(dirname "$0")" || exit 1

( sleep 2 && open "http://localhost:${PORT:-3000}" ) &

while true; do
  node server/index.js
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
