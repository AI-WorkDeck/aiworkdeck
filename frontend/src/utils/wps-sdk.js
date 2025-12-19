/**
 * WPS WebOffice SDK 工具类
 * 封装 WPS JS SDK 的初始化和使用
 */

import { WPS_INTERNAL_HTTP_LINK_BASE } from '@/config/workbenchActions.js'

// 动态加载 WPS SDK
let WebOfficeSDK = null

/**
 * 加载 WPS SDK
 */
export function loadWpsSDK() {
  return new Promise((resolve, reject) => {
    if (WebOfficeSDK) {
      resolve(WebOfficeSDK)
      return
    }

    // 在浏览器环境中动态加载 SDK
    if (typeof window !== 'undefined') {
      const script = document.createElement('script')
      // uni-app + vite 环境下，静态资源路径
      // 开发环境：直接从 static 目录读取
      // 生产环境：需要配置正确的静态资源路径
      const sdkPath = '/static/web-office-sdk-solution-v2.0.7.umd.js'
      script.src = sdkPath
      script.onload = () => {
        // UMD 格式的 SDK 会挂载到 window 上
        // 等待一小段时间确保 SDK 完全加载
        setTimeout(() => {
          if (window.WebOfficeSDK) {
            WebOfficeSDK = window.WebOfficeSDK
            resolve(WebOfficeSDK)
          } else {
            // 尝试其他可能的全局变量名
            if (window.WPS || window.wps) {
              WebOfficeSDK = window.WPS || window.wps
              resolve(WebOfficeSDK)
            } else {
              reject(new Error('WPS SDK 加载失败：未找到 WebOfficeSDK 对象，请检查 SDK 文件是否正确加载'))
            }
          }
        }, 100)
      }
      script.onerror = (error) => {
        console.error('SDK 脚本加载错误:', error, '路径:', sdkPath)
        reject(new Error(`WPS SDK 加载失败：脚本加载错误，请检查文件路径 ${sdkPath} 是否正确`))
      }
      document.head.appendChild(script)
    } else {
      reject(new Error('WPS SDK 只能在浏览器环境中使用'))
    }
  })
}

/**
 * 初始化 WPS 编辑器
 * @param {Object} options 配置选项
 * @param {string} options.containerId 容器元素 ID
 * @param {string} options.appId WPS AppID
 * @param {string} options.fileId 文件ID
 * @param {string} options.fileName 文件名
 * @param {string} options.mode 模式：'edit' 或 'view'
 * @param {string} [options.token] 业务 token（可选，用于后端鉴权）
 * @returns {Promise<Object>} WPS 实例对象
 */
