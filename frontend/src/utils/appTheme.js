// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 外观主题（浅色 / 深色 / 跟随系统）。权威源是这里的 uni storage 值；
// documentElement 上的 data-theme 与桌面主进程的 nativeTheme 都是镜像。
//
// 三态与两态之分：存储里存 mode（含 'system'），页面上只挂解析后的
// 'light' | 'dark'——组件的 CSS 选择器不需要认识第三种状态。
//
// 「跟随系统」在桌面端有一个反直觉之处：Electron 一旦把 nativeTheme.themeSource
// 设成非 'system'，**所有渲染进程的 prefers-color-scheme 都会被钉死**成那个值，
// 于是 matchMedia 永远读不到真实系统设置。所以 system 态必须让主进程把
// themeSource 也设回 'system'，matchMedia 才恢复真话（见 desktop/main/main.js
// 的 applyNativeTheme 与 dev-board#218 的沿革）。
//
// 本模块刻意零依赖（不引 host.js / api.js），与 appLanguage.js 同一条理由：
// 启动最早期就要用，不能卷进循环引用。

export const APP_THEME_KEY = 'awd_theme'
export const APP_SKIN_KEY = 'awd_skin_cache'
export const APP_THEME_EVENT = 'awd-theme-changed'
export const THEME_MODES = ['light', 'dark', 'system']

// 语义色令牌全名单（与 App.vue 里 html[data-theme] 的 --awd-* 定义一一对应）。
// 用途：PluginPane 把当前主题的令牌值序列化后注入插件 iframe（照 VS Code 给
// webview 注入 --vscode-* 变量的机制）。App.vue 新增令牌时这里要同步补名——
// 漏了不报错，只是插件侧 var() 落空走 fallback。
export const THEME_TOKEN_NAMES = [
  'bg', 'surface', 'surface-2', 'surface-3', 'surface-elevated',
  'text', 'text-2', 'text-3', 'text-on-accent', 'text-on-mint',
  'border-subtle', 'border', 'border-strong',
  'accent', 'accent-hover', 'accent-text', 'accent-soft', 'accent-wash',
  // 'mint' 这个名字是公开契约：第三方插件 CSS 里写着 var(--awd-mint)，只换值不改名
  // （东方清雅体系下它的值是竹月青 #89A8A0）；'bamboo' 是同值语义别名，新代码用它。
  'mint', 'bamboo',
  'gold', 'gold-line', 'gold-text', 'gold-soft',
  'danger', 'danger-text', 'danger-soft',
  'warning', 'warning-text', 'warning-soft',
  'info', 'info-text', 'info-soft',
  'file-word', 'file-ppt', 'file-excel', 'file-pdf', 'file-md', 'file-image',
  'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-island', 'shadow-card', 'shadow-btn',
  'specular', 'overlay',
  'halo-1', 'halo-2', 'halo-page', 'glass', 'glass-border', 'canvas',
  // iframe 与宿主共用字体、密度和交互尺寸，新增公共令牌须同时进入此表。
  'font-serif', 'font-sans', 'font-mono',
  'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-7', 'space-8',
  'control-xs', 'control-sm', 'control-md',
  'control-height', 'control-height-touch',
  'radius-sm', 'radius-md', 'radius-dialog', 'radius-lg',
  'island-radius', 'island-gap',
  'font-size-body', 'font-size-reading', 'font-size-title', 'line-height-ui',
  'focus-width', 'focus-offset', 'motion-fast', 'motion-base',
  'switch-width', 'switch-track-height', 'switch-knob-size',
  'panel-pad-x', 'panel-gap', 'panel-gap-lg', 'panel-sec-h', 'panel-row-h', 'panel-radius',
  'panel-fs-sec', 'panel-fs', 'panel-fs-meta', 'panel-border', 'panel-hover',
  'panel-text', 'panel-text-2', 'panel-text-3', 'panel-text-4',
  'panel-accent', 'panel-accent-2', 'panel-accent-wash'
]

