// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const OPEN = '<ask_user>'
const CLOSE = '</ask_user>'

// This is a display compatibility path, never a tool-call parser. The server already
// pauses on the nested <question>; no client-generated id grants tool authority.
function readQuestion(raw, terminal = false) {
  const end = raw.endsWith(CLOSE) ? raw.slice(OPEN.length, -CLOSE.length) : terminal ? raw.slice(OPEN.length) : null
  if (end == null) return null
  // Parameter-style calls require the closing wrapper: incomplete calls are not
  // actionable. This remains display-only; server validation owns execution.
  if (/^\s*<parameter=/.test(end) && raw.endsWith(CLOSE)) {
    let rest = end.trim()
    const args = {}
    while (rest) {
      const field = /^<parameter=(question|options|header|multi_select)>([\s\S]*?)<\/parameter>/.exec(rest)
      if (!field || Object.hasOwn(args, field[1])) return null
      const [, key, value] = field
      try { args[key] = ['options', 'multi_select'].includes(key) ? JSON.parse(value) : value.trim() } catch { return null }
      rest = rest.slice(field[0].length).trim()
    }
    if (!args.question || (Object.hasOwn(args, 'multi_select') && typeof args.multi_select !== 'boolean')) return null
    const options = Object.hasOwn(args, 'options') ? args.options : []
    if (!Array.isArray(options) || options.some(o => !o || typeof o.label !== 'string' || !o.label.trim()
      || (o.description != null && typeof o.description !== 'string'))) return null
    return { question: args.question, options, header: args.header, multiSelect: args.multi_select ?? false }
  }
  const match = /^\s*<question>([\s\S]*?)<\/question>\s*(?:<options>([\s\S]*?)<\/options>\s*)?$/.exec(end)
  if (!match || !match[1].trim()) return null
  let options = []
  try { options = match[2] == null ? [] : JSON.parse(match[2]) } catch { return null }
  if (!Array.isArray(options) || options.some(o => !o || typeof o.label !== 'string' || !o.label.trim()
    || (o.description != null && typeof o.description !== 'string'))) return null
  return { question: match[1].trim(), options }
}

const ATTR_OPEN = /<ask_user(?=\s)/
const ENTITY_HEAD = /^<ask_user\s+[a-z_]+\s*=\s*&(?:quot|#34|#39|apos);/
const ATTR_KEYS = new Set(['question', 'options', 'header', 'multi_select'])
const unescapeEntities = t => t.replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// End index (exclusive) of a JSON array literal starting at `start`, string-aware; -1 if unbalanced.
function jsonArrayEnd(text, start) {
  let depth = 0
  let str = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (str) { if (ch === '\\') i++; else if (ch === '"') str = false; continue }
    if (ch === '"') str = true
    else if (ch === '[') depth++
    else if (ch === ']' && --depth === 0) return i + 1
  }
  return -1
}

/** Display-only reader for the self-closing attribute form
 * `<ask_user question="…" options='[…]' />` (single/double quotes, entity-escaped quotes,
 * options as strings or {label,description}). Returns {end, question} | 'incomplete' | null. */
