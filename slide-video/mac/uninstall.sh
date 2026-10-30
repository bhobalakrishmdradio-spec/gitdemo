#!/bin/bash
# Stop SlideCast and remove it from login items. Asks before deleting your videos and settings.
set -euo pipefail

LABEL="com.slidecast.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "✓ SlideCast stopped and removed from login items."

for t in tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
    if command -v "$t" >/dev/null 2>&1; then
        read -r -p "Turn off the Tailscale address for SlideCast ('tailscale serve reset')? [y/N] " a
        [[ $a =~ ^[Yy] ]] && "$t" serve reset && echo "✓ Tailscale serve turned off."
        break
    fi
done

read -r -p "Delete your saved videos (~/Library/Application Support/SlideCast)? [y/N] " a
[[ $a =~ ^[Yy] ]] && rm -rf "$HOME/Library/Application Support/SlideCast" && echo "✓ Videos deleted."
read -r -p "Delete your settings, API key and password (~/.slidecast)? [y/N] " a
[[ $a =~ ^[Yy] ]] && rm -rf "$HOME/.slidecast" && echo "✓ Settings deleted."
rm -rf "$APP_DIR/.venv"
echo "Done. Homebrew tools (ffmpeg, espeak-ng, fonts) were left installed."
