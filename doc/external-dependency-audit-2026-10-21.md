<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Mac / Windows 外部依赖排查与处理建议

日期：2026-10-21。审计基线：master `0495e40d004cd7f4d9b709ddb1a94453a4b38222`（0.67.0 源码）。台账：dev-board #1378（QTA）、#1379（依赖审计）。本报告针对桌面用户运行功能所需的依赖；开发/CI 的 Maven、编译器、签名工具不应转嫁给用户。

**结论：QTA 可以支持；右键 Word 转 PDF 缺 LibreOffice 时不会引导安装，而是静默切换到有损重排。后者必须优先处理。** 当前组件下载体系已有相当完整的校验和落盘机制，但“安装完成”与“功能可用”的验证还没有接齐。本文的整改清单是建议，不代表已经修复；本次产品实现仅为 QTA 预览。

> 后续整改另见[落实记录](external-dependency-remediation-2026-10-21.md)。本文“当前”指上述原审计基线，保留作为问题复现依据。

## 1. QTA：当前支持范围与本次交付

QTA 是 QuickTime 音频容器。Apple 说明：空间录音可同时包含 AAC 立体声兼容轨与 APAC 空间轨；不能把扩展名直接改成普通音频就承诺支持。[Apple WWDC25 原始说明](https://developer.apple.com/videos/play/wwdc2025/251/)。

基线已经支持 QTA 的资源管理器右键转写，缺的是双击播放入口。本次补齐：

- 双击进入播放器，经已鉴权接口在桌面本地后端生成临时 MP3，用内置 JavaCV/FFmpeg，不要求安装系统 FFmpeg，不调用转写云服务。
- 优先安全选择 AAC 兼容轨；单条可解码音轨也可使用。多条独立 AAC 录音层不擅自丢弃其中一层，明确提示先分离录音层并导出 M4A。
- 预览最多双声道，44.1kHz/128kbps；原件不改，空间音效和 Apple Audio Mix 不在此支持范围。预览转换不是无损导出。
- 权限失败在读取和转换之前拒绝；源文件限512MiB，超限提示分段或导出M4A；成功响应关闭或失败时清理临时文件；切换文件取消前端请求并释放 blob。压缩包里的 QTA 先解压到项目再打开。
- 对组件加载失败、无法解码、文件/磁盘读写失败和超时分别给出说明。转换期限在帧间检查，不是能够强制终止任意原生阻塞的进程隔离；前端取消不会保证同步后端立即停止。

主任务实际核验用户指定样本的容器/音轨，未读取转写内容或上传录音。510.370 秒源文件含 AAC 立体声、APAC 四声道及元数据轨；调用本次应用转换器约 5.1 秒生成 510.328 秒、44.1kHz 双声道 MP3，原件 SHA-256 前后相同。临时私人预览不作为交付材料。

## 2. 用户关心的 Word → PDF 执行路径

资源管理器“转为 PDF” → `POST /api/projects/{projectId}/files/{fileId}/convert-pdf` → `ProjectFilePdfService` → 优先本机 `soffice` → 不可用时 Java 重排 → 在原目录新建 PDF（重名另命名）。转换的是已保存文件字节。

| 情况 | 当前实际行为 | 用户看到什么 |
|---|---|---|
| 找到 LibreOffice 且在 30 秒内生成 PDF | 调用 headless LibreOffice | “已转为 PDF” |
| 没装、装在未识别目录、不可执行 | 直接改用 Java 转换 | 同样提示成功，没有缺依赖说明 |
| LibreOffice 非零退出、超时、没有产出 | 同样改用 Java 转换 | 不说明原转换失败或已降级 |
| Java 分支找到可用字体 | 抽取段落、表格、图片重新画 A4 | 不说明原分页/页眉脚等可能丢失 |
| Java 分支没有可嵌入中文字体 | 退 Helvetica，过滤无法编码的字符 | 仍可成功生成缺字 PDF |
| 最终转换/保存抛错 | 返回异常，前端约 3 秒提示 | “Word 文档「…」转 PDF 失败: …”或“保存 PDF 文件失败: …” |

**实际复现：** 主任务用合成 DOCX“合同金额 CNY 100”，直接执行当前 Java 降级方法，并令字体发现返回空；得到 1 页、762 字节的非空 PDF，抽取内容只有 `CNY 100`。这证明缺字体时可静默丢中文；不意味着用户本机或所有 Windows 都缺字体。探针隔离的是 Java 分支，没有卸载本机 LibreOffice/字体，也没有操作真实项目。

Java 降级只遍历正文段落/表格并简化样式，未完整处理页眉脚、脚注、分节、纸张与页边距、域及原分页。现有测试主要查文件存在、非空、页数，不能发现这种损失。

Mac 只认 `/Applications/LibreOffice.app/Contents/MacOS/soffice`，另有 `/usr/bin/soffice`、`/usr/local/bin/soffice`；Windows 只认 `C:\Program Files\LibreOffice\program\soffice.exe`。不搜索 PATH、用户 Applications、自定义盘符或 Program Files (x86)。发现判据仅文件存在且可执行。

**编辑器菜单“导出 PDF”是另一条路径：** 已内置的 LOWA/WASM 引擎执行 `export_pdf`，不需要用户另装桌面版 LibreOffice。这是优先统一转换体验的方向，但右键转换还需处理未打开文件、引擎装载和当前编辑保存状态，不能仅替换一个调用。

## 3. 功能与依赖总表

“内置”指正式安装包应携带；包损坏仍可能启动失败。“按需”指应用有自己的下载/解包流程。“另装”指当前没有托管安装流程。

| 功能 | 依赖及分发 | 未安装/不可用时的实际处理 | Mac / Windows 差异 |
|---|---|---|---|
| 主程序、本地数据库、项目版本 | Electron/Chromium、JRE、H2、JGit：内置 | 壳管理后端启动/恢复；不应要求用户先装 Java、Git、Node | 基础运行时为 Mac ARM64 / Windows x64；Windows ARM壳使用x64后端兼容链，另验 |
| Word/Excel/PPT 编辑与编辑器导出 PDF | LOWA WASM、内置替代字体 | 引擎资源缺损需恢复应用；不是检测本机 Office/LibreOffice | 共用 WASM；系统字体不同仍影响显示/替代 |
| 右键 Office 转 PDF、混合文件合卷 | 可选本机 LibreOffice；Java/POI/PDFBox备用；字体 | 静默重排，缺字体有丢字风险；无安装引导 | 固定路径发现范围不同，见上节 |
| PDF 预览、拆分、提页、旋转、合并 | Chromium/PDFBox 等内置 | 格式/加密/权限错误；不需 Poppler/Ghostscript | 共用实现 |
| PDF 中文替换、中文页码 | 可嵌入且覆盖文字的 TrueType 字体 | 明确拒绝，但只给字体配置键，缺用户修复入口 | 系统字体候选与系统盘硬编码不同 |
| 图片、普通音视频预览 | Chromium 解码器；转写抽音轨用内置 FFmpeg native JAR | 文件扩展名被接受不代表所有编解码器可播；播放器失败提示 | 编解码器实际能力仍应按正式平台验收 |
| QTA 播放（本次） | 内置 FFmpeg + 安全选轨 | 临时转码；多层/损坏/组件错误分别解释 | 共用逻辑；本轮实测 Mac，Windows 原生库运行未验 |
| 压缩包预览/解压 | commons-compress/xz/junrar：内置 | 格式能力限制；RAR5 不等于缺 WinRAR | 不要求用户安装 7-Zip/WinRAR |
| 演示文稿生成、文本 PDF→Word | 内置 CPython + `pptx-runtime`（pdf2docx/PyMuPDF 等） | 可弹组件准备卡；已装转换失败需同意结构级降级 | 两平台有资源包；不依赖本机 LibreOffice |
| 扫描 PDF→Word | `pptx-runtime` OCR入口 + `mineru-runtime` + MinerU模型 | 当前错误提示只检查/引导 MinerU，漏了 pptx 前置 | 两平台都有相同串联遗漏 |
| 本地文档解析/OCR | `mineru-runtime` + 约3GiB模型 | 按需下载；运行失败可能直到首次真实解析才出现 | CPU路径；模型/DLL/权限须各平台验收 |
| 本地朗读 | `kokoro-runtime` + 约380MB模型 | 组件管理下载/启用；失败提示缩短文本或生成失败 | 模型懒加载，健康接口不证明合成成功 |
| 本地录音转写 | `asr-runtime` + 约1.5GiB Whisper模型 | 已区分运行时缺失/模型缺失/服务未启动；可下载安装 | CPU/int8；Windows原生库另验 |
| 截图/图片云OCR、云转写/模型能力 | 云服务/平台额度或用户配置 | 配置、网络、额度错误；不是本机安装问题 | 不要求 Tesseract/Docker；依赖供应商可达性 |
| 诉讼可视化、流程图、draw.io | 内置Python + `litigation-visual`，含Graphviz/静态资源 | 包可准备，Python/引擎失败返回错误；PNG主流程Batik内置 | 包含两平台Graphviz闭包，需真出图验DLL |
| 时间轴“溯源索引.docx” | PATH Node + npm docx：未托管 | 失败打印“溯源索引没写成”，主图仍可能成功 | 两平台干净环境都可能缺，不能只验主图 |
| AI 执行 Python 脚本 | Docker及运行中的daemon、容器镜像、脚本所需Python包：另装/容器下载 | `docker version`失败隐藏工具；无安装引导；结果缓存到后端重启 | Mac/Windows都需Docker实际启动；Windows虚拟化/权限未实测 |
| 腾讯会议集成 | @tencentcloud/tmeet、Node、OAuth：另装 | 提示CLI未找到；没有应用内下载/安装/修复流程 | Mac固定路径+PATH；Windows npm `.cmd` 启动未见专门适配 |
| DPIA可选插件报告 | Node20+、独立Python及docx/pypdf/pdfium/reportlab、LibreOffice，中文PDF模板需字体：另装 | 插件设置可填路径，依赖检查阻断；无一键安装 | 默认python3/PATH不等于Windows已可执行；LO仅部分标准位置 |
| Office/WPS任务窗格 | 已安装且版本能力符合的 Office/WPS、网络加载及账号 | 插件安装器只装插件清单，不安装/购买办公套件；能力不足回unsupported/version提示 | 宿主API版本差异，不能把桌面LOWA可用等同任务窗格可用 |
| 录音/截图/文件访问 | OS权限、设备、可写磁盘 | 应引导系统权限或换位置，不应误称“缺依赖” | macOS隐私授权、Windows设备/权限不同；未逐项真机复验 |

补充条件路径：PPT翻新 Python API 直接执行 PATH 的 `libreoffice`，与右键转换的发现规则不同。缺失报 `LibreOffice not found. Please install LibreOffice for PPTX support.`；120秒超时报 `PPTX to PDF conversion timed out`。该API本轮未证明当前桌面UI可达，不作为右键必经路径。PDF转图的PyMuPDF缺失时还有pdf2image/Poppler备用路径，未见安装引导；标准pptx包已带PyMuPDF。

## 4. 能否直接下载、安装后是否真的可用

### 应用托管的组件：能下载并自动解包，但应补功能验收

当前链路为：识别平台/版本 → 两站清单与 Ed25519 验签 → `.part`断点下载/换镜像 → 归档SHA-256 → 受限解压 → 包内逐文件校验 → 完成标记及原子current切换 → 模型下载（如需）→ 启动本地服务。失败不会把半成品当作新版本激活；不在用户机器临时运行pip/npm安装一套环境。

2026-10-21线上小文件核验：两站10份清单及签名可取且验签正确；30个归档HEAD为200，长度符合清单。随后在隔离目录调用真实 `NativePackService.install`，完成 Mac ARM64 的 `litigation-visual` 1.1.3 下载、验签/哈希校验、解压及激活（3个组件、2579个文件），再调用包内 Graphviz 将合成关系图生成2051字节SVG，退出码0。这证明该平台该包的安装和最小出图路径可用；**没有安装数GB模型、没有Windows干净机功能验收**，不能据此承诺全部组件安装后都可用。

| 组件包 | 清单版本 | Mac下载约MiB | Windows下载约MiB | 额外模型 |
|---|---:|---:|---:|---|
| pptx-runtime | 1.0.1 | 187.71 | 163.87 | 无 |
| mineru-runtime | 1.0.0 | 216.09 | 246.05 | 约3GiB |
| kokoro-runtime | 1.0.1 | 182.77 | 238.43 | 约380MB |
| asr-runtime | 1.0.0 | 54.89 | 83.67 | 约1.5GiB |
| litigation-visual | 1.1.3 | 21.50 | 28.14 | 无 |

磁盘应另计解压空间、模型空间、临时包和旧版回退空间。当前不是所有大组件都会首次自动下载；四个Python包按需准备。

已证实/已核对的缺口：

1. **模型损坏仍显示已装。** 主任务用纯临时目录复跑：只有`.aiworkdeck-complete`，无模型文件，仍`installed`，重下返回`already installed`。界面把该异常当成功，因此“重试”不能修复此状态。
2. **就绪检查过浅。** 服务主要确认TCP端口；ASR健康检查只粗看model.bin，Kokoro健康/音色表不加载模型。动态库或权重错误可能留到首个业务请求。前端还允许`ok:false,disabled:true`进入ready，需要在修复时明确禁用语义。
3. **模型下载缺少停滞上限。** runtime有读超时及前端停滞处理；模型阶段等待done/error，没有相同的整体/无进展超时。可取消，但不等于会自动失败并说明原因。
4. **模型完整性弱于runtime包。** ModelScope读取可变master，HF下载未固定revision；自研ModelScope下载器按同大小复用缓存，元数据未提供SHA时无预期哈希可比对；没有一套固定模型版本/完整清单。需要修复校验入口，不建议每次启动重算数GB哈希。
5. **除本轮Mac Graphviz最小出图外，各模型及Windows可执行性尚未通过完整业务探针证明。** 已有pack CI会启动服务或查health/docs，但不等于实际完成短语音转写、中英合成、OCR和出图。签名正确也不等于DLL能加载。

构建上游还有固定tag但未锁预期SHA的CPython/draw.io下载、未用require-hashes的pip锁文件，以及随brew/choco版本封装的Graphviz；这属于构建可复现性，不应误写成“客户端没有验签”。

### 必须用户另装的软件：现在多为提示，尚无完整安装闭环

LibreOffice、Docker、Node/tmeet、DPIA运行环境没有统一托管安装。建议：产品自有组件继续应用内下载；第三方完整应用给官方安装入口和平台步骤，安装后点“重新检测”，运行最小任务确认可用再恢复原操作。涉及系统安装器、管理员权限或供应商许可时，不能把“打开下载页”写成“已安装”。对路径可配置的软件，支持选定已有安装位置。

对 Word→PDF，优先评估复用内置LOWA，减少外部LibreOffice依赖；若保留native后端，应统一发现器、检测版本/试运行，明确格式保真要求。不要默认给每位用户再装一套办公套件。

## 5. 失败时现在会说什么，建议怎样改

| 场景 | 当前原文/表现 | 应有的下一步 |
|---|---|---|
| 右键Word→PDF缺LO | 无缺失提示，继续降级 | 用内置引擎；不能完整转换时阻断/明确选择文字版，不静默成功 |
| 中文PDF编辑缺字体 | “替换文本含中文但未找到可用的 CJK 字体。请配置 external.pdf-edit.cjk-font-path 指向一个 ttf/ttc 字体文件。” | 提供可用内置字体/选择字体，做一次嵌入验证 |
| 组件来源不可达 | “资源包清单不可达: …” | 重试/切换来源，保留详细错误 |
| 网络停滞 | “下载中断：N秒内没有收到新数据” | 可重试/续传，模型阶段也统一适用 |
| 签名/校验失败 | 清单验签失败、文件校验失败等 | 停止安装、换可信镜像或重新下载，不绕过校验 |
| 解压/磁盘写入失败 | “解压失败: …”“安装落盘失败: …” | 区分空间不足/权限/被占用，显示目录与所需空间 |
| 模型仅有完成标记 | 显示已安装，重下already installed | “组件文件不完整”，验证并修复，不让用户手删目录 |
| 服务或DLL启动失败 | service start failed/原始错误短尾；部分模型错误归“网络/空间” | 区分运行时、模型、架构、权限、端口，提供修复入口 |
| 扫描PDF→Word入口缺pptx | 提示确认MinerU已下载启动 | 按pptx→MinerU→模型的真实依赖顺序准备 |
| tmeet缺失 | “未找到或无法执行 tmeet CLI，请确保已安装 @tencentcloud/tmeet” | 图形化指引或受控组件包；Windows完整验证shim/Node |
| DPIA缺Node | “无法启动 DPIA 运行环境，请检查 Node.js 路径设置” | 路径检测、版本验证、安装指引 |
| DPIA缺Python包/LO | “Python 缺少 …，请安装插件 runtime/requirements.txt。”/“未找到 LibreOffice；请安装并在插件设置中指定 soffice 可执行文件。” | 托管虚拟环境或面向用户的准备向导 |
| Docker缺失/未启动 | 隐藏run_python；若直接调用则说明没有可用Docker，只影响脚本、不影响读文件 | 设置里解释能力未启用及官方安装/启动入口，装好可重新检测而非必须重启 |

OCR数据去向另有一处需要同步修正：扫描PDF工具文案称“文档不出本机”，但pptx-service的FileParserService在本地失败且配置MINERU_TOKEN时允许云上传。本文仅确认源码条件路径，没有触发任何用户材料上传。应以用户选择和实际provider决定文案与执行，不因缺本机组件静默改变数据去向。MinerU自身缺模型是否会尝试联网尚未抓包实证，不把风险推断写成已发生上传。

## 6. 建议的处理顺序与验收条件

1. **先防止错误产物冒充成功：** 修Word→PDF静默丢字/重排；合成文档必须核对中文、页眉脚、页码、表格图片和分页，不能只查非空。同步纠正“本地OCR”文案与实际去向。
2. **打通真实依赖链：** 扫描PDF先确认pptx入口，再MinerU运行时与模型；统一LO路径检测；时间轴索引、tmeet、DPIA明确依赖并接入准备流程。
3. **统一“准备组件”体验：** 缺什么、下载量/空间、来源、进度、取消、重试、检测现有安装、错误详细信息；避免只有三秒提示和内部配置名。
4. **把安装完成升级为功能可用：** runtime/模型可验证与修复，启动后执行最小合成任务；模型下载加停滞超时。下载完成但自检失败不得显示ready。
5. **两平台干净环境验收：** Mac ARM64与Windows x64分别在无系统LO/Node/Python/Docker条件，测首次使用、下载安装、取消续传、断网、磁盘不足、非管理员权限、自定义目录/系统盘、删除模型文件后的修复。Windows ARM兼容路线单列；不以Mac开发机替代。

## 7. 本轮验证与未验证

- 主任务：实际应用Java降级无字体探针复现丢中文；模型标记空壳复现；读取关键源码并核对代理审计；37项桌面组件相关测试、98项媒体/路由测试通过。
- QTA实现：Java相关测试覆盖原下载权限/Range、QTA/视频转写、原生转码、组件/文档测试；去重98项通过（含后续错误包装回归）。新增路径测试覆盖无权限、成功流清理、失败清理、分层拒绝、超时与原生加载错误。旧HEAD同一QTA打开断言为红。
- 主任务浏览器：真实编译的工作台+合成API，点击QTA进入播放器、播放真实转换所得MP3（readyState=4、播放结束无媒体错误）、显示422处理提示、切回正常文件错误清空。数据API被替身隔离，不声称完整真实后端浏览器E2E。
- 用户指定QTA：真实本机转换与源哈希不变；只取格式元数据，没有转写、上传或将内容纳入仓库。
- 线上清单/签名GET与归档HEAD通过；实际Mac诉讼可视化包安装及Graphviz合成图输出通过。未做GB模型安装/推理。Windows源码/平台清单已审，未做Windows干净机真实安装与UI操作；未发版或升级用户客户端。

## 8. 源码导航

行号依据审计基线，后续新增QTA接口会改变FileController位置。

- 右键转换：`frontend/src/components/FileTree.vue:2471`、`utils/fileTreePdfActions.js`、`services/api.js:2217`；`backend/.../controller/ProjectFileController.java:594`、`service/ProjectFilePdfService.java:263,369,666,720,913`。
- 内置导出/字体：`frontend/src/components/LibreOfficeEditor.vue:930`；`backend/.../service/ai/PdfEditService.java:423,761,1084`。
- PDF→Word/OCR：`backend/.../service/ai/tools/PdfTools.java:501,527,540,644`、`service/PptxServiceClient.java`；`pptx-service/backend/services/pdf_convert_service.py`、`file_parser_service.py:446`、`controllers/project_controller.py:1171`。
- 组件：`backend/.../service/pack/NativePackService.java`、`OptionalComponents.java`；`desktop/main/services/pysvc-runtime.js`、`model-manager.js`、`model-fetch.py`、`service-manager.js`；`frontend/src/composables/useOptionalComponents.js`。
- 额外工具：`backend/.../service/ai/tools/PythonTools.java`、`service/tmeet/TmeetCliService.java`、`service/ai/LitigationVisualService.java`；`litviz/skills/mqc-timeline-master/scripts/pipeline.py:1168`；`official-plugins/dpia-workbench/{manifest.json,runtime/render.py,backend/src/main/java/com/aiworkdeck/plugins/dpia/DpiaRuntime.java}`。
- 平台分发：`desktop/package.json`、`scripts/prepare-python-service.js`、`scripts/prepare-graphviz.js`、`.github/workflows/pack-release.yml`。公开组件入口为两站`/plugin-packs/<id>/manifest.json`。