export async function initWpsEditor(options) {
  const { containerId, appId, fileId, fileName, mode = 'edit', token } = options

  // 加载 SDK
  const SDK = await loadWpsSDK()

  // 验证必需参数
  if (!appId) {
    throw new Error('[WebOfficeSDK.init] appId为必选项！')
  }
  if (!fileId) {
    throw new Error('[WebOfficeSDK.init] fileId为必选项！')
  }

  // 根据文件类型确定 officeType
  // WPS SDK 使用 SDK.OfficeType 枚举
  const officeType = getOfficeType(fileName, SDK)

  if (!officeType) {
    throw new Error('[WebOfficeSDK.init] officeType为必选项！无法从文件名推断文件类型')
  }

  console.log('初始化WPS编辑器:', { appId, fileId, fileName, officeType, mode })

  // 初始化 WPS 编辑器
  // 注意：uni-app 中使用 view 标签，需要等待 DOM 渲染完成
  // 使用 nextTick 确保容器元素已渲染
  await new Promise((resolve) => {
    // 优先使用 uni-app 的 nextTick（如果存在且为函数）
    if (typeof window !== 'undefined' && window.uni && typeof window.uni.nextTick === 'function') {
      window.uni.nextTick(() => {
        resolve()
      })
      return
    }

    // 兜底：普通浏览器环境下，使用短延时等待 DOM
    setTimeout(resolve, 50)
  })

  const containerElement = document.getElementById(containerId)
  if (!containerElement) {
    throw new Error(`找不到容器元素: ${containerId}，请确保容器已渲染`)
  }

  // 初始化 WPS 编辑器
  // 对照官方文档：
  // https://solution.wps.cn/docs/web/quick-start.html
  // WebOfficeSDK.init 的挂载点参数名称为 mount，而不是 container，
  // mount 可以是 DOM 元素或选择器字符串。
  // 根据 WPS 官方文档，预览模式需要设置 readOnly: true
  const isViewMode = mode === 'view'

  // 构建初始化配置对象
  const initConfig = {
    officeType: officeType,
    appId: appId,
    fileId: fileId,
    // 按官方文档使用 mount 作为挂载容器，确保不走全屏默认容器逻辑
    mount: containerElement,
    // 业务 token：由后端生成并回传，用于在回调中做鉴权（X-Weboffice-Token）
    // 按 WPS 文档，该字段完全由业务方自定义，可为空。
    // 在token中编码mode信息，供后端权限接口使用
    token: token ? `${token}|mode=${mode}` : `mode=${mode}`,
    // 预览模式：设置 readOnly: true 强制只读
    // 编辑模式：readOnly: false 或不设置（默认可编辑）
    readOnly: isViewMode,
    // 尝试关闭 AI 功能以避免 403 错误导致内部 crash
    commonOptions: {
      isShowAi: false,
      isShowTopAi: false,
      isBrowserViewFullscreen: false, // 避免全屏接管
    },
    // Word 组件特定配置
    wordOptions: {
      isShowAi: false,
      isShowSmartMenu: false, // 尝试关闭智能菜单（可能包含 AI）
    },
    // 通过 commandBars 隐藏 AI 相关按钮（如果有）
    commandBars: [
      {
        cmbId: 'WPSAI', // 猜测的 ID，实际可能不同，尝试隐藏
        attributes: { visible: false }
      },
      {
        cmbId: 'SmartMenu',
        attributes: { visible: false }
      }
    ],
    // 超链接跳转拦截（按官方 demo：intercept-link）
    // https://solution.wps.cn/docs/demo/public/intercept-link.html#%E8%B6%85%E9%93%BE%E6%8E%A5%E8%B7%B3%E8%BD%AC%E6%8B%A6%E6%88%AA
    onHyperLinkOpen: (payload) => {
      try {
        // 官方示例字段：linkUrl
        // https://solution.wps.cn/docs/demo/public/intercept-link.html#%E8%B6%85%E9%93%BE%E6%8E%A5%E8%B7%B3%E8%BD%AC%E6%8B%A6%E6%88%AA
        const linkUrl =
          (payload && (payload.linkUrl || payload.LinkUrl || payload.url || payload.URL || payload.href || payload.Href)) || ''
        const u = String(linkUrl || '').trim()
        if (!u) return
        // 只对 onHyperLinkOpen 打点：确认回调是否触发（日志会在宿主控制台）
        // eslint-disable-next-line no-console
        console.log('[WPS onHyperLinkOpen] linkUrl:', u)

        // 方案：使用 https “包装链接”，确保 onHyperLinkOpen 必定触发，然后完全接管跳转
        if (WPS_INTERNAL_HTTP_LINK_BASE && u.startsWith(WPS_INTERNAL_HTTP_LINK_BASE)) {
          try {
            const q = u.includes('?') ? u.split('?')[1] : ''
            const params = new URLSearchParams(q)
            const inner = params.get('u') ? decodeURIComponent(String(params.get('u'))) : ''
            if (inner) {
              if (typeof window !== 'undefined' && typeof window.__checkbaHandleInternalLink === 'function') {
                window.__checkbaHandleInternalLink(inner)
              } else {
                const msg = { __checkbaInternalLink: true, url: inner }
                try { window.parent && window.parent.postMessage(msg, '*') } catch (e1) { }
                try { window.top && window.top.postMessage(msg, '*') } catch (e2) { }
              }
              // eslint-disable-next-line no-console
              console.log('[WPS onHyperLinkOpen] intercepted internal:', inner)
              return false
            }
          } catch (e) {
            // ignore
          }
        }

        // 旧格式兜底：如果仍有 checkba:，也尝试接管
        if (u.startsWith('checkba:')) {
          try {
            if (typeof window !== 'undefined' && typeof window.__checkbaHandleInternalLink === 'function') {
              window.__checkbaHandleInternalLink(u)
            } else {
              const msg = { __checkbaInternalLink: true, url: u }
              try { window.parent && window.parent.postMessage(msg, '*') } catch (e1) { }
              try { window.top && window.top.postMessage(msg, '*') } catch (e2) { }
            }
          } catch (e) { }
          return false
        }
      } catch (e) {
        // ignore
      }
      // 其他链接保持默认
      return true
    },
    // endpoint 默认为 https://o.wpsgo.com，这里使用默认即可；
    // 如果后续需要切换到其他网关，可在此显式传入 endpoint。
  }

  console.log('WPS初始化配置:', initConfig)
  // 额外确认：确保 onHyperLinkOpen 已按官方示例挂进去
  // eslint-disable-next-line no-console
  console.log('WPS初始化配置 keys:', Object.keys(initConfig || {}))

  const instance = SDK.init(initConfig)

  // 等待编辑器就绪
  await instance.ready()

  // 监听文件打开事件
  instance.ApiEvent.AddApiEventListener('fileOpen', (data) => {
    console.log('WPS 文件打开:', data)
    if (data.success) {
      console.log('文件打开成功:', data.fileInfo)
    } else {
      console.error('文件打开失败:', data.msg)
    }
  })

  // 监听错误事件
  instance.ApiEvent.AddApiEventListener('error', (data) => {
    console.error('WPS 错误:', data)
  })

  return instance
}

