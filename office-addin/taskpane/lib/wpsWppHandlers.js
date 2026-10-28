// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * WPS 演示宿主（WPP）的 office_command HANDLERS。
 *
 * 命令名与参数/返回值契约以 officeExecutor.js 为准绳——两个家族对后端和模型
 * 呈现同一张工具表；WPS 侧的能力差异只体现在返回值的 note 说明字段里。
 *
 * 对象模型：VBA 同构的同步 JSAPI（wps.WppApplication().ActivePresentation 起步），
 * 没有 Office.js 的 PowerPoint.run/context.sync/requirement set 概念，全版本同一
 * 能力面。枚举不依赖 wps.Enum 命名空间，本文件定死数值常量（与 Office VBA 同值）。
 *
 * 真机验证要点（详见调研 wps-wpp-api.md 的「需真机验证清单」）：
 * - TextRange.Text 段落分隔符是 \r 还是 \n（textMatch/searchText 跨段匹配口径）；
 * - Characters() 切出的子串上挂 ActionSettings 超链接是否生效（本文件已带整段降级）；
 * - Font.NameFarEast 对中文字体名是否必须（本文件 Name/NameFarEast 双设）；
 * - MsoShapeType 数值抽查对拍（msoPicture=13/msoPlaceholder=14/msoTable=19/msoTextBox=17）；
 * - Shape.Id 会话内稳定性（get_slide_details → delete_shape 的 id 往返）。
 */

// ==================== 枚举数值常量（VBA 同值，不依赖 wps.Enum） ====================

/** MsoTriState */
const msoTrue = -1
const msoFalse = 0
/** MsoTextOrientation：AddTextbox 首参 */
const msoTextOrientationHorizontal = 1
/** MsoAutoShapeType（v1 起步三种；Office.js 的 ellipse 对应 VBA 的 Oval） */
const msoShapeRectangle = 1
const msoShapeIsoscelesTriangle = 7
const msoShapeOval = 9
/** MsoShapeType（识别用） */
import { t } from './i18n.js'
import { wpsNativeServices, createWpsTemporaryPath } from './wpsNativeServices.js'
import { imageOptions, preparePptImage, addWpsChart, formatWpsChart, setWpsTransition, mediaPartial } from './pptMedia.js'
import { pptTarget, pptExpected, pptGeometry, pptShapeStyle, wpsPptShape, pptTableStyle, wpsNotesBody, pptParagraphFormat, applyWpsParagraphFormat } from './pptPrecision.js'
import { findAllNormalized, describeAnchorFailure } from './textMatch.js'
import { substringEdits } from './minimalEdit.js'
import { readWppSlides } from './wpsDoc.js'
import { parseLocator, capReferenceText, blankPageText, unsupportedLocatorError } from './referenceRead.js'
const msoTable = 19
/** MsoShapeType：组合（与 wpsDoc.collectShapeText 同一常量） */
const msoGroup = 6
/** 组合套组合的递归深度上限，防病态嵌套 */
const MAX_SHAPE_DEPTH = 4
/** ActionSettings 索引与动作类型 */
const ppMouseClick = 1
const ppActionHyperlink = 7

/** MsoShapeType 数值 → 可读名（Shape.Type 返回裸数值，转成语义词给模型看） */
const MSO_SHAPE_TYPE_NAMES = {
  1: 'autoShape',
  3: 'chart',
  5: 'freeform',
  6: 'group',
  9: 'line',
  13: 'picture',
  14: 'placeholder',
  16: 'media',
  17: 'textBox',
  19: 'table'
}

/** 命令层 shapeType 短名 → MsoAutoShapeType 数值 */
const WPS_SHAPE_TYPES = {
  rectangle: msoShapeRectangle,
  ellipse: msoShapeOval,
  triangle: msoShapeIsoscelesTriangle
}

/** 下划线线型合法值（与 Office 面同一张表；WPS 只有开/关，非 none 一律降级为开） */
const PPT_UNDERLINE_STYLES = ['none', 'single', 'double', 'dotted', 'wave']

/** 新增文本框/形状的默认位置尺寸（磅），与 officeExecutor.PPT_SHAPE_DEFAULTS 同值 */
const PPT_SHAPE_DEFAULTS = { left: 50, top: 50, width: 400, height: 100 }

// ==================== 颜色转换（导出的纯函数） ====================

/** '#RRGGBB' → COM RGB 数值（BGR 打包，低字节是红：value = R + (G<<8) + (B<<16)） */
export function hexToComRgb(hex) {
  const raw = String(hex || '').trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    throw new Error(`颜色值非法：${hex}（应为 #RRGGBB 形式，如 #336699）`)
  }
  const n = parseInt(raw, 16)
  return ((n >> 16) & 0xff) | (n & 0xff00) | ((n & 0xff) << 16)
}

/** COM RGB 数值 → '#RRGGBB'（hexToComRgb 的逆变换） */
export function comRgbToHex(value) {
  const n = Number(value) >>> 0
  const r = n & 0xff
  const g = (n >> 8) & 0xff
  const b = (n >> 16) & 0xff
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

// ==================== 宿主访问辅助 ====================

/** 演示宿主 Application 入口（唯一取法，便于真机联调时统一替换） */
function app() {
  return wps.WppApplication()
}

/** 当前演示文稿；没打开时抛中文错误 */
function activePresentation() {
  const pres = app().ActivePresentation
  if (!pres) throw new Error('当前没有打开的演示文稿')
  return pres
}

/** slideNumber 参数校验（1 基整数），报错文案与 officeExecutor 一致 */
function toSlideNumber(raw) {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) throw new Error('slideNumber 须为大于等于 1 的整数')
  return n
}

/** 按 1 基页码取幻灯片，越界抛错（文案与 officeExecutor.getSlideOrThrow 同口径） */
function getSlideOrThrow(pres, slideNumber) {
  const count = pres.Slides.Count
  if (slideNumber > count) {
    throw new Error(`slideNumber ${slideNumber} 越界：演示文稿共 ${count} 页（页码从 1 开始）`)
  }
  return pres.Slides.Item(slideNumber)
}

