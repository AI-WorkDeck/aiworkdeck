<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# AI WorkDeck 多端设计规范与迁移清单

日期：2026-10-11。状态：**主任务已审，分批实施中，尚非全产品已完成状态**。
范围：桌面工作台、Web 应用、官网账户区、Office/WPS 面板、插件、iOS/Android/小程序/Harmony。
依据：用户本次七项反馈；现有 `doc/sidebar-ui-standard.md`、色源与主题契约；下列一手设计资料。此规范扩展既有体系，不替换品牌、不更换 UI 框架，也不修改公开令牌名。

## 1. 调查结论与证据边界

产品已有设计系统基础，缺的是持续覆盖与约束。颜色集中管理，但尺寸、圆角、字阶及组件状态仍散落，新增页面可绕开规范。

| 现有入口 | 本次读取结果 | 实施约束 |
| --- | --- | --- |
| `design/tokens/awd-palette.json` | 东方清雅 2.0，主仓/官网发布工作树/移动工作树逐字节同 SHA256 `2eaa53a9d1a6437f587261b68ad2a372ad1aef9100c79551445089aaf5c2ba64` | 保留为唯一色源；三仓副本不得各自演化 |
| `scripts/generate-tokens.mjs`、`scripts/check-palette.mjs` | 生成 App、Office、LOWA 外框、SCSS；检查哈希、生成区漂移与声明配色对比度 | 本次 `node scripts/check-palette.mjs` 通过；它不证明每个组件已经用令牌，也不验证任意色对 |
| `frontend/src/App.vue` | 已有字体、色彩及 `--awd-panel-*` 密度令牌 | 尺寸增量在这里统一定义；不往每个面板再复制数值 |
| `frontend/src/utils/appTheme.js`、`PluginPane.vue` | iframe 通过 `init/theme` 消息接收白名单令牌，现名单主要是颜色/阴影 | 新增公共尺寸令牌必须接入名单；现有 `--awd-mint` 等名称保留 |
| `doc/sidebar-ui-standard.md` | 已约定平铺行、10px 内边距、6px 圆角、窄栏与就地状态 | 本次延伸至全产品；旧文档保留领域细节，指向本规范，避免出现两套冲突数值 |
| `TencentMeetingPanel.vue` | 使用 `--color-bg-card` 加白色回退及硬编码冷灰、绿，未用主体系 | 面板底色异常有源码证据；“服务器内部错误”需独立追踪请求，不能用视觉修复掩盖 |
| 项目列表/概览 SCSS | 列表仍有 320px 最小卡片、大间距/12px 圆角；概览已有 compact 平铺规则但宽屏独立布局不同 | 按真实容器宽度适配；禁止仅缩小全部字号来营造密度 |
| 移动 `contract/tokens.json` → Swift/Kotlin/ETS/WXSS | 已生成字体、间距、色彩、动效，`touchMin=44` 同步至 Android 包装层 | 原生端沿用生成链；Android 至少48dp的触摸目标需单独核验/覆盖，不改 iOS 单位假装等价 |
| 官网 `app/globals.css` | 发布工作树有同源品牌令牌；文档目录下旧 checkout 停在 `2227846`，没有新色源 | 官网核查以 `/Users/zewei/.codex/worktrees/website-subscription-1189` 为准，不能拿旧 checkout 判线上漂移 |

初次调查核对了上述源码与四张用户截图，之后按主任务审阅分批实施，详见第11节。未对全量页面做实时走查，未验证手机触摸/读屏及真实腾讯会议服务。本文件中以下数值是结合既有基线提出的产品规则，不冒称 Apple 或 Material 指定了 AI WorkDeck 的视觉样式。

## 2. 外部依据及采纳边界

