# Electron 30 → 45：安装版云端兼容回归

任务：dev-board#1624；用户要求重新评估兼容风险，并在云电脑完整回归，仍不发版。

## 被测对象与证据边界

- 真实签名候选：desktop-build run [40868894223](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40868894223)，源码 `ab8317c5a125f695aee58271adb22ee63f787f93`，应用 0.74.0 / Electron 45.1.0。与正式旧 0.74.0 的运行时不同，不能只凭应用版本号辨认。
- 本轮在 GitHub hosted Windows x64 / macOS ARM64 的一次性用户中安装候选。不是本机客户端，也不是浏览器模拟界面。安装件验签、源码来源、运行进程、随包 JRE/JAR/H5/LOWA 均核对；不改动签名包。
- 测试工具来自本 PR，产品来自上述固定构建。不能将通过结果扩展为任意后续 master 产物已验证。
- 无发布标签、Release、部署或用户客户端升级。所有测试文件均为合成材料；不登录用户账号，不调用付费模型。

## 兼容风险复核

按 [Electron 官方 breaking changes](https://www.electronjs.org/docs/latest/breaking-changes) 对照 31–45 及项目调用点；以下为代码审阅结论，不替代运行证据。

| 变化 / 风险 | 项目处理与回归要求 |
| --- | --- |
| 44：剪贴板读写改异步 / ClipboardItem | 升级 PR 已修轮询、Blob 解码、迟到结果取消与首轮预读。云端补真实系统文本/PNG→生产 IPC→入库→卡片；图片核对像素。 |
| 44：macOS 最低版本提高到 13 | 包元数据已声明 13；macOS 12 及更旧不在升级支持范围。当前云端系统不证明最低 13 已验证。 |
| 42：Electron 二进制不再靠自身 postinstall 下载 | 已显式 install-electron，CI Node 24。现有双平台构建已通过。 |
| 45：sandbox preload 移除 Node 垫片 | 项目 preload 只 require Electron；已验生产 preload 的 IPC/文件路径。保持 sandbox，不关闭安全边界求通过。 |
| 32：File.path 移除 | 已用 webUtils.getPathForFile；运行时探针通过。原生系统拖入另列范围。 |
| BrowserView / 旧导航 API 废弃 | 45 尚未移除，不为本轮升级重构生命周期。补实际面板后退、前进、刷新、弹窗转标签和下载。 |
| 41：Chromium PDF 实现变化 | 使用真实 FilePreview iframe 路径；打开、滚动、关闭重开后人工审阅截图。此路由只读，不宣称 PDF 批注保存通过。 |
| Chromium 字体、焦点、WASM / worker | 四格式真实画面；DOCX/XLSX/PPTX 中文合成输入、普通自动保存、重开、完整退出重启再核对。保留 Word 粗体、原正文、表格公式与 PPT 未编辑内容。 |
| Node 24 / 原生依赖 | 桌面代码未检出直接加载 .node；Java/Python/LOK 是独立进程，不能当 Electron ABI 模块。核验随包 JRE 运行和普通退出后端口/进程释放。 |
| 下载目录、原生通知、屏幕与录音权限 | 本轮下载测试自动选定目的地并核对真实字节；系统保存框、系统通知可见性、隐私授权拒绝/恢复、实体音视频设备另列未验证。 |

[BrowserView 官方状态](https://www.electronjs.org/docs/latest/api/browser-view)仍为 deprecated；[ClipboardItem 官方说明](https://www.electronjs.org/docs/latest/api/clipboard-item)说明 MIME/Blob 和文件引用语义。未发现必须追加修改的确定 API 调用，不代表所有使用场景无缺陷。

## 本轮验收矩阵

| 路径 | 成功标准 |
| --- | --- |
| 安装与启动 | 原生安装件签名、发布主体、源码 SHA、实际 Electron 版本、app.isPackaged、内置后端身份吻合；窗口可见。 |
| Word | 正文可见，中文组合输入落入真实 LOWA，普通自动保存后磁盘已有标记，原正文/粗体保留，关页与整应用重开均可回读。 |
| Excel | 原单元格/公式保留，B2 输入保存，关页和应用重开后 A1:C2 回读正确。 |
| PPT | 真实幻灯片文本框输入，原标题/其他正文保留，普通自动保存，关页与应用重开可读。 |
| PDF | 打开与第二页滚动截图、关闭重开截图人工复核；源文件哈希不变仅证明未改原稿，不能单独判视觉通过。 |
| 浏览器 | 页面链接、产品工具栏 back/forward/reload、window.open→新标签；真实下载内容逐字节匹配。 |
| 剪贴板 | OS 中文文本/PNG→生产轮询/preload→后端记录→可见卡片；PNG 像素保持。 |
| 关于窗口 | 真实应用菜单动作打开，许可/版本/三个链接存在，Escape 可关闭。 |
| 退出重启 | 普通 app.quit 返回 0，无强杀，相关后台进程消失、端口释放；重启后偏好和三类文档内容仍在。 |

运行记录与逐项结果将在云端运行完成、截图审阅后填入；脚本存在、语法通过或 ready 事件不能代替完成。

## 仍需实体环境 / 特定系统验证

- 当前脚本用 CDP composition 走真实编辑器输入链，但不驱动 macOS/Windows 的真实中文输入法候选窗。
- 下载通过 DownloadItem.setSavePath 自动选择目的地，不覆盖系统保存框取消/覆盖交互。
- macOS 13 最低系统、Windows ARM64 实际设备、多屏/DPI、休眠唤醒、打印机、系统权限拒绝后授予、麦克风与摄像头设备。
- 无需账号的桌面能力是本轮范围；真实登录、付费模型、可选服务包全部业务能力不能因 Electron 核心回归通过而一并宣称已通过。
