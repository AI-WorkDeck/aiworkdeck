<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Excel 桌面编辑与持久化验收（2026-10-28）

范围：dev-board#1576，分支 `codex/excel-office-parity-1576`。本记录是 LOWA 原语层验收，全部采用测试脚本构造的合成工作簿，不含客户文件。完整产品 Agent、自动保存和 Office/WPS 宿主另行验收，不能由本记录代替。

## 历史修复的启示

[Word 稳定性记录](2026-10-10-desktop-word-stability.md)记载：旧路径逐段写入使大段粘贴缓慢，批量锁修复将单样本 13,749ms 降至 313ms；保存流程随后验证延迟、失败重试、dirty 保留及关闭重开全文一致。这些是历史实测，不是本轮重新测出的性能数字。对 Excel 的对应要求是先校验整批输入，可靠释放锁，保留失败状态，并检查原生文件重开后的内容。

[PPT 质量记录](2026-10-28-ppt-quality.md)记载：插页已产生副作用却回报失败，导致反复重试造出多页；插入语义、局部替换和部分完成回执修复后，又通过真实引擎及产品成品发现标题、格式与几何问题。Excel 同样不能仅检查 success：图表方向与标题、验证规则、批注均需检查保存后的真实对象；已创建图表但配置失败必须返回部分完成，禁止盲目重建。

## 本轮修复及直接证据

| 修复前 | 修复后及验证 |
|---|---|
| 范围读回只带前 100 条公式 | 已返回范围内全部公式；150 个公式单元格单测和真实引擎断言 |
| 写入后面的非法行/值可能在前面已写后才失败 | 整批标量、起点及工作表边界先验证；运行时异常回报 cellsWritten 和 retryable=false |
| 引号内工作表名的逗号、感叹号被当公式分隔符改写 | 保留引号及转义；`'Cost, net!'!A1` 计算为 17，保存重开仍为 17；名称引用亦正确引用该表 |
| UNO 直接写入可绕过表保护 | 锁定目标在写前拒绝；格式、排序、图表等破坏性操作拒绝受保护表；真实引擎检查 A1 未变化 |
| column/bar 方向映射相反，标题调用不存在的方法 | 使用 UNO Vertical 正确语义和 ChartTitle.String；四种图表导出 XML 与重开画面核验；配置失败返回 created=true 的部分回执 |
| 验证规则的 Formula1/Operator 属性写法未生效 | 使用 XSheetCondition 方法；导出 XML 核对列表 Yes,No 和整数上下界 1、10 |
| 导入 XLSX 的批注 getString 暂为空 | 读取懒加载 annotation shape；重开后 Evidence 原文可读，超长批注明示截断 |
| 非法搜索范围可能扩大到整张表 | 显式错误范围直接拒绝，不改变扫描范围 |
| select 仅改选区，视图没有滚动 | XViewPane 滚到目标并返回 visibleRange；重开后 A23/A45/A67 分别显示条形、折线和饼图 |

写入数字字符串的既有公开语义未更改。格式继承在受保护表上禁用，避免触及其他锁定单元格。其他格式保护不等于任意操作事务化；运行时失败可能仍有已完成部分，回执如实保留。

## 可复现命令

在项目根目录运行。需要既有 frontend Node 依赖及真实 LOWA 引擎；以下引擎位置是本机只读复用目录，不会覆盖其他工作树产物。可换成自己安装的 LOWA 路径。

```sh
node --test frontend/tests/lowa-unit/*.test.mjs
npm --prefix frontend run build:zetaoffice -- --outDir /tmp/excel-1576-engine-dist
LOWA_DIST_DIR=/tmp/excel-1576-engine-dist LOWA_ENGINE_DIR='/Users/zewei/.codex/worktrees/ppt-edit-quality-1570/1-2 checkba_cloud/frontend/dist/zetaoffice/lowa' LOWA_E2E_PORT=8917 node frontend/tests/lowa-e2e/sheet-precision.mjs
LOWA_DIST_DIR=/tmp/excel-1576-engine-dist LOWA_ENGINE_DIR='/Users/zewei/.codex/worktrees/ppt-edit-quality-1570/1-2 checkba_cloud/frontend/dist/zetaoffice/lowa' LOWA_E2E_PORT=8918 node frontend/tests/lowa-e2e/run.mjs
```