/**
 * 形状是否带文本：HasTextFrame/HasText 是 MsoTriState（msoTrue=-1 为真值），
 * truthy 判断同时兼容布尔形态；个别形状访问 TextFrame 即抛，按无文本处理。
 */
function shapeHasText(sp) {
  try {
    if (!sp.HasTextFrame) return false
    // TextFrame 只取一次：同步桥下每个属性访问都是一次跨进程往返，原先这里连取三次，
    // 上百页的演示稿里光这一处就是几千次白跑
    const frame = sp.TextFrame
    return !!(frame && frame.HasText)
  } catch (e) {
    return false
  }
}

/** 形状整段文本（调用前须 shapeHasText 为真） */
function shapeText(sp) {
  return String(sp.TextFrame.TextRange.Text || '')
}

/**
 * 一页上**所有承载文字的形状**，含表格单元格与组合子形状。
 *
 * 为什么必须递归（dev-board#288）：演示稿的正文常常不在顶层文本框里——对比表、
 * 条款对照、时间表的文字在 `Table.Cell(r,c).Shape` 里，图示+标注、SmartArt 转出来的
 * 组合的文字在子形状里。读取侧（`wpsDoc.collectShapeText`）早就按"表格 → 组合递归 →
 * 普通文本框"三条路收，**写入侧一直只看顶层 TextFrame**：模型在上下文里读得到那些字，
 * 一改就报"未找到"，用户看着满屏字，AI 说这页没有这段内容。
 *
 * 任何一步失败只跳过该形状，不许拖垮整页（与读取侧同一条纪律）。
 *
 * @returns {Array<{shape:object, label:string}>} label 形如 "3"、"3[2,1]"（表格第 2 行 1 列）、
 *          "5/2"（组合内第 2 个子形状），用于返回值里说清改到了哪儿
 */
function textBearingShapes(shapes, depth = 0, prefix = '') {
  const out = []
  let count = 0
  try { count = Number(shapes.Count) || 0 } catch (e) { return out }
  for (let j = 1; j <= count; j++) {
    let sp = null
    try { sp = shapes.Item(j) } catch (e) { continue }
    if (!sp) continue
    const label = prefix ? `${prefix}/${j}` : String(j)
    let isTable = false
    try { isTable = shapeIsTable(sp) } catch (e) { /* 无 HasTable 属性的宿主版本 */ }
    if (isTable) {
      let collected = false
      try {
        const table = sp.Table
        const rows = Number(table.Rows.Count) || 0
        const cols = Number(table.Columns.Count) || 0
        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= cols; c++) {
            try {
              const cell = table.Cell(r, c).Shape
              if (shapeHasText(cell)) out.push({ shape: cell, label: `${label}[${r},${c}]` })
            } catch (e) { /* 合并单元格等取不到，跳过这一格 */ }
          }
        }
        collected = true
      } catch (e) { /* 取不到表格结构就按普通形状继续 */ }
      if (collected) continue
    }
    let isGroup = false
    try { isGroup = Number(sp.Type) === msoGroup } catch (e) { /* 取不到 Type */ }
    if (isGroup && depth < MAX_SHAPE_DEPTH) {
      let collected = false
      try {
        const children = textBearingShapes(sp.GroupItems, depth + 1, label)
        for (const child of children) out.push(child)
        collected = true
      } catch (e) { /* 取不到子项就按普通形状处理 */ }
      if (collected) continue
    }
    if (shapeHasText(sp)) out.push({ shape: sp, label })
  }
  return out
}

/** 段落分隔符归一：WPS/VBA 的 TextRange.Text 段落间是 \r，统一成 \n 再比对 */
function normalizeBreaks(text) {
  return String(text).replace(/\r\n?/g, '\n')
}

/** 形状是否为表格：优先 HasTable，个别版本缺该属性时退回 Type 数值判断 */
function shapeIsTable(sp) {
  try {
    if (sp.HasTable) return true
  } catch (e) { /* 无 HasTable 属性的宿主版本 */ }
  return sp.Type === msoTable
}

/** 定位一页上的表格形状：shapeId 精确指定，或缺省取第一个表格 */
function findTableShape(slide, shapeId) {
  const shapes = slide.Shapes
  const id = shapeId == null ? '' : String(shapeId)
  for (let j = 1; j <= shapes.Count; j++) {
    const sp = shapes.Item(j)
    if (id) {
      if (String(sp.Id) !== id) continue
      if (!shapeIsTable(sp)) {
        throw new Error(`id 为 ${id} 的形状不是表格（可先用 office_ppt_get_slide_details 核对）`)
      }
      return sp
    }
    if (shapeIsTable(sp)) return sp
  }
  if (id) throw new Error(`未找到 id 为 ${id} 的形状（可先用 office_ppt_get_slide_details 核对）`)
  throw new Error('该页没有表格，请先用 office_ppt_add_table 插入或核对 shapeId')
}

/** 读一格文本：去掉末尾段落符（WPS 空单元格可能返回单个 \r） */
function readCellText(table, row, col) {
  const raw = String(table.Cell(row, col).Shape.TextFrame.TextRange.Text || '')
  return normalizeBreaks(raw).replace(/\n$/, '')
}

/** 鼠标单击动作设置：兼容 ActionSettings(idx) 函数式与 ActionSettings.Item(idx) 两种形态 */
function mouseClickAction(textRange) {
  const settings = textRange.ActionSettings
  if (typeof settings === 'function') return textRange.ActionSettings(ppMouseClick)
  return settings.Item(ppMouseClick)
}

/** 对一段 TextRange 挂超链接：官方示例顺序是先设动作类型再设地址 */
function applyHyperlink(textRange, url) {
  const action = mouseClickAction(textRange)
  action.Action = ppActionHyperlink
  action.Hyperlink.Address = url
}

// ==================== HANDLERS ====================

