---
name: eng-infra
description: 工程基建领域。任务涉及构建、发版、CI workflow、签名公证、测试体系（lowa-e2e/app-e2e/desktop-e2e/mvn test）、本地开发启动、Docker 附属服务时，先读本文档再动代码。
---

# 工程基建 领域地图

职责边界：构建/发版/CI/测试/本地开发。各领域自己的业务测试内容见对应领域文档。

## Electron 45 运行时（dev-board#1624）

桌面壳固定 Electron **45.1.0**（Chromium 156 / Node 24），应用版本号与运行时版本独立。开发安装要求 Node >=22.12.0；桌面 CI/打包使用 Node 24。Electron 42 起不再通过包自身 postinstall 自动下载二进制，项目 postinstall 必须先执行 `install-electron`，再执行既有 DMG/NSIS 补丁；不得用跳过安装脚本掩盖缺少运行时。保留 electron-builder 24.13.3 及其已验证补丁。

Electron 44 起最低 macOS **13 Ventura**，`build.mac.minimumSystemVersion` 与此一致；本项目仍仅构建 Mac ARM64。BrowserView 和旧导航方法在 45 中仍可用但已弃用，本轮保留现有生命周期。浏览器面板 UA 从当前运行时取得并去掉 Electron 标记，不再伪装成固定 Chrome 120/macOS。

验证命令：`npm --prefix desktop test`；`npm --prefix desktop run test:runtime-compat`（独立临时 profile，生产 preload/BrowserView、文件路径、下载、WASM/shared-memory/worker）；`npm --prefix desktop run test:backend-request-gate-e2e`。`test:clipboard-compat` 会替换系统剪贴板，仅允许 GitHub 托管 runner，禁止本机绕过保护。desktop-build 在两平台构建前运行以上冒烟并保留剪贴板结果。手动 workflow_dispatch 仅构建测试产物，release/sync-mirror 仍只允许版本 tag；本轮升级不代表获准发版。

四格式 macOS 源码验收：完成 H5、zetaoffice、LOWA 资源及后端 JAR 构建后，用 JDK 21 执行 `node frontend/tests/desktop-e2e/electron-upgrade.mjs`。可用 `AWD_BASELINE_ELECTRON` 指定旧版 Electron 可执行文件，只用于生成全新合成 profile；不传用户配置目录。脚本生成 Word/Excel/PPT/PDF、隔离并回读所有应用路径与 Java home/H2/storage/端口，实际 IME 输入后等待正常自动保存落盘再关闭重开。PDF 当前 FilePreview 为 Chromium iframe，查看/翻页须人工复核截图；不能把 source-hash 不变当成视觉通过，也不能将该测试称为 PDF 批注保存验证。CDP 虚拟 viewport 与原生 webview 坐标可不一致，保留原生窗口大小；只收到 ready 不算正文显示。签名原生升级另用全新托管用户的 full-upgrade 工作流。

安装包云端回归：`.github/workflows/electron-cloud-regression.yml` 在全新 GitHub hosted macOS ARM64 / Windows x64 上运行同一四格式脚本（`AWD_TEST_INSTALLED=1`），通过候选构建 run/SHA/版本锁定并验签真实安装包，使用随包 JRE/JAR、H5 和 LOWA，不替换源码或签名包。`installed-electron-helper.mjs` 负责安装/身份/普通退出重开，`installed-desktop-interactions.mjs` 检查生产 BrowserView、下载、剪贴板采集及卡片、关于窗口。它会操作系统剪贴板，只能在一次性托管用户运行；证据根目录必须在 RUNNER_TEMP 内。四格式文件先正常自动保存再关闭重开，并再核对整应用重启后内容；PDF 截图仍需人工复核。CDP IME 合成输入不代表系统候选窗，DownloadItem.setSavePath 不代表原生文件选择框；硬件权限、macOS 13 最低系统及 Windows ARM64 单列未验证。手动输入指定被测安装包来源；PR 默认候选固定在 #1624 升级包，不声称测试了该 PR 的产品源码。

## CI（.github/workflows/）

- **ci.yml**（push master + 所有 PR）：三并行 job——backend（temurin **21**，`mvn -B test`）、frontend（node 20，`check:emits` + `check:locales` + `check:nav:full` + `test:project-home` + `test:commands` + `build:h5`）、desktop（仅 `npm ci`）。不打安装包。
- **desktop-build.yml**（发版主 workflow）：触发 = workflow_dispatch / tag `v*` / PR 改动 desktop|backend|frontend|pptx-service 路径（pptx-service 于 2026-09-09 补入，PR#766：它的源码与 requirements.lock 原样进包，re-vendor 类 PR 必须跑打包冒烟）。矩阵：tag 或手动 = mac+win；**普通 PR 只跑 windows**（mac runner 1h+）。每平台步骤顺序（**不可乱**，PR#176）：build:h5 → build:zetaoffice → fetch-lowa-assets（LOWA_BASE_URL=自建 zh-CN 引擎 24.2.8-zhcn-r2）→ desktop npm test → mvn package(-Djavacpp.platform) + prepare-backend(jar+jlink JRE) → CPython 运行时 `prepare-python-service.js --runtime-only 1`（**0.38.0 起四个 Python 服务不再随包**，见下「Python 运行时 pack」） → **(mac)sign-mac-natives.sh → 冒烟（backend /api/admin/wizard 120s；四个 Python 服务的冒烟移到 pack-release.yml 的 runtime 腿）** → electron-builder（mac 签名+公证，先抬 maxfiles/ulimit 524288 防 EMFILE；win 走 Azure Artifact Signing，tag/手动才签，见 4.3）→ 失败时 notarytool history/log 打印 Apple 拒因 → upload-artifact（dmg/exe + windows 腿单独产的 patch/*）。**发布收口在独立的 `release` job**（`needs: [build]`；`always()` 避免 tag 上 PR 专属祖先 job 的跳过传播，再显式检查 `!cancelled()`、`needs.build.result == 'success'` 和 tag，build 任一矩阵腿失败则不发布；`sync-mirror` 同样显式要求 release 成功，dev-board#74/#1399）：下载两平台 artifact 合并后统一跑 softprops/action-gh-release 附 dmg/exe/patch + 双语 body。
- **star-history.yml**（周一 cron）：重画 star SVG 强推 star-history 分支。

构建字体来源补充（2026-10-27）：NotoSansKhmer 的旧 jsDelivr/googlefonts 路径实际返回 403；`fetch-lowa-assets.js` 仅该字体改为规范仓 notofonts/noto-fonts 的固定提交 raw URL，仍执行原字体校验，不影响运行时离线加载。

## 关于窗口与更新准备状态（dev-board#1401/#1402）

`app-menu.js` 的关于入口使用 `about-window.js` 独立本地窗口，原生 About 的固定 copyright 区无法容纳完整双语许可文案。新窗口正文可换行/滚动、版本仅显示一次；保留版权、AGPL、源码/许可证/商标链接与说明。无脚本、sandbox/contextIsolation 开启，只允许三个固定法律链接交给系统浏览器，重复打开复用窗口。浅色/深色从 `design/tokens/awd-palette.json` 生成 --awd-* 角色令牌快照，测试逐项对拍；更新色源须同步该快照。验证：`desktop/tests/about-window.test.js`，真实窗口用 Electron 运行 `desktop/tests/about-window.electron.js`（独立 profile，不启动产品后端）。

完整更新字节与哈希校验后、`prepareInstaller` 返回前，`update-service.js` 必须广播 `preparing`，只有原生准备成功才 `ready`。前端顶部/设置均覆盖该阶段；主页面就绪不自动弹重启确认，用户点击沿用已有保存/退出守卫。缺平台安装包退回手动下载时也必须广播最终 idle/major-available 快照，不能停在 checking。

## 发版链路

- 0.72.0 发布准备（dev-board#1516）：LOWA `24.2.8-zhcn-r7` 使用 #1515 的最终 r7b 候选，发布前已在北京、新加坡逐文件解码哈希和 metadata 大小校验。官方插件改资源后必须递增 manifest 版本，避免同版本保留策略让旧用户漏更；JAR 插件同时同步 pom 与 backendJars。独立插件 ZIP 与桌面 extraResources 都须包含 `l10n/`，构建后检查真实包内语言文件。

- **Mac 原生升级的 JRE 权限（dev-board#1368，验收总卡 #1367）**：jlink 产出的 `jre/legal/` 中部分许可证为 `0444`。真实签名升级 run `39217849923` 已证明 ShipIt 在复制候选包后、验签/接管文件前清除 quarantine 时对 `java.xml/bcel.md` 报 `EACCES`，重试三次后放弃。`desktop/scripts/after-pack.js` 现在只给该目录内普通文件补 owner-write，保留内容、其他权限和符号链接，发生在外层 app 签名前；不可在验收时 chmod 已签名候选包来掩盖问题。`after-pack.test.js` 包含 macOS 真实 xattr 红绿复现；修复后仍须重打签名候选并跑 `full-upgrade-mac-smoke.yml`，原成功交接 ShipIt 的 0.65 baseline 可保留。该 smoke 在 ShipIt 明确终止重试时立即失败并保存原因，避免再空等十分钟。

0. **版本规则 0.X.Y**（docs/INCREMENTAL_UPDATE_DESIGN.md）：X=大版本全量安装包；Y=小版本应用内补丁（overlay 机制，组件=backend-app/frontend-h5/zetaoffice-wrapper）。小版本 tag 触发 CI `patch-gate` job（desktop/scripts/patch-gate.sh）：改壳（desktop/）、pom、LOWA 引擎、requirements.lock、`backend/skills/` 都会被拒；内置 skill 需全量版本，requirements.lock 改动走独立 pack 发版。补丁产物+签名 manifest 由 build-patch-assets.js 在 windows job 生成（私钥=secret UPDATE_SIGNING_KEY，备份 ~/.ssh/aiworkdeck_update_signing.pem；公钥内置 update-service.js，换钥须发大版本）；镜像同步 deploy/update-mirror-sync.sh 在官网 ECS 跑。
0.1. **服务上下文必须传 `appVersion: app.getVersion()`（dev-board#589）**：backendLayout 与 UI 的 overlay 使用不同调用链。漏传时 UI 显示补丁已更新，但后端因无法解析大版本目录而静默回落内置 app.jar。回归必须运行 main.js 的实际 createServices，再验证 backendLayout 读取激活补丁及回滚；只单测 overlay 不足以覆盖接线。旧 0.38 壳存在此缺陷，脱敏 2.0 必须先装完整 0.38.4；修复随 0.39.0 全量版本交付，不能用旧壳自身的补丁修复。
0.2. **桌面端默认关闭自动 AI 标签（dev-board#590，0.39.0）**：上传、本地导入及编辑器保存共用 AutoTaggingService；脱敏前 flushSave 也会经过此链路。`application-desktop.yml` 设置 `ai.auto-tagging.enabled: false`，在读取正文和调用模型之前返回，避免原文先被自动发送。云端默认行为及手动标签不变。DesktopAutoTaggingPrivacyTest 加载真实 desktop 配置，验证入口不读正文、不调用模型。0.38.4 仅供合成样例测试，真实敏感材料需完整 0.39.0；普通 AI 会话仍须由用户核查项目和历史上下文。
0.3. **完整版本退出安装（dev-board#1356）**：`update-service.js` 继续先验证 Ed25519 清单；`channels[major].installers` 的 `darwin-arm64` / `win32` 含 `{version,size,sha256,urls}`，只接受更新版本并流式校验完整字节。沿用现有 DMG/NSIS 和 `/update/desktop/installers/` 镜像；`installers/latest.json` 没有签名，仍仅供官网，不作为客户端安装信任依据。`finalize-update-manifest.js` 在 release job 收齐两个平台后验证原清单签名、绑定实际产物哈希并重新签名，任一平台缺失不发布。旧壳不具备完整安装能力，首次仍需安装包含本改动的完整版本；不得声称补丁能升级旧壳。
   - Mac：`full-update.js` 挂载已校验 DMG、核对 plist 版本、用系统 ditto 转本地 ZIP，由 Electron 内置 Squirrel.Mac 经随机路径的回环 HTTP 校验签名并准备安装；只在 `update-downloaded` 后 ready。正常退出不调用 `quitAndInstall`（ShipIt 随下次启动应用更新），主动重启才调用；签名身份变更可能拒绝自动升级，不能删除签名校验。签名拒绝、替换/回退由原生更新器负责，单测替身不证明正式签名安装成功。
   - Windows：`install-update.ps1` 复制到数据目录后运行（PowerShell 不认识 app.asar 路径），握手完成才退出；helper 等父进程退出，再次校验 SHA256 与 Authenticode，运行原 NSIS `/S --updated`。只在成功且用户主动重启/安装期间手动重开时启动。helper 存活期间启动锁阻止第二后端；超过20分钟提示检查安装器，不强杀。失败保留已验证下载件和 `.error`，下次状态读出；沿用 NSIS 的失败行为，不保证产品级回退，不能声称 Windows 安装失败自动恢复旧版。
   - 退出：`host.lifecycle.onPrepareQuit/onQuitCancelled/cancelQuit` 与主renderer的 `checkba:prepare-quit` / `quit-prepared` ACK 共用普通退出/更新重启。renderer暂停任务、保存dirty编辑器、等待项目级提交选择、再次确认保存后ACK；主进程只接受当前主窗口同requestId，60s保存超时/取消不隐藏或停服务。dev-board#1489 新增确认阶段通知，等待选择与提交期间暂停退出计时，取消恢复任务。完成ACK后才停后端再安装。Windows点X同样走此路径；Mac红叉先确认再隐藏并恢复暂停的任务，Dock激活恢复，Cmd+Q与关窗复用在途确认。
   - 验证：`update-service.test.js` 的本地签名HTTP、`full-update.test.js` 的真实回环feed/平台替身、`quit-lifecycle.test.js` 的实际主进程片段和ACK，以及 Windows CI 才运行的 helper 合成测试。正式签名Mac/Windows升级、Squirrel回退、Windows NSIS安装/安装期间快开须另外隔离实测，不可用源码测试替代；未获本次发版授权不打tag或部署。
   - 完整 Windows 验收入口：手动 `full-upgrade-smoke.yml` 指定成功的签名 Desktop Build run；`test-full-upgrade.ps1` 仅允许一次性 Actions runner，实际安装、启动、退出、升级并核对签名、后端 JAR、项目/文件 ID、正文及偏好持久化。`LegacyHelper` 只证明新 helper 兼容旧安装目录；`AppUpdater` 必须提供含新更新器的较低版本签名基线，分别验 Restart/Quit/Reopen。本地临时签名清单仅用于测试，不能替代生产清单验签；脚本存在不等于实测已通过，结果以对应 run 的 evidence.json 与截图为准。
   - 正式 tag 构建验收（dev-board#1523）：两套升级 workflow 均显式输入 baseline/candidate run、40 位源码 SHA 和版本；成功 `push` 构建仅在 `v<version>` 标签解引用提交与 run/输入 SHA 完全一致时接受。tag 包从正式 Release 读取，以该提交源码内置公钥验签 `manifest.json`，再验证安装包大小与 SHA256；Actions 临时 artifact 过期不要求重打正式包。手动构建仍走其唯一未过期 artifact。Mac feed 的版本跟随输入，不再固定 0.65→0.66。Windows 用 AppUpdater × Restart/Quit/Reopen；Mac 现有流程只覆盖普通退出后手动重开，不声称测过 Restart。证据单独保留测试工具提交与产物来源；临时更新 feed 不证明生产客户端自动更新清单信任链。
   - 完整 Mac 验收：`full-upgrade-mac-smoke.yml` 在全新 ARM64 GitHub-hosted GUI 用户下，用精确提交的两版真实签名包执行 Squirrel 下载准备、普通退出安装和手动重开，核对签名、候选 app.asar/JAR、项目与文件 ID、正文及偏好。仅改 HOME 或 Electron app 路径不足以隔离同用户的 ShipIt launchd job 与 Foundation 缓存，因此不得把本机 QA 路径隔离当成原生升级隔离；测试 feed 的临时签名不代表生产清单信任，真实 LOWA/AI 接续另外验收。
   - 原生拖拽 Windows 验收：`native-drag-smoke.yml` / `test-native-drag.ps1` 只在一次性 Actions runner 安装真实签名包，用 user32 鼠标拖普通文件和压缩包条目到独立 STA WinForms FileDrop 接收器，校验名称、复制哈希和拖拽后源文件，再用真实坐标点击文件行与关闭标签验证输入恢复。DOM/AX 点击可能绕过宿主鼠标失效，不能替代此检查；CDP 仅用于读取元素位置和结果。要求可访问输入桌面、100% DPI、落点未遮挡，失败保留截图，不把脚本存在当实跑通过。
   - 完整安装器清单 URL 使用发布资产名（空格换成点号），与 GitHub 上传及 `sync-mirror` 的命名一致；本地哈希仍读构建产物原名。不能直接对含空格的构建文件名做 URL 编码，否则两个下载地址都会指向不存在的资产（#1367）。
