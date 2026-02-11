/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * main.qml — Root PlasmoidItem for Ctrl+Alt+Moe
 *
 * Embeds the Next.js VRM avatar + AI chat app via WebEngineView.
 * Optionally auto-starts the Next.js dev server.
 */
import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    // ── Configuration shortcuts ──────────────────────────────────
    readonly property string cfgServerUrl:      Plasmoid.configuration.serverUrl
    readonly property bool   cfgAutoStart:      Plasmoid.configuration.autoStartServer
    readonly property string cfgProjectPath:    Plasmoid.configuration.projectPath
    readonly property string cfgNpmCommand:     Plasmoid.configuration.npmCommand
    readonly property int    cfgPopupWidth:     Plasmoid.configuration.popupWidth
    readonly property int    cfgPopupHeight:    Plasmoid.configuration.popupHeight
    readonly property bool   cfgTransparent:    Plasmoid.configuration.transparentBackground
    readonly property real   cfgZoomFactor:     Plasmoid.configuration.zoomFactor

    // ── Server process management ────────────────────────────────
    property bool serverRunning: false
    property bool serverReady:   false

    // Server health-check timer
    Timer {
        id: healthCheck
        interval: 2000
        repeat: true
        running: true
        onTriggered: {
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function() {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    var wasReady = root.serverReady;
                    root.serverReady = (xhr.status >= 200 && xhr.status < 400);
                    if (!wasReady && root.serverReady) {
                        console.log("[Ctrl+Alt+Moe] Server is ready at", cfgServerUrl);
                    }
                }
            };
            xhr.open("HEAD", cfgServerUrl);
            xhr.timeout = 1500;
            xhr.send();
        }
    }

    // ── Visual ───────────────────────────────────────────────────
    switchWidth:  Kirigami.Units.gridUnit * 20
    switchHeight: Kirigami.Units.gridUnit * 20

    Plasmoid.constraintHints: Plasmoid.CanFillArea

    compactRepresentation: CompactRepresentation {}
    fullRepresentation:    FullRepresentation {}

    toolTipMainText: "Ctrl+Alt+Moe"
    toolTipSubText: serverReady ? "🟢 Connected" : "🔴 Server offline"

    Plasmoid.icon: "preferences-desktop-emoticons"
}
