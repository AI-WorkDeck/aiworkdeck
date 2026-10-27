// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// zetaOfficeBoot.js — framework-agnostic ZetaOffice (LibreOffice WASM) boot core.
//
// Epic #43. Extracted verbatim (parameterized) from the proven Phase 0 spike
// boot sequence (experiments/zetaoffice-spike/index.html). Plain ES module (NO
// Vue) so BOTH the spike harness (loaded via the dev server's /shared/ route,
// driving product code against a real LibreOffice) AND the app's editor
// component import the SAME boot code. This is the heart of "embed ZetaOffice in
// the app": it sets up the emscripten Module, loads the LOWA runtime, injects
// CJK fonts before fontconfig's startup scan, and resolves the office-worker
// thread port that useEditorBridge.connectLibreOffice(port) / the executor
// client connect to.
//
// Environment-specific values are parameters, NOT hardcoded, so the spike passes
// CDN + local paths and the product passes self-hosted-bundle paths:
//   - sofficeBaseUrl : where soffice.{js,wasm,data} live (CDN for the spike;
//                      a self-hosted bundle inside the installer for the product)
//   - zetaJsUrl      : the zetajs bridge — NOT on the CDN, must be vendored
//                      (allotropia/zetajs source/zeta.js, MIT). Loading it from
//                      the CDN fails with a worker importScripts NetworkError.
//   - workerScriptUrl: the office worker (office_thread.js) injected into the
//                      LO office thread via Module.uno_scripts.
//   - fontUrl        : optional CJK font fetched same-origin and written into the
//                      LOWA font dir in preRun (the product bakes Noto/思源 CJK
//                      OFL into the self-hosted bundle's font dir at build time).
//
// COOP/COEP: the page MUST be cross-origin isolated (SharedArrayBuffer). That
// comes ONLY from HTTP response headers (spike: serve.mjs; product Electron:
// session.webRequest.onHeadersReceived on a dedicated partition). boot() throws
// early with a clear message if it is not.

const DEFAULT_SOFFICE_BASE_URL = 'https://cdn.zetaoffice.net/zetaoffice_latest/'

// fontconfig 比较族名时忽略大小写与空白（FcStrCmpIgnoreBlanksAndCase），跳过判定同口径
const normFamily = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

/**
 * 本机字体注入 MEMFS 的文件名：不同目录可能有同名文件，带序号保证唯一；只留
 * 安全字符（扩展名保留，FreeType 按内容识别但留着便于诊断）。
 * @param {number} index fontList 里的序号
 * @param {string} name 原文件名
 */
export function systemFontFileName(index, name) {
  const safe = String(name || 'font').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'font'
  return 'SYS-' + index + '-' + safe
}

/**
 * CJK font-name aliases (fontconfig conf.d).
 *
 * Real-world docx name 宋体/黑体/微软雅黑/仿宋/楷体/…; those are proprietary
 * (can't ship) and the WASM build does NO glyph fallback — every missing
 * family renders tofu even when an injected font has the glyphs (real-
 * machine verified: the same text renders once CharFontName names an
 * existing family). Map each proprietary family onto the bundled open font
 * of the SAME typeface category. Rules are `assign` (hard replace) to the
 * first category font that ACTUALLY fetched this boot — weak `append`
 * chains were real-machine tested and LOST to generic matching (every
 * category rendered sans), so the fallback logic lives HERE, not in
 * fontconfig scoring.
 *
 * 用户启用的本机字体（systemFamilies：本次真正取到的族名）若正好就是某条规则的
 * 源族名（真的 宋体/仿宋_GB2312），该规则必须跳过——否则 assign 会把真字体劫持到
 * 随包 Noto 上。
 *
 * @param {Record<string,string>} availableByCategory category -> registered family
 * @param {Iterable<string>} [systemFamilies]
 * @returns {{conf:string, familyCount:number, skipped:number, targets:string[]}|null}
 */
