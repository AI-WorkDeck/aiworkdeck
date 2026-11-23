// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class EffectiveAppVersionTest {

    @Test
    void promotesNewerSameMajorOverlayJarVersion() {
        assertEquals("0.88.2", EffectiveAppVersion.resolve(
                "0.88.1",
                "/Users/example/.aiworkdeck/overlay/0.88/backend-app/0.88.2/app.jar"));
        assertEquals("0.88.10", EffectiveAppVersion.resolve(
                "0.88.2",
                "C:\\Users\\example\\.aiworkdeck\\overlay\\0.88\\backend-app\\0.88.10\\app.jar"));
    }

    @Test
    void keepsConfiguredVersionForDevOrNonNewerOrDifferentMajor() {
        assertEquals("dev", EffectiveAppVersion.resolve(
                "dev",
                "/Users/example/.aiworkdeck/overlay/0.88/backend-app/0.88.2/app.jar"));
        assertEquals("0.88.2", EffectiveAppVersion.resolve(
                "0.88.2",
                "/Users/example/.aiworkdeck/overlay/0.88/backend-app/0.88.1/app.jar"));
        assertEquals("0.88.2", EffectiveAppVersion.resolve(
                "0.88.2",
                "/Users/example/.aiworkdeck/overlay/0.88/backend-app/0.88.2/app.jar"));
        assertEquals("0.88.1", EffectiveAppVersion.resolve(
                "0.88.1",
                "/Users/example/.aiworkdeck/overlay/0.87/backend-app/0.87.9/app.jar"));
        assertEquals("0.88.1", EffectiveAppVersion.resolve(
                "0.88.1",
                "/Users/example/.aiworkdeck/overlay/0.88/backend-app/0.89.0/app.jar"));
        assertEquals("0.88.1", EffectiveAppVersion.resolve(
                "0.88.1",
                "/Applications/AI WorkDeck.app/Contents/Resources/backend/app.jar"));
    }
}
