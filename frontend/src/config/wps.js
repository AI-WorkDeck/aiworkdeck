// WPS WebOffice 相关前端配置
// 说明：
// - 具体的在线编辑 URL 需要在 WPS WebOffice 控制台配置回调与签名逻辑后，由后端生成；
// - 前端这里只保留“占位 + 环境变量”形式，方便后续接后端。

const { VITE_WPS_WEB_OFFICE_DEMO_URL } = import.meta.env || {}

// 默认使用环境变量提供的演示文档地址（例如后端生成的编辑链接）
export const WPS_WEB_OFFICE_DEMO_URL = VITE_WPS_WEB_OFFICE_DEMO_URL || ''