export function buildCjkAliasConf(availableByCategory, systemFamilies) {
  const avail = availableByCategory || {}
  const real = new Set()
  for (const f of systemFamilies || []) real.add(normFamily(f))
  const pickFamily = (...cats) => { for (const c of cats) { if (avail[c]) return avail[c] } return null }
  const uniq = (list) => {
    const out = []
    for (const f of list) {
      if (f && !out.includes(f)) out.push(f)
    }
    return out
  }
  // 跨语种多字体回退链（dev-board#1478）：
  // 1) SubsetOTF/SC (Noto Sans SC / Noto Serif SC) 与朱雀仿宋均含 0 个韩文音节（Hangul），
  //    且朱雀仿宋仅覆盖 11,009 / 20,992 个 CJK 汉字（缺大量日文汉字与繁体字）；
  // 2) setCharProp 会同时写入 CharFontName / CharFontNameAsian / CharFontNameComplex，
  //    当用户选中一段混排文字设「仿宋」或「黑体」时，若 assign 只给单一目标族名，
  //    fontconfig 会抹掉原有的回退链，导致该字体缺失的韩文/日文/泰文/东南亚/CTL 字符直接变方框（□/☒）。
  // 因此每条 assign 规则在主目标之后按同风格（无衬线/衬线）挂接跨语种回退族，
  // 同时为 sans-serif / serif / monospace 注入 <alias><prefer> 全局兜底链。
  const ctlTail = uniq([
    avail.thai, avail['thai-serif'],
    avail.khmer, avail.lao, avail.myanmar, avail.arabic, avail.devanagari,
  ])
  const sansFallback = uniq([avail.sans, avail.kr, avail.kai, ...ctlTail, avail.serif, avail['kr-serif']])
  const serifFallback = uniq([avail.serif, avail['kr-serif'], avail.sans, avail.kr, avail.kai, avail['thai-serif'], ...ctlTail])
  const CJK_ALIAS_GROUPS = [
    // 黑体类（中文/日文无衬线）
    { target: pickFamily('sans'), fallbacks: sansFallback, families: [
      '黑体', 'SimHei', '黑体-简', 'Heiti SC', '黑体-繁', 'Heiti TC',
      '华文黑体', 'STHeiti', '华文细黑', 'STXihei',
      '微软雅黑', 'Microsoft YaHei', 'Microsoft YaHei UI',
      '微软正黑体', 'Microsoft JhengHei', 'Microsoft JhengHei UI',
      '苹方-简', 'PingFang SC', '苹方-繁', 'PingFang TC', '苹方-港', 'PingFang HK',
      '等线', 'DengXian', '等线 Light', 'DengXian Light',
      '思源黑体', 'Source Han Sans SC', 'Source Han Sans CN', 'Source Han Sans TC', 'Source Han Sans HC',
      'Noto Sans CJK SC', 'Noto Sans CJK TC', 'Noto Sans CJK HK', 'Noto Sans TC', 'Noto Sans HK',
      '方正黑体_GBK', 'FZHei-B01', 'FZLTHJW', 'MiSans', 'HarmonyOS Sans SC',
      // 日文无衬线（Gothic / ゴシック / メイリオ）：Noto Sans SC 已完整覆盖平假名、片假名与日文汉字
      'MS Gothic', 'ＭＳ ゴシック', 'MS PGothic', 'ＭＳ Ｐゴシック', 'MS UI Gothic',
      'Yu Gothic', '游ゴシック', 'Yu Gothic UI', 'YuGothic',
      'Meiryo', 'メイリオ', 'Meiryo UI',
      'Hiragino Sans', 'ヒラギノ角ゴ ProN', 'Hiragino Kaku Gothic ProN', 'Hiragino Kaku Gothic Pro',
      'Source Han Sans JP', 'Source Han Sans', 'Noto Sans CJK JP', 'Noto Sans JP',
      'BIZ UDGothic', 'BIZ UDPGothic', 'IPAexGothic', 'IPAGothic', 'VL Gothic',
    ] },
    // 宋体/明朝类（中文/日文衬线）
    { target: pickFamily('serif', 'sans'), fallbacks: serifFallback, families: [
      '宋体', 'SimSun', '新宋体', 'NSimSun', '宋体-简', 'Songti SC', '宋体-繁', 'Songti TC',
      '华文宋体', 'STSong', '华文中宋', 'STZhongsong',
      '方正小标宋简体', 'FZXiaoBiaoSong-B05S', '方正小标宋_GBK', 'FZXiaoBiaoSong-B05', '方正书宋简体', 'FZShuSong-Z01S',
      '新細明體', 'PMingLiU', '細明體', 'MingLiU', 'MingLiU_HKSCS',
      '思源宋体', 'Source Han Serif SC', 'Source Han Serif CN', 'Source Han Serif TC',
      'Noto Serif CJK SC', 'Noto Serif CJK TC', 'Noto Serif TC',
      // 日文衬线（Mincho / 明朝）
      'MS Mincho', 'ＭＳ 明朝', 'MS PMincho', 'ＭＳ Ｐ明朝',
      'Yu Mincho', '游明朝', 'YuMincho',
      'Hiragino Mincho ProN', 'ヒラギノ明朝 ProN', 'Hiragino Mincho Pro',
      'Source Han Serif JP', 'Source Han Serif', 'Noto Serif CJK JP', 'Noto Serif JP',
      'BIZ UDMincho', 'BIZ UDPMincho', 'IPAexMincho', 'IPAMincho',
    ] },
    // 楷体类
    { target: pickFamily('kai', 'serif', 'sans'), fallbacks: uniq([avail.kai, ...serifFallback]), families: [
      '楷体', 'KaiTi', '楷体_GB2312', 'KaiTi_GB2312', '楷体-简', 'Kaiti SC', '楷体-繁', 'Kaiti TC',
      '华文楷体', 'STKaiti', '方正楷体_GBK', 'FZKai-Z03', '方正楷体简体',
      '标楷体', '標楷體', 'DFKai-SB', 'BiauKai', 'LXGW WenKai',
    ] },
    // 仿宋类（公文常用）
    { target: pickFamily('fangsong', 'serif', 'sans'), fallbacks: uniq([avail.fangsong, ...serifFallback]), families: [
      '仿宋', 'FangSong', '仿宋_GB2312', 'FangSong_GB2312', '仿宋-简', 'Fangsong SC',
      '华文仿宋', 'STFangsong', '方正仿宋_GBK', 'FZFangSong-Z02', '方正仿宋简体',
      'Zhuque Fangsong',
    ] },
    // 韩文无衬线类（Gothic / 돋움 / 굴림 / 맑은 고딕）
    { target: pickFamily('kr', 'kai', 'sans'), fallbacks: uniq([avail.kr, avail.sans, avail.kai, ...ctlTail]), hasCategory: Boolean(avail.kr || avail.kai || avail.sans), families: [
      'Malgun Gothic', '맑은 고딕',
      'Dotum', '돋움', 'DotumChe', '돋움체',
      'Gulim', '굴림', 'GulimChe', '굴림체',
      'Apple SD Gothic Neo', 'AppleGothic',
      'NanumGothic', '나눔고딕', 'NanumBarunGothic', '나눔바른고딕',
      'Source Han Sans KR', 'Source Han Sans K', 'Noto Sans CJK KR', 'Noto Sans KR',
      'UnDotum', 'Baekmuk Gulim', 'Baekmuk Dotum',
    ] },
    // 韩文衬线类（Batang / 바탕 / 명조 / 궁서）
    { target: pickFamily('kr-serif', 'kr', 'kai', 'serif', 'sans'), fallbacks: uniq([avail['kr-serif'], avail.serif, avail.kr, avail.sans, avail.kai, ...ctlTail]), hasCategory: Boolean(avail['kr-serif'] || avail.kr || avail.kai || avail.serif || avail.sans), families: [
      'Batang', '바탕', 'BatangChe', '바탕체',
      'Gungsuh', '궁서', 'GungsuhChe', '궁서체',
      'AppleMyungjo', 'NanumMyeongjo', '나눔명조',
      'Source Han Serif KR', 'Source Han Serif K', 'Noto Serif CJK KR', 'Noto Serif KR',
      'UnBatang', 'Baekmuk Batang',
    ] },
    // 泰语及东南亚/CTL 无衬线类（含 LibreOffice 默认 CTL_TEXT: Tahoma / Lucida Sans / Arial Unicode MS）
    { target: pickFamily('thai', 'sans'), fallbacks: uniq(['Liberation Sans', avail.thai, ...ctlTail, avail.sans, avail.kr, avail.kai]), hasCategory: Boolean(avail.thai), families: [
      'Noto Sans Thai', 'Leelawadee UI', 'Leelawadee', 'Thonburi',
      'Sukhumvit Set', 'Ayuthaya', 'Krungthep', 'Silom', 'Sathu',
      'Waree', 'Loma', 'Umpush', 'Sawasdee', 'Garuda',
      'Tahoma', 'Lucida Sans Unicode', 'Lucida Sans', 'Lucidasans', 'Arial Unicode MS',
    ] },
    // 泰语传统文档字体（泰国官方法律/合同标准字体 TH Sarabun / Angsana / Cordia / Browallia）
    { target: pickFamily('thai-serif', 'thai', 'serif', 'sans'), fallbacks: uniq(['Liberation Serif', avail['thai-serif'], avail.thai, ...ctlTail, avail.serif, avail.sans, avail['kr-serif'], avail.kr, avail.kai]), hasCategory: Boolean(avail['thai-serif'] || avail.thai), families: [
      'Noto Serif Thai',
      'TH SarabunPSK', 'TH Sarabun New', 'Sarabun',
      'Angsana New', 'AngsanaUPC', 'Cordia New', 'CordiaUPC',
      'Browallia New', 'BrowalliaUPC', 'DilleniaUPC', 'EucrosiaUPC', 'FreesiaUPC', 'IrisUPC', 'JasmineUPC', 'KodchiangUPC', 'LilyUPC',
      'Kinnari', 'Norasi',
    ] },
    // 东南亚与世界 CTL 脚本常见文档字体（高棉语 Khmer / 老挝语 Lao / 缅甸语 Myanmar / 阿拉伯语 Arabic / 天城文 Devanagari）
    { target: pickFamily('khmer', 'thai', 'sans'), fallbacks: uniq([avail.khmer, ...ctlTail, avail.sans]), hasCategory: Boolean(avail.khmer), families: [
      'Noto Sans Khmer', 'Khmer OS', 'Khmer OS System', 'Khmer OS Battambang', 'Khmer OS Siemreap', 'Khmer OS Muol Light', 'Leelawadee UI Khmer', 'DaunPenh', 'MoolBoran', 'Khmer MN', 'Khmer Sangam MN',
    ] },
    { target: pickFamily('lao', 'thai', 'sans'), fallbacks: uniq([avail.lao, ...ctlTail, avail.sans]), hasCategory: Boolean(avail.lao), families: [
      'Noto Sans Lao', 'Phetsarath OT', 'Saysettha OT', 'DokChampa', 'Lao UI', 'Lao MN', 'Lao Sangam MN',
    ] },
    { target: pickFamily('myanmar', 'thai', 'sans'), fallbacks: uniq([avail.myanmar, ...ctlTail, avail.sans]), hasCategory: Boolean(avail.myanmar), families: [
      'Noto Sans Myanmar', 'Myanmar Text', 'Padauk', 'Pyidaungsu', 'Myanmar MN', 'Myanmar Sangam MN',
    ] },
    { target: pickFamily('arabic', 'thai', 'sans'), fallbacks: uniq([avail.arabic, ...ctlTail, avail.sans]), hasCategory: Boolean(avail.arabic), families: [
      'Noto Sans Arabic', 'Noto Naskh Arabic', 'Simplified Arabic', 'Traditional Arabic', 'Arabic Typesetting', 'Sakkal Majalla', 'Amiri', 'Scheherazade New', 'Geeza Pro', 'Damascus',
    ] },
    { target: pickFamily('devanagari', 'thai', 'sans'), fallbacks: uniq([avail.devanagari, ...ctlTail, avail.sans]), hasCategory: Boolean(avail.devanagari), families: [
      'Noto Sans Devanagari', 'Mangal', 'Nirmala UI', 'Aparajita', 'Kokila', 'Utsaah', 'Kohinoor Devanagari', 'Devanagari Sangam MN', 'Devanagari MT', 'Lohit Devanagari',
    ] },
  ].filter((g) => g.target && g.hasCategory !== false)
  if (!CJK_ALIAS_GROUPS.length) return null
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const rules = []
  let familyCount = 0, skipped = 0
  const seenSource = new Set()
  for (const g of CJK_ALIAS_GROUPS) {
    const chain = uniq([g.target, ...(g.fallbacks || [])])
    const editBody = chain.map((t) => '<string>' + esc(t) + '</string>').join('')
    for (const fam of g.families) {
      const norm = normFamily(fam)
      if (!norm || seenSource.has(norm)) continue
      if (real.has(norm)) { skipped++; seenSource.add(norm); continue }
      // 如果 fam 本身就是当前规则的唯一 target 且无需额外回退链，跳过自映射；
      // 但若回退链包含其它多语种字体（如朱雀仿宋/Noto Sans SC 需要挂韩语/泰语回退），
      // 即使是随包主字体族名也必须写入规则，保证用户显式选该字体输入外文时不掉字。
      if (fam === g.target && chain.length <= 1) continue
      seenSource.add(norm)
      familyCount++
      rules.push(
        '  <match target="pattern">\n' +
        '    <test qual="any" name="family"><string>' + esc(fam) + '</string></test>\n' +
        '    <edit name="family" mode="assign" binding="same">' + editBody + '</edit>\n' +
        '  </match>')
    }
  }
  // 随包主字体自身（如「朱雀仿宋（预览测试版）」「霞鹜文楷」「Noto Sans SC」「Noto Serif SC」）
  // 在工具栏下拉里以注册族名被选中时，同样为其补齐多语种回退链。
  const bundledSelfChains = [
    { fam: avail.sans, chain: sansFallback },
    { fam: avail.serif, chain: serifFallback },
    { fam: avail.kai, chain: uniq([avail.kai, ...serifFallback]) },
    { fam: avail.fangsong, chain: uniq([avail.fangsong, ...serifFallback]) },
    { fam: avail.kr, chain: uniq([avail.kr, ...sansFallback]) },
    { fam: avail['kr-serif'], chain: uniq([avail['kr-serif'], ...serifFallback]) },
    { fam: avail.thai, chain: uniq([avail.thai, ...sansFallback]) },
    { fam: avail['thai-serif'], chain: uniq([avail['thai-serif'], ...serifFallback]) },
  ]
  for (const { fam, chain } of bundledSelfChains) {
    if (!fam || chain.length <= 1) continue
    const norm = normFamily(fam)
    if (!norm || seenSource.has(norm) || real.has(norm)) continue
    seenSource.add(norm)
    const editBody = chain.map((t) => '<string>' + esc(t) + '</string>').join('')
    rules.push(
      '  <match target="pattern">\n' +
      '    <test qual="any" name="family"><string>' + esc(fam) + '</string></test>\n' +
      '    <edit name="family" mode="assign" binding="same">' + editBody + '</edit>\n' +
      '  </match>')
  }
  // 西文内置字体（Liberation Sans/Serif/Mono、Carlito、Caladea）与通用族名（sans-serif/serif/monospace）
  // 挂接多语种回退链：当文档显式指定西文字体或走默认西文/CTL 字体但混排输入中日韩泰越俄等文字时，
  // 西文字体自身覆盖拉丁扩展（英语/西语/德语/法语/越南语/印尼语等）、西里尔（俄语）、希腊语，
  // 缺失的 CJK/韩文/泰文/东南亚字符无缝落入随包多语种字体。
  const westernFallbacks = [
    { fam: 'Liberation Sans', chain: uniq(['Liberation Sans', ...sansFallback]) },
    { fam: 'Liberation Serif', chain: uniq(['Liberation Serif', ...serifFallback]) },
    { fam: 'Liberation Mono', chain: uniq(['Liberation Mono', ...sansFallback]) },
    { fam: 'Carlito', chain: uniq(['Carlito', 'Liberation Sans', ...sansFallback]) },
    { fam: 'Caladea', chain: uniq(['Caladea', 'Liberation Serif', ...serifFallback]) },
  ]
  for (const { fam, chain } of westernFallbacks) {
    if (chain.length <= 1 || real.has(normFamily(fam))) continue
    const editBody = chain.map((t) => '<string>' + esc(t) + '</string>').join('')
    rules.push(
      '  <match target="pattern">\n' +
      '    <test qual="any" name="family"><string>' + esc(fam) + '</string></test>\n' +
      '    <edit name="family" mode="assign" binding="same">' + editBody + '</edit>\n' +
      '  </match>')
  }
  const genericAliases = [
    { generic: 'sans-serif', prefer: uniq(['Liberation Sans', ...sansFallback]) },
    { generic: 'serif', prefer: uniq(['Liberation Serif', ...serifFallback]) },
    { generic: 'monospace', prefer: uniq(['Liberation Mono', ...sansFallback]) },
  ]
  for (const { generic, prefer } of genericAliases) {
    if (!prefer.length) continue
    const preferBody = prefer.map((t) => '    <family>' + esc(t) + '</family>\n').join('')
    rules.push(
      '  <alias>\n' +
      '    <family>' + esc(generic) + '</family>\n' +
      '    <prefer>\n' + preferBody + '    </prefer>\n' +
      '  </alias>')
  }
  if (!rules.length) return null
  const coreTargets = CJK_ALIAS_GROUPS.slice(0, 4).map((g) => g.target).filter(Boolean)
  const conf = '<?xml version="1.0"?>\n' +
    '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n' +
    '<fontconfig>\n' + rules.join('\n') + '\n</fontconfig>\n'
  return { conf, familyCount, skipped, targets: coreTargets }
}

