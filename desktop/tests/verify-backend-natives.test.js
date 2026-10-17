// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyBackendNatives } = require('../scripts/verify-backend-natives');

function fixture(t, platform) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-natives-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const base of ['javacpp-1.5.10', 'ffmpeg-6.1.1-1.5.10']) {
        for (const name of [`${base}.jar`, `${base}-${platform}.jar`]) {
            fs.writeFileSync(path.join(dir, name), '');
        }
    }
    // Java-only dependencies are valid even when named after other native libraries.
    fs.writeFileSync(path.join(dir, 'opencv-4.9.0-1.5.10.jar'), '');
    return dir;
}

for (const platform of ['macosx-arm64', 'windows-x86_64', 'linux-x86_64']) {
    test(`accepts complete ${platform} dependencies`, t => {
        verifyBackendNatives(fixture(t, platform), platform);
    });
}

for (const name of ['javacpp-1.5.10.jar', 'ffmpeg-6.1.1-1.5.10-macosx-arm64.jar']) {
    test(`rejects missing ${name}`, t => {
        const dir = fixture(t, 'macosx-arm64');
        fs.unlinkSync(path.join(dir, name));
        assert.throws(() => verifyBackendNatives(dir, 'macosx-arm64'), /Missing required/);
    });
}

for (const name of ['ffmpeg-6.1.1-1.5.10-linux-arm64.jar', 'javacpp-1.5.10-windows-x86_64.jar', 'ffmpeg-platform-6.1.1-1.5.10.jar']) {
    test(`rejects regression dependency ${name}`, t => {
        const dir = fixture(t, 'macosx-arm64');
        fs.writeFileSync(path.join(dir, name), '');
        assert.throws(() => verifyBackendNatives(dir, 'macosx-arm64'), /Unexpected backend natives/);
    });
}
