<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# File operation parity: independent source audit, 2026-10-28

This audit inspected `fileOperations.js`, `hostBridge.js`, `chatSession.js`, cross-document rejection, and the backend file-tool bridge. **Native Mac Office evidence now covers Excel basic/advanced saved readback, three-host PDF upload/download, new-document checks, Word first-save cancellation, and project-file copy opening. Evidence is operation-specific: PPT shared-border persistence is now repaired and verified on the source; updated copy retest passed, and WPS has not yet been natively executed.** Native actions observed by the parent, independently inspected artifacts, and automated tests are distinguished below. A model-generated AI conversation is tracked separately.

## Findings requiring resolution or explicit acceptance

1. **P1 fixed — create/open now blocks the remainder of the originating turn even if its pane stays on the source document.** The final `handleLocalAction` sets both `forceDocumentRebind` and `documentChangedDuringTurn` after successful create/open. Source inspection confirms the lock no longer depends solely on a changed URL. Parent reports the unchanged-key regression is covered: chat rebind suite 6/6 and full add-in suite 742 passing. Those are automated tests, not native Office/WPS evidence.
2. **WPS PDF size is checked after the native binary read.** Office validates File.size before fetching slices; WPS exports then calls `readAsBinaryString` before enforcing the 50 MB byte limit. Therefore WPS does not have an equivalent pre-read memory bound. This does not prove a native failure at 50 MB, but a large export is a required native stress case and must not be described as pre-read bounded.
3. **Native acceptance is partial and specific, with later successful retests superseding early harness failures.** Excel basic save/reopen retains four charts, one pivot, seven validation rules and formulas. The advanced suite subsequently completed native checks and saved/reopened readback: the earlier merge assertion was a harness mistake (aggregate address was top-left; actual area dimensions verified 1×2), and append-format fixtures were corrected to supply two consistent prior rows. These initial failures remain historical evidence, not the current outcome. Three-host PDF export/upload/download has independently verified bytes and rendered content below. Word new-document/first-save-cancel and file-open copy preservation are evidenced below. Parent reports Excel copy metadata seed09:12:07 and verify09:12:43 passed; this audit does not equate that metadata read with a full independent copied-XLSX package comparison. PPT new/open content checks passed; a later shared-border persistence defect was reproduced on the reopened source and repaired with a production-handler save/reopen verification; updated copy metadata and saved-package retest passed; public original-save/cancel is unsupported. WPS native execution, broad version coverage, two-window rebind and complete file lifecycle equivalence remain unverified.

## Capability and destination matrix

| Action | Microsoft Word | Microsoft Excel | Microsoft PowerPoint | WPS Word / ET / WPP |
|---|---|---|---|---|
| Create | WordApi 1.3 blank native document | ExcelApi 1.8 blank workbook | PowerPointApi 1.1 blank presentation | Collection.Add, runtime capability guard |
| Open project file | createDocument(base64), **copy** | createWorkbook(base64), **copy** | createPresentation(base64), **copy** | Write unique temp file, verify binary readback, Open; **temporary copy requiring Save As** |
| Save | Existing document: Document.save(); never-saved: WordApi 1.5 save(Prompt), cancellation verified | Workbook.save(Prompt), ExcelApi 1.11 | Tool hidden and handler rejects | Save; ET/WPP reject never-saved paths; verify Saved and path, label temporary copies |
| PDF export | PdfFile 1.1 and platform checks | PdfFile 1.1 and platform checks | PdfFile 1.1 and platform checks | ExportAsFixedFormat to temporary PDF then read bytes |
| Persist PDF | Upload to current project; return real file ID only after upload | Same | Same | Same |

Create/save operate on a native host document, not a project-file transaction. Project open accepts only a project file ID, checks current-project ownership, native extension, ZIP signature, and a bounded server-side read; raw paths/base64 are not model-facing inputs. Open is restricted to the current host's matching format. Cross-host project opening and writing edits back over the original project source are **not implemented by this bridge**. These are explicit semantic differences from Web Office's project-backed editing, not completed equivalents.

