# 真实模型与原生 Excel 工具验收（2026-10-28）

本次验证通过真实 OpenRouter 模型 `qwen/qwen3.7-flash`、实际 Office.js 宿主及产品 `hostBridge.executeCommand` 完成。测试范围仅为本轮合成文件；没有替换 Office API，也没有伪造模型回执。**这不是产品账户、产品聊天界面的完整端到端验收**；使用隔离测试面板和临时内存代理调用真实模型。

## 结果与证据

成功轮次始于 09:21:09 UTC。6 次真实模型响应中，前 5 次依次调用 `excel_manage_sheets`、`excel_set_values`、`excel_set_formulas`、`excel_add_chart`、`excel_get_range`，原生执行回执均成功；第 6 次模型根据读取结果报告完成。供应商回报本轮合计费用为 0.000354662 USD。

新建 `AWD_AI_QA` 工作表，A1:C1 为 Item / Units / Revenue，A2:B4 为 Alpha/2、Beta/3、Gamma/4；C2:C4 是 `=B2*10`、`=B3*10`、`=B4*10`，原生计算值为 20、30、40。图表 `AWD_AI_Revenue` 为 ColumnClustered，标题 AI QA Revenue，数据引用 A1:C4。

09:21:31.941 UTC 是**测试程序**调用真实 `file_save` 成功的时间，模型未请求保存。主任务实际关闭原生窗口、经打开文件流程重开；随后独立原生读取的证据时间为 **09:22:30.922 UTC**（以 JSONL 精确时间为准），值、公式和图表仍正确。原有工作表的值、公式、图表名称和类型在测试前后相同；该比较没有覆盖全部格式、对象或二进制内容，不能据此声称全文档无变化。

本代理独立解包磁盘文件，核对 workbook relationships 指向的真实 sheet4.xml、drawing 及 chart5.xml：12 个单元格数据正确，三条公式与保存缓存值均正确，图表名、标题、col/clustered 类型及 Revenue 系列 C2:C4 引用完整。

- 文件：`/tmp/awd-native-excel-qa-20261028/AWD-Native-QA-AutoOpen-20261028.xlsx`
- 大小：41802 bytes
- SHA-256：`a839a854ed804a077e37443ff7a2b5572365a2173a00d311d392fe943c368ce2`
- 实际模型响应、原生回执、保存与重开读回：`/tmp/awd-native-excel-qa-20261028/native-evidence.jsonl`，筛选 `suite=real-llm-native-excel`
- 无凭据的请求元数据：`/tmp/awd-native-ai-qa-20261028/proxy-metadata.jsonl`
- 独立复核结果：`/tmp/awd-native-ai-qa-20261028/saved-xlsx-verification.json`
- 只读复核脚本：`python3 /tmp/awd-native-ai-qa-20261028/verify_saved.py`

## 失败记录与边界

09:13 首次调用上游返回 HTTP 404，未产生任何模型工具操作。目录显示供应商支持工具，但不支持所发送的 `parallel_tool_calls`；代理又配置 `require_parameters=true`，因此存在端点过滤冲突。移除该可选参数、保留代理单工具硬校验后，新轮次成功。首次日志没有保存上游错误正文，所以参数过滤是有目录证据支持的诊断，不能当成已取得服务端完整错误原因。

代理限制每轮最多 6 次请求、120 秒、单次最多 2048 输出 token、并发 1、不自动重试、供应商价格上限，并拒绝限定工具和范围以外的执行。凭据仅从总表登记的原位读取到代理进程内存，不发送浏览器、不写测试脚本或审计。完成复核后停止代理以清除进程内凭据。

本轮不覆盖真实模型驱动 Word/PPT/WPS，也不替代这些宿主各自的原生编辑验收；不证明产品账号鉴权、模型路由、对话流或跨窗口会话全链路。
