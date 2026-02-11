/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * FullRepresentation.qml — Expanded popup with embedded WebEngineView
 *
 * Loads the Next.js Ctrl+Alt+Moe app inside the Plasma widget popup.
 * Shows a status page when the server is offline.
 */
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import QtWebEngine
import org.kde.plasma.extras as PlasmaExtras
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.plasmoid
import org.kde.kirigami as Kirigami

PlasmaExtras.Representation {
    id: fullRep

    implicitWidth:  Kirigami.Units.gridUnit * root.cfgPopupWidth
    implicitHeight: Kirigami.Units.gridUnit * root.cfgPopupHeight

    Layout.minimumWidth:  Kirigami.Units.gridUnit * 30
    Layout.minimumHeight: Kirigami.Units.gridUnit * 24
    Layout.preferredWidth:  Kirigami.Units.gridUnit * root.cfgPopupWidth
    Layout.preferredHeight: Kirigami.Units.gridUnit * root.cfgPopupHeight
    Layout.maximumWidth:  Kirigami.Units.gridUnit * 160
    Layout.maximumHeight: Kirigami.Units.gridUnit * 100

    // ── Header ───────────────────────────────────────────────────
    header: PlasmaExtras.PlasmoidHeading {
        RowLayout {
            anchors.fill: parent
            spacing: Kirigami.Units.smallSpacing

            // Status indicator
            Rectangle {
                width: Kirigami.Units.smallSpacing * 2.5
                height: width
                radius: width / 2
                color: root.serverReady ? "#4caf50" : "#f44336"
                Layout.leftMargin: Kirigami.Units.smallSpacing
            }

            PlasmaComponents.Label {
                text: "Ctrl+Alt+Moe"
                font.weight: Font.DemiBold
                font.pixelSize: Kirigami.Units.gridUnit * 0.75
                opacity: 0.8
                Layout.fillWidth: true
            }

            // Reload button
            PlasmaComponents.ToolButton {
                icon.name: "view-refresh"
                display: PlasmaComponents.ToolButton.IconOnly
                enabled: root.serverReady
                onClicked: webView.reload()
                PlasmaComponents.ToolTip.text: i18n("Reload")
                PlasmaComponents.ToolTip.visible: hovered
            }

            // Open in browser
            PlasmaComponents.ToolButton {
                icon.name: "internet-web-browser"
                display: PlasmaComponents.ToolButton.IconOnly
                onClicked: Qt.openUrlExternally(root.cfgServerUrl)
                PlasmaComponents.ToolTip.text: i18n("Open in Browser")
                PlasmaComponents.ToolTip.visible: hovered
            }

            // Pop-out to separate window
            PlasmaComponents.ToolButton {
                icon.name: "window-new"
                display: PlasmaComponents.ToolButton.IconOnly
                onClicked: {
                    root.expanded = false;
                    popOutWindow.visible = true;
                }
                PlasmaComponents.ToolTip.text: i18n("Open in Window")
                PlasmaComponents.ToolTip.visible: hovered
            }

            // Settings
            PlasmaComponents.ToolButton {
                icon.name: "configure"
                display: PlasmaComponents.ToolButton.IconOnly
                onClicked: Plasmoid.internalAction("configure").trigger()
                PlasmaComponents.ToolTip.text: i18n("Configure…")
                PlasmaComponents.ToolTip.visible: hovered
            }
        }
    }

    // ── Main content area ────────────────────────────────────────
    Item {
        anchors.fill: parent

        // WebEngineView — loads the Next.js app
        WebEngineView {
            id: webView
            anchors.fill: parent
            visible: root.serverReady
            url: root.cfgServerUrl
            zoomFactor: root.cfgZoomFactor
            backgroundColor: root.cfgTransparent ? "transparent" : Kirigami.Theme.backgroundColor

            settings.javascriptEnabled: true
            settings.localContentCanAccessRemoteUrls: true
            settings.webGLEnabled: true
            settings.accelerated2dCanvasEnabled: true
            settings.localStorageEnabled: true

            // Allow fullscreen (for immersive VRM view)
            onFullScreenRequested: function(request) {
                request.accept();
            }

            // Handle new window requests — open in system browser
            onNewWindowRequested: function(request) {
                Qt.openUrlExternally(request.requestedUrl);
            }

            // Log load errors
            onLoadingChanged: function(loadRequest) {
                if (loadRequest.status === WebEngineView.LoadFailedStatus) {
                    console.log("[Ctrl+Alt+Moe] Load failed:", loadRequest.errorString);
                }
            }

            onContextMenuRequested: function(request) {
                request.accepted = true;
            }
        }

        // Offline placeholder
        ColumnLayout {
            anchors.centerIn: parent
            visible: !root.serverReady
            spacing: Kirigami.Units.largeSpacing * 2

            Kirigami.Icon {
                source: "preferences-desktop-emoticons"
                Layout.preferredWidth: Kirigami.Units.gridUnit * 6
                Layout.preferredHeight: Kirigami.Units.gridUnit * 6
                Layout.alignment: Qt.AlignHCenter
                opacity: 0.4

                SequentialAnimation on opacity {
                    loops: Animation.Infinite
                    NumberAnimation { to: 0.2; duration: 1200; easing.type: Easing.InOutSine }
                    NumberAnimation { to: 0.5; duration: 1200; easing.type: Easing.InOutSine }
                }
            }

            PlasmaComponents.Label {
                text: "Waiting for server…"
                font.pixelSize: Kirigami.Units.gridUnit * 1.1
                opacity: 0.6
                Layout.alignment: Qt.AlignHCenter
            }

            PlasmaComponents.Label {
                text: root.cfgServerUrl
                font.pixelSize: Kirigami.Units.gridUnit * 0.7
                font.family: "monospace"
                opacity: 0.4
                Layout.alignment: Qt.AlignHCenter
            }

            RowLayout {
                Layout.alignment: Qt.AlignHCenter
                spacing: Kirigami.Units.smallSpacing * 3

                PlasmaComponents.Button {
                    text: i18n("Start Server")
                    icon.name: "media-playback-start"
                    visible: root.cfgProjectPath !== ""
                    onClicked: startServer()
                }

                PlasmaComponents.Button {
                    text: i18n("Open in Browser")
                    icon.name: "internet-web-browser"
                    onClicked: Qt.openUrlExternally(root.cfgServerUrl)
                }

                PlasmaComponents.Button {
                    text: i18n("Settings")
                    icon.name: "configure"
                    onClicked: Plasmoid.internalAction("configure").trigger()
                }
            }
        }
    }

    // Reload when server becomes ready
    Connections {
        target: root
        function onServerReadyChanged() {
            if (root.serverReady && webView.url.toString() === "") {
                webView.url = root.cfgServerUrl;
            } else if (root.serverReady) {
                webView.reload();
            }
        }
    }

    // Reload when server URL changes
    Connections {
        target: root
        function onCfgServerUrlChanged() {
            if (root.serverReady) {
                webView.url = root.cfgServerUrl;
            }
        }
    }

    // ── Pop-out window ───────────────────────────────────────────
    QQC2.ApplicationWindow {
        id: popOutWindow
        visible: false
        title: "Ctrl+Alt+Moe"
        width: Kirigami.Units.gridUnit * root.cfgPopupWidth
        height: Kirigami.Units.gridUnit * root.cfgPopupHeight
        minimumWidth: Kirigami.Units.gridUnit * 30
        minimumHeight: Kirigami.Units.gridUnit * 24

        WebEngineView {
            id: popOutWebView
            anchors.fill: parent
            url: root.cfgServerUrl
            zoomFactor: root.cfgZoomFactor
            backgroundColor: root.cfgTransparent ? "transparent" : Kirigami.Theme.backgroundColor

            settings.javascriptEnabled: true
            settings.localContentCanAccessRemoteUrls: true
            settings.webGLEnabled: true
            settings.accelerated2dCanvasEnabled: true
            settings.localStorageEnabled: true

            onFullScreenRequested: function(request) { request.accept() }
            onNewWindowRequested: function(request) { Qt.openUrlExternally(request.requestedUrl) }
            onContextMenuRequested: function(request) { request.accepted = true }
        }

        onVisibleChanged: {
            if (visible && root.serverReady) {
                popOutWebView.url = root.cfgServerUrl;
            }
        }
    }

    // ── Server start helper ──────────────────────────────────────
    function startServer() {
        if (root.cfgProjectPath === "") return;
        var cmd = root.cfgNpmCommand || "dev";
        console.log("[Ctrl+Alt+Moe] Starting server:", "cd", root.cfgProjectPath, "&& npm run", cmd);

        // Use Qt.createQmlObject to run a Process or just open a terminal
        // For simplicity, open Konsole with the command
        var script = "cd '" + root.cfgProjectPath + "' && npm run " + cmd;
        Qt.openUrlExternally("file:///usr/bin/konsole");
    }
}
