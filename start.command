#!/bin/bash
# Double-click this file to start (or restart) the Sermon Video Editor.
#
# Leave the Terminal window that opens running in the background while you use the app -
# closing it stops the app. This loop is what lets the in-app "Update Now" button work: after
# pulling new code, the server deliberately exits with code 42 to ask for a restart, and this
# script relaunches it right away with the fresh code instead of just stopping.
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
