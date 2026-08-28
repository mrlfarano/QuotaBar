#!/bin/zsh
# Regenerate Resources/AppIcon.icns + docs/icon-1024.png (see make-icon.swift).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p Resources docs
swift scripts/make-icon.swift