function readAttrTag(buf) {
  let text = buf
  let shift = null
  if (ENTITY_HEAD.test(buf)) {
    const close = buf.indexOf('/>')
    if (close < 0) return 'incomplete'
    shift = close + 2
    text = unescapeEntities(buf.slice(0, shift))
  }
  let i = '<ask_user'.length
  const args = {}
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (i >= text.length) return shift == null ? 'incomplete' : null
    if (text.startsWith('/>', i)) { i += 2; break }
    if (text[i] === '/' && i + 1 >= text.length) return 'incomplete'
    const head = /^([a-z_]+)\s*=\s*(['"])/.exec(text.slice(i, i + 40))
    if (!head) return /^[a-z_]*\s*=?\s*(&[a-z#0-9]*;?)?$/.test(text.slice(i)) && shift == null ? 'incomplete' : null
    const [, key, quote] = head
    if (!ATTR_KEYS.has(key) || Object.hasOwn(args, key)) return null
    const start = i + head[0].length
    let end = -1
    if (key === 'options' && text[start] === '[') {
      const j = jsonArrayEnd(text, start)
      if (j < 0 || j >= text.length) return shift == null ? 'incomplete' : null
      if (text[j] === quote) end = j
    }
    if (end < 0) {
      end = start
      while (end < text.length && text[end] !== quote) end += text[end] === '\\' ? 2 : 1
      if (end >= text.length) return shift == null ? 'incomplete' : null
    }
    args[key] = text.slice(start, end)
    i = end + 1
  }
  if (!args.question || !args.question.trim()) return null
  let options = []
  if (args.options != null) {
    try { options = JSON.parse(args.options) } catch { return null }
    if (!Array.isArray(options)) return null
    options = options.map(o => typeof o === 'string' ? { label: o } : o)
    if (options.some(o => !o || typeof o.label !== 'string' || !o.label.trim()
      || (o.description != null && typeof o.description !== 'string'))) return null
  }
  let multiSelect = false
  if (args.multi_select != null) {
    if (!['true', 'false'].includes(args.multi_select)) return null
    multiSelect = args.multi_select === 'true'
  }
  return { end: shift ?? i, question: { question: args.question.trim(), options, header: args.header, multiSelect } }
}

/** Incrementally hold only the legacy wrapper, so its nested protocol cannot leak
 * into body text or produce a half-built card. Literal examples bypass the XML
 * parser as a whole. Normal text is released on every input chunk. */
export function createLegacyAskUserMarkup() {
  let pending = ''
  let wrapper = ''
  let literal = false
  let line = ''
  let fence = null
  let inlineTicks = 0
  let attrMode = false

  function track(text) {
    for (const ch of text) {
      if (ch === '\n') {
        const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
        if (m && !inlineTicks) {
          if (!fence) fence = { char: m[1][0], size: m[1].length }
          else if (m[1][0] === fence.char && m[1].length >= fence.size && !m[2].trim()) fence = null
        }
        if (!m && !fence) {
          for (const ticks of line.match(/`+/g) || []) {
            if (!inlineTicks) inlineTicks = ticks.length
            else if (ticks.length === inlineTicks) inlineTicks = 0
          }
        }
        line = ''
      } else line += ch
    }
  }

  return {
    push(text, terminal = false) {
      pending += text || ''
      const result = []
      const emit = (kind, text) => { if (text) result.push({ kind, text }) }
      while (pending) {
        if (wrapper && attrMode) {
          const buf = wrapper + pending
          const res = readAttrTag(buf)
          if (res === 'incomplete' && !terminal && buf.length <= 65536) { wrapper = buf; pending = ''; break }
          attrMode = false
          if (res && res !== 'incomplete' && !literal) {
            result.push({ kind: 'question', question: res.question, raw: buf.slice(0, res.end) })
            track(buf.slice(0, res.end))
            wrapper = ''
            pending = buf.slice(res.end)
          } else {
            // Not a valid call: release the opening token as text and rescan the rest.
            emit('literal', '<ask_user')
            track('<ask_user')
            wrapper = ''
            pending = buf.slice('<ask_user'.length)
          }
          continue
        }
        if (wrapper) {
          const end = pending.indexOf(CLOSE)
          if (end < 0 && !terminal && wrapper.length + pending.length <= 65536) {
            // Keep a possible split closing tag in pending, not in the opaque body.
            const take = Math.max(0, pending.length - CLOSE.length + 1)
            wrapper += pending.slice(0, take)
            pending = pending.slice(take)
            break
          }
          const take = end >= 0 ? end + CLOSE.length : pending.length
          wrapper += pending.slice(0, take)
          pending = pending.slice(take)
          const question = !literal && readQuestion(wrapper, terminal)
          if (question) result.push({ kind: 'question', question, raw: wrapper })
          else emit('literal', wrapper)
          track(wrapper)
          wrapper = ''
          continue
        }
        const plainAt = pending.indexOf(OPEN)
        const attrAt = pending.search(ATTR_OPEN)
        const isAttr = attrAt >= 0 && (plainAt < 0 || attrAt < plainAt)
        const at = isAttr ? attrAt : plainAt
        if (at >= 0) {
          const before = pending.slice(0, at)
          emit('text', before)
          track(before)
          if (isAttr) {
            literal = !!fence || !!inlineTicks || !/^ {0,3}$/.test(line)
            attrMode = true
            wrapper = '<ask_user'
            pending = pending.slice(at + '<ask_user'.length)
            continue
          }
          // A wrapper in a code fence or prose/code span is an example, not a UI
          // instruction. Only a standalone line may introduce a question card.
          literal = !!fence || !!inlineTicks || !/^ {0,3}$/.test(line)
          wrapper = OPEN
          pending = pending.slice(at + OPEN.length)
          continue
        }
        let keep = 0
        if (!terminal) {
          for (let n = 1; n < OPEN.length; n++) if (pending.endsWith(OPEN.slice(0, n))) keep = n
        }
        const ready = pending.slice(0, pending.length - keep)
        emit('text', ready)
        track(ready)
        pending = pending.slice(pending.length - keep)
        break
      }
      // An opening wrapper can be the very last bytes of a cancelled response.
      if (terminal && wrapper && !pending) {
        emit('literal', wrapper)
        track(wrapper)
        wrapper = ''
        attrMode = false
      }
      return result
    }
  }
}