/**
 * 根据文件名获取 Office 类型
 * @param {string} fileName 文件名
 * @param {Object} SDK WPS SDK 对象
 * @returns {string|number} Office 类型（使用 SDK.OfficeType 枚举）
 */
function getOfficeType(fileName, SDK) {
  if (!fileName) {
    // 默认 Word
    return SDK && SDK.OfficeType ? SDK.OfficeType.Writer : 'Writer'
  }

  const lower = fileName.toLowerCase()
  let officeType = null

  // 优先使用 SDK.OfficeType 枚举
  if (SDK && SDK.OfficeType) {
    if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
      officeType = SDK.OfficeType.Writer
    } else if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) {
      officeType = SDK.OfficeType.Spreadsheet
    } else if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) {
      officeType = SDK.OfficeType.Presentation
    } else if (lower.endsWith('.pdf')) {
      // 尝试获取 PDF 类型，不同版本 SDK 可能使用 PDF 或 Pdf
      officeType = SDK.OfficeType.PDF || SDK.OfficeType.Pdf || 'f'
    } else {
      officeType = SDK.OfficeType.Writer // 默认 Word
    }

    // 验证officeType是否有效
    if (officeType === undefined || officeType === null) {
      console.warn('SDK.OfficeType 枚举值无效，使用字符串类型', { fileName, officeType })
      // 降级到字符串类型
      return getOfficeTypeString(lower)
    }

    return officeType
  } else {
    // 如果 SDK.OfficeType 不存在，使用字符串（兼容旧版本）
    return getOfficeTypeString(lower)
  }
}

/**
 * 获取字符串类型的Office类型（降级方案）
 */
function getOfficeTypeString(lowerFileName) {
  if (lowerFileName.endsWith('.doc') || lowerFileName.endsWith('.docx')) {
    return 'w'
  } else if (lowerFileName.endsWith('.xls') || lowerFileName.endsWith('.xlsx')) {
    return 's'
  } else if (lowerFileName.endsWith('.ppt') || lowerFileName.endsWith('.pptx')) {
    return 'p'
  } else if (lowerFileName.endsWith('.pdf')) {
    return 'f'
  }
  return 'w' // 默认 Word
}