- [DTCG Format 2025.10](https://www.designtokens.org/tr/2025.10/format/)：采用可带类型、说明、别名的令牌数据及平台生成思路。该文是社区组规范，**不是 W3C 正式标准**。既有 JSON 无须为这轮修复强行重写为 DTCG；新增源可以按该格式组织，并保留向既有 CSS 名称的映射。
- [Fluent 2 design tokens](https://fluent2.microsoft.design/design-tokens)：参考原始值与语义别名分离；共享语义便于多端演化，不复制 Fluent 的外观。[Fluent layout](https://fluent2.microsoft.design/layout)：参考间距步进与平台尺度，沿用本产品既有10/14px面板密度例外，不为了整齐重排全部布局。
- [Apple HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) 与可读取的 [Apple UI tips](https://developer.apple.com/design/tips/)：iOS/iPadOS 可点区域以44×44pt为本产品下限，支持系统文字缩放与平台原生交互。HIG页面本次工具正文受脚本加载限制，具体44pt依据为 UI tips，不声称完整审读全部 HIG。
- [Material 3 states](https://m3.material.io/foundations/interaction/states/overview) 提供交互状态体系入口；该动态页面正文未完整读取。[Android 官方可访问性说明](https://developer.android.com/develop/ui/compose/accessibility/api-defaults) 明确 Material 触摸目标至少48dp并提醒扩大命中区不能互相覆盖，作为 Android 实施依据。
- [WCAG 2.2 Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)：Web 可点目标24×24 CSS px或满足间隔例外。AI WorkDeck 桌面常用控件选28/32px，触屏48px，不把24px最低门槛当成推荐视觉规格。

## 3. 产品原则

1. **工作内容优先。** 长时间阅读与编辑的律师工作台采用平铺列表、紧凑字段和轻分隔；首页营销区可舒展，工作区不沿用营销大卡片。
2. **同一个位置承担同一种职责。** 外壳负责面板标题；面板负责操作、筛选、分组和列表。左栏不再重复画大标题和整张背景卡。
3. **颜色与控件有统一含义。** 保留墨竹青、暖中性表面与文档白纸；不同业务插件不自行换蓝底/荧光绿。状态用文字加图标，不能只靠颜色。
4. **紧凑不等于难点难读。** 桌面和触摸分别取密度；小字只放辅助信息，正文与输入不被压到10/11px；支持文字放大、换行和键盘。
5. **展示用户能采取的行动。** “资料在本机”“可从另一台设备取用”“暂无法取用，请先打开保存资料的设备”比“在线/离线”有意义。
6. **展示结果而非内部实现。** 代码、schema、内部工具参数默认不占对话正文；真实生成或修订文件有稳定入口。用户明确要代码时照常展示。

## 4. 令牌结构及具体数值

### 4.1 单一真源与兼容方式

采用“基础值 → 语义用途 → 必要的组件别名”三层。颜色继续用现有 palette；这轮尺寸先收敛至 App.vue，并补通主题桥接。若开始三端同时扩充尺寸，再引入 `design/tokens/awd-metrics.tokens.json` 生成尺寸段；**不要在新增 JSON 与 App.vue 同时手写两份值**。移动继续从 `contract/tokens.json` 生成平台代码，明确公共语义到平台单位的映射。

公开CSS保持 `--awd-*`，官网历史 `--king-*`、移动 `T/Tk` 通过适配层引用同一语义。禁止为了统一命名批量更名。组件别名只为有复用或独立变化需求的类型建立，不为每个 margin 创造一个名字。

### 4.2 颜色角色（复用现有值，不新增新调色板）

| 用途 | 令牌 | 浅色值 | 深色值 |
| --- | --- | --- | --- |
| 应用底层/工具栏 | `--awd-bg` | `#F1EFE7` | `#191713` |
| 内容/侧栏/输入表面 | `--awd-surface` | `#FCFBF7` | `#221F1A` |
| 悬停/次级填充 | `--awd-surface-2` | `#E9E6DC` | `#2B2721` |
| 正文 | `--awd-text` | `#2B2A26` | `#EDE9DF` |
| 次要文字 | `--awd-text-2` | `#6B675C` | `#B0AA9C` |
| 细分隔 | `--awd-border-subtle` | palette既有值 | palette既有值 |
| 控件边框 | `--awd-border` | `#DDD8CA` | palette既有值 |
| 主动作底色/文字链接 | `--awd-accent` / `--awd-accent-text` | `#2E5A50` | 两角色分别取palette，不能互换 |
| 选中行 | `--awd-accent-soft` | `#E3EDE9` | palette既有值 |
| 错误/提示 | `--awd-danger-text/soft`等 | 成对引用 | 成对引用 |

`text-3` 不用于需要阅读的状态说明、小字或placeholder，除非实测对比度通过。输入placeholder用 `text-2` 的合适配对，禁用态仍需用户能理解为什么不可操作。文档纸张、文件类型品牌色保留既有 frozen 契约。

### 4.3 桌面密度（本轮已批准的首批数值）

| 语义令牌 | 值 | 用途与约束 |
| --- | --- | --- |
| `--awd-space-1…8` | 4/8/12/16/20/24/28/32px | 共享间距基础尺度 |
| `--awd-panel-pad-x` | 10px（已有） | 左右内边距 |
| `--awd-panel-gap` / `gap-lg` | 8 / 14px（已有） | 同组/跨组；不再每组外套16/24px卡片 |
| `--awd-panel-sec-h` | 26px（已有） | 分组标题；含操作时可增长，不挤压命中区 |
| `--awd-panel-row-h` | 28px（已有） | 单行紧凑列表/次要控件，使用 min-height |
| `--awd-control-height` | 32px（新增） | 输入、搜索、主要按钮，确保行高与内边距不会被uni默认样式压扁 |
| `--awd-control-height-touch` | 48px（新增） | Web粗指针模式可点区域；不是桌面视觉统一放大 |
| `--awd-panel-radius` | 6px（已有） | 输入、按钮、小交互区；禁止整个面板用圆角 |
| `--awd-radius-sm` / `md` / `dialog` | 4 / 6 / 8px（新增） | 行悬停、控件/结果卡、对话框；气泡徽章/头像可圆形 |
| `--awd-panel-fs` / `fs-meta` | 12 / 11px（已有） | 窄栏正文/非关键辅助；可随缩放放大 |
| `--awd-font-size-body` | 13px（新增） | 普通工作区UI；长篇对话另用15px |
| `--awd-font-size-reading` | 15px（新增） | 长篇对话/阅读区，line-height1.6 |
| `--awd-font-size-title` | 16px（新增） | 页面内一级标题；侧栏标题仍服从外壳 |
| `--awd-line-height-ui` | 1.5（新增） | 标签/字段/控件文字，不用固定高度裁字 |
| `--awd-focus-width` / `offset` | 2 / 2px（新增） | focus-visible品牌描边；组件不能outline:none后无替代 |
| `--awd-motion-fast` / `base` | 140 / 220ms（新增） | 颜色/展开过渡；减少动效模式关闭非必要动画 |

基础尺度建议4/8/12/16/20/24/32；保留已有面板10/14px专用密度，不无意义替换成网格整数。暂不增加“紧凑/舒适”设置开关；当前需求是使现有界面一致。

### 4.4 平台差异

- **iOS/iPadOS：** 触摸至少44pt，采用系统文字样式/Dynamic Type；表单字号保持原生可读范围，正文建议基准17pt但先核对现有15pt契约使用场景，不全仓强改。
- **Android：** 触摸至少48dp，字体用sp；`T.touchMin=44`不能原样当48dp规范通过。先在平台适配层覆盖为48dp并验证实际布局，再考虑契约分平台字段。
- **小程序/Harmony：** 沿用既有生成链，触摸目标按48逻辑单位策略实现，rpx/vp需按平台真实尺寸换算；不把48rpx误当48px。允许系统安全区与导航部件保留原生外观。
- **Office/WPS和桌面插件：** 窄栏密度一致，继承宿主主题；iframe必须接收令牌，自身CSS不能依赖父页面选择器穿透。插件SDK缺少尺寸值时只在模板适配层设与规范相同的兼容回退。
- **官网：** 品牌色/字栈/语义状态一致；营销首页可以大标题、较多留白，账户/计费/项目页遵循应用控件规范，不要求宣传页密度等于桌面。

## 5. 组件和交互规则

| 组件 | 正常形态 | 必须覆盖的状态 |
| --- | --- | --- |
| 项目行 | 名称主行，可选来源次行；每行一个主点击区，信息超过一行自然增长；不把按钮套在大卡中 | 当前项目/加载/取用失败/不可用；点击有明确反馈且可恢复 |
| 项目概览 | 标题+平铺字段+少量统计+最近活动；默认不铺大型统计卡；宽区可分栏但不增加装饰层 | 空项目、长案名、缺字段、滚动、窄容器 |
| 侧栏表单 | 全宽32px搜索框、标签、简短操作；窄栏按钮换行而非挤成细条 | focus/hover/disabled/loading/error；搜索不能靠placeholder代替可访问名称 |
| 按钮 | 一个区域一个主动作，次动作使用中性或文字型 | pending只禁用相应操作，结束恢复；禁用原因就近可见 |
| 错误 | 就地简短原因+可操作重试/连接入口；toast仅补充瞬时确认 | 连接未授权、登录失效、网络失败、服务失败分别表达；不直接向律师抛堆栈或“500” |
| 用户提问 | 对话内独立选择卡：问题、单/多选选项、补充输入、提交；多问题分步并显示进度 | 等待、已提交摘要、失败重试；用稳定问题ID恢复，重复事件不重复提交 |
| 工具过程 | 默认一行“正在查阅制图规范”等用户动作摘要，状态明确 | 详细日志折叠且显式展开；schema/JSON/协议字段不自动撑开正文 |
| 文件成果 | 每轮最后附“已修改N份/新建N份”及文件行，图标+名称+真实动作状态+打开；同文件去重 | 流式后完成、失败/部分成功、历史回放、移动/删除后不可打开；不把读取过的文件当成果 |
| 对话框 | 紧凑标题/正文/明确动作，8px圆角，桌面合理最大宽；移动可原生sheet | 键盘焦点圈闭/还原、Esc可取消、异步状态、防重复提交 |

文件成果区与已有“修改/新增”汇总复用同一事实源；文件是否成功落盘来自真实工具/编辑事件，不靠从AI文字猜路径。打不开时就地说明并提供资源管理器定位（可用时）。技术详情是可选诊断信息，AGPL许可入口、隐私告知、费用、授权和不可逆操作提示不得为了简洁隐藏。

### 项目资料位置文案

- 本机已有资料：**“本机资料”**；用户点击应进入项目并打开概览或资源管理器，不等待云端获取已存在的本机文件。
- 资料在其他当前可响应设备：**“可从其他设备取用”**，细节展示用户可识别设备名。
- 资料设备暂不可响应：**“资料设备暂未连接”**；解释“请在保存资料的设备上打开 AI WorkDeck 后重试”。不能因此把本机副本灰掉。
- 云端已保存可用文件：**“云端资料”**；只有元数据时不能误称文件已上传。
- 目录请求本身失败：**“项目清单暂未更新”**并保留缓存；不把无法判断写成“离线”。

## 6. 布局与无障碍验收规格

1. 侧栏按**容器宽度**测160、220、260、420px；160px是现有可拖下限，必要时竖排动作，220/260是主要验收。控件 `box-sizing:border-box; width:100%; min-width:0`，滚动列表用 `min-height:0`，禁止通过 `overflow:hidden` 裁掉不可见按钮伪装不溢出。
2. 工作台测1280×800、1440×900及窄窗；按原有拖拽限制保证编辑区200px。保留拖拽时iframe/webview命中与transition守卫，不把动态测量写死成token。
3. 中英双语、长项目名/文件名、150%和200%文字/页面缩放均有可用布局；允许辅助信息换行，关键操作不只在hover出现。
4. 亮/暗/跟随系统三模式，首帧无错误回退底色；iframe主题切换不中断数据和输入。低动效、键盘Tab/Enter/Space、focus-visible、屏幕阅读名称纳入组件验收。
5. 默认正文/次要说明与底色对比至少4.5:1；图标/边界承载必要信息时至少3:1；不要把palette守卫通过当作所有页面自动达标。
6. 每个实际入口核验“看得到 → 点得进 → 首屏加载 → 核心动作 → 错误可恢复”，不能只独立渲染组件。

## 7. 页面清单与迁移次序

以下为**页面族/入口清单**，不是已经逐页完成的声明。实施者为每族补具体文件、测试证据和未验证项。

| 批次 | 页面/组件族 | 入口与实施目标 | 完成门槛 |
| --- | --- | --- | --- |
| P0 本次反馈 | 开始页左栏项目、ProjectListPane、ProjectHomePane、顶栏项目切换 | 本机项目真实进入；平铺密度；来源措辞；不改变稳定projectUid/fileUid | 无项目→点项目→概览/文件，加载失败可恢复，160–420px/双主题 |
| P0 本次反馈 | TencentMeetingPanel、TranscriptPane | 请求根因修复另行验证；统一底色/输入/状态/同步操作 | 未授权无500噪声、连接/查询真实路径、窄栏搜索可输入 |
| P0 本次反馈 | ChatInterface、AgentMessage、提问卡、文件汇总 | 结构化提问、内部日志默认隐藏、每轮成果入口 | 真实事件/历史重放/窄面板/部分失败；原有权限与费用提示仍可见 |
| P1 共享基础 | App.vue、appTheme、PluginPane、AwdDialog、公共按钮/输入 | 尺寸语义源/主题桥接/统一状态；只先迁移受影响组件 | 令牌全、解析非空、浅深一致、键盘与缩放通过 |
| P1 全部侧栏 | FileTree、Search、Market、语音/录音、LitigationVisual、Desensitize、剪贴板/暂存、版本、插件开发 | 按侧栏标准逐一审计；已符合的不重写 | 单标题/同密度/无硬编码新底色/入口回归 |
| P2 工作区与设置 | 欢迎、日程、项目日程、设置/账户/授权计费/插件详情、协作、版本比较、媒体预览 | 页标题/字段/列表/反馈/弹层一致；长内容阅读不压缩 | 双主题、空/错/加载、主要流程可用 |
| P2 桌面独立层 | 标题栏/菜单/About、LOWA外框、系统文件选择 | 保留原生平台行为与白纸；同步真正的主题映射 | macOS/Windows分别验；编辑器文档样式不被外壳覆盖 |
| P2 插件与Office | 动态PluginPane内插件、官方插件模板、Office/WPS taskpane | SDK接主题/密度令牌；内建与独立分发分别验收 | 宿主代码合并不等于独立插件已更新；记录发布版本 |
| P3 多端原生 | iOS、Android、小程序、Harmony：首页/项目/资料/录音/账户 | 共享语义+平台触摸/导航/字阶适配 | 原生生成器/测试、真机大字/触摸，权限和上传流程 |
| P3 官网 | 官网账户/计费/登录、营销/下载/更新 | 应用与营销密度分开，品牌/控制状态一致 | 中英响应式、现有支付/登录/下载入口无回归 |

建议将“P0修复+共享尺寸基线”作为首个可验收变更；后续逐页面族登记迁移，不以一次全仓正则替换制造巨型PR。主任务审定后分工，样式代理只改获分配文件；业务修复与样式改动分别检查，最终一起验收用户完整路径。

## 8. 自动守卫与测试提案

现有palette守卫继续作为必过项。本轮增加的最小防线建议：

- **令牌完整性：** 公共尺寸/颜色的定义与iframe导出名单对拍，解析到具体值；模板与Office适配层若有兼容回退，值和来源被明确检查。不能只用正则证明名字“出现过”。
- **禁止新增散值：** 针对已迁移组件的新增CSS声明解析后检查硬编码颜色、圆角、字号、控件高度；逐文件精确允许列表，记录理由。存量审计只报告，新改行阻断；禁止加一个全局豁免后称全站受守卫。
- **渲染验收：** 真实组件加载后采集尺寸、溢出、焦点、计算颜色及截图；覆盖实际容器宽度/双主题/长名称，业务修复测试还要覆盖错误复原和状态持久化。仅源码字面量测试不能替代用户路径。
- **多端生成一致：** 继续现有palette哈希/生成漂移；新增尺寸跨仓映射带版本，检查平台输出单位与最低触摸尺寸，特别防止Android从44pt复制成44dp。
- **可访问性：** 自动检查可访问名称、目标大小、重要对比色；键盘焦点、原生读屏及真实大字模式仍需操作验证，未跑则明确未验。

不要求为了这轮修复引入新组件库、Storybook、复杂运行时theme service或整套DTCG工具链；优先扩展仓库已有生成器与node测试。

## 9. 不应令牌化或不能机械替换的值

- 内容数据与几何：文件实际宽高、文档页边距、图表坐标、编辑器缩放、拖拽实测容器宽，不是视觉主题token。
- 结构性CSS：0、100%、auto、fr、inherit、透明背景、布局用1px边界可按语义保留；不能为了“零硬编码”把每个值抽成全局变量。
- 平台原生尺寸/安全区、Apple交通灯与Windows覆盖标题栏仍跟随原生API，不能用Web同一像素强行覆盖。
- 用户文档与导出产物的字体/颜色、第三方许可保留内容、品牌图标/文件格式颜色沿用既有冻结规则；外壳theme不改用户文件。
- 独立可视化/审阅着色可保留领域专用tokens（如PLAN_REVIEW_TOKENS），但要有主题配对/验证，不混入普通面板背景。
- 显示实现细节与隐藏授权不是一回事：诊断原文默认折叠，费用/隐私/权限/失败结果保持可见。

## 10. 全局 Day One 记忆建议（由主任务批准后写入权威入口）

> 用户明确偏好：新项目从第一天建立集中设计令牌，颜色、字体、间距、圆角、控件尺寸与状态使用语义引用，避免页面散写数值。以既有品牌/框架为基础，支持主题、窄屏与触摸平台差异；共享组件先行，新增页面必须接入统一规范和守卫。语义一致不意味着各平台像素一致，也不要求给每个结构性数值造token。存量项目渐进迁移，先检查已有体系与公共契约，避免重建第二套真源。

来源为用户2026-10-11本次明确指示；写入共享规则/方法及Obsidian收件箱需主任务按既有协议操作。本子任务未修改全局记忆，未提交或发布任何代码。

## 11. 本轮全侧栏源码审计（2026-10-11）

审计依据是工作台实际分支及补充插件面板，逐个读取其 style 与外置SCSS。下表“散色声明数”为源码候选：含十六进制/rgb值的颜色、背景、边框或阴影声明；包括fallback及可能合法的领域色，**不是缺陷判定数，也不代表全量运行视觉验收**。零散色不等于尺寸/密度完全一致。业务源同时由其他代理修订，下列结果为审计时快照。

| 文件 | 散色候选 | awd引用数 | 例子/迁移建议 |
| --- | ---: | ---: | --- |
| `frontend/src/components/FileTree.vue` | 12 | 168 | background-color: rgba(148, 163, 184, 0.3);；box-shadow: 0 2rpx 8rpx rgba(59, 130, 246, 0.08); |
| `frontend/src/components/project-list/ProjectListPane.vue` | 7 | 215 | box-shadow: 0 1px 3px rgba(0,0,0,0.1);；color: #EDE9DF; |
| `frontend/src/components/DdFilesPanel.vue` | 3 | 37 | background-color: rgba(0,0,0,0.05);；box-shadow: 0 2px 8px rgba(46, 90, 80, 0.1); |
| `frontend/src/components/ShareholderMeetingPanel.vue` | 0 | 49 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写（已下线兼容面，不扩大为重新启用） |
| `frontend/src/components/LitigationVisualPanel.vue` | 0 | 84 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写 |
| `frontend/src/components/project-home/ProjectHomePane.vue` | 0 | 35 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写 |
| `frontend/src/components/MeetingRecordingPanel.vue` | 4 | 140 | border: 2px solid rgba(255, 255, 255, 0.45);；background: #B0B4BA; |
| `frontend/src/components/EasyVoicePane.vue` | 3 | 78 | box-shadow: 0 4px 20px rgba(0,0,0,0.1);；box-shadow: 0 2px 4px rgba(46, 90, 80, 0.1); |
| `frontend/src/components/DesensitizePane.vue` | 0 | 59 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写 |
| `frontend/src/components/SearchPanel.vue` | 2 | 63 | box-shadow: 0 1px 2px rgba(0,0,0,0.02);；background-color: rgba($brand-mint, 0.3); |
| `frontend/src/components/version/VersionPanel.vue` | 0 | 14 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写 |
| `frontend/src/components/MarketSidebarPanel.vue` | 1 | 50 | box-shadow: 0 0 0 2px rgba(137, 168, 160, 0.15); |
| `frontend/src/components/project-calendar/ProjectCalendarPane.vue` | 0 | 51 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写 |
| `frontend/src/components/PluginDevPanel.vue` | 1 | 58 | box-shadow: 0 0 0 2px rgba(137, 168, 160, 0.15); |
| `frontend/src/components/tmeet/TencentMeetingPanel.vue` | 0 | 118 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写 |
| `frontend/src/components/VariablePanel.vue` | 5 | 60 | box-shadow: 0 1px 3px rgba(0,0,0,0.04);；box-shadow: 0 8px 24px rgba(137, 168, 160, 0.15); /* Mint shadow */ |
| `frontend/src/components/ProjectFavoritesPanel.vue` | 6 | 38 | box-shadow: 0 1px 3px rgba(0,0,0,0.04);；box-shadow: 0 8px 24px rgba(137, 168, 160, 0.15); |
| `frontend/src/components/ClipboardPanel.vue` | 4 | 32 | box-shadow: 0 1px 2px rgba(33, 38, 41, 0.04), 0 10px 24px rgba(46, 90, 80, 0.08);；box-shadow: 0 1px 3px rgba(0,0,0,0.04); |
| `frontend/src/components/InsightPane.vue` | 0 | 127 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写 |
| `frontend/src/components/PluginPane.vue` | 0 | 5 | 已引用主题色；继续核验尺寸/状态/窄栏，不做无收益重写（iframe内部需独立审计） |
| `frontend/src/components/PluginWorkspaceSummary.vue` | 1 | 5 | .plugin-summary-open { width: 100%; margin: 0; font-size: 13px; color: var(--awd-text-on-accent, #fff); background: var(--awd |

实际分派建议：腾讯会议由主任务修；项目列表/概览由项目代理修；聊天相关由AI代理修。下一波先处理 `PluginDevPanel` 与任何散色较多且仍在实际入口的面板，再对全侧栏仅剩尺寸的组件做逐文件迁移，保持数据/权限/文件操作不变。`ShareholderMeetingPanel`下线存量兼容代码只登记，不借本次样式任务启用。`InsightPane`/日程/版本有领域视图，不能机械删业务高亮。动态插件iframe内部另仓，不因宿主令牌输出完整就标已迁移。

已实施总览：App.vue共享尺寸、appTheme公共token导出、3个公共控件，以及下述四批面板迁移。当前增量守卫覆盖14个表面与主题导出契约；范围以 `scripts/check-design-system.mjs` 的 `MIGRATED_FILES` 为准，不声称覆盖所有上表文件。

本地验证：设计守卫通过；设计守卫反例/键盘方法/主题收集及SDK主题通道13项通过；既有对话框/下拉滚动回归26项通过；palette守卫通过。全应用实际UI、触屏/读屏与完整服务流程待主任务集成验收。

### 第二批已落实与尚未覆盖

2026-10-11按主任务审阅后的分工，只修改以下6个面板的style段：`ProjectFavoritesPanel.vue`、`VariablePanel.vue`、`ClipboardPanel.vue`、`EasyVoicePane.vue`、`DdFilesPanel.vue`、`SearchPanel.vue`。散写色彩/阴影、字号、普通圆角已接入语义令牌；工作面底色、输入/主要按钮与可读辅助色按规范对齐。模板、脚本和locale未改。搜索原有编译期 `$brand-mint` 属统一源，但替换为运行期 `accent-soft` 是为深色主题跟随，不是为计数归零。

保留的具体例外：收藏/剪贴板/变量底部抽屉原有横向媒体/内容预览卡宽高（260×180、130px内容区、140px变量预览等）属于内容几何，不机械改成28px文本行；空态图像32/64px与文件图标尺寸、分组胶囊99/999px、领域高亮保留。此轮这些面板的守卫检查颜色、字体与圆角，**没有宣称对所有高度/间距阻断**；严格height检查仅用于三个公共控件。移除新控件限制、漏传iframe token、新增散色/字号/普通圆角都有反例测试。

守卫已接入 `.github/workflows/ci.yml`，紧邻palette检查。为保持该轻量job零依赖，CSS/SCSS声明使用限定范围的声明扫描器，不依赖安装前端包；不宣称完整通用CSS AST分析。9个已迁移表面守卫通过，6组件的实际SCSS/CSS编译通过，相关收藏/剪贴板/语音/尽调/搜索52项回归通过（日志 `/tmp/awd1198-secondary-tests.log` 为本机证据，不入库）。主任务仍须在实际工作台看图与交互验收。

剩余明确清单（已按第四批更新）：FileTree/MeetingRecording已完成第三批；MarketSidebarPanel/PluginDevPanel/PluginWorkspaceSummary已完成第四批。下线ShareholderMeetingPanel不重启；VersionPanel/ProjectCalendarPane/InsightPane/LitigationVisualPanel/DesensitizePane已有核心token且未命中散色，本轮不机械改布局/几何，实际视觉/键盘/触摸仍需验收。独立动态插件iframe、Office/WPS、原生四端与官网本轮提供规范及迁移清单，不改这些独立客户端：原生按pt/dp/sp/rpx/vp适配、官网营销与应用区密度有别、Office/插件另有宿主与发行链，不能套桌面像素或把目录盘点当完成。

### 第三批已落实（资源管理器与会议录音）

已与AI代理核对无文件重叠后，仅修改 `FileTree.vue` / `MeetingRecordingPanel.vue` 的style段。散写背景/阴影/危险色及常规字号/圆角已接入语义令牌，模板与脚本与HEAD逐字一致；两组件SCSS编译通过；文件树与设计守卫回归132项通过（增加例外反例测试前的计数）。守卫覆盖增至11表面。

本批精确保留：FileTree `.folder-icon` / `.new-folder-btn .btn-plus` 的18px字形图标；MeetingRecording `.mr-live-time` 的20px计时显示；`.sp-3` 的 `#F5EBFF`/`#7A3FBF` 说话人配对色必须与 `utils/media/speakerColors.js` 第4色一致，本次不越权改变共享业务色映射，未来单独加入全端palette。以上豁免绑定文件+选择器+属性+精确值，另有反例防止复制到其他选择器绕过检查。旧rpx字阶/小圆角保留响应式单位（守卫尚不阻断rpx），文件树行高/缩进/拖拽和录音波形/播放器几何均不动。全侧栏已做源码审计，但只有上述批次实施并编译/单测；其余第11节未覆盖项继续有效，实际UI验收由主任务执行。

### 主任务审阅修正

主任务第二视角指出暗色开关thumb对比度不足、CI仅运行守卫、颜色扫描把字体名Arial Black误判等问题。已修正：开关off thumb用text-2、on thumb用text-on-accent，边界明确；实际CSS角色与palette组合计算的浅/深×开/关thumb及边界均≥3:1。公共Select/Switch支持ariaLabel字段名，会议录音两处调用使用既有翻译标签（**因此录音模板在第三批style-only完成后，又按主任务授权增加了两处可访问名称属性**，没有改变业务事件）。颜色检查仅作用于颜色相关属性，增加未知--awd引用检查，命名字体与局部变量反例通过。CI同时执行守卫及设计/SDK测试，目前16项通过。该对比度验证是计算验证，不替代实际屏幕阅读器测试。

### 第四批已落实（插件相关面板）

`MarketSidebarPanel.vue` / `PluginDevPanel.vue` / `PluginWorkspaceSummary.vue` 仅style段：散写字号/普通圆角接入已有token，focus ring使用focus-width与accent-text，辅助说明使用text-2，插件概览侧栏内边距和间距服从panel规范。保留已有主题token、布局/媒体几何，不重做结构。PluginWorkspaceSummary主按钮原有 `var(--awd-text-on-accent, #fff)` 回退保留，防止宿主颜色值尚未到达时失去可读文字；守卫仅豁免该文件/选择器/属性/精确回退，其余新增散色仍阻断。当前守卫覆盖14个表面；独立原生/官网客户端本轮仅规范，不宣称已经同步迁移。

第四批验证：3个组件实际SCSS/CSS编译通过，模板/脚本对HEAD逐字未改；14表面设计守卫通过；设计/SDK回归17项通过（含限定fallback的正/反例）。