1. 版本号**单一来源 `desktop/package.json` version**（backend 拆为 backend/app.jar + backend/lib/，启动 `java -cp "app.jar:lib/*" com.checkba.CheckbaApplication`，见 backend-service.js javaLaunchArgs；frontend version 不参与）。
2. `git tag v<ver> && git push origin v<ver>` → 触发 desktop-build 双平台。auto 模式下 tag 推送不被分支保护拦；可用 Monitor 等 PR 合并后自动打 tag（v0.8.0 配方）。
3. 产物：mac 仅 dmg（**arm64 only**，已放弃 Intel）；win 仅 nsis exe——**单包双架构**（dev-board#341）：主体 x64 全量 + 纯 arm64 Electron 壳（desktop-build.yml 在打包前 `electron-builder --dir --arm64` 产出、剪掉 resources/ 后由 installer.nsh 的 customInstall 在 ARM64 机器上覆盖进安装目录；壳约 260MB 未压缩、装器 +约 106MB）。ARM64 上渲染与 LOWA WASM 原生、JVM/Python 走转译层（javacv/torch 无 windows-arm64 natives，这是为什么不出纯 arm64 包）；x64 机器行为不变；本地构建无壳目录自动降级纯 x64。electron-builder 配置在 desktop/package.json "build" 字段（appId com.aiworkdeck.desktop、extraResources 打入 frontend/dist、backend.jar、jre、python、pysvc.tar.gz+meta、**graphviz、skills（随包内置 skill，v0.11.1 以前漏打）、litviz（诉讼可视化引擎）**；`notarize: true`（**不能写 teamId**：公证走 ASC API Key，@electron/notarize 把 teamId 归为密码凭据、与 API Key 并存即报 "Cannot use password credentials, API key credentials ... at once"，v0.34.0 首次 tag 构建踩过；团队由 issuer 决定=境内主体 8WKHZVR2W8，2026-09-05 起，此前香港主体 X9B97KVA84，dev-board#447）；entitlements desktop/build/entitlements.mac.plist）。**win 侧 `nsis` 字段（2026-08-31 起搜狗式一键 UI，dev-board#339）**：`oneClick:false` 但页面全部换装 `build/win/awd-oneclick-ui.nsh` 引擎——无边框大卡片（立即安装大按钮/协议链接/「自定义安装」展开路径行），点击后主窗收起为桌面右上角小进度卡，完成卡「立即体验」；`allowToChangeInstallationDirectory:false`（目录选择收进卡片，engine 强制追加 `AI WorkDeck` 子目录）；`include: build/installer.nsh` 只做桌面端接线（customWelcomePage/customInstallMode/customFinishPage 三钩子）。引擎设 `ManifestDPIAware`（根治高分屏点阵字）+ `CRCCheck off`（去掉大包启动前 verifying 长进度）；**卸载器仍走 MUI 经典页**，`installerSidebar`/`installerHeader` BMP 只为它保留；**静默安装（/S，自动更新路径）不进 GUI 代码**。改卡片布局必须同步改引擎 AWDUI_* 常量与 `build/win/oneclick-*.html` 的绝对定位（两边同一 96dpi 基准）。
4. 签名抖动：Apple 时间戳抖动 = rerun 即可（连挂两次也 rerun）；公证轮询抖动排查见 ci-macos 记录。
4.1. **macOS 签名与公证的主体 = 境内 Team `8WKHZVR2W8`（北京京微资易），2026-09-05 起（dev-board#447）**。
   两条链路各自的凭据：**签名**仍是 `CSC_LINK`（Developer ID Application 的 .p12 base64）+
   `CSC_KEY_PASSWORD`，`desktop/scripts/sign-mac-natives.sh` 那一步与 electron-builder 各自
   从它导一次；**公证改走 ASC API Key**，三个 secret `APPLE_API_KEY_B64`（.p8 的 base64）/
   `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`——旧的 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
   `APPLE_TEAM_ID` 已从 workflow 摘除。三个地雷：
   ① electron-builder 认的 `APPLE_API_KEY` 是 **.p8 的文件路径**不是内容，所以 secret 只能存
   base64、在 run 步骤里解码到 `$RUNNER_TEMP/AuthKey.p8` 再 `export`（`env:` 块拼不出 `$RUNNER_TEMP`）；
   ② 它对这三个变量是「全有或全无」——见到任意一个非空就要求三个都在，否则
   `InvalidConfigurationError`，三个全空才静默跳过公证，**fork PR 靠的就是全空这条路**，
   所以解码那段必须包在 `[ -n "$APPLE_API_KEY_B64" ]` 里，`else` 分支还要 `unset` 另两个；
   ③ 它先看 `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`（option 1）再看 API Key（option 2），
   两套同时给会走旧路——别为了「保险」把旧 env 留着。
   `notarytool history/log` 同样改 `--key/--key-id/--issuer`，**API Key 认证不接 `--team-id`**
   （团队由 issuer 唯一确定），此前那条「APPLE_TEAM_ID secret 会让 history API 报 403」的注释
   只对 Apple ID 认证成立。团队号全仓只剩 `desktop/package.json` 的 `mac.notarize.teamId` 一处。
   当时换主体对存量 mac 用户无影响：旧桌面壳没有全量自动更新（`build.publish` 为空、不带
   electron-updater；后续完整更新机制见下），也不用钥匙串/safeStorage，签名主体变了不会让旧版失效或掉数据。
   **`office-addin/installer/build-installers.mjs` 不共用这套**：它在维护者 Mac 上取钥匙串里
   **第一条** `Developer ID Application` 身份，两个主体的证书都装着时选到哪张不确定（见「已知地雷」）。
4.2. **最终 macOS 打包复用前置签名钥匙串（dev-board#523）**：`Sign bundled backend natives` 已导入证书到 `$RUNNER_TEMP/awd-sign.keychain-db`；最终打包显式解锁它，设置 `CSC_KEYCHAIN` 并 `unset CSC_LINK`。electron-builder 24.13.3 新建随机口令钥匙串后，`importCerts` 却把 P12 口令传给 `set-key-partition-list -k`，可报 `SecKeychainUnlock`；不要把这个错误误判成证书口令失效而轮换 secrets。`CSC_LINK` 未清会优先走旧导入链，`CSC_KEYCHAIN` 不生效。无凭据的 fork 路径不设置钥匙串；ASC 公证流程不变。失败诊断里的 notary history 可能是旧版记录，须核上传时间，不能当本轮已公证的证据。
4.3. **Windows 代码签名 = Azure Artifact Signing（原 Trusted Signing），dev-board#1011**：账户 `zsmglus`（East US，端点 `https://eus.codesigning.azure.net/`，资源组 `rg-artifact-signing`），证书档案 `aiworkdeck-public`（Public Trust，美国公司主体）。
   **只在 tag `v*` 与 workflow_dispatch 时签**；普通 PR（公开仓库，PR 分支代码不该拿到公开信任签名）与 fork PR（拿不到 secrets）一律跳过、产物未签名、步骤不红。判据在 `Detect Windows signing credentials` 步骤：满足条件才把 `AZURE_SIGNING_ENDPOINT/ACCOUNT/PROFILE` 写进 `GITHUB_ENV`，钩子看不到这三个变量就打印跳过。
   认证走 GitHub OIDC（顶层 `permissions` 多一条 `id-token: write`），`azure/login@v2` 用三个 secret `AZURE_SIGNING_CLIENT_ID` / `AZURE_SIGNING_TENANT_ID` / `AZURE_SIGNING_SUBSCRIPTION_ID`，不存 client secret；2026-10-10 主仓转移至 `AI-WorkDeck/aiworkdeck` 后，GitHub API 确认 `use_default=true`、`use_immutable_subject=true`；Entra 应用注册 `aiworkdeck-ci-windows-signing` 新增联合凭据 `github-aiworkdeck-org-windows-signing`，subject 为 `repo:AI-WorkDeck@340410259/aiworkdeck@1138989235:environment:windows-signing`、audience 为 `api://AzureADTokenExchange`，所以 build job 挂 `environment: windows-signing`（GitHub 环境无保护规则），tag / 分支都走这一条，不必按 ref 建凭据。旧联合凭据 `github-aiworkdeck-env-windows-signing` 暂保留；配置已核对，迁移后的实际签名与发版尚未验证。服务主体角色：Certificate Profile Signer（档案范围）+ Reader（资源组，供 azure/login 看到订阅）。
   electron-builder 24.13.3 没有 `win.azureSignOptions`，走 `build.win.sign` → `desktop/scripts/sign-win.js`（`signingHashAlgorithms: ["sha256"]`，只签一轮）：每个文件起一次 `pwsh` 调 ArtifactSigning 模块（CI 里 `Install-Module -RequiredVersion 0.1.20` 写死；旧名 TrustedSigning 0.5.8 已停更、参数相同）的 `Invoke-ArtifactSigning`，SHA256 + RFC3161 时间戳 `http://timestamp.acs.microsoft.com`，只留 AzureCliCredential、其余凭据全排除（微软 FAQ：否则 400/超时）；签完 `Get-AuthenticodeSignature` 回读必须 Valid 且有时间戳，失败重试两次后抛错让构建红。钩子**串行**执行（模块每次调用都改写 `%LOCALAPPDATA%` 里同一份 metadata.json）。OIDC 主体使用上文含组织与仓库 ID 的格式（build job 挂 `environment: windows-signing`；换环境名或删环境须同步修改 Azure 联合凭据，否则签名认证失败）。已带有效签名的第三方 exe（Temurin 的 java.exe 等）跳过、保留原厂签名。
   覆盖面：win-unpacked 的应用 exe 与 extraResources 里的 exe、卸载器、安装器由 NSIS 目标逐个调钩子；**ARM64 壳**是 `electron-builder --dir --arm64` 那一步里就签好的，installer.nsh 用 `File /r` 原样塞进安装器，之后不会再过签名，所以那一步也必须在签名环境变量生效之后跑。打包后 `Verify Windows signatures` 对安装器、x64 应用 exe、ARM64 壳 exe 跑 `signtool verify /pa /v` 并要求输出含时间戳；卸载器编在安装器里取不出来，只靠钩子自身的回读。DLL 不签（`signDlls` 未开）。
   签名不会让 SmartScreen 立刻消失：信誉随下载量累积在签名主体上，首批用户仍可能见到提示，这是预期，不要加任何绕过。native pack（`pptx/mineru/kokoro/asr-runtime` 等）里的 exe 不经此流程、仍未签名。
4.3.1. **单平台 FFmpeg 依赖（dev-board#1335）**：Maven 3.10 限制仓库 POM 依据命令行属性激活 profile。旧 `ffmpeg-platform` 因而不再遵循 `-Djavacpp.platform`，0.64.0 Mac 混入16个其他平台原生 JAR（162676460字节），329→345个依赖。现在 `backend/pom.xml` 的本项目 profile 按 `${javacpp.platform}` 显式引入 FFmpeg/JavaCPP classifier；未传属性时保留全平台开发/服务器行为。桌面 CI 跑真实 MP4/QTA 转码测试，`prepare-backend.js --native-platform` 检查拆包后的基础 Java JAR、目标原生 JAR，拒绝其他平台及聚合包。无须降级 Maven 或关闭其安全限制。依赖变更须随完整安装包发布，不能只发 app.jar 补丁。

4.4. **Mac DMG 压缩（dev-board#1335）**：桌面打包完成后、上传 artifact 前运行 `bash desktop/scripts/compress-mac-dmg.sh <DMG>`，把默认 UDZO 转为 ULMO（LZMA，macOS 10.15+；产品仅 Apple Silicon/macOS 11+）。electron-builder 24 的 schema 不接受 ULMO，不能直接填 `dmg.format`；其默认 UDZO 已用 zlib-level=9，继续提高等级无收益。脚本先转临时件、校验，再仅在变小时原子替换；失败保留原件。当前公证/装订的是内部 `.app`；脚本拒绝处理外层已签名或装订的 DMG，未来若改为容器签名须调整顺序。`dmg.writeUpdateInfo=false` 避免重压缩后留下旧 blockmap/更新元数据；本产品更新走自有签名 manifest，不发布 electron-updater 的 latest-mac.yml。0.64.1 同一卷实测630045735→591992141字节（约6%），不裁剪组件。更换压缩格式后必须挂载、逐文件/权限/符号链接对比，并核验应用签名、Gatekeeper、装订与隔离启动；旧macOS真机兼容仍按实测范围说明。
4.5. **Office 插件安装器是发版硬步骤（2026-08-19 维护者定，自 v0.21.0 之后的发版起强制）**：
   每次发版都要重建并上架插件的 dmg+exe——在维护者 Mac 上
   `cd office-addin/installer && npm run build:installers`（版本自动取
   desktop/package.json；mac .app 走本机钥匙串 Developer ID Application 签名，给齐
   NOTARY_* 三变量 DMG 自动公证装订，配方见 installer/README.md），产物上传
   addin 服务器 `/opt/aiworkdeck/cloud/web/office-addin/dl/` 并切稳定名软链
   （`AI-WorkDeck-Office-Addin.dmg/.exe`）。安装器只带 manifest，但版本号要与
   桌面端同步，用户侧才对得上号。不做这步 = 发版没发插件端，维护者原话
   「不然用户不会弄」。
   **WPS 加载项（2026-08-28 起）随同一步发**：`cd office-addin && npm run build &&
   npm run build:wps`，把 dist-wps/ 覆盖上传**北京**一台的
   `/opt/aiworkdeck/cloud/web/wps-addin/`（在线模式无安装器概念，覆盖静态目录即
   全量用户生效；壳文件 no-cache 的 nginx 口径见 office-addin/README.md「WPS 加载项」章）。
   **新加坡刻意不铺 WPS 壳**（2026-08-29 实地核对：SG 只有 office-addin/，没有
   wps-addin/）——WPS 是国内市场的产品，国际站不提供；别照 Office 插件那样"两台对齐"。
4.6. **插件云后端 jar 随发版同步部署（`backend/` 在发版区间有任何改动就必须做；
   2026-08-31 v0.29.0 漏发实锤后定为硬步骤）**：addin.aiworkdeck.com 与
   addin.workdeck.ai 两台跑的就是**主仓 backend jar 本体**（application-cloud.yml
   profile），不是 deploy/cloud/ 里另有一套代码——deploy/cloud/ 只是 nginx/systemd/
   env 模板。**判据是 `git diff v<上一版>..v<本版> -- backend/` 非空**，别再只看
   deploy/cloud/ 没变就跳过（v0.29.0 就是这么漏的：插件端换了新版、后端 jar 还是
   旧的，PR#671 的 `POST /api/projects/ensure-addin-link` 端点不存在，插件弹
   「需升级云后端」降级提示）。配方（memory cloud-backend-deployed 同源）：
   `cd backend && rm -f target/backend-*.jar && JAVA_HOME=<jdk21> mvn -B -DskipTests
   -Djavacpp.platform=linux-x86_64 clean package`（瘦包 ~424M，先删旧产物防脏包坑）
   → rsync --partial **串行**传两台 `/opt/aiworkdeck/cloud/backend.jar.new` →
   sha256 对账 → 保留旧 JAR 与静态文件备份 → `systemctl stop aiworkdeck-cloud`
   → 确认 `MainPID=0` 且 `ActiveState=inactive` → 同一文件系统内原子 `mv` 换入
   → `systemctl start aiworkdeck-cloud` → 核验健康接口、新进程启动日志和文件哈希后再切静态文件/稳定链接。
   **不能先换运行中的 JAR 再 restart；回退也先停稳，再原子换回旧件并 start。**
   2026-10-10 v0.57.0 部署（dev-board#1183）实见先换件后旧 PID 停止时报 Spring
   `NoClassDefFoundError`，新 PID 随后正常启动；旧 JVM 延迟读取嵌套 JAR 是推断，未做内部加载追踪。
   该旧停止异常须单独保留，不能混入新启动 ERROR 门禁，也不能从部署记录中抹掉。
   **现有 unit 的 143 特例**：未声明 `SuccessExitStatus`，Java 对请求的 SIGTERM 退出为 143，
   systemd 可能记为 failed。仅在本次 `stop` 命令成功、`MainPID=0`、`ActiveState=failed`、
   `ExecMainStatus=143`、`Result=exit-code` 同时成立时，才 `reset-failed` 并重新确认 inactive；
   其他退出码、结果、非零 PID 或 stop 失败均拒绝换件，不为本次发版泛化修改 unit。
   发布与回退复用同一停稳判据。
   **日志按本次进程分界**：保存新 `InvocationID`、`MainPID` 与启动时间，优先按
   `_SYSTEMD_INVOCATION_ID` 查询；若字段缺失或无法匹配本轮成功启动行，保留原查询结果，
   显式退到 `_PID=<新 MainPID>` 加本轮起始时间。必须取得非空日志且含该 PID 的
   `Started CheckbaApplication`，再断言 ERROR 为零；空日志不能判成功。失败 attempt 与最初回退件分别保留。
   新加坡实例 env 另有 `AI_ACCOUNT_BASE_URL=https://www.workdeck.ai`（代码默认值是国内站，
   漏了国际站账号登录整条断，2026-09-16 实测），换 env 文件或重建机器时别丢
   不再与「不存在的端点」相同（后者恒为 `{"code":1,"message":"服务器内部错误"}` + 200，
   这也是判「接口没上」最快的探法）。表结构靠 `ddl-auto: update` 自动建，无手动迁移。
