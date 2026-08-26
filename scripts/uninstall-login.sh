#!/bin/zsh
# Remove the barstats LaunchAgent (leaves ~/Applications/BarStats.app alone).
set -euo pipefail
UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/com.la.barstats" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.la.barstats.plist"
pkill -f "Applications/BarStats.app" 2>/dev/null || true
echo "LaunchAgent removed (app left in ~/Applications)."
