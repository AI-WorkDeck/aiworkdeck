// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import java.net.URI;
import java.security.CodeSource;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 解析当前运行的实际应用版本：配置版本若是语义化版本号且当前类正从同大版本的更高
 * 增量更新补丁目录（{@code .../overlay/<major>/backend-app/<version>/app.jar}）加载，
 * 则返回补丁版本号，避免旧桌面壳注入旧版本号时误拒符合条件的插件或资源包。
 */
public final class EffectiveAppVersion {

    private static final Pattern OVERLAY_JAR_PATTERN = Pattern.compile(
            "(?:^|/)overlay/(\\d+\\.\\d+)/backend-app/(\\d+\\.\\d+\\.\\d+)/app\\.jar$");

    private EffectiveAppVersion() {
    }

    public static String resolve(String configuredVersion) {
        return resolve(configuredVersion, detectCodeSourcePath());
    }

    public static String resolve(String configuredVersion, String codeSourcePath) {
        if (configuredVersion == null || configuredVersion.isBlank()) {
            return configuredVersion;
        }
        String trimmed = configuredVersion.trim();
        if (!Semver.isSemver(trimmed) || codeSourcePath == null || codeSourcePath.isBlank()) {
            return trimmed;
        }
        String normalized = codeSourcePath.replace('\\', '/');
        Matcher m = OVERLAY_JAR_PATTERN.matcher(normalized);
        if (!m.find()) {
            return trimmed;
        }
        String dirMajor = m.group(1);
        String overlayVersion = m.group(2);
        String configuredMajor = majorOf(trimmed);
        String overlayMajor = majorOf(overlayVersion);
        if (configuredMajor == null || !configuredMajor.equals(dirMajor) || !configuredMajor.equals(overlayMajor)) {
            return trimmed;
        }
        return Semver.compare(overlayVersion, trimmed) > 0 ? overlayVersion : trimmed;
    }

    private static String majorOf(String version) {
        int first = version.indexOf('.');
        if (first <= 0) {
            return null;
        }
        int second = version.indexOf('.', first + 1);
        String major = version.substring(0, first);
        String minor = second > first ? version.substring(first + 1, second) : version.substring(first + 1);
        if (!isDigits(major) || !isDigits(minor)) {
            return null;
        }
        return major + "." + minor;
    }

    private static boolean isDigits(String s) {
        if (s.isEmpty()) {
            return false;
        }
        for (int i = 0; i < s.length(); i++) {
            if (!Character.isDigit(s.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    private static String detectCodeSourcePath() {
        try {
            CodeSource cs = EffectiveAppVersion.class.getProtectionDomain().getCodeSource();
            if (cs == null || cs.getLocation() == null) {
                return null;
            }
            URI uri = cs.getLocation().toURI();
            if ("file".equalsIgnoreCase(uri.getScheme())) {
                return uri.getPath();
            }
            return cs.getLocation().toString();
        } catch (Exception e) {
            return null;
        }
    }
}
