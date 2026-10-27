---
name: plugin-system
description: 插件系统领域（具体插件实现）。任务涉及尽调/脱敏/股东大会等业务插件、skill 定义与注入、PluginService/SkillRegistry/SkillRouter、动态 JAR 插件时，先读本文档再动代码。
---

# 插件系统 领域地图

职责边界：各具体业务插件与插件/skill 运行机制。不含插件市场页与 registry 同步（plugin-marketplace 领域），不含左栏 UI 本身（sidebar-shell 领域）。

## 四类插件形态

1. **内置面板型**：前端组件直接内嵌 project-overview.vue 面板区，无启停开关，靠 `leftSidebarPlugins.js` 静态配置 + 角色过滤（`getPluginsForUser`，CLIENT 角色只见 dd-files）。
2. **Skill 型**：后端 prompt 包（skill.yml + prompt.md），对话关键词触发。
3. **动态 JAR 插件**：plugins/ 目录下 manifest.json + JAR，前端用 PluginPane iframe 承载。
4. **原生资源包（native pack，2026-08 立项）**：重资源（脚本运行时/平台二进制/静态资产）的运行时下载分发，规范 `docs/NATIVE_PACK_DISTRIBUTION.md`。后端 `service/pack/NativePackService` + `/api/packs`；skill.yml 用 `requires_pack: <packId>` 声明依赖；落盘 `~/.aiworkdeck/packs/<id>/<version>/` + `current.json` 原子指针。首个对象是诉讼可视化（litviz+graphviz+drawio）。

**「面板型插件在广场里启停」的体验对齐（2026-08-19，PR#433）与真下载分发的关系**：诉讼可视化、会议录音、脱敏这几个左栏面板靠 `enabled_by_default:false` + `requiresSkill` 门控在广场呈现「安装/卸载」。资源随包在场时，「安装」仍只是 `POST /api/skills/{id}/enable` 翻启用位（不联网）；skill 声明了 `requires_pack` 且资源不在场（新版本已从安装包摘除、或老用户升级后资源随 .app 替换消失）时，「安装」会先走 `/api/packs/{id}/install` 下载资源包（字节级进度）再启用，后端启动时对「已启用但资源缺失」的 skill 自动补下载。随包资源优先于 pack（老用户不强迫重下）。

## 现有插件清单

**项目沟通助手（dev-board#1423/#1424）**：`official-plugins/project-im/` 0.2.0 使用宿主 `im.request` 的 `agentScopes/ensureAgent/agentInfo/agentReply`，最低宿主0.69.0；源码交付不代表已发布。产品层级仅律所→团队→项目；`imDirectory.organization` 是旧桥字段，实际来自 `team`，用户文案必须叫团队。插件和 `PluginWorkspaceSummary` 以会话优先、通讯录折叠，`projectColleagues` 展示当前项目成员。

- 云端 `ImAgentService`：每层级共享群唯一绑定，另按用户绑定 `AGENT_DIRECT` 私聊。项目UUID仅用于群归属，不授予项目或群访问权；项目群非成员须邀请码，团队/律所群按 `MemoryOrganizationGateway` 每次复核。AI 为 `actorType=AGENT` 的系统参与者，不注册User；旧消息无actorType按真人处理。`ImAgentTurn` 持久保存请求状态，以原消息ID幂等，模型在事务外执行，发回前复核成员和附件可见性。
- 宿主 `ImScopedAgentHost` 验当前项目与账号，仅为匹配项目的私聊调用 `ImPrivateProjectContext`，丢弃插件传来的 `projectContext`。项目身份由 `ImProjectFiles` 复用 Git 内 `项目沟通/项目标识.json`，不能直接用克隆后会重新分配的数据库 `Project.uid`。身份初始化需要插件 `file_write` 及内部成员写权限；回复仅只读，无标识不阻断团队/律所助手。群不加载本机案卷；团队/律所不借当前项目ID读取案卷。私聊上下文只读当前项目档案、项目记忆索引和有界可读文件，发送前复查角色与文件权限，不使用含个人记忆的 `contextIndexes()`。共享附件仅允许 `clientVisible=true`，即使当前都是律师，也不能把内部材料答案留给后来入群的客户。
- 云端助手固定调用 `ChatModelFactory.getPlatformChatModel` 和 `TokenUsageService.recordPlatformUsage`，使用提问者平台额度，不能服从服务端全局BYOK默认或借用machine key。UI明确云端处理，与桌面模型选择独立。项目撤权只阻止后续本机资料提取；已提交云端的本轮上下文快照与会话历史不能靠本机ACL追溯收回，勿宣称即时全面撤权。
- 工作台只保留一份会话列表：`PluginWorkspaceSummary` 通过现有 `sidebar.command` 的 `host-sidebar` 指令声明可见性，插件仅接受匹配项目的声明；`sidebar.sync` 握手补齐加载时序。宿主卸载或切换时声明旧项目不可见，插件恢复独立导航；插件的通讯录按钮可展开宿主通讯录。验证须同时挂载真实摘要组件与隔离iframe，不能只看独立插件截图。
- 独立升级三件：宿主、云端后端、插件ZIP；保持原国际站拒绝和固定官方路由，不因失败回落本地IM。验证：`ImAgentServiceTest`、`ImScopedAgentHostTest`、`ImPrivateProjectContextTest`、`ImPluginControllerTest`、插件 `build.sh` 及 `frontend/tests/plugin-sdk/im-workspace-summary.test.mjs`。合成模型和浏览器桥测试不等于付费实模或正式客户端联调。

**DPIA 工作台（dev-board#1347）**：`official-plugins/dpia-workbench/` 为可选独立 JAR+Web+skill 插件，保留上游 AGPL-3.0-only 来源和报告门槛；`runtime/adapter.mjs` 把 DSH 会话换成 `PluginHost.sessions()`（plugin-api 1.3.0）。宿主 `PluginAgentSessionService` / `PluginAgentSession` 持久化插件+用户+项目绑定，提交走原生 inbox。Web `chat.open` 验证当前项目历史，`ui.openUrl` 只许 HTTPS。AI 只可调用绑定本案/冻结任务的 task，不能代点 UI 人工确认。Node/Python/LibreOffice 由设置与系统路径提供；导出保存到项目。最低宿主 0.65.0，当前源码交付不代表已签名上架或客户端已升级。验证：插件 `build.sh`、`tests/adapter.test.mjs`、上游 Node/Python 测试、宿主 `PluginAgentSession*Test`、`frontend/tests/plugin-sdk/dpia-navigation.test.mjs`；真实渲染使用临时合成 DOCX，模型替身不能称模型联调。详见 `docs/PLUGIN_SPEC.md` §18 及插件 README。

**Windows DPIA 运行环境（dev-board#1394）**：适配器子进程与 Java 环境检测入口都明确设置 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`，前者控制上游默认文件读写、后者控制管道协议；不能只在 CI 设编码来掩盖产品问题。Windows LibreOffice 优先命令行 `soffice.com`，再兼容 `.exe`，显式配置仍受尊重。Windows Server 普通账户实测已发现 `.exe --version` 持续超时、`.com` 正常返回，完整新包回归以验收报告为准。

**尽调清单与客户协作（dev-board#1421）**：`DdFilesPanel.vue` + `DdRequestEditor.vue` 现承载律师侧清单导入、草稿要求、AI 示例、发布、版本化提交复核、申诉与底稿/报告入口。`services/ddWorkflow.js` 独立封装新 API；`utils/ddWorkflow.js` 的状态汇总把 AI 结果与律师决定分开，异步任务按真实 job 状态轮询，网络失败仅继续查询同一任务。“补齐示例”仅叶项缺图参与，串行生成（最多一项在途），真实完成后再推进；失败保留当前项，明确终态失败才允许用户重试新任务。发布后冻结要求，复制新草稿再改；审核必须带 `submissionId` 和 `revision`，409 保留意见并要求刷新。归档只读。有子项且没有当前提交或旧上传的父节点按分类展示，不计入收件进度；已有父项历史材料仍保留审核。`components/dd/DdClientWorkspace.vue` 在完整 App 独立标签中连接受邀项目，不切主账号；旧 CLIENT 路径由 `DdClientChecklist.vue` 兼容。律师清单入口仍仅云端轨道开放。底稿导入走本机 `/api/projects/{pid}/dd-materials/import`，报告走 `/report`，两者异步任务查询 `/dd-materials/jobs/{id}`；来源文件与报告勾稽由后端维护。新增双语文案在 `locales/*/ddWorkflow.js`。

**客户材料宽窄窗口（dev-board#1475）**：`DdClientChecklist.vue` 按材料区实际容器宽度显示列表/详情双栏或单栏；窄屏返回只隐藏详情，不销毁已选材料表单，保留逐项草稿与文件。`DdClientWorkspace.vue` 在空间不足时将项目/清单改为顶部选择；材料提交期间由 `busy-change` 锁定切换，异步提交捕获原 scope，并以 `operationGeneration` 拒绝重置或卸载后的回调。验收用 `frontend/tests/dd-workflow/client-responsive-fixture.mjs` 的本地合成数据，检查 382/430/620/900 宽度及上传中连续缩放；它不等于真实客户后端或真机相机验收。

以下为旧尽调模块的历史布局，报告联通以本段新增接口为准：前端 `frontend/src/components/DdFilesPanel.vue` + `DdRequestEditor.vue`；后端 `controller/DdController.java`（/api/dd）+ `service/DdService.java`；实体 DdRequest/DdItem/DdComment + 对应 Repository。无 skill。此前与尽调报告模块（dev-board#100，EvidenceLink 驱动的底稿驱动起草）分离；现通过上述底稿导入与报告接口联通。新模块的交付件导出（底稿目录/查验计划/缺口清单，`service/DdExportService.java` + `controller/DdExportController.java` + `service/ai/tools/DdExportTools.java`）内置在主仓、不是插件，详见 `.claude/agents/ai-doc-bridge.md`「EvidenceLink 契约」节的「P2 交付件导出」小节；尽调插件本体（`dd_ingest`/句式库/表格模板/skill）仍按 P1 设计（`docs/superpowers/specs/2026-08-21-dd-p1-drafting-design.md`）规划在私有仓 `aiworkdeck-dd-plugin`，尚未落地。P3 的网核 zip 接入（`service/evidence/webverify/`，SPI `WebVerifyProvider` + 离线实现 `ManualWebVerifyProvider` + `WebVerifyImportService` + `controller/WebVerifyController.java` + `service/ai/tools/WebVerifyTools.java`）同样内置在主仓、不门控——原方案 §7 把「网核适配层」划给尽调插件，落地时按 EvidenceLink 的分层口径改为内置：它只是往 EvidenceLink 里塞 target 的又一个来源。**红线**：网核只留接口，不做自动爬取、不碰验证码与合规风险（维护者 2026-08-21 拍板），任何联网抓取的实现都不许进这个包，详见 `.claude/agents/ai-doc-bridge.md`「P3 网核 zip 接入」节。

