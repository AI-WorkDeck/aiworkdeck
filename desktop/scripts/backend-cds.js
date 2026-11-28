// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Build-time class-data-sharing (CDS) archive for the bundled backend (POLISH D21).
//
// Run from afterPack on the final packaged files:
//   0. guard: app.jar must not shadow any lib/ class (lib/* now comes first on -cp);
//   1. reference run (no archive), then a training run with -XX:DumpLoadedClassList;
//      each starts the backend (desktop profile, throwaway home) and stops it via
//      /api/desktop/shutdown;
//   2. static dump: java -Xshare:dump over lib/* only, so the archive covers the
//      JDK and dependency classes (~19k) but not app.jar. backend-service puts
//      app.jar last on -cp, and a patch's app.jar (overlay) is appended after the
//      archived prefix, so patches keep the archive valid;
//   3. verification run: start again with -Xshare:on and count dependency
//      classes served from the archive. Fails the build if it is not used.
//
// At runtime the JVM checks size + mtime of every archived jar; if anything
// differs it logs a [cds] warning and starts without the archive (-Xshare:auto).
// Measured on Apple Silicon (backend alone, Spring "Started in"): ~4.3 s -> ~3.3 s.
// JDK 21 archives record the dump-time class path string and are not relocatable, so every
// run here (and backend-service at runtime) reaches lib/ through the same relative prefix,
// .awd-backend/lib/*, with a symlink/junction named .awd-backend in its cwd (backend-link.js).
// Each run uses its own cwd, so the verification run proves the archive survives a move.
// The archive also checks every jar's mtime, and the Windows installer does not keep mtimes,
// so lib/*.jar are stamped with LIB_MTIME_SEC first and backend-service restores that stamp.
// Needs JDK 21.0.13+: earlier 21 updates ignore app-loader classes when the
// install path contains a space ("AI WorkDeck.app").

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { LINK_NAME, LIB_MTIME_SEC, ensureBackendLink, alignLibMtimes } = require('../main/services/backend-link');

const ARCHIVE_NAME = 'lib.jsa';
const MAIN_CLASS = 'com.checkba.CheckbaApplication';
const STARTED_RE = /Started CheckbaApplication in ([0-9.]+) seconds/;
// app.jar classes are not on the dump class path; leaving them in the list only
// produces thousands of "Cannot find" warnings.
const APP_PACKAGE = 'com/checkba/';
const MIN_SHARED_DEPENDENCY_CLASSES = 3000;

/** Drop app.jar classes (and lambda proxies they own) from a -XX:DumpLoadedClassList file. */
function filterClassList(text) {
    return text
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith(APP_PACKAGE) && !/^@lambda-(proxy|form-invoker) com\/checkba\//.test(line))
        .join('\n') + '\n';
}

/** Count classes outside the JDK and app.jar that a -Xlog:class+load log shows coming from the archive. */
function countSharedDependencyClasses(logText) {
    let n = 0;
    for (const line of logText.split(/\r?\n/)) {
        if (!line.includes('source: shared objects file')) continue;
        const m = line.match(/\]\s(\S+) source:/);
        if (!m) continue;
        const cls = m[1];
        if (/^(java|javax|jdk|sun|com\.sun)\./.test(cls) || cls.startsWith('com.checkba.')) continue;
        n++;
    }
    return n;
}

