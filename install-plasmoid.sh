#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# install-plasmoid.sh — Install / Update Ctrl+Alt+Moe Plasma 6 widget
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLASMOID_DIR="$SCRIPT_DIR/plasmoid"
PLASMOID_ID="org.kde.plasma.ctrlaltmoe"
PKG_TOOL="kpackagetool6"

echo "╔══════════════════════════════════════════════════╗"
echo "║       Ctrl+Alt+Moe — Plasma 6 Widget Installer  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check kpackagetool6
if ! command -v "$PKG_TOOL" &> /dev/null; then
    echo "❌ $PKG_TOOL not found. Please install plasma-sdk or plasma-framework."
    exit 1
fi

# Check if already installed
if "$PKG_TOOL" --type Plasma/Applet --list 2>/dev/null | grep -q "$PLASMOID_ID"; then
    echo "🔄 Updating existing installation…"
    "$PKG_TOOL" --type Plasma/Applet --upgrade "$PLASMOID_DIR"
else
    echo "📦 Installing for the first time…"
    "$PKG_TOOL" --type Plasma/Applet --install "$PLASMOID_DIR"
fi

echo ""
echo "✅ Done! Widget installed as '$PLASMOID_ID'"
echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  Next steps:                                     │"
echo "│  1. Right-click desktop → Add Widgets            │"
echo "│  2. Search for 'Ctrl+Alt+Moe'                    │"
echo "│  3. Add to panel or desktop                      │"
echo "│  4. Start the Next.js server:                    │"
echo "│     cd $(basename "$SCRIPT_DIR") && npm run dev   │"
echo "│  5. Click the widget icon — it auto-connects!    │"
echo "└──────────────────────────────────────────────────┘"
echo ""
echo "To uninstall:  $PKG_TOOL --type Plasma/Applet --remove $PLASMOID_ID"
