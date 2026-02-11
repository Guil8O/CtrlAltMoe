/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * CompactRepresentation.qml — Panel icon for Ctrl+Alt+Moe
 *
 * Shows a cute icon in the panel/system tray.
 * Green dot overlay when server is connected.
 */
import QtQuick
import QtQuick.Layouts
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

MouseArea {
    id: compactRoot

    readonly property bool serverReady: root.serverReady

    hoverEnabled: true
    onClicked: root.expanded = !root.expanded

    Kirigami.Icon {
        id: mainIcon
        anchors.fill: parent
        anchors.margins: Kirigami.Units.smallSpacing
        source: "preferences-desktop-emoticons"
        active: compactRoot.containsMouse

        // Gentle pulse when server is not ready
        SequentialAnimation on opacity {
            running: !compactRoot.serverReady
            loops: Animation.Infinite
            NumberAnimation { to: 0.4; duration: 800; easing.type: Easing.InOutSine }
            NumberAnimation { to: 1.0; duration: 800; easing.type: Easing.InOutSine }
        }

        // Solid when server is ready
        opacity: compactRoot.serverReady ? 1.0 : undefined
    }

    // Status dot — green when connected, red when offline
    Rectangle {
        width: Kirigami.Units.smallSpacing * 2.5
        height: width
        radius: width / 2
        color: compactRoot.serverReady ? "#4caf50" : "#f44336"
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 1

        border.width: 1
        border.color: Kirigami.Theme.backgroundColor
    }
}
