<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Office/WPS PPT 精确编辑验收

日期：2026-10-28。本记录只覆盖 PPT 子任务；后台注册、路由、跨文件执行和整轮语言检查由集成任务验收。以下自动化为模拟宿主行为测试，不是 Office/WPS 实机认证。

## 已实现行为

- `ppt_replace_text` 可用 slideNumber + shapeId 精确定位，并用 expectedText 检查读取后变化；先校验再写入，局部字符替换保留目标外文本格式。缺少 replaceText 拒绝，显式空字符串允许删除。`all:false` 只替换首个匹配。
- `ppt_get_slide_details` 返回完整文本、textLength 和 textTruncated:false，去除原有 500 字符静默截断。Office 1.8+ 返回当前母版的布局 ID 与名称。
- `ppt_set_shape_text`、`ppt_set_shape_geometry`、`ppt_format_shape`、`ppt_goto`、`ppt_set_layout` 提供精确文本、位置尺寸旋转、填充线条、定位以及布局/背景修改。整个文本框替换与局部替换是不同动作；前者不声称保留内部混合字体。
- WPS 以 Slide/Shape 原生对象执行，shapeId 用 Id；布局使用当前母版 CustomLayouts 的 Index。Office 使用实际布局 ID，不能跨宿主复用布局标识。
- 新错误提示和命令名称采用多语种令牌。

## 可重复测试

```sh
node --test office-addin/taskpane/lib/pptPrecision.test.js office-addin/taskpane/lib/officePptShapes.test.js office-addin/taskpane/lib/wpsWppHandlers.test.js
node --check office-addin/taskpane/lib/officeExecutor.js
node --check office-addin/taskpane/lib/wpsWppHandlers.js
```

子任务首次执行：43 项通过、0 失败；两份源文件语法检查通过。覆盖精确 ID、同页多个同文形状不误改、旧文本拒绝、仅替换一次、完整长文本、缺参和空文本区分、几何非法值写前拒绝、样式全参数预检、背景版本不足不先修改布局、缺失目标不改变选中状态。

跨文件套件首次因当前工作树缺少 vue 依赖而未启动，不应计为通过或断言失败；集成任务安装依赖后须另跑 officeCrossDoc.test.js / wpsCrossDoc.test.js。上述数量是本子任务运行快照；后续整合结果以实际输出为准。

## 宿主差异的官方依据