**脱敏**：前端 `frontend/src/components/DesensitizePane.vue`；后端 `controller/SensitiveController.java`（/api/sensitive：GET /options、POST /desensitize）+ `service/SensitiveService.java`（PDF 走 PDFBox PDFTextStripper 定位坐标涂黑，Word 走 XWPFDocument 段落级文本遮蔽）+ OcrService 辅助。**skill 型门控（2026-08-19）**：`backend/skills/desensitize/`（`enabled_by_default:false`，广场启停），`leftSidebarPlugins.js` 的 `desensitize` 条目带 `requiresSkill: 'desensitize'`——照搬诉讼可视化那套模式，装了才在左栏出现。**这个 skill 背后没有 AI 编排注入的能力**（无 `allowed_tools`，因此也不写 `tool_policy` = passthrough，命中它不裁剪本轮工具集——dev-board#799 之前这里会把 `doc_*` 全部裁掉，用户说「把这份合同脱敏后再帮我改第三条」时模型只能回「我无法修改文档」）：命中触发词「脱敏」时 prompt.md 只引导模型把用户指向面板手动操作，不假装能在对话里完成脱敏；面板本身仍是直连 `/api/sensitive` 的老路径，和 AI 编排无关。`languages` 只给 `zh-CN`——`DesensitizePane.vue` 本身已 i18n 化，但策略勾选项文案来自 `SensitiveType` 枚举（label/description 只有中文，`SensitiveController` 直接拼 `"label (example)"` 无语言分支），面板核心内容英文版下会露出中文，等 `SensitiveType` 补英文文案（需要改 `.java`）再解禁双语。

**中文姓名自动识别（2026-09-11，dev-board#599，取代 #531 的手填唯一入口口径）**：用户明确要求“百家姓规则＋上下文规则”。`CHINESE_NAME` 恢复为自动类型并默认勾选；`ChineseNameRecognizer` 结合单姓/复姓、人物字段、称谓/动作、名单与独立姓名行，排除普通词、公司和地址。同文已识别姓名在其他段落复用，但公司/地址中的同名片段不跟着替换，即便这些类别未勾选。不要恢复任意 2–4 汉字全遮蔽。识别与预览、DOCX、PDF、文本处理共用 `SensitiveTextEngine`，全程本地规则，不调用模型。

- “补充敏感词（可选）”保留首屏入口，与保留词一起纠正规则漏报/误报；不再要求逐个填写姓名。旧 `customWords` 请求兼容保留。
- `SensitiveChineseNameRecognitionTest` 验证正例、普通正文误报、复姓、同文复用及复敏；原 `SensitiveChineseNameOfflineTest` 继续守住无姓名正文与 DOCX 不变。前端 `test:desensitize` 验证默认勾选与双语文案。
- 规则不保证穷尽所有姓名，少见姓名、民族姓名、英文姓名与无上下文歧义词需人工复核。不得把合成样例通过率表述为真实材料准确率。

**地址默认识别（2026-10-21，dev-board#1420）**：`ADDRESS` 在 `DesensitizePane.fetchOptions` 默认勾选，真实本地识别走 `service/sensitive/ChineseAddressRecognizer`，不再只靠 `SensitiveType.ADDRESS` 的旧字段正则。注册地址/住所/通讯地址以及有明确行政层级或门牌的正文地址，共用预览、TXT、DOCX、PDF 检测链；不跨文本行/段落，后续联系人、法定代表人等字段及常见叙述动词截断候选；`ChineseNameRecognizer` 的地址保护区也共用该范围，避免漏掉同一行的联系人姓名。MASK 只留原文行政层级（如 `XX省XX市XX区XXXX`），无行政层级的详细地址为 `XXXX`；TOKEN 把此层级写进完整唯一编号，不能拆成编号外的前缀，否则复敏会残留掩码。PDF 仍为不可逆黑框，图片/扫描内容不做自动识别。引擎版本 `SensitiveService.VERSION` 与 skill 元数据为 2.3.0，不代表桌面包已发版。`SensitiveAddressRecognitionTest` 覆盖合成字段/正文、混合楼宇/门牌、边界/负例、TXT预览生成一致、DOCX跨run/表格、唯一编号与复敏/再次处理；不能用这些样本宣称穷尽所有地址。罕见地名、外文地址、跨行地址须在预览中人工核查。

**编号当事人与房号回归（2026-10-27，dev-board#1544/#1545）**：`ChineseNameRecognizer` 将“被告一：”“被告（2）：”等编号字段视为人物上下文，只替换姓名，保留角色与编号；仍要求姓氏、姓名边界及公司/地址保护。`ChineseAddressRecognizer` 的明细、字段邮政细节与字段结尾规则均接受“608房”，不能因末尾房号写法未知而整段漏掉。合成起诉状覆盖跨 Word run 的姓名/住址、预览与生成计数一致、MASK 一致及 TOKEN 复敏全文还原，不能据此承诺真实语料全识别。

侧栏顺序为选择文件→选择功能（解释脱敏/复敏）→补充敏感词→自动识别信息类型→替换方式→预览/生成。一般切换功能保持用户已选文件；只有“复敏这份结果”显式选择上次生成副本及其加密映射。预览、保存与密码保护继续生效。回归：`SensitiveChineseNameRecognitionTest`、`SensitiveAddressRecognitionTest`、`frontend/tests/desensitize/*`。

**同类规则与文档边界（2026-10-27，dev-board#1547–#1551）**：明确人物字段补第三人、申请执行人、被执行人、曾用名及有限角色括注；明确姓名字段中的 2–4 字含空格候选按完整原文区间替换，复敏保留空格，不能回退成只替换半个姓名。名单上下文在后续字段处结束，避免把“单位”“曾用名”标签误当姓名。地址接受全角门牌数字，并在手机、身份证号码、编号当事人、出生日期等后续字段前截断。手机号支持全角及 3-4-4 空格/短横线分组，原始写法保存在复敏映射中。

`SensitiveDocx` 的 run 拼接不能跨 `w:br`/`w:cr`/`w:tab`；分隔节点保留在原 XML 中，预览和生成按相同片段处理。PDF 预览和黑框生成共用带行/词分隔符的坐标文本，禁止直接拼接整页文字；仅对已启用且未排除的完整手机号保留已有的跨行数字兼容。新增回归 `SensitiveDocumentSeparatorsTest`、`SensitivePhoneVariantsTest`，并扩展姓名和地址测试。PDF 字体可能把“一、文”等汉字提取为等形部首（#1552）；引擎仅对姓名/地址建立长度不变的部首规范化匹配视图，原始区间、自定义词、保留词与复敏原值不变。以上只覆盖明确结构，不能承诺任意跨行地址或无上下文姓名全部识别；PPT/Excel 不在脱敏支持的文件类型中。

**脱敏编辑流程（2026-09-10，dev-board#557/#558）**：生成后 `open-file` 打开副本，左栏保留面板；结果区「复敏这份结果」选择本次副本并复用内存中的加密映射，密码须重新输入，跨次使用可导入 `.awd-recovery`。切文档标签不自动改变面板处理目标，需「导入当前」明确选择。`prepareFile` 由工作台注入 `sensitiveWorkflow.saveSensitiveInput`，预览/生成/复敏前等待目标编辑器保存，错误或未就绪阻止处理；生成前刚保存了修改则要求重新预览。普通 AI 对话可能附带历史/项目上下文，面板提示其不是隔离会话，不自动触发 AI，也不把恢复密码/映射交给 AI。前端测试用 `node --test frontend/tests/desensitize/*.test.mjs`。


**股东大会核查（已下线，2026-08-17）**：维护者决定不做了。`leftSidebarPlugins.js` 里的 rail 入口已移除、skill 改成 `enabled_by_default: false`，**其余三层代码一律保留**（面板组件、controller、service、实体、api.js 端点），想恢复只需把 rail 条目加回去。存量安装里 skill 仍是启用状态（`SkillRegistry` 的种子化只在首次见到该 id 时生效），要在插件广场手动停用。下面这段是它下线前的实现地图，恢复或翻旧账时照读。

面板 + AI 编排混合型（三层齐备）。**注**：下段那条「pinnedSkillId 只裁剪工具不注入 prompt」的地雷已在 2026-08 修掉（判据同源收敛到 `SkillRouter.activateForTurn`，见上文 skill 注入链路一节）；触发词必须在 prompt 文本里这条仍然成立——面板 kick-off 走的是自动匹配，不带 skillIds。前端 `frontend/src/components/ShareholderMeetingPanel.vue`（会话列表/五组材料槽位/巨潮拉取/开始核查，选文件用 FilePickerDialog 的 accept 过滤）；后端 `controller/ShareholderMeetingController.java`（/api/shareholder-meeting）+ `service/ShareholderMeetingService.java`（底稿夹 `股东大会核查/<公司>_<届次>/01..05` 五子目录、材料复制幂等、kick-off prompt 组装）+ `service/CninfoAnnouncementService.java`（巨潮拉取，挑选启发式移植自内核 skill 且有单测锁定）；skill `backend/skills/shareholder-meeting-verification/`。执行链路：面板 start 接口返回 prompt（以触发词「股东大会核查」开头）→ project-overview 经 `ChatInterface.sendExternalPrompt`（expose）以 AGENT 模式发送 → skill 注入 → AI 用 extract_file_text/run_python/write_docx（带 parentFolderId）产出核查底稿表与法律意见书到 04/05 子目录。**地雷**：pinnedSkillId 只裁剪工具不注入 prompt，触发词必须在 prompt 文本里；ASK 模式跳过注入。

**上市路径选择（Skill 型）**：`backend/skills/listing-pathway/`（skill.yml + prompt.md）。无独立面板，对话触发。

**合同审查（Skill 型，dev-board#375，2026-09-02；dev-board#1431 升格为内置高频工作流）**：`backend/skills/contract-review/`（skill.yml + prompt.md + prompt.en.md，双语，`category: 合同审查起草`，`builtin_workflow: true`）。无独立面板，对话触发（「审查合同/审阅合同/合同审查/审查这份/帮我审/審查合約…」+ 英文 "review the contract/redline this"；**刻意不用单字「审查」「审阅」**——skill 命中会把可见工具裁成本清单，泛触发会把尽调等别的业务工具藏起来）。立项原因：同一份台湾认购合约工作台只报 6 项、Claude Code 报 24 处，差距在工作流不在模型——system prompt 第 7 节与「Precise Execution」教的是单点修改纪律（看→找→改、只做指定那一处），审查恰好相反。prompt 固定五步：先定立场与适用法域（推不出就一次 `<question>`）→ 通读全文 + `doc_audit_structure` 机械核对 → 六遍清单（法律用语与法源 / 立场保护 / 结构与遗留硬伤 / 数字与一致性 / 空白不代填 / 商业条款不越权）→ 成批修订+批注（每轮 6-10 处、说明只进批注、字形跟随原文）→ 分类交付。allowed_tools 同时列 doc_* 与 office_* 两族（ClientCapabilityService 按会话只放行一族），法源核实 law_*（仅内地法）+ search_web/browse_url。回放用例 `skill-contract-review-audit-and-comment-tools-visible`（cases-skill.json）钉住审计/批注/修订工具在可见集里、pptx/python/流式写入被裁掉。

**懒人模式 · 内置高频工作流（dev-board#1431，2026-10-22）**：高频默认任务（`contract-review` 合同审查、`evidence-linked-report` 证据整理与核查闭环、`legal-opinion-review` 法律意见书核查，以及核心 `files`/`evidence` 渐进工具披露涵盖的「文件整理」「证据整理」）内置于工程主链路（`skill.yml` 声明 `builtin_workflow: true`）。`SkillRegistry` 对 `builtinWorkflow` 强制常驻启用且固定 `AUTO` 激活（忽略停用/仅手动覆盖）；`SkillMarketService` 从在线 Skill 广场过滤同名内置工作流并禁止卸载；`AgentOrchestrator` 在 `skill_update` SSE 事件中携带 `builtinWorkflow: true`。前端（`ChatInterface.vue`、`MarketSidebarPanel.vue`、`MarketPane.vue`）与 Office 插件（`chatSession.js`、`ChatView.vue`）将 `builtinWorkflow` 从手动勾选清单与「已安装 Skill」管理列表中隐藏，并在对话空态提供「内置高频能力 · 免选即用」四宫格快捷卡、Skill 选择器顶部常驻说明、广场「懒人模式」横幅以及自动接管时的 `内置 · {name}` chip 与 Toast 提示。