/**
 * Boot ZetaOffice into the given canvas and resolve with the office-worker
 * thread port (Module.uno_main's value). Connect an executor / the editor bridge
 * to the returned port to drive UNO commands.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas REQUIRED. MUST have id="qtcanvas"
 *        and no border/padding (Qt requirement; outline is fine).
 * @param {string}   [options.sofficeBaseUrl] LOWA runtime base URL.
 * @param {string}   [options.zetaJsUrl='./zeta.js'] vendored zetajs bridge URL.
 * @param {string}   [options.workerScriptUrl='./office_thread.js'] office worker URL.
 * @param {string}   [options.houseProfileUrl='./house-default.js'] HOUSE 画像包装脚本
 *   （scripts/sync-house-profile.mjs 从后端 house-default.json 生成，留下
 *   self.HOUSE_DEFAULT_JSON），必须先于 worker 载入。
 * @param {boolean}  [options.initialDocument=false] wait for the host's real file instead of creating a blank model.
 * @param {string}   [options.fontUrl] optional same-origin CJK font to inject.
 * @param {string[]} [options.fontUrls] optional same-origin CJK fonts (one per
 *        typeface category: sans/serif/kai/fangsong); merged with fontUrl.
 *        Entries with `systemFamilies` (+ optional `fileName`) are user-enabled
 *        local fonts (desktop /sysfonts/*): injected as SYS-<i>-<file>, and the
 *        alias rules for their real family names are skipped.
 * @param {(msg:string)=>void}     [options.onLog] worker 'log' lines + milestones.
 * @param {()=>void}                [options.onReady] fired on worker 'ui_ready'
 *        (document loaded, canvas interactive).
 * @param {(data:any)=>void}        [options.onWorkerMessage] raw worker messages.
 * @param {()=>void}               [options.onFatal] native abort during boot or execution.
 * @returns {Promise<{port: MessagePort, dispose: ()=>void}>}
 */