负对照使用修复前 worker：`SHEET_WORKER_SOURCE=/tmp/excel-worker-before-1576.js node --test frontend/tests/lowa-unit/sheet-precision.test.mjs`。实际负对照运行时为最初八项测试，8 失败、0 通过；日志 `/tmp/excel-1576-negative.log`，包括公式 100≠150、写前校验、部分完成、引用、图表、验证、批注和错误范围。后来新增保护与视图定位两项，不计入这次负对照数字。旧 worker 是本机快照，不提交进仓库；复现时须提供对应修复前源码。

## 结果、时间边界与产物

2026-10-28 本机日志完成时间（Asia/Singapore）：

- 14:53:06，`/tmp/excel-1576-full-regression.log`：真实 LOWA 全套 **607 通过、0 失败**。发生在最后的视图滚动补丁之前，不能声称 607 覆盖该补丁。
- 14:54:18，`/tmp/excel-1576-unit-final.log`：LOWA 单测 **255 通过、0 失败**，含 Excel 专项 10 项及视图滚动补丁。
- 14:55:14，`/tmp/excel-1576-e2e-final.log`：最终 Excel 专项真实引擎通过，含重开后的 visibleRange 断言。

专项还覆盖透视表 A=400/B=200/总计600、条件格式、自动筛选、冻结、分组隐藏/显示、名称、保护、行列插删、排序、合并/拆分、字体颜色、边框与行高列宽。首次导出直接检查 XLSX XML 的图表类型/标题/数据、验证、条件格式、分组、筛选、冻结、保护及透视表部件。重开实际检查公式结果、透视表结果、批注、名称与图表画面；随后第二次导出。这不是对第二次导出全部 XML 的逐字段比对，也不是所有能力的排列组合测试。

本机合成产物 `/tmp/excel-1576-evidence/`：`precision.xlsx`、`reopened.xlsx`、`precision.pdf`、`results.json`、`reopened.png`，以及 `column-reopened.png`、`bar-reopened.png`、`line-reopened.png`、`pie-reopened.png`。四种图表实际图片已逐张查看，标题和 100/200/300 数据正确；最终截图确实滚动到不同位置。PDF 导出成功并渲染查看，但默认打印分页会分割图表，不能宣称打印排版合格。该目录是临时验收产物，长期保留由交付任务归档。

## 未验证与保留边界

- 未在本专项中运行完整产品 AI 编排、正常自动保存/关闭流程、正式安装包、Windows 或实际 Office/WPS 加载项。真实引擎测试直接调用产品编辑器原语，并非模拟 UNO，但仍不是完整产品链路。
- 未验证任意复杂 XLSX、宏、外部数据源、全部图表类型、全部透视表聚合组合、公式函数覆盖率及打印布局。
- 排序核心缺陷已在下述追加专项修复；外部公式按宿主默认配置保留坐标引用，不承诺自动跟随原记录，也不承诺所有复杂对象/合并区域的排序组合均已验证。
- 数组常量的行列分隔差异已在下述追加专项修复，交集语法等仍有跨引擎差异，不宣称完整 Excel 公式解析器。
- 本记录由实现与验收的同一子代理撰写，不冒称第二位审核者独立复现。主任务须核对 diff、日志与完整产品结果后整合。

## 后续插件独立复核与修复

桌面专项完成后，对 Office/WPS Excel handlers 的最新差异另作源码复核。矩阵已验证所有行同宽、标量类型和有限数字；单格起点展开、多格目标尺寸严格匹配。公式通道保留宿主原生英文公式，不将 LOWA 分隔符转换套到 Office/WPS。