**诉讼可视化**：面板 + skill + 专用工具三层齐备，详见 `.claude/agents/litigation-visual.md`。skill 在 `backend/skills/litigation-visual/`。

**会议录音**：面板 + skill + 专用工具三层齐备（2026-08-14）。前端 `frontend/src/components/MeetingRecordingPanel.vue`（一键录音/列表/转写稿/说话人改名/生成纪要）+ **模块级录音单例** `frontend/src/utils/meetingRecorder.js`（MediaRecorder 5s 分片边录边追加上传，页面跳转不断录）+ 跨页面浮动指示器 `utils/recordingIndicator.js`→`MeetingRecordingIndicator.vue`（body 级挂载，feedbackWidget 同模式）；后端 `controller/MeetingRecordingController.java`（/api/meetings）+ `service/meeting/`（MeetingRecordingService 生命周期、MeetingTranscriptionService 转写编排：JavaCV 转码 mp3 → OSS 签名 URL → 通义听悟 CreateTask（说话人分离 SpeakerCount=0 + 章节/摘要/待办）→ **poll-on-read** 收结果、TingwuClient/MeetingOssClient 接口+SDK 实现、MeetingTranscriptParser 纯函数解析）；工具 `service/ai/tools/MeetingTools.java`（meeting_list_recordings/meeting_get_transcript）；skill `backend/skills/meeting-recorder/`（`enabled_by_default:false`，广场启停，触发词「会议纪要」）。凭证五件套（AK/SK/听悟 AppKey/OSS bucket/endpoint）存 system_setting `meeting.asr.*`/`meeting.oss.*`，admin 页「会议转写」卡片可改（AdminConfigController TingwuConfig）；未配置时录音存档可用、转写降级提示。转写三档（`external.asr.provider` = platform | byok | local，分档在 `MeetingTranscriptionService` 编排层）：platform 走网关、byok 用自己的听悟凭证、**local 走本机 `asr-service`（faster-whisper，音频零出网，没有说话人分离）**，档位与就绪判定见 `.claude/agents/licensing-billing.md` 地雷 36-39。**地雷**：听悟只收公网 URL（必须 OSS 中转，转写完即删）；kick-off prompt 以「会议纪要」开头；录音单例绝不能搬进页面组件（reLaunch 即断录）；local 档全程没有 taskId，「转写中」的自愈判据是进程内 `inFlight` 集合而不是 taskId。

**语音合成**：前端 `frontend/src/components/EasyVoicePane.vue`，与会议录音同占 rail `voice` 位、面板内两个 tab（`project-overview.vue` 的 `effectiveVoiceTab` 计算属性解出实际渲染哪个）。skill `backend/skills/text-to-speech/`——**默认启用**（`enabled_by_default: true`：语音合成此前无门控，老用户升级后入口不能消失，装了广场里能停用即可）。和脱敏同配方：无 `allowed_tools`（也不写 `tool_policy` = passthrough，不裁工具；本 skill 默认启用、触发词含「朗读文档」，dev-board#799 之前它是那条静默故障影响面最大的一个），命中触发词时 prompt 只引导去用面板，不假装能在对话里合成语音；模型下载走 desktop `modelManager`（约 300MB，本机离线引擎），与广场安装动作解耦——广场「安装」只是 `enable` 翻启用位。`leftSidebarPlugins.js` 的 `PANEL_SKILL_IDS` 里手工列了这个 id（和 `meeting-recorder` 一样，因为 `voice` rail 位本身没有 `requiresSkill` 字段，两个 tab 的门控都在面板内部做）。

**「语音」合并插件（dev-board#66，2026-08-20）**：概念模型「左栏一个图标 = 一个插件，skill 只在 AI 对话生效」——text-to-speech 与 meeting-recorder 两个成员 skill 在广场三处 UI 里合并成**一个**「语音」条目（分组定义 `VOICE_PLUGIN_GROUP` + 合成视图 `buildVoiceGroupSkill()`，都在 `leftSidebarPlugins.js`），启停一体：前端开关一次翻全部成员，后端 `SkillRegistry.convergeVoiceMergedSkills()` 每次扫描后把分裂态收敛为「任一启用 → 全部启用」（防「tab 可见但生成纪要 kick-off 命不中 skill」的静默断裂）；meeting-recorder 的 `enabled_by_default` 因此也改为 true。两个 skill 文件本身、AI 对话行为、触发词都没动。

**动态 JAR / Web 插件（dev-board#1531，2026-10-27）**：入口按 `contributes.views` 决定，不以安装或权限数量强制分配侧栏与标签。`views` 缺省/null 才保留旧版 rail + 简介导航 + `frontendEntry` / guide 工作区；显式 `[]` 无独立界面；sidebar-only 只开 panel；workspace-only 的 rail 按钮直接打开单例标签，不强制展开空 panel；两者都有则 rail 开 panel，插件按需用 SDK 1.8 `awd.ui.openWorkspace()` 打开自己的已声明工作区。旧宿主对新桥返回 `unknown_method`，源码支持与客户端发版分开记录。

- 工作区仍使用 `pluginWorkspaceTabs.js` 的 `openPluginTab(pluginId)`，身份跨左右窗格保持单例；只挂当前声明允许的工作区。显式空数组或 sidebar-only 不得因为保留 `frontendEntry` 被自动补出标签。
- 皮肤等轻量插件在主题切换等贡献点使用，保留插件中心预览/管理；`frontendEntry` 可以只是预览文件，不等于主界面。三款官方皮肤声明 `views: []`。
- SDK `ui.openWorkspace {}` 无参数，不加权限名，只能打开当前 iframe 自己的已声明 workspace；当前清单不可用、未声明工作区或作用域不允许时返回 `unavailable`。权限与视图声明各自校验，不能通过传其他插件 ID 或 URL 越界。
- 左右工作区分别按标签 `v-for/v-show` 保留实例，普通标签切换不丢输入；关闭、禁用、卸载、封禁、不兼容或视图不再提供工作区时清理。跨窗格移动可能重建，不承诺未持久化表单保活。插件禁止 Alt 双开。
- 标签只保存身份，实时 URL/permissions/devInstalled 从 `dynamicPlugins` 解析；快照恢复与插件清单加载两条完成路径都协调清理，清单失败不视为空列表。尚未核验时不挂 iframe。项目视图需要项目，全局视图可以在无项目态使用。
- 不再走 `openFile({fileType:'plugin'})`：文件类型闸不支持它。`fileKind` 把插件列入非文档，避免误入编辑器/AI 文档上下文。
- 新插件参照 `docs/PLUGIN_SPEC.md §8.1.1 / §17.2` 与 `backend/skills/plugin-dev/prompt.md`，按实际贡献点验证安装→启用→主要操作→禁用/卸载；轻量插件验证无多余入口，panel 验窄栏，工作区验单例、保活与关闭。不能只验安装接口。

### 三方 Web 插件（规范 v2.5，docs/PLUGIN_SPEC.md §8）

`manifest.frontendEntry` 从「预留」激活。两种形态在 PluginPane 里**行为刻意不同**：

- **`web/` 相对路径** = Web 插件。后端 `GET /api/plugin-web/{id}/**` 静态服务 `plugins/<id>/web/`；PluginPane 给 iframe 加 `sandbox="allow-scripts allow-forms"`，与插件只走 postMessage 桥。
- **`http(s)://` 绝对 URL** = 旧形态。不加 sandbox、不发握手、不响应桥调用——改它只会打断存量插件。判据是 URL 里有没有 `/api/plugin-web/`（`PluginPane.isWebPlugin`）。

**绝不给 sandbox 加 `allow-same-origin`。** 同源的 iframe 能读 localStorage 里的 `X-Session-Id` 并打全部 `/api/*`，等于白送宿主权限。

桥协议（`PluginPane.vue` 宿主端 / `sdk/plugin-sdk/awd-plugin-sdk.js` 插件端 / 官网模板与宿主模拟器，**三处同一份契约**）：`init` 握手 → `call{seq,method,params}` → `result{seq,ok,result|error}`；双向来源校验（宿主认 `event.source === iframe.contentWindow`，插件认 `window.parent`），targetOrigin 只能 `'*'`（opaque origin）。v1 方法：`context.get` / `files.list` / `files.read` / `ui.toast` / `storage.get` / `storage.set`；错误码 `permission_denied` / `unknown_method` / `quota_exceeded` / `not_found`。

**v2.5 新增三方法**（`PluginPane.handleCall`，SDK 版本 `1.0.0`→`1.1.0`，老宿主对新方法一律回 `unknown_method`，插件要能降级）：`tools.invoke {name, args?}` -> `{output}`——经直调端点 `POST /api/plugins/{id}/tools/{tool}`（`PluginController.invokeTool`）调本插件自己的 JAR 工具，安全闸自上而下是登录会话 → 项目写权限（`ProjectMemberService.hasWritePermission`）→ 工具名必须是该插件 manifest `tools` 声明的 → 插件启用未封禁，再落到 `ToolRegistry.execute` 走 manifest permissions/宿主 SPI 配额/`ToolContext` 服务端定 projectId·userId 这套 AI 链路同款闸；`chat.send {prompt}`（≤4000 字）-> `{}`——把 prompt 当可见用户消息发进 AI 对话，与 PluginGuidePane quickActions 同一条 kickoff 路；`ui.openFile {path}` -> `{}`（需 `file_read`）——复用 `awd:open-evidence-target` 事件链把项目文件开到工作台中栏。新增错误码 `invalid_params` / `invoke_failed`。设计意图：Web 面板做结构化操作时直调自家工具绕过模型，但一步都不绕过安全闸。

**v2.6 主题通道**（dev-board#274，SDK `1.1.0`→`1.2.0`，照 VS Code 给 webview 注入 `--vscode-*` 的机制）：`init.context` 新增 `themeTokens`（当前主题全部 `--awd-*` 令牌值，名单=宿主 `utils/appTheme.js` 的 `THEME_TOKEN_NAMES`）；宿主切主题时 `PluginPane.pushTheme()` 推 `{awd:1, type:'theme', theme, tokens}`。SDK 收到即自动挂 `data-theme`/body class 并把令牌写成 iframe 内 CSS 变量——插件写 `var(--awd-surface, #fff)` 即可跟随主题（fallback 兼容老宿主）；脚本联动用 `awd.theme.get()/onChange(cb)`。双向兼容：老 SDK 忽略未知 type，老宿主下新 SDK 停在握手快照（无 themeTokens 则只挂 data-theme）。

**v2.7 生态路线 P0-P2（dev-board#280/281/282，宿主 0.27.4 起）**：设计定稿在 `docs/superpowers/specs/2026-08-29-plugin-p0/p1/p2` 三篇，总路线 `docs/PLUGIN_API_ROADMAP.md`。要点：
- **P0 治理**：manifest `minHostVersion`（`PluginService.computeIncompatibleReason`，不兼容 = `isEnabled` 返回 false——既有全部消费点免改自动生效；enable/市场安装/dev 直装三处明确拒绝；宿主版本来自 `telemetry.app-version`←`AWD_APP_VERSION`，dev 态 `"dev"` 跳过）；实验 API `x-` 前缀（`PluginPane.handleCall` 只对 `devInstalled` 放行，`.awd-dev` 标记经 PluginView 透传）；只加不改章程与四处同步纪律 = PLUGIN_SPEC §12。semver 比较用新建的 `com.checkba.util.Semver`（另两份包私有旧拷贝不动）。
- **P1 doc.\*+事件**：桥 `doc.exec`（白名单 `frontend/src/config/pluginDocActions.js` = `PluginHostImpl.DOC_ACTIONS` 同一份，`doc-actions-parity.test.mjs` 对拍；写入带 `__agent`）、`doc.active`；事件通道 `events.subscribe`/`type:'event'`（`PLUGIN_EVENTS` 表：files.changed 需 file_read/500ms、selection.changed 需 editor/300ms、project.switched；事件源 = `FileTree.loadFiles()` 发 `uni.$emit('awd:files-changed')`、`LibreOfficeEditor` selection 分支发 `awd:selection-changed`，PluginPane 按订阅转发，payload 刻意为空）。
- **P2 ai.request**：桥 → `POST /api/plugins/{id}/ai/complete`（`PluginController.aiComplete`，闸序同 invokeTool + `ai` 权限 + 16000 字符 + `PluginHostQuota.acquireAi` 10 次/分钟）→ `PlatformAiUserScope` 里调辅助模型 + `TokenUsageService` 记账（pluginId 只进日志）。manifest 权限值新增 `ai`（KNOWN_PERMISSIONS 与 PluginDevService.ALLOWED_PERMISSIONS 两处都加了）。
- SDK `1.3.0`；测试：`PluginServiceTest`（minHostVersion 五条+dev 标记）、`PluginControllerAiCompleteTest`、`PluginHostQuotaTest`、`events-channel.test.mjs`。

