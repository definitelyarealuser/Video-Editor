#!/bin/bash
# Double-click this on the Mac that is already set up. It prints one line to paste into the
# installer script, so the person receiving it starts with Vimeo and SoundCloud already
# connected, along with the graphics and timings you have been using.
#
# THAT LINE IS THE KEYS TO THOSE ACCOUNTS. Anyone who has it can publish to the church's Vimeo
# and SoundCloud. Paste it into the installer file and send that file straight to the person who
# needs it - not into a group chat, a ticket, or anywhere it is kept and searched afterwards.
# The README explains how to revoke it later without changing any account passwords.
#
# Your Anthropic API key is left out, because it bills per use and title suggestions work
# without it. Pass --with-claude-key to include it anyway.

set -uo pipefail

# Finds the installed app rather than assuming this file is sitting inside it. It used to work
# out the location from its own path, which meant it only worked when run from inside the app's
# tools folder: saved to Downloads and double-clicked, it looked for ~/data and gave up, and run
# straight off the internet with `bash -c "$(curl …)"` - where $0 is just "bash" - it looked in
# whatever folder the Terminal happened to be in. Both are the normal ways someone would run it.
find_data_dir() {
  local candidates=(
    "$HOME/Video-Editor/data"
    "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)/data"
    "$PWD/data"
    "$HOME/Desktop/Video-Editor/data"
    "$HOME/Documents/Video-Editor/data"
  )
  for dir in "${candidates[@]}"; do
    # A folder with the app's own files in it, not just any folder called "data".
    if [[ -d "$dir" ]] && compgen -G "$dir/*.json" >/dev/null 2>&1; then
      printf '%s' "$dir"
      return 0
    fi
  done
  return 1
}

if ! DATA="$(find_data_dir)"; then
  echo ""
  echo "Couldn't find the Sermon Video Editor's settings on this Mac."
  echo ""
  echo "This has to run on the Mac that already has the app set up and connected."
  echo "It looked in ~/Video-Editor/data and a few other likely places."
  echo ""
  echo "If the app lives somewhere else, run this instead, with the path to it:"
  echo "    SVE_DIR=/path/to/Video-Editor bash \"\$0\""
  echo ""
  exit 1
fi
# An explicit override, for an install in an unusual place.
if [[ -n "${SVE_DIR:-}" && -d "${SVE_DIR}/data" ]]; then
  DATA="${SVE_DIR}/data"
fi

INCLUDE_CLAUDE_KEY=false
for arg in "$@"; do [[ "$arg" == "--with-claude-key" ]] && INCLUDE_CLAUDE_KEY=true; done

ITEMS=()
for item in vimeo-app-config.json vimeo-tokens.json \
            soundcloud-app-config.json soundcloud-tokens.json \
            bookend-images.json bookend-images \
            square-art-images.json square-art-images \
            history.json; do
  [[ -e "$DATA/$item" ]] && ITEMS+=("$item")
done
if [[ "$INCLUDE_CLAUDE_KEY" == true && -e "$DATA/claude-config.json" ]]; then
  ITEMS+=(claude-config.json)
fi

if [[ ${#ITEMS[@]} -eq 0 ]]; then
  echo "Nothing to hand over - this install has no saved connections or graphics yet."
  exit 1
fi

echo ""
echo "This includes:"
for item in "${ITEMS[@]}"; do echo "   - $item"; done
echo ""
echo "Copy the whole line between the markers, and paste it into the installer file"
echo "on the line that reads   CONNECTIONS=\"\"   so it reads   CONNECTIONS=\"…that line…\""
echo ""
echo "----------------------------- copy from here -----------------------------"
# One line, so it survives being pasted into a script and emailed.
tar czf - -C "$DATA" "${ITEMS[@]}" 2>/dev/null | base64 | tr -d '\n'
echo ""
echo "------------------------------ to here -----------------------------------"
echo ""
if [[ -e "$DATA/vimeo-tokens.json" || -e "$DATA/soundcloud-tokens.json" ]]; then
  echo "Remember: that line is a live login for the church's accounts."
  echo ""
fi
read -n 1 -s -r -p "Press any key to close this window..."
echo ""
