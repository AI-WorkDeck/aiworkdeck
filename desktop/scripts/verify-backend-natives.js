// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('fs');

// Validate the actual fat-jar contents, not Maven's intended dependency selection.
// Maven 3.10 stopped applying CLI-property profiles in dependency POMs, which
// silently bundled every FFmpeg platform into the macOS installer (#1335).
function verifyBackendNatives(libDir, platform) {
    const jars = fs.readdirSync(libDir);
    for (const [artifact, version] of [['javacpp', '1.5.10'], ['ffmpeg', '6.1.1-1.5.10']]) {
        const base = `${artifact}-${version}`;
        for (const required of [`${base}.jar`, `${base}-${platform}.jar`]) {
            if (!jars.includes(required)) throw new Error(`Missing required backend dependency: ${required}`);
        }
        const unexpected = jars.filter(name =>
            (name.startsWith(`${base}-`) && name.endsWith('.jar') && name !== `${base}-${platform}.jar`)
            || name.startsWith(`${artifact}-platform-`));
        if (unexpected.length) throw new Error(`Unexpected backend natives for ${platform}: ${unexpected.join(', ')}`);
    }
}

module.exports = { verifyBackendNatives };