export const WPS_WPP_HANDLERS = {
  async ppt_add_image(args) {
    imageOptions(args)
    const pres=activePresentation(), source=String(pres.FullName||pres.Name), slide=getSlideOrThrow(pres,args.slideNumber), slideId=slide.SlideID
    const services=wpsNativeServices(),fs=services.fileSystem
    if(typeof slide.Shapes.AddPicture!=='function'||typeof fs?.writeAsBinaryString!=='function'||typeof fs?.readAsBinaryString!=='function'||typeof fs?.Remove!=='function')throw new Error(t('pptCapabilityUnavailable'))
    const image=await preparePptImage(args)
    const now=activePresentation()
    if(String(now.FullName||now.Name)!==source||getSlideOrThrow(now,args.slideNumber).SlideID!==slideId)throw new Error(t('fileOperationStale'))
    const path=createWpsTemporaryPath(services,image.extension)
    let shape
    try{
      const binary=atob(image.base64);fs.writeAsBinaryString(path,binary)
      if(fs.readAsBinaryString(path)!==binary)throw new Error(t('fileOperationInvalidBytes'))
      shape=slide.Shapes.AddPicture(path,0,-1,image.left,image.top,image.width,image.height)
      if(args.sendToBack)shape.ZOrder(1)
      return {slideNumber:args.slideNumber,shapeId:String(shape.Id),shapeName:String(shape.Name),created:true,fit:image.fit,cropped:image.cropped}
    }catch(error){throw mediaPartial(error,args,shape)}finally{try{fs.Remove(path)}catch{}}
  },
  async ppt_add_chart(args) { return addWpsChart(getSlideOrThrow(activePresentation(),args.slideNumber),args) },
  async ppt_format_chart(args) { return formatWpsChart(getSlideOrThrow(activePresentation(),args.slideNumber),args) },
  async ppt_set_transition(args) { return setWpsTransition(getSlideOrThrow(activePresentation(),args.slideNumber),args,globalThis.wps?.Enum) },

  async ppt_get_slides() {
    const pres = activePresentation()
    const count = pres.Slides.Count
    const slides = []
    for (let i = 1; i <= count; i++) {
      const texts = []
      // 表格单元格与组合子形状里的文字也要读到——否则模型在这里看到「这页没内容」，
      // 而随消息内联上送的正文里明明有（两边口径不一致比两边都读不到更糟）
      for (const { shape } of textBearingShapes(pres.Slides.Item(i).Shapes)) {
        const t = shapeText(shape).trim()
        if (t) texts.push(t)
      }
      slides.push({ slide: i, texts })
    }
    return { slideCount: count, slides }
  },

  async ppt_replace_text(args) {
    const searchText = String(args.searchText || '')
    if (!searchText) throw new Error('查找文本不能为空')
    if (args.replaceText == null) throw new Error(t('pptInvalidArguments'))
    const replaceText = String(args.replaceText)
    const pres = activePresentation()
    if (args.slideNumber != null) pptTarget(args, false)
    if (args.expectedText != null && args.shapeId == null) throw new Error(t('pptInvalidTarget'))
    const targets = []
    const first = args.slideNumber == null ? 1 : Number(args.slideNumber)
    const last = args.slideNumber == null ? pres.Slides.Count : first
    if (last > pres.Slides.Count) throw new Error(t('pptInvalidTarget'))
    for (let i = first; i <= last; i++) {
      const shapes = args.shapeId != null ? [{ shape: wpsPptShape(pres, args) }] : textBearingShapes(pres.Slides.Item(i).Shapes)
      for (const { shape } of shapes) {
        if (!shapeHasText(shape)) continue
        const text = shapeText(shape)
        pptExpected(text, args)
        const hits = findAllNormalized(text, searchText)
        if (args.all === false) { if (targets.length) continue; hits.splice(1) }
        if (hits.length) targets.push({ shape, hits, slide: i })
      }
    }
    let replaced = 0
    const touchedSlides = []
    for (const { shape, hits, slide } of targets) {
      const full = shape.TextFrame.TextRange
      for (let k = hits.length - 1; k >= 0; k--) {
        const hit = hits[k]
        full.Characters(hit.start + 1, hit.end - hit.start).Text = replaceText
        replaced++
      }
      if (!touchedSlides.includes(slide)) touchedSlides.push(slide)
    }
    if (!replaced) {
      throw new Error('未找到目标文本，请确认 searchText 与幻灯片文本精确一致（可先用 ppt_get_slides 核对）')
    }
    return { replaced, slides: touchedSlides }
  },

  async ppt_format_text(args) {
    const paragraph = pptParagraphFormat(args.paragraphFormat, 'wps')
    const searchText = String(args.searchText || '')
    if (!searchText && args.shapeId == null) throw new Error(t('pptInvalidTarget'))
    const applied = {}
    if (args.fontName) applied.name = String(args.fontName)
    if (args.fontSize != null) applied.size = Number(args.fontSize)
    if (args.bold != null) applied.bold = !!args.bold
    if (args.italic != null) applied.italic = !!args.italic
    let underlineStyle = null
    if (args.underline != null) {
      underlineStyle = String(args.underline).trim().toLowerCase()
      if (!PPT_UNDERLINE_STYLES.includes(underlineStyle)) {
        throw new Error(`underline 值非法：${args.underline}（合法值：${PPT_UNDERLINE_STYLES.join('/')}）`)
      }
      applied.underline = underlineStyle
    }
    if (args.color) applied.color = String(args.color)
    if (!Object.keys(applied).length && !Object.keys(paragraph).length) {
      throw new Error('未给出任何格式参数（fontName/fontSize/bold/italic/underline/color 至少给一个）')
    }
    const colorRgb = args.color ? hexToComRgb(args.color) : null

    const pres = activePresentation()
    // JS 侧在整串文本上找偏移，宿主侧只做 Characters 切片（每次属性访问都是跨进程
    // RPC，别在宿主对象上逐字符遍历）。格式不改文本长度，多目标无须从右到左应用。
    const targets = []
    if (args.slideNumber != null) pptTarget(args, false)
    if (args.expectedText != null && args.shapeId == null) throw new Error(t('pptInvalidTarget'))
    const first = args.slideNumber == null ? 1 : Number(args.slideNumber)
    const last = args.slideNumber == null ? pres.Slides.Count : first
    if (last > pres.Slides.Count) throw new Error(t('pptInvalidTarget'))
    outer:
    for (let i = first; i <= last; i++) {
      const shapes = args.shapeId != null ? [{ shape: wpsPptShape(pres, args) }] : textBearingShapes(pres.Slides.Item(i).Shapes)
      for (const { shape: sp } of shapes) {
        if (!shapeHasText(sp)) continue
        const text = shapeText(sp)
        pptExpected(text, args)
        // 归一化定位（dev-board#286）：模型抄的是我们拼给它的正文（页码行、' | ' 分隔、
        // 段内 \r 已被换成空格），逐字 indexOf 必然失配。命中区间是**原文坐标**，
        // 长度按命中原文算而不是按 searchText 算——两者可能不等长（全角 vs 半角）。
        for (const h of (searchText ? findAllNormalized(text, searchText) : [{ start: 0, end: text.length }])) {
          targets.push({ shape: sp, start: h.start + 1, len: h.end - h.start }) // Characters 的 Start 是 1 基
          if (!args.applyToAll) break outer
        }
      }
    }
    if (!targets.length) {
      throw new Error('未找到目标文本，请确认 searchText 与幻灯片文本精确一致（可先用 ppt_get_slides 核对）')
    }
    for (const t of targets) {
      const sub = t.shape.TextFrame.TextRange.Characters(t.start, t.len)
      const font = sub.Font
      if (Object.keys(paragraph).length) applyWpsParagraphFormat(sub.ParagraphFormat, paragraph)
      if (applied.name) {
        font.Name = applied.name
        font.NameFarEast = applied.name // 中文字体名两处都设，只设 Name 可能不生效
      }
      if (applied.size != null) font.Size = applied.size
      if (applied.bold != null) font.Bold = applied.bold ? msoTrue : msoFalse
      if (applied.italic != null) font.Italic = applied.italic ? msoTrue : msoFalse
      if (underlineStyle != null) font.Underline = underlineStyle === 'none' ? msoFalse : msoTrue
      if (colorRgb != null) font.Color.RGB = colorRgb
    }
    const result = { formatted: targets.length, applied, paragraphFormat: paragraph }
    if (underlineStyle && underlineStyle !== 'none' && underlineStyle !== 'single') {
      result.note = `WPS 演示的下划线只有开/关线型，${underlineStyle} 已降级为普通下划线`
    }
    return result
  },

  async ppt_add_slide(args) {
    const position = args.position != null ? Math.floor(Number(args.position)) : null
    const title = args.title ? String(args.title) : ''
    const body = args.body ? String(args.body) : ''
    const pres = activePresentation()
    const count = pres.Slides.Count
    // AddSlide(Index, CustomLayout) 原生带插入位置，一步到位——没有 Office.js
    // 「追加再挪」的降级语义（注意 WPS 没有 Slides.Add，只有 AddSlide）。
    const index = position != null ? Math.max(1, Math.min(position, count + 1)) : count + 1
    // 版式取插入位置附近的现有页保持观感一致；空演示文稿兜底母版版式
    const layout = count > 0
      ? pres.Slides.Item(Math.min(Math.max(index - 1, 1), count)).CustomLayout
      : pres.SlideMaster.CustomLayouts.Item(2)
    const slide = pres.Slides.AddSlide(index, layout)
    let titleAdded = false
    let bodyAdded = false
    if (title) {
      const box = slide.Shapes.AddTextbox(msoTextOrientationHorizontal, 40, 30, 600, 60)
      box.TextFrame.TextRange.Text = title
      box.TextFrame.TextRange.Font.Size = 28
      box.TextFrame.TextRange.Font.Bold = msoTrue
      titleAdded = true
    }
    if (body) {
      const box = slide.Shapes.AddTextbox(msoTextOrientationHorizontal, 40, 110, 600, 300)
      box.TextFrame.TextRange.Text = body
      bodyAdded = true
    }
    return { slideAdded: true, position: index, moved: false, titleAdded, bodyAdded }
  },

  async ppt_delete_slide(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const pres = activePresentation()
    const count = pres.Slides.Count
    // WPS 本身允许删光所有幻灯片；「只剩一页拒删」是与 Office 面对齐的安全契约
    if (count <= 1) {
      throw new Error('演示文稿只剩一页，无法删除（保留最后一页是安全约定）')
    }
    if (slideNumber > count) {
      throw new Error(`slideNumber ${slideNumber} 越界：演示文稿共 ${count} 页（页码从 1 开始）`)
    }
    pres.Slides.Item(slideNumber).Delete()
    return { deleted: true, slideNumber, remaining: count - 1 }
  },

  async ppt_add_text_box(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const text = String(args.text || '')
    if (!text) throw new Error('文本框内容不能为空')
    const pres = activePresentation()
    const slide = getSlideOrThrow(pres, slideNumber)
    // 注意与 Office.js 的参数错位：WPS 首参是方向枚举，文本要事后赋 TextRange.Text
    const box = slide.Shapes.AddTextbox(
      msoTextOrientationHorizontal,
      args.left != null ? Number(args.left) : PPT_SHAPE_DEFAULTS.left,
      args.top != null ? Number(args.top) : PPT_SHAPE_DEFAULTS.top,
      args.width != null ? Number(args.width) : PPT_SHAPE_DEFAULTS.width,
      args.height != null ? Number(args.height) : PPT_SHAPE_DEFAULTS.height
    )
    box.TextFrame.TextRange.Text = text
    const font = box.TextFrame.TextRange.Font
    if (args.fontSize != null) font.Size = Number(args.fontSize)
    if (args.bold != null) font.Bold = args.bold ? msoTrue : msoFalse
    if (args.color) font.Color.RGB = hexToComRgb(args.color)
    return { added: true, slideNumber }
  },

  async ppt_move_slide(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const toPosition = Math.floor(Number(args.toPosition))
    if (!Number.isFinite(toPosition) || toPosition < 1) throw new Error('toPosition 须为大于等于 1 的整数')
    const pres = activePresentation()
    const count = pres.Slides.Count
    if (slideNumber > count) {
      throw new Error(`slideNumber ${slideNumber} 越界：演示文稿共 ${count} 页（页码从 1 开始）`)
    }
    const to = Math.max(1, Math.min(toPosition, count))
    pres.Slides.Item(slideNumber).MoveTo(to)
    return { moved: true, from: slideNumber, to }
  },

  async ppt_add_shape(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const key = String(args.shapeType || '').trim().toLowerCase()
    const shapeTypeValue = WPS_SHAPE_TYPES[key]
    if (!shapeTypeValue) {
      throw new Error(`shapeType 值非法：${args.shapeType}（合法值：${Object.keys(WPS_SHAPE_TYPES).join('/')}）`)
    }
    const pres = activePresentation()
    const slide = getSlideOrThrow(pres, slideNumber)
    const shape = slide.Shapes.AddShape(
      shapeTypeValue,
      args.left != null ? Number(args.left) : PPT_SHAPE_DEFAULTS.left,
      args.top != null ? Number(args.top) : PPT_SHAPE_DEFAULTS.top,
      args.width != null ? Number(args.width) : 200,
      args.height != null ? Number(args.height) : 150
    )
    if (args.fillColor) {
      shape.Fill.Solid() // 新形状默认主题填充，设纯色前先定填充类型
      shape.Fill.ForeColor.RGB = hexToComRgb(args.fillColor)
    }
    return { added: true, slideNumber, shapeType: key }
  },

  async ppt_get_slide_details(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const pres = activePresentation()
    const slide = getSlideOrThrow(pres, slideNumber)
    const shapes = slide.Shapes
    const result = []
    for (let j = 1; j <= shapes.Count; j++) {
      const sp = shapes.Item(j)
      const type = Number(sp.Type)
      result.push({
        name: String(sp.Name || ''),
        id: String(sp.Id), // WPS 的 Id 是数值，统一 String 化保 shapeId 契约类型
        type: MSO_SHAPE_TYPE_NAMES[type] || `unknown(${type})`,
        left: sp.Left,
        top: sp.Top,
        width: sp.Width,
        height: sp.Height,
        text: shapeHasText(sp) ? shapeText(sp) : '',
        textLength: shapeHasText(sp) ? shapeText(sp).length : 0,
        textTruncated: false
      })
    }
    return { slideNumber, shapeCount: result.length, shapes: result }
  },

  async ppt_goto(args) {
    const { slideNumber } = pptTarget(args, false)
    const pres = activePresentation()
    getSlideOrThrow(pres, slideNumber)
    const shape = args.shapeId != null ? wpsPptShape(pres, args) : null
    app().ActiveWindow.View.GotoSlide(slideNumber)
    if (shape) shape.Select()
    return { slideNumber, shapeId: args.shapeId == null ? null : String(args.shapeId) }
  },

  async ppt_set_layout(args) {
    const { slideNumber } = pptTarget(args, false)
    if (args.layoutId == null && args.backgroundColor == null) throw new Error(t('pptInvalidArguments'))
    const color = args.backgroundColor == null ? null : hexToComRgb(args.backgroundColor)
    const slide = getSlideOrThrow(activePresentation(), slideNumber)
    let layout
    if (args.layoutId != null) {
      const layouts = slide.Design.SlideMaster.CustomLayouts
      for (let i = 1; i <= layouts.Count; i++) {
        const candidate = layouts.Item(i)
        if (String(candidate.Index) === String(args.layoutId)) layout = candidate
      }
      if (!layout) throw new Error(t('pptInvalidTarget'))
    }
    if (layout) slide.CustomLayout = layout
    if (color != null) { slide.FollowMasterBackground = msoFalse; slide.Background.Fill.Solid(); slide.Background.Fill.ForeColor.RGB = color }
    return { slideNumber, layoutId: args.layoutId, backgroundColor: args.backgroundColor }
  },

  async ppt_set_shape_text(args) {
    if (args.text == null) throw new Error(t('pptInvalidArguments'))
    const shape = wpsPptShape(activePresentation(), args)
    if (!shape.HasTextFrame) throw new Error(t('officeTargetTextFrameMissing'))
    const range = shape.TextFrame.TextRange
    pptExpected(String(range.Text || ''), args)
    range.Text = String(args.text)
    return { slideNumber: Number(args.slideNumber), shapeId: String(args.shapeId), text: String(range.Text || '') }
  },

  async ppt_set_shape_geometry(args) {
    const geometry = pptGeometry(args)
    const shape = wpsPptShape(activePresentation(), args)
    const before = {}, after = {}
    for (const key of Object.keys(geometry)) before[key] = shape[key[0].toUpperCase() + key.slice(1)]
    for (const key of Object.keys(geometry)) shape[key[0].toUpperCase() + key.slice(1)] = geometry[key]
    for (const key of Object.keys(geometry)) after[key] = shape[key[0].toUpperCase() + key.slice(1)]
    return { slideNumber: Number(args.slideNumber), shapeId: String(args.shapeId), before, after }
  },

  async ppt_format_shape(args) {
    const style = pptShapeStyle(args)
    const shape = wpsPptShape(activePresentation(), args)
    if (style.noFill === true) shape.Fill.Visible = msoFalse
    else if (style.fillColor) { shape.Fill.Visible = msoTrue; shape.Fill.Solid(); shape.Fill.ForeColor.RGB = hexToComRgb(style.fillColor) }
    if (style.transparency != null) shape.Fill.Transparency = style.transparency / 100
    if (style.noLine != null) shape.Line.Visible = style.noLine ? msoFalse : msoTrue
    if (style.lineColor) shape.Line.ForeColor.RGB = hexToComRgb(style.lineColor)
    if (style.lineWidth != null) shape.Line.Weight = style.lineWidth
    return { slideNumber: Number(args.slideNumber), shapeId: String(args.shapeId), applied: style }
  },

  async ppt_delete_shape(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const shapeId = args.shapeId ? String(args.shapeId) : ''
    const textMatch = args.textMatch ? String(args.textMatch) : ''
    if (!shapeId && !textMatch) throw new Error('shapeId 与 textMatch 须至少给一个')
    const pres = activePresentation()
    const slide = getSlideOrThrow(pres, slideNumber)
    const shapes = slide.Shapes
    const wanted = normalizeBreaks(textMatch) // 段落符 \r/\n 归一后再全等比较
    let target = null
    for (let j = 1; j <= shapes.Count; j++) {
      const sp = shapes.Item(j)
      if (shapeId) {
        if (String(sp.Id) === shapeId) { target = sp; break }
      } else if (shapeHasText(sp) && normalizeBreaks(shapeText(sp)) === wanted) {
        target = sp
        break
      }
    }
    if (!target) {
      throw new Error(shapeId
        ? `未找到 id 为 ${shapeId} 的形状（可先用 ppt_get_slide_details 核对）`
        : '未找到文字内容与 textMatch 精确一致的形状（可先用 ppt_get_slide_details 核对）')
    }
    const deletedId = String(target.Id)
    target.Delete()
    return { deleted: true, slideNumber, shapeId: deletedId }
  },

  async ppt_read_notes(args = {}) {
    const pres = activePresentation()
    const first = args.slideNumber == null ? 1 : pptTarget(args, false).slideNumber
    if (first > pres.Slides.Count) throw new Error(t('pptInvalidTarget'))
    const last = args.slideNumber == null ? pres.Slides.Count : first
    const notes = []
    for (let i = first; i <= last; i++) {
      const text = String(wpsNotesBody(pres.Slides.Item(i)).Text || '')
      notes.push({ slideNumber: i, text, textLength: text.length, textTruncated: false })
    }
    return { notes }
  },

  async ppt_write_notes(args) {
    const { slideNumber } = pptTarget(args, false)
    if (args.text == null) throw new Error(t('pptInvalidArguments'))
    const pres = activePresentation()
    if (slideNumber > pres.Slides.Count) throw new Error(t('pptInvalidTarget'))
    const range = wpsNotesBody(pres.Slides.Item(slideNumber)), previousText = String(range.Text || '')
    pptExpected(previousText, args)
    range.Text = String(args.text)
    return { slideNumber, previousText, text: String(range.Text || ''), updated: true }
  },

  async ppt_table_set_style(args) {
    const target = pptTarget(args), shape = wpsPptShape(activePresentation(), args)
    if (!shapeIsTable(shape)) throw new Error(t('pptInvalidTarget'))
    const table = shape.Table, rows = table.Rows.Count, cols = table.Columns.Count
    const { row, col, endRow, endCol, style: s } = pptTableStyle(args, rows, cols)
    // Resolve every requested target before mutating any of them.
    const actions = []
    const applyCell = (r, c, format) => {
      const cell = table.Cell(r + 1, c + 1), cellShape = cell.Shape
      if (format.fillColor != null) {
        const fill = cellShape.Fill
        if (!fill || typeof fill.Solid !== 'function') throw new Error(t('pptCapabilityUnavailable'))
        actions.push(() => { if (format.fillColor === 'none') fill.Visible = msoFalse; else { fill.Solid(); fill.Visible = msoTrue; fill.ForeColor.RGB = hexToComRgb(format.fillColor) } })
      }
      if (['fontName', 'fontSize', 'bold', 'color', 'alignment'].some(k => format[k] != null)) {
        const range = cellShape.TextFrame.TextRange, font = range.Font
        actions.push(() => {
          if (format.fontName != null) { font.Name = format.fontName; font.NameFarEast = format.fontName }
          if (format.fontSize != null) font.Size = format.fontSize
          if (format.bold != null) font.Bold = format.bold ? msoTrue : msoFalse
          if (format.color != null) font.Color.RGB = hexToComRgb(format.color)
          if (format.alignment != null) range.ParagraphFormat.Alignment = { left: 1, center: 2, right: 3, justify: 4 }[format.alignment]
        })
      }
      if (format.borderColor != null || format.borderWidthPt != null) {
        const borders = [1, 2, 3, 4].map(index => cell.Borders.Item(index))
        actions.push(() => { for (const border of borders) { border.Visible = format.borderWidthPt === 0 ? msoFalse : msoTrue; if (format.borderColor != null) border.ForeColor.RGB = hexToComRgb(format.borderColor); if (format.borderWidthPt != null) border.Weight = format.borderWidthPt } })
      }
    }
    for (let r = row; r <= endRow; r++) for (let c = col; c <= endCol; c++) applyCell(r, c, s)
    if (s.headerBold != null || s.headerFill != null) for (let c = 0; c < cols; c++) applyCell(0, c, { bold: s.headerBold, fillColor: s.headerFill })
    if (s.columnWidthsPt) s.columnWidthsPt.forEach((width, i) => { const column = table.Columns.Item(i + 1); actions.push(() => { column.Width = width }) })
    if (s.rowHeightsPt) s.rowHeightsPt.forEach((height, i) => { const row = table.Rows.Item(i + 1); actions.push(() => { row.Height = height }) })
    let operationsApplied = 0
    try {
    for (const action of actions) { action(); operationsApplied++ }
    return { ...target, updated: true, row, col, endRow, endCol, operationsApplied,
      ...(s.rowHeightsPt ? { rowHeightsPt: s.rowHeightsPt.map((_, i) => table.Rows.Item(i + 1).Height) } : {}),
      ...(s.columnWidthsPt ? { columnWidthsPt: s.columnWidthsPt.map((_, i) => table.Columns.Item(i + 1).Width) } : {}) }
    } catch (error) { error.partialResult = { ...target, operationsApplied, outcomeUnknown: true, retryable: false }; throw error }
  },

  async ppt_add_table(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const rows = Array.isArray(args.rows) ? args.rows : null
    const rowCount = rows ? rows.length : Math.floor(Number(args.rowCount))
    const colCount = rows ? (rows[0] ? rows[0].length : 0) : Math.floor(Number(args.colCount))
    if (!rowCount || rowCount < 1 || !colCount || colCount < 1) throw new Error('表格行列数非法')
    const pres = activePresentation()
    const slide = getSlideOrThrow(pres, slideNumber)
    const shape = slide.Shapes.AddTable(rowCount, colCount)
    if (args.left != null) shape.Left = Number(args.left)
    if (args.top != null) shape.Top = Number(args.top)
    if (args.width != null) shape.Width = Number(args.width)
    if (args.height != null) shape.Height = Number(args.height)
    if (rows) {
      const table = shape.Table
      for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < colCount; c++) {
          // 单元格写入链中间的 .Shape 别漏；Cell 的行列是 1 基
          table.Cell(r + 1, c + 1).Shape.TextFrame.TextRange.Text =
            String(rows[r] && rows[r][c] != null ? rows[r][c] : '')
        }
      }
    }
    return { added: true, slideNumber, rows: rowCount, cols: colCount }
  },

  async ppt_table_read(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const pres = activePresentation()
    const slide = getSlideOrThrow(pres, slideNumber)
    const table = findTableShape(slide, args.shapeId).Table
    const rowCount = table.Rows.Count
    const colCount = table.Columns.Count
    // WPS 没有批量 values 读法，只能逐格取（每格一次 RPC，大表会有可感延迟）
    const cells = []
    for (let r = 1; r <= rowCount; r++) {
      const row = []
      for (let c = 1; c <= colCount; c++) row.push(readCellText(table, r, c))
      cells.push(row)
    }
    return { slideNumber, rowCount, colCount, cells }
  },

  async ppt_table_set_cell(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const row = Math.floor(Number(args.row))
    const col = Math.floor(Number(args.col))
    if (!Number.isFinite(row) || row < 0) throw new Error('row 不能为负')
    if (!Number.isFinite(col) || col < 0) throw new Error('col 不能为负')
    const text = args.text == null ? '' : String(args.text)
    const pres = activePresentation()
    const slide = getSlideOrThrow(pres, slideNumber)
    const table = findTableShape(slide, args.shapeId).Table
    // 契约的 row/col 是 0 基，WPS Cell 是 1 基；越界用行列数前置检查保住中文报错文案
    if (row + 1 > table.Rows.Count || col + 1 > table.Columns.Count) {
      throw new Error(`单元格 (${row},${col}) 不存在，请先用 office_ppt_table_read 核对`)
    }
    table.Cell(row + 1, col + 1).Shape.TextFrame.TextRange.Text = text
    return { slideNumber, row, col, updated: true }
  },

  async ppt_set_hyperlink(args) {
    const slideNumber = toSlideNumber(args.slideNumber)
    const searchText = String(args.searchText || '')
    const url = String(args.url || '')
    if (!searchText) throw new Error('查找文本不能为空')
    if (!url) throw new Error('url 不能为空')
    const pres = activePresentation()
    const slide = getSlideOrThrow(pres, slideNumber)
    const shapes = slide.Shapes
    for (let j = 1; j <= shapes.Count; j++) {
      const sp = shapes.Item(j)
      if (!shapeHasText(sp)) continue
      const text = shapeText(sp)
      const hit = findAllNormalized(text, searchText)[0]
      if (!hit) continue
      const whole = sp.TextFrame.TextRange
      try {
        // 首选：Characters 切出的精确子串挂链（VBA 类推路线，真机可能不支持）
        applyHyperlink(whole.Characters(hit.start + 1, hit.end - hit.start), url)
        return { slideNumber, linked: true, url }
      } catch (e) {
        // 降级：整个文本框文字挂链，并在返回值交底
        applyHyperlink(whole, url)
        return {
          slideNumber,
          linked: true,
          url,
          note: '子串挂链在当前 WPS 版本不可用，已降级为对整个文本框文字设置超链接'
        }
      }
    }
    throw new Error('未找到目标文本，请确认 searchText 与幻灯片文本精确一致（可先用 office_ppt_get_slides 核对）')
  },

  // ==================== 供其他窗格引用（dev-board#717） ====================

  /**
   * 别的窗格经云端下发：按 locator 读本演示稿，返回 {text}（契约同 officeExecutor）。
   * 不带定位读全部幻灯片（与随消息附带的正文同口径）；slide:N 只取第 N 页，
   * 表格单元格与组合子形状里的文字一并收（textBearingShapes，与 ppt_get_slides 同口径）。
   */
  async read_for_reference(args) {
    const loc = parseLocator(args.locator)
    if (loc.kind === 'none') return capReferenceText(readWppSlides().text)
    if (loc.kind !== 'slide') throw unsupportedLocatorError('powerpoint', loc.kind)
    const pres = activePresentation()
    const count = Number(pres.Slides.Count) || 0
    if (loc.n > count) throw new Error(`演示稿只有 ${count} 页`)
    const texts = []
    for (const { shape } of textBearingShapes(pres.Slides.Item(loc.n).Shapes)) {
      const t = shapeText(shape).trim()
      if (t) texts.push(t)
    }
    return capReferenceText(texts.length ? texts.join('\n') : blankPageText(loc.n))
  }
}

