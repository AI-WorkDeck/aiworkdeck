<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 产品截图由 E2E 在虚构演示数据上自动截取、CI 校验

对齐对象：Stella `apps/landing/public/media/products/README.md`、`.github/workflows/marketing-screenshots-*.yml`、
`.github/actions/marketing-capture`。对比报告第 1 项「截图即测试」。

## 1. 目标

README、官网与教程用的产品截图从「人工截、人工记得更新」改成「测试产物」：

- 截图由脚本在虚构演示项目上截取，可以重复生成；
- PR 改动界面后截图对不上基线，CI 直接报红，并上传 diff 图；
- 需要更新时由 CI 重新截取，人审后入库。不提交开发机截的图。

## 2. 现状盘点（2026-11-05，master 3e727b54e）

| 位置 | 内容 | 来源 |
|---|---|---|
| `docs/images/marketing/01-workspace.png` 等 3 张 | README 前 3 张：工作台+编辑器、修订工具栏、依据跳转 | 人工截取，1920×1080，r1 批次 |
| `.github/assets/marketplace-live.png` | README 第 4 张：插件广场 | 人工截取，2880×1800，含线上实时下载数 |
| `.github/assets/workspace-ai.png`、`workdeck-redline.png` | 社区推广文档引用 | 人工截取 |

现有测试基建：

| 套件 | 驱动 | 是否进 CI | 能否截编辑器 |
|---|---|---|---|
| `frontend/tests/app-e2e` | puppeteer-core + 无头 Chrome，H5 + local-mode 后端 | 否（发版前本机跑） | 否：工作台里的 LOWA 编辑器挂在 Electron `<webview>` 中，浏览器目标只能走 docx 降级预览 |
| `frontend/tests/lowa-e2e` | 无头 Chrome 直接起 LOWA 引擎 | 否 | 只有引擎画布，没有工作台外壳 |
| `frontend/tests/desktop-e2e` | 源码 Electron + CDP（`_lib/electron-cdp.mjs`） | 否 | 能，需要 H5、zetaoffice、LOWA 资源与后端 JAR |
| `electron-cloud-regression.yml` | 已签名安装包，托管 mac/win | 手动 | 能，但只认指定的安装包构建 |

演示数据：`fixtures/evidence-demo-1076/`（4 份纯虚构 docx，就是 README 截图里的「示范-设备购销纠纷-虚构」项目）。

## 3. 设计

### 3.1 确定性的演示数据

- **全新 user.home**：每次起一个空 H2 + 隔离 `user.home` 的 local-mode 后端（`SPRING_PROFILES_ACTIVE=desktop`），不读任何人的真实数据。
- **种子**：脚本经 REST 建项目「示范-设备购销纠纷-虚构」，写入 `fixtures/evidence-demo-1076/*.docx`；等版本记录把这批改动自动记完一笔（`/version/status` 的 `changedCount==0`）再截，否则底栏状态随时序变化。本机实测约 2 分钟。
- **在线广场夹具**：后端的 `AI_SKILLS_REGISTRYURL` / `AI_PLUGINS_REGISTRYURL` 指向脚本自己的静态服务，返回 `fixtures/marketing-demo/registry-*.json`（官网注册表快照，作者统一为团队名、下载数与日期固定）。
- **浏览器不出站**：请求拦截只放行本机 H5 与后端。
- **时间归一化**：「N 分钟前」改写为「刚刚」，日期/时刻改写为 `2026-03-18 09:30`。只改时间文本，不动其他内容。
- **冻结动效**：注入 CSS 关掉 animation/transition/光标闪烁/滚动条；截图前把鼠标移出内容区，等 `document.fonts.ready`。
- **桌面桩**：与 app-e2e 一致注入 `window.checkbaDesktop`（含 `fs.showOpenDialog`），欢迎页等按桌面版渲染；固定 `zh-CN`。
- 每张图使用独立浏览器上下文，避免工作台记住的标签和侧栏状态串到下一张图。

### 3.2 在哪个 runner 截

`.github/workflows/marketing-screenshots.yml`，`ubuntu-24.04`（固定镜像版本）：

1. `npm ci` → 用 `@puppeteer/browsers` 安装 **puppeteer-core 锁定版本对应的 Chrome**（只有 `package-lock.json` 变化时才换 Chrome 版本）；
2. `apt install fonts-noto-cjk`；
3. `build:h5`，然后打包后端 JAR（`-DskipTests`）。必须先构建再起后端：`build:plugins` 会重写 `official-plugins/*/web/`，后端启动时会校验这个目录，两者并发会让后端启动失败；
4. 起全新 local-mode 后端，跑 `frontend/tests/marketing-screenshots/run.mjs`；
5. 无论成败都把截图（及 diff）作为 `marketing-screenshots` artifact 上传。