**v2.8 生态路线 P3（dev-board#283，宿主 0.28 起）**：evidence.retrieve.v1 升格公开 Provider 协议（PLUGIN_SPEC §13）。要点：
- **两条通道**：JAR 实现 `com.checkba.plugin.api.evidence.EvidenceProvider`（plugin-api 1.1.0→1.2.0 新增 evidence 包，`loadJar` 扫描 `isAssignableFrom` 检出并实例化）；manifest `contributes.evidenceSources` 声明远程 MCP（transport=mcp，只收 http(s) url——**本地命令型子进程不受理**，现有 MCP 设施也只有 streamable-http）。
- **双校验**：`sourceId()` 必须 `<pluginId>.<name>` 且与 manifest 声明（transport=spi）逐字一致，否则拒注册记 ERROR（`PluginService.registerEvidenceProvider`）。
- **适配层**：`PluginSpiEvidenceRetriever`（10s 超时+异常降级空列表+启用位闸——禁用插件的来源静默）；MCP 走 `McpEvidenceRetriever` 新增的 ad-hoc ServerConfig 构造器 + `McpClientService.callTool(ServerConfig,...)` 新重载。`EvidenceRetrieverRegistry` 新增 registerExternal/unregisterExternal/clearExternal（外部来源独立 ConcurrentHashMap，内置表不动；rescan 整批清空重建）。
- conformance：`EvidenceProviderConformanceKit`（plugin-api 内零依赖执行器，返回空列表=通过）；示例 `examples/hello-evidence-plugin/`（SPI+conformance 全绿）。dev 免签直装**不收** evidenceSources（PluginDevService 校验直接报错）。
- 地雷：插件别实现内部接口 `service.ai.evidence.EvidenceRetriever`（不是契约）；`registerDeclaredMcpEvidenceSources` 在元数据阶段注册（不兼容插件跳过）、SPI 的随 JAR 加载注册——两条路都吃 registry 判空（直接 new PluginService 的测试不受影响）。

**v2.9 生态路线 P4（dev-board#284，宿主 0.28 起）**：声明式长尾四贡献点（PLUGIN_SPEC §14）。要点：
- **落点**：`PluginContributionService`（模板清单/落地、画像选择与降级、设置校验与掩码、外观皮肤 `contributes.themes` 解析与选择、声明文件 canonical 逃逸闸）+ `PluginService.localize`（l10n %key%，表在 `pluginL10n`，rescan 重建）+ `StyleProfileResolver` 插档（可选注入，选中的插件画像在「项目画像」与「系统默认」之间）。
- **外观皮肤（dev-board#1480，PLUGIN_SPEC §14.6）**：`contributes.themes` 声明皮肤 JSON（`roles.light` / `roles.dark`、`fonts`、`effects`、`previewSwatches`），后端 `PluginContributionService` 归一化 `--awd-*` 键并以 `UNSAFE_CSS_VALUE` 过滤 CSS 注入，选择位存 `ui.theme.selected`（`GET /api/plugins/contributed/themes`、`POST /api/plugins/contributed/themes/select`）。前端 `utils/appTheme.js` 的 `setActiveSkin()` 将当前明暗模式对应的皮肤令牌与字体栈挂到 `document.documentElement` 并广播 `APP_THEME_EVENT`（Web 插件 iframe 经 `collectThemeTokens()` 自动同步）；`MarketDetailPane.vue` 与工作台顶部 `.theme-menu`（`themeSwitch.js`）均可一键切换。广场预览 iframe 仅 `allow-scripts`，明暗与令牌由宿主通过现有 `theme` 消息单向推送，禁止 `allow-same-origin` 或读取 parent.document；全局选择位写入沿用管理员闸。正式包 `extraResources` 必须包含皮肤 manifest/web/themes/l10n，既有内置插件也包含 l10n。首批随包内置 3 款官方皮肤插件（`PluginBundledInstaller.IDS`）：`theme-inkwash-zen`（东方水墨 · 飞白禅圆）、`theme-anime-twilight`（日漫晨昏 · 逢魔之时）、`theme-aurora-glass`（深海极光 · 冰刃琉璃），三款皮肤通过显式 `contributes.views: []` 不占 rail 或工作区，主题菜单与插件中心预览继续可用。
- **模板**：`FileTree.handleCreateWord` 变成选择（空白永远第一项，actionsheet 只列前 5；老行为在 `createBlankWord`）；AI 工具 `ContributedTemplateTools`（list/create 两枚，已进 RealToolBeans 与 toolDisplayNames）。
- **设置**：值直存 `plugin.<id>.<key>`（与 SPI Settings 同命名空间，JAR 免转接）；写入只经广场详情页表单（`MarketDetailPane.loadContribution/doSaveSettings`，admin 同启停口径）；保存后 `uni.$emit('awd:plugin-settings-changed')` → PluginPane 只转发给设置所属插件的 `settings.changed` 事件；**secret 不进桥**（桥 settings.get 回 permission_denied），表单里掩码值原样未动 = 不回写。
- **地雷**：manifest `settings[].default` 是 Java 关键字，PluginSettingDecl 用 Hutool `@Alias("default")` 映射（`PluginContributionServiceTest.settingsRoundTrip` 钉着）；dev 直装仍要求 frontendEntry，纯声明插件走广场/手动安装。SDK `1.4.0`；示例 `examples/hello-declarative-plugin/`。

**这是 manifest permissions 第一次成为真实边界**：缺 `file_read` 时 `files.*` 直接 `permission_denied`；`network` 决定 PluginWebController 下发的 CSP 是 `connect-src 'none'` 还是 `connect-src https:`。JAR 插件同 JVM 同权限，做不到这一点。

插件级 KV 存宿主 `localStorage` 的 `awd_plugin_kv_<pluginId>`，总量 64 KB；`files.read` 文本上限 5 MB（超限截断且 `truncated:true`，不报错），扩展名不在可抽取文本白名单里的按二进制拒绝。

`manifest.packs: ["<packId>"]`（v2.3）：在线安装成功后 `PluginMarketService` 逐个 `NativePackService.installAsync`，**装不上不回滚插件只记 WARN**。

示例：`examples/hello-web-plugin/`；SDK 源头 `sdk/plugin-sdk/`（官网模板里那份是分发副本，必须逐字节一致）。

### 能力槽与能力包（v2.10 §15，dev-board#497，2026-09-07）

第六种扩展形态**不是新形态**：能力包就是带 `contributes.capabilities` 的普通插件包，复用插件 id、
启停、封禁、rescan、签名全套设施。新的只有「槽」这层间接：`com.checkba.service.capability`
（`CapabilitySlotRegistry` 槽表+候选+选择位+降级、`CapabilitySourceFetchService` 从 GitHub 拉源码、
`CapabilityInstallService` plan/apply 两步）+ `controller/CapabilityController`（`/api/capabilities`，
admin 同 PluginDevController 口径）+ `service/ai/tools/CapabilityTools`（四枚工具）+ 设置页
`AdminPane.vue` 的 `capabilities` 分区。首期只注册一个槽 `litigation.diagram`（协议 `litviz-cli/1`）。

- **槽的消费方接法**：`@PostConstruct` 里 `slotRegistry.registerBuiltin(slotId, () -> 自己的内置链)`，
  再在自己的资源解析链**最前面**插 `slotRegistry.resolve(slotId, includePack)`。`resolve` 只回答
  「有没有选中一个非内置实现」——选了 builtin / 没选 / 选中的实现坏了都返回 empty，消费方接着走原有链。
  **内置定位逻辑因此只有一份**，别在槽里再抄一遍。`LitigationVisualService` 是唯一先例。
- **注入必须是 `@Autowired(required=false)` 字段注入**：`LitigationVisualService` 在单测与 EvalHarness
  里是直接 `new` 出来的，构造器注入会让那些场景整片红；同时 `CapabilitySlotRegistry` 构造器持有
  `PluginService`，改成构造器注入还会成环。
- **三档形态决定谁能装**：`web`/`data` AI 可自动装，`process`（宿主机起进程）默认拒绝，只有
  `system_setting` 的 `capability.dev-mode=true` 时才以 `.awd-dev` 标记安装并在 UI 上永远标「未签名」。
  `backendJars`/`tools`/`skills`/`packs` 任一非空仍一律拒装——免签路径不许绕过签名闸。
- **`PluginDevService.validateManifest` 的 frontendEntry 限制已放宽**（只在「无 frontendEntry 且声明了
  至少一项声明式贡献」时放行）。这条同时惠及纯模板/画像包。改这里要记得 `installFiles` 是
  项目内 dev 直装与「从本地目录装」（能力包）的**唯一**共用实现，两条路的校验必须永远同一套。
- **地雷**：① `capability_install` 只做 plan，绝不落盘；模型必须 `<question>` 停机等用户确认后才调
  `capability_apply`。② 这四枚工具的登录+admin 闸写在 `CapabilityTools.requireAdmin()` 里，
  **不能靠 skill 的 allowed_tools**（只裁可见性不拦分发）。③ `CapabilitySourceFetchService` 是全系统
  唯一「从任意 URL 取代码到宿主机」的路径，URL 白名单/SsrfGuard/限额/解包安全闸四条缺一不可；
  测试注入 `setDownloader` 用本地 tar.gz，**永远不上网**。④ 选择位 `capability.<slot>.selected` 写空串
  与写 `builtin` 语义相同，`effectiveRef()` 是唯一判据——回滚历史里存的必须是 effective 值，
  否则从初始态切走一次之后就永远回不去。

### 插件开发形态（dev-board#61，2026-08-20）

第五种信任路径：**本机用户自己写的插件免签直装**（区别于广场的审核+验签+装后默认禁用）。
链路：项目根「插件开发/<id>/」文件夹是源码（manifest.json + web/，文件树可见、CodeMirror
可编辑、进版本记录）→ `PluginDevService.install` 校验后拷进本机 `plugins/<id>/` + rescan +
**启用**。装出的目录带 `.awd-dev` 标记（JSON：projectId/folderId/installedAt）——
装机拒绝覆盖无标记（=广场装的）同名目录，`dev/uninstall` 也只认带标记的目录。

- **安全红线：dev 安装只收纯 Web 插件**——manifest 的 backendJars / tools / skills / packs
  任一非空一律拒装（JAR 与宿主同 JVM 同权限，免审路径会把签名闸变成摆设；沙箱 Web 插件
  才配「写完直接跑」）。校验错误逐条拼在 IllegalArgumentException.message 里，
  面板与 AI 工具都按原文展示/返回（AI 靠它自我修复迭代）。
