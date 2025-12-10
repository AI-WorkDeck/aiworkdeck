// 统一的 API 封装层
// 说明：
// - 所有网络请求都应通过这里发起，组件内禁止直接写 URL。
// - 后端基础地址通过环境变量配置，便于本地 / Sealos / 阿里云等环境切换。

// 本地开发环境默认使用 cpolar 内网穿透地址
// 生产环境可通过 VITE_API_BASE_URL 环境变量覆盖
const DEFAULT_API_BASE_URL = 'https://checkbahttps.vip.cpolar.cn';

function getApiBaseUrl() {
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

  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
      url,
      success(res) {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          resolve(res.data);
        } else {
          const message =
            (res.data && (res.data.message || res.data.error)) ||
            '服务异常，请稍后重试';
          reject(new Error(message));
        }
      },
      fail(err) {
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

// 预留：创建项目接口
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


