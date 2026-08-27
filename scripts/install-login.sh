#!/bin/zsh
# Install QuotaBar as a login item: copies the app to ~/Applications and
# bootstraps a LaunchAgent (com.la.quotabar) that runs it at login.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/make-app.sh

mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/QuotaBar.app"
cp -R build/QuotaBar.app "$HOME/Applications/QuotaBar.app"
APP_BIN="$HOME/Applications/QuotaBar.app/Contents/MacOS/quotabar"

PLIST="$HOME/Library/LaunchAgents/com.la.quotabar.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.la.quotabar</string>
    <key>ProgramArguments</key>
    <array>
        <string>${APP_BIN}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
PLIST

# Stop any manually-launched instance, then load the agent.
pkill -f "QuotaBar.app/Contents/MacOS/quotabar" 2>/dev/null || true
sleep 1
UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/com.la.quotabar" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"

echo "Installed:"
launchctl print "gui/${UID_NUM}/com.la.quotabar" | grep -E "state|program =" | head -3
pgrep -fl "Applications/QuotaBar.app" || echo "(starting…)"