// 计划审阅（dev-board#1022）的四个令牌：改动行底色 / 改动行左侧标记条 / 删除段小标记文字 /
// 批注高亮底色。只在审阅态的 CodeMirror 里用，所以不进 App.vue 的全局令牌、也不进上面那张
// 注入插件的名单；planReviewExtensions.js 读这张表，把它们定义在编辑器根元素上
// （浅色一套、html[data-theme='dark'] 下一套）。外壳保持浅色，深色只是跟随：
// 琥珀与竹月青两个色相不变，底色改成低透明度叠在暖墨底上（同 warning-soft / accent-soft 的路数），
// 标记条与删除文字提亮到在深底上读得出来。
export const PLAN_REVIEW_TOKENS = {
  light: {
    '--awd-review-edited-bg': '#FFF6E5',
    '--awd-review-edited-bar': '#E0A526',
    '--awd-review-deleted-fg': '#8A8F98',
    '--awd-review-comment-bg': '#CFEBDD'
  },
  dark: {
    '--awd-review-edited-bg': 'rgba(224, 165, 38, 0.13)',
    '--awd-review-edited-bar': '#D19C3D',
    '--awd-review-deleted-fg': '#A09A8C',
    '--awd-review-comment-bg': 'rgba(137, 168, 160, 0.18)'
  }
}

/** 当前生效主题的令牌表：{ '--awd-*': '值' }。非浏览器环境返回空表。 */
export function collectThemeTokens() {
  const out = {}
  try {
    const cs = window.getComputedStyle(document.documentElement)
    for (const name of THEME_TOKEN_NAMES) {
      const v = cs.getPropertyValue('--awd-' + name)
      if (v) out['--awd-' + name] = v.trim()
    }
  } catch (e) { /* 小程序端等无 DOM 环境 */ }
  return out
}

// 默认浅色而不是跟随系统：深色是本版新加的，先让它是「选进去」的而不是
// 「升级后被切过去」的；等深色跑顺了再考虑把默认改成 system。
const DEFAULT_MODE = 'light'

let cachedMode = ''
let cachedSkin = null
let skinLoadedFromStorage = false
let appliedSkinKeys = []
let systemDark = false
let mediaQuery = null

function readStorage(key) {
  try {
    const v = uni.getStorageSync(key)
    return typeof v === 'string' ? v.trim() : ''
  } catch (e) {
    return ''
  }
}

function loadCachedSkin() {
  if (skinLoadedFromStorage) return cachedSkin
  skinLoadedFromStorage = true
  try {
    const raw = uni.getStorageSync(APP_SKIN_KEY)
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (obj && typeof obj === 'object' && obj.ref && obj.lightTokens && obj.darkTokens) {
      cachedSkin = obj
    }
  } catch (e) {
    cachedSkin = null
  }
  return cachedSkin
}

/** 当前生效的皮肤引用（如 'theme-inkwash-zen:inkwash-zen'，默认皮肤为 ''） */
export function getActiveSkinRef() {
  const s = loadCachedSkin()
  return (s && s.ref) ? String(s.ref) : ''
}

/** 当前生效的皮肤对象（默认皮肤为 null） */
export function getActiveSkin() {
  return loadCachedSkin()
}

function applySkinVariables(resolved) {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return
    const el = document.documentElement
    if (appliedSkinKeys.length && el.style && el.style.removeProperty) {
      for (const k of appliedSkinKeys) el.style.removeProperty(k)
    }
    appliedSkinKeys = []
    const skin = loadCachedSkin()
    if (!skin || !skin.ref || !el.style || !el.style.setProperty) {
      if (el.removeAttribute) {
        el.removeAttribute('data-skin')
        el.removeAttribute('data-skin-pulse')
        el.removeAttribute('data-skin-texture')
      }
      return
    }
    if (el.setAttribute) {
      el.setAttribute('data-skin', String(skin.ref))
      if (skin.effects && skin.effects.aiPulseStyle) el.setAttribute('data-skin-pulse', String(skin.effects.aiPulseStyle))
      else if (el.removeAttribute) el.removeAttribute('data-skin-pulse')
      if (skin.effects && skin.effects.surfaceTexture) el.setAttribute('data-skin-texture', String(skin.effects.surfaceTexture))
      else if (el.removeAttribute) el.removeAttribute('data-skin-texture')
    }
    const tokens = (resolved === 'dark' ? skin.darkTokens : skin.lightTokens) || {}
    for (const [k, v] of Object.entries(tokens)) {
      const prop = k.startsWith('--awd-') ? k : '--awd-' + k
      if (/^--awd-[a-z0-9-]+$/.test(prop) && typeof v === 'string' && v) {
        el.style.setProperty(prop, v)
        appliedSkinKeys.push(prop)
      }
    }
    if (skin.fonts && typeof skin.fonts === 'object') {
      for (const [fk, fv] of Object.entries(skin.fonts)) {
        const prop = fk.startsWith('--awd-font-') ? fk : '--awd-font-' + fk
        if (/^--awd-font-(?:serif|sans|mono)$/.test(prop) && typeof fv === 'string' && fv) {
          el.style.setProperty(prop, fv)
          appliedSkinKeys.push(prop)
        }
      }
    }
  } catch (e) { /* 非浏览器环境静默 */ }
}

