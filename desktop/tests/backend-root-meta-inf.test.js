// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appRootMetaInfEntries } = require('../scripts/backend-root-meta-inf');

// Root of the 0.91.0 RC fat jar as listed by `jar -t` (BOOT-INF and loader classes trimmed).
const FAT_JAR_ROOT = [
    'META-INF/',
    'META-INF/MANIFEST.MF',
    'META-INF/services/',
    'META-INF/services/java.nio.file.spi.FileSystemProvider',
    'META-INF/spring/',
    'META-INF/maven/',
    'META-INF/maven/com.checkba/backend/pom.xml',
    'META-INF/maven/com.checkba/backend/pom.properties',
    'META-INF/spring.factories',
    'META-INF/spring/org.springframework.boot.env.EnvironmentPostProcessor.imports',
    'META-INF/BOOT.SF',
    'BOOT-INF/classes/com/checkba/CheckbaApplication.class',
    'org/springframework/boot/loader/launch/JarLauncher.class',
    '',
];

test('the app\'s Spring registration files at the fat-jar root are copied into app.jar', () => {
    assert.deepEqual(appRootMetaInfEntries(FAT_JAR_ROOT), [
        'META-INF/spring.factories',
        'META-INF/spring/org.springframework.boot.env.EnvironmentPostProcessor.imports',
    ]);
});

test('loader and build metadata stay out; Windows separators and CRLF are normalized', () => {
    assert.deepEqual(appRootMetaInfEntries(['META-INF\\spring.factories\r', 'META-INF/MANIFEST.MF\r', 'META-INF/BOOT.SF']),
        ['META-INF/spring.factories']);
});

test('every META-INF resource the backend ships is covered (guards new registration files)', () => {
    const root = path.join(__dirname, '..', '..', 'backend', 'src', 'main', 'resources', 'META-INF');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
    const shipped = walk(root).map((f) => 'META-INF/' + path.relative(root, f).split(path.sep).join('/'));
    assert.ok(shipped.includes('META-INF/spring.factories'));
    assert.deepEqual(appRootMetaInfEntries(shipped).sort(), shipped.sort());
});

test('prepare-backend copies the root META-INF into app.jar and fails when it is missing', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-backend.js'), 'utf8');
    assert.match(src, /appRootMetaInfEntries\(/);
    assert.match(src, /app\.jar is missing root META-INF entries/);
});
