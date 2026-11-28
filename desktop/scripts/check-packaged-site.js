// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Packaged-level check: start the backend exactly as the installed app does
// (bundled JRE, the JVM arguments from backend-service's javaLaunchArgs() — lib/* before
// app.jar, plus the CDS archive when the bundle has one — cwd = data dir, desktop profile,
// -Duser.home) with a site.json that says intl, and require GET /api/site to report intl.
//
// Why: 0.91.0 RC 645f0cac2 registered SiteEnvironmentPostProcessor through
// META-INF/spring.factories, which the fat jar keeps at its ROOT. prepare-backend.js
// built app.jar from BOOT-INF/classes only, so the registration never reached the
// installed app and an intl user came back as cn after a restart. The unit test
// passed on the fat jar, which no user runs.
//
// Usage: node scripts/check-packaged-site.js --bundle <desktop/bundled/<plat>> [--site intl] [--timeout-ms 240000]

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const { javaLaunchArgs } = require('../main/services/backend-service');

/** The installed app's launch for this bundle (backend-service.js), with home as an AWD_HOME-style isolated home. */
function launchSpec(bundle, home) {
    const ctx = { packaged: true, resourcesPath: bundle, dataDir: path.join(home, '.aiworkdeck'), awdHome: home };
    const java = path.join(bundle, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    return { java, args: javaLaunchArgs(ctx, java), cwd: ctx.dataDir };
}

function parseArgs(argv) {
    const args = { site: 'intl', timeoutMs: 240000 };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--bundle') args.bundle = argv[++i];
        else if (argv[i] === '--site') args.site = argv[++i];
        else if (argv[i] === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
    }
    return args;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });
}

function getSite(port) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/api/site', timeout: 3000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    const data = json && json.data && typeof json.data === 'object' ? json.data : json;
                    resolve(res.statusCode === 200 && data ? data.current : null);
                } catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.bundle) {
        console.error('Usage: node scripts/check-packaged-site.js --bundle <desktop/bundled/<plat>> [--site intl]');
        process.exit(2);
    }
    const bundle = path.resolve(args.bundle);
    const java = path.join(bundle, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const appJar = path.join(bundle, 'backend', 'app.jar');
    const libDir = path.join(bundle, 'backend', 'lib');
    for (const p of [java, appJar, libDir]) {
        if (!fs.existsSync(p)) { console.error(`missing in bundle: ${p}`); process.exit(2); }
    }

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-packaged-site-'));
    const stateDir = path.join(home, '.aiworkdeck');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'site.json'),
        JSON.stringify({ site: args.site, chosenAt: '2026-11-27T00:00:00Z', chosenBy: 'user' }));

    const port = await freePort();
    const env = { ...process.env, SPRING_PROFILES_ACTIVE: 'desktop', SERVER_PORT: String(port) };
    const spec = launchSpec(bundle, home);
    console.log(`launch: ${spec.java} ${spec.args.join(' ')} (cwd ${spec.cwd})`);
    const logFile = path.join(home, 'backend.log');
    const log = fs.openSync(logFile, 'w');
    const child = spawn(spec.java, spec.args, { cwd: spec.cwd, env, stdio: ['ignore', log, log] });
    let exited = null;
    child.on('exit', (code) => { exited = code; });

    const deadline = Date.now() + args.timeoutMs;
    let current = null;
    while (Date.now() < deadline && exited === null) {
        current = await getSite(port);
        if (current) break;
        await new Promise((r) => setTimeout(r, 2000));
    }
    child.kill();
    await new Promise((r) => setTimeout(r, 1000));
    fs.closeSync(log);

    if (current === args.site) {
        console.log(`packaged backend reports site ${current} with site.json=${args.site}: OK`);
        fs.rmSync(home, { recursive: true, force: true });
        return;
    }
    const tail = fs.readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n');
    console.error(current
        ? `packaged backend reports site ${current}, expected ${args.site} (site.json ignored: is the EnvironmentPostProcessor registration in app.jar?)`
        : `packaged backend did not answer /api/site${exited !== null ? ` (exited ${exited})` : ' before the timeout'}`);
    console.error(tail);
    process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { launchSpec };