- 端点 `/api/plugins/dev/*`（scaffold/status/install/uninstall，PluginDevController，
  写操作 admin 同市场口径）；AI 工具 `plugin_dev_scaffold` / `plugin_dev_install`
  （PluginDevTools，新工具组件记得同步 RealToolBeans——已加）。
- 内置 skill `backend/skills/plugin-dev/`（enabled_by_default:false，requiresSkill 门控
  左栏「插件开发」面板 PluginDevPanel.vue，rail 排在 market 之后）。**prompt.md 是
  Web 插件开发的权威 spec**（目录契约/manifest 规则/沙箱边界/SDK 桥 v1+v2.5 全量 API/迭代流程），
  改桥协议或 manifest 规则时必须同步它，否则 AI 会按旧契约写插件。dev 安装的插件 manifest
  `tools` 强制为空，所以 `tools.invoke` 在本机自测环境下永远只收 `invoke_failed`——
  prompt.md 已加提醒，别让 AI 对用户承诺一个本机测不出效果的功能。
- 骨架模板在 `backend/src/main/resources/plugin-dev/`（template-index.html +
  awd-plugin-sdk.js 副本）。**SDK 至此有四份分发副本 + 宿主端实现**（原三份 + 本 classpath
  副本），classpath 副本与源头的逐字节一致由 `PluginDevSdkParityTest` 守着。
- 文本扩展名白名单已放宽到代码文件（json/js/mjs/css/html/htm/yml/yaml），前后端两张表
  必须一致：`TextFileEditTools.PLAIN_TEXT_TYPES` 与 `fileOpenTabs.js` 的 `PLAIN_TEXT_TYPES`。

## 注册与加载链路

1. 静态注册：`frontend/src/config/leftSidebarPlugins.js` 导出 LEFT_SIDEBAR_PLUGINS + `getPluginsForUser(role)`。
2. project-overview.vue 计算属性（~:1581）合并静态列表与 dynamicPlugins。
3. 动态插件：`loadDynamicPlugins()`（~:6261）调 `GET /api/plugins/list`，映射成 `{key:'plugin-<id>', pluginId, label, icon, isDynamic, permissions, frontendEntry}`。`frontendEntry` 经 `api.js` 的 `resolvePluginEntryUrl(id, entry)`：相对路径 → `<apiBase>/api/plugin-web/<id>/<entry>`，绝对 URL 原样。**`key` 是 `plugin-<id>`，`pluginId` 才是原始 id**——桥的握手上下文与 KV 分区键用后者，混用会让插件存储串到别的键上。
4. 面板分发（~:531-563）按 leftPaneKey：dd-files→DdFilesPanel、desensitize→DesensitizePane、easyvoice→EasyVoicePane、search→SearchPanel、files→文件树、动态→PluginPane、其余→占位符。
5. 后端 PluginService：由 `StartupDataInitializer` 在普通 Bean 构造完成后、WebServer 接收请求前扫描 `plugins/`（可配 `ai.plugins.dir`），读 manifest.json → PluginMetadata；有 backendJars 时独立 URLClassLoader 加载，扫 langchain4j @Tool 类注册进 ToolRegistry。`POST /api/plugins/rescan` 热重扫。

## skill 文件格式（docs/SKILL_SPEC.md、docs/PLUGIN_SPEC.md）

目录式：`skills/<id>/skill.yml + prompt.md`。skill.yml 字段：`id`（必需，kebab-case，启停键）、`name`、`description`、`triggers`（必需，关键词数组，用户输入"包含"即命中；拉丁串两端要求整词，口径见下文「触发词匹配口径」）、`prompt`（默认 prompt.md）、`tool_policy`（`passthrough`（缺省，不裁工具）/ `restrict`）、`allowed_tools`（须为 ToolRegistry 真实工具名；只在 `restrict` 下参与裁剪）、`output`、`requires`（如 evidence.retrieve.v1，v1 仅声明）。未知字段忽略；解析失败跳过不阻断。

**应用语言字段（EN 版 PR5，全部可选）**：`languages`（数组，可用的应用语言；**缺省 = 只在 zh-CN 可用**——存量第三方 skill 没这个字段，英文版自动隐藏，方向安全）、`name_en` / `triggers_en` / `output_en`（英文侧文本；triggers_en 只在 en-US 参与匹配，zh-CN 匹配行为不变）、目录下可放 `prompt.en.md`（存在即加载，英文注入优先用它，缺省回退 prompt.md）。语言过滤收口在 `SkillRegistry.isAvailable`（match/钉选/注入三条路径共用，不会只滤列表不滤注入）；内置三 skill：股东大会核查与上市路径 `languages: [zh-CN]`（中国法深度绑定，且后者触发词含 IPO/SPAC/VIE 会命中英文输入，必须真隐藏），诉讼可视化双语（带 triggers_en + prompt.en.md）。守卫在 BuiltinSkillsTest / SkillRouterTest 的语言组测试。注意 `/api/skills/list` 与广场列表**不做**语言过滤（管理面照常展示，只是英文模式下 zh-only skill 永不注入）。**因此该列表带了 `available` 字段（= `SkillRegistry.isAvailable`）与 `nameEn`**：对话面板那个「主动加载技能」选择器必须自己按 `available` 滤一道，否则英文界面下用户能勾中一个 zh-only skill，勾了永远不生效也没有提示。

插件携带 skill：manifest.json `skills` 字段列子目录名，PluginService 只收集目录（`getPluginSkillDirs()`），解析/启停归 SkillRegistry，记 sourcePluginId。

manifest.json 要点：id（必需）/name/version/icon/author/permissions（file_read/file_write/network/editor）/tools[]/frontendEntry/backendJars[]/skills[]。

## skill 注入对话链路（backend/src/main/java/com/checkba/service/ai/skill/）

- `SkillRegistry.java` — 发现/加载：扫内置 skills/ 目录 + 插件携带目录，SnakeYAML 解析，id 去重（先扫到优先）；`isAvailable` = 自身启用 且 所属插件未禁用。
- `SkillRouter.java` — `match(userInput)` 取最长命中关键词（自动匹配仍是单选）；`activateForTurn(conv, input, pinnedSkillId, manualSkillIds)` 每条用户消息刷新一次**生效集合**；`activeSkills(conv)` 返回 `List<ActiveSkill(definition, displayName, source)>`（`activeSkill` 是它的单值出口）；`visibleTools` 先看 `tool_policy`——**任一生效 skill 是 passthrough 就整轮不裁**，全体 restrict 时才按整个集合的 allowed_tools 并集 ∪ baseTools ∪ `ORCHESTRATION_TOOLS` 裁剪（业务工具零命中则不裁剪）；`promptInjectionFor(skill)` 拼一个 skill 的注入块；`displayName(skill)` 按应用语言解析展示名。
- **生效集合 = 手动选择 ∪ 触发词自动命中**（2026-08 AI 面板 skill 可见性改造）：
  - 手动选择来自 `POST /api/agent/chat` 的 `skillIds`（旧字段 `pinnedSkillId` 收编为「只有一项的手动列表」，已 `@Deprecated`）。**无状态**，前端每轮携带，后端不持久化。
  - **并集而不是覆盖**：手动选择表达的是「这轮务必带上它」，不是「只准用它」。集合顺序把手动放在前面，于是 `activeSkill` 这个单值出口仍返回用户明确选的那个（旧的「钉选优先于触发词匹配」语义因此保持）。
  - 同一个 skill 既被手动选中又命中触发词时只出现一次，source 标 `manual`。
  - 埋点 `skill.activated` 每个生效的 skill 各一条（`how` 取值仍是旧字面量 pinned/matched，官网账本按它分组）；`matter.classified` 只取首个——一轮对话只能有一个事项类型。
- **第三条生效路径：模型中途调 `use_skill(skillId)`**（dev-board#1065，对标 Claude Code 的 Skill 工具）。前两条（手动选择、触发词）都在起跑时、都要求用户说对词；
  这条让模型自己判断「这件事该按某个 skill 的流程走」（「把这次股东会的材料核一遍」一个触发词都没有）。工具 `tools/SkillTools` 返回
  `SkillRouter.skillInstructionsFor(skill)`（模板 + 输出约定，语言同注入口径）作为工具结果；编排器分发后调 `SkillRouter.activateMidRun`：
  restrict 且白名单非空的记进 `midRunByRun`（与 `activeByRun` 分开，不进 `activeSkills`，所以不补注入 system、不发 `skill_update`），
  并把 allowed_tools 涉及的类目并进展开集。**中途生效只加不减**：`visibleTools` 在起跑时已裁过的回合里并上它的白名单，起跑时没裁的回合维持不裁。
  可调用口径 `SkillRouter.invocableSkill(s)` = 可用（`isAvailable`）且**不是仅手动**。模型从 `list_tools()` 目录页末尾的 skills 段拿 id。
  **写 skill 的人要知道**：`description` 的第一行会原样出现在模型的目录里（截 120 字），它现在是模型决定调不调这个 skill 的唯一依据——写成一句「做什么、什么时候用」。
- 编排接入（纯旁路两处）：`AgentOrchestrator.java` activateForTurn + 发 SSE `skill_update`（~:430）+ visibleTools（~:1160）；`ContextAssemblerService.java` **activeSkills→promptInjectionFor 逐个注入**（~:165）。ASK 模式跳过注入，且手动选择在 ASK 下整体不参与激活。
- **地雷已修（别改回去）**：`ContextAssemblerService` 原来在注入处自己 `match(userPrompt)` 重新匹配了一遍，判据与编排器裁工具用的那套不是同一个——于是 pinnedSkillId **只裁工具不注入 prompt**，`enabled_by_default` 之外最阴险的一类静默故障。现在两者同源读 `skillRouter.activeSkills(conversationId)`。**注入侧一律不许再 match 一次。**
- 配置：`SkillProperties.java`（ai.skills.dir / base-tools / disabled-cache-ttl-ms / registry-url）。

### tool_policy、allowed_tools、base-tools 与编排类工具（写 skill 前必读）

**裁不裁工具是 skill 自愿声明的**（dev-board#799，审计 A2）：skill.yml 的
`tool_policy: passthrough | restrict`，**缺省 passthrough = 不裁剪**，`allowed_tools` 这时只是
说明能力边界的文档。改之前裁剪与否只看 `allowed_tools` 有没有内容，而它的缺省是空 ArrayList——
于是「本身不带工具」的 skill（`desensitize` / `text-to-speech`，它们的作用是把用户引导去左栏面板，
**刻意不带工具是有意设计**）一旦被触发词命中，整轮可见工具从一百多个塌缩成 base-tools ∪ 编排类
工具十来个、`doc_*` 全部消失，模型只能回一句「我无法修改文档」；而 `text-to-speech` 还是
`enabled_by_default: true`，默认对所有用户生效。误配置回退救不了它：那条判据是「filtered 里是不是
只剩编排类工具」，base-tools 的三个恰好让它为假。不报错、不告警，表现只是「AI 突然不会改文档了」。

三条配套规则：
- **多个 skill 同时生效时，任一 `passthrough` 就整轮不裁**——收窄必须全体同意，否则裁掉的正是
  那个 skill 没机会用白名单申报的能力。
- **`restrict` 却没写 `allowed_tools`** 按 passthrough 兜（加载期 warn）：真按它裁就是上面那个 P1。
- 无法识别的 `tool_policy` 值同样回落 passthrough（判不准时不裁剪）。

八个自带 skill 里六个显式写了 `tool_policy: restrict`（= 保持现状，各自 yml 里有一段理由），
`desensitize` / `text-to-speech` 不写。