/** Entry names of a zip/jar, read from its central directory (zip64 aware). */
function zipEntryNames(file) {
    const buf = fs.readFileSync(file);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0xffff - 22); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`not a zip file: ${file}`);
    let total = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    if ((total === 0xffff || p === 0xffffffff) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
        const z64 = Number(buf.readBigUInt64LE(eocd - 20 + 8));
        total = Number(buf.readBigUInt64LE(z64 + 32));
        p = Number(buf.readBigUInt64LE(z64 + 48));
    }
    const names = [];
    for (let i = 0; i < total; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory in ${file}`);
        const nameLen = buf.readUInt16LE(p + 28);
        names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
        p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    }
    return names;
}

/**
 * backend-service puts lib/* before app.jar on -cp (so the archived prefix stays valid
 * under patches). That is only safe while app.jar does not shadow a dependency class.
 */
function shadowedClasses(appJar, libDir) {
    const own = (names) => names.filter((n) => n.endsWith('.class') && !n.startsWith('META-INF/') && n !== 'module-info.class');
    const app = new Set(own(zipEntryNames(appJar)));
    const hits = [];
    for (const jar of fs.readdirSync(libDir).filter((n) => n.endsWith('.jar'))) {
        for (const n of own(zipEntryNames(path.join(libDir, jar)))) if (app.has(n)) hits.push(`${n} (${jar})`);
    }
    return hits;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

function postShutdown(port, token) {
    return new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/api/desktop/shutdown', method: 'POST',
            headers: { 'X-AWD-Backend-Control-Token': token }, timeout: 10000 }, (res) => { res.resume(); resolve(res.statusCode); });
        req.on('error', () => resolve(0));
        req.on('timeout', () => { req.destroy(); resolve(0); });
        req.end();
    });
}

/** <dir>/.awd-backend -> <resourcesDir>/backend; returns the relative lib wildcard to put on -cp. */
function linkedLib(dir, resourcesDir) {
    if (!ensureBackendLink(dir, path.join(resourcesDir, 'backend'))) throw new Error(`cannot create ${LINK_NAME} link in ${dir}`);
    return path.join(LINK_NAME, 'lib', '*');
}

/** Start the backend (cwd = home), wait for Spring's "Started" line, stop it cleanly. Resolves with the reported seconds. */
async function runBackendOnce({ java, resourcesDir, jvmArgs, home, timeoutMs = 240000 }) {
    const backend = path.join(resourcesDir, 'backend');
    const sep = process.platform === 'win32' ? ';' : ':';
    const port = await freePort();
    const token = `cds-${process.pid}-${Date.now()}`;
    const env = {
        ...process.env,
        SPRING_PROFILES_ACTIVE: 'desktop',
        SERVER_PORT: String(port),
        AWD_BACKEND_CONTROL_TOKEN: token,
        NETWORK_PROXY_AUTO_REFRESH: 'false',
        AI_PLUGINS_BUNDLED_DIR: path.join(resourcesDir, 'official-plugins'),
        AI_SKILLS_BUILTIN_DIR: path.join(resourcesDir, 'skills'),
        AWD_PYTHON_HOME: path.join(resourcesDir, 'python'),
        HOME: home,
        USERPROFILE: home,
    };
    delete env.AWD_PARENT_PID;
    delete env.JAVA_TOOL_OPTIONS;
    const args = ['-Duser.home=' + home, ...jvmArgs, '-cp',
        linkedLib(home, resourcesDir) + sep + path.join(backend, 'app.jar'), MAIN_CLASS];
    const child = spawn(java, args, { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            child.kill('SIGKILL');
            reject(new Error(`backend did not start within ${timeoutMs} ms; last output:\n${out.slice(-3000)}`));
        }, timeoutMs);
        const onData = async (chunk) => {
            out += chunk;
            const m = out.match(STARTED_RE);
            if (!m || done) return;
            done = true;
            clearTimeout(timer);
            const status = await postShutdown(port, token);
            const killTimer = setTimeout(() => child.kill('SIGKILL'), 60000);
            const code = await exited;
            clearTimeout(killTimer);
            if (status !== 202) reject(new Error(`shutdown request returned ${status} (exit ${code})`));
            else resolve(Number(m[1]));
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        exited.then((code) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            reject(new Error(`backend exited with ${code} before starting; last output:\n${out.slice(-3000)}`));
        });
    });
}

/**
 * Build <resourcesDir>/backend/lib.jsa and prove the bundled JVM uses it.
 * Throws on any failure (the caller decides whether that fails the build).
 */
async function buildBackendCds(resourcesDir, { log = console.log } = {}) {
    const java = path.join(resourcesDir, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const libDir = path.join(resourcesDir, 'backend', 'lib');
    const archive = path.join(resourcesDir, 'backend', ARCHIVE_NAME);
    const shadowed = shadowedClasses(path.join(resourcesDir, 'backend', 'app.jar'), libDir);
    if (shadowed.length) {
        throw new Error(`app.jar classes also exist in lib/ (lib-first class path would change which one loads): ${shadowed.slice(0, 10).join(', ')}`);
    }
    if (!alignLibMtimes(libDir)) throw new Error(`cannot stamp lib/*.jar mtimes to ${LIB_MTIME_SEC}`);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-cds-'));
    try {
        const home = (name) => { const d = path.join(work, name); fs.mkdirSync(d); return d; };
        // Reference start without any archive, measured the same way as the verification run.
        const plainSec = await runBackendOnce({ java, resourcesDir, home: home('plain-home'), jvmArgs: [] });
        const classList = path.join(work, 'classes.lst');
        await runBackendOnce({ java, resourcesDir, home: home('train-home'),
            jvmArgs: ['-XX:DumpLoadedClassList=' + classList] });

        const filtered = path.join(work, 'classes-lib.lst');
        fs.writeFileSync(filtered, filterClassList(fs.readFileSync(classList, 'utf8')));
        fs.rmSync(archive, { force: true });
        const dumpDir = home('dump');
        execFileSync(java, ['-Xshare:dump', '-XX:SharedClassListFile=' + filtered,
            '-XX:SharedArchiveFile=' + archive, '-cp', linkedLib(dumpDir, resourcesDir)],
        { cwd: dumpDir, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
        if (!fs.existsSync(archive)) throw new Error('java -Xshare:dump produced no archive');
        // The JVM writes the archive 0444. Mac signing then fails on it ("Permission denied" from
        // codesign, run 45929621427), and Squirrel.Mac can't clear quarantine on read-only files
        // (dev-board#1368, same as jre/legal in after-pack.js).
        fs.chmodSync(archive, 0o644);

        const loadLog = path.join(work, 'class-load.log');
        const cachedSec = await runBackendOnce({ java, resourcesDir, home: home('verify-home'),
            // Quoted: a Windows drive letter's colon would otherwise end the -Xlog file option.
            jvmArgs: ['-Xshare:on', '-XX:SharedArchiveFile=' + archive, `-Xlog:class+load=info:file="${loadLog}"`] });
        const shared = countSharedDependencyClasses(fs.readFileSync(loadLog, 'utf8'));
        if (shared < MIN_SHARED_DEPENDENCY_CLASSES) {
            throw new Error(`archive barely used: ${shared} dependency classes from it (expected >= ${MIN_SHARED_DEPENDENCY_CLASSES})`);
        }
        const mb = (fs.statSync(archive).size / 1048576).toFixed(1);
        log(`  • backend CDS archive  ${ARCHIVE_NAME}=${mb} MB sharedDependencyClasses=${shared} `
            + `springStart plain=${plainSec}s archived=${cachedSec}s`);
        return { archive, plainSec, cachedSec, shared };
    } catch (e) {
        fs.rmSync(archive, { force: true });
        throw e;
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

module.exports = { ARCHIVE_NAME, buildBackendCds, filterClassList, countSharedDependencyClasses, shadowedClasses, zipEntryNames };
