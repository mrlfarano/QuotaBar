#!/bin/zsh
# Build build/BarStats.app — a double-clickable, LSUIElement menu-bar bundle.
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release

APP="build/BarStats.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/barstats "$APP/Contents/MacOS/barstats"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>          <string>com.la.barstats</string>
    <key>CFBundleName</key>                <string>BarStats</string>
    <key>CFBundleExecutable</key>          <string>barstats</string>
    <key>CFBundlePackageType</key>         <string>APPL</string>
    <key>CFBundleShortVersionString</key>  <string>0.1.0</string>
    <key>LSUIElement</key>                 <true/>
    <key>NSHighResolutionCapable</key>     <true/>
</dict>
</plist>
PLIST

echo "Built $APP — open with: open $APP"