**`restrict` 的 skill 白名单必须含编辑面**（dev-board#818，2026-09-22）：裁剪只影响可见性、
不报错也不告警，白名单里没有 `doc_*` / `office_*` 时，命中那一轮模型看不见任何编辑原语，
表现就是「AI 突然不会改文档了」——与 A2 同一形态，只是清单非空所以更隐蔽。
`meeting-recorder`（默认开、触发词「会议纪要」很宽）与 `listing-pathway`（触发词含 IPO/VIE/SPAC）
此前正是这样，已补齐读写基本面（`doc_get_document_text` / `doc_get_outline` / `doc_find_text` /
`doc_get_cursor_context` / `doc_insert_at_cursor` / `doc_insert_under_heading` / `doc_insert_table` /
`doc_find_replace` / `doc_replace_selection` / `doc_undo`）。
**两族都要列**：`ClientCapabilityService` 按会话客户端只放行其中一族（工作台 LOWA 会话见 `doc_*`，
Office/WPS 任务窗格会话见 `office_*`），skill.yml 不能替它挑；只列一族等于对另一类客户端完全失能。
守卫：`BuiltinSkillsTest.restrictingSkillsCarryTheEditingSurface` 给三个 restrict skill 钉了下限，
回放用例 `skill-meeting-recorder-doc-editing-surface-visible`（LOWA 会话）与
`skill-listing-pathway-office-editing-surface-visible`（Word 任务窗格会话，用例里写
`clientCapability: office` 让 `EvalHarness` 登记会话能力）各守一族。
`skill-listing-pathway-trigger-trim-xml` 仍断言裁剪发生——判据换成了「`doc_open_file` /
`doc_start_stream` / `doc_apply_standard_format` 仍在白名单外」，别把它改成整族放开。

### 触发词匹配口径（`SkillRouter.containsTrigger`）

**子串匹配 + 拉丁串两端整词**（dev-board#818）。用户输入与触发词都先转小写，然后：
- 触发词那一端是 ASCII 字母/数字时，输入里相邻的那个字符不能也是 ASCII 字母/数字；
  中文、空白、标点、串首串尾都算边界。同一触发词在输入里出现多次，有一次落在边界上就算命中。
- 触发词两端都不是拉丁字母数字（绝大多数中文触发词）时退化为纯 `contains`，**行为逐字节不变**。

为什么不是全局整词：中文没有词分隔符，「上市路径」在「公司上市路径选择」里就是紧贴中文出现的，
套 `\b` 会让中文触发词一个都匹配不上。为什么不是纯 `contains`：`IPO` / `VIE` / `SPAC` 这类
三四字母缩写会把「VIPO 品牌」「IPOS 系统」「view」「space」也算命中，而命中一个 `restrict` 的
skill 是有代价的（注入无关指引 + 裁工具）。

**它治不了中文语境的过宽**：「帮我把这段 IPO 条款改一下」两端是空格与中文，照样命中。
这一半只能靠两件事兜——把短词写成短语（`红筹`→`红筹架构`/`红筹上市`，`借壳`→`借壳上市`，
`证券化`→`证券化路径`/`实现证券化`，`整理会议`→`整理会议录音`/`整理会议记录`），
以及上面那条「白名单带编辑面」，让误命中退化成「指引不对但能力还在」。
单测 `SkillRouterTest.latinTriggersMatchWholeWordOnly` / `chineseTriggersStayContainsMatching`，
触发词清单守卫 `BuiltinSkillsTest.overBroadTriggersAreTightened`。

命中一个 `restrict` 的 skill 后模型可见的工具 = **allowed_tools ∪ base-tools ∪ 编排类工具**，
三份来源语义不同，别合并：

- `allowed_tools`（skill.yml）——本 skill 的业务能力清单。**不是**「常用工具默认都在」，需要的每个工具都得逐个列出，漏一个就等于对模型隐藏了这个能力。
- `base-tools`（application.yml `ai.skills.base-tools`，只有三个：`read_document / list_files / query_memory`）——业务能力兜底，随部署形态可调。
- 编排类工具（`SkillRouter.ORCHESTRATION_TOOLS`，当前 `todo_write` / `dispatch_subtask`）——**恒定可见，任何 skill 都裁不掉**。编排能力属于「Agent 怎么干活」，不属于任何业务领域。刻意写死在代码里不做成配置项：做成 yml 的话 prod/desktop 覆写一次就能重新裁掉它，而这个故障是静默的。护栏是 `SkillRouterTest.orchestrationToolsAlwaysVisible`（用一个 allowed_tools 故意不含它们的假 skill 断言）。反问走 `<question>` 标签、不是工具，所以不在这组里。

顺带的语义变化：白名单零命中的回退判据现在排除编排类工具（「业务工具零交集」才回退不裁剪），否则「零交集」永远至少剩那两个，原来的误配置保护会被静默废掉。

裁剪只影响可见性、不拦分发（SkillRouter 类注释）。后果是：漏列的工具在**原生 function calling** 下模型压根看不见（永远不会用），但在 **XML 兜底协议**下模型凭 system_prompt 的记忆写出 `<tool_code>` 仍能被分发成功。**同一个 skill 的能力边界因此取决于当前模型走哪套协议**——这类 bug 在换模型时才暴露，排查时先看协议再看白名单。

2026-08 实例：两个自带 skill（`shareholder-meeting-verification`、`listing-pathway`）都漏了 `dispatch_subtask`，而它们恰好是 `prompts/system_prompt.md` 第 6.5 节明确要委派子 Agent 的长程任务。已补上（#323），并由回放评测用例 `skill-shareholder-meeting-dispatch-subtask-visible`（`backend/src/test/resources/ai-eval/cases/cases-skill.json`）守住「skill 命中时 dispatch_subtask 在可见工具集里」。这两处显式声明在编排类工具恒定可见之后**已经冗余，但刻意保留**——显式声明无害且自文档，删掉会让 skill.yml 看起来「不需要子 Agent」。

## skill 目录：可写 vs 只读内置（2026-08）

`SkillRegistry` 扫**两个**目录：

1. `ai.skills.dir`（默认相对目录 `skills`，**可写**）——广场安装/卸载的落点。
   打包态后端 cwd 是用户数据目录，所以它解析到 `<userData>/skills`。
2. `ai.skills.builtin-dir`（**只读**，绝对路径）——随发行版分发的内置 skill。
   桌面端用 `AI_SKILLS_BUILTIN_DIR` 注入 `Resources/skills`；dev 态留空。

**先扫可写目录**：id 去重是「先扫到优先」，于是广场装的同 id skill 能覆盖随包内置的
那份——内置 skill 出问题可以走广场热修，不必等客户端发版。

**历史坑（v0.11.1 及以前）**：`backend/skills/` 从未进过安装包，而打包态 `skills`
相对目录解析到一个空目录——上市路径与股东大会核查两个内置 skill **在发行版里根本不
存在，只在 dev 生效**。已实证（发行版 Resources 下无任何 skill 痕迹）。修复即上面的
双目录 + extraResources。`SkillRegistryTest` 有六条测试钉住这套语义。

内置 skill 的 `allowed_tools` 是否都是真实工具名，由 `BuiltinSkillsTest` 反射扫
`@Tool` 方法名逐条核对——上面那条「部分写错更阴险」的地雷从此会在 CI 里红。

## 启停存储与过滤

- 存 `system_setting` 表（key/value 键值），值为禁用 id 的 JSON 数组，默认全启用，内存缓存 TTL 5s：插件 `ai.plugins.disabled`（PluginService），skill `ai.skills.disabled`（SkillRegistry）。
- **插件工具的过滤在 ToolRegistry 而非 PluginService**（Phase 3A）：getAllSpecifications / toolNamesLongestFirst / resolve 三处消费点全部隐藏禁用插件的工具；分发前还有 `missingPermissionsForTool` 权限校验。
- skill 过滤在 SkillRouter.match 的 isAvailable 检查。
- **启用插件 = 启用它携带的 skill（dev-board#132，2026-08-23）**：插件携带的 skill 惯例写 `enabled_by_default:false`（插件没装前别出现），于是「装完插件、点了启用，工具注册上了但 skill 仍禁用、对话里触发词永不命中」是第三个看不见的开关。`PluginService.setEnabled(id,true)` 在 `loadJarsIfAbsent` 之后先 `skillRegistry.rescan()` 再 `enableSkillsFromPlugin(id)`（只翻本插件 `sourcePluginId` 命中的 skill，别的插件/内置 skill 不碰）。禁用插件不反向操作——`SkillRegistry.isAvailable` 已按所属插件的启用态兜住。护栏 `PluginServiceTest.enablingPluginEnablesCarriedSkills/disablingPluginLeavesSkillStateAlone`、`SkillRegistryTest.enablingPluginEnablesItsCarriedSkills`。

## 已知地雷

- 新增面板型插件三步缺一不可：leftSidebarPlugins.js 注册 + project-overview.vue 面板区加 v-else-if 分支 + 组件本身；漏第二步就是"加载中..."占位符（股东大会曾长期如此，现已实现）。
- **下线一个面板型插件只删 rail 那一条就够**：`v-else-if` 分支与组件留着不会被渲染（`leftPaneKey` 永远取不到那个值），删了反而让恢复变成重写。股东大会核查就是这么下的。
- **面板不要自画标题**：左栏标题由外壳的 `.sidebar-header` 统一出，面板里再画一份就是同屏出现两次（诉讼可视化/会议录音/股东大会核查都犯过）。面板内部只画分组头，密度用 `App.vue` 的 `--awd-panel-*` 令牌，见 sidebar-shell.md。
- skill 的 allowed_tools 写错工具名不会报错，只是白名单零命中回退不裁剪——排查工具可见性问题时先核对 ToolRegistry 真名。**部分**写错更阴险：剩下的名字还能命中，裁剪照常生效，写错的那个工具就静默消失了。（前提是这个 skill 写了 `tool_policy: restrict`；没写的话 allowed_tools 压根不参与裁剪，写错也毫无症状。）
- `RealToolBeans.instantiateAll()`（评测用的工具 bean 清单）与生产的 `AgentToolComponent` 实现集**不是自动同步的**：`TodoTools` 就不在里面，所以 `todo_write` 在回放评测里根本没注册，评测断言不到它的可见性。新增工具组件时要顺手补进去。
- 插件启停语义只影响可见性，不拦截历史工具调用回放。
- **Web 插件的 `frontendEntry` 校验失败是静默降级**：指到 `web/` 之外或文件不存在时 `PluginService` 把它置空并记 WARN，前端表现为「未配置入口地址」的空面板——面板空白先查后端日志的这条 WARN，别去前端找。
- **`/api/plugin-web` 不要加登录闸**：iframe 是 opaque origin，带不出凭据，加了只会让面板白屏；那里也没有用户数据。禁用/未安装/被封禁一律 404（不是 403，不泄露 id 存在性）。
- 改 AgentOrchestrator 构造器（如注入新服务）必须同步 EvalHarness（踩过两次）。
- **「先落中间态再 `executor.submit`」的服务（会议转写就是），测试里断中间态必须先卡住后台线程**：`save` mock 成原样返回入参时，方法返回的对象与测试持有的是同一个可变实例，后台那个瞬间返回的 mock 会抢先把它改成终态，断言成败取决于 runner 调度（#394 修的就是这个间歇红）。用 `CountDownLatch` 卡住后台调用的那个 mock，断完中间态再 `countDown` 放行。
- SubAgentTools 曾因循环依赖断启动，用 @Lazy 解决（PR#98），插件/工具类注入编排器时注意。

## 宿主 SPI（plugin-api，规范 v2.4，dev-board#109）

JAR 插件拿宿主能力的唯一契约：`com.checkba:plugin-api:1.1.0`（1.0.0 编译的插件照常加载，接口只增不改），源码 `backend/plugin-api/`
（**独立 Maven 工程**，不是 backend 的子模块；backend 以普通依赖引用）。方法表与鉴权/配额规则在
`docs/PLUGIN_SPEC.md` §11，这里只记落点与地雷。