4.7. **独立发布件逐项查、有更新随发版一起发（2026-09-11 维护者定，dev-board#592）**：
   五个 native pack（`pptx/mineru/kokoro/asr-runtime` + `litigation-visual`）、广场官方插件
   （`due-diligence` 在私有仓 `zeweihan/aiworkdeck-dd-plugin`、`hr-template-pack`）、LOWA 引擎
   **都不随 `v*` tag 自动发**，`<svc>-service/` 与 `litviz/` 的改动合进 master 后用户手里不会变。
   pack 判据：`git log $(git tag -l 'pack-<id>-v*' --sort=-v:refname | head -1)..origin/master --
   <源目录> desktop/scripts/build-pack.js`（runtime 再加 `prepare-python-service.js`；litviz 再加
   `prepare-graphviz.js`、`fetch-drawio-assets.js`）只作初筛，**以内容为准复核**：`git archive origin/master
   <源目录>` 与已发布版（本机 `~/.aiworkdeck/packs/<id>/<current>/` 或 Release 组件）`diff -r`，
   只差 SPDX 头/tests 算无更新——pack-release 从 master 当时 HEAD 出包，tag 可能落后于实际出包提交
   （litigation-visual 1.1.1 实测）。确有差异 → `pack-release.yml`
   出新版本 + `deploy/publish-pack.sh`，**先于打 tag** verify 通过；已装用户靠 `PackUpdater` 24h 内自动追新。
   官方插件判据：源 `manifest.json` 版本高于 `/api/registry/plugins` → 北京 `publish-plugin.mjs` 上架 +
   国际站同步；声明了更高 `minHostVersion` 的要等桌面正式版发出后再上。LOWA：`desktop-build.yml`
   的 `LOWA_BASE_URL` 变了 → `publish-lowa-engine.sh publish/verify` 先于打 tag。
   内置 skill（`backend/skills/*`，脱敏等）只随完整安装包走，不在此列。它们由 extraResources 放到 `Resources/skills`，SkillRegistry 从该物理目录加载；`backend-app` 补丁只有 `app.jar`，没有 skill 资源或 classpath 补偿。`patch-gate.sh` 拒绝内置 skill 变更的小版本（dev-board#1114），必须升 `0.(X+1).0`；临时 Git 仓回归见 `desktop/tests/patch-gate.test.js`。
4.8. **官网版本记录是发版硬步骤（2026-09-23 维护者定，dev-board#862）**：
   每发一个 0.X 大版本，就在官网仓 `zeweihan/aiworkdeck_website`（本机 `1-1 aiworkdeckweb`）的
   `content/releases.ts` 数组头部加一条：`version`（0.X.0）、`date`（tag 日期）、`headline` 一句、
   `items` 三到五条，中英双语。**补丁版 0.X.Y 并入所在大版本那条**，不单独立卡。写给律师看——
   「这一版你能多做什么 / 什么不再烦你」，不写内部重构、测试、CI、文档、营销件；口吻照该文件
   既有条目，不用营销腔。合并后按官网仓惯例 `gh workflow run ci.yml --ref master -f target=both`
   部署，`/zh/updates` 与 `/en/updates` 顶部出现本次版本号才算完。
   **判据：`https://www.aiworkdeck.com/zh/updates` 顶部版本号 ≠ 本次 tag → 这步没做。**
   断更实锤：0.16.0（08-15）到 0.46.3（09-23）三十个大版本官网一条没写，维护者原话
   「发版每次要写啊」（dev-board#861 一次性补齐）。
5. **EN 走查（打 tag 前必过）**：① 以英文语言设置跑 app-e2e 全量（含 J12 英文旅程：切 en-US 断言工作台四列英文锚点 + AI 过程卡工具名无中文，语言键 `awd_app_language`，切语言必须整页 reload）；② 编辑器 boot 用 `?uilang=en-US` 并以 office_thread.js 的 ooLocale 诊断确认 en-US 生效（issue #66 的诊断口径）；③ 人工过一遍英文主界面截图（工作台/设置/AI 面板）。
6. DMG 安装窗口视觉（PR#204）：`build.dmg` 里的 `contents` 坐标是**图标中心、原点在窗口内容区左上角（不含标题栏）**；默认窗口尺寸由 `build.dmg.window` 显式钉在 660x420（**外框**，含约 32pt 标题栏，dmgbuild 写进 `.DS_Store` 的 `bwsp.WindowBounds`；不写就拿背景图 1x 尺寸当窗口）。**背景图刻意比窗口大（dev-board#580）**：Finder 按原尺寸把背景贴在左上角、不拉伸，图外是白底，用户拉大窗口就露白；所以画布 3840x2160（2x 7680x4320），设计主体只占左上 660x420，其余是同一组渐变的 px 锚定延续（DMG 只多约 1.5MB，代价是打开时 Finder 多吃约 140MB 解码内存）。Office 插件 DMG（`office-addin/installer/art/dmg-background.html`，`render-art.mjs` 的 `DMG_CANVAS`）同一做法。背景图 `desktop/build/background.png` + `background@2x.png` 由 electron-builder 自动合成 hidpi TIFF，源文件是 `desktop/build/dmg-background.html`（顶部注释有 headless Chrome 重新生成命令）。改图标落位必须同步改 HTML 里的光晕/箭头位置，否则错位；改 HTML 的渐变别写回百分比（会随画布尺寸漂移，主体区跟着变）。
6.5. **win 安装器美术管线**（`desktop/scripts/render-win-installer-art.mjs`，安装器 UI 重设计新增）：`build/win/*.html`（美术源文件）→ headless Chrome 截图 → ImageMagick 转 24 位 BMP3 入库为 `installerSidebar.bmp`/`installerHeader.bmp`。**sips 只能出 32 位 BMP，NSIS/MUI2 只认无 alpha 的经典 BMP，必须用 `magick`**——这是个地雷，脚本会校验 BM 头与色深不合格宁可失败也不入库。只有维护者改美术时手动跑一次，产物入库后 CI 与用户构建都不需要 Chrome/ImageMagick。
6.5.1. **一键安装 UI 位图管线**（`desktop/scripts/render-oneclick-art.mjs`，dev-board#339）：`build/win/oneclick-*.html` → Chrome（`--force-device-scale-factor`）→ 24 位 BMP3，zh/en × 100/125/150/200% 共 24 张/产品，**产物不入库**（gitignore `generated/`），构建现场渲染：桌面端由 desktop-build.yml 的「Render one-click installer art」步骤（缺了它 NSIS 编译 File 找不到位图直接失败）、插件端由 build-installers.mjs 调用。三个地雷：makensis 的相对 File 路径按**脚本所在目录**解析（所有 -D 路径给绝对路径）；直接调 makensis 必须 `-INPUTCHARSET UTF8`（脚本内含中文字符串）；BMP 尺寸校验必须是基准×倍率，错一像素热区全歪。视觉回归用 `.github/workflows/installer-ui-smoke.yml`（Windows runner 编译 `build/win/ui-harness.nsi` 测试壳真跑全流程，`desktop/scripts/installer-smoke.ps1` 按基准坐标点击热区逐阶段截图上传 artifact）——没有 Windows 真机时唯一的视觉验证手段。
   **本机 makensis 不能用来预检**（2026-09-01 实测，Darwin 27）：homebrew 的 v3.12 与
   electron-builder 缓存的 v3.04 两个 mac 构建都一样——非 ASCII 源码报 `Bad text encoding`，
   纯 ASCII 脚本走到写产物时 `std::bad_alloc` 崩。**未改动的 HEAD 文件同样复现**，不是谁改坏的，
   别在这上面查半天。改 NSIS 只能靠 installer-ui-smoke。**要出插件安装器 exe 走
   `.github/workflows/addin-installer.yml`**（workflow_dispatch，Windows runner 上跑
   `build-installers.mjs --skip-mac`，按 `desktop/package.json` 的版本号出国内/国际两份，
   分目录上传避免同名覆盖）——v0.31.0 发版实测：引擎修好了本机却出不了包，这条路是补上的。
   mac 那一半（swiftc + Developer ID 签名 + 公证）仍只能在维护者 Mac 上跑 `--skip-win`。
   **两份变体必须分别上架到两台机**：北京 `8.152.169.44` 与新加坡 `8.219.94.204` 各有一份
   `/opt/aiworkdeck/cloud/web/office-addin/dl/`，托管地址焙进包内 manifest，不是通用包；
   0.30.0 那次两台挂的是同一份（字节数一模一样），国际用户装到的包指向 addin.aiworkdeck.com，
   已在 0.31.0 纠正。**核对法：两站 `curl -L .../AI-WorkDeck-Office-Addin.exe` 的字节数应当不同**
   （URL 长度差压缩后约 2 字节），一样就是挂错了。
6.5.2. **磁盘空间闸**（dev-board#350）：引擎新增两个可选契约 `AWD_UI_REQUIRED_KB` /
   `AWD_UI_REQUIRED_EXTRA_KB`，只有设了前者才编译出闸（插件端装的是一份清单，不设）。
   桌面端在 `build/installer.nsh` 里直接把 **electron-builder 的 `-D APP_64_UNPACKED_SIZE`**
   接过来——那是打包时对 win-unpacked 整个目录实测的解包体积（KB），**不许手抄常量**，
   包体每次发版都在长；这个 define 是命令行 `-D` 传的，在生成脚本第一行就存在，和
   `$launchLink`/`StdUtils` 那批「晚于 include 才出现」的东西不是一回事。余量 512MB
   （ARM64 壳 260MB + 解压临时占用 + 不把盘塞到 0）。取不到可用空间时**一律放行**——
   闸设得过严会把装得下的用户挡在门外，比不设闸更糟。反向用例在 CI 里实跑：
   `ui-harness.nsi` 收 `-DREQUIRED_KB`，smoke 工作流多编一个所需空间约 858GB 的
   `harness-nospace.exe`，用 `installer-smoke.ps1 -ExpectBlocked` 断言「弹了提示框 +
   进程没退 + 窗口还是 760 宽的大卡片（开装了会缩成 360×132 的角落进度卡）」。
6.5.3. **`uni-h5` 补丁（`frontend/scripts/patch-uni-h5-scrollview.mjs` + frontend `package.json` 的 `postinstall`，dev-board#349）**：
   uni-h5 的 scroll-view 在 `onMounted` 里排一个 `nextTick` 补写 scrollTop/scrollLeft，
   回调对元素 ref **没有空判**；组件在同一批 flush 里被卸载（`v-if` 分支翻转、路由离开）时
   `main.value` 已是 null，控制台常驻两条同根因的错误（`TypeError: Cannot set properties
   of null (setting 'scrollTop')` + 我们 main.js 全局兜底打出的「未处理的 Promise rejection」）。
   补丁给 `uni-h5.es.js`/`uni-h5.cjs.js` 各加三处真值判断（两条 `_scroll*Changed` 的直写 +
   动画分支 `scrollTo` 的入口），锚点在文件内必须唯一，**对不上就 exit 1 让安装失败**——
   升级 `@dcloudio/uni-h5` 后若报「结构已变」，先搜新版的 `_scrollTopChanged` 看是否已自带
   空判，是就删掉补丁与 postinstall 钩子。产物侧靠 `npm ci` 触发 postinstall（ci.yml 的
   frontend job 与 desktop-build.yml 的 Build frontend 步骤都会跑到）。
   回归护栏在 `tests/app-e2e/run.mjs` 结尾：**控制台异常信号整体不判死**（历史噪音多），
   但 `setting 'scrollTop'` 这一条单拎出来判死。
6.5.4. **NSIS 地雷：`Quit` 在 nsDialogs 回调里不生效**（dev-board#354，CI 实锤）：
   `nsDialogs::Show` 跑的是它自己的消息循环——`while (g_dialog.hwDialog) { GetMessage(...); ... }`，
   **不看 `GetMessage` 的返回值**，只看对话框句柄还在不在。而 NSIS 的 `Quit` 编译成
   `g_quit_flag++` + `PostQuitMessage(0)`，那条 `WM_QUIT` 被这个循环取走后直接丢弃，
   循环照转，安装器关不掉。所以**自定义页的任何 `${NSD_OnClick}` 回调里都不要用 `Quit`**，
   一律 `SendMessage $HWNDPARENT ${WM_COMMAND} <id> 0` 交回 NSIS 页面机
   （1 = 下一步，2 = 取消/退出），由页面机销毁对话框、Show 的循环才会退出。
   引擎里三处按钮都是这个写法。诊断配方（当时靠它一轮 CI 定案，值得复用）：
   同一行相邻热区点一下看 `IsIconic`，证明**点击落到了热区上**；再从外部 `PostMessage`
   一发 `WM_COMMAND`/`IDCANCEL`，证明**退出通道本身是通的**——两条对照一起把结论
   钉死在「关窗动作写错了」而不是「点击没命中」。用例：`installer-smoke.ps1 -CloseOnly`
   （smoke 工作流的「Drive zh harness close button」步骤），是这条路径唯一的覆盖。
6.5.5. **NSIS 地雷：`MUI_PAGE_CUSTOMFUNCTION_SHOW` 会被「路过的页」在编译期抢走**
   （dev-board#356，实机翻车、CI 全绿）：MUI2 的 `Pages.nsh` 里
   `MUI_PAGE_FUNCTION_CUSTOM` 展开成 `Call <fn>` **紧跟一句 `!undef`**——这个 define
   是「谁先展开谁吃掉」的一次性货。一键 UI 原先把安装页的 SHOW 回调
   （`AwdInstFilesShow`，负责把主窗收成 360×132 角落进度卡）挂在 `AWD_UI_PAGE_WELCOME`
   宏里，赌「紧随其后的就是 `MUI_PAGE_INSTFILES`」。ui-harness 里确实如此，
   **桌面端真产物不是**：electron-builder 的 `assistedInstaller.nsh` 页序是
   `customWelcomePage → [licensePage] → PAGE_INSTALL_MODE → [MUI_PAGE_DIRECTORY]
   → customPageAfterChangeDir → MUI_PAGE_INSTFILES`，中间那张「安装模式」页
   （`perMachine=false` 才有）先把 SHOW 吃掉；更阴的是它自己又被我们的
   `customInstallMode`（`$isForceCurrentInstall=1`）在 PRE 里 `Abort` 跳过，
   那句 `Call` 连跑都不会跑。两头都不响 = 安装页塌回 NSIS 原生向导
   （进度条贴顶、原生「上一步」飘在窗口中间、装完停在「已完成」不走完成卡）。
   现在的写法：引擎导出 `AWD_UI_INSTFILES_HOOK`（只 define）与
   `AWD_UI_PAGE_INSTFILES`（钩子 + 页的原子宏）。**自己掌握页序的调用方
   （ui-harness、Office 插件安装器）一律用原子宏**；桌面端页序在 electron-builder
   手里，钩子挂 `customPageAfterChangeDir`——那是唯一紧贴 INSTFILES 之前的钩子，
   **升级 electron-builder 要回头核一眼这个页序还成不成立**。
   回归护栏：`ui-harness.nsi` 的 `-DEB_PAGE_ORDER` 复刻那张「运行期被 Abort 跳过、
   编译期照吃 MUI 定义」的页，smoke 工作流多编一个 `harness-eborder.exe` 实跑；
   同时 `installer-smoke.ps1` 在「点完立即安装」后**真做断言**了（此前只截图：
   窗口宽度必须缩到小卡片、原生「上一步」按钮 IDC 3 必须不可见）——
   老坑之所以能瞒过八个月，就是因为那一步只截图不断言。
   **教训**：`ui-harness` 只覆盖引擎，不覆盖「引擎怎么被真产物接线」；
   凡是与 electron-builder 模板契约有关的改动，用例必须复刻它的页序。
