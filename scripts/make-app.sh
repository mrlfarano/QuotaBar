#!/bin/zsh
# Build build/QuotaBar.app — a double-clickable, LSUIElement menu-bar bundle.
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release

APP="build/QuotaBar.app"
VERSION="${VERSION:-0.1.0}"   # release workflow passes the tag, e.g. v0.8.0
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/quotabar "$APP/Contents/MacOS/quotabar"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>          <string>com.la.quotabar</string>
    <key>CFBundleName</key>                <string>QuotaBar</string>
    <key>CFBundleExecutable</key>          <string>quotabar</string>
    <key>CFBundlePackageType</key>         <string>APPL</string>
    <key>CFBundleShortVersionString</key>  <string>${VERSION#v}</string>
    <key>LSUIElement</key>                 <true/>
    <key>NSHighResolutionCapable</key>     <true/>
</dict>
</plist>
PLIST

echo "Built $APP — open with: open $APP"
