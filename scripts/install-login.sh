#!/bin/zsh
# Install BarStats as a login item: copies the app to ~/Applications and
# bootstraps a LaunchAgent (com.la.barstats) that runs it at login.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/make-app.sh

mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/BarStats.app"
cp -R build/BarStats.app "$HOME/Applications/BarStats.app"
APP_BIN="$HOME/Applications/BarStats.app/Contents/MacOS/barstats"

PLIST="$HOME/Library/LaunchAgents/com.la.barstats.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.la.barstats</string>
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
pkill -f "BarStats.app/Contents/MacOS/barstats" 2>/dev/null || true
sleep 1
UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/com.la.barstats" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"

echo "Installed:"
launchctl print "gui/${UID_NUM}/com.la.barstats" | grep -E "state|program =" | head -3
pgrep -fl "Applications/BarStats.app" || echo "(starting…)"