6.5.6. **无边框卡片的拖动：nsDialogs 页靠 STN_CLICKED，instfiles 页只能靠真标题带**
   （dev-board#366）。用户反馈「进度卡不能拖、点不了、像卡死」，两个症状一个根：
   `AwdGuiInit` 把 `WS_CAPTION` 剥掉做无边框，系统从此不给任何可拖的区域，而进度卡的
   位图上本来就一个可点的东西都没有（mini-install 美术只有品牌行、状态行、进度轨道），
   于是「点不了」=「拖不了」。**消息泵不是嫌疑人**：Section 跑在 NSIS 自己开的
   `install_thread` 上（`Source/exehead/Ui.c` 的 `WM_NOTIFY_START` → `CreateThread`），
   UI 线程照常泵消息，1.7GB 解压期间进度条也是这么动起来的；红一轮的日志里
   `SendMessageTimeout(WM_NULL)` 在安装期间 3 秒内有应答，把这条钉死了。
   两条路各自的约束：
   - **欢迎卡/完成卡是 nsDialogs 页**，脚本能跑。背景位图加 `SS_NOTIFY`，static 控件的
     `STN_CLICKED` 是在 `WM_LBUTTONDOWN` 里发的（与 BUTTON 抬起才发 `BN_CLICKED` 不同，
     Wine `static.c` 与 Windows 同款），回调里鼠标还按着，`ReleaseCapture` +
     `SendMessage $HWNDPARENT WM_NCLBUTTONDOWN HTCAPTION 0` 就把这一按交给系统的模态
     拖动循环，抬起才回来。**z 序地雷（第二轮 CI 实锤）**：Win32 子窗口创建时插在
     z 序**最底**（Wine `win32u/window.c`：`insert_after = WS_CHILD ? HWND_BOTTOM : HWND_TOP`，
     注释原话「yes, even if the CBT hook was called with HWND_TOP」），也就是后建的在
     **下面**——引擎里原先那句「创建序在位图之后 = z 序在其上」是反的，此前没露馅只因
     没 `SS_NOTIFY` 的 static 对命中测试是 `HTTRANSPARENT`，点击穿过位图落到下面的热区。
     一加 `SS_NOTIFY` 位图变 `HTCLIENT`，拖动通了、随后「自定义安装」「立即安装」全哑
     （run 33576325194）。所以位图的 `SetWindowPos(HWND_BOTTOM)` 必须放在**所有控件建完
     之后、`nsDialogs::Show` 之前**，建完位图立刻压底是无效的（那时它本来就在底）。
   - **进度卡（instfiles 页）脚本一行都不能跑**：同一套执行引擎、同一个栈，UI 线程若在
     Section 执行期间再进 NSIS 代码就是两条线程并发踩 `$0`-`$9`；nsDialogs 在这一页也没有
     落脚点。所以 `AwdInstFilesShow` 把 `WS_CAPTION` 加回来当拖动带（不带 `WS_SYSMENU`，
     无图标无按钮），Win11 用 `DwmSetWindowAttribute` 35/36/34 把标题带、文字、边框染成
     卡片色（看起来只是卡片顶上多一条空白），Win10 显示系统标题带；外框尺寸用
     `AdjustWindowRectEx` 实算别手抄；`SetWindowPos` 必须带 `SWP_FRAMECHANGED`。
     进完成卡 `AwdFinishCreate` 再剥掉，先 `ClientToScreen` 记下客户区原点再换样式，
     卡片内容不跳。
   - 「自定义安装」展开改 `SWP_NOMOVE`：原先用初始化时记的坐标重定位，卡片能拖之后
     那就成了「一点自定义安装就弹回屏幕中央」。
   **否决过的路**：System 插件的回调是同线程协程（只在 `System::Call` 里等着的那次调用
   能收到），做不了 WndProc 子类化；往 RWX 内存写一段 x86 WndProc 能跑但等于在未签名
   安装器里放 shellcode；自编插件 DLL 要三条 workflow 各加编译步骤。
   回归护栏：`installer-smoke.ps1` 的 `DragAssert` 对三张卡各拖一次（真实鼠标
   `mouse_event` 按下、分步绝对移动、抬起，断言窗口矩形位移 ≥ 指针位移一半、进程活着）、
   `AssertResponsive` 在安装期间发 `WM_NULL`、展开自定义安装后断言左上角没动。
   三轮 CI 同一份测试脚本（f9af58b0 之后 `installer-smoke.ps1` 一字未动）：红
   https://github.com/zeweihan/aiworkdeck/actions/runs/33575900306（三张卡 `moved (0,0)`）、
   半红 https://github.com/zeweihan/aiworkdeck/actions/runs/33576325194（欢迎卡拖动
   `moved (100,40)` 但热区被位图挡住、进不了进度卡——就是上面的 z 序地雷）、
   绿 https://github.com/zeweihan/aiworkdeck/actions/runs/33576754273 。

6.5.7. **透明热区必须带 `WS_EX_TRANSPARENT`**（dev-board#706，回归点 PR#705/d0930497）：
   `_AwdHotspot` 建的 SS_NOTIFY 空 STATIC 只管命中、不画东西，而 6.5.6 那句把背景位图
   压到 z 序最底之后，位图的 `WS_CLIPSIBLINGS` 会把所有热区矩形从它的绘制区裁掉，
   热区自己是 NULL 刷什么都不擦 → 真机上「立即安装」/条款链接/自定义安装开关/窗口按钮/
   完成卡的「立即体验」与 ✕ 全是纯白方块（位图在热区之上时白块被盖住，所以压底才露馅）。
   `WS_EX_TRANSPARENT` 让热区不参与下方兄弟的 WS_CLIPSIBLINGS 裁剪、且延后到它们画完再画，
   位图就会把热区矩形也画上；对非 layered 子窗口不改变命中测试（nsDialogs 自己的
   `NSD_CreateLabel` 用的就是这个 exstyle）。护栏：`installer-smoke.ps1` 的 `AssertPainted`
   在 `01-welcome`/`05-done` 上逐热区验像素（绿块判白占比 < 10%、白底文字判非白像素数），
   PR#705 的 run 33576754273 截图拿来复算全红、上一次 run 33480261799 全绿。
   插件端没有「自定义安装」开关（不定义 `AWD_UI_DIR_CHOICE`，且窗口高度与桌面端一样是
   760x500，分不出来），smoke 工作流给 addin 那一步传 `-NoDirChoice` 跳过那一格。

6.6. **`dmg-builder` 补丁（`desktop/scripts/patch-dmg-builder.js` + package.json `postinstall`，安装器 UI 重设计新增）**：macOS 26.2+ 起 Finder 拒读 dmgbuild 写入 `.DS_Store` 的 `pBBk` 背景书签，导致桌面端主 DMG 背景不显示（electron-builder#9072 / dmgbuild#273，同版 Obsidian/Podman Desktop 同期中招）。`npm ci`/`npm install` 后自动对 `node_modules/dmg-builder/vendor/dmgbuild/core.py` 做定点补丁（跳过 Bookmark 生成，`icvp` 里的 alias 通道保留，老系统照常工作）。**升级 electron-builder 后若补丁脚本报「结构已变」**：先确认新版是否已自带该修复，再决定要不要删掉本补丁，不要盲目跳过。
6.7. **安装包瘦身 P1（dev-board#528，规格 `docs/superpowers/specs/2026-09-09-installer-slimming-design.md`）**，四条新地雷：
   ① `prepare-backend.js` 拆包后调 `trim-driver-bundle.js` 把 Playwright `driver-bundle-*.jar` 重写成只含 `driver/<本平台>/`（mac-arm64 / win32_x64，字符串必须与 `DriverJar#platformDir` 逐字一致，161MB→31MB）；zip 条目级原样搬运不重压，找不到本平台目录直接抛错。
   ② `backend/pom.xml` 的 `javacv-platform` 已换成 `javacv` + `ffmpeg-platform`（全仓唯一调用方 `MeetingAudioTranscoder`）；**不要再引回聚合体**，opencv/leptonica/tesseract 没有任何调用方。
   ③ mac 语言包靠 `desktop/scripts/after-pack.js`（`build.afterPack`）在签名前删 Framework 里非 en/zh_CN 的 `*.lproj`（−36MB）；`electronLanguages` 在 mac 上只裁 `Contents/Resources` 的空壳——**但那批「空壳」决定应用语言**：app-builder-lib 按目录名精确匹配，顶层写的 `en-US`/`zh-CN` 是 Windows pak 名，mac 上 `en.lproj`/`zh_CN.lproj` 会被全删，macOS 于是把应用语言定成英文（`app.getLocale()` 恒 en-US、Chromium 内置 PDF 查看器菜单英文，v0.49.0 BUG-28 真根因）。所以 `build.mac.electronLanguages` 单独写 `["en","zh_CN"]`（平台段优先），守护 `desktop/tests/mac-lproj-locale.test.js`。**升级 electron-builder 要回头核 `platformPackager.js` 里 afterPack 仍早于 doSignAfterPack**；`afterPack` 相对路径按 cwd 解析，必须在 `desktop/` 里跑。
   ④ `installer.nsh` 顶部 `SetCompressor lzma` + `SetCompressorDictSize 32` 盖掉 electron-builder 用 `-X` 下发的 zlib（ARM64 壳的 `File /r` 走它）；**不能加 `/SOLID`**：整体压缩模式下模板里的 `SetCompress off` 触发 warning 8021，-WX 下 makensis 直接失败（#772 合并后 Windows 腿实锤，热修 PR 见 git log）；`nsis.differentialPackage=false` 关掉为 electron-updater 差量准备的 dict 1MB/非固实 7z。`installer-ui-smoke.yml` 不覆盖 installer.nsh，只有 desktop-build.yml 的 Windows 腿能验；固实压缩会让 makensis 变慢。
   ⑤ `prepare-python-service.js` 的 `prune()` 扩表（torch/include|test|share、bin/magika|ruff、pocketsphinx-data、一级包 tests/|test/、gradio *.js.map）；**`testing/` 不能删**（`torch/__init__` eager import 它），`dist-info/RECORD` 不能删。
6.8. **Python 运行时 pack（dev-board#529，规格 `docs/superpowers/specs/2026-09-09-installer-slimming-design.md` §3，规范 `docs/NATIVE_PACK_DISTRIBUTION.md` §7.5）**：
   ① 安装包不再含 `pysvc.tar.gz`；四个服务的根目录由 `desktop/main/services/pysvc-runtime.js` 的 `resolveServiceRoot(ctx, service)` 解析：env `AIWORKDECK_PYSVC_<SVC>_DIR` → `~/.aiworkdeck/packs/<id>/<version>/`（`current.json` 指向 + `.pack-complete` + 未 revoked）→ dev 态 `desktop/bundled/<plat>/pysvc/<service>`。首启解压与 splash「约一分钟」文案已删。
   ② 启动门：pptx/asr = pack 在场即起（asr **刻意不等模型**，探测要分清 RUNTIME_MISSING / SERVICE_DOWN / MODEL_MISSING）；mineru/kokoro = pack 在场且模型已装。`model-manager.js` 的模型下载器跑在服务 venv 里，**先 pack 后模型**是硬顺序，runtime 缺失时 `download()` 当场抛。
   ③ 后端：`ai.packs.max-archive-entries`（150000）/ `ai.packs.max-unpacked-bytes`（2.5GB）可配置；`PackAutoInstaller` 对四个 runtime pack **不自动补下**（用户要求先提示）；`GET /api/packs/optional-components` 零网络请求，其中 `installed` 按**磁盘**算（`isReady`，dev-board#751）——只看内存态会在 `PackUpdater` 追新途中/追新失败后把装好的包报成未装，面板于是催用户重下；`PptxTools`/`PdfTools` 在服务不可达且 pack 未装时发 SSE `client_action` `component_required`（六字段 packId/service/modelId/sizeMb/features/trigger，前端 ChatInterface 就地拦截，**不进 EDITOR_ACTIONS**）。
   ③b **pptx 与 mineru 两个 pack 是主辅链，不是并列可替换（dev-board#615，2026-09-13 盘点）**：mineru-runtime 只跑 MinerU 官方 `fast_api` 的 `/file_parse`，**Java 侧零直接调用**，全部经 pptx-service 的 `/api/pdf/ocr-markdown` 转发（`file_parser_service.py`）；带文字层 PDF 转 Word 走 pptx-service 的 `pdf2docx`，与 mineru 无关；扫描件两个都要装。「云端 MinerU 兜底」在发行版里不可达：桌面端从不注入 `MINERU_TOKEN`，pptx-service 设置页被 `PPTX_SETTINGS_TOKEN` 恒 403。**`pptx_export_editable`（可编辑导出 beta）已于 dev-board#621 打通本机通路**（此前无 token 必抛、Java 侧静默降级纯图片，从未成功过）：`factories.py` 的门改成「有引擎可用」——本机 MinerU 可达就无 token 构造，两头都没有才抛且信息指向本机引擎；Java 侧 `pptx_export_editable` 先查 pptx-runtime 再查 mineru-runtime，未装发 `component_required`（trigger 同名，文案不含「稍后重试」），mineru-runtime 的 featureKeys 多一条 `pptxEditableExport`。三个地雷：① 提取器 `MinerUElementExtractor` 只认磁盘上的 `layout.json`（`pdf_info[0]` 的 para_blocks/discarded_blocks 带 bbox）与 `*_content_list.json`，**两个都在才算数**；本地 `/file_parse` 的 `layout.json` 等价物是 `middle_json`，必须显式传 `return_middle_json=true`（默认 false，漏了就元素表恒空、静默退回纯图片，这正是原病灶）；② 产物落盘根目录必须用 Flask `UPLOAD_FOLDER`（`_mineru_storage_root()`），桌面注入 `PPTX_DATA_DIR` 后它是 `~/.aiworkdeck/pptx/uploads`，写 `project_root/uploads` 等于写进读不到的地方；③ 纯本机通路下表格以图块放回、背景重绘需要 AI key（`from_defaults` 构造 inpaint provider 时就会要 key），可编辑单元格要靠百度高精度 OCR（外采）——工具描述别承诺「表格可编辑」。真服务用例 `pptx-service/backend/tests/integration/test_editable_export_local_mineru.py`（`MINERU_LOCAL_URL` 门控，不可达即 skip，**不许改成 mock**）。组件显示名：「PPT 生成与 PDF 转 Word」/「扫描件 OCR 引擎（MinerU）」。
   ③c **首次登录「可选组件」面板的两条规矩（dev-board#751）**：面板只列**缺失**的组件，已就绪的收成底部一行灰字（`components.alreadyReady`），`phase === 'ready'` 一律不给复选框、不入批、不进总进度；「要不要弹」记的是**组件集合**（prefs `optionalComponentsPromptedPacks`，并集单调增）而不是大版本号——`optionalComponentsPromptedVersion` 仍写但只留档，只有出现「上次没提示过的缺失组件」才再弹。老标记（只有版本号）视为这批都提示过，由 `project-list` 在不弹时补齐集合。
   ③d **pack 安装状态契约（dev-board#1015，病灶：Windows 上 pptx-runtime 卡在 99%「正在准备组件…」无报错）**：`/api/packs/{id}/status` 的 `state` 保持老枚举不变，另加 `phase` 细分 `downloading → verifying → extracting → checking → finalizing → ready / failed`，以及 `component`、`phasePercent`（-1=该阶段不可计量；解压按**已消耗压缩字节**占比算，tar 流事先不知条目数）、`filesDone`/`filesTotal`（按当前阶段计：解压为已写文件数、total=0；核对为已比对/清单总数；收尾拷贝兜底时为已拷文件数）、`bytesUnpacked`/`bytesUnpackTotal`（后者取 manifest `unpackedSize`，老 manifest 为 0）。每个子阶段开始打一行 info（pack、版本、组件）。**复核并进解压**：写盘时 `DigestOutputStream` 算 sha256，全部解压后与各组件 `contents.sha256` 逐条比对（缺条目/不符仍拒绝），不再整树重读。**读空闲超时** `ai.packs.read-idle-timeout-ms`（默认 60000）：看门狗线程关响应流，JDK 流被关后 `read` 可能直接返回 -1，所以必须以超时标志判「中断」而不是「读完」，否则会被当成下载完成去比哈希、删掉 .part；请求 `.timeout()` 只管到响应头。**兜 Throwable**：`install()`/`installAsync` 的 Error 也落 `failed`；后端重启后内存态丢失时，`.staging/<id>-<ver>/unpack` 存在且未就绪 → `status()` 报 `failed`「安装被中断，请重试」（只有 .part 时仍是 `not_installed`，续传不受影响）。原子 rename 失败先重试两次（Defender 短暂占句柄）再退化逐文件拷贝。前端 `useOptionalComponents.installPack` 三条出口之外不许转圈：在途中回 `not_installed` → `errorKey=backendRestarted`；`STALL_MS`（3 分钟）内 state/phase/字节/文件数/百分比签名不变 → `errorKey=stalled`；卡片按 `item.stage` 出文案，总进度用 `item.runtimePercent`（阶段百分比会重置，总进度不许回退），对话拦截卡那一句取 `components.chatStage.<item.stageKey>`。前端判出的失败文案经 `deps.t` 取 locale，没注入时回落中文默认句。
   ④ 发版硬顺序：四个 pack 先经 `pack-release.yml`（runtime 矩阵腿，`app` 只在 mac 腿产一次）+ `deploy/publish-pack.sh` 上两站镜像 verify 通过，再打 `v0.38.0`（runbook：`docs/superpowers/plans/2026-09-09-pack-release-runbook.md`）。补丁组件收敛为 backend-app / frontend-h5 / zetaoffice-wrapper，`pysvc-src` 废除；requirements.lock 改动走 pack 发版。

## 测试命令总表