export function bootZetaOffice(options = {}) {
  const {
    canvas,
    sofficeBaseUrl = DEFAULT_SOFFICE_BASE_URL,
    zetaJsUrl = './zeta.js',
    workerScriptUrl = './office_thread.js',
    houseProfileUrl = './house-default.js',
    initialDocument = false,
    fontUrl,
    fontUrls,
    // UI language for the LibreOffice chrome (issue #66 follow-up). The engine
    // derives its locale from navigator.languages (emscripten getEnvStrings ->
    // LANG), so the UI silently follows the BROWSER/Electron language — an
    // en-GB system got an English editor even with the zh-CN engine baked in
    // (v0.3.1 real-machine report). Forcing it makes the product deterministic.
    // Set to ''/null to follow the environment again.
    uiLang = 'zh-CN',
    onLog,
    onReady,
    onWorkerMessage,
    onFatal,
  } = options

  const log = (m) => { if (onLog) onLog(m) }

  if (!canvas) return Promise.reject(new Error('bootZetaOffice: canvas is required'))
  if (typeof self !== 'undefined' && self.crossOriginIsolated === false) {
    return Promise.reject(new Error(
      'bootZetaOffice: page is not cross-origin isolated (SharedArrayBuffer unavailable). ' +
      'Serve with COOP:same-origin + COEP:require-corp headers ' +
      '(spike: node serve.mjs; product: Electron onHeadersReceived).'))
  }

  // HIGH（审计 dev-board#74）：the executor below used to be `async (resolve, reject) => {...}`
  // passed directly to `new Promise(...)`. An async function handed to the Promise
  // constructor only gets its SYNCHRONOUS PREFIX covered by the constructor's implicit
  // try/catch — once it suspends at the first `await` (a few lines down, fetching CJK
  // fonts), any later throw becomes an unhandled rejection of the executor's own
  // DISCARDED return promise, never a call to `reject`. Same problem for `s.onload`
  // below: it's a plain (non-async) DOM callback, so a synchronous throw inside it
  // (e.g. `Module.uno_main` missing) never reaches `reject` either. Either failure mode
  // left this promise (and the caller's loading overlay) hung forever with no error
  // surfaced. Fix: keep the Promise executor itself synchronous and non-throwing (it
  // only wires up an inner async IIFE + a plain onload handler), and explicitly funnel
  // every exception — from any point in the async body, or from the onload callback —
  // into `reject`.
  return new Promise((resolve, reject) => {
    let dispose = () => {}
    let disposed = false, fatal = false
    const rejectWithError = (e) => { dispose(); reject(e instanceof Error ? e : new Error(String(e))) }
    const reportFatal = (reason) => {
      if (disposed || fatal) return
      fatal = true
      // Keep raw native diagnostics in logs, never in the host failure payload.
      try { log('LOWA aborted: ' + String(reason)) } catch (e) { /* diagnostic only */ }
      rejectWithError(new Error('LibreOffice engine stopped'))
      try { if (onFatal) onFatal() } catch (e) { /* host may already be gone */ }
    }
    ;(async () => {
    // Files to write into the LOWA MEMFS before main() (CJK font). Each
    // { path:'/instdir/...', bytes:Uint8Array }. Fetched here (async) because
    // preRun runs synchronously; written there because /instdir merge-mounts only
    // once boot starts. (The #66 runtime zh-CN langpack injection was removed in
    // #79 — the self-built engine ships zh-CN baked in, injection was pure boot
    // overhead.)
    const injections = []

    // --- optional CJK fonts fetch (injected before fontconfig scan) ---
    // fontUrls entries are {url, family, category} (or plain URL strings, which
    // inject without contributing to the alias map — spike/?font= back-compat;
    // fontUrl merges in the same way). `family` MUST be the name LibreOffice
    // registers for the file (list_fonts diagnostic; for zh-localized name
    // tables that is the CHINESE name, e.g. 霞鹜文楷 — real-machine verified
    // both zh and en names resolve, but we pin what list_fonts reported).
    const fontList = [].concat(fontUrls || [], fontUrl ? [fontUrl] : [])
      .map((f) => (typeof f === 'string' ? { url: f } : f))
    const availableByCategory = {} // category -> registered family name
    // Fetch in parallel (serial awaits added the fonts' download times up into
    // boot); process results in fontList order so injections and the
    // availableByCategory first-hit-wins semantics stay deterministic.
    const fontFetches = await Promise.all(fontList.map(async (f, i) => {
      try {
        const r = await fetch(f.url)
        if (!r.ok) { log('CJK font not found at ' + f.url + ' (skipping)'); return null }
        const bytes = new Uint8Array(await r.arrayBuffer())
        const base = String(f.url).split('?')[0].split('/').pop() || ('font-' + i)
        return { f, i, base, bytes }
      } catch (e) {
        log('CJK font fetch failed: ' + f.url + ' — ' + e + ' (skipping)')
        return null
      }
    }))
    // 本机字体（editor-main.js 从 /sysfonts/enabled.json 取来的 {url, family,
    // systemFamilies, fileName}）：文件名可能互相撞（不同目录同名），注入名带序号；
    // 真正取到的族名收进 systemFamilies，下面生成别名时跳过同名规则。
    const systemFamilies = new Set()
    let sysCount = 0, sysBytes = 0
    for (const hit of fontFetches) {
      if (!hit) continue
      if (Array.isArray(hit.f.systemFamilies)) {
        injections.push({ path: '/instdir/share/fonts/truetype/' + systemFontFileName(hit.i, hit.f.fileName || hit.base), bytes: hit.bytes })
        for (const fam of hit.f.systemFamilies) systemFamilies.add(fam)
        sysCount++
        sysBytes += hit.bytes.length
        continue
      }
      injections.push({ path: '/instdir/share/fonts/truetype/AAA-' + hit.base, bytes: hit.bytes })
      if (hit.f.category && hit.f.family && !availableByCategory[hit.f.category]) availableByCategory[hit.f.category] = hit.f.family
      log('CJK font fetched: ' + hit.base + ' (' + Math.round(hit.bytes.length / 1024) + ' KB)')
    }
    if (sysCount) log('System fonts injected: ' + sysCount + ' file(s) (' + (sysBytes / 1048576).toFixed(1) + ' MB)')

    // --- CJK font-name aliases (fontconfig conf.d) --- (see buildCjkAliasConf)
    const alias = buildCjkAliasConf(availableByCategory, systemFamilies)
    if (alias) {
      injections.push({
        path: '/instdir/share/fontconfig/conf.d/69-aiworkdeck-cjk-aliases.conf',
        bytes: new TextEncoder().encode(alias.conf),
      })
      log('CJK font-name alias conf queued (' + alias.familyCount + ' families → ' +
        alias.targets.join(' / ') + ')' + (alias.skipped ? ', ' + alias.skipped + ' skipped (real system font present)' : ''))
    }

    // The globals `canvas` and `Module` must exist before soffice.js loads.
    const Module = {
      canvas,
      // Emscripten forwards enumerable Module.onAbort handlers from pthreads
      // to the main thread, including native OOM before a UNO result returns.
      onAbort: reportFatal,
      uno_scripts: [zetaJsUrl, houseProfileUrl, workerScriptUrl],
      locateFile: function (path, prefix) { return (prefix || sofficeBaseUrl) + path },
      // ALWAYS an array: LOWA's soffice.js prologue does `if(!("preRun" in
      // Module))Module["preRun"]=[]; Module.preRun.push(...)` — a present-but-
      // undefined preRun key crashes the engine head with "Cannot read
      // properties of undefined (reading 'push')" and the boot never starts.
      preRun: [],
      // Inject the font AFTER the data package is mounted but BEFORE
      // LibreOffice main() runs (so fontconfig's startup scan still sees the
      // font). This CANNOT be a preRun hook: preRun runs before the package
      // loader processes soffice.data, and any injected path that ALSO exists in
      // the package (e.g. a self-built engine with the zh-CN langpack baked in,
      // issue #66) makes the loader's FS_createDataFile throw EEXIST — the
      // preload stalls forever and the editor never boots. At
      // onRuntimeInitialized the package files are in MEMFS and FS.writeFile
      // simply overwrites content, so baked-in engines and runtime injection
      // coexist.
      onRuntimeInitialized: function () {
        if (!injections.length) return
        const FS = globalThis.FS
        const mkdirp = (dir) => {
          const parts = dir.split('/').filter(Boolean)
          let cur = ''
          for (let i = 0; i < parts.length; i++) { cur += '/' + parts[i]; try { FS.mkdir(cur) } catch (e) { /* exists */ } }
        }
        let n = 0
        for (const f of injections) {
          try {
            mkdirp(f.path.replace(/\/[^/]*$/, ''))
            FS.writeFile(f.path, f.bytes)
            n++
          } catch (e) { log('FS write failed for ' + f.path + ': ' + e) }
        }
        log('MEMFS injected ' + n + '/' + injections.length + ' file(s) (CJK font + alias conf) before main()')
      },
    }
    // Force the engine's locale (LANG) by shimming navigator.languages BEFORE
    // any engine code runs. Must happen on EVERY thread that computes env
    // strings: the page (below) AND each pthread worker (prepended into the
    // bootstrap blob, which we control). No engine rebuild needed.
    const langShim = uiLang
      ? "try{Object.defineProperty(navigator,'languages',{get:function(){return['" + uiLang + "']}});" +
        "Object.defineProperty(navigator,'language',{get:function(){return'" + uiLang + "'}})}catch(e){}"
      : ''
    if (langShim) {
      try { (0, eval)(langShim); log('UI language forced to ' + uiLang + ' (navigator shim)') }
      catch (e) { log('UI language shim failed: ' + e) }
    }
    if (sofficeBaseUrl !== '') {
      // Absolutize: this URL is imported from inside a BLOB worker, where a
      // relative/root path ('/lowa/soffice.js') is invalid — pthread spawn dies
      // with "The URL ... is invalid" and the office thread never starts.
      const absBase = new URL(sofficeBaseUrl, globalThis.location ? globalThis.location.href : undefined).href
      Module.mainScriptUrlOrBlob = new Blob(
        [(initialDocument === true ? 'self.__awdInitialDocument = true;' : '')
          + langShim + "importScripts('" + absBase + "soffice.js');"], { type: 'text/javascript' })
    }
    globalThis.Module = Module

    let ready = false, lastWidth = 0, lastHeight = 0
    function resizeCanvas(force = false) {
      if (disposed || !ready) return
      const width = canvas.clientWidth, height = canvas.clientHeight
      const changed = width !== lastWidth || height !== lastHeight
      lastWidth = width
      lastHeight = height
      if (width > 0 && height > 0 && (force || changed)) {
        try { globalThis.dispatchEvent(new Event('resize')) } catch (e) { /* ignore */ }
      }
    }

    function onMessage(e) {
      if (disposed) return
      const d = (e && e.data) || {}
      if (d.cmd === 'log') log(d.msg)
      else if (d.cmd === 'ui_ready') {
        // Reveal the canvas (CSS keeps it hidden during boot to avoid showing a
        // blank/garbage surface) and kick one repaint. The spike's page did this
        // in its own ui_ready handler; the boot-module extraction (#46) must own
        // it so every consumer gets a visible, painted canvas.
        canvas.style.visibility = 'visible'
        ready = true
        resizeCanvas(true)
        log('UI ready')
        if (onReady) onReady()
      }
      if (onWorkerMessage) onWorkerMessage(d)
    }

    // Qt needs a resize when the pane changes, not a periodic callback into
    // native windows that may be closing during document replacement.
    const resizeObserver = new ResizeObserver(() => resizeCanvas())
    resizeObserver.observe(canvas)

    dispose = () => { if (disposed) return; disposed = true; resizeObserver.disconnect() }

    const s = document.createElement('script')
    s.src = sofficeBaseUrl + 'soffice.js'
    s.onerror = () => { dispose(); reject(new Error('failed to load soffice.js from ' + sofficeBaseUrl)) }
    // On the MAIN thread the office-thread port is Module.uno_main (NOT
    // Module.zetajs, which exists only inside the office worker) and is available
    // only after soffice.js has run — so wire it in onload. (Verified against the
    // allotropia/zetajs web-office example.)
    s.onload = function () {
      if (disposed) return
      // s.onload is a plain DOM callback (not async): a synchronous throw here
      // (e.g. Module.uno_main being missing/undefined) would otherwise vanish —
      // nothing upstream catches it, so the boot promise would hang forever.
      try {
        log('soffice.js loaded — initializing office thread…')
        Module.uno_main.then(function (port) {
          if (disposed) return
          port.onmessage = onMessage
          log('thread port ready')
          resolve({ port, dispose })
        }, function (err) { dispose(); reject(new Error('uno_main rejected: ' + err)) })
      } catch (e) {
        dispose()
        rejectWithError(e)
      }
    }
    document.body.appendChild(s)
    })().catch(rejectWithError)
  })
}
