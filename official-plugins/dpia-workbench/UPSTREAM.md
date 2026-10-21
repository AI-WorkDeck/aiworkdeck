# 上游来源与适配记录

- 项目：[DSH DPIA Workbench](https://github.com/The-Data-Galaxy/dsh-dpia-workbench)
- 作者：朱玲凤（The-Data-Galaxy），个人网站 https://xingchendata.com/
- 固定版本：0.3.11-beta.6，commit `66c5e11c022277625072a50765793b257a6626a7`。
- `runtime/upstream/` 为该提交源码，保留 LICENSE、NOTICE、方法与模板；
  `web-src/upstream-client.js` 是该提交 client.js 的逐字节副本。
- 该版本原创代码与文档采用 **AGPL-3.0-only**，不是网页缓存所显示的 beta.5 Apache-2.0。
  新增适配源码采用 AGPL-3.0-or-later；与上游组合分发按 AGPL v3 履行源码提供义务。
- EDPB 英文模板及非官方中文工作译本适用上游 NOTICE 的单独说明，不能据此称为我方原创或改证。
- React、ReactDOM、scheduler 的 MIT 许可全文由构建脚本收入 `web/THIRD_PARTY_NOTICES.txt`。

我方 `runtime/adapter.mjs` 在创建工作台前，统一为独立工作进程及其 Python 子进程设置
`PYTHONUTF8=1` 和 `PYTHONIOENCODING=utf-8`。这保证上游默认文本读写及 JSON 标准流
在 Windows 上使用 UTF-8；覆盖继承的旧编码设置，不修改用户系统环境或上游评估逻辑。
回归用真实 Python 读取、写回和输出合成中文，并验证继承 `PYTHONUTF8=0`、
`PYTHONIOENCODING=cp1252` 时仍正确；Windows 实际生命周期结果以对应验收产物为准。

上游唯一源码补丁：`runtime/upstream/report-task.mjs` 的两处渲染进程调用，在
`AWD_DPIA_PYTHON_RENDERER` 标记下使用配置的 Python 执行我方 LibreOffice/PDFium 适配器。
未改评估校验、来源摘要、版本采用或正式报告门槛。UI 的 DSH 加载、调用、下载与主题转换
由独立 `build-web.mjs` 完成，不改上游原始 client.js。

我方桥接不包含 DSH 服务；原会话接口映射到 AI WorkDeck 原生 Agent inbox，固定请求 ID
用于重试，数据按调用方用户和项目隔离。出站调用只有用户发起的既有模型/检索通道及
生成官方模板报告时对 EDPB 官方发布页的来源核验；不向上游作者发送评估数据。

完整来源与该版本源码在插件包内提供；上游测试通过只证明该测试的范围，不等于适配后的
真实模型质量、其他操作系统或所有模板已验收。