| 命令 | 目录 | 覆盖 |
|---|---|---|
| `mvn -B test` | backend/ | 51 个 *Test.java：IDOR/鉴权/分片上传/编排/记忆/证据/市场/脱敏 + **回放评测 OrchestratorReplayEvalTest**（resources/ai-eval/cases/ 10 组）+ DesktopContextSmokeTest。**必须 JDK 21**（本机默认 25 SIGBUS） |
| `OPENROUTER_API_KEY=… mvn test -Dtest=RealLlmSmokeTest` | backend/ | 真实 LLM 冒烟（默认跳过） |
| `npm test` | desktop/ | service-manager / model-manager / pysvc-runtime / overlay（补丁覆盖层）/ update-service（验签/下载/激活/回滚，本地 HTTP 伪造更新服务器） |
| `npm run check:emits` | frontend/ | @event 绑定 vs $emit 声明静态护栏（scripts/check-emit-bindings.mjs） |
| `npm run test:commands` | frontend/ | 命令注册表守卫（tests/commands/，17 条）：加速键查重、编辑器保留键黑名单、Esc/Enter/Tab、macOS 系统截图键、客户视图过滤、菜单树可序列化。**已进 CI**，改 config/commands/ 会被它拦 |
| `npm run test:lowa-e2e` | frontend/ | LOWA 真引擎+键盘链路（tests/lowa-e2e/run.mjs，puppeteer-core 无头，基线 19 组 169 断言；不经应用页面，天然无登录前置） |
| `npm run test:lowa-big` | frontend/ | LOWA 大文档基线组（tests/lowa-e2e/big-doc.mjs：150 页/30 表/20 图夹具由 fixtures/gen-big-doc.py 生成到 $TMPDIR，需 python-docx+pillow；六项硬阈三次中位数，约 6 分钟；与 run.mjs 共用 _boot.mjs）。改 office_thread.js 全文路径（枚举/修订/格式化/导出）后必跑 |
| `npm run test:app-e2e` | frontend/ | 全应用真人模拟（tests/app-e2e/run.mjs；PR-A 去登录后 J1=首启解锁门（试用码），其余旅程 local-mode 免登直达，不再注册 qa_bot_*；需 dev:h5 **5174** + local-mode 后端（默认 9696，冷启动可用新 jar 9797 顶班 + 隔离 user.home/H2/cwd，APP_E2E_JAR 供 J11，**J11/J13 还要 JAVA_HOME**）。**裸 jar 顶班必须补内置资源**：`AI_SKILLS_BUILTIN_DIR=<repo>/backend/skills`——缺了 `/api/skills/list` 返回 `[]`，脱敏与语音两步必然超时，**症状长得像 UI 回归**（2026-08-29 踩过，run.mjs 头注释有判别法；`backend/plugins` 目录已不存在，2026-09-21 核对，不用再拷）。**发版前必跑**（含 J12 英文旅程）。**两条判读红线（2026-09-21 v0.46.1 发版门实测）**：① 隔离后端没配 `OPENROUTER_API_KEY` 时 AI 路径是**空覆盖**——J6.5 的 `waitText('测试通过')` 匹配的是用户自己的提问文字，模型没回也绿，J12 过程卡断言随之恒 skip；发版门只证明 UI 链路，AI 改动要另有真后端实测证据。② 冷 worktree 首跑 vite 会 re-optimize 依赖并整页 reload（devserver.log 里 `optimized dependencies changed. reloading`），随机打断一两个用例且每次不同（J6.6/J6.7/J2 各挂过一次）；**以第二遍安静运行为准**，失败集与 vite 事件时间重合即环境不是回归。 |
  - **冷启动全配方（2026-08-19 实测走通）**：① 隔离后端起法必须 `cd backend/` 再起 jar——`ai.skills.dir: skills` 是相对 cwd 的，cwd 落在仓库根会把内置 skill 全丢掉（症状：`Skill 不存在: desensitize`）；② 全新 H2 未解锁会让套件卡死在解锁门，按 `tests/_lib/license-gate.mjs` 的 SEED_RECIPE 往隔离 `user.home/.aiworkdeck/license.json` 播存量 trial 票据（宽限期内合法，别开 trial-code 开关）；③ 5174 可能被别的 worktree 的旧 dev 服务占着（症状：断言全打在旧代码上），自起专用端口并设 `APP_E2E_BASE`；④ `APP_E2E_JAR` 一律绝对路径（runner 在临时目录 spawn，相对路径必挂 J11）；⑤ **自起专用端口的 dev server 必须同时带 `VITE_API_BASE_URL` 指向同一个隔离后端**（`npx uni --port 5175` 若不带这个环境变量，编译进浏览器包的 `api.js` 在 `localhost`/`127.0.0.1` 场景会硬编码回退到 `http://localhost:9696`——跟 `APP_E2E_BASE`/`APP_E2E_BACKEND` 完全是两码事，后两个只管 Node 脚本自己的 fetch 与 `page.goto` 目标；漏了这一步的症状是浏览器控制台刷屏「网络请求失败…端口 9696」，J1-J10 因为多数步骤不硬依赖响应内容而看着照样绿，到 J11 云端协作因为真的要读写数据才开始大面积报错，很容易误判成回归）；⑥ 隔离后端要带 `SECURITY_BROWSER_PROXY_E2E_ALLOWED_HOSTS=127.0.0.1`，否则 SsrfGuard 拦回环、J6.7 浏览器面板四步整组 skip（不是回归，v0.39.0 同样如此）。**发版前看一眼 skip 清单有没有新面孔**：#809 把 AI 过程卡挪进默认收起的 TurnActivityPanel 后，J12「过程卡工具名不含中文」恒走 skip、发版门静默失效（dev-board#593 改为点开这一轮的活动面板再断言，只有面板报这一轮 0 条动作才 skip，其余一律判红）。dev-board#646 把过程卡挪回消息流后 TurnActivityPanel 整体删除，J12 改为等发送键退出停止态 → 展开这一轮助手消息上的每条 `.activity-summary` → 在 `.activity-details .process-card .tool-name` 上断言无 CJK，skip 判据同样只认「这一轮没有活动条 / 活动条里没有过程卡」。
  - **J13（资源包安装）另起隔离后端时，同一台隔离后端不能只改 `ai.packs.base-urls`/`ai.plugins.registry-public-key` 就完事**：`--ai.skills.dir` 也必须显式给绝对路径（指向 `backend/skills` 的一份拷贝，不要指向原路径，防意外写入污染仓库文件）——隔离后端的 cwd 不是 `backend/`，相对路径解析不到内置 skill；命令行覆盖用 Spring 的 `--ai.packs.base-urls[0]=` 这种下标写法实测可行（`-D` 系统属性同理），构建测试用 pack 源与签名密钥对的公用逻辑在 `frontend/tests/_lib/pack-stub.mjs`（`startPackStub()`）。UI 侧把浏览器指到隔离后端不需要另起一个 dev server，新开一个 `browser.newPage()` 并在 `evaluateOnNewDocument` 里注入 `window.checkbaDesktop.apiBaseUrl`（`host.js` 的 `getApiBaseUrl()` 对它的优先级高于 `VITE_API_BASE_URL`，与真实 Electron 壳换后端端口同一条注入路径）即可。
| `npm run test:feedback-e2e` | frontend/ | 反馈浮窗全链路（dev Electron + CDP：真走主进程框选截图、Chromium 假麦克风录音、提交后从 API 回读附件字节）。需 dev:h5 + local-mode 后端，同 desktop-e2e 的端口约定 |
| `npm run test:desktop-e2e` | frontend/ | 桌面保存链路（弹 dev Electron 窗口，webview 真 LOWA 插文本→保存→API 下载验内容；PR-A 后免登直达，provision 会自动用试用码解锁+置向导）。`APP_E2E_BACKEND` 的端口会经 `CHECKBA_BACKEND_PORT` 传给 Electron 壳——渲染层的基址是壳注入的，只改 `VITE_API_BASE_URL` 对它无效 |

**app-e2e 离开页面前自动等流式结束（dev-board#826）**：run.mjs 给 `page.goto` / `page.reload` 套了一层 `quiesceAiStream`——`.stop-btn` 还在就先等（上限 120s，超时只记 note 不判红）再导航。所以 AI 轮进行中的导航「变慢」是刻意的，不是回归；发版门里「断流计数应为 0」的信号靠它才是开关而不是噪音。判据与 settleAiTurn 同源（`aiStreaming`），改停止键选择器要两处一起改。

**app-e2e 文件编号（dev-board#521）**：`createFile` 新建的测试文件允许 `wpsFileId=null`；J9/J10 的字节覆盖助手必须与 J4/真实编辑器一致，**只用数字 `id`** 调上传端点（dev-board#1035 起 `/api/files/{x}/...` 只认数字主键，前端与 e2e 不再传 `wpsFileId`）。强制要求 `wpsFileId` 会让合法落盘文件被判不存在，随后 MODIFY、分稿与协作步骤连锁失败。

每日全量 QA：`scripts/qa-nightly.sh`（crontab，跑在 ~/aiworkdeck-qa/repo 专用克隆，报告 ~/aiworkdeck-qa/reports/，失败 gh 开 issue 标签 qa-nightly，引擎取自已安装 app）。

## 端口体系（2026-08 起）

- **打包态桌面后端：5269 → 5369 → 5169 → 随机**（`desktop/main/services/backend-service.js` allocateBackendPort：真实 bind 探测；被占时先探 `/api/admin/wizard` 验明是否自家后端，**并对比 build 指纹**（spawn 时注入 `AWD_BACKEND_BUILD`=app.jar 的 size-mtime，wizard 响应 `build` 字段回显，PR#589/dev-board#139：更新后残留的陈旧后端曾被静默复用导致新前端打旧后端 404）——同指纹复用；指纹不一致警告并复用，不能杀非本壳创建的进程（旧进程可能握着 H2 文件锁）；陌生进程降级下一个端口。dev 态不校验指纹（restart-backend.sh 拉起的后端无指纹）。service-manager 的 verifyReuse/reallocatePort 契约即为此加）。实际端口经 BrowserWindow additionalArguments → preload → `window.checkbaDesktop.apiBaseUrl` 注入渲染层，`frontend/src/services/api.js` 最优先读它。
- **dev 态后端仍 9696**：restart-backend.sh / e2e / CI 全部不变；`CHECKBA_BACKEND_PORT` 可显式覆盖两种模式。注入优先级高于 `VITE_API_BASE_URL`，所以**凡是走 Electron 壳的测试/脚本，要换后端必须改 `CHECKBA_BACKEND_PORT`**，只指 dev server 的环境变量不管用（desktop-e2e 曾因此整条链失败）。
- pptx/mineru/kokoro/asr 打包态是动态回环端口（由后端内部转发，前端不可见）；编辑器静态服务器 47613 因 COOP/COEP 跨源隔离必须独立源，勿并入。

## 本地开发启动

- 一键：`./restart-all.sh`（Docker 服务 + 后端 + 前端 + 桌面）。
- 后端：`cd backend && ./restart-backend.sh`（mvn package -DskipTests → kill 9696 → nohup java -jar，prod 配置，日志 backend/app.log）。
- 前端：`cd frontend && npm run dev:h5`（5173；e2e 用 `npx uni --port 5174`）。**npm 不是 pnpm**。
- 桌面：`cd desktop && npm run dev`（AIWORKDECK_DESKTOP_DEV=1 electron .；dev Electron 复用已跑的 9696 后端不另起 java）。`npm run clean` 清用户数据目录。predev 钩子会跑 `scripts/brand-dev-electron.js` 把 node_modules 里的 Electron.app 改名（见下条）。
- Docker 附属：`docker compose up`（mineru 8001、pptx 5001；easyvoice 已于 2026-09-09 删除（上游无许可声明），语音合成走桌面捆绑的 Kokoro）。

## 关键构建脚本（desktop/scripts/）

- `prepare-backend.js` — fat jar→backend.jar + jlink 裁剪 JRE 到 bundled/<plat>/。
- `prepare-python-service.js` — python-build-standalone 3.11.12 + pip site-packages + 服务源码；mineru 纯 pip 无源码。`--runtime-only 1` 只烙 CPython（安装包用）；`prune(libDir, service)` 通用表 + 按服务表（mineru 去 gradio 三件套，前提已证明 `mineru.cli.fast_api` 不 import gradio）。
- `prepare-graphviz.js` — 烙最小 graphviz（仅布局引擎，不带任何渲染后端；闭包约 4MB）到 bundled/<plat>/graphviz/。**只有诉讼可视化的流程图布局要它**，而诉讼可视化自 v0.21.0 起改走 native pack 分发（[[native-pack-distribution]]），所以**这个脚本只在 `pack-release.yml` 里跑，不在 desktop-build.yml 的安装包构建链里**——它在 desktop-build.yml 里只作为缓存键的哈希输入出现（2026-08-29 核对）。按「安装包里为什么没有 graphviz」排查的人别再往构建链上找。mac 需 install_name_tool 重定位 + ad-hoc 重签（改过的 Mach-O 不重签会被内核 SIGKILL）；脚本自带正反两条自检（详见 `.claude/agents/litigation-visual.md`）。
- `build-pack.js` — native pack 出包：litigation-visual 三组件 + **四个 Python 运行时 pack（`pptx/mineru/kokoro/asr-runtime`，组件 `lib` 平台相关 + `app` 平台无关，mineru 无 app；`minAppVersion` 0.38.0）**。`pack-pysvc.js` 已删（dev-board#529）。
- `fetch-lowa-assets.js` — LOWA 运行时+CJK 字体进 frontend/dist/zetaoffice/，保留 brotli + .encodings.json 侧车。
- `sign-mac-natives.sh` — 签 electron-builder 够不到的 Mach-O（JRE + jar 内嵌 dylib），时间戳退避重试，nested jar 用 zip -0 回写。
- `desktop/lowa-build/mega-build.sh` — 从源码重建 zh-CN LOWA（Ubuntu 22.04，无人值守）。

## 部署与其它

- `deploy/web/` — Web 服务器版（瘦客户端 Phase A2/鸿蒙路线）：nginx.conf.example、能力探针 probe/、后端 prod 只听 127.0.0.1。
- `deploy/cloud/` — 官方托管的插件云后端（addin.aiworkdeck.com）：nginx server 块、systemd unit、env 模板、部署实录。
- `deploy/update-mirror-sync.sh` — 官网 ECS 上每小时一跑的镜像同步（补丁产物 + 安装包 + installers/latest.json）。
  **安装包留最新两版，别改回「只留最新一版」**：官网 /start 的下载按钮是服务端渲染的，
  数据源（官网仓 lib/latest-release.ts）对 latest.json 用了 `revalidate: 300`。旧包一删、
  而页面缓存里还是旧文件名，用户点下载就是 404（2026-08-18 发 v0.18.0 实测到）；
  留一版也给「已经点了下载、1.4GB 正在传」的用户留余地。改动这段先跑
  `bash deploy/update-mirror-sync_prune_test.sh`（纯本地，不碰网络与真镜像目录）。
  **服务器上跑的是一份副本**（`/www/wwwroot/update/desktop/update-mirror-sync.sh`，cron 每小时 :17），
  合并 PR 不会让它生效，要 scp 覆盖过去。
  **选版不用 `releases/latest`**：那是仓库级「最新」，正式 pack release 也算数
  （2026-08-19 实测顶掉应用版 2.5 小时，脚本连挂三轮、镜像停更）。脚本从
  `/releases` 列表挑 tag 形如 `v<数字>` 的正式版；pack-release.yml 那边同时标
  `prerelease: true` 双保险。latest.json 落地后会回调官网 `/api/revalidate-release`
  （配置在服务器 `/etc/aiworkdeck/mirror-sync.env`，token 与官网 env 同值），
  让 /start 下载链立即刷新；没配置/回调失败靠页面 `revalidate: 300` 兜底。
- `deploy/publish-pack.sh` — 原生资源包（native pack）上架：check 本地验产物 /
  sign 在官网机上用 env 私钥签 manifest（私钥不落本机）/ publish 双机上架
  `/www/wwwroot/plugin-packs/` 暂存校验后换入、双机验证后才切 manifest 指针 /
  verify 两站对账。产物来自 workflow `pack-release.yml`（workflow_dispatch，
  tag `pack-<id>-v<ver>`，win 侧 graphviz 只能在 win runner 出）。规范
  `docs/NATIVE_PACK_DISTRIBUTION.md`。**终验别在本机等（2026-09-14 pptx-runtime 1.0.1 实测）**：
  `publish` 的两站公网终验在本机 curl，本机拉 workdeck.ai 只有约 16KB/s（拉北京 13MB/s），183MB 的 lib
  要三小时、看着像卡死；版本目录在两台机就位而指针未切时，杀掉本地 publish，把脚本 scp 到新加坡机跑
  `verify <id> <ver>`（自身 30MB/s、拉北京 26MB/s，26 秒），通过后按 `switch_pointer` 的原子 cp+mv 在两台机各切
  一次，再 curl 两站 `<id>/manifest.json` 核版本。
- **`deploy/publish-lowa-engine.sh` — 换 LOWA 引擎必须走它，别手工传**（issue #310）。
  `check-build <目录>` 只在本地验产物；`publish <目录> <版本号>` 发到两台机；`verify <版本号>` 切指针前必跑。
  它把三件必须同时做对的事绑在一起：按形态判定该压不该压、**两台机都同步**（新加坡是本地镜像直出、
  不回源北京，而 CI 从境外解析走新加坡——只传北京会让境内 curl 全 200 而 CI 报 404）、
  以及内容级终验。校验不走「自己算的哈希对自己」这种闭环：wasm 断言解压后是 `\0asm`，
  data 断言解压后字节数等于 metadata 里的 `remote_package_size`（emscripten 自带真值，
  下游 fetch-lowa-assets.js 对 data 只查「长度 ≥1024」，兜不住双重压缩）。
  落盘先落 web root 之外的暂存区、校验通过再 rename 换入，旧版本自动备份到 `/root/lowa-engine-backup/`。
