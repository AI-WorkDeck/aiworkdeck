# Word Office/WPS 插件对齐记录（2026-10-28）

本记录区分源码契约、对象模型回归和原生宿主实测。本分工没有操作 GUI；下面 Node 测试是 mock，不是 Word/WPS 真机证据。整体任务的原生验收由主任务另记，不能用本文件替代。

## 修复前后

之前 Word 修复建立了精确锚点、中文/英文最小修订、WPS 表格结束符坐标换算、隐藏标记 Find 回退、右到左批量改写、修订开关保存恢复、正文分页和超长查找处理。这次保留这些路径，不重写整段来实现第 N 处修改。

- WPS `insert_image` 原来无条件拒绝。现在验证不超过 2 MiB 的 PNG/JPEG/GIF/BMP 字节，检查原生文件系统及 InlineShapes 能力，将字节写入随机临时文件并读回核对，使用 `AddPicture(path,false,true,range)` 嵌入，再清理文件。带锚点时使用折叠范围，避免图片替换定位文字；无锚点采用当前真实选区，和 Office 插图语义一致。设置宽度失败可能已插入，返回本地化部分失败提示，禁止声称未修改。
- 新增 `get_paragraphs` 原生结构分页（0 起始 index、headingLevel、numbering），保留原 `get_text` 字符分页契约。两个宿主限制12000段、单段8万字符；完整结构扫描与backend跨页审计限制200万字符。分页只读取当前页的原生段落内容，结构命令超时120秒；超限拒绝，不返回看似完整的部分结构。
- 新增 `get_outline`，从原生标题样式/大纲级别读取，不以“第 X 条”文字冒充标题。
- 新增 `get_clauses`，沿用桌面 get_clauses 的编号识别与粒度选择，自动编号标签与正文组合识别；最多返回 300 条目录，保留完整 totalClauseCount 和 nextStartParagraph。
- 新增 `replace_nth_match`，模型和两个插件端均为 1 基序号，先定位核验后修改，继续使用原生修订及最小修改。其他重复文本保留；非法序号、跨段查询在写前拒绝。
- 新增 backend `office_audit_structure`，分页取得真实段落后复用 `ContractStructureAudit`，不是新写一个简化审计。分页不前进/未完整结束则拒绝生成审计结论。宿主修订只有摘要，报告明确大段删除审计可能不完整。
- `office_apply_style_profile` 后端复用项目 StyleProfileResolver，包含 document/selection/styles-only 参数；原生写入模块由并行分工补齐，最终以该模块及专项测试记录为准。跨文档执行在服务端与插件端均拒绝：修改样式定义不能被伪标成可拒绝修订。WPS画像模块已补默认合并画像中的表格、目录标题样式及表后段落规则：Normal/Heading1–6与表格段落样式定义、字号/行距/段距/分类对齐/重复表头/单线边框/垂直对齐、表后18pt、TOC Heading定义。专项11/11通过（`/tmp/word-style-profile-tests.log`），仍未原生验证。Office公共API无法无损表达默认画像的atLeast等属性，默认完整画像写前明确拒绝；不得称Office画像全部可用。

## 编辑能力矩阵