## Confirmed source-level protections

- File commands serialize in the local queue. The cached document key is supplied as `expectedDocumentKey` and source identity is checked before execution; PDF identity is checked during slicing and before project creation.
- The backend and frontend cross-document paths reject `file_*` commands, preventing origin metadata from bypassing local document ownership.
- Results are posted to the originating conversation before rebind. First save of an unsaved document and genuine new-file creation are distinguished.
- Office PDF closes the native File object in `finally`; WPS removes its temporary exported PDF. Successfully opened WPS copies retain their file for native lazy reads and report `temporary`/`requiresSaveAs`.
- Failed PDF upload reports `partialResult` with the incomplete project file ID; hostBridge, chatSession and OfficeBridgeService preserve it while the overall result remains failed.
- Timeouts are finite: create 120 seconds; open/save/export 180 seconds. A timeout is not proof of no side effects and must not cause blind replay.

## Official API cross-checks

- [Excel Workbook.save](https://learn.microsoft.com/en-us/javascript/api/excel/excel.workbook?view=excel-js-preview): method requires ExcelApi 1.11. Do not confuse the older SaveBehavior enum version with the method version.
- [Excel save/cancellation behavior](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-add-ins-workbooks): Prompt only asks for a destination for never-saved files; cancellation throws.
- [Word Document.save](https://learn.microsoft.com/javascript/api/word/word.document?view=word-js-preview): basic save is WordApi 1.1; optional saveBehavior/fileName arguments were introduced in 1.5. Saved documents use basic save; never-saved documents require 1.5 and `save('Prompt')` so Word asks for a destination instead of silently assigning a default name.
- [WPS FileSystem object](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/addin-api/FileSystem/obj): official example uses Application.Env.GetTempPath and Application.FileSystem; presence of these documented methods does not establish behavior in this installed native WPS.

## Required native acceptance

Run only synthetic new documents. For each supported host: create/open copy, verify actual active document and source preservation, edit, save (including cancel), close/reopen, and inspect persisted values/formulas/formats/charts/pivots/validation. Export PDF and verify actual project bytes/file ID. Include a two-window scenario in which the old taskpane remains open, WPS temporary-copy Save As, unsupported capability rejection, and a failed upload with a visible partial file ID. Record host/version, screenshots, handler receipts and reopened artifacts separately from unit-test output.

## Native save evidence (2026-10-28 follow-up)

Receipts reviewed: `/tmp/awd-native-excel-qa-20261028/native-excel-qa-first.json` and `native-evidence.jsonl`. The first real run exposed unloaded `Worksheet.name` after pivot creation; the next exposed invalid numeric date-validation bounds. Both were fixed, and the basic suite completed before the saved/reopened readback. Two targeted regressions passed in this independent review. See `2026-10-28-excel-addin-matrix.md` for timestamps, exact covered functions, and evidence levels. UI visual correctness and the physical close/reopen action are the parent’s observations; ZIP/XML artifact and receipt inspection were performed by this audit agent.

## 三宿主原生 PDF 导出→项目上传→下载独立验证（2026-10-28）

主任务在Mac原生Excel、Word、PowerPoint分别执行实际hostBridge `file_export_pdf`，结果上传至本地隔离后端`127.0.0.1:60814`的合成项目1。核验者只读下载`/api/files/{id}/download`，未操作UI、未改产品代码、未调用模型，也未接触生产服务。日志三个`pdf-upload-download-verified`均passed且sourceUnchanged=true；独立下载字节数与SHA-256逐项匹配回执。

| 宿主 / fileId | 下载字节 | 页数 | SHA-256 |
| --- | ---: | ---: | --- |
| Excel / 8 | 40552 | 4 | `d2af922832c81d4fe83af51fe5402205550477a03cec044415e06e675036e8f8` |
| Word / 9 | 43908 | 1 | `79bc1b7c6b3b7ed272ab791ab5162b68f436c1a3c1e1d2aebb8c7806a3c5bc06` |
| PowerPoint / 10 | 83921 | 1 | `aaaee7526c100cae310a80537bcb781e0955d3edf7c4b34f45107029c96d0207` |

使用PDF技能和本机Poppler的pdfinfo/pdftotext/pdftoppm，渲染并目视检查全部6页，另作23项文本内容断言，全部通过；不是仅检查PDF头。

- Excel：柱状、条形、折线、饼图均真实显示；原数据/公式结果、透视60/80/140汇总、排序后的彩色行、条件格式和继承格式的追加行可见。当前打印布局横向拆成两页，透视行标签与数值分处第1/2页，第1页可见右侧图表边缘；第3/4页是高级测试页。可确认内容与图形被原生导出，**不将默认打印分页称为排版完善**。
- Word：标题、125金额修改、第二条款、表格与红色测试图片显示。原生修订标记和批注气泡也被导出；这份PDF是带标记稿，不能称为清洁稿。未发现乱码或黑块。
- PowerPoint：目标NEW与未改邻形状OLD、混合字体、居中/右对齐、旋转矩形、2×2表格均可见；修后42单元格深色边框真实可见（主题共享边显示仍受相邻单元格样式影响）。969字符长文本源框溢出并与表格叠压，PDF保留这一源排版问题；文本提取会把表头插入长文本阅读顺序，五个中文字符各160次均在，不能因字数完整声称视觉无重叠。此次仅验证文件导出链，不修改合成源布局。

证据目录`/tmp/excel-1576-product-evidence/`包含`office-native-{excel,word,powerpoint}-uploaded.pdf`、对应pdfinfo/txt与6张`office-native-*-pdf-*.png`，以及`pdf-download-independent.json`、`pdf-content-independent.json`。结论是三种真实Office宿主的原生PDF输出、真实创建/上传和下载字节一致性已验证；WPS、其他宿主版本、打印布局自动优化、清洁稿选项与全部视觉格式不在此通过范围。

## Word 原生 file_open 新副本保存后独立核验（2026-10-28）

主任务观察到实际 `file_open` 打开新副本，并通过原生 Word UI 另存为 `QA1576 ContractAWD-Native-FileCopy-202610.docx`（名称因 UI 输入拼接，与源名不同）。核验者只读比较该保存副本与 `AWD-Native-QA-20261028.docx`，没有修改源文件，也不将“打开新副本”称为“打开原文件”。

独立 ZIP/XML 核验 **38/38 断言通过**：包成员一致；正文完整结构仅排除编辑会话 rsid 后相同；18 个文本节点、2 个删除文本节点、4 个行内格式节点、1 个段落格式节点、1 张 2×2 表格、3 个插入修订、2 个删除修订、1 套批注锚点和1个图片 drawing 均保持。批注文件、样式、关系文件、图片二进制及其余非元数据部件字节一致。完整文档 XML 的唯一差异是删除一个零值 `w:rsidR`；settings 增加一个编辑会话 rsid；core 的修订计数与修改时间、app 的编辑时长随另存为更新。这些不作为正文/格式损失，也没有直接忽略整个正文或格式节点。

源 SHA-256：`c879fb29d1aac8ac40b46a1f6ee380cf2b054c63724576050aa83b584af3d1f3`；副本 SHA-256：`1dc0b4f00863ba8be6d0baeb972f9916679e21b3437a827605981521cc8eefde`。核验前后源哈希一致。证据目录 `/tmp/excel-1576-product-evidence/` 保存 `verify-word-file-copy.py`、`word-file-open-copy-verification.json`、`office-native-word-file-open-copy.docx`。真实打开与另存为动作来自主任务 UI 观察，本次独立核验覆盖保存产物的内容与结构，不声称另做过视觉渲染或 WPS 实测。

## Word 首次保存与取消原生回归（2026-10-28）

首次原生测试发现 `Document.save()` 会把新建空白文档静默保存为默认 `Doc1`，而当前窗格缓存 URL 仍为空；这不是用户取消，不能以测试阶段名将其称为取消通过。代码已改为：未保存身份必须支持 WordApi 1.5，并调用 `save('Prompt')`；已有保存身份保留 WordApi 1.1 基础保存。版本门槛、取消错误传播和已有文件行为三项回归先失败后通过。

修后主任务在 Mac Word 新建另一合成文档“文档2”，亲自观察原生另存为面板（默认名 Doc2）并点击取消。独立读取 `native-evidence.jsonl`：09:11:18.776Z 空白新文档读回通过；09:11:25.265Z 首次保存返回 `{ok:false,error:'GeneralException'}`，前后未保存身份相同、URL 为空。真实弹框/点击取消/窗口仍为“文档2”由主任务 UI 观察确认；本代理只核对回执。此证据确认取消不会返回保存成功，不代替 Word 首次保存成功后的持久化验证，也不改变全局文档身份来源。

## PPT 原生新建与 file_open 副本保存核验（2026-10-28，保真未全部通过）

主任务观察实际新建09:18:55、空白内容检查09:19:06通过，随后关闭不保存。PowerPoint 没有该路径所需的公开原件保存 API，首次保存取消辅助检查明确拒绝；**不能记为取消保存通过**。接着实际 `file_open` 打开“演示文稿2”，09:20:27 内容检查通过，再由原生 UI 另存为 `AWD-Native-FileCopy-20261028.pptx`。

独立只读包比较发现明确保真差异：源 `8b8c4d76c74ea95d7df4f333d1e013f9732332ee4070e06072ef0fd17017c9fa` 与副本 `0f856bd7c1bd2f91927744f3d289131c4d4a195d21eef24c10179dd14bde4b44` 的成员一致；除 `ppt/slides/slide1.xml` 与 core 修改时间外，其余部件逐字节相同，包括所有母版、布局、主题、关系。文本、形状几何、混合 runs、字体和段落属性保持。但42单元格的左、上显式1pt/#123456边框被删除，右、下仍在；相邻单元格没有增加对应共享边，tableStyleId也未变化。因此不能仅以能打开或文字检查通过认定完整保真，尚需区分导入与原生再次保存阶段，以及原生共享边归一行为。

证据 `/tmp/excel-1576-product-evidence/verify-ppt-file-copy.py`、`ppt-file-open-copy-verification.json` 保留严格失败断言；副本归档为 `office-native-ppt-file-open-copy.pptx`。该次源文件核验前后哈希一致，未修改源文档。边框问题未关闭，本记录不将原生 PowerPoint 副本操作或 WPS 整体记为全面通过。

### 原件/副本真实宿主边框对照补证

09:23:36 副本、09:24:04 原件分别运行只读 `readPptAllBordersQA`。四格×四侧的原生读取值完全相同：42的上/左均为 `#FFFFFF`、序列化weight=null，右/下为 `#123456`、weight=1；相邻格边均白色、weight=null。源文件落盘哈希仍为8b8c…，XML上/左显式定义未变。因此目前可以排除“仅file_open导致新增的原生边框状态退化”的判断；**原文件重新载入后便已不呈现这两条自定义边**。之前仅凭源OOXML四边存在的持久化结论不充分，需继续验证表格共享边两侧协调。raw transparency均为1，不能按已知宿主反转行为误判为全部透明；null也不冒称0pt。

`ppt-source-copy-native-borders.json`归档两份完整回执与对照断言。建议下一步在合成表独立探针同时设置42.top/Value.bottom与42.left/Row.right，保留右下，再保存关闭重开核对原生16侧和XML；尚未执行，不把建议当作已验证修复。

### 共享边问题正式修复后的当前状态

后续双侧共同边实验与正式handler均通过保存重开。正式handler09:29:11改为独立测试值2pt/#345678；09:29:35原生六侧、落盘XML六侧一致，证据`ppt-shared-border-production.json`。因此前述“共享边未解决”是修复前历史状态，当前已完成原件正式handler持久化闭环。更新后的file_open验收新增实时原生shape几何与逐格四边metadata对比，并从当前保存源计算指纹，不固定旧8b8c哈希；副本复测尚待主任务执行。

### 修复后 PPT 副本完整性复测通过

09:33:16.408Z实际file_open新副本原生metadata（含shape几何、逐格四边）比较通过；主任务随后原生另存为`AWD-Native-FileCopy-Fixed-20261028.pptx`。独立严格包核验 **48/48通过**：除app.TotalTime 55→56、core.modified时间外，每个部件字节一致，正文/混合runs/字体/几何/表格/六条共同边/母版/布局/主题/关系全部保持。源哈希`2b513d43d4059eae36569260ffa3f88790272e3e0899c212321fb95ad638f061`，副本`682b112b884e5fe945d512b4ca1b59271a130abb6e6a8423d2fad1b48aa199de`。核验动态比较当前源，不固定修前哈希；源核验前后未变。

证据目录保存`verify-ppt-file-copy-fixed.py`、`ppt-file-open-fixed-copy-verification.json`（含真实09:33:16回执）、`office-native-ppt-file-open-fixed-copy.pptx`。原失败副本、失败断言与中间实验均保留。当前PPT共享边与修后打开副本另存为保真闭环通过；不扩展为WPS、所有文档或未测试合并表边框通过。

## Word 原生首次保存：已落盘但 API 报错（2026-10-28 09:31Z）

后续成功路径测试揭示另一真实宿主差异：主任务在原生另存为面板选择 `AWD-Native-FirstSave-20261028.docx` 并确认保存，窗口显示该文件；但09:31:13.632Z `Word.run → document.save('Prompt') → context.sync()` 返回与取消时相同的 `GeneralException`，缓存URL仍为空。不能将此回执归为成功，也不能凭该错误认定用户取消。

独立只读检查 `/tmp/awd-native-word-ppt-qa-20261028/AWD-Native-FirstSave-20261028.docx`：文件真实存在，14810字节，ZIP校验通过；正文1段、0文字节点、0表格、0图片，确为空白合成文件。SHA-256 `5d73435fc0b7e566e445d070cf8c4d9bb9982b467dd609d41445d6f92061f5c1`；机器可读证据 `/tmp/excel-1576-product-evidence/word-first-save-artifact-verification.json`。这确认该次产生了保存产物，不将接口错误吞成成功。

产品的保守处理现为：仅已调用原生save后的异常，保留原错误与 `ok:false`，并附结构化 `partialResult`，明确 `operation:save`、`outcomeUnknown:true`、`retryable:false` 与前后身份。版本/身份等写前拒绝不加“结果未知”。取消和成功后异常都不应无条件重放。专项先红后绿，文件操作、会话文件重绑与部分结果传递共35项通过。临时QA另提供新鲜文件属性查询和失败命令产物重开读回入口；这些是只读诊断，不改全局身份来源，也不篡改原始命令成功状态。

09:46:39Z 主任务刷新窗格后只读取得原生文件路径，确认已保存身份；随后亲自关闭该测试文档，面对保存提示选择“不保存”以免第二次写入改变证据，再通过 Word 打开面板从磁盘重开同一文件。09:48:01Z 原生回读确认正文仍为空、路径完全一致，回执明确为 `artifactReadbackPassed:true, commandSuccess:false`。这补齐了报错后文件产物的实际关闭重开验证，仍不把首次命令报错改记为成功。临时测试页的 window.confirm 在 Mac Office 不支持，改为显式复选框确认实际重开动作，未修改产品功能。
