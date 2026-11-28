// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH D21：随包 CDS 归档。真实 JVM 训练/校验在 afterPack 里跑（失败即构建失败），
// 这里守纯逻辑：启动参数、类清单过滤、归档命中统计、遮蔽检查、afterPack 的跳过条件。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { filterClassList, countSharedDependencyClasses, shadowedClasses, zipEntryNames } = require('../scripts/backend-cds')
const { buildCdsForPackage } = require('../scripts/after-pack')
const { javaLaunchArgs } = require('../main/services/backend-service')
const overlay = require('../main/services/overlay')
const { LINK_NAME, LIB_MTIME_SEC, ensureBackendLink, alignLibMtimes } = require('../main/services/backend-link')

/** 最小的 stored zip（只为测中央目录解析）。 */
function writeZip(file, names) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const name of names) {
    const n = Buffer.from(name)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, n); centrals.push(central, n)
    offset += 30 + n.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(names.length, 8); eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  fs.writeFileSync(file, Buffer.concat([...locals, cd, eocd]))
}

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-cds-test-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

function packaged(root) {
  const resources = path.join(root, 'resources')
  fs.mkdirSync(path.join(resources, 'backend', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(resources, 'backend', 'app.jar'), 'app')
  return { packaged: true, resourcesPath: resources, dataDir: path.join(root, 'data'), appVersion: '0.92.0' }
}

const bundled = (ctx) => path.join(ctx.resourcesPath, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
const sep = process.platform === 'win32' ? ';' : ':'

test('启动参数：lib/* 在前、app.jar 在后（归档只记录 lib 前缀）', (t) => {
  const ctx = packaged(tmp(t))
  const args = javaLaunchArgs(ctx, bundled(ctx))
  const cp = args[args.indexOf('-cp') + 1]
  assert.equal(cp, path.join(ctx.resourcesPath, 'backend', 'lib', '*') + sep + path.join(ctx.resourcesPath, 'backend', 'app.jar'))
})

test('启动参数：随包 JRE + 归档存在才带 SharedArchiveFile；系统 JDK 回退不带', (t) => {
  const ctx = packaged(tmp(t))
  assert.ok(!javaLaunchArgs(ctx, bundled(ctx)).some((a) => a.startsWith('-XX:SharedArchiveFile')), '没有归档不带')
  const archive = path.join(ctx.resourcesPath, 'backend', 'lib.jsa')
  fs.writeFileSync(archive, 'jsa')
  assert.ok(javaLaunchArgs(ctx, bundled(ctx)).includes('-XX:SharedArchiveFile=' + archive))
  assert.ok(!javaLaunchArgs(ctx, '/usr/bin/java').some((a) => a.startsWith('-XX:SharedArchiveFile')), '别的 JVM 不能用这份归档')
  assert.ok(!javaLaunchArgs(ctx).some((a) => a.startsWith('-XX:SharedArchiveFile')))
})

test('启动参数：补丁 app.jar 生效时归档照用，补丁 jar 接在 lib/* 之后', (t) => {
  const root = tmp(t)
  const ctx = packaged(root)
  fs.writeFileSync(path.join(ctx.resourcesPath, 'backend', 'lib.jsa'), 'jsa')
  const staged = path.join(root, 'staged'); fs.mkdirSync(staged); fs.writeFileSync(path.join(staged, 'app.jar'), 'patched')
  overlay.activate(ctx, '0.92.1', { 'backend-app': staged })
  const args = javaLaunchArgs(ctx, bundled(ctx))
  assert.ok(args.some((a) => a.startsWith('-XX:SharedArchiveFile=')))
  const parts = args[args.indexOf('-cp') + 1].split(sep)
  assert.equal(parts[0], path.join(LINK_NAME, 'lib', '*'))
  assert.ok(parts[1].includes(path.join('overlay', '0.92', 'backend-app', '0.92.1')))
})

test('类清单：去掉 app.jar 的类和它们的 lambda，其余原样保留', () => {
  const out = filterClassList([
    'java/lang/Object id: 0',
    'com/checkba/CheckbaApplication id: 1',
    'org/springframework/boot/SpringApplication id: 2',
    '@lambda-proxy com/checkba/Foo run ()Ljava/lang/Runnable;',
    '@lambda-proxy org/hibernate/Bar get ()Ljava/util/function/Supplier;',
    '',
  ].join('\r\n'))
  assert.deepEqual(out.trim().split('\n'), [
    'java/lang/Object id: 0',
    'org/springframework/boot/SpringApplication id: 2',
    '@lambda-proxy org/hibernate/Bar get ()Ljava/util/function/Supplier;',
  ])
})

test('命中统计：只数来自归档的依赖类（JDK 与 app.jar 不算）', () => {
  const log = [
    '[0.1s][info][class,load] java.lang.Object source: shared objects file',
    '[0.2s][info][class,load] org.springframework.boot.SpringApplication source: shared objects file',
    '[0.2s][info][class,load] org.hibernate.Session source: shared objects file',
    '[0.3s][info][class,load] org.h2.Driver source: file:/x/lib/h2.jar',
    '[0.3s][info][class,load] com.checkba.CheckbaApplication source: file:/x/app.jar',
    '[0.3s][info][class,load] jdk.internal.Foo source: shared objects file',
  ].join('\n')
  assert.equal(countSharedDependencyClasses(log), 2)
})

test('遮蔽检查：app.jar 与 lib 同名类会被找出来', (t) => {
  const d = tmp(t)
  const lib = path.join(d, 'lib'); fs.mkdirSync(lib)
  writeZip(path.join(d, 'app.jar'), ['META-INF/MANIFEST.MF', 'com/checkba/A.class', 'org/x/Patched.class'])
  writeZip(path.join(lib, 'x.jar'), ['META-INF/MANIFEST.MF', 'org/x/Patched.class', 'org/x/Other.class'])
  writeZip(path.join(lib, 'y.jar'), ['META-INF/MANIFEST.MF', 'module-info.class'])
  assert.deepEqual(zipEntryNames(path.join(lib, 'x.jar')), ['META-INF/MANIFEST.MF', 'org/x/Patched.class', 'org/x/Other.class'])
  assert.deepEqual(shadowedClasses(path.join(d, 'app.jar'), lib), ['org/x/Patched.class (x.jar)'])
  writeZip(path.join(d, 'app.jar'), ['META-INF/MANIFEST.MF', 'com/checkba/A.class', 'module-info.class'])
  assert.deepEqual(shadowedClasses(path.join(d, 'app.jar'), lib), [])
})

test('afterPack：跨平台/跨架构构建与无随包后端时跳过，本机构建才生成', async (t) => {
  const d = tmp(t)
  const archByName = { x64: 1, arm64: 3 }
  const calls = []
  const build = async (dir) => { calls.push(dir); return { ok: true } }
  const here = { electronPlatformName: process.platform, arch: archByName[process.arch] }
  assert.equal(await buildCdsForPackage(here, d, build), null, '没有 backend/jre')
  fs.mkdirSync(path.join(d, 'backend', 'lib'), { recursive: true }); fs.mkdirSync(path.join(d, 'jre'))
  const otherPlatform = process.platform === 'win32' ? 'darwin' : 'win32'
  assert.equal(await buildCdsForPackage({ ...here, electronPlatformName: otherPlatform }, d, build), null)
  assert.equal(await buildCdsForPackage({ ...here, arch: process.arch === 'arm64' ? 1 : 3 }, d, build), null)
  assert.deepEqual(calls, [])
  assert.deepEqual(await buildCdsForPackage(here, d, build), { ok: true })
  assert.deepEqual(calls, [d])
})

test('启动参数：带归档时 lib 走数据目录下的 .awd-backend 相对前缀（JDK 21 归档不可搬迁）', (t) => {
  const ctx = packaged(tmp(t))
  fs.writeFileSync(path.join(ctx.resourcesPath, 'backend', 'lib.jsa'), 'jsa')
  const args = javaLaunchArgs(ctx, bundled(ctx))
  assert.equal(args[args.indexOf('-cp') + 1], path.join(LINK_NAME, 'lib', '*') + sep + path.join(ctx.resourcesPath, 'backend', 'app.jar'))
  assert.equal(fs.realpathSync(path.join(ctx.dataDir, LINK_NAME)), fs.realpathSync(path.join(ctx.resourcesPath, 'backend')))
})

test('启动参数：数据目录里 .awd-backend 是真实目录时不动它，退回绝对路径且不带归档', (t) => {
  const ctx = packaged(tmp(t))
  fs.writeFileSync(path.join(ctx.resourcesPath, 'backend', 'lib.jsa'), 'jsa')
  fs.mkdirSync(path.join(ctx.dataDir, LINK_NAME), { recursive: true })
  fs.writeFileSync(path.join(ctx.dataDir, LINK_NAME, 'keep'), 'x')
  const args = javaLaunchArgs(ctx, bundled(ctx))
  assert.ok(!args.some((a) => a.startsWith('-XX:SharedArchiveFile')))
  assert.equal(args[args.indexOf('-cp') + 1].split(sep)[0], path.join(ctx.resourcesPath, 'backend', 'lib', '*'))
  assert.ok(fs.existsSync(path.join(ctx.dataDir, LINK_NAME, 'keep')))
})

test('ensureBackendLink：新建、重复调用不变、安装位置搬走后重新指向', (t) => {
  const root = tmp(t)
  const a = path.join(root, 'install A', 'backend'); fs.mkdirSync(a, { recursive: true }); fs.writeFileSync(path.join(a, 'marker'), 'A')
  const data = path.join(root, 'data')
  const link = ensureBackendLink(data, a)
  assert.equal(link, path.join(data, LINK_NAME))
  assert.equal(fs.readFileSync(path.join(link, 'marker'), 'utf8'), 'A')
  assert.equal(ensureBackendLink(data, a), link)
  // 搬家：旧目录消失（链接悬空），新位置重新指过去
  const b = path.join(root, 'install B', 'backend')
  fs.renameSync(path.join(root, 'install A'), path.join(root, 'install B'))
  assert.equal(ensureBackendLink(data, b), link)
  assert.equal(fs.readFileSync(path.join(link, 'marker'), 'utf8'), 'A')
  // 指向另一个仍存在的目录也会改指
  const c = path.join(root, 'c'); fs.mkdirSync(c); fs.writeFileSync(path.join(c, 'marker'), 'C')
  assert.equal(ensureBackendLink(data, c), link)
  assert.equal(fs.readFileSync(path.join(link, 'marker'), 'utf8'), 'C')
  // 删数据目录不会顺着链接删到安装目录
  fs.rmSync(data, { recursive: true, force: true })
  assert.ok(fs.existsSync(path.join(c, 'marker')))
})

test('alignLibMtimes：Windows 安装不保留 mtime，启动时把 lib/*.jar 改回 dump 时的统一 mtime', (t) => {
  const ctx = packaged(tmp(t))
  const lib = path.join(ctx.resourcesPath, 'backend', 'lib')
  fs.writeFileSync(path.join(lib, 'a.jar'), 'a'); fs.writeFileSync(path.join(lib, 'b.jar'), 'b'); fs.writeFileSync(path.join(lib, 'notes.txt'), 'n')
  fs.utimesSync(path.join(lib, 'b.jar'), LIB_MTIME_SEC, LIB_MTIME_SEC)
  fs.writeFileSync(path.join(ctx.resourcesPath, 'backend', 'lib.jsa'), 'jsa')
  const args = javaLaunchArgs(ctx, bundled(ctx))
  assert.ok(args.some((a) => a.startsWith('-XX:SharedArchiveFile=')))
  for (const n of ['a.jar', 'b.jar']) assert.equal(Math.floor(fs.statSync(path.join(lib, n)).mtimeMs / 1000), LIB_MTIME_SEC, n)
  assert.notEqual(Math.floor(fs.statSync(path.join(lib, 'notes.txt')).mtimeMs / 1000), LIB_MTIME_SEC, '只动 jar')
  assert.equal(alignLibMtimes(path.join(ctx.resourcesPath, 'missing')), false)
})