| 桌面能力 | Office Word | WPS 文字 | 语义/验证边界 |
|---|---|---|---|
| 正文、选区、查找 | 已有 | 已有 | 正文字符分页；新增原生段落分页，不能混用两类游标 |
| 精确替换、插入、批量最小修订 | 已有 | 已有 | 跨段查询明确拒绝；WPS 坐标校验失败用严格 Find |
| 第 N 处替换/删除 | 本次新增 | 本次新增 | 1 基；空替换为删除；原生修订视图下的已删除文本枚举仍需真机检查 |
| 字符、段落、标题、编号、样式、标准格式 | 已有 | 已有 | Office 旧标准格式返回 lineSpacingMode=exact，WPS 支持 atLeast，不能称完全相同 |
| 模板画像 | 本次接入 | 本次接入 | 与标准格式区分，详见 wordStyleProfile 模块及其验证 |
| 大纲、自动编号条款、机械审计 | 本次新增 | 本次新增 | 不再把普通文本分页当结构接口；WPS 无 ListFormat 时 numbering.available=false |
| 表格读取/写格/增删行列/格式 | 已有 | 已有 | 合并单元格与宿主集合语义需原生文件回归 |
| 分页分节、超链接、页眉页脚、目录、页面设置 | 已有 | 已有 | 目录是真目录域；WPS TablesOfContents.Add 历史代码明确尚未真机验证 |
| 脚注、尾注 | 已有 | 已有 | 依赖对应宿主 API |
| 图片 | 已有 | 本次补齐 | 本次 WPS 仅上述4类签名字节；不支持时写前拒绝；嵌入及重开待原生验证 |
| 批注增读回解删 | 已有 | 已有 | WPS Replies 不可用时追加到原批注，返回 via=appendText，非原生线程回复 |
| 修订读取/接受/拒绝/全部处理 | 已有 | 已有 | acceptAll/rejectAll 已覆盖全部处理；原 parity LOWA_ONLY 分类不能证明插件缺失 |
| 原生文件新建/打开/保存/PDF导出 | 独立文件模块 | 独立文件模块 | 详见 file-parity-audit；跨文档身份锁和旧会话防误写另有回归 |
| worker撤销、检查点、流状态 | 宿主差异 | 宿主差异 | 没有桌面 worker 检查点，不伪造同义操作 |
| 任意光标/anchorId/段落范围编辑 | 以精确锚点为主 | 以精确锚点为主 | 当前并未新增整个LOWA selection API；不能称所有低层接口一一复制 |

## 可复现验证

```sh
node --test office-addin/taskpane/lib/wpsWordHandlers.test.js
node --test office-addin/taskpane/lib/wordStructure.test.js
cd office-addin && npm test
```

当前Word handler专项76/76、结构专项6/6（合计82/82），跨文档专项29/29；原生对象模型分页负对照1000段取2段只读取2段内容。日志 `/tmp/word-addin-parity-tests.log`、`/tmp/word-structure-tests.log`。后端 `OfficeWordStructureTest` 使用 JDK21 targeted Maven 4/4通过，日志 `/tmp/word-backend-structure.log`；此时插件全套763/763通过 `/tmp/word-addin-full.log`（后续新增及分页优化专项另验82/82，跨文档29/29）。

负对照覆盖：图片非法字节/尺寸/位置、缺少宿主写入能力、落盘读回损坏都不插图；图片原生插入/尺寸设置失败清理临时源并恢复修订；第二处重复文字仅修改第二处，非法序号不修改；300 条目录截断保留完整总数；结构按自动编号识别而非依赖正文含编号；Excel 宿主拒绝 Word 新命令。

## 官方依据与未验证项

