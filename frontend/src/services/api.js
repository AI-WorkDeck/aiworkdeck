// 统一的 API 封装层
// 说明：
// - 所有网络请求都应通过这里发起，组件内禁止直接写 URL。
// - 后端基础地址通过环境变量配置，便于本地 / Sealos / 阿里云等环境切换。

// 导入认证工具
import { getAuthHeaders } from '@/utils/auth.js'

// 本地开发环境默认使用 cpolar 内网穿透地址
// 生产环境可通过 VITE_API_BASE_URL 环境变量覆盖
const DEFAULT_API_BASE_URL = 'https://checkbahttps.vip.cpolar.cn';

export function getApiBaseUrl() {
  // uni-app + vite 环境下可使用 import.meta.env
  // 建议在不同部署环境中通过 VITE_API_BASE_URL 配置后端网关地址
  // 例如：
  // 本地开发：VITE_API_BASE_URL=http://localhost:8080
  // 云环境：VITE_API_BASE_URL=https://api.your-domain.com
  try {
    // eslint-disable-next-line no-undef
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) {
      // eslint-disable-next-line no-undef
      return import.meta.env.VITE_API_BASE_URL;
    }
  } catch (e) {
    // 如果 import.meta 不可用，忽略错误
  }
  return DEFAULT_API_BASE_URL;
}

function request(options) {
  const baseUrl = getApiBaseUrl();
  const url = options.url.startsWith('http')
    ? options.url
    : `${baseUrl.replace(/\/$/, '')}/${options.url.replace(/^\//, '')}`;

  // 打印请求信息（用于调试）
  console.log('发起请求:', {
    method: options.method || 'GET',
    url: url,
    baseUrl: baseUrl,
    originalUrl: options.url,
    data: options.data
  })

  // 获取认证头
  let authHeaders = {}
  try {
    authHeaders = getAuthHeaders()
  } catch (e) {
    console.warn('获取认证头失败:', e)
    // 如果获取失败，使用默认 headers
    authHeaders = options.header || {}
  }

  // 合并请求头（确保自定义 header 优先级更高）
  const headers = {
    ...authHeaders,
    ...(options.header || {}),
  }

  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
      url,
      header: headers,
      success(res) {
        const status = res.statusCode || 0;
        // 统一处理后端返回的 { code: 0, data: ... } 或 { code: 1, message: ... } 格式
        if (res.data && typeof res.data.code !== 'undefined') {
          if (res.data.code === 0) {
            // 对于有 code 字段的响应，返回整个响应对象（保持向后兼容）
            // 这样登录页面可以访问 res.code 和 res.data
            resolve(res.data);
        } else {
          // 完整打印业务错误信息
          const errorMessage = res.data.message || '服务异常，请稍后重试'
          console.error('业务错误:', {
            code: res.data.code,
            message: errorMessage,
            data: res.data.data,
            fullResponse: res.data
          })
          reject(new Error(errorMessage));
        }
        } else if (status >= 200 && status < 300) {
          // 如果没有 code 字段，直接返回数据（兼容旧接口）
          resolve(res.data);
        } else {
          // HTTP 状态码错误
          const message =
            (res.data && (res.data.message || res.data.error)) ||
            `请求失败 (${status})`;
          console.error('HTTP 状态码错误:', {
            statusCode: status,
            message: message,
            data: res.data,
            header: res.header
          })
          reject(new Error(message));
        }
      },
      fail(err) {
        // 完整打印网络请求失败的错误信息
        console.error('网络请求失败:', err)
        console.error('错误详情:', {
          errMsg: err.errMsg,
          statusCode: err.statusCode,
          data: err.data,
          header: err.header,
          cookies: err.cookies,
          requestUrl: url,
          requestMethod: options.method || 'GET',
          baseUrl: baseUrl,
          originalUrl: options.url
        })
        // 根据 errMsg 提供更准确的诊断信息
        let diagnosticMessage = '网络请求失败，请检查：'
        if (err.errMsg && err.errMsg.includes('request:fail')) {
          diagnosticMessage += '\n1. 后端服务是否正在运行（检查端口 9696）'
          diagnosticMessage += '\n2. 后端服务是否启动成功（检查后端日志 backend/app.log）'
          diagnosticMessage += '\n3. 网络连接是否正常'
          diagnosticMessage += `\n4. 当前配置的 API 地址: ${baseUrl}`
          diagnosticMessage += '\n5. 如果使用内网穿透，请确认隧道是否正常运行'
        } else {
          diagnosticMessage += '\n1. 网络连接问题'
          diagnosticMessage += '\n2. 后端服务异常'
          diagnosticMessage += `\n3. 当前配置的 API 地址: ${baseUrl}`
        }
        console.error('诊断信息:', diagnosticMessage)
        reject(err);
      },
    });
  });
}

