// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { stripEmoji } from './stripEmoji.js'

/**
 * 助手气泡的轻量 Markdown 渲染（dev-board#197）。
 *
 * 为什么不引 marked/markdown-it：任务窗格只需要模型常用的那几样
 * （加粗/斜体/行内代码/围栏代码/标题/列表/链接），整库引进来 bundle 徒增
 * 几十 KB，且它们默认放行原始 HTML，反而要再配一层 sanitize。
 *
 * 安全口径：先整体 HTML 转义，再往转义后的文本上套自己的标签——
 * 模型输出里的任何 <script>/<img> 都只会以字面量呈现。链接 href 只放行
 * http(s)，其余降级为纯文本。
 *
 * 流式友好：每次 text_delta 后全量重渲染（消息级文本量下开销可忽略）；
 * 未闭合的 **加粗 保持字面量呈现，闭合后自然变样式，不做半开状态猜测。
 */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 行内标记：`code`、**bold**、*italic*、[text](http url)。输入已 HTML 转义。 */
function renderInline(s) {
  let out = s
  // 行内代码优先（代码里的星号不该再被解析）：占位收集，最后回填
  const codes = []
  out = out.replace(/`([^`\n]+)`/g, (m, c) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })
  // 链接：只放行 http(s)。href 在转义后文本里，& 已成 &amp;，属性位安全
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  // 加粗（**…** 与 __…__），再斜体（*…*）；星号对不齐时保持字面量
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`)
  return out
}

/** GFM 表格行拆格：去掉首尾竖线，按未转义的 | 切分（\| 还原成字面量 |）。输入已 HTML 转义。 */
function splitTableRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}

/** 表头分隔行（| --- | :-: |）：返回各列对齐，不是分隔行返回 null */
function parseTableDelimiter(line) {
  if (!line.includes('-') || !line.includes('|')) return null
  const cells = splitTableRow(line)
  const aligns = []
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null
    aligns.push(c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '')
  }
  return aligns
}

function renderTable(header, aligns, rows) {
  const cell = (tag, c, i) => `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${renderInline(c)}</${tag}>`
  const n = aligns.length
  const head = `<tr>${header.map((c, i) => cell('th', c, i)).join('')}</tr>`
  const body = rows.map((r) => {
    const cells = r.slice(0, n)
    while (cells.length < n) cells.push('')
    return `<tr>${cells.map((c, i) => cell('td', c, i)).join('')}</tr>`
  }).join('')
  // 外包一层可横向滚动的容器：窄窗格里宽表格不撑破气泡
  return `<div class="md-table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`
}

/** 非代码段：按行聚成标题/列表/段落块。 */
function renderBlocks(segment) {
  const lines = segment.split('\n')
  const html = []
  let list = null // {type:'ul'|'ol', items:[]}
  let para = []

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(renderInline).join('<br>')}</p>`)
      para = []
    }
  }
  const flushList = () => {
    if (list) {
      html.push(`<${list.type}>${list.items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</${list.type}>`)
      list = null
    }
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].replace(/\s+$/, '')
    // GFM 表格：表头行 + 分隔行（列数一致）起头，之后连续含 | 的行都是表体
    if (line.includes('|') && li + 1 < lines.length) {
      const aligns = parseTableDelimiter(lines[li + 1].trim())
      const header = aligns && splitTableRow(line)
      if (aligns && header.length === aligns.length) {
        flushPara()
        flushList()
        const rows = []
        let j = li + 2
        while (j < lines.length && lines[j].trim() && lines[j].includes('|')) {
          rows.push(splitTableRow(lines[j]))
          j++
        }
        html.push(renderTable(header, aligns, rows))
        li = j - 1
        continue
      }
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushPara()
      flushList()
      // 窄窗格里 h1/h2 都太吼，统一压到 h4/h5 两档
      const level = heading[1].length <= 2 ? 4 : 5
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }
    const ul = line.match(/^\s*[-*•]\s+(.+)$/)
    if (ul) {
      flushPara()
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] } }
      list.items.push(ul[1])
      continue
    }
    const ol = line.match(/^\s*\d+[.、)]\s+(.+)$/)
    if (ol) {
      flushPara()
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] } }
      list.items.push(ol[1])
      continue
    }
    flushList()
    para.push(line)
  }
  flushPara()
  flushList()
  return html.join('')
}

/**
 * Markdown → 安全 HTML。空文本回空串。
 * 段间 3 个以上连续换行折叠成 2 个——协议标签之间漏进正文的裸换行
 * 是「消息中间一大段空白」的直接来源（dev-board#197）。
 */
export function renderMarkdown(text) {
  if (!text) return ''
  const normalized = stripEmoji(String(text)).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  const escaped = escapeHtml(normalized)
  // 围栏代码块：```lang\n…\n```；流式期间未闭合的围栏把余下内容都当代码
  const parts = escaped.split(/^```[^\n]*$/m)
  const html = []
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      html.push(`<pre><code>${parts[i].replace(/^\n/, '').replace(/\n$/, '')}</code></pre>`)
    } else {
      html.push(renderBlocks(parts[i]))
    }
  }
  return html.join('')
}
