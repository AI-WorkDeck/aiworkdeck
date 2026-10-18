# DPIA 工作台

AI WorkDeck 的可选独立插件，基于朱玲凤的
[DSH DPIA Workbench](https://github.com/The-Data-Galaxy/dsh-dpia-workbench) 0.3.11-beta.6。
保留材料来源、事实确认与纠正、问题补答、风险和整改记录、复评历史、内部报告及有门槛的草稿/正式报告。
当前方法以 GDPR/EU 为入口，不自动等同于中国个人信息保护影响评估。

## 使用与依赖

需要包含插件会话 SPI 的 AI WorkDeck 0.65.0 或更新版本，以及 Node.js 20+、Python 3.9+。
在独立 Python 虚拟环境执行 `pip install -r runtime/requirements.txt`，把该环境的 Python
可执行文件填入插件设置。Word 转 PDF 和逐页预览还需安装 LibreOffice；插件设置可指定其
`soffice` 路径。原生 PDF 模板填写中文另需可嵌入且覆盖所填文字的 TrueType 字体，
可在“PDF 中文字体文件”中指定 TTF/TTC；Linux 可安装文泉驿正黑（fonts-wqy-zenhei）。
依赖未就绪会说明阻断；插件不暗中安装程序，不依赖开发者 Codex 目录。

安装并启用后打开“DPIA 工作台”：新建评估→登记或导入材料→开始分析→核对结果与补答→
按需复评→报告与版本。只有明确点击分析/报告生成才提交模型任务；专用 skill 将业务工具限制为本案任务与网页检索。执行过程可打开原生
AI 会话查看或取消。报告生成后在工作台检查真实页面，不以渲染成功代替审阅通过。

导出保存到当前项目的“DPIA 工作台/导出”；原始评估按用户/项目保存在宿主
`.aiworkdeck/plugin-data/dpia-workbench/`，禁用或卸载不会删除这些材料。
在团队后端上运行时数据位于该后端，不承诺所有部署形态均仅存本机。
数据明文落盘，模型和检索沿用宿主配置；模板核验访问 EDPB 官网，不上传评估材料给上游作者。

EDPB 原模板仍按上游固定版本标为咨询稿，中文工作译本非官方。生成报告不代表专业复核、
签字、监管批准或自动批准处理活动。许可、作者和模板说明见 [UPSTREAM.md](UPSTREAM.md)。

## 构建与验证

`./build.sh` 安装公开 SPI、运行 Java 桥测试、构建并验证前端、将源码与运行时打入独立 ZIP。
`DSH_DPIA_PYTHON=/path/to/python node --test tests/adapter.test.mjs runtime/upstream/test/*.mjs`
验证 Node 适配与上游核心；Python 模板回归在 `runtime/upstream/test/`。
测试使用合成材料、临时目录及隔离测试账号，不使用用户案件。

本包不随宿主源码合并自动上架或升级客户端。必须另行完成签名市场分发；不绕过宿主的
审核、签名、版本门槛或默认禁用流程。实际交付范围见开发台账 #1347。


当前验收使用合成材料：已走通冻结任务、真实 Python 校验与结果采用、补答复评、两版历史，
并实际生成 DOCX、PDF 和逐页 PNG。未完成人工页面检查时，最终交付仍被阻止。
复跑完整报告链使用 `DSH_DPIA_PYTHON=/path/to/python node --test tests/lifecycle.test.mjs`；
另运行 `python tests/test_render.py`。这些测试需要上述完整依赖；持续集成独立执行报告链。
未以真实模型检验法律分析质量，也未将合成测试记作专业复核或用户验收。

宿主 `DpiaPluginInstallationTest` 使用本目录构建出的 ZIP，在独立临时 HOME 的 JVM 中验证
真实 JAR 装载、宿主注入、随包 skill、原生任务入口、用户/项目隔离及停用。
它先确认 0.64.1 拒载，再以 0.65.0 开发宿主配置验证；模型和仓储使用替身，
不代表市场签名安装已通过或现有客户端可用。构建 ZIP 后在 backend 运行
`mvn -Dtest=DpiaPluginInstallationTest test`；未构建包时该测试明确跳过。