| 能力 | 依据与适配 | 未验证项 |
| --- | --- | --- |
| 形状线条 | [ShapeLineFormat](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.shapelineformat?view=powerpoint-js-1.8)：颜色、宽度、可见性、透明度属于 PowerPointApi 1.4 | 真实宿主对特殊形状的效果 |
| 填充 | [ShapeFill](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.shapefill?view=powerpoint-js-preview)：clear/setSolidColor；透明度 0–1，工具参数百分比转换后写入 | 渐变或主题填充转为纯色的渲染 |
| 跳转/选择 | [PowerPointApi 1.5](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/powerpoint/powerpoint-api-1-5-requirement-set)：setSelectedSlides/setSelectedShapes；执行前核实目标 | 各平台实际滚动与焦点 |
| 布局 | [Slide.applyLayout](https://learn.microsoft.com/javascript/api/powerpoint/powerpoint.slide) 属于 1.8；[SlideMaster.layouts](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.slidemaster?view=powerpoint-js-preview) 给出当前母版可用布局 | 应用布局后占位符重排；WPS CustomLayouts 实机 |
| 背景 | [SlideBackgroundFill](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.slidebackgroundfill?view=powerpoint-js-preview)：setSolidFill(options) 属于 1.10；先检测支持，且不在拒绝之前修改布局 | 旧版本实际错误表现；WPS FollowMasterBackground/Fill 效果 |
| 既有表格样式 | 旧表格指南的限制已被新版 API 超越：[TableCell](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.tablecell?view=powerpoint-js-preview)、[TableRow](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.tablerow?view=powerpoint-js-preview)、[TableColumn](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.tablecolumn?view=powerpoint-js-preview) 的格式和尺寸成员标记 PowerPointApi 1.9。实现先检测1.9，原位改cell，不删除重建 | 实机渲染、合并单元格、宿主最小行高钳制；返回currentHeight实际行高 |
| 备注 | Office [Slide API](https://learn.microsoft.com/javascript/api/powerpoint/powerpoint.slide) 未公开notes写接口，工具对Office隐藏。WPS [SlideRange官方示例](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/wpp/SlideRange/obj) 明确NotesPage.Shapes.Placeholders.TextFrame.TextRange路径；实现按PlaceholderFormat.Type=2唯一body选择，避开页码页眉 | WPS实机读写、保存重开未验证；缺失/歧义body拒绝，不猜占位符下标 |

官方文档核查日期同上，预览文档中可用的成员也必须遵守各自 requirement set，不因页面展示而假设旧版支持。WPS COM 风格 API 的实现已做 mock 验证；本轮没有运行真实 WPS，应在发布前实机核实，不能用 Office 文档替 WPS 背书。

## 真实宿主验收剩余项

在 Office 和 WPS 各用含混合字体、相同文本、长段落、主题布局和表格的自建 PPT：读取目标 → 局部替换 → 读回 → 保存 → 关闭重开，检查邻形状、字体片段、几何单位、透明度、页面背景和布局。记录宿主名称、版本、API requirement sets、文件和截图；旧版本要验证拒绝发生在任何写入之前。此记录未包含这些实机证据，也未宣称所有桌面能力已在两宿主全面实现。

## 本轮补齐（2026-10-28，续）

- 新增 `office_ppt_read_notes` / `office_ppt_write_notes`（WPS演示）和 `office_ppt_table_set_style`（Office 1.9 / WPS）。备注完整返回textLength/textTruncated:false，写入支持expectedText和空字符串清空。
- 表格样式必须指定slideNumber+shapeId；row/col/endRow/endCol为0基闭区间，默认全表。支持字体、填充、对齐、四边框、首行、列宽、行高；先验证所有参数，运行中失败携带partialResult/outcomeUnknown/retryable:false。文本和形状ID不重建。跨窗格新写命令保守拒绝；备注读取不触发修改快照。
- `office_ppt_format_text`新增slideNumber/shapeId/expectedText；指定shapeId时省略searchText可格式化整个文本框，WPS遍历包含组合文字；同文形状只格式化精确指定目标。paragraphFormat支持两宿主对齐；WPS支持段前后磅数或行数、单倍/1.5/双倍/多倍/百分比/固定磅行距。磅数优先于同项行数。Office不支持的行距、间距在任何字符修改前拒绝。依据：[Office ParagraphFormat](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.paragraphformat?view=powerpoint-js-preview)仅有对齐、项目符号、缩进级别；[WPS ParagraphFormat](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/wpp/ParagraphFormat/obj)公开LineRuleBefore/After/Within及SpaceBefore/After/Within。
- 未等价项：Office演讲备注、精确行距/段间距/磅或字符缩进；WPS最小行距与精确首行/左右缩进未找到本轮可核实稳定接口，不在参数支持列表，也不静默忽略。WPS下划线原有实现将复杂线型降级普通线，结果有提示，尚非视觉等价。
- 新增 `pptNotesTables.test.js` 11项，包括同文形状隔离、旧文本冲突、表格预检无写入、运行中部分失败、旧Office版本、行距单位、备注页码保护。与原PPT及跨文件套件联合运行82项通过。JDK21最终后端OfficeEditToolsTest82与ClientCapabilityServiceTest12全部通过（/tmp/ppt-backend-final.log）；整套加载项769项通过（/tmp/ppt-all-addin-final.log），工具对拍89项能力/214工具/13技能通过。
- 本轮所有以上测试均为行为模型/后端桥接测试，未打开Office或WPS实机，不替代宿主保存重开验收。

### 失败回执与显示入口补验

Office/WPS公共执行器现在保留error.partialResult，hostBridge原样返回，chatSession在本窗格与跨窗格两条结果回传中将失败回执放入data。`executionPartialResult.test.js` 3项通过，分别检查两宿主执行器→hostBridge与两条会话回传表达式。新增6个Word和3个PPT工具显示名通过editor.officeToolNames的20语令牌取得；`office-tool-display-names.test.mjs` 20项通过，frontend check:locales通过。原有未迁移的zh/en显示表不在此次修改范围。

## 原生 PowerPoint 保存重开独立复核（2026-10-28）

本节补充此前“无实机证据”的范围，不能套用到WPS。主任务在Mac原生PowerPoint执行真实hostBridge命令、UI保存、关闭并重新打开合成文件；本子任务没有操作UI，独立读取08:36:48 UTC的原生回执及落盘PPTX，采用Python ZIP/XML断言核对。未重复运行创建流程。

- 重开日志包含14项通过断言：同文邻形状未改、完整969字符长文、5个对象、表格四格文本、局部替换保留前缀加粗/颜色与后缀斜体、五项位置尺寸旋转、形状样式、表格样式及尺寸、临时页已删除。对齐数字读值暂留pending，未猜测其枚举含义。
- OOXML独立确认目标段落`algn="ctr"`、邻形状`algn="l"`、42单元格`algn="r"`；确认混合字体、矩形600/145/60/40pt与15°旋转、填充25%透明度、2pt线条、表格160/180pt列宽及30/40pt行高。
- 两次测试脚本问题已区分：本宿主部分代理对象`toJSON()`返回空对象，改为显式读取已load属性；对齐getter返回数字1/2，而公开JavaScript枚举为字符串，改为保留原始读值并由保存OOXML独立验证。这两项没有证据表明产品写入错误。
- **首次复核发现真实边框问题，修复闭环见下文最终验收**：42单元格四边宽度1pt、颜色123456正确，但保存XML的`a:alpha=0`使边框透明。官方Border.transparency文档定义0为不透明、1为透明；本次写入0后落盘与定义相反，正在用单独原生探针核对赋值顺序，不将四边框算作通过，也不直接全平台反转数值。

证据保存在`/tmp/excel-1576-product-evidence/`：`office-native-reopened-before-border-fix.pptx`，SHA-256 `8b4f4285e58ea59b21f4c88768c9bab2dcaa331ecb3b44d031d9ca545305b65d`；`verify-native-ppt.py`、`ppt-before-border-verification.json`。独立断言34通过、4失败，失败恰为四边框透明度。最终修复后须重新保存重开并复用同一断言核验，修前失败证据保留。

边框后续定位：主任务原生四边赋值顺序探针保存后，四边alpha属性均消失（OOXML默认不透明），getter却都返回transparency=1。仅重设color+weight的上边也恢复，未采用全平台反转0/1。最小修复只去掉Office表格样式中多余的transparency赋值，保留color/weight；新增回归先红后绿，PPT55项通过。探针文件`office-native-border-probe.pptx`通过同一38项离线断言，但它是原生诊断赋值，不替代修后实际handler保存重开。`repairPptBorderQA()`和`probePptZeroBorderQA()`已准备，由主任务先验0pt再恢复1pt；0pt不凭getter值宣称视觉隐藏。


### 修后最终原生验收

主任务执行0pt探针、原生保存，实际XML四边均`w="0"`，alpha缺省；只证明零宽度持久化，没有把它称为视觉隐藏验收。随后调用修后真实`ppt_table_set_style`恢复1pt与123456颜色，UI保存、关闭并从最近文件重新打开，仅执行readPptQA。日志精确时刻为：0pt探针08:43:05.523 UTC，1pt修复08:43:26.367 UTC，修后重开读回08:44:09.004 UTC（主任务口头“08:45左右”是近似时间，以原始日志为准）。

本子任务再次独立复核最新一轮14项原生读回通过记录与落盘PPTX：`verify-native-ppt.py` **38/38通过、0失败**。四边框均1pt、123456，alpha缺省即不透明；`ctr`/`r`由保存XML实证关闭对齐pending。JavaScript读回仍保持数字枚举pending的诚实状态，没有为了通过测试硬编码数字含义。

最终证据：`/tmp/excel-1576-product-evidence/office-native-reopened.pptx`，SHA-256 `8b8c4d76c74ea95d7df4f333d1e013f9732332ee4070e06072ef0fd17017c9fa`；断言结果`ppt-final-verification.json`，完整原生回执`ppt-native-receipts.json`，独立脚本`verify-native-ppt.py`。修前PPT与4项边框失败结果另存，不覆盖原始失败证据。

此结论覆盖本次Mac原生PowerPoint实际命令、同一合成文件的保存重开及XML核验。不能外推为Windows PowerPoint、WPS、所有主题/合并单元格/复杂排版或正式发布包全面通过；Office备注与原位保存依旧是明确不支持的负向用例。

### 后续发现：源表格共享边持久化需补验

2026-10-28 09:24:04只读原生探针发现，原件8b8c…虽然XML中42单元格四边均有1pt/#123456，重新载入后原生上/左已回到#FFFFFF、weight=null，右/下仍正确。09:23:36 file_open保存副本的原生四格16侧值与原件完全一致，因而不能归因成副本独有损失。此前“保存XML四边存在”不足以证明重新载入后四边有效。现将该项保留为未解决，准备共享边两侧同时设置的合成探针；正式handler暂未改。证据见`/tmp/excel-1576-product-evidence/ppt-source-copy-native-borders.json`和文件能力审计追加说明。

### 共享边正式修复闭环

正式 `ppt_table_set_style` 已对每条目标边同步相邻单元格的同一物理边，只设置用户提供的线色/线宽，不修改邻格字体、填充或文本。实际边框所涉单元格若为合并区域或空代理则写前拒绝，防止改动超出选择范围；headerBold/headerFill 额外涉及的表头单元格不扩大合并跨度守卫。新增回归先红后绿，PPT专项21/21通过。

09:29:11主任务仅调用正式handler将42四边改为与前次实验不同的 **2pt/#345678**，原生保存、完全关闭、重新打开后09:29:35回执确认42四边及Value.bottom、Row.right六侧均正确。独立XML验证六侧w=25400、color=345678全部通过，证明不是之前直接探针残留。证据`ppt-shared-border-production.json`及`ppt-shared-border-production-reopened.pptx`位于`/tmp/excel-1576-product-evidence/`。源副本重开保真复测仍单列，尚未完成；合并单元格拒绝路径是自动化测试，未宣称合并表真机通过。

修复后file_open副本进一步完成：09:33:16原生几何/逐格边框metadata比较通过，原生另存为后独立48/48严格包断言通过，只有保存时间/编辑时长元数据变化，其余部件字节一致。详见文件能力审计和`ppt-file-open-fixed-copy-verification.json`；原失败记录保留，不覆盖。