// 查询公司基础信息（企查查等外部服务由后端统一封装）
// payload 建议结构：
// {
//   projectType: 'MAJOR_ASSET_RESTRUCTURING',
//   role: 'LISTED' | 'TARGET',
//   name: '公司名称'
// }
export function fetchCompanyBasicInfo(payload) {
  return request({
    url: '/api/external/company/basic',
    method: 'POST',
    data: payload,
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// ===================== AI 助手相关 API =====================

/**
 * 项目内 AI 对话
 * payload: { projectId: string|number, message: string }
 */
export function aiChat(payload) {
  return request({
    url: '/api/ai/chat',
    method: 'POST',
    data: {
      projectId: String(payload.projectId),
      message: payload.message
    },
    header: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * 将一段 AI 文本（markdown）导出为 Word 文档并落地到项目文件树中（后端生成 docx）
 * payload: { projectId, parentId, fileName, markdown | content }
 */
export function exportAiDocx(payload) {
  return request({
    url: '/api/ai/export-docx',
    method: 'POST',
    data: {
      projectId: String(payload.projectId),
      parentId: payload.parentId,
      fileName: payload.fileName,
      markdown: payload.markdown || payload.content
    },
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// ===================== 后台管理相关 API =====================

// 获取后台配置（外部服务 + AI 配置）
export function getAdminConfig() {
  return request({
    url: '/api/admin/config',
    method: 'GET',
  });
}

// 保存后台配置
export function saveAdminConfig(payload) {
  return request({
    url: '/api/admin/config',
    method: 'POST',
    data: payload,
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 获取用户列表（仅管理员）
export function getAdminUsers() {
  return request({
    url: '/api/admin/users',
    method: 'GET',
  });
}

// 创建项目接口
// payload: 项目创建请求数据
export function createProject(payload) {
  return request({
    url: '/api/projects',
    method: 'POST',
    data: payload,
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 生成 WPS 在线编辑链接
// payload: { fileId: string, fileName?: string, mode?: 'edit' | 'view' }
export function generateWpsEditUrl(payload) {
  return request({
    url: '/api/wps/generate-url',
    method: 'POST',
    data: payload,
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 获取 WPS 回调网关地址
export function getWpsCallbackBaseUrl() {
  return request({
    url: '/api/wps/callback-base-url',
    method: 'GET',
  });
}

// 创建 WPS 会话，获取用于前端 SDK 初始化的业务 token
// payload: { fileId: string, userId?: string }
export function createWpsSession(payload) {
  return request({
    url: '/api/wps/session',
    method: 'POST',
    data: payload,
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// ===================== 用户认证相关 API =====================

// 用户注册
export function register(username, password, displayName) {
  return request({
    url: '/api/auth/register',
    method: 'POST',
    data: {
      username,
      password,
      displayName,
    },
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 用户登录
export function login(username, password) {
  return request({
    url: '/api/auth/login',
    method: 'POST',
    data: {
      username,
      password,
    },
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 获取当前登录用户信息
export function getCurrentUser() {
  return request({
    url: '/api/auth/me',
    method: 'GET',
  });
}

// 用户登出
export function logout() {
  return request({
    url: '/api/auth/logout',
    method: 'POST',
  });
}

// 获取当前用户的项目列表
export function getMyProjects() {
  return request({
    url: '/api/projects/my',
    method: 'GET',
  });
}

// 删除项目
export function deleteProject(projectId) {
  return request({
    url: `/api/projects/${projectId}`,
    method: 'DELETE',
  });
}

// 获取项目详情
export function getProject(projectId) {
  return request({
    url: `/api/projects/${projectId}`,
    method: 'GET',
  });
}

// ===================== 项目文件管理相关 API =====================

// 获取项目文件列表
export function getProjectFiles(projectId, parentId = null, tree = false) {
  const params = []
  if (parentId !== null) {
    params.push(`parentId=${parentId}`)
  }
  if (tree) {
    params.push('tree=true')
  }
  const queryString = params.length > 0 ? `?${params.join('&')}` : ''
  return request({
    url: `/api/projects/${projectId}/files${queryString}`,
    method: 'GET',
  });
}

// 创建文件夹
export function createFolder(projectId, parentId, name) {
  return request({
    url: `/api/projects/${projectId}/files/folder`,
    method: 'POST',
    data: {
      parentId,
      name,
    },
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 创建文件
export function createFile(projectId, parentId, name, fileType, fileSize, filePath, wpsFileId) {
  return request({
    url: `/api/projects/${projectId}/files/file`,
    method: 'POST',
    data: {
      parentId,
      name,
      fileType,
      fileSize,
      filePath,
      wpsFileId,
    },
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 重命名文件或文件夹
export function renameFile(projectId, fileId, name) {
  return request({
    url: `/api/projects/${projectId}/files/${fileId}/rename`,
    method: 'PUT',
    data: {
      name,
    },
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 删除文件或文件夹
export function deleteFile(projectId, fileId) {
  return request({
    url: `/api/projects/${projectId}/files/${fileId}`,
    method: 'DELETE',
  });
}

// 移动文件或文件夹（拖拽排序）
export function moveFile(projectId, fileId, parentId, sortOrder) {
  return request({
    url: `/api/projects/${projectId}/files/${fileId}/move`,
    method: 'PUT',
    data: {
      parentId,
      sortOrder,
    },
    header: {
      'Content-Type': 'application/json',
    },
  });
}

// 获取文件详情
export function getFileDetail(projectId, fileId) {
  return request({
    url: `/api/projects/${projectId}/files/${fileId}`,
    method: 'GET',
  });
}

// 获取文件下载URL
export function getFileDownloadUrl(fileId) {
  const baseUrl = getApiBaseUrl()
  return `${baseUrl}/api/files/${fileId}/download`
}

export const getProjectVariables = (projectId) => {
    return request({
        url: `/api/variables/project/${projectId}`,
        method: 'GET'
    })
}

export const saveProjectVariable = (data) => {
    return request({
        url: '/api/variables',
        method: 'POST',
        data
    })
}

export const deleteProjectVariable = (id) => {
    return request({
        url: `/api/variables/${id}`,
        method: 'DELETE'
    })
}

export default {
    getApiBaseUrl,
    request,
    aiChat,
    exportAiDocx,
    fetchCompanyBasicInfo,
    createProject,
    generateWpsEditUrl,
    getWpsCallbackBaseUrl,
    createWpsSession,
    register,
    login,
    getCurrentUser,
    logout,
    getMyProjects,
    deleteProject,
    getProject,
    getProjectFiles,
    createFolder,
    createFile,
    renameFile,
    deleteFile,
    moveFile,
    getFileDetail,
    getFileDownloadUrl,
    getProjectVariables,
    saveProjectVariable,
    deleteProjectVariable,
    getAdminConfig,
    saveAdminConfig,
    getAdminUsers
}


