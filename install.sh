#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UUID="omar-mawaqit-desktop@local"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
BACKUPS="${XDG_DATA_HOME:-$HOME/.local/share}/mawaqit-gnome-widget-backups"

if ! command -v gnome-extensions >/dev/null 2>&1; then
  echo 'Error: gnome-extensions not found. Requires Ubuntu GNOME 50.' >&2
  exit 1
fi
if [[ -f "$DEST/extension.js" ]]; then
  mkdir -p "$BACKUPS"
  stamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUPS/$stamp"
  cp -a "$DEST" "$BACKUPS/$stamp/$UUID"
  echo "Backed up existing extension: $BACKUPS/$stamp/$UUID"
fi
mkdir -p "$DEST"
for file in metadata.json extension.js mawaqit.js stylesheet.css; do
  install -m 0644 "$ROOT/extension/$file" "$DEST/$file"
done
# These were previous prototypes. Prevent duplicate Conky/GTK widget startups;
# do not uninstall or otherwise modify GNOME/other prayer extensions.
OLD_AUTOSTART="$HOME/.config/autostart/prayer-times-widget.desktop"
if [[ -f "$OLD_AUTOSTART" ]]; then
  mv "$OLD_AUTOSTART" "$OLD_AUTOSTART.disabled"
  echo 'Disabled obsolete prototype autostart (backup retained).'
fi
echo
printf 'Installed %s to:\n  %s\n' "$UUID" "$DEST"
echo 'Log out of GNOME and log back in (disconnects Remote Login).'
echo 'Then enable with: gnome-extensions enable omar-mawaqit-desktop@local'
echo 'Your mosque selection, position and cache are preserved.'