- **先 install 再构建 backend**：`mvn -q -f backend/plugin-api/pom.xml install`。它不在任何远端仓库，
  新机器 / 新 worktree 上 `mvn` backend 报 `Could not resolve com.checkba:plugin-api` 就是漏了这步。
  CI（`ci.yml`）与桌面打包（`desktop-build.yml` 两个平台）都已加这一步。
- 宿主实现：`service/plugin/PluginHostFactory`（按插件 id 缓存 `PluginHost`、持有调用上下文 ThreadLocal、
  集中注入全部宿主服务）、`PluginHostImpl`（八个子接口的内部类）、`PluginHostQuota`（工具线程 60 次/分钟/插件，后台任务线程 1200 次——`PluginHostFactory.bindJob` 标记的 JobContext 期间）、
  `PluginJobService`（后台任务，每插件 2 线程池）+ `PluginJobController`（`/api/plugin-jobs`）+ 实体 `PluginJob`。
- 注入链：`PluginService.loadJar` 实例化后 `injectHostIfAware` → `HostAware.setHost(factory.forPlugin(id))`。
  `PluginService` 经 `ObjectProvider<PluginHostFactory>` 懒取（构造器注入会成启动死环）。
- 调用上下文：`ToolRegistry.execute` 在 `tool.fromPlugin()` 分支 `pluginHostFactory.bindCall(ctx)`，
  finally 里 `clear()`（与 `ToolContextHolder` 同一处）。字段注入 `required=false`——
  `new ToolRegistry(...)` 的测试与 EvalHarness 不受影响；后台任务体由 `Jobs.start` 的包装重新绑定快照。
- `ProjectFileService.ensureFolderPath(projectId, userId, segments)` 是「逐级确保文件夹」的单一出处：
  插件 `Files.createFolderPath`、`FileTools.move_file` 目标目录补建、会议录音目录三处都走它。
- `Settings.projectStyleProfileJson` 当前是 H 的过渡实现（项目 `_模板/画像.json` > SystemSetting
  `dd.styleProfile.default` > classpath `house-default.json`）；单元 I 合并后改调 `StyleProfiles.resolveForProject`。
- **地雷**：`Docs.*` 依赖 `EditorBridgeService` 自己的 ThreadLocal 会话——后台任务线程上是空的，
  `PluginHostImpl` 按 `call().conversationId()` 临时绑定再还原，别绕开它直接调 bridge。
  `Llm.complete` 的温度 / maxTokens 由通道侧模型配置决定（`ChatModelFactory` 给的是预建实例），
  `LlmOptions` 里这两个字段目前是声明性的。
- `PluginJobService.finish` 先更新内存终态再持久化；测试断言终态落库必须等待 repository 保存回执，不能仅等 `status=done`（dev-board#1100）。
- 测试：`PluginJobServiceTest`、`PluginHostImplTest`、`ProjectFileServiceEnsureFolderPathTest`。
  示例：`examples/hello-plugin` 的 `helloListFiles`。

## 验证

- 后端：`cd backend && mvn test`（JDK 21）。
- skill 触发链路：起后端后对话输入触发词验证注入；skill 管理 API `/api/skills/list|{id}/enable|{id}/disable|rescan`（admin）。
- 前端面板：`cd frontend && npm run test:app-e2e` 覆盖主要旅程。

- **`Evidence.linkAtQuote(projectId, docFileId, anchorQuote, targets)`（SPI 1.1.0 新增）**：插件按引文建链的唯一正路。宿主内部走 `EvidenceAnchorService`（查引文必须恰好命中一次 → set_selection → bookmark_selection（书签名 = linkKey）→ 内部超链接 → get_bookmark_context → 落库），与 AI 工具 `doc_link_evidence` **同一份实现**。插件**不要**自己用 `Docs.exec` 拼这套原语——书签名规则、超链接 scheme、章节路径口径都是契约，两份实现必然漂移。

**脱敏/复敏更新（2026-09-10，dev-board#552/#553/#554）**：`SensitiveType` + `service/sensitive/SensitiveTextEngine` 使用本地字段/后缀/号码规则与用户词表；`SensitiveDocx` 以 XML 段落遍历 Word 全部文字节点并保留未命中 run 的格式；PDF 继续不可逆黑框。`SensitiveController` 新增 `POST /preview`、`POST /restore`，`/desensitize` 带 mode 时回 `{file,recoveryKit,counts,warnings}`，未带 mode 的旧调用保留返回 ProjectFile。TOKEN 模式推荐，MASK 为旧星号模式。`SensitiveRecoveryKit` 仅在请求内存中生成/解密映射，密码派生 AES-GCM；加密 `.awd-recovery` 由面板另行下载，不注册进项目。三条端点都鉴权，写操作还需写权限。所有操作不调用 AI/OCR/embedding，skill prompt 明确禁止先把原文读给模型。限制与回归见 `docs/DESENSITIZATION_REVIEW_2026-09-10.md`；`mvn test -Dtest=Sensitive*Test` + `node --test frontend/tests/desensitize/pane.test.mjs`。原介绍中“Word 走 XWPF 段落遮蔽 + OcrService 辅助”已由上述离线 XML 路径替代。


**历史发布整合（2026-09-10，dev-board#585；姓名口径已由 #599 更新）**：脱敏引擎 2.0.0 最终随完整桌面端 0.39.0 交付。当时沿用 #531 的姓名手填整词（每行一个，支持英文公司名里的空格/逗号），旧 customWords JSON 字段由 JsonAlias 兼容。SkillController 对内置 desensitize 返回实际 SensitiveService.VERSION/DESCRIPTION，防止只读 Resources/skills/1.0.0 将补丁引擎误报为旧版；用户自装插件不覆盖。详情页检查更新走工作台 updates 设置标签，不能用重装 skill 文本冒充引擎升级。

## 腾讯会议 CI 契约（dev-board#1129）

- `backend/skills/tencent-meeting/skill.yml` 保留 `restrict`；会议素材读取、纪要产出和任务工具之外，文档基本编辑面同时列 LOWA 与 Office/WPS 对等工具，由 `ClientCapabilityService` 按客户端过滤。`BuiltinSkillsTest.tencentMeetingKeepsEditingToolsForTheCurrentHost` 验证两端可见性，`scripts/check-tool-parity.mjs` 守工具对等。
- `TmeetCliServiceTest` 在 `ProcessBuilder` 边界模拟进程，验证可用/缺失/非零退出/超时及登录状态解析，不依赖机器安装 tmeet 或用户登录；不要把真实账号状态当作单测前提。
- `TencentMeetingRecord` / `TencentMeetingSyncConfig` 的 `@Table` 索引必须用 `user_id` / `start_time` / `project_id` / `record_file_id` 物理列名；`EntityIndexColumnNamingTest` 会实际检查 H2 列与索引，不能只验证 Repository CRUD。
- 验证：JDK 21 下 `cd backend && mvn test -Dtest='TmeetCliServiceTest,TencentMeeting*Test,BuiltinSkillsTest,EntityIndexColumnNamingTest'`；仓库根目录 `node scripts/check-tool-parity.mjs`。

## HR 用工模板包下架（2026-09-15，dev-board#649）

`hr-template-pack` 已从三站注册表下架；`PluginService.isRetired` 在离线扫描与启用判定中拒绝该 ID，`PluginMarketService` 隐藏旧列表并拒绝直接安装。保留插件磁盘文件及用户已创建文书。其他通用插件机制不受影响。上线验证与回退备份位置见 `doc/hr-template-retirement.md`。

## 脱敏面板 v0.44.1 真机三修（引擎 2.2.0）

**C1 两类新内置规则**：`SensitiveType.UNIFIED_SOCIAL_CREDIT`（统一社会信用代码，18 位，
GB 32100-2015 校验码 + 行政区划码；字符集去掉 I/O/S/V/Z）与 `SensitiveType.LAWYER_LICENSE`
（律师执业证号，1 位类别 + 5 或 6 位行政区划 + 4 位年份 + 1 位性质 + 6 位序号 = 17 或 18 位，
用「区划 + 年份 + 性质」三重结构代替校验位）。两者默认勾选——默认清单写在**前端**
`DesensitizePane.fetchOptions`，后端只管把类型放进 `/api/sensitive/options`，加了类型不改前端等于没加。

**C2 `suspects`（形似但校验失败的候选）**：新契约。`SensitiveType.reportsFailedVerification()`
标出四类带确定校验规则的号码（ID_CARD / BANK_CARD / UNIFIED_SOCIAL_CREDIT / LAWYER_LICENSE）；
`SensitiveTextEngine.detect` 把它们的落选候选收进 `failedVerification`，`edits()` 里按 span 去重、
剔掉已被别的规则遮蔽或落在既有编号里的，累加成 `suspects()`。一路经
`SensitiveService.Preview/Result` 与 `/api/sensitive/*` 的 `suspects` 字段到面板，
显示为「另有 N 处疑似证件/卡号未通过校验，未处理」。
**地雷**：姓名/地址的 `isPlausible` 判的是「像不像」而不是「校验对不对」，落选是常态，
绝不能进这个计数——否则每份合同都会报几十处「疑似」，提示立刻变成噪音。
**另一条**：校验不过的号本来就不是有效号码，不许为了「看起来识别到了」去掉校验位闸门
（真机样例 `91370100MA3XK7L92Q` 的 GB 32100 校验位应为 `1`，它是个编造值，
因此落在 suspects 里而不是被遮蔽——这是设计行为，不是漏识别）。

**C3 复敏映射另存为**：文件名由面板给（`kitFileName()`：`<原文件名去扩展名>-复敏-<时间戳>.awd-recovery`，
取的是**原件名**不是生成出来的中性副本名）；默认目录由桌面主进程给
（`desktop/main/recovery-download.js` → `~/Documents/AI WorkDeck 复敏文件/`，
英文界面 `AI WorkDeck Recovery`，不存在就建）。`will-download` 只对 `.awd-recovery` 换
`defaultPath`，其它下载沿用系统默认目录；建目录失败退回裸文件名，不中断下载。
**地雷**：`.awd-recovery` 扩展名是主进程分目录的唯一判据，改文件名模板时别动扩展名。

**B6「浏览」不许静默**：面板没有文件树，`request-file-select` 事件把选择器交给工作台打开。
现在多了**第二个参数 = 同步回执**：`handleDesensitizeSelectFile(callback, ack)` 打开选择器后必须
`ack()`，面板收不到回执就显示 `panels.deBrowseUnavailable`。同时工作台根节点多了
`modal-overlay-open` 类（`modalOverlayOpen` 计算属性：文件选择器/邀请/导出/比对/截图保存/图片预览），
CSS 在弹窗期间把 `.pane-content` 里的 `iframe`/`webview` 置 `visibility: hidden`——
`<webview>` 是独立合成层，HTML 浮层压在它上面的行为不可靠（LibreOfficeEditor.vue 里有同一条说明），
弹窗整个落在文档画布后面就表现为「点了没反应」。**必须用 visibility，不能用 display:none**
（会冻住 LOWA 的 Emscripten/Qt 事件循环，dev-board#539，与 `.libre-standby` 同一套写法）。
`modalOverlayOpen` 刻意不含 `resizing` 与 `showOcrOverlay`（拖拽和 OCR 取词都要看得见画布）。
注意：B6 的真机根因未能在无头环境复现——整条 emit→回执→对话框挂载链路经真渲染用例验证是通的，
所以本轮修的是「没有失败出口」与「浮层压不住原生合成层」这两处，真机复测仍需确认。

验证：`mvn test -Dtest='Sensitive*Test'`（204 项，含新增 `SensitiveCredentialRulesTest`）；
`npm run test:desensitize`（41 项，含新增 `tests/desensitize/credential-rules.test.mjs`）；
`cd desktop && node --test tests/recovery-download.test.js`（7 项，已进 desktop `npm test` 清单）。