- 官网部署在独立仓库（website/，gitignore 掉），服务器 ssh -i ~/.ssh/aiworkdeck_ops root@47.92.111.102；ECS 8.137.95.63(~/.ssh/checkba_ecs)。
- **kokoro/asr 模型下载源顺序（dev-board#583）**：先 ModelScope，失败再回落 hf-mirror，经 `model-fetch.py --source hf` 读取固定 revision 与逐文件 metadata，大小及 LFS SHA256 / Git blob SHA1 验证后才发布 refs/main（`CHECKBA_MODEL_SOURCE=modelscope|hf` 强制单源）。原因：hf-mirror 只代理元数据，大文件 302 到 HF 官方 CDN（cas-bridge.xethub.hf.co），国内无代理必挂 `LocalEntryNotFoundError`。ModelScope 路径是 `desktop/main/services/model-fetch.py`（纯标准库，按 HF 缓存布局落 `HF_HOME/hub/models--*/{blobs/<sha256>, snapshots/<ModelScope commit>, refs/main}`，续传临时文件 `blobs/<sha256>.incomplete`，refs/main 最后写——所以旧的半截缓存里 refs/main 指向不存在的 snapshot 也能直接续下），运行侧 pack 的 app.py 不用改。**地雷**：脚本随 `main/**` 进 app.asar，Python 读不了，model-manager 每次下载前把它拷到 `~/.aiworkdeck/models/.model-fetch.py` 再跑。mineru 仍走 MinerU 官方 CLI（`-s modelscope`），不动。
- 模型不进包：mineru/kokoro/asr 模型首启在"组件管理"下载（下载进度按字节级整体，PR#142）。asr 的 faster-whisper medium 约 1.5GB，依赖闭包 182MB（压缩后约 57MB 进安装包，大头是 onnxruntime 70MB + PyAV 44MB，两者都是 faster-whisper 的硬依赖）。

## 已知地雷

**真机走查/门禁的三条环境地雷（2026-09-13，0.42.0 发版前实测）**：
① Electron 的 `app.getPath('home')` 在 macOS 上走 passwd 条目、**不认 `HOME` 环境变量**——隔离 HOME 起 dev 壳时，
`~/.aiworkdeck/logs/desktop.log` 这类按 home 派生的路径仍落在维护者真实目录；隔离只对后端（`-Duser.home`）有效。
② 模拟断网别只给 JVM `-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=1`：`SystemProxyRefresher` 每 60 秒把代理属性改回
机器真实系统代理（日志「检测到系统代理已变更 … 已就地更新」），之后请求真的出网、拿回 401 被分类成非网络错误，
看起来像「断网提示没生效」。要加 `--network.proxy.auto-refresh=false`。
③ 主检出 `frontend/node_modules` 若是 `npm ci --ignore-scripts`/手工装的，uni-h5 的 scroll-view 空判补丁（6.5.3）没打上，
`dev:h5` 控制台常驻 `setting 'scrollTop'` + 未处理 rejection，app-e2e 末尾护栏判死；判据 `grep -c` 三个锚点是否已 guarded，
处置直接跑 `node frontend/scripts/patch-uni-h5-scrollview.mjs`。

**装好的应用开着，三套 Electron e2e 全起不来（2026-08-23 修）**：`main.js` 的
`requestSingleInstanceLock` 按 userData 目录判重，dev 实例与 `/Applications/AI WorkDeck.app`
默认同一个目录，第二个进程被 `app.quit()` 当场顶掉。现象极不好认——Electron 起来、
打了 `DevTools listening`、随即无声退出，套件只看见「CDP 端点未就绪」或连 ws 时
`ECONNREFUSED`。`tests/_lib/electron-cdp.mjs` 的 `spawnElectron` 现在给 dev 实例挑
自己的 `--user-data-dir`（按 CDP 端口取名），`waitForCdpWs` 收下子进程句柄、进程先退
就立刻报退出码。**新 profile 是空的**：`appLanguage` 对全新安装按 `navigator.language`
猜语言（Electron 常报 en-*），断言中文字面量的套件必须像 desktop-e2e 那样先写
`localStorage.awd_app_language='zh-CN'` 再整页 `goto`（只改 hash 是同文档导航，模块不重来）。

**dev vite 的状态会被文件churn 弄脏**：worktree 里大批文件被改回改去（合并冲突、
stash 误 pop 之类）之后，5174 上的页面可能变成**整页无样式**（`.page-project-overview`
的 display 变 block、文档高两万多像素），而 CSS 其实都在、控制台一个错都没有。
按「点在视口外」的形态红在 e2e 里，很容易误读成布局回归。**先重启 vite 再判**。



- **`@ActiveProfiles("desktop")` 的 `@SpringBootTest` 必须同时把 `spring.datasource.url` 覆盖成
  `jdbc:h2:mem:`**（写法照 IdorAuthIntegrationTest / DesktopContextSmokeTest）：desktop profile
  的默认数据源是 `~/.aiworkdeck/local` 文件库且带 `AUTO_SERVER=TRUE`，开发机上测试会直接附着到
  **正在运行的桌面应用的真实数据库**读写。ChangeSignalWiringTest 曾漏掉这条——它在幽灵项目 7 里
  建「新建文件夹*」再 permDelete，运行中途崩一次就永久残留垃圾行，此后同名检查让本机所有运行
  deterministically 红，还查不出所以然（2026-08-20 实测，dev-board#57）。同病残留的清理配方：
  H2 Shell 带同一 URL（AUTO_SERVER 允许附着活库）先只读核对 name/created_at/user_id 再删。
- CI 签名→冒烟→打包顺序不可乱（PR#176）。
- **Windows 上 node:test 的 teardown 删「被本进程 HTTP 服务读流碰过的」临时目录，必须用异步
  `fs.promises.rm(dir, {recursive, force, maxRetries, retryDelay})`，不能用 rmSync**（PR#436，
  drawio-server.test.js 的 rmrf 帮手是范本）：读流 autoClose 的 fs.close 回调可能还排在事件
  循环里，rmSync 的 maxRetries 是同步忙等、会把事件循环连同那个 close 一起卡死，给多大预算
  都是 ENOTEMPTY 跑穿（run 32237671073 实测证伪过 rmSync 重试版）。纯文件读写的测试不受影响。
- **drawio-server 测试在 CI 按改动面跳过（PR#612）**：这组用例真起 HTTP 服务+真读写 Temp
  目录，Windows runner 的 Defender 会拿排他句柄锁临时文件 → teardown EPERM（hookFailed），
  外层重试只是把 8 秒的步骤拖成几分钟再挂，v0.26.0 首发 run 更锁死 110 分钟（force-cancel
  才解）。desktop-build.yml 的「Detect drawio changes」在 PR/push 区间未碰
  `desktop/main/drawio-server.js` / `desktop/tests/drawio-server.test.js` /
  `desktop/scripts/fetch-drawio-assets.js` 时注入 `SKIP_DRAWIO_TESTS=1`（测试文件顶层早退）；
  **tag 发版与 workflow_dispatch 永远全量**。Desktop unit tests 步骤有 `timeout-minutes: 15`
  兜底。改动这三份文件之一时，自查该 PR 的 Detect 步骤输出应为 FULL。
- 发版有个跨仓的时间差：镜像脚本删旧包 vs 官网页面 ISR 缓存。两边任何一边改保留策略/缓存时长前，先看 `deploy/update-mirror-sync.sh` 里 prune_old_installers 的注释。
- macOS CI 红要当真查（Apple 协议过期事件后恢复）；`--admin` 合并与 worktree 删分支技巧见 ci-macos 记录。
- **`office-addin/installer/build-installers.mjs` 挑签名身份靠「第一条 Developer ID Application」**
  （`security find-identity -v -p codesigning` 的输出顺序，不是按主体筛的）。维护者 Mac 上
  同时装着香港 `X9B97KVA84` 与境内 `8WKHZVR2W8` 两张 Developer ID Application 之后，
  插件安装器签到哪个主体名下就不确定了。出插件 dmg 前先 `security find-identity -v -p codesigning`
  核一眼落在第一条的是谁；要钉死主体得给脚本加显式身份参数（尚未做）。
- iCloud 驱逐会掏空本地文件（打包/测试环境两次踩）；EMFILE 用抬 ulimit 解。
- **iCloud 上「读一下」不是免费的**：被驱逐的文件是 dataless 占位，`stat` 秒回真实大小但
  `st_blocks=0`，**一 read 就同步触发下载**（本机实测 23KB 文件首次 read 耗 1.28 秒，延迟
  决定、与大小无关）。所以凡是「扫用户文件夹」的代码只许 stat，绝不许顺手读内容——
  `LocalRootWatchService.WATCH_FILE_HASHER` 就是为此把 DirectoryWatcher 的默认内容哈希
  换成了 mtime 哈希（默认值会在建立监听时把整棵树逐字节读一遍，等于打开项目就把整个
  文件夹从 iCloud 拉回来）。回归用例 `LocalRootWatchServiceTest`，拿命名管道当"未下载文件"。
  已知仍会读穿全树的是版本记录的 `git add .`（JGit 必须读内容才能存 blob），但它被
  `repoService.isInitialized` 挡着，只有开了版本记录的项目才走到。
- **macOS 菜单栏左上角那个应用名只认 .app 包的 `CFBundleName`**，跟 `app.name`、跟菜单模板
  第一项的 label 都无关（实测 `app.setName('AI WorkDeck')` 之后菜单栏照旧写 Electron）。
  打包版由 electron-builder 按 `build.productName` 写好；dev 跑的是 node_modules 里的
  Electron.app，所以要靠 `scripts/brand-dev-electron.js` 就地改名（Electron 的 dist 包是
  linker-signed adhoc，`Info.plist=not bound`，改它不破坏签名）。**做官网/README 截图前
  务必确认这一步跑过**，否则截出来的图左上角是 Electron。
- worktree 冷启动跑双 e2e 完整配方见 v0.7.7 发版实录；worktree merge 报 stash failed 用 cherry-pick 绕。
- 坏 pnpm node_modules 遇到过——本项目一律 npm。
- **worktree 的 node_modules 落后于新增依赖**（如 TOTP 带来的 `qrcode`）时，vite 会推一个盖满视口的 `vite-error-overlay`，坐标点击全被它吃掉，e2e 表现成"点了没反应"的超时而非编译错误。冷启动 worktree 跑 e2e 前先 `npm install`；desktop-e2e 的点击已加命中校验，会直接报出遮挡者和它的文案。
- **`dist/zetaoffice` 里的 glue 会随 master 前进而过期，且会伪装成产品回归**（2026-08-18 实测踩到）：
  `office_thread.js` / `zeta.js` 是 `src/zetaoffice/public/` 的构建产物，构建一次就躺在 dist 里不动了。
  worktree 活得久一点、master 又改过那份源码，跑出来的就是**旧引擎行为**。这次的现象是 lowa-e2e
  三条署名断言红：期望 `AI WorkDeck` 实际 `AI Workdeck`——看着像"品牌统一漏改、还会写进用户的 Word
  修订署名"，一查源码一处小写都没有，纯粹是 dist 旧。重建后 391 通过 0 失败。
  **判据**：断言值和源码里的常量对不上、而源码明明是对的 → 先重建 glue，别急着开 bug。
  重建配方（`emptyOutDir: true` 会清空整个目录）：先把 `lowa/` 与 cjk 字体挪走 → `npm run build:zetaoffice`
  → 再挪回来。只借兄弟 worktree 的 `lowa/`+字体，glue 一律本树构建（见记忆「引擎 glue 与载荷之分」）。
- **`dist/zetaoffice` 里的 glue 会随 master 前进而过期，且会伪装成产品回归**（2026-08-18 实测踩到）：
  `office_thread.js` / `zeta.js` 是 `src/zetaoffice/public/` 的构建产物，构建一次就躺在 dist 里不动了。
  worktree 活得久一点、master 又改过那份源码，跑出来的就是**旧引擎行为**。这次的现象是 lowa-e2e
  三条署名断言红：期望 `AI WorkDeck` 实际 `AI Workdeck`——看着像"品牌统一漏改、而且会写进用户的 Word
  修订署名"，一查源码一处小写都没有，纯粹是 dist 旧。重建后 391 通过 0 失败。
  **判据**：断言值和源码里的常量对不上、而源码明明是对的 → 先重建 glue，别急着开 bug。
  重建配方（`emptyOutDir: true` 会清空整个目录）：先把 `lowa/` 与 cjk 字体挪走 → `npm run build:zetaoffice`
  → 再挪回来。只借兄弟 worktree 的 `lowa/`+字体，glue 一律本树构建。
- **e2e 起 Electron 必须整棵进程树一起收，CDP 端口不能写死**（2026-08-17 定位）：
  `spawn('npx', ['electron', ...])` 之后 `elec.kill()` 只打得到 npx，真正的 Electron 是**孙子进程**，
  收不到信号会活下来继续占着 CDP 端口（实测跑完一轮之后它还在 LISTEN，端口不释放）。下一轮撞上它有两种死法：
  残留还应答 CDP → 你连上去驱动的是**上一轮那个窗口**；残留只占端口不应答 → 干等 60 秒报「CDP 端点未就绪」。
  正解三件套（desktop-e2e 已落）：① `detached: true` 起进程组 + `process.kill(-pid)` 整组收（并挂 `process.on('exit'/'SIGINT')`）；
  ② 每轮现挑一个空闲端口（`DESKTOP_E2E_CDP_PORT` 可覆盖），别写死 9333——维护者常年多开，并行会话必撞；
  ③ 连之前用 `lsof` 核一遍持端口的 pid 在不在自己那棵树里，不是就当场报死。
  这三件套 + 输入加固已收进 **`frontend/tests/_lib/electron-cdp.mjs`**，desktop / feedback / meeting
  三套共用（以前各抄一份，同一个坑要踩三次）。**app-e2e / lowa-e2e 不受影响**——它们用
  `puppeteer.launch()` 自己起无头 Chrome，进程由 puppeteer 管，也自带下面那三个开关。
- **"点了没反应"先分清是输入通道坏了还是界面坏了**：`page.mouse.click()` 之后在 `window` 捕获期录
  pointerdown/mousedown/mouseup/click，**一个都没有 = 输入通道的问题**，同坐标重试没有意义。
  这一档故障的特征很干净也很反直觉：**`mouseMoved` 照常送达，`mousePressed`/`mouseReleased`/`dispatchKeyEvent`
  被静默丢弃**，而渲染器一切正常（evaluate、布局度量、elementFromPoint、`$refs`、页面栈全对），且一旦坏了整轮不恢复。
  已逐条实测排除：窗口被遮挡/隐藏、别的 App 抢焦点、无边框标题栏的 app-region 拖拽带、页面栈堆两个工作台、
  坐标重排点空、OOPIF/webview 盖住、连错了别人的 Electron。
  **`visibilityState: hidden` 不是故障信号**——这台机器上窗口本来常年 hidden（被终端盖着），通过的轮次同样是 hidden，
  别再拿它当线索（上一版这条记错了，害人查了一轮窗口可见性）。
  主因就是上面那条进程泄漏：修掉之后失败率从 **6/36 掉到 1/61**；剩下的极少数还没定位到 Chromium 内部机制。
  desktop-e2e 的处置是**一次诚实的恢复**：整页重载让浏览器重建这一页的输入路径，然后仍旧用真实鼠标重点一次，
  恢复不了就报死并在错误里点明"是输入通道坏了不是界面问题"。
  **不要退回"页面内 `dispatchEvent` 伪造点击"兜底**（#390 曾这么干，已撤）——桌面端就这一条真实输入的覆盖，
  换成假的之后这一步就再也挡不住真的界面回归了。
  **根因已坐实（2026-08-18）**：是"这一页没被当成有焦点/活动窗口"。把加固摘掉重跑 120 轮，
  复现 3 轮、共 8 次判定，**每一次都是**：掉事件时 press=false → 开
  `Emulation.setFocusEmulationEnabled` → press=true。按下与按键跟焦点绑定、`mouseMoved` 不绑定，
  所以现象才是"移动送得到、点击和按键送不到"。
  解药两层，都在 `_lib/electron-cdp.mjs`：起 Electron 带
  `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` /
  `--disable-background-timer-throttling`（`puppeteer.launch` 自带，手动 spawn 再 connect 就没有），
  连上页面后开 `hardenPageInput`（即焦点仿真），导航多的地方用 `reassertFocusEmulation` 再压一次
  （emulation 挂在 CDP 会话上，会话/导航都可能把它丢掉）。
  **同一批现场还证伪了「整页重载」这个解药**：重载三次按下通道仍然是死的，那一轮照红不误。
  所以恢复路径必须先补焦点仿真，重载只能算兜底的兜底——别再把重载当主力。