// ==================== 跨文档写入的改前值与撤销（dev-board#717） ====================

/**
 * 与 officeExecutor.captureOfficeState 同契约、同快照形态：
 *   pptCell    target {kind, slideNumber, shapeId, row, col}   state = target + text
 *   pptFrames  target {kind, frames:[{slide, frame}]}          state {kind, frames:[{slide, frame, text}]}
 * frame 是 textBearingShapes 列表里的下标（与 ppt_replace_text 遍历同一张表，含表格单元格与组合子形状）。
 * 位置式定位：结构变过之后文字对不上改后值，撤销按冲突拒绝。
 * 其余命令（格式、加删页/形状/表格、挂链）返回 null——写回文字撤不掉它们，不给假撤销。
 */
export function captureWppState(command, args, limits) {
  const a = args || {}
  if (command === 'ppt_table_set_cell') {
    const slideNumber = Math.floor(Number(a.slideNumber))
    const row = Math.floor(Number(a.row))
    const col = Math.floor(Number(a.col))
    if (!(slideNumber >= 1) || !(row >= 0) || !(col >= 0)) return null
    const target = { kind: 'pptCell', slideNumber, shapeId: a.shapeId == null ? '' : String(a.shapeId), row, col }
    const state = readWppState(target)
    return state ? { target, before: state } : null
  }
  if (command === 'ppt_replace_text') {
    const searchText = String(a.searchText || '')
    if (!searchText) return null
    const pres = activePresentation()
    const slideCount = pres.Slides.Count
    const hits = []
    let chars = 0
    for (let i = 1; i <= slideCount; i++) {
      textBearingShapes(pres.Slides.Item(i).Shapes).forEach(({ shape }, j) => {
        const text = shapeText(shape)
        if (!findAllNormalized(text, searchText).length) return
        hits.push({ slide: i, frame: j, text })
        chars += text.length
      })
    }
    const maxChars = limits && Number.isFinite(limits.maxChars) ? limits.maxChars : Infinity
    if (!hits.length || chars > maxChars) return null
    const target = { kind: 'pptFrames', frames: hits.map(({ slide, frame }) => ({ slide, frame })) }
    return { target, before: { kind: 'pptFrames', frames: hits } }
  }
  return null
}

