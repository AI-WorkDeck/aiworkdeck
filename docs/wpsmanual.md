# WPS WebOffice 集成使用手册

## 目录

- [概述](#概述)
- [架构说明](#架构说明)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [前端集成](#前端集成)
- [后端集成](#后端集成)
- [回调接口说明](#回调接口说明)
- [常见问题](#常见问题)
- [关键注意事项](#关键注意事项)

---

## 概述

本项目集成了 **WPS WebOffice** 在线文档编辑功能，支持 Word、Excel、PowerPoint 和 PDF 文件的在线编辑和预览。

### 技术方案

- **前端**：使用 WPS JS SDK（`web-office-sdk-solution-v2.0.7`）进行集成
- **后端**：Spring Boot + Java，实现 WPS 回调接口和会话管理
- **通信方式**：JS SDK 方案（推荐），通过 `fileId` 和 `appId` 直接初始化编辑器

### 文件结构

```
frontend/
├── src/
│   ├── components/
│   │   └── WpsEditor.vue          # 可复用的 WPS 编辑器组件（推荐使用）
│   ├── utils/
│   │   └── wps-sdk.js             # WPS SDK 工具类（加载和初始化）
│   ├── config/
│   │   └── wps.js                 # WPS 前端配置
│   └── services/
│       └── api.js                  # API 封装（包含 WPS 相关接口）
├── static/
│   ├── web-office-sdk-solution-v2.0.7.umd.js  # WPS SDK 文件
│   └── index.d.ts                  # TypeScript 类型定义

backend/
├── src/main/java/com/checkba/
│   ├── controller/
│   │   ├── WpsController.java      # WPS 回调接口控制器
│   │   └── WpsApiController.java  # WPS API 控制器（供前端调用）
│   └── service/
│       └── WpsService.java         # WPS 业务服务（签名、token 生成等）
└── src/main/resources/
    └── application-prod.yml       # 生产环境配置（包含 WPS 配置）
```

---

## 架构说明

### 工作流程

1. **前端初始化**：
   - 用户点击"开始编辑"按钮
   - 前端调用 `/api/wps/session` 创建会话，获取业务 token
   - 加载 WPS SDK 并初始化编辑器（传入 `fileId`、`appId`、`token`）

2. **WPS 回调**：
   - WPS 服务器通过回调接口获取文件信息、权限、用户信息等
   - 回调地址：`https://your-domain.com/v3/3rd/files/{file_id}`

3. **文件操作**：
   - 用户编辑文档
   - WPS 通过回调接口保存文件、获取下载地址等

### 关键概念

- **AppID**：WPS 控制台创建应用后获得的唯一标识
- **AppSecret**：应用密钥，用于生成签名
- **FileID**：业务方自定义的文件唯一标识（如：`project_123_doc_1`）
- **Token**：业务方自定义的会话 token，用于回调鉴权（可选）
- **Callback Base URL**：回调网关地址，WPS 服务器会向此地址发送请求

---

## 快速开始

### 1. 后端配置

在 `application-prod.yml` 或 `application.yml` 中配置：

```yaml
external:
  wps:
    app-id: SX20251208BJWRFK          # 从 WPS 控制台获取
    app-secret: ***REMOVED***  # 从 WPS 控制台获取
    callback-base-url: https://checkbahttps.vip.cpolar.cn  # 回调网关地址（需公网可访问）
```

### 2. 前端使用组件（推荐）

```vue
<template>
  <view>
    <WpsEditor
      v-if="showEditor"
      :file-id="fileId"
      :file-name="fileName"
      :app-id="appId"
      :mode="'edit'"
      @ready="onEditorReady"
      @error="onEditorError"
    />
  </view>
</template>

<script>
import WpsEditor from '@/components/WpsEditor.vue'

export default {
  components: {
    WpsEditor
  },
  data() {
    return {
      showEditor: false,
      fileId: 'project_123_doc_1',
      fileName: '项目文档.docx',
      appId: 'SX20251208BJWRFK'
    }
  },
  methods: {
    onEditorReady(instance) {
      console.log('编辑器就绪', instance)
    },
    onEditorError(error) {
      console.error('编辑器错误', error)
    }
  }
}
</script>
```

### 3. 手动集成（不推荐，但可用）

```javascript
import { initWpsEditor } from '@/utils/wps-sdk.js'
import { createWpsSession } from '@/services/api.js'

// 1. 创建会话获取 token
const session = await createWpsSession({
  fileId: 'project_123_doc_1',
  userId: 'user_123' // 可选
})

// 2. 初始化编辑器
const instance = await initWpsEditor({
  containerId: 'wps-container',
  appId: 'SX20251208BJWRFK',
  fileId: 'project_123_doc_1',
  fileName: '项目文档.docx',
  mode: 'edit',
  token: session.token
})
```

---

## 配置说明

### WPS 控制台配置

1. **创建应用**：
   - 登录 [WPS 开放平台](https://open.wps.cn/)
   - 创建应用，获取 `AppID` 和 `AppSecret`

2. **配置回调地址**：
   - 回调网关：`https://your-domain.com/v3/3rd`
   - 确保该地址公网可访问（可使用内网穿透工具如 cpolar）

3. **人员配置**：
   - 在控制台添加用户，记录用户 ID（如：`1780305141`）
   - 后端代码中的 `DEFAULT_USER_ID` 需与此保持一致

### 环境变量

**前端**（`.env.local`）：
```bash
VITE_API_BASE_URL=https://checkbahttps.vip.cpolar.cn
```

**后端**（`application-prod.yml`）：
```yaml
external:
  wps:
    app-id: ${WPS_APP_ID}
    app-secret: ${WPS_APP_SECRET}
    callback-base-url: ${WPS_CALLBACK_BASE_URL}
```

---

## 前端集成

### WpsEditor 组件

**位置**：`frontend/src/components/WpsEditor.vue`

**Props**：
- `fileId` (String, required)：文件唯一标识
- `fileName` (String, required)：文件名（用于判断文件类型）
- `appId` (String, required)：WPS AppID
- `mode` (String, default: 'edit')：编辑模式，`'edit'` 或 `'view'`
- `userId` (String, optional)：用户 ID，用于生成 token
- `containerId` (String, optional)：容器元素 ID，默认自动生成

**Events**：
- `@ready`：编辑器初始化成功，参数为 WPS 实例对象
- `@error`：编辑器初始化失败，参数为错误对象
- `@fileOpen`：文件打开事件
- `@fileSave`：文件保存事件

**使用示例**：

```vue
<template>
  <view class="editor-wrapper">
    <WpsEditor
      v-if="ready"
      :file-id="fileId"
      :file-name="fileName"
      :app-id="appId"
      :mode="mode"
      :user-id="currentUserId"
      @ready="handleReady"
      @error="handleError"
    />
  </view>
</template>

<script>
import WpsEditor from '@/components/WpsEditor.vue'

export default {
  components: { WpsEditor },
  data() {
    return {
      ready: false,
      fileId: 'project_123_doc_1',
      fileName: '项目文档.docx',
      appId: 'SX20251208BJWRFK',
      mode: 'edit',
      currentUserId: '1780305141'
    }
  },
  methods: {
    handleReady(instance) {
      console.log('编辑器就绪', instance)
      // 可以监听更多事件
      instance.ApiEvent.AddApiEventListener('file.save', (data) => {
        console.log('文件已保存', data)
      })
    },
    handleError(error) {
      console.error('编辑器错误', error)
      uni.showToast({
        title: '加载编辑器失败',
        icon: 'none'
      })
    }
  }
}
</script>
```

### WPS SDK 工具类

**位置**：`frontend/src/utils/wps-sdk.js`

**主要函数**：

1. **`loadWpsSDK()`**：加载 WPS SDK
   ```javascript
   const SDK = await loadWpsSDK()
   ```

2. **`initWpsEditor(options)`**：初始化编辑器
   ```javascript
   const instance = await initWpsEditor({
     containerId: 'wps-container',
     appId: 'SX20251208BJWRFK',
     fileId: 'project_123_doc_1',
     fileName: '项目文档.docx',
     mode: 'edit',
     token: 'your-token'
   })
   ```

### API 接口

**位置**：`frontend/src/services/api.js`

**主要接口**：

1. **`createWpsSession(payload)`**：创建 WPS 会话
   ```javascript
   const session = await createWpsSession({
     fileId: 'project_123_doc_1',
     userId: 'user_123' // 可选
   })
   // 返回：{ token, fileId, userId, timestamp }
   ```

2. **`getWpsCallbackBaseUrl()`**：获取回调网关地址
   ```javascript
   const { callbackBaseUrl } = await getWpsCallbackBaseUrl()
   ```

---

## 后端集成

### WpsService

**位置**：`backend/src/main/java/com/checkba/service/WpsService.java`

**主要方法**：

1. **`generateSessionToken(fileId, userId, timestamp)`**：生成会话 token
   ```java
   String token = wpsService.generateSessionToken("project_123_doc_1", "user_123", timestamp);
   ```

2. **`generateEditUrl(fileId, fileName, mode)`**：生成编辑链接（URL 直连方案）
   ```java
   String url = wpsService.generateEditUrl("project_123_doc_1", "文档.docx", "edit");
   ```

3. **`getCallbackBaseUrl()`**：获取回调网关地址
   ```java
   String baseUrl = wpsService.getCallbackBaseUrl();
   ```

### WpsApiController

**位置**：`backend/src/main/java/com/checkba/controller/WpsApiController.java`

**接口列表**：

1. **`POST /api/wps/session`**：创建会话
   ```json
   // 请求
   {
     "fileId": "project_123_doc_1",
     "userId": "user_123"  // 可选
   }
   
   // 响应
   {
     "token": "ABC123...",
     "fileId": "project_123_doc_1",
     "userId": "user_123",
     "timestamp": 1701234567
   }
   ```

2. **`GET /api/wps/callback-base-url`**：获取回调网关地址
   ```json
   {
     "callbackBaseUrl": "https://your-domain.com"
   }
   ```

3. **`POST /api/wps/generate-url`**：生成编辑链接（URL 直连方案，不推荐）
   ```json
   // 请求
   {
     "fileId": "project_123_doc_1",
     "fileName": "文档.docx",
     "mode": "edit"
   }
   ```

### WpsController（回调接口）

**位置**：`backend/src/main/java/com/checkba/controller/WpsController.java`

**回调接口列表**（WPS 服务器调用）：

1. **`GET /v3/3rd/files/{file_id}`**：获取文件信息
2. **`GET /v3/3rd/files/{file_id}/permission`**：获取文件权限
3. **`GET /v3/3rd/files/{file_id}/download`**：获取下载地址
4. **`GET /v3/3rd/users`**：获取用户信息
5. **`POST /v3/3rd/notify`**：事件通知（保存、关闭等）
6. **`GET /v3/3rd/files/{file_id}/upload/prepare`**：准备上传
7. **`PUT /v3/3rd/files/{file_id}/name`**：文档重命名
8. **`GET /v3/3rd/files/{file_id}/versions`**：获取版本列表

---

## 回调接口说明

### 统一返回格式

所有回调接口必须返回以下格式：

```json
{
  "code": 0,           // 0 表示成功，非 0 表示失败
  "message": "",      // 错误信息（成功时为空）
  "data": { ... }     // 具体数据
}
```

### 关键接口详解

#### 1. 获取文件信息

**接口**：`GET /v3/3rd/files/{file_id}`

**响应示例**：
```json
{
  "code": 0,
  "message": "",
  "data": {
    "id": "project_123_doc_1",
    "name": "文档.docx",
    "size": 1024,
    "version": 1,
    "create_time": 1701234567,
    "modify_time": 1701234567,
    "creator_id": "1780305141",
    "modifier_id": "1780305141",
    "download_url": "https://your-domain.com/v3/3rd/files/project_123_doc_1/download"
  }
}
```

**注意事项**：
- `data.id` 必须与 `file_id` 完全一致
- 时间戳使用秒级整数（Integer）
- `download_url` 为可选字段

#### 2. 获取文件权限

**接口**：`GET /v3/3rd/files/{file_id}/permission?user_id={user_id}`

**响应示例**：
```json
{
  "code": 0,
  "message": "",
  "data": {
    "read": 1,        // 1 表示允许，0 表示禁止
    "write": 1,
    "update": 1,
    "rename": 1,
    "history": 1,
    "copy": 1,
    "print": 1,
    "download": 1,
    "saveas": 1,
    "user_id": "1780305141"  // 当前编辑者 ID（当 write=1 时必须返回）
  }
}
```

**注意事项**：
- 权限字段必须使用数值 `1` 或 `0`，不能使用布尔值
- 当 `write=1` 或 `update=1` 时，必须返回 `user_id`

#### 3. 获取用户信息

**接口**：`GET /v3/3rd/users?user_ids=1&user_ids=2`

**响应示例**：
```json
{
  "code": 0,
  "data": [
    { "id": "1780305141", "name": "用户1780305141" },
    { "id": "1780305142", "name": "用户1780305142" }
  ]
}
```

---

## 常见问题

### 1. 编辑器加载失败

**症状**：前端显示"编辑器加载失败"

**可能原因**：
- WPS SDK 文件路径错误
- 容器元素未渲染完成
- 网络问题导致 SDK 加载失败

**解决方案**：
- 检查 `static/web-office-sdk-solution-v2.0.7.umd.js` 文件是否存在
- 确保在 `$nextTick` 后再初始化编辑器
- 检查浏览器控制台错误信息

### 2. 回调接口返回错误

**症状**：WPS 控制台显示回调接口错误

**可能原因**：
- 回调地址不可访问（内网穿透未启动）
- 返回格式不符合要求
- 权限字段类型错误（使用了布尔值而非数值）

**解决方案**：
- 确保回调网关地址公网可访问
- 检查返回格式是否为 `{ code, message, data }`
- 权限字段使用 `1` 或 `0`，不要使用 `true/false`

### 3. 文件无法保存

**症状**：编辑后无法保存

**可能原因**：
- 上传接口未实现
- 文件权限配置错误

**解决方案**：
- 实现 `POST /v3/3rd/files/{file_id}/upload` 接口
- 检查权限配置中 `write` 和 `update` 是否为 `1`

### 4. 跨域问题

**症状**：浏览器控制台显示 CORS 错误

**解决方案**：
- 后端控制器添加 `@CrossOrigin(origins = "*")`
- 或配置全局 CORS 过滤器

### 5. Token 验证失败

**症状**：回调接口收到 `X-Weboffice-Token` 但验证失败

**说明**：
- Token 完全由业务方自定义，WPS 不会验证
- 可以在回调接口中自行验证 token 的有效性

---

## 关键注意事项

### 1. 回调地址必须公网可访问

- 本地开发可使用内网穿透工具（如 cpolar、ngrok）
- 生产环境必须使用 HTTPS 域名

### 2. 文件 ID 规范

- 建议使用业务相关的唯一标识，如：`project_{projectId}_doc_{docId}`
- 避免使用特殊字符，建议使用字母、数字、下划线

### 3. 用户 ID 一致性

- 后端代码中的 `DEFAULT_USER_ID` 必须与 WPS 控制台"人员配置"中的用户 ID 一致
- 当前配置：`1780305141`

### 4. 时间戳格式

- 回调接口中的时间戳使用**秒级整数**（Integer），不是毫秒
- 示例：`1701234567` 而不是 `1701234567000`

### 5. 权限字段类型

- 必须使用数值 `1` 或 `0`，不能使用布尔值 `true/false`
- 错误示例：`"read": true`
- 正确示例：`"read": 1`

### 6. 返回格式统一

- 所有回调接口必须返回 `{ code, message, data }` 格式
- `code=0` 表示成功，非 0 表示失败

### 7. SDK 加载时机

- 建议延迟加载，不要一进入页面就加载编辑器
- 等待用户点击"开始编辑"按钮后再加载，提升首屏性能

### 8. 容器元素要求

- 容器元素必须已渲染到 DOM 中
- 使用 `$nextTick` 或 `setTimeout` 确保 DOM 就绪
- 容器必须有明确的宽高（不能为 0）

### 9. 文件类型判断

- 根据文件扩展名自动判断类型（`.docx`、`.xlsx`、`.pptx`、`.pdf`）
- 默认类型为 Word（`.docx`）

### 10. 生产环境配置

- 使用环境变量管理敏感信息（AppID、AppSecret）
- 回调地址使用 HTTPS
- 配置日志记录，便于排查问题

---

## 参考文档

- [WPS 开放平台文档](https://solution.wps.cn/docs/)
- [WPS JS SDK 快速开始](https://solution.wps.cn/docs/web/quick-start.html)
- [WPS 回调接口文档](https://solution.wps.cn/docs/callback/)

---

## 更新日志

- **2025-12-10**：初始版本，完成基础集成
  - 实现 JS SDK 方案
  - 完成所有必需的回调接口
  - 创建可复用的 Vue 组件

---

**维护者**：开发团队  
**最后更新**：2025-12-10