- **meeting-e2e 曾在 master 上整轮红（10/10），四个坑叠在一起**（2026-08-17 修复）：
  ① 用的还是"写 `checkba_last_project_id` → reload 直达工作台"的老配方，而 2026-08 起启动一律落
  项目列表页，于是第一步就卡死——改成 desktop-e2e 同款"轮询到真进工作台为止，在列表上就点卡片"；
  ② 拿「资源管理器」当工作台就绪判据，但**左栏面板是记住上次的**，上一轮把它切到「会议录音」之后
  下一轮永远等不到这四个字——改用 `.page-project-overview` 这种与面板无关的根节点；
  ③ rail 按钮是**开关**，面板已经开着时再点一下正好关上——改成"确保打开"而不是"点一下"；
  ④ **没钉死界面语言**，Electron 常带 `--lang=en-GB`，rail 会变成 "Meeting Recording"，
  中文选择器全失配（现象很像"skill 没启用"，极易误判）——补上 `awd_app_language=zh-CN`。
  ②③是同一类：**上一轮留下的状态破坏下一轮**，写这类断言前先问"上一轮跑完留下了什么"。
- **app-e2e 的两类陈旧断言**（2026-08-18 扫出来的，各红过一轮）：
  ① **左栏 rail 的标题直接抄了 i18n 文案**，而文案会改——「EasyVoice」在 #389 改成「语音合成」，
  J6 那条 `[title="EasyVoice"]` 就一直等不到。改文案时记得回看 J6 那一行；标题的真源是
  `src/config/leftSidebarPlugins.js` 的 `label`（i18n 键 `config.sidebar.*`）。
  ② **界面上出现 ≠ 已经落库**：概览档案那步 `waitText` 一过就立刻读 `/profile` 接口，
  可 @blur 触发的 PUT 还在飞、ProfileHeader 又是乐观更新的，于是间歇性读到一条全 null 的记录。
  凡是"改了界面再回接口对账"的断言，都要轮询到后端认账为止，别赌那一拍。
  （这一类和 #403「不再赌时间」是同一个毛病，写新断言前先问一句：我等的是渲染还是持久化？）
- 分支保护拦 gh pr merge 时权宜 = 用户网页点 Bypass rules and merge（白名单未配成）。
- `docs/` 在 .gitignore，入库要 `git add -f`。
- **改跨类 `public static final String` 常量的值必须 `mvn clean test`**：这类常量在编译期被内联进
  调用方的字节码，maven 增量编译不重编未改动的测试类，于是出现「源码一致、字节码不一致」的假失败
  （2026-08 改 Ollama 设置键时踩过：测试报 expected qwen3:14b but was qwen3-vl:8b，`javap` 确认
  测试类里内联的还是老键名）。CI 是 clean build 所以只坑本地。
- **删「零引用」的 Spring bean 前先想有没有 `@ConditionalOnMissingBean` 角色**：
  2026-08 清理 `service/ai/DynamicContentRetriever` 时，langchain4j `RagAutoConfig` 因缺少该 bean
  自造 `contentRetriever`，但项目有两个 `EmbeddingStore<TextSegment>`，导致16个 context
  因 NoUniqueBeanDefinition 起不来。当前启动候选已移除通用 starter，保留显式检索器；
  重新引入自动装配时仍须核对这项依赖。`DesktopContextSmokeTest` 保留为容器装配护栏。
- **`@Table` 的 `indexes` / `uniqueConstraints` 里必须写 snake_case 物理列名**：这两处不参与
  PhysicalNamingStrategy 的驼峰转换（本仓没配自定义策略，用 Spring Boot 默认的
  CamelCaseToUnderscoresNamingStrategy，字段 `projectId` 落成列 `project_id`）。
  Hibernate 6.4.4 会先把它当**逻辑名**查一次，所以写驼峰往往侥幸能解析、索引其实建对了；
  但一旦查不到就把字符串原样塞进 DDL，而 `@UniqueConstraint` 是内联在 `create table` 里的，
  整条建表语句失败、Hibernate 只打一行 WARN（`GenerationTarget encountered exception`）
  就继续启动——**表根本没建出来，启动看着正常，第一次查询才炸**。
  `EntityIndexColumnNamingTest` 是这条的护栏：反射扫全部 `@Entity`，对着 H2 的
  INFORMATION_SCHEMA 逐条对账列名与索引，新实体写错驼峰会自动红。
- **Electron 主进程禁用 `spawnSync`/任何同步阻塞调用**：v0.21.0 新机首启 10-30 秒无窗口、
  Dock 弹强制退出的根因是 `pptx-service.js` 的 `prepare()` 用 `spawnSync` 跑 alembic 迁移——
  这一步冻住的是**主进程**，Node 事件循环停摆等于整个 app 失去响应，系统据此判定"无响应"。
  改成 `spawn` + Promise 等 `exit`（模式抄 `pysvc-runtime.js` 的 `extractTarOnce`），语义不变
  （非零退出码报错、stderr 截断）。同理，首启解压进度窗（`main.js` 的 `ensurePysvcReady`）
  不能在解压完就销毁——后面 `createServices→allocatePorts→startEager` 还要拉起 Java 后端等
  本机服务，这段同样耗时且此前完全没有 UI；真正销毁要挪到 `createMainWindow()` 之后
  （挂在主窗口 `ready-to-show`，避免双窗口叠加闪烁），窗口本身在这期间只切文案不重开。
  `startEager` 逐个 `await` 也一样是白等：各服务端口已在 `allocatePorts` 统一分配好，
  互相没有启动时序依赖，串行只是把首启时间累加，已改 `Promise.all` 且保留单服务失败互不影响。

## 桌面首屏关键路径（dev-board#1472）


必要的数据库回调由 `StartupDataInitializer`（`SmartInitializingSingleton`）统一在普通 Bean 构造后、WebServer 开始接收请求前执行：外部服务档位回填 → 插件孤儿任务恢复 → 内置插件安装/禁用状态读取与插件加载 → 技能扫描。`PluginService` 加载可执行插件前必须完成旧任务恢复，禁用状态必须先于 JAR 执行；`ToolRegistry` 保留活的插件工具 supplier。这里不改变各回调原有异常处理。反馈补传/反馈处理状态同步、匿名统计/团队统计补传、插件封禁同步与资源包安装/更新定时器改在 `ApplicationReadyEvent` 启动，避免后台线程在对象构造期间提前触发 JPA 等待；原定时重试及用户主动操作保留。非 desktop 的同步 JPA 也沿用同一必要阶段。`StartupDataInitializerTest` 用真实 Spring 生命周期处理器验证构造期间零数据/后台回调、阶段顺序及 Ready 后启动，并用真实 Tomcat 验证必要阶段阻塞/失败时未开始接收业务；测试不代表墙钟收益，性能仍需冻结产物 A/B。

主窗口等待 Java HTTP 健康及补丁失败回滚完成，不等待已装的 PPTX/MinerU/Kokoro/ASR 服务。`main/main.js` 先单独 `start('backend')`，主页面 `did-finish-load` 后再 `startEager(['backend'])`；可选服务失败只记自身错误，不重建窗口。首次页面加载和 JVM 初始化不再与模型加载争抢资源；退出/管理器关闭时不启动迟到组件。按需 `host.services.ensure` 沿用服务串行队列。`startup-readiness.test.js` 执行实际启动链与管理器调度，验证后端等待、可选服务不阻塞、回滚前不加载旧前端及退出护栏；这些合成测试不等于正式安装包的墙钟提速实测。旧补丁的同步目录清理仍在关键路径，未安装可选 pack 的机器也仍需单独测量 Java/H5 启动耗时。

`PgVectorConfig` 对非 PostgreSQL JDBC 数据源直接构造既有内存向量存储；H2 不得先调用模型 `dimension()` 或构建 PG 连接再降级。PostgreSQL 仍动态探测并缓存模型维度。`PgVectorConfigTest` 验证 H2 零模型/PG 调用、两个存储的独立检索及 PostgreSQL 原有建库参数。

桌面 profile 的 JPA 仓库使用 `bootstrap-mode: deferred`，配合异步 EntityManagerFactory 初始化；上下文刷新仍校验全部仓库，不使用全局 lazy 或将查询校验转嫁给首次操作。`AsyncExecutorConfig` 的交互池以 `applicationTaskExecutor` 为正式 bean 名、`taskExecutor` 为兼容别名：Spring Boot 3.2.4 在多个 `AsyncTaskExecutor` 存在时从 Map 按正式名称选择 JPA bootstrap executor，仅把框架名称设为别名会静默失去异步初始化。不得改池大小或复用 memory/context 池来补这个接线问题。`AsyncExecutorConfigTest` 覆盖实际三池 Map、Boot customizer 选择、别名同实例及三种 `@Async` 调用。延后仓库初始化会使 HTTP 端口和 `SELECT 1` 早于业务初始化完成；启动验收须分别记录 HTTP 健康、Spring Ready 事件与 `ACCEPTING_TRAFFIC`，并验证首次身份、项目及文件读写，不把提前可连通算作完整提速。诊断入口的事件耗时与并发区间不能简单相加成墙钟收益；正式 A/B 仍用出货入口、冻结 JAR 和隔离数据目录。

`DesktopHealthController` 只有在 `ApplicationAvailability` 为 `ACCEPTING_TRAFFIC` 且有界数据库探测成功时返回 UP；必要 runner、同步 ready listener 尚未结束或应用正在关闭时返回 503。不要在最高优先级 Ready listener 中提前置位。`DesktopStartupReadinessTest` 使用真实 HTTP 监听与门闩验证未完成/失败启动；其专用配置用 `@TestConfiguration`，避免污染全应用扫描。既有补丁健康判定、回退与退出流程仍消费同一接口。

`LocalRootWatchService` 的存量项目目录注册不再占住同步 Ready 回调，而由已有 `watchExecutor` 承担唯一可取消任务；已打开项目的实时对账继续使用独立 executor。项目显式打开、删除提交、停止与关闭的竞争契约见 `version-control.md` 与 `LocalRootWatchStartupTest`。不要把这项注册延后说成数据库/JPA 迁移完成，正式健康门未放宽。

## 验证（改本领域自身时）

- 写作辅助（dev-board#538）：CI 跑 `frontend npm run test:completion`（本地提取/排序、资料转换、宿主范围与客体交互）；`test:lowa-completion` 与 `test:writing-ui` 需真实 LOWA 载荷，覆盖位置令牌、中文输入、明确查询预览、资料插入与撤销。第三方响应使用测试资料，不在回归中自动消费查询额度。
- 正式桌面首启验收须隔离 Electron profile、Electron 数据目录、JVM `user.home` 与后端端口，避免覆盖已安装应用或读写真实用户数据；确认无旧 pysvc 解压窗口、可选组件提示正常。写作辅助首启回归不安装可选组件或调用付费 AI；组件功能另有原生运行时冒烟检查。具体启动手段可随发布环境调整，验收结果须来自正式产物。

- 服务生命周期测试必须注册失败路径的清理（`t.after` / `stopAll`）；就绪断言应在有界时间内验证真实响应，不能让一次 250ms 端口探测失败后遗留假服务拖满 CI 超时。v0.38.0 首轮 Mac 构建曾因此超时，回归与修复记录见 dev-board#546。
- 改 workflow：推 PR 触发 windows 矩阵先验；mac 变更合并后用手动 workflow_dispatch 验证。
- 改构建脚本：本地跑对应脚本 + desktop `npm test`（pysvc-runtime 有覆盖）。

- 2026-09-07 桌面剪贴板回归：`test:desktop-e2e` 覆盖系统复制→IPC采集→卡片→确认删除→数据库消失，原剪贴板仅暂存内存并条件恢复。macOS CDP键盘模拟要在KeyA/KeyC附带`commands: [selectAll]/[copy]`，否则修饰键发送成功但原生编辑动作不执行（选区仍0），会伪报采集失败。
- 全应用J2/J11按已恢复的团队案件库取回入口走真实鼠标；不再以旧SHOW_CLOUD_ACCEPT=false口径断言或强开组件状态。

- 即时审校（dev-board#547）：CI `test:inline-review` 覆盖宿主版本围栏、手动 AI 与 guest 中英文交互；`test:lowa-inline-review` 使用原生浏览器计时器并验证真实定位/修订/撤销，桌面 `tests/desktop-e2e/writing.mjs` 验证中文输入后本地规则自动启动。

- 写作交互复测（dev-board#538/#541/#547/#549）：CI 增加 `test:insight` 覆盖链接预览、来源失效、目标已在后台时的分屏路由。`test:writing-caret` 可配 `LOWA_E2E_DPR=2` 在引擎启动前模拟 Retina，验证正文提取→光标菜单→Tab→撤销；`test:lowa-link-preview` 使用真实 Ctrl/Cmd 鼠标点击覆盖外链、书签和 REF。完整桌面用例要求 `WRITING_E2E_ROOT` 指向独立后端 cwd/user.home，复制壳并在 main 前隔离 Electron home/profile，避免接触用户资料。


## 系统文件关联与打开队列（dev-board#1212）

`desktop/main/open-paths.js` 接 macOS `open-file`、Windows 初次 argv 与 `second-instance`，主进程保留 FIFO 请求直到渲染层 ACK。`host.menu.openPathsReady()` 只在工作台 mounted 且标签恢复完成后调用；每条 `open-path` 的 `requestId` 在前端处理/显示错误后由 `ackOpenPath` 确认。hash 导航和重复 ready 不重投在途请求，真正 reload/crash/换窗重投未确认队首。窗口最小化不能注销仍存活的工作台保存出口。

mac 的 `build.mac.fileAssociations` 用 `rank: Alternate`；Windows 在 `build/win/file-associations.nsh` 仅写本应用 ProgID、OpenWithProgids 和 Capabilities。**不要改成 electron-builder 24 的顶层 fileAssociations**：该版本 NSIS 内置宏会写扩展名默认值。安装/升级只登记候选，默认打开程序由用户选择；卸载只移除本应用登记。关联名单须与真实文件预览类型一致。

Windows 实机门：`desktop/scripts/test-file-associations.ps1` 在一次性 Actions runner 上执行安装→改默认→重装→卸载，验证 17 类候选、已有默认与 UserChoice 保留。electron-builder 24 用 StdUtils 重读 `/D`，带空格路径必须给值加引号。其捆绑 NSIS 3.0.4.1 的 `DeleteRegKey /ifempty` 只检查子键，不检查命名值；**不得用它清理共享 OpenWithProgids 键**，只删本应用的值。该错误由真实重装门发现；模拟器须覆盖卸载后重装，不能把 `/ifempty` 当作无操作。

回归：`desktop/tests/open-paths.test.js`、`file-associations.test.js`。`frontend/tests/desktop-e2e/local-files.mjs` 用全新 home/profile/H2/storage/端口测试源码 Electron 的冷启动队列、同名异目录、原位保存、PDF/Word；先构建 H5/editor/backend 并准备本地 LOWA 资源，`JAVA_HOME=<JDK21> node frontend/tests/desktop-e2e/local-files.mjs`。它注入原生打开事件，不能替代正式安装包的 Finder/Windows 打开方式验收。


## 本地后端运行期自检（dev-board#1216）

### 本地轻量启动候选（dev-board#1472/#1474，默认未启用）

`desktop.local-core.enabled=true` 仅用于 desktop/local-mode/loopback 的隔离候选。`LocalCoreBootstrap` 在 Spring 建容器前核验现有 H2 的持久化契约与实际 schema proof。构建时用完整实体映射两次生成独立 H2，确认结构一致后打包契约（DDL、H2/Hibernate 版本、JPA/SQL 初始化配置、bootstrap epoch）；启动直接顺序读取自身应用归档的 class 字节指纹，校验构建资源未过期，不再运行 Spring 实体元数据扫描，也不创建 EMF。普通类新增持久化注解同样会使旧指纹失效；构建阶段拒绝自身归档之外的映射类，未来增加外部映射模块须显式扩展契约。字节指纹不进入兼容 ID，兼容重打包仍复用资格。v2 proof 允许应用重打包但契约相同的升级直接进入 CORE；旧 v1、缺失/过期契约、配置差异或 schema 变化仍走完整初始化，完成所有同步 Ready 回调后再记 v2。bootstrap 数据准备语义变化时必须提升 `BOOTSTRAP_EPOCH`。build ID 继续用于进程/健康身份，不能代替数据兼容凭据。全新数据库仍先走完整初始化，不能宣称首次安装已获同等提速。使用原数据库、原 ID/UID、原文件路径，不能再旁建可写 SQLite 权威。早期池禁用 AUTO_SERVER 并要求 IFEXISTS，阻止另一个旧 JVM 同时连接；Hikari 实例交给 JPA 共用，Hibernate/schema SQL 初始化在已验证路径禁用。真正 native EMF 未完成时仍保留 CORE 读取；`StartupDataInitializer` 的首个动作排空 CORE leases，再交权给业务初始化。失败不得自动回 CORE 形成双写。

