# WPS 迁移至本地 LibreOffice 方案 (桌面版 IDE 模式)

## 1. 核心目标
将现有的 `Checkba Cloud` 从依赖 WPS Web Office 的**在线模式**，转型为类似 IDE 的**本地桌面应用模式**。
**关键要求：**
-   **本地化 (Local)**: 数据不上传服务器，直接读写用户本地磁盘文件。
-   **无服务 (No Serverless/Offline)**: 不依赖在线的 WOPI 服务或 WPS 云服务。
-   **IDE 体验**: 用户在软件内打开文件夹，左侧文件树，右侧直接编辑文档。

---

## 2. 技术选型与架构

由于需要直接操作本地文件且无需上传，推荐使用 **Electron** 作为应用壳，集成 **LibreOffice WASM** 或 **本地调用模式**。

### 2.1 推荐方案：Electron + LibreOffice WASM (ZetaOffice / LOWA)
利用最新的 WebAssembly 技术，将 LibreOffice 核心直接运行在 Electron 的渲染进程（浏览器环境）中。

*   **架构原理**：
    *   **主进程 (Main Process)**: 使用 Node.js `fs` 模块直接读写本地磁盘文件。
    *   **渲染进程 (Renderer)**: 运行 `LibreOffice WASM` 实例。
    *   **数据流**: 主进程读取 `.docx` -> `ArrayBuffer` -> 传递给 WASM -> 编辑器渲染 -> 用户保存 -> `ArrayBuffer` -> 主进程写入磁盘。

*   **优点**:
    *   **真·本地运行**: 完全不依赖外部进程，体验最接近 "IDE 集成编辑器"。
    *   **零网络**: 即使断网也能完美工作。
    *   **安全**: 文件仅在内存和本地磁盘流转。

*   **缺点**:
    *   **性能**: WASM 版本首次加载较慢 (需加载数百 MB 资源)，运行效率略低于原生应用。
    *   **稳定性**: LibreOffice WASM 仍处于快速迭代期 (Refer to ZetaOffice / LOWA)。

### 2.2 备选方案：极简本地调用 (Launcher Mode)
只做文件管理，编辑时唤起系统安装的原生 LibreOffice。

*   **原理**: Electron 仅作为文件浏览器，双击文件时使用 `child_process.spawn` 调用本地安装的 LibreOffice 打开文件。
*   **优点**: 性能最好，兼容性完美，开发成本极低。
*   **缺点**: 无法实现 "嵌入式 IDE" 体验，编辑器是独立窗口，与主程序分离。

---

## 3. 详细迁移实施计划 (基于 WASM 嵌入方案)

### 第一阶段：桌面端环境搭建
1.  **引入 Electron**:
    如果当前项目仅为 Web 前端，需引入 Electron 构建桌面壳。
    *   目录结构调整：`frontend/` -> `electron-app/renderer/`
2.  **集成 LibreOffice WASM**:
    *   下载 `LibreOffice WASM` 构建包 (或使用 ZetaOffice SDK)。
    *   将其资源文件 (`.wasm`, `.data`, `.js`) 放入 Electron 的 `public/static` 目录。

### 第二阶段：文件系统桥接 (IDE 核心能力)
实现类似 VS Code 的文件读写能力。

**1. 替换 `WpsController` 为 `LocalFileService` (Node.js)**
由于不再需要后端 Java 服务处理文件，所有文件操作移至 Electron 主进程：

```javascript
// electron/main/file-service.js
const fs = require('fs/promises');
const { ipcMain } = require('electron');

// 监听前端读取请求
ipcMain.handle('fs:readFile', async (event, filePath) => {
  return await fs.readFile(filePath); // 返回 Buffer
});

// 监听前端保存请求
ipcMain.handle('fs:writeFile', async (event, { filePath, data }) => {
  await fs.writeFile(filePath, data);
  return { success: true };
});
```

**2. 前端适配层**
修改 `frontend` 代码，拦截 API 请求，改为调用 IPC：

*   **原代码 (Web)**: `axios.get('/api/files/content')`
*   **新代码 (Desktop)**: `window.electronAPI.readFile(filePath)`

### 第三阶段：编辑器组件替换
创建新的 `LocalEditor.vue` 组件替换 `WpsEditor.vue`。

**组件逻辑：**
1.  **初始化**: 加载 WASM 模块 (`Module.init(...)`).
2.  **加载文件**:
    *   调用 `window.electronAPI.readFile(path)` 获取二进制流。
    *   将流写入 WASM 虚拟文件系统 (Emscripten FS)。
    *   通知 LibreOffice 打开该虚拟路径。
3.  **保存文件**:
    *   监听编辑器的 "Save" 事件。
    *   从 WASM 虚拟文件系统读取修改后的二进制流。
    *   调用 `window.electronAPI.writeFile(path, stream)` 覆盖本地文件。

### 第四阶段：功能对齐 (AI 与 高级功能)
*   **AI 读取选区**:
    *   LibreOffice WASM 可能不直接暴露 "获取选区文本" 的 JS API。
    *   **替代方案**: 需通过 `Uno Command` (如 `.uno:Copy`) 将选区复制到剪贴板，然后 Electron 读取剪贴板内容传给 AI。
*   **书签/超链接**:
    *   需查阅 LibreOffice WASM 提供的 JS 绑定能力，或使用 Uno 命令进行操作。

---

## 4. 方案对比表

| 特性 | 原 WPS Web 方案 | LibreOffice WASM (推荐) | 调用原生 LibreOffice |
| :--- | :--- | :--- | :--- |
| **部署方式** | 在线/私有化部署服务端 | **内置于桌面客户端** | 需用户单独安装 Office |
| **文件存储** | 上传至服务器 | **直接读写本地磁盘** | 直接读写本地磁盘 |
| **编辑体验** | 浏览器内嵌入 | **应用内嵌入 (IDE感)** | 弹出独立窗口 |
| **网络依赖** | 强依赖 | **完全离线** | 完全离线 |
| **AI 能力** | SDK 易获取选区 | 需通过剪贴板/Uno命令中转 | 难交互 (跨进程) |
| **开发难度** | 低 (SDK 成熟) | **高 (WASM 集成复杂)** | 极低 |

## 5. 建议下一步
1.  **确认技术栈**: 确认项目是否接受引入 **Electron** 打包桌面端。
2.  **原型验证**: 优先尝试运行 LibreOffice WASM 的 Hello World Demo，验证在 Electron 中的加载速度和中文输入支持情况。
3.  **开始迁移**: 如果验证通过，按上述 "第三阶段" 开始改造编辑器组件。