发现读取/搜索仅限行，最宽 16,384 列仍能产生数千万单元格跨桥传输；补充两维总量上限 50,000 格，保留全部列并裁剪完整行，返回 `truncated` 及 `returnedRows`/`scannedRows`。查找替换超过该总量在读取值与修改之前拒绝，要求缩小范围。另发现图表已创建后配置失败缺少清理：现只删除本次新建图表，删除成功后保留原始失败；删除失败则明确提示图表可能已创建、不能盲目重试。此错误仍通过现有宿主错误通道返回，不伪造成功。

验证：`node --test office-addin/taskpane/lib/excelFormatHosts.test.js office-addin/taskpane/lib/wpsEtHandlers.test.js`，87/87（`/tmp/excel-1576-plugin-final.log`）；`npm --prefix office-addin test`，725/725（`/tmp/excel-1576-addin-all.log`）。新增测试覆盖 5000×16384 极宽范围在宿主读取前收缩为3行、替换写前拒绝、图表配置失败仅删除新增对象以及删除失败的明确错误。全套通过后进一步收紧替换测试的错误文案断言，并重新运行87项通过。这些是模拟 Office/WPS API 行为测试，不能称为实际宿主验证；多语种词条和最终全仓检查由整合任务完成。

## 主任务完整桌面窗口验收（追加）

隔离 Electron 产品实例 `/tmp/awd-ppt-live-Fwf0ze`，独立 HOME/H2/存储，前端来自本工作树。worker SHA-256 `ca7cffde6bf6a40a02d2cdbf6ec0fe257f823143c674d68c1237bd947932468e` 与当时源码一致。开发壳复制为独立应用标识以避免多 Electron 窗口混淆；不是发布包。用户协助关闭首次组件提示，之后文件夹打开与全部编辑均由主任务通过原生界面执行。系统单文件选择框曾显示选中 XLSX 但打开按钮不可用；改用正常“打开文件夹”成功，尚不能断言该系统对话框行为的根因。

实际打开合成 `precision.xlsx`，名称框定位 C1，公式栏显示含逗号和感叹号的跨表引用。通过公式栏给 D5 写入 `=SUM(B2:B4)`；等待产品“已保存”，直接检查项目原文件 XML：公式为 SUM(B2:B4)，计算缓存600。再将 B2 从100改150，正常自动保存后该值150、D5公式仍在且缓存650，四个图表部件仍在。全程没有触发手动/强制保存。

通过产品“关闭标签”真正关闭工作簿，再从资源管理器打开；B2=150，D5公式仍可读。名称框分别定位 A1/A23/A45/A67，实际画面逐一检查柱状图、条形图、折线图与饼图：标题保留，柱状图第一根已更新150，其余图表独立数据100/200/300正确。关闭AI侧栏后观察到完整图形；条件格式红底、冻结首行、分组、批注标记仍显示。透视表重新打开后汇总A450/B200/总计650。

再切到 `Cost, net!`，把A1由17改23，等待正常自动保存；切回Sheet1 C1公式文本保持、实际单元格显示23。文件快照在 `/tmp/excel-1576-product-evidence/desktop-autosaved.xlsx`；窗口截图记录在本会话工具输出。此追加证明真实桌面UI和自动保存重开，不等于已经运行真实模型对话。

本轮界面走查发现公式确认按钮标题显示未解析的 `editor.toolbar.apply`，已改用既有20语言 `common.confirm`，刷新后标题正确显示“确定”。


## 桌面排序追加修复与真实引擎验收

本轮再次检查核心Excel能力时，发现早先普通值排序用例不足以覆盖公式和格式。独立专项先运行旧实现：在非A1的 `C1:E4` 中设置表头、三条记录、行内公式和红/绿/蓝不同底色及粗体；按C列升序后，旧实现虽返回success，公式结果实际为400/900/100，正确应为200/600/300。公式文本仍指向移动前的D3/D4/D2。负对照日志 `/tmp/excel-sort-negative.log`，文件 `/tmp/excel-1576-sort/before.xlsx` 与 `after.xlsx` 保留；这是实际LOWA引擎运行，不是mock推演。