独立 `LocalCoreGateway` 保持公开端口，Spring 私有 connector 使用随机端口，配置中的 server.port 和回调 URL 仍用公开端口。复用本机准入、CORS、源代码声明过滤器；文件通过现有 ResourceHttpRequestHandler 支持 HEAD/Range/416。关闭独立 Tomcat 必须 stop 后 destroy，否则容器 await 线程会使 JVM 退出不完。未知路由转交完整后端前先释放 CORE lease，不能持 lease 等待交权。

轻量项目列表与 `ProjectService.listProjects` 同时隐藏 `LOOSE_FILES` 和 `SCRATCH`，包括本人和成员的随手工作区；直接访问仍按原 ACL，转正后同一 ID/UID 立即可见。新增聊天模式默认仍从 welcome/ide 进入；明确选择 chat 恢复时，创建随手工作区的 POST 继续等待完整服务，不把写接口混入早期读取白名单。

资格化候选在 CORE leases 完全排空、真实 JPA/版本交接成功且状态已为 JPA 后，通过独立 `onJpaAvailable → jpaDocumentsReady` 发布本地文档能力；DRAINING 仍拒绝新准入。Gateway 只将精确文档方法/路由交给该能力，复用原 H2 的只读/内容协议实现；内容发布此时已绑定真实 `WorkSessionService` 项目锁和 JGit receipt 交接，不需要等私有 Servlet、插件初始化或后续 runners。未知业务接口仍等完整后台，full-health仍503，effects仍到完整Ready后才安装。失败/关闭撤销本地JPA准入，不能退回CORE。

该并行窗口的 `MediaFileTypeReconciler`、`OrphanParentReconciler` 在候选开启时使用同一项目锁：外层只发现项目/文件ID，锁内重新查询实体后才修改，不能把锁外旧实体merge回去覆盖刚保存的file_size/updated_at。资格与schema契约不变；feature-off保留原迁移路径。`LocalCoreJpaContinuityTest` 使用真实Spring Data JPA、H2、项目锁、JGit和HTTP，在没有私有Servlet/完整Ready的场景验证保存与before-image baseline；受控暂停迁移的旧实体发现查询，再并发保存，核验两种迁移不覆盖新元数据。此测试不等于全产品正常负载性能或旧数据库升级验收。

兼容候选另有较窄的「文档路由就绪」门槛：所有 runners 已结束后的 Ready 事件先显式完成 `OrphanParentReconciler`（同次启动只执行一次，失败不提前放行），再允许既有核心 GET/HEAD、内容协议 GET/HEAD/PUT 与 receipt GET/DELETE 经原 MVC 访问。尚未完成的普通 Ready 回调仍挡住其他业务路由；两条精确健康 GET/HEAD 经原 MVC 就绪检查返回503，不能据端口可用提前报UP。该阶段保留原本机准入、控制器鉴权、内容事务和版本锁，保存后的 AI/标签副作用仍等完整 Ready。启动失败/关闭会同时撤销文档准入；无 gateway 的 legacy/首次安装/feature-off 不触发额外修复或提前路由。这条门槛仅负责切换到私有 MVC；更早的 JPA 本地文档能力见上段。`LocalCoreDocumentReadyTest` 用随机本机端口、受控阻塞的 Ready listener、真实 MVC 与 H2 内容发布验证；版本服务使用替身，不能据此称完整 JPA/JGit 或正常负载提速已验。

`/api/desktop/startup-health` 的 UP/phase=core 只表示早期业务读取可用，原 `/api/desktop/health` 此时仍是503。phase=full 与完整健康必须等 ACCEPTING_TRAFFIC，不能只看 ApplicationReadyEvent 或 FactoryBean 代理。桌面首屏只等 startup-health；完整后端在原启动 deadline 内以最多500ms周期检测，确认完整健康后恢复10s。新路由只有明确404才兼容旧健康链，dev 的 wizard 同样不能覆盖已存在的503。健康结果、overlay 成功/失败均绑定实际 launch/process，迟到旧结果不能给新启动记成功；内部 launch 含 child，不得放入 renderer IPC。

完整 UI 曾暴露 HTTP/1.1 六连接饥饿：六个非早期接口在网关等完整后端，使文件树在浏览器排队约4秒，真正读取仅约13ms。`backend-request-gate.js` 在主窗 session 的 onBeforeRequest 中排队这些请求，保留早期 GET/HEAD 与 OPTIONS 通道；能力清单只来自 build 校验成功的 core 健康响应。未知旧后端保持原传输；换 launch、端口、退出或到截止时取消待发请求，不重放到新进程。不要同时给同一 session 安装第二个 onBeforeRequest listener。实际隔离 UI 文件树4019→150ms只属诊断，不替代正常负载正式对照。

排队请求必须按 Chromium request id 在 `onErrorOccurred` / `onCompleted` 中移除，不能再调用已取消请求的回调。Electron 30.5.1 的真实 XHR 超时探针可使旧实现触发 native dangling-pointer 崩溃，JS try/catch 无法捕获；见上游 [electron#42505](https://github.com/electron/electron/issues/42505)。队列同时拥有这三个 webRequest 监听器，清理时一并注销，不能被其他监听器覆盖。`npm --prefix desktop run test:backend-request-gate-e2e` 用隔离 profile、随机本机端口和真实 Electron 验证超时不重放、后续请求成功及进程退出；不使用关闭崩溃检查的启动参数。

后台工具和 RAG 使用项目显式装配；通用 `langchain4j-spring-boot-starter` 已替换为同版本核心库，避免无 `@AiService` 接口时仍进行额外类扫描，Ollama starter 保留。`WebTools` 在 local-mode 不启动浏览器预热线程，实际 browse 请求仍沿原路径创建 Playwright；不能把这项改动称为已验证首次网页读取无额外成本。必要数据恢复、完整仓库校验及 Ready 回调顺序保持原样。

候选的 `LocalCoreContentHttp` 在 CORE/JPA 两阶段提供同一带版本的 GET/HEAD/PUT 与 receipt GET/DELETE 协议。下载快照绑定实际字节的 SHA、文件 UID 与本机身份；上传完整收完后才取得项目版本锁、publication 锁和短数据库事务。持久操作 UUID/回执/取消栅栏阻止重复与迟到写入，任何不确定结果不得降级为旧无条件 POST。客户端先探测数字 `coreContentProtocol=1`，元数据跟随准确的 ArrayBuffer，在模型装入成功后绑定；重载先解决或取消旧保存。早期能力一旦已发布，交接后不能因 schema proof 失效静默撤回。

保存前的 `GET /api/document/generator/settings` 同样属于早期只读能力：直接读取原 H2 的开关，产品名仍取 `ProductIdentity`，保留原控制器的缺省值和匿名读取规则；PUT 仍等完整后端。只拆内容上传还不够：这项可选元数据若排在完整初始化后，`stampGeneratorMetadata` 会把已导出的文档卡在上传之前。`LocalCoreHttpReadsTest` 与原控制器逐项对拍开关语义，`backend-request-gate.test.js` 验证只放行读请求。

保存 journal 位于原 H2 文件旁；即使关闭开关或构建标识变化，存在 journal 时也必须在 legacy DDL 之前恢复并验证记录过的 schema。`LocalCoreVersionHandoff` 保留既有 HEAD，未建库时以首个 before image 建初始版本，原件始终保留最新内容；版本确认后才 ack。feature-off/recovery-only 同样必须完成实际 EMF 和交接才可 full-ready。通知在项目锁释放后执行，失败的本进程回执重试可以重试通知，非持久通知 outbox。DDL 中途崩溃造成 proof 不匹配会保守拒绝启动，不能称已自动恢复所有升级窗口。

隔离的完整 Spring/JPA/H2/HTTP/JGit 联调已覆盖阻塞实际 EMF 时读写/取消、交权后相同路由、CORS、版本基线以及关闭开关/变更构建标识的骤停恢复；变更构建仅为同 JAR 改标识，并非另一二进制/DDL 兼容验证。当前仍默认关闭轻量候选，默认文档引擎仍为 LOWA；完整原生体验和正常负载对照未通过前不得据样板性能切换默认。

`desktop/main/services/backend-supervisor.js` 在服务启动完成后每 10s 检查后端，连续三次失败后按 5/15/45s 退避尝试恢复，最多三次；连续健康 5min 才重置预算。只恢复 `ServiceManager` 创建的 child，复用外部后端同样检查 `/api/desktop/health`，503/超时不能退回 wizard 假报健康；仅明确404且wizard识别成功时标记 `degraded/external-health-unverified`（旧版健康未知），不接管。原来按端口杀陈旧后端的路径已移除。后端初启 HTTP 就绪宽限 120s（Windows ARM 转译延长），运行期使用 `/api/desktop/health`（DB 检查+本次 child 的 build），不以 TCP 通等价健康。dev prod profile 兼容 `/api/admin/wizard`。健康检查固定本次 spawn 指纹，后台下载激活 overlay 不会触发运行中的旧版本被误判并自动换件。

start/stop/restart 共用按服务串行队列。后端端口分配后固定，恢复不能改渲染层已注入的地址。本次 spawn 随机注入 `AWD_BACKEND_CONTROL_TOKEN`，优雅停止请求为 loopback POST `/api/desktop/shutdown` + `X-AWD-Backend-Control-Token`；令牌只在进程内存/env，不写日志。停止先等待 Spring graceful 关闭，45s 后才强杀，且确认 child exit 后才能起新 JVM；尤其 Windows 不能直接把 Node `SIGTERM` 当优雅退出。应用退出总等待55s；睡眠暂停检测，唤醒30s宽限，退出移除监测。恢复不刷新窗口，保留编辑器内未保存内容。

preload `host.backend.getHealth()` / `onHealthChanged(callback)`；主进程 IPC `checkba:backend-health` / `checkba:backend-health-changed`。快照 `{state, ok, owned, attempts, reason, updatedAt}`；state 为 starting/healthy/degraded/restarting/failed/suspended/stopped。启动链异常也保留 failed/startup-failed 快照；只有已有本壳 child 所有权时才启动监督器允许恢复，端口分配失败不能永久显示 starting。回归 `desktop/tests/backend-supervisor.test.js`、`service-manager.test.js`、`quit-lifecycle.test.js` 用随机回环端口/合成 child；端口链测试同样注入随机端口，不占用户默认5269。mac/Windows正式包的数据库耗尽与真实文件写入恢复仍须隔离验收，不得在用户未保存文稿的客户端直接强杀演练。

## 随包业务插件构建（#1340/#1341，待发版）

frontend build:h5前置build:plugins，8个独立Uni/Vite包输出official-plugins/<id>/web，desktop extraResources只带对应manifest/web。后端通过AI_PLUGINS_BUNDLED_DIR读取只读来源，安装到可写plugins目录；OAuth回调由实际分配的后端端口注入AI_PLUGINS_OAUTH_REDIRECT_URI。纯服务端开发显式指定bundled-dir并先构建。QA启动后端必须复制jar到隔离runtime后运行，不可直接运行随后会被Maven改写的target jar；同一target目录不可并行package与test。

### 原生组件失败后的立即重试（dev-board#1260）

`NativePackService.installAsync` 的占用表按每次任务的 `PackStatus` 对象区分。`failed` 对用户可见后即可接受重试；旧任务的 catch 只改自身状态，finally 条件删除自身占用，不能覆盖或释放新任务。失败详情先写、failed 最后发布。不要退回按 packId 的 Set 去重，也不要通过延长轮询或 sleep 掩盖窗口。`NativePackServiceTest.immediateRetryAfterFailureKeepsNewAttemptInFlight` 用 latch 固定这个窗口，并验证运行中与排队中的去重、旧收尾隔离及最终真实安装文件。

### Windows 插件构建与 NSIS 首装门（dev-board#1354/#1355）

`vite.business-plugins.config.js` 必须统一 root、传入模块 ID 和生成的导入目标路径分隔符；Windows 路径不能直接与 POSIX 前缀比较。Desktop Build 的前端步骤明确用 Bash，`build:h5` 后校验非空 `dist/build/h5/index.html`，避免 PowerShell 将前一步失败掩盖为后续编辑器构建成功。随包插件的 Vue scope/chunk hash 受构建绝对路径影响，跨平台校验以源码、结构和运行行为为准。

`desktop/scripts/patch-nsis-known-folder.js` 在 postinstall 精确回移 electron-builder PR#9769，修复 24.13.3 首装路径查询后的固定长度越界读取；未知模板结构必须失败，不能跳过。来源见 `desktop/scripts/UPSTREAM.md`。打包后 Windows 跑 `test-nsis-known-folder.ps1`：旧读法在保护页负例中应以 0xC0000005 退出，实际修复块和真实 KnownFolder 查询应成功。随后仍执行真实安装→重装→卸载关联测试；失败保留安装器一天，并记录 SHA256 与 Windows Application 崩溃事件。首轮失败未取得 fault module/dump，不把相同退出码当成已证明同一根因。


### #1356 退出中重开与原生安装失败

`quitInProgress` 从准备开始阻止 open-path 投递及 Dock/second-instance 唤回旧窗口，重开意图交给安装/重启链。打开文件队列保存在本机 `.aiworkdeck/restart-open-paths.json`，下一进程等工作台 ready 再交付并在 ACK 后移除；取消退出恢复投递。Windows 安装锁期间的带文件启动也保存到该队列。renderer 先等已经接受的文件打开结束才暂停/保存；取消期间排队打开等待退出清理完成。

Mac `quitAndInstall` 在窗口与服务关闭后仍可能异步报错，必须保留安装阶段 error 监听：本机记录错误、relaunch 并退出旧进程，不能留下持有单实例锁的无窗口进程。Windows PowerShell 5.1 读取 Node 写入的无 BOM job 必须显式 UTF8，合成回归使用中文目录。相关行为回归含还原病灶转红；仍不等于正式签名安装及 Windows 实机升级已验收。

Windows 下从 pwsh→Node 再启动 powershell.exe 会继承不兼容 PSModulePath（#1356 Windows CI 已复现 Get-FileHash 不存在）。完整更新的签名检查与 helper 使用删除该变量的子进程环境，让 Windows PowerShell 重建系统模块路径；不改用户全局环境。握手超时必须先结束本 helper 并确认 exit，再按 helperPid/job 内容清理本次文件，不能放任迟到 helper 在后继客户端已启动时安装。退出中的原生业务菜单不再获得工作台窗口；服务尚未初始化的退出交给原生关闭。

**Windows helper 冷启动与独立进程交接（dev-board#1369）**：真实签名 NSIS 验收发现两层约束：① PowerShell 冷启动至握手可达 `11656.7881 ms`（run `39221453044`），超过旧 10 秒门限；② Node 直接 `spawn('powershell.exe', ..., { detached: true })` 在无控制台下约 214–323 ms 即退出码 0 结束、脚本首句未执行（run `39225970537` / `39227178526`），而 `detached: false` 直接子进程会在 Electron 退出时被 libuv 终止。现由非 detached 桥接 PowerShell 调用 `Start-Process powershell.exe -WindowStyle Hidden -PassThru`（标准输出/错误重定向到文件并写回独立 `helperPid`），helper 以 `FileMode::CreateNew` 独占写锁 `{ helperPid, jobId }`，父进程在 60 秒窗口内核对 `helperPid` 与 `jobId` 后写 `.ack` 提交，helper 确认 `.ack` 且父进程退出后才校验签名并执行 `NSIS /S --updated`。父进程未写 `.ack` 即退出的桥接异常若伴随 `.launch`，helper 在父进程退出后重开原应用而不执行安装。

## 模型校验与准备阶段取消（2026-10-21，dev-board#1386）

`.aiworkdeck-complete` 使用 schema1 文件清单；启动只检查结构/大小，完整旧时间戳安装可本地迁移，不强制重新下载。显式修复逐文件核对上游摘要，正确缓存保留；HF SDK 仅凭文件存在会复用坏缓存，普通 snapshot 副本即使 force_download 也可能不替换，确认损坏后须移除该 pointer 再下载并校验，不能盲目重写完成清单。ModelScope 失败回落 HF 也走这条链。
`ModelManager.download({beforeStart})` 在等待关联服务停止之前取得任务所有权，期间取消会阻止迟到下载启动。取消/超时等待子进程 close 后才解锁，避免重试写入竞态。HTTP health 仅证明服务身份和基础启动，界面不称业务能力已验证；真实 OCR/ASR/TTS 仍需独立业务测试。
回归：`desktop/tests/model-manager.test.js`、`model-fetch.test.py`（真实 SDK 需安装包 Python/lib；普通环境可显式 skip 该项，不把 skip 算通过）。

**真实 ASR 词表格式（2026-10-21，dev-board#1395）**：官方 `Systran/faster-whisper-medium` 实际下载包含 `vocabulary.txt`；不能强制要求 `vocabulary.json`。桌面清单和后端 `ModelPresence` 同步按 CTranslate2 的 JSON 优先、文本备用规则校验；存在但格式错误的 JSON 不静默回退。真实 Mac ARM64 中英 Kokoro→Whisper 推理、缺模型409后同进程恢复已由子代理与主任务分别运行；脚本 `asr-service/tests/real_inference.py` 只接受准备好的运行时/缓存和合成短句。隔离 HOME/临时目录，HF offline+死代理不等于操作系统断网；不据此声称 Windows 或完整 Electron 用户流程通过。
