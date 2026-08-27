#!/bin/zsh
# Remove the quotabar LaunchAgent (leaves ~/Applications/QuotaBar.app alone).
set -euo pipefail
UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/com.la.quotabar" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.la.quotabar.plist"
pkill -f "Applications/QuotaBar.app" 2>/dev/null || true
echo "LaunchAgent removed (app left in ~/Applications)."