/** 当前 mode（'light' | 'dark' | 'system'） */
export function getThemeMode() {
  if (cachedMode) return cachedMode
  const stored = readStorage(APP_THEME_KEY)
  cachedMode = THEME_MODES.includes(stored) ? stored : DEFAULT_MODE
  return cachedMode
}

/** mode 解析成实际生效的 'light' | 'dark' */
export function getResolvedTheme() {
  const mode = getThemeMode()
  if (mode !== 'system') return mode
  return systemDark ? 'dark' : 'light'
}

function paint() {
  const resolved = getResolvedTheme()
  try {
    document.documentElement.setAttribute('data-theme', resolved)
  } catch (e) { /* 非浏览器环境（小程序端）静默 */ }
  applySkinVariables(resolved)
  return resolved
}

/** 桌面主进程镜像：让原生标题栏/交通灯/右键菜单跟着一起变（dev-board#218） */
function mirrorToDesktop(mode) {
  try {
    const d = typeof window !== 'undefined' && window.checkbaDesktop
    if (d && d.theme && d.theme.set) {
      // 主进程回报「系统当前是不是深色」——system 态下这是唯一可靠的来源，
      // 因为 themeSource 刚被改过，本进程的 matchMedia 可能还没同步过来。
      Promise.resolve(d.theme.set(mode)).then((r) => {
        if (r && typeof r.systemDark === 'boolean' && r.systemDark !== systemDark) {
          systemDark = r.systemDark
          if (getThemeMode() === 'system') {
            paint()
            try { uni.$emit(APP_THEME_EVENT, getResolvedTheme()) } catch (e) { /* ignore */ }
          }
        }
      }).catch(() => {})
    }
  } catch (e) { /* ignore */ }
}

/**
 * 启动时调用一次：读存储、挂 data-theme、订阅系统外观变化。
 * 必须早于首屏渲染，否则会先白一下再变深。
 */
export function initAppTheme() {
  const mode = getThemeMode()
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      systemDark = !!mediaQuery.matches
      const onChange = (e) => {
        systemDark = !!e.matches
        if (getThemeMode() === 'system') {
          paint()
          try { uni.$emit(APP_THEME_EVENT, getResolvedTheme()) } catch (err) { /* ignore */ }
        }
      }
      if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onChange)
      else if (mediaQuery.addListener) mediaQuery.addListener(onChange)
    }
  } catch (e) { /* ignore */ }
  paint()
  mirrorToDesktop(mode)
  return getResolvedTheme()
}

/** 切换主题并广播。桌面原生层的镜像在这里一并写透。 */
export function setThemeMode(mode) {
  if (!THEME_MODES.includes(mode)) return getThemeMode()
  const changed = mode !== getThemeMode()
  cachedMode = mode
  try { uni.setStorageSync(APP_THEME_KEY, mode) } catch (e) { console.warn('[appTheme] persist failed:', e) }
  const resolved = paint()
  mirrorToDesktop(mode)
  if (changed) {
    try { uni.$emit(APP_THEME_EVENT, resolved) } catch (e) { /* ignore */ }
  }
  return cachedMode
}

/**
 * 切换或清除外观皮肤并广播 APP_THEME_EVENT（自动同步主工作台、Web 插件 iframe 与编辑器）。
 * @param {object|null} skin 形如 { ref, pluginId, id, name, lightTokens, darkTokens, fonts, effects }；传 null/空恢复默认皮肤
 */
export function setActiveSkin(skin) {
  const prevRef = getActiveSkinRef()
  if (!skin || typeof skin !== 'object' || (!skin.ref && !(skin.pluginId && skin.id))) {
    cachedSkin = null
    skinLoadedFromStorage = true
    try { uni.removeStorageSync(APP_SKIN_KEY) } catch (e) { /* ignore */ }
  } else {
    const ref = skin.ref || `${skin.pluginId}:${skin.id}`
    cachedSkin = {
      ref,
      name: skin.name || ref,
      lightTokens: skin.lightTokens || {},
      darkTokens: skin.darkTokens || {},
      fonts: skin.fonts || {},
      effects: skin.effects || {},
    }
    skinLoadedFromStorage = true
    try { uni.setStorageSync(APP_SKIN_KEY, JSON.stringify(cachedSkin)) } catch (e) { /* ignore */ }
  }
  const resolved = paint()
  if (prevRef !== getActiveSkinRef() || cachedSkin) {
    try { uni.$emit(APP_THEME_EVENT, resolved) } catch (e) { /* ignore */ }
  }
  return getActiveSkinRef()
}
