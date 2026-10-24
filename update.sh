#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [[ ! -d .git ]]; then
  echo 'Error: run this from a Git clone (see README).' >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'Local tracked files have edits. Commit/stash them before updating.' >&2
  exit 1
fi
branch="$(git branch --show-current)"
if [[ "$branch" != main ]]; then
  echo "Current branch is '$branch', not main. Switch to main before updating." >&2
  exit 1
fi
echo 'Fetching latest changes from GitHub…'
git pull --ff-only origin main
bash "$ROOT/install.sh"
echo
echo 'Code synchronized. Log out and reconnect to load the new GNOME Shell code.'