触发：PR 和 master 推送（只在前端源码、后端源码、随包 skill 与插件、夹具或脚本改动时触发），以及手动 `workflow_dispatch`。

### 3.3 像素比对与容差

- 视口 1440×900，`deviceScaleFactor: 2`，输出 2880×1800，与现有 `marketplace-live.png` 同规格。
- 比对在 Chrome 页面里用 canvas 解码两张 PNG 完成，**不引入新依赖**（无 pixelmatch/pngjs，不扩大 npm audit 面）。
- 单像素任一通道差 > 40 记为不同；不同像素占比 > 0.2% 判红。尺寸不一致直接判红。基线和比对图在同一镜像、同一 Chrome 下渲染，容差只需要覆盖抗锯齿噪声。
- 本机复测：同一份代码在两个全新后端上连续截取，3 张图的差异像素都是 0。把 A 图当成 B 的基线时报 3.656% 并判红（故意改错基线，确认会报红）。

### 3.4 更新基线

基线目录：`docs/images/marketing/e2e/`（`docs/` 在 .gitignore 里，入库要 `git add -f`）。

```sh
gh workflow run marketing-screenshots.yml --ref <分支> -f mode=update
gh run download <run-id> -n marketing-screenshots -D /tmp/shots
# 人审 /tmp/shots/*.png 后（不要拷 *.diff.png）
cp /tmp/shots/{workspace-welcome,project-overview,plugin-market}.png docs/images/marketing/e2e/
git add -f docs/images/marketing/e2e && git commit
```

本机调试用 `SHOTS_MODE=update npm run test:marketing-shots`（前置条件见脚本头注释），**不要提交本机截出来的图**：macOS 字体与 Linux 不同，提交后 CI 必红。

第一期不照搬 Stella 的「update → capture → publish（App token 签名提交回分支）」三段式，因为它需要新建 GitHub App 与 secret。当前做法是人工下载 artifact 再提交。

### 3.5 第一批纳入的截图

只纳入浏览器目标与桌面端渲染一致的界面：

| id | 画面 | 关键断言 |
|---|---|---|
| `workspace-welcome` | 工作台：资源管理器（4 份虚构文件）+ 欢迎标签 + AI 面板 | 文件名、「上手指南」「当前项目」已渲染 |
| `project-overview` | 左栏「项目概览」：档案、统计、动态 | 「4 个文件」「初始版本」已渲染 |
| `plugin-market` | 插件中心 + Skill 详情（创业协议起草） | 「什么时候用」、Skill 标识已渲染 |

`plugin-market` 与 README 第 4 张（`marketplace-live.png`）是同一画面。本 PR 把中英 README 的这张图改为引用生成的基线。

**README 前 3 张（编辑器、修订、依据跳转）本期不覆盖**：编辑器是 Electron `<webview>` 里跑的 LOWA，纯浏览器只能渲染 docx 降级预览。用它作产品截图不真实，所以不截。

## 4. 第二期：编辑器截图（README 01–03）

可行路径：用 `frontend/tests/_lib/electron-cdp.mjs`（desktop-e2e 共用的 Electron 驱动）在 `ubuntu-24.04 + xvfb` 上起源码 Electron，加载同一份 H5，按 desktop-build 的顺序准备 `build:zetaoffice` 与 `fetch-lowa-assets`（自建引擎 `LOWA_BASE_URL`）。之后复用本期的种子、归一化与比对逻辑。需要先确认三件事：

1. LOWA 引擎在 Linux 软件渲染（SwiftShader）下首屏和字体是否稳定，可以先用 lowa-e2e 在 ubuntu 跑一次；
2. 引擎资源下载量和缓存（可以复用 `cache-warm.yml` 的思路）；
3. Electron 的 `<webview>` 在 xvfb 下 `capturePage` 是否有首帧问题（参见 eng-infra 文档的 BrowserView 首帧记录），需要以像素断言为准。

## 5. 需要决策

1. README 第 4 张图是否改用生成图（本 PR 已改，可以退回）。生成图的 Marketplace 列表来自快照夹具，不是线上实时数据。
2. 是否把本工作流设为 required check。建议先观察一到两周的误报率。
3. 是否要英文界面截图（英文 README 目前也用中文界面截图）。
4. 是否建 GitHub App，实现 Stella 式「CI 重截后自动提交回 PR 分支」。
5. 第二期是否投入 Electron + LOWA 的 Linux 截图管线。
