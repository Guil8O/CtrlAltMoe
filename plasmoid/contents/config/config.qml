/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Config page registration for Ctrl+Alt+Moe plasmoid
 */
import QtQuick

import org.kde.plasma.configuration

ConfigModel {
    ConfigCategory {
        name: i18n("General")
        icon: "configure"
        source: "configGeneral.qml"
    }
}