- [WPS InlineShapes.AddPicture](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/wps/InlineShapes/member/AddPicture)：文件路径、链接/嵌入、Range 插入或替换语义。
- [Microsoft Word.ListItem](https://learn.microsoft.com/en-us/javascript/api/word/word.listitem?view=word-js-preview)：listString 为可见自动编号标签，WordApi 1.3。
- [Microsoft Word.Paragraph](https://learn.microsoft.com/en-us/javascript/api/word/word.paragraph?view=office-js)：styleBuiltIn、listItem 与段落格式接口。

这些文档是接口依据，不能替代实际宿主运行。待原生核验：Office/WPS 两端自动编号与嵌套表格的段落序号、修订显示状态下第 N 处匹配、图片可见且保存重开后仍嵌入、WPS 二进制 FileSystem 及嵌入后临时源删除、模板样式定义持久化、图文/目录/页眉页脚/脚尾注与批注线程的保存重开。现有源码仍有较早硬编码中文提示，本次新增用户可见错误和工具显示采用语言令牌/LangText；本文件不据此声称旧文案已全部治理。

最终后端补验：JDK21 `mvn -q -Dtest=OfficeWordStructureTest,OfficeBridgeServiceTest,OfficeBridgeCrossPaneTest test`，21/21通过，日志 `/tmp/word-backend-final.log`。覆盖新增有限超时、画像跨文档拒绝、审计分页和原有桥接结果回传。

原生Word验收脚本已准备：`/tmp/awd-native-word-ppt-qa-20261028/word-qa.js`，仅允许精确合成文件名，真实hostBridge、独立Office对象模型读回、保存以及重开后的独立入口，逐步回执到`/qa-evidence`。本分工只做语法检查，实际运行结果由主任务记录。

原生Word第一轮（主任务操作）已回执：结构/条款/分页、第二处替换、原处格式保留、表格B2、插图、批注、修订及独立读回通过；默认画像负例后的全OOXML字节比较失败，尚不能据此称保存重开完成。发现handler在纯画像预检前开启/恢复修订模式，已把validateWordStyleProfile前置到Word.run之前，新增零Word.run回归。`resumeWordQA`先做两次只读对照，记录完整前后XML及首个具体差异，只规范化XML属性顺序和Flat OPC命名part集合顺序；内容/格式/修订/settings等语义差异全部保留且遇差异停止。续跑完成保存和重开仍待主任务记录。

第二轮只读控制定位到35处序列化差异：13个`w:rsidR`、10个`w:rsidRDefault`、1个`w:rsidSect`组成两组一致ID重命名；`settings/w:rsids`相应替换2个ID并重排（按位置显示10处差异）；最后一个无内容、无引用的附加空段`w14:paraId`改变1处。对象模型快照完全相同，其他XML节点/属性/文字无差异，完整枚举 `/tmp/word-control-differences.json`。据此仅将两组导出会话ID归一为保留跨part引用关系的token、将rsids目录按值排序（保留稳定ID与rsidRoot）、将无内容且未被引用的末尾空段ID归一；不删除全体rsid或paraId。真实前后XML离线使用harness原函数比较通过，6个负对照（正文、字体色、真实段落ID、稳定历史ID、插入修订、表格值）均拒绝，脚本`/tmp/word-native-normalization-test.cjs`。这说明读回内容语义一致，不声称两次OOXML字节相同，也不推断Word内部实现细节。

字段依据：[Microsoft Rsid](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.rsid?view=openxml-3.0.1)说明编辑会话标识及同值关联；[Microsoft paraId规范](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/a0e7d2e2-2246-44c6-96e8-1cf009823615)说明段落身份。实际放宽仅来自上述本机只读控制证据，仍保留原始差异，保存/重开结果待主任务续跑回执。

## 最终原生 Word 保存、关闭重开与落盘交叉核验

本节替代上文时间点上的“待保存/重开”状态。主任务在真实 Microsoft Word 中操作 UI 关闭后，从最近文件重新打开同一合成文件；本分工没有操作 UI，独立读取其真实 Office.js 回执和保存的 DOCX ZIP/XML 交叉核验。

- 真 `file_save` 成功；保存后快照时间 `2026-10-28T08:33:05.790Z`（北京时间/新加坡时间16:33:05）。重开后 `readback-after-reopen` 为 `2026-10-28T08:34:12.839Z`，passed=true。两份原生对象模型快照除导出OOXML字节外完全一致，修订模式均为Off。
- 落盘文件：`/tmp/awd-native-word-ppt-qa-20261028/AWD-Native-QA-20261028.docx`，33150字节，SHA256 `c879fb29d1aac8ac40b46a1f6ee380cf2b054c63724576050aa83b584af3d1f3`。
- 精确替换：排除`w:del`后当前段落严格等于`第1条 Payment: 100 USD. Payment: 125 USD.`。原生搜索也分别只有1个旧文本和1个新文本，没有误改第一处。
- 混合格式：第一处`Payment: 100 USD.`的`w:rPr`保留`w:b`和颜色`0055AA`；替换后的`125`没有新增直接格式，未把第一处的加粗蓝色扩散过去。原生读回第一处bold=true、color=#0055AA、size=11。主标题样式仍关联到outlineLvl=0的Heading1定义。
- 表格仍为2×2：`Item / Amount`、`Service / 125`，没有破坏非目标单元格。
- 图片确实嵌入DOCX的`word/media/image1.png`，与本次合成红PNG逐字节相同，SHA256 `bf02d5e37dc24012de4bc265745100ffdb7856d90eb3ed0867a64b37a3a49650`。关系为内部media路径，没有外链；宽高均304800 EMU=24pt，原生重开读回也为24×24pt。
- 批注正文`QA1576 review amount`和commentRangeStart/End/reference完整，锚点严格为`Payment: 125 USD.`。
- 修订仍保留：3个`w:ins`、2个`w:del`、1个`w:rPrChange`；两个删除修订分别保存原金额`100`（正文第二处与表格B2）。未把原生修订接受或丢弃。
- 默认Office HOUSE画像负例仍明确拒绝；前后完整XML按上文受控归一后的语义差异为null，原生对象模型差异为null。此项验证的是“不支持时不修改”，不代表Office能应用完整HOUSE画像。

独立核验摘要 `/tmp/word-docx-final-verification.json`，完整原生回执 `/tmp/awd-native-excel-qa-20261028/native-evidence.jsonl`。`readWordQA`面板返回已缩为表格、图片、批注、匹配计数和保留格式的摘要；完整约390KB OOXML继续写入本地回执，不再渲染在UI。

本次原生Word实测覆盖以上具体行为；WPS原生文字、目录/脚尾注/复杂页眉页脚、WPS模板画像保存重开等未因此自动变成已验证。Office默认画像的API差异继续保留明确边界。

## 对拍例外理由的语义纠正（交付复核）

`scripts/check-tool-parity.mjs` 通过仅说明工具已配对或分类，不证明每个参数、定位方式与宿主能力等价。以下语义纠正已同步到 `LOWA_ONLY` 分类说明，只拆分理由分组、未增加工具或改变handler。对拍复跑仍为89项配对能力、214个已分类工具、13个skill白名单对称，未以文案调整增加能力统计。

| 桌面工具 / 分类 | 准确的插件对应或限制 | 不应采用的概括 |
|---|---|---|
| `doc_accept_all_revisions` / `doc_reject_all_revisions` | 已由 `office_accept_revision(acceptAll=true)` / `office_reject_revision(rejectAll=true)`表达全量动作；Office版本门槛及WPS实现以实际handler为准。这是合并到既有工具参数，不是撤销能力缺失。 | 不能因与undo/checkpoint列在同组便称插件不支持接受/拒绝全部修订。全量动作本轮未作原生保存重开专项。 |
| `doc_undo` / `doc_redo` / checkpoint / stream | 桌面引擎历史与检查点机制不同于原生文档修订；Office公开撤销栈不能据此假定可控，WPS能力须单独核验。 | 不得把“Office.js未提供”自动套到WPS，也不能把接受修订当undo。 |
| `doc_get_paragraph` / `doc_modify_paragraph` / `doc_insert_under_heading` | 新 `office_get_paragraphs` 返回当前文档快照中的0基段落序号；编辑后会漂移，序号不是稳定ID。可分页取得指定段落内容，但不能据此承诺按旧序号精准写入。标题下插入须独立解析标题/锚点并核验当前上下文。 | “插件没有段落号”已过时；“字符分页等价按段读取/修改”也不成立。 |
| `doc_replace_at_anchor` | 桌面anchorId来自桌面查找定位；插件文字锚点/当前匹配序号不复用该ID。应重新读取当前宿主并校验目标，不能把跨宿主ID直接传递。 | replaceAll不能替代稳定锚点的单处定位。 |
| `doc_delete_match` | 本轮 `office_replace_nth_match(findText,matchIndex,replaceText='')`可表达1基第N处删除；仍需注意修订显示视图中的匹配枚举差别。 | 不能用replaceAll删除所有重复文本来冒充第N处删除。 |
| `doc_delete_text` | `office_replace_text`的空替换可表达其明确指定的首处/全部匹配语义；必须保持用户选择，不自动扩大为全部。 | 批量工具存在并不意味着任意定位语义相同。 |

当前真实Word证据见本文“最终原生Word保存、关闭重开与落盘交叉核验”，文件操作见[文件能力审计](2026-10-28-file-parity-audit.md)。验收中第2处金额替换、其他同文位置不变且修订保留已证实；全量接受/拒绝修订、跨编辑稳定段落定位、任意标题下插入不在该通过结论中。

## 仍需区分的未验证项目

- WPS文字/ET/WPP原生JS加载项的创建、编辑、保存重开、临时副本、PDF上传，以及WPS图片与完整模板画像；准备安装包不等于运行。
- 双窗口旧pane在create/open后继续存活的真实重绑定行为、PDF上传失败后的真实partialResult回传、WPS大PDF读取内存边界。
- Office复杂目录、页眉页脚、脚尾注、合并PPT表格边框与宽版本覆盖；当前明确拒绝的能力不能称全面支持。
- 本轮真实模型仅覆盖隔离面板的Excel路径；不证明产品账户鉴权、聊天流、模型驱动Word/PPT/WPS的完整端到端。
- 桌面最新数组公式修复的GUI复测由主任务执行，必须以其最新回执更新，不用旧测试替代。
