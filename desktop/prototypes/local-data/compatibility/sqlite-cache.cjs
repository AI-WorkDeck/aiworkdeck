// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const quote = value => {
  const s = String(value)
  if (s.includes('\0')) throw new Error('Cache values must not contain NUL')
  return "'" + s.replaceAll("'", "''") + "'"
}

class SQLiteCache {
  constructor(directory, profileId) {
    if (!path.isAbsolute(directory) || directory === path.parse(directory).root) throw new Error('An absolute owned cache directory is required')
    if (!profileId || profileId.includes('\0')) throw new Error('A nonempty profileId is required')
    this.directory = path.resolve(directory)
    this.profileId = profileId
    this.database = path.join(this.directory, 'read-model.sqlite')
    this.queue = Promise.resolve()
    this.initialized = null
  }
  async inspect() {
    let current = path.parse(this.directory).root
    for (const part of this.directory.slice(current.length).split(path.sep)) {
      current = path.join(current, part)
      const stat = await fs.lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e })
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Cache directory must not contain symlinks')
    }
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const stat = await fs.lstat(this.database + suffix).catch(e => { if (e.code === 'ENOENT') return null; throw e })
      if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw new Error('Unsafe SQLite cache file')
    }
  }
  async initialize() {
    await this.inspect()
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const marker = path.join(this.directory, '.awd-java-read-model')
    const entries = await fs.readdir(this.directory)
    if (!entries.includes(path.basename(marker))) {
      if (entries.length) throw new Error('Refusing a nonempty unowned cache directory')
      await fs.writeFile(marker, JSON.stringify({ schema: 1, profileId: this.profileId }), { flag: 'wx', mode: 0o600 })
    }
    const stat = await fs.lstat(marker)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe cache marker')
    const owner = JSON.parse(await fs.readFile(marker, 'utf8'))
    if (owner.schema !== 1 || owner.profileId !== this.profileId) throw new Error('Cache belongs to a different profile')
    await this.sql('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS snapshot(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS guards(project_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);')
    await fs.chmod(this.database, 0o600)
  }
  async sql(sql) {
    await this.inspect()
    const { stdout } = await execute('/usr/bin/sqlite3', ['-batch', '-json', this.database, sql], { maxBuffer: 32 * 1024 * 1024, timeout: 10000 })
    return stdout.trim() ? JSON.parse(stdout) : []
  }
  run(sql) {
    const result = this.queue.then(async () => {
      if (!this.initialized) this.initialized = this.initialize()
      await this.initialized
      return this.sql(sql)
    })
    this.queue = result.catch(() => {})
    return result
  }
  async read() { const rows = await this.run('SELECT payload FROM snapshot WHERE id=1;'); return rows.length ? JSON.parse(rows[0].payload) : null }
  write(snapshot) { return this.run(`INSERT INTO snapshot VALUES(1,${quote(JSON.stringify(snapshot))}) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload;`) }
  clear() { return this.run('DELETE FROM snapshot;') }
  async guards() { return (await this.run('SELECT payload FROM guards ORDER BY project_id;')).map(r => JSON.parse(r.payload)) }
  guard(projectId, value) { return this.run(`INSERT INTO guards VALUES(${Number(projectId)},${quote(JSON.stringify(value))}) ON CONFLICT(project_id) DO UPDATE SET payload=excluded.payload;`) }
  clearGuard(projectId) { return this.run(`DELETE FROM guards WHERE project_id=${Number(projectId)};`) }
}
module.exports = { SQLiteCache }
