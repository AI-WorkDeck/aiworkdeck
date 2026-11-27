// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Which root-level META-INF entries of the Spring Boot fat jar belong in app.jar.
//
// The repackaged fat jar keeps the application's own META-INF resources
// (spring.factories, META-INF/spring/*.imports, ...) at the jar ROOT, not under
// BOOT-INF/classes. The installed app runs `java -cp app.jar:lib/*`, so anything
// left at the root never reaches it: in 0.91.0 RC 645f0cac2 that silently dropped
// the SiteEnvironmentPostProcessor registration (an intl user came back as cn).
//
// Everything at the root META-INF is copied except what belongs to the Spring Boot
// loader or to the Maven build.

'use strict';

const LOADER_OR_BUILD = [
    /^META-INF\/MANIFEST\.MF$/,
    /^META-INF\/BOOT\.SF$/,
    /^META-INF\/maven\//,
    // Spring Boot loader's nested-jar file system; the -cp layout does not use it.
    /^META-INF\/services\/java\.nio\.file\.spi\.FileSystemProvider$/,
];

/** @param {string[]} entries names as listed by `jar -t` @returns {string[]} files to copy into app.jar */
function appRootMetaInfEntries(entries) {
    return entries
        .map((e) => e.trim().replace(/\\/g, '/'))
        .filter((e) => e.startsWith('META-INF/') && !e.endsWith('/'))
        .filter((e) => !LOADER_OR_BUILD.some((re) => re.test(e)));
}

module.exports = { appRootMetaInfEntries };