function cellTableOf(t) {
  const table = findTableShape(getSlideOrThrow(activePresentation(), t.slideNumber), t.shapeId).Table
  if (t.row + 1 > table.Rows.Count || t.col + 1 > table.Columns.Count) return null
  return table
}

function frameShapeOf(pres, f) {
  if (f.slide > pres.Slides.Count) return null
  const entry = textBearingShapes(pres.Slides.Item(f.slide).Shapes)[f.frame]
  return entry ? entry.shape : null
}

/** 按 target 读当前值；目标已不存在时回 null（撤销按冲突处理） */
export function readWppState(target) {
  const t = target || {}
  try {
    if (t.kind === 'pptCell') {
      const table = cellTableOf(t)
      return table ? { ...t, text: readCellText(table, t.row + 1, t.col + 1) } : null
    }
    if (t.kind === 'pptFrames') {
      const pres = activePresentation()
      const frames = []
      for (const f of t.frames || []) {
        const shape = frameShapeOf(pres, f)
        if (!shape) return null
        frames.push({ slide: f.slide, frame: f.frame, text: shapeText(shape) })
      }
      return { kind: 'pptFrames', frames }
    }
  } catch (e) {
    return null
  }
  return null
}

/**
 * 写回快照（撤销）。文本框只改差异段：Characters(start, len) 是 1 基、与 JS 下标对齐
 * （真机实测，见 ppt_replace_text 的说明），从右到左落笔；不整框回写，保住框内格式与超链接。
 */
