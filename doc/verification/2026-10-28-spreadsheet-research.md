<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Excel 成熟项目方法研究与验收矩阵

日期：2026-10-28。范围：AI WorkDeck Web Office、Office/WPS 插件的表格读写与编辑。研究只借鉴契约和测试方法，没有复制这些项目的代码、测试数据或技能提示词，也没有引入运行时依赖。星数是调研当日 GitHub API 快照，不代表质量认证。上游测试设计已阅读；未在本机运行这些上游测试。

## 来源、许可与维护证据

| 项目 | 星数 | 默认分支 HEAD（调研快照） | 许可证据 | 维护证据与适用限制 |
| --- | ---: | --- | --- | --- |
| [ExcelJS](https://github.com/exceljs/exceljs) | 15,504 | `5bed18b45e824f409b08456b59b87430ded023ab` | 仓库 API 标识 MIT | HEAD 提交 2024-01-12，仓库 pushed_at 2025-01-21；二者含义不同，不能称为近期活跃。文件读写库，不是 Excel 计算引擎。 |
| [ClosedXML](https://github.com/ClosedXML/ClosedXML) | 5,746 | `057f5976c788d97e8eac86d1a528bd5411d9386e` | 仓库 API 标识 MIT | HEAD 2026-10-21；可参考公式依赖和文件回读测试，不应直接代替宿主计算语义。 |
| [Excelize](https://github.com/qax-os/excelize) | 21,021 | `a33694a7c10d1ef9dc947a5b6b57a3aa1e5528f0` | 仓库 API 和 README 标识 BSD-3-Clause | HEAD 2026-10-26、pushed_at 2026-10-27；流式读写、大文件及错误路径测试丰富，Go 库不是插件宿主。 |
| [OfficeDev office-js-snippets](https://github.com/OfficeDev/office-js-snippets) | 280 | `347a7150a4fefd23334f3bfca8a0d9305c707363` | package.json 声明 MIT；GitHub license 字段为空，根目录未见独立 LICENSE | HEAD 2026-10-27；官方 API 使用范例和运行时检查方法。这里仅学习调用方式，不复制代码。 |
| [SheetCopilot](https://github.com/BraveGroup/SheetCopilot) | 165 | `09d38708a17e6a8a2aac25084849b929de3f04f2` | 仓库 API 标识 GPL-3.0 | HEAD 2026-06-25；代理闭环和结果评估研究，不是生产级 Office/WPS 适配器。 |

上述提交可通过各仓库 `/commit/<SHA>` 固定定位。所有仓库当日 archived=false；pushed_at 不是维护承诺。没有因“高星”而扩大依赖或复制授权范围。

## 可直接落实的方法

1. **值、公式、显示值分开验收。** [ExcelJS Formula Value](https://github.com/exceljs/exceljs#formula-value) 明确不计算公式，缓存结果须另行提供，公式函数用英文、参数用逗号。不能以 ExcelJS 写出的缓存结果证明公式算对了。[ClosedXML 当前公式计算文档](https://github.com/ClosedXML/ClosedXML/blob/develop/docs/concepts/formula-calculation.rst) 区分 dirty 依赖、计算链和加载缓存：读取成功不代表重新计算成功。我们的用例须同时断言公式文本、值类型、宿主重算后的结果。
2. **内存读回与保存重开分开。** [ExcelJS workbook 集成测试](https://github.com/exceljs/exceljs/tree/master/spec/integration/workbook) 分离样式、工作簿、图片、透视表；[Excelize stream_test.go](https://github.com/qax-os/excelize/blob/master/stream_test.go) 包含 Flush、SaveAs、OpenFile、读取值，以及越界、临时文件关闭、损坏 XML 等错误路径。我们的成功标准应包括文件重开、非目标内容仍保留；不能仅检查返回 success。
3. **边界测试先于扩大读写范围。** Excelize 的流式测试同时覆盖大量行和列越界。插件应先验证目标范围尺寸、矩阵维度和支持能力，再读取整片宿主数据或写入。大范围分页必须显式说明完整性与截断，不能静默返回前 100 项并称为完整。
4. **宿主 API 示例验证的是调用契约。** [OfficeDev tests](https://github.com/OfficeDev/office-js-snippets/tree/main/tests) 将编译、库校验、运行时执行分层；README 要求依赖版本固定。我们的 mock 证明分支与参数逻辑，官方 requirement set 证明 API 可用范围，真实 Office/WPS 才能证明最终效果，三者不能混写。
5. **执行率与正确率分开。** [SheetCopilot README](https://github.com/BraveGroup/SheetCopilot) 区分 Exec@1（执行并产出文件）与 Pass@1（属性满足参考结果）。评估涵盖单元格值/类型/字体/填充、条件格式、筛选、冻结、图表和透视表。其评估存在按工作表索引配对、连续表从 A1 起始等假设，不能套到我们的具名工作表、稀疏表和非 A1 区域。README 报告的自检结果仅为上游报告，不是本项目复现。Linux 评估采用 openpyxl 和 LibreOffice UNO，也不能等同于 Windows Excel 原生验证。

## 本项目可执行验收矩阵

下列为验收要求/建议，不表示每项已通过。已完成证据必须在本轮测试记录中附实际命令、结果和宿主版本。P0 应优先落实到本轮自动化；涉及宿主显示、重算和文件保真的行必须另做真实宿主验证。

| 优先级 | 场景 | 输入设计 | 结果断言与失败断言 | 层级 |
| --- | --- | --- | --- | --- |
| P0 | 公式完整读取 | 至少 101 个公式；空白、常量夹杂；多个工作表 | 完整集合或明确分页/截断；分别返回公式和计算值 | worker/插件行为测试 |
| P0 | 精确范围与矩阵 | 命名表、带空格表名、非 A1 区域、ragged 二维数组 | 目标唯一；非法矩阵在首个写入前失败；邻格不变 | worker/插件行为测试 |
| P0 | 类型保留 | 数值 1、文本 001、布尔、空值、错误值、日期格式 | 值类型及显示格式分别断言，不能全部 String 化 | 行为测试 + 文件重开 |
| P0 | 稀疏大表 | A1 和极远单元格有值，格式覆盖整列 | 先算范围预算再读宿主；不靠先加载全部值再截断 | 宿主 mock 计数 + 实机性能 |
| P0 | 写前校验 | 错误验证类型、缺少公式/双边界、缺失透视字段 | 零宿主写入；错误可理解且已翻译 | 插件行为测试 |
| P0 | 并发旧目标 | 读取后改名/删除表，或预期文本变化 | 明确拒绝旧目标；不回退修改当前活动表 | 行为测试 |
| P0 | 公式保持 | 替换普通文本，与公式单元格相邻 | 不覆盖公式；公式文本、计算值均检查 | worker/插件行为测试 |
| P1 | 公式计算 | SUM、相对/绝对/跨表引用、错误传播、共享公式 | 检查依赖修改后重算；不以缓存自证；本地化公式入口单独验证 | 真实三个宿主 |
| P1 | 结构调整 | 插行列、排序、复制含引用与合并单元格区域 | 引用更新、合并边界、样式继承及非目标内容不变 | 行为测试 + 重开 |
| P1 | 格式与保护 | 混合格式、部分选区、受保护单元格 | 仅修改指定属性；宿主拒绝不能回报成功 | 真实三个宿主 |
| P1 | 数据验证 | list/custom/whole/decimal/date/time/textLength；apply/clear | 读回真实规则、边界、提示及清除结果；版本不足拒绝 | 插件行为 + 实机 |
| P1 | 图表/透视表 | 具名字段、缺失字段、非 A1 数据源、已有对象 | 源范围、字段汇总、系列和标题读回；更新不误删对象 | 真实三个宿主 |
| P1 | 文件保真 | xlsx 保存、关闭、重开 | 对值/公式/样式/合并/图表/透视表做语义检查；XML 顺序变化不当失败 | 导出及重开 |
| P1 | 长任务故障 | 超时、宿主异常、部分批次失败 | 返回真实进度与失败范围，禁止“全部成功”；不可自动盲重放非幂等操作 | 故障注入 |

## 落地边界

ExcelJS/ClosedXML/Excelize 可以帮助设计独立文件检查，但任何一种都不是三宿主兼容性的替代证据。暂不新增它们为产品依赖。对 Office/WPS 不支持或未核实的能力保留真实限制和能力检测；不能注册同名命令却以空实现充数。测试样本自行构造，避免带入上游许可复杂度或用户私有工作簿。PPT 的实现与限制另见同目录 `2026-10-28-ppt-addin-parity.md`。