修复限于 `sheet_sort_range`：移除JS读值重写，采用原生Calc `.uno:DataSort`，由引擎移动内容、字体底色和重定位行内公式。直接 `XSortable.createSortDescriptor()` 在此WASM报未注册UNO类型，故使用官方标量调度路径，避免未预编译的TableSortField序列。`Col1`为绝对1开始列号，`IncludeAttribs=true`，并显式设置表头、升降序、其他字段关闭与不使用自定义顺序。官方契约见 [scalc.sdi](https://github.com/LibreOffice/core/blob/master/sc/sdi/scalc.sdi) 和 [cellsh2.cxx 的 SID_SORT](https://github.com/LibreOffice/core/blob/master/sc/source/ui/view/cellsh2.cxx)。单行/单格无事可排时直接no-op，避免引擎扩大选区。原有保护与5000格上限保留。

```sh
node --test frontend/tests/lowa-unit/sheet-sort.test.mjs
LOWA_DIST_DIR=/tmp/excel-1576-engine-dist LOWA_ENGINE_DIR='/Users/zewei/.codex/worktrees/ppt-edit-quality-1570/1-2 checkba_cloud/frontend/dist/zetaoffice/lowa' LOWA_E2E_PORT=8927 node frontend/tests/lowa-e2e/sheet-sort.mjs
```

`sheet-sort.mjs` 经测试服务内存加载当前worker源码，不改共享构建目录。可用 `SHEET_SORT_WORKER=/path/to/old-office_thread.js` 重放旧源码负对照，用 `SHEET_SORT_EVIDENCE` 指定产物目录。需先准备命令所指编辑器构建与引擎；不能以测试缺少依赖或未启动当通过。

2026-10-28 15:20:37 +08:00 的最终 `/tmp/excel-sort-final.log` 记录真实引擎通过；独立单元测试5/5通过。实测范围：

- 非A1范围C1:E4，保留表头，升序后记录及计算值为 `[1,10,200] / [2,20,600] / [3,30,300]`，公式为D2×20、D3×30、D4×10。
- 原范围外 `H1=D2` 公式文本保留，原生默认策略使结果随D2当前值变为10；未擅自改变宿主“外部引用是否跟随排序”的配置。
- 红/绿/蓝底色与字体/粗体随记录移动；比较导出XML中解析后的字体和填充语义，不把重新编号的样式ID当成格式变化。
- 导出xlsx→真实引擎重载→再次导出后，值、公式、字体与底色均保持；重载可能补入默认charset，验收不把这种无关序列化差异当错误。
- 单格C2排序不会扩大到邻表；C2:E4无表头降序仍得300/600/200的正确结果。

产物 `/tmp/excel-1576-sort-final/` 包含 `before.xlsx`、`after.xlsx`、`reopened.xlsx`、`after.json` 和 `result.json`。语法检查及本次差异检查通过。上述记录为实现者自行验证，须由主任务核对；早先607项全套LOWA回归发生在排序补丁之前，不能将该数字视为此补丁的回归证据。此专项通过产品编辑器executor调用真实UNO，但未另做排序后的完整模型对话、正式安装包或Office/WPS真机验收。

## 主任务排序与 Word 桌面交叉复测（15:28 +08:00）

将最终排序 worker 更新到隔离实例后，真实窗口打开负对照 before.xlsx 的副本 sort-regression.xlsx，名称框选 C1:E4，经工具栏数据菜单执行升序。等待正常“已保存”，原项目文件的 C2:C4 为1/2/3，E2:E4分别为D2*20、D3*30、D4*10，计算缓存200/600/300。关闭标签并从资源树重开，实际画面保留绿/蓝/红随行底色和粗体；名称框选E2，公式栏显示=D2*20。截图保存在会话工具输出，实际保存文件另存于本机验收目录。该UI检查与排序专项相互独立，不仅依据子代理报告。

交叉检查Word：通过正文输入区向合成word-regression.docx输入“QA1576 desktop save reopen”，观察正常自动保存，原文件document.xml包含标记；关闭标签并重新打开，实际正文画面显示该标记，原有表格和标题样式仍在。离线打开Word期间出现AI登录提示，关闭后可继续本地编辑，尚未调查提示触发原因。

最终前端单元282项、插件742项通过；20语言门禁与工具两族对拍通过。后端全量7498项最初3失败：2项操作抽取测试未兼容新增helper，已修正测试；1项监听器并发启动时序断言在负载下失败，未改业务代码。JDK21重跑相关7个测试类全通过，不能称首次全量全绿。

PPT共享路径交叉复测：打开三页合成样本，双击首页标题文本并追加QA1576，实际切换第2页（表格正文）和第3页。等待正常已保存后，原PPTX XML保留原标题并含新增标记；关闭重开，实际首页显示完整原标题和QA1576，三页缩略图保留。PDF通过本产品Chromium内置预览打开11页合成文件，首屏图表可见，页码导航到11成功；此路径没有编辑或批注入口，故不宣称PDF编辑保存验收。


## 最终独立检查与数组公式修复

独立检查原排序补丁，使用当前 worker 经隔离服务内存加载，真实引擎重跑非 A1 排序、公式重定位、格式随行及保存重开全部通过。日志 `/tmp/excel-sort-independent-review.log`，产物 `/tmp/excel-1576-sort-independent-review/`。另补两系列柱状图：C1:E4 的类别为 A/B/C，Revenue 为100/200/300，Cost 为40/80/120；首次导出 XML 两个系列分别正确引用D/E列，类别均引用C列。探测脚本 `/tmp/excel-desktop-independent-review.mjs`、日志 `/tmp/excel-formula-independent-review.log`、文件 `/tmp/excel-1576-formula-independent-review/review.xlsx`。这次多系列检查没有对重开后再次导出的全部图表 XML 做比对。

该检查实际复现数组公式缺陷：`=INDEX({1,2;3,4},2,1)` 应得3，旧转换把数组行列全部转成分号，实际得到 `#REF!`，保存重开仍错误。写入回执含 `formulaErrors`，并非静默无错误；但 `success=true` 仅代表写入完成，不能当作计算正确。

按已有英文 Excel 公式输入契约，修复仅区分数组常量的行列：数组内逗号转 Calc 列分号，数组内分号转 Calc 行竖线；函数参数仍沿既有规则，字符串及单引号工作表名保持不动，成对引号转义保留。参考 [LibreOffice 公式分隔符说明](https://help.libreoffice.org/latest/en-US/text/shared/optionen/01060900.html)；本次实际 LOWA 运行确认所用 Calc 分隔约定。由于原生 Calc 的单行 `{1;2}` 与 Excel 单列 `{1;2}` 含义相反，不能仅改输入：`sheet_read_range.formulas` 与 `get_ui_state.calc.formula` 同步将数组部分反向转换为 Excel 分隔，保证 AI 和公式栏读出后原样重写形状不变。普通文本不进行反向转换；数组外函数分号与引用点维持兼容的既有回读格式。

先红后绿证据：

- 新增数组单测修前2项失败：`/tmp/excel-array-unit-negative.log`。
- 新增真实引擎专项修前因实际 `#REF!` 及 `formulaErrors` 断言失败：`/tmp/excel-array-engine-negative.log`。
- 修后 LOWA 单元全套 **263/263**：`/tmp/excel-array-all-unit.log`。
- 最终真实引擎专项：`/tmp/excel-array-engine-final.log`，产物 `/tmp/excel-array-final/arrays.xlsx` 与 `result.json`。覆盖单列、单行、二维、多数组SUM、包含标点与转义引号的字符串、普通SUM；期望值依次3、2、2、36、`say "hi"`、3、`a,b!;{}|`。每项均覆盖范围读回→写入、公式栏所用 `get_ui_state.calc.formula`→写入，以及xlsx导出重载后再次读回→写入。该专项由本次修复者执行，不冒称独立代码审阅。

```sh
node --test frontend/tests/lowa-unit/*.test.mjs
LOWA_DIST_DIR=/tmp/excel-1576-engine-dist LOWA_ENGINE_DIR='/Users/zewei/.codex/worktrees/ppt-edit-quality-1570/1-2 checkba_cloud/frontend/dist/zetaoffice/lowa' LOWA_E2E_PORT=8941 SHEET_ARRAY_EVIDENCE=/tmp/excel-array-final node frontend/tests/lowa-e2e/sheet-formula-array.mjs
```

仍需区分的限制：Calc 会把某些不完整表达式自动修正，例如实际输入 `=SUM(` 被规范为 `=SUM()` 并得到0；本轮没有另造公式语法解析器拒绝该宿主行为。运行时部分写入回执通过故障注入单测验证，真实引擎已验证保护/越界写前拒绝，但没有人为制造真实UNO中途异常；格式继承可能先于值写入，`cellsWritten` 不是“所有副作用数量”。最小额外真实引擎用例是排序含批注、合并、筛选隐藏行的有限组合，以及多系列图表在修改源数据后保存重开核对所有系列缓存；这些未测组合不能由普通排序或单系列图表结果代替。


## 批注、真实筛选和多系列缓存补测

后续隔离真实引擎检查（不是模拟API）：

- 排序 A1:C4 后，记录1的批注从B3移动到B2，记录3的批注从B2移动到B4，保存重开内容与锚点不变。
- 使用产品创建的真实 table autoFilter，导入 `key < 3` 条件及对应隐藏行。确认排序前导出仍有实际 customFilter 条件，而非只开筛选箭头。排序整个所选区域（含隐藏记录）后，隐藏的key3从第2行移到第4行，条件仍为lessThan3，其他行可见；不声称“只排序可见行”。
- 两系列图表的源值 Revenue100→175、Cost40→55 后，第一次导出与真实引擎重开再次导出的两个系列缓存分别为175/200/300、55/80/120，类别A/B/C、名称、D/E列引用全部正确。

独立断言脚本 `/tmp/excel-combination-verify.py`，结果 `/tmp/excel-combination-verification.json`；批注和图表文件在 `/tmp/excel-1576-combination-review/`，有效筛选样本在 `/tmp/excel-1576-filter-rule-review/`。早期筛选fixture存在重复hidden属性或未实际写入criteria的问题，已识别为测试构造错误并排除；其日志不能当产品缺陷或通过证据。

补测另真实发现跨行合并B2:C3时DataSort会无异常拒排，worker却返回success与未排序的sample[3,1,2]。原缺陷证据 `/tmp/excel-1576-combination-review/merged-before.xlsx`、`merged-after.xlsx` 及 `combinations.json`。合并拒排修复的最终验证另记下节。


## 合并区域排序拒绝与性能最终修复

修复写前检查合并范围相交：先对目标创建一个 cursor 并 `collapseToMergedArea`，若扩大了边界，说明有合并锚点在外但合并区域延入目标；再使用目标 `getIsMerged()` 检查内部合并。该方法在 [LibreOffice ScCellRangeObj 源码](https://github.com/LibreOffice/core/blob/master/sc/source/ui/unoobj/cellsuno.cxx) 中查询整个范围的 Merged 属性，无需逐格创建游标或扫描全表。拒绝返回 `SHEET_SORT_MERGED_RANGE`，已接后端、工具栏及20语种词条。未改排序数据、图表或数组转换逻辑。

先红：`/tmp/excel-merged-unit-negative.log` 记录旧实现对合并错误返回success；真实失败由上节的合并样本证明。最终真实引擎 `sheet-sort-boundaries.mjs` 验证四种情况：目标内跨行合并拒绝，F2:G3无关合并不影响A1:C4排序，C2:D3跨目标右边界拒绝，B2:C3锚点在C1:C4目标外但相交也拒绝。拒绝前后数据相同，并保存重开读取；允许场景确实得到1/2/3顺序。单格排序仍为既有no-op。

性能预案曾尝试逐格cursor，因最大范围成本高弃用；不得把该候选当最终实现。仅逐格 `getIsMerged` 的候选漏掉外部锚点，被真实边界测试拒绝。最终采用一次cursor加一次范围查询，在500×10=5000格的真实样本中，含检查的排序调用耗时 **209ms**，读回首两行1/2。最终 `/tmp/excel-sort-range-merge-worker.js` 与当前仓内worker全文字节相等。

最终证据：

- `/tmp/excel-sort-rangemerge.log`，`/tmp/excel-1576-sort-rangemerge/combinations.json`、各场景before/after.xlsx与`performance.json`。
- LOWA单元265项、工具栏多语言行为22项，共287/287：`/tmp/excel-sort-merged-final-unit.log`。
- 普通排序先前专项在守卫初版上通过：`/tmp/excel-sort-mergeguard.log`。最终边界专项额外验证5000格正常排序与无关合并场景；不是重跑完整607项引擎矩阵。
- 一次优化候选引擎启动异常未进入测试，终止后重启成功，失败日志 `/tmp/excel-sort-fastmerge2.log` 保留，不能计作通过。

```sh
LOWA_DIST_DIR=/tmp/excel-1576-engine-dist LOWA_ENGINE_DIR='/Users/zewei/.codex/worktrees/ppt-edit-quality-1570/1-2 checkba_cloud/frontend/dist/zetaoffice/lowa' LOWA_E2E_PORT=8953 SHEET_BOUNDARY_EVIDENCE=/tmp/excel-1576-sort-rangemerge node frontend/tests/lowa-e2e/sheet-sort-boundaries.mjs
```

这次没有操作产品GUI，也没有用真实模型发起排序。原生WPS及主任务桌面数组GUI复测由主任务另行记录。

## 最新数组修复的桌面窗口验收（2026-10-28 09:50Z）

隔离 Electron 中先关闭旧实例，再加载与当前源码 SHA-256 `8b3474a25d2267787208b8160453e5fd25910b6168f42f57ed3d0e457fb1dd1b` 完全一致的 worker。通过产品资源管理器打开 `array-regression.xlsx`，公式栏正确显示 Excel 数组分隔符；将 A1 二维数组的行参数从2改1，实际画面值变1；A2纵向数组与A3横向数组在公式栏不改内容按Enter提交，仍分别为2。界面显示已保存后关闭标签再从资源管理器重开，A3仍显示横向逗号数组和值2。独立检查正常自动保存产物的XLSX XML：A1 `INDEX({1,2;3,4},1,1)`缓存1、A2 `INDEX({1;2;3},2,1)`缓存2、A3 `INDEX({1,2,3},1,2)`缓存2、A4双数组SUM缓存36。证据 `/tmp/excel-1576-product-evidence/desktop-array-autosaved.xlsx` 与 `desktop-array-autosave-verification.json`。此测试经实际桌面编辑与正常自动保存，不以引擎导出替代。

## 整合后最终回归（2026-10-28 17:56 +08）

JDK21完整后端Maven：7507测试、0失败、0错误、35跳过，BUILD SUCCESS，日志 `/tmp/office-parity-backend-final-full.log`；此前波动的监听器本轮13/13通过，未放宽门槛。Office加载项809/809，显示名与工具栏42/42、20语言检查通过；H5、Web Office及加载项构建成功。日志 `/tmp/addin-wps-files-final.log`、`/tmp/final-delivery-{frontend-build,addin-build,zeta-build,locales,display-toolbar}.log`。构建生成的无关插件web资产已恢复，不进入本次源码。WPS真机目前只有新建合成文档回执，尚未执行保存编辑重开，不能据自动测试将其记为完成。
