# Electron 30 → 45：安装版云端兼容回归

任务：dev-board#1624；用户要求重新评估兼容风险，并在云电脑完整回归，仍不发版。

## 被测对象与证据边界

- 真实签名候选：desktop-build run [40979426877](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40979426877)，源码 `99d1de556aed9ade66b548e8804edf684b82554d`，应用 0.74.0 / Electron 45.1.0。与正式旧 0.74.0 的运行时不同，不能只凭应用版本号辨认。
- 本轮在 GitHub hosted Windows Server 2025 x64 / macOS 15 / 26 ARM64 的一次性用户中安装候选。不是本机客户端，也不是浏览器模拟界面。安装件验签、源码来源、运行进程、随包 JRE/JAR/H5/LOWA 均核对；不改动签名包。
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

## 运行结果

固定候选的 Windows Server 2025 x64、macOS 15 / 26 ARM64 已完整通过。这里的“完整”限于上表验收矩阵，不包括下节列出的未覆盖范围。

| 路径 | 云端证据 | 结果 |
| --- | --- | --- |
| Windows Server 2025 x64 完整安装回归 | [40989215371](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40989215371) | 通过；工具 251399c7e |
| macOS 26 ARM64 完整安装回归 | [40989215371](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40989215371) | 通过；工具 251399c7e |
| macOS 15 ARM64 完整安装回归 | [40989276731](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40989276731) | 通过；工具 251399c7e |
| Windows 原生 Restart 升级 | [40982441616](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40982441616) | 通过；旧版 0.73.0 → 本候选 |
| Windows 原生 Quit 升级 | [40986308883](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40986308883) | 通过；普通退出安装、不自动重启，之后手动打开 |
| macOS 15 原生 Quit 升级 | [40988640988](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40988640988) | 通过；工具 5eddfd97e，普通退出、ShipIt 换件、手动打开 |

三个系统的完整结果均为 `passed:true`、`forcedSaveUsed:false`、`forced:false`；三格式均 `normalAutosave:true`、`appRestartRetained:true`。浏览器、文本/PNG 剪贴板、关于窗口、原生全屏进入/退出全部通过。主任务已阅读三个系统的实际 JSON，核对两次普通退出均 0、进程消失和端口释放；实际审阅 Mac 15 / 26 的三格式整应用重启与 PDF 第二页截图，以及此前同一 Windows 候选的对应截图。中文、Word 粗体、PPT 原标题/正文均可见；Excel 公式及内容另由模型回读核对。Mac 26 的 PDF 首次打开和关页重开均显示第一页，滚动后显示第二页。

原生升级核对原项目/文档标识、原文件哈希及偏好保留。Mac 两次普通退出均返回 0、无 signal，`cleanupErrors` 为空，未强杀客户端；主任务读取结果并查看重开截图。

候选安装件 SHA-256：

- Windows：`8a2d7df57ce750a4a2a9d2fa519099a25dfe60a789cb63c5caba6caf9972cb03`。
- Mac DMG：`5de4278d654547d116ef6f9b4d39a9629369dd427f2f458691b8cdbf8867262c`。

## 排查过程与结论限制

本轮新增的是安装版测试工具和记录，没有再修改候选产品代码。较早失败均保留，不能用最终成功覆盖其历史：

- Mac 初轮主窗口进入网页登录页，bridge 未暴露；preload 实际路径、文件及 SHA 与源码一致，失败后的隐藏诊断窗能加载同一脚本。加入首次求值前等待原生导航完成后，后续启动及原生升级通过。不过本机早期 CDP 等最小对照未复现，不能断言这是唯一根因。`getLastWebPreferences()` 不返回 preload 本身不代表漏打包。
- [macOS 15 输入定位](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40985737867) 与 [macOS 26 对照](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40987354542) 均启动及 Word 保存成功，Calc 模型 B2 却为空。DOM 聚焦与输入事件不能证明原生编辑引擎已激活。补实际画布点击、验证选区变化后，[40988421079](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40988421079) 的 Calc 模型/普通自动保存/关页重开通过，同轮 PPT 仍失败；PPT 同样补正常画布点击后，最新 macOS 26 整轮通过。未直接写模型、未强制保存。
- [早期原生 Mac 升级 40982437060](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40982437060) 换件成功但候选工作台启动失败，清理阶段拖到任务超时，仍记失败。测试工具补了先落失败证据、有界 TERM/KILL 清理、残留连接退出看门狗；正常退出和强制清理分开计，强杀绝不算通过。主任务及代理用 Node 24 合成正常退出、拒绝 TERM、WebSocket 不回应关闭、残留 TCP 等场景核对，产品客户端没有在用户本机运行。
- 最后清理检查复跑 [40991127883](https://github.com/AI-WorkDeck/aiworkdeck/actions/runs/40991127883) 的 Windows 在 Word 自动保存后，Puppeteer 初始化某个 webview 的 `Network.enable` 超时，整轮仍记失败；正常退出成功。旧工具遍历所有 webview，可能先初始化正在销毁的旧页或预热页，且失败时未留下目标身份，不能把旧页假设当成已证根因。现改为当前编辑器 WebContents ID → Electron 公共 `getOrCreateDevToolsTargetId()` 精确定位，并保留目标列表与身份；不会重试忽略同一个目标的初始化失败。
- Electron 44.10.0 仅作诊断分支 `codex/electron-44-compat-1624`，未采用。其本机 703 通过、5 跳过，但 BrowserView 截图探针两次报 UnknownVizError；签名对照构建 40987918299 已取消释放资源，不能声称完成 44 签名包对照，也不据此认定 45 缺陷。
- 客体日志含 Qt `QObject::connect ... invalid nullptr parameter` 及几何输出，不能声称 console 完全无错误；当前功能断言和正常保存/退出分别验收。截图中的 Update incomplete 来自本测试禁用正式更新源，不作为升级通过证据；原生升级另用一次性测试源独立验证。

## 仍需实体环境 / 特定系统验证

- 当前脚本用 CDP composition 走真实编辑器输入链，但不驱动 macOS/Windows 的真实中文输入法候选窗。
- 下载通过 DownloadItem.setSavePath 自动选择目的地，不覆盖系统保存框取消/覆盖交互。
- macOS 13 最低系统、Windows 10/11 实体环境、Windows ARM64 实际设备、多屏/DPI、休眠唤醒、打印机、系统权限拒绝后授予、麦克风与摄像头设备。
- 无需账号的桌面能力是本轮范围；真实登录、付费模型、可选服务包全部业务能力不能因 Electron 核心回归通过而一并宣称已通过。
