/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * configGeneral.qml — Settings page for Ctrl+Alt+Moe plasmoid
 */
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM

KCM.SimpleKCM {
    id: configPage

    property alias cfg_serverUrl:           serverUrlField.text
    property alias cfg_autoStartServer:     autoStartCheck.checked
    property alias cfg_projectPath:         projectPathField.text
    property alias cfg_npmCommand:          npmCommandField.currentText
    property alias cfg_popupWidth:          popupWidthSpin.value
    property alias cfg_popupHeight:         popupHeightSpin.value
    property alias cfg_transparentBackground: transparentCheck.checked
    property alias cfg_zoomFactor:          zoomSlider.value

    Kirigami.FormLayout {
        anchors.fill: parent

        // ── Server ───────────────────────────────────────────────
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("Server")
        }

        QQC2.TextField {
            id: serverUrlField
            Kirigami.FormData.label: i18n("Server URL:")
            placeholderText: "http://localhost:3000"
            Layout.fillWidth: true
        }

        QQC2.CheckBox {
            id: autoStartCheck
            Kirigami.FormData.label: i18n("Auto-start:")
            text: i18n("Launch Next.js server on widget load")
        }

        QQC2.TextField {
            id: projectPathField
            Kirigami.FormData.label: i18n("Project path:")
            placeholderText: "/path/to/Ctrl_Alt_Moe"
            Layout.fillWidth: true
            enabled: autoStartCheck.checked
        }

        QQC2.ComboBox {
            id: npmCommandField
            Kirigami.FormData.label: i18n("npm command:")
            model: ["dev", "start"]
            enabled: autoStartCheck.checked
        }

        // ── Display ──────────────────────────────────────────────
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("Display")
        }

        QQC2.SpinBox {
            id: popupWidthSpin
            Kirigami.FormData.label: i18n("Popup width (grid units):")
            from: 20
            to: 200
            stepSize: 5
        }

        QQC2.SpinBox {
            id: popupHeightSpin
            Kirigami.FormData.label: i18n("Popup height (grid units):")
            from: 16
            to: 120
            stepSize: 5
        }

        RowLayout {
            Kirigami.FormData.label: i18n("Zoom:")
            spacing: Kirigami.Units.smallSpacing

            QQC2.Slider {
                id: zoomSlider
                from: 0.5
                to: 2.0
                stepSize: 0.05
                Layout.fillWidth: true
            }

            QQC2.Label {
                text: Math.round(zoomSlider.value * 100) + "%"
                Layout.minimumWidth: Kirigami.Units.gridUnit * 3
            }
        }

        QQC2.CheckBox {
            id: transparentCheck
            Kirigami.FormData.label: i18n("Transparent:")
            text: i18n("Use transparent WebView background")
        }

        // ── Info ─────────────────────────────────────────────────
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("Info")
        }

        QQC2.Label {
            Kirigami.FormData.label: i18n("How to use:")
            text: i18n("1. Start the Next.js server:\n   cd /path/to/Ctrl_Alt_Moe && npm run dev\n\n2. The widget will auto-connect when the server is ready.\n\n3. Use 'Open in Window' for a resizable standalone window.")
            wrapMode: Text.WordWrap
            font.pixelSize: Kirigami.Units.gridUnit * 0.7
            opacity: 0.6
            Layout.fillWidth: true
        }
    }
}