## 动态腾讯会议插件授权（dev-board#1495/#1496，2026-10-26）

当前市场插件位于 `official-plugins/tencent-meeting`。opaque iframe 内复制链接先在点击事件中同步执行，并核对复制结果；不可因浏览器提供 Clipboard API 就假设写入成功，也不把短期授权 URL 存入剪贴板历史。授权进程存活时不启动 `--version`、`auth status` 或其他 CLI 命令，以免争用 CLI 凭据锁。宿主内跨插件重扫只共享进程 PID/启动时间；授权 URL 仅保存在原实例内存，新实例不能取消旧授权。前端遇到 pending 恢复轮询并允许继续授权；跨重扫取不回链接时提示回原浏览器完成。验证为插件 Java/前端套件与 `tests/auth-copy-browser.mjs`（真实 Chrome、合成服务和隔离剪贴板）。本契约不保证外部应用同时运行 CLI 的互斥；真实 OAuth 与 Windows 实机需另行验收。

## 内置腾讯会议面板契约（dev-board#1197，2026-10-11）

用户截图对应旧内置TencentMeetingPanel，并非动态market插件。认证POST `/api/tmeet/auth/login-start`，状态字段为loggedIn/userName/cliAvailable；不存在`/auth/login`，错误请求会落到NoResourceFoundException。退出data=false不表示断开。同步POST `/sync` 的projectId/force在query（Controller @RequestParam）；两个AI材料端点minutes-prompt/todos-prompt为POST，取data.prompt字符串。失败不能伪造提示词或成功状态。

面板统一消费awd语义token，搜索宽度100%/控件高度32px、触控至少48px，未知连接组件状态不启用连接。连接组件缺失、配置/列表读取失败有本地可操作说明；公共开关/选择器具可访问名称。验证见frontend/tests/tmeet/tmeet-panel-contract.test.mjs。QA隔离后端实读status/config/list通过；QA未装CLI，未声称完成供应商OAuth与真实同步。

### 项目沟通（dev-board#1250，源码 SDK 1.5.0 / 宿主 0.61.0+）

独立纯 Web 插件在 `official-plugins/project-im/`，构建脚本仅从规范 SDK 复制进 zip，不内置到宿主、不自动上架。固定 `im` 权限和桥入口由 `PluginImController` 验证，`service/im/ImService` 持久化会话/成员/消息/附件；本地通过 `ImGatewayService` 官方账户连接转云端，无密钥下发。`ImProjectFiles` 负责主动归档、附件导入和项目文件快照引用，Git只接收显式写入的普通项目文件及标识 JSON，聊天不自动进Git。

文件权限由 `ProjectFileAccessService` 统一：内部成员默认可读，客户（项目或全局CLIENT）仅自己上传/明确开放文件可读。FileTree单文件“客户访问权限”调用 `/files/{id}/access`。IM快照独立 `fileAccess`；客户无权时返回固定待准备提示并剔除附件元数据。详细契约在 `docs/PLUGIN_SPEC.md §16`。客户不可调用拥有整个项目读能力的律师AI/跨文档分析工具。

回归：`mvn test -Dtest='Im*Test,ProjectFileAccess*Test'`；`node --test official-plugins/project-im/tests/*.mjs frontend/tests/plugin-sdk/im-*.test.mjs frontend/tests/project-home/file-tree-client-access.test.mjs`；`official-plugins/project-im/build.sh`。sandbox 无 allow-modals，应使用插件内 HTML dialog；close() 必须在移除 open 属性前执行。进入 iframe 的父窗口 blur 不代表整个文档失焦，不应清除准备的拖拽票据。

### 律所管理插件与桌面宿主联动（dev-board#1282）

- **官方纯 Web 插件（`official-plugins/lawfirm-management/`）**：包含四主栏（`收案与立项`、`利冲审查中心`、`发票与财务收费`、`决策与业务看板`），走 SDK 桥 `lawfirm.request`（`sdk/plugin-sdk/awd-plugin-sdk.js` 的 `awd.lawfirm.request(action, params)` + `PluginPane.vue` 转发 `POST /api/plugins/{id}/lawfirm`）与事件通道 `lawfirm.navigate`；`manifest.permissions` 声明 `lawfirm`（`PluginService.KNOWN_PERMISSIONS` 校验）。
- **后端领域与法规级利冲引擎**：`LawFirmConflictEngine`（扫描全所在办/历史收案 `LawFirmMatterIntake` 与工作台 `Project`，依据《律师法》第 39/50 条、全国律协《律师执业行为规范》第 50–56 条及《律师服务收费管理办法》第 11–13 条判定 `GREEN`/`YELLOW`/`RED` 风险与风险代理合规预警）、`LawFirmManagementService`（联动 `ImService` 自动创建 `【利冲征询】` 站内信会话与承办律师放行记录 `LawFirmConflictClearance`，全员放行 + 利冲委员终审 `APPROVE_AND_FILE` 后自动建工作台 `Project`；支持数电票/专票普票申请、手动回款核销、用友/金蝶 CSV 台账导出与 ERP 同步确认；按律师个人、主办律师、业务分类等统计维度汇总全所的 Workload 饱和度指数、签约/开票/实收、账单回收率与合同回款率、AR 账龄）、`LawFirmBundledPluginInstaller`（编译期经 `pom.xml` `generate-resources` 打入 `classpath:/bundled-plugins/lawfirm-management/`，支持一键确保安装启用）。
- **宿主联动入口**：个人中心 `AdminPane.vue` 新增 `case_intake`（`components/userprofile/PersonalCaseIntakePanel.vue`，展示五步利冲进展条、待我放行征询与利冲终审、发票与回款台账）；设置页 `TeamPanel.vue` 集成律所业务负荷、创收与回收率决策看板；左栏 `PluginWorkspaceSummary.vue` 与 `config/pluginIcons.js` 提供专属天平图标、实时态势摘要卡与四模块快捷深链。
- **回归**：`JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn test -Dtest=LawFirmWalkthroughTest,PluginServiceTest,PluginDevSdkParityTest,EntityIndexColumnNamingTest`；`bash official-plugins/lawfirm-management/build.sh`；`node --test frontend/tests/lawfirm-management-ui.test.mjs frontend/tests/plugin-sdk/plugin-icons.test.mjs`。

## SDK 1.6 与声明式服务（#1340/#1341，待发版）

Web协议仍为awd:1。新增contributes.views/connections/mcpServers和settings.scope，规范见docs/PLUGIN_SPEC.md §17；SDK源、类型/schema及CLI在sdk/plugin-sdk与scripts/plugin-dev.mjs，官网模板须字节同步。PluginMcpService把审核声明接入ToolRegistry实际工具链；HTTP MCP协议/DNS/取消边界位于service/ai/mcp/PluginMcp*。PluginConnectionService管理固定操作、OAuth PKCE、按用户/账户加密凭据及开发者订阅；PluginDevTrustService的显式开发授权绑定manifest摘要，安装端排除所有来源/信任标记。scope存储使用plugin-user/plugin-project前缀，不能与旧installation的plugin.<id>.<key>混用。新增测试：PluginMcp*、PluginConnection*、PluginDevTrust*及scripts/tests/plugin-dev.test.mjs。


## 插件服务完整验收（2026-10-18，dev-board#1344/#1345/#1346）

`PluginConnectionService` 的 OAuth 桌面回调跟随实际监听端口；server 模式需显式可信 HTTPS `ai.plugins.oauth-redirect-uri`。失效/过期凭据返回 needsReconnect，重连/断连取消旧 HTTP；不回滚远端副作用。连接响应阻止原始 token 直接回显，非通用泄漏检测。`PluginConnectionSettings` 的列表与订阅各自按请求序号拒绝迟到结果；`openExternalUrlChecked` 同时处理 IPC reject 和 `{ok:false}`，避免失败仍报 opened。

平台 billing.status/checkout 未指定 connectionId 时，前端请求须完全省略该 query 键（Uni 会把 undefined 序列化为空字符串，导致后端误选自有连接）；显式连接 ID 原样传递。平台 billing.status 在机器级权限校验后主动刷新权益，并提供 refreshed 标记；失败可保留本账户离线缓存，不能当成新支付确认。结账入口按 SiteProfileService 与界面语言生成。自有订阅仍只有固定状态/结账接口，不是宿主支付处理器。SDK 类型、示例与官网镜像须同步。验证入口与证据边界见 `docs/plugin-services-validation.md`；`PluginServicesFixtureApplication` 只在 test classpath，精确映射合成域名，不得搬入生产或放宽 SSRF。

官方 desktop local-mode 的 ai.request 云调用仍固定当前账户；BYOK 选路集成测试须在服务端模式解释。插件自己的 BYO connections 独立。测试启动器连接恢复应与生产保持一致（不能禁用默认 retryOnConnectionFailure 后把合成服务闲置断连误报为产品故障），并关闭 mobile.relay 后台同步。

## 八项业务插件迁移行为契约（2026-10-23，dev-board#1448）

八项为搜索、语音、脱敏、诉讼可视化、日程、收藏夹、剪贴板、解析依据。迁移前后对照和实际验证边界见 `doc/verification/2026-10-23-plugin-parity-1448.md`。宿主活动标签ID通过 `pluginBusinessActions.activeFileId` 供脱敏使用，不等同只允许LOWA的 `getPluginActiveEditor`；归属继续由业务服务查当前项目。依据打开文件走 `insightOpenDoc → openInsightDocFile` 保留右窗行为，项目审查标准不依赖活动文档，坐标只接受编辑器已换算的宿主坐标。

`awd:litviz-restyled` 成功信号按项目转 `files.changed`；顶部 `awd:meeting-recording-stopped` 转权限为speech的空 `speech.stopped`，iframe再唤醒原面板列表监听。绘图换风格等待保存也要纳入try/catch，取消时向原项目发结束信号释放保存屏障。脱敏原API为300000ms，适配器和SDK上限一致，SDK默认仍60000ms。录音停止可等待用户确认付费转写，超出单次RPC时继续查询真实状态；宿主按项目和meetingId保存原停止结果（包括失败时null），不能再次stop或把旧结果当新结果。

日程读取完整目录元数据，不能用SDK对外扁平文件投影；更新时可保留已验证原事项中的软删关联，新关联仍查可见文件。插件TaskDialog在窄iframe中滚动/换行，遮罩低于Uni确认框；动态引用图标必须构建期导入，不能请求后端根/static。随附UI修复必须同步构建并提高插件版本，`PluginBundledInstaller` 仅升级更高版本且带 `.awd-bundled` 的安装，不覆盖独立市场安装或用户卸载记录。

### 主题画廊分发与语言（dev-board#1527）

三主题 1.0.2 的 `web/index.html` 使用包内相对 SDK、gallery runtime 与生成的 20 语词典；`official-plugins/build-theme-plugins.sh` 从 canonical SDK 和各包 l10n 重建、打 ZIP，禁止引用不存在的 `/api/plugins/sdk/awd-plugin-sdk.js`。真实静态路由是 `/api/plugin-web/{id}/**`。宿主 0.72.1 的 MarketDetailPane/PluginPane 通过既有 theme 消息携带当前应用 language，监听 APP_LANGUAGE_EVENT 并卸载清理；PluginPane 初次 init.context.language 保持原契约。0.72.0 预览缺语言时明确以 en-US 回退，不能用 navigator 冒充应用偏好。iframe 保持 opaque origin，语言/主题消息只接受 parent。Node 渲染回归见 theme-gallery.test.mjs；浏览器脚本必须连接真实隔离后端，不能伪造 SDK 路由。浏览器受宿主禁用时只报告 HTTP/Node 验证，不称 UI 实测。
