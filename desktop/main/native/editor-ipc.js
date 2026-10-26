// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { NativeEditorSession } = require('./editor-session')

async function readNativeConfig(configFile) {
  if (!configFile || !path.isAbsolute(configFile)) throw Error('AWD_NATIVE_EDITOR_CONFIG must be an absolute managed config file')
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'))
  for (const key of ['worker', 'runtime', 'unoHost', 'unoRuntime']) {
    if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) throw Error(`Invalid native config: ${key}`)
    const stat = await fs.stat(config[key])
    if ((key === 'worker' || key === 'unoHost') ? !stat.isFile() : !stat.isDirectory()) throw Error(`Invalid native resource: ${key}`)
  }
  return config
}
function createNativeEditorManager({ root, configFile, platform = process.platform, createSession = options => new NativeEditorSession(options) }) {
  const sessions = new Map()
  let config, closing = false
  async function open(sender, options) {
    if (closing || platform !== 'darwin') throw Error('Native editor is unavailable on this platform')
    if (!options || typeof options.readOnly !== 'boolean') throw TypeError('Explicit readOnly is required')
    // DOCX is the only actual native export format in this slice. No WASM fallback.
    if (options.name != null && !/\.docx$/i.test(options.name)) throw Error('Native editor currently requires a DOCX')
    if (options.empty !== undefined && typeof options.empty !== 'boolean') throw TypeError('empty must be a boolean')
    config ||= await readNativeConfig(configFile)
    await fs.mkdir(root, { recursive: true })
    const run = await fs.mkdtemp(path.join(root, 'session-')), sessionId = crypto.randomUUID()
    const session = createSession({ config, run, readOnly: options.readOnly, onEvent: event => {
      if (!sender.isDestroyed() && sessions.has(sessionId)) sender.send('checkba:native-editor-event', { sessionId, event })
    } })
    const destroyed = () => { close(sender, sessionId).catch(() => {}) }
    sessions.set(sessionId, { sender, session, destroyed, run })
    sender.once('destroyed', destroyed)
    return { kind: 'native', engine: 'lok', sessionId, initialBlank: options.empty === true || options.name == null,
      capabilities: ['load_document', 'export_document', 'get_ui_state', 'get_selection', 'list_revisions', 'list_comments', 'goto_comment', 'add_comment_at_selection',
        'update_comment', 'delete_comment', 'reply_comment', 'set_comment_resolved',
        'get_document_text', 'get_paragraph', 'get_outline', 'find_text_locations', 'set_selection', 'clear_anchors',
        'replace_at_position', 'replace_selection', 'insert_at_cursor', 'modify_paragraph', 'collapse_selection',
        'get_bookmark_context', 'check_link_anchors', 'goto_bookmark', 'get_selection_hyperlink',
        'bookmark_selection', 'set_selection_hyperlink', 'adopt_legacy_links',
        'get_cursor_context', 'get_hyperlink_at_cursor', 'get_review_layout', 'set_review_balloons',
        'list_fonts', 'list_styles', 'format_selection', 'ui_command', 'set_style', 'set_view_options', 'set_zoom', 'set_chrome',
        'undo', 'redo', 'set_read_only', 'set_track_changes', 'set_revision_view', 'goto_revision', 'resolve_revision', 'resolve_revisions'] }
  }
  function owned(sender, id) {
    const entry = sessions.get(id)
    if (!entry || entry.sender !== sender) throw Error('Native editor session is not owned by this renderer')
    return entry
  }
  async function close(sender, id) {
    const entry = owned(sender, id)
    return entry.closing ||= (async () => {
      const retain = error => fs.writeFile(path.join(entry.run, 'recovery.json'), JSON.stringify({
        sessionId: id, documentName: entry.session.model?.name, reason: error.message,
        retainedAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600 })
      try { await entry.session.close() }
      catch (error) { await retain(error); throw error }
      // Failed/uncertain edits retain their owned recovery files. Clean sessions
      // are removed only after both processes have actually exited.
      if (!entry.session.failure) await fs.rm(entry.run, { recursive: true, force: true })
      else await retain(entry.session.failure)
      sessions.delete(id); sender.removeListener('destroyed', entry.destroyed)
    })()
  }
  return {
    open,
    async request(sender, id, action, params) {
      try { return await owned(sender, id).session.execute(action, params) }
      catch (error) { return { success: false, code: error.code || 'NATIVE_ACTION_FAILED', message: error.message, ...(error.inputNotConsumed === true ? { inputNotConsumed: true } : {}) } }
    },
    close,
    async closeAll() {
      closing = true
      const results = await Promise.allSettled([...sessions].map(([id, entry]) => close(entry.sender, id)))
      const failure = results.find(result => result.status === 'rejected')
      if (failure) throw failure.reason
    }
  }
}
module.exports = { createNativeEditorManager, readNativeConfig }