export function writeWppState(state) {
  const s = state || {}
  if (s.kind === 'pptCell') {
    const table = cellTableOf(s)
    if (!table) throw new Error('目标单元格已不存在')
    table.Cell(s.row + 1, s.col + 1).Shape.TextFrame.TextRange.Text = s.text
    return
  }
  if (s.kind === 'pptFrames') {
    const pres = activePresentation()
    for (const f of s.frames || []) {
      const shape = frameShapeOf(pres, f)
      if (!shape) throw new Error('目标文本框已不存在')
      const range = shape.TextFrame.TextRange
      const current = String(range.Text || '')
      if (current === f.text) continue
      if (!current.length) {
        range.Text = f.text
        continue
      }
      const edits = substringEdits(current, f.text)
      for (let k = edits.length - 1; k >= 0; k--) {
        const e = edits[k]
        // 每段都从完整 TextRange 重新切（与 ppt_replace_text 同一条纪律）：旧 TextRange 在
        // 文字长度变化后是否跟着伸缩未经验证，从右到左落笔保证左边的偏移不受影响
        shape.TextFrame.TextRange.Characters(e.start + 1, e.end - e.start).Text = e.newText
      }
    }
    return
  }
  throw new Error('无法识别的修订快照，撤销未执行')
}

/** 位置式快照 target 对应的页码（1 基）；不是 PPT 目标或页码不成立回 0 */
function slideNumberOfTarget(target) {
  const t = target || {}
  if (t.kind === 'pptSlide' || t.kind === 'pptCell') {
    const n = Math.floor(Number(t.slideNumber))
    return n >= 1 ? n : 0
  }
  if (t.kind === 'pptFrames') {
    const first = Array.isArray(t.frames) ? t.frames[0] : null
    const n = first ? Math.floor(Number(first.slide)) : 0
    return n >= 1 ? n : 0
  }
  return 0
}

/**
 * 修订记录的「定位」（dev-board#717）：跳到目标页。Slides.Item(n).Select() 在普通视图之外
 * 可能抛（VBA 语义如此，**WPS 真机未验证**），退到 ActiveWindow.View.GotoSlide(n)。
 * 两条路都不行就回 {found:false}——定位不到只是轻提示，不是错误，永不 throw。
 */
export function locateWppTarget(target) {
  const n = slideNumberOfTarget(target)
  if (!n) return { found: false }
  let pres
  try {
    pres = activePresentation()
    if (n > pres.Slides.Count) return { found: false }
  } catch (e) {
    return { found: false }
  }
  try {
    pres.Slides.Item(n).Select()
    return { found: true }
  } catch (e) { /* 普通视图外不能 Select，退到 GotoSlide */ }
  try {
    app().ActiveWindow.View.GotoSlide(n)
    return { found: true }
  } catch (e) {
    return { found: false }
  }
}
