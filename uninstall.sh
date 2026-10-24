#!/usr/bin/env bash
set -euo pipefail
UUID='omar-mawaqit-desktop@local'
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$UUID" 2>/dev/null || true
fi
if [[ -f "$DEST/metadata.json" ]] && grep -q "\"uuid\": \"$UUID\"" "$DEST/metadata.json"; then
  rm -f "$DEST/metadata.json" "$DEST/extension.js" "$DEST/mawaqit.js" "$DEST/stylesheet.css"
  rmdir "$DEST" 2>/dev/null || true
  echo 'GNOME extension uninstalled. Log out and log back in.'
else
  echo 'No matching installed extension was found. Nothing removed.'
fi
echo 'State and cache are kept under ~/.config/omar-mawaqit-desktop.json and ~/.cache/omar-mawaqit-gnome/'
