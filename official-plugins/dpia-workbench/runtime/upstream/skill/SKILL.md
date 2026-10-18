---
name: assess-product-dpia
description: 按GDPR及EDPB认可的DPIA指南提取确认事实、完成DPIA筛查、形成简洁内部风险与整改清单；按用户选择生成完整报告或缺失事实留空批注的草稿，并按稳定评估ID持续复评。
---
# GDPR DPIA 产品评估

GDPR第一版（skill 0.7.8）。实质方法以EDPB认可的WP248 rev.01 DPIA指南为主线，GDPR为法律依据；适用成员国DPIA清单及指南作当地适配，不自创替代推理体系。不默认开展沙特、英国、中国等独立法域评估；境外接收仍须检查GDPR第五章。历史非EU资源保留仅用于复现，不是本版入口。

## 开始与依据

首次读[workflow.md](references/workflow.md)、[interaction.md](references/interaction.md)、[evidence.md](references/evidence.md)和[eu.md](references/eu.md)。workflow给出指南章节定位；作实质判断前读取对应官方原文并核验适用版本。指南与模板不同，不把EDPB模板或其征求意见版本当作指南替代品。初始交互不加载全部模板字段。

## 主流程

1. **来源索引、事实确认与差额追问。** 必读[source-trace.md](references/source-trace.md)。先将PRD具体段落、用户原问原答/授权模拟材料建立索引，逐项映射事实；再对照评估需要找剩余缺口。输出先展示数据生命周期等已知事实及来源供更正，再列具体问题及其对筛查/风险判断的影响。已有内容不得整题重问；“尚未设计”进入评估与整改，不作为未答。先收集足以筛查的事实，不为正式模板所有栏目无限追问。结构见[fact-baseline.md](references/fact-baseline.md)；完整评估映射见[assessment-requirements.md](references/assessment-requirements.md)。
2. **DPIA筛查。** 按WP248 III.B及GDPR35判断需要、不需要或暂不能确定，核对实际适用成员国清单，见[countries.md](references/countries.md)。有依据不需要则留下理由与复评条件并结束本轮DPIA流程；未知不能判否。一个完整强制触发已成立即可进入下一步，不要求所有完整评估事实齐备。
3. **简洁内部评估。** 需要DPIA才进入；最终筛查尚未完成时仅可在明确条件和范围内分析已知设计，不冒充正式筛查。依WP248 III.D及附件2，交付面向业务和法务阅读的三部分报告：先固定本轮评估事实（数据生命周期、权利实现、已有措施及状态），再给筛查和各维度评估结果，最后集中列出关联风险且去重的整改清单。读[risk-method.md](references/risk-method.md)及[outputs.md](references/outputs.md)。底稿保存完整记录，不能直接导出技术字段当报告。先写入assessment.json的risks及关联actions，并在intake-review补充report_topics事实呈现映射，再以`internal-review`生成报告和独立技术索引。每风险仍须有法律、事实到个人风险的推理、级别理由及对应整改验收；已知缺陷先评估，未知仅限制相关判断。复评同样遵守。
4. **按用户选择出报告。** A：整改后补充并复评，再生成；B：现在按现状生成待完善草稿。读[outputs.md](references/outputs.md)、[report-basis.md](references/report-basis.md)，需要模板才读[official-templates.md](references/official-templates.md)。缺失事实栏位留空，不代填答案，原生批注说明待补充/确认、合规影响、建议；依赖结论未定。已确认尚未设计如实填写。报告生成不等于评估完成或批准上线。
5. **持续修订。** 同一评估沿用assessment_id，新revision_id关联旧版本。新增信息先判定归属和影响，再复评相关判断，保留旧版及证据，不默认整份重写。ID和命令见[data-contract.md](references/data-contract.md)。

## 不可混淆的边界

- 补问前按[source-trace.md](references/source-trace.md)区分实质依赖、效果验证和治理待办，并记录暂停范围。可以等待必要答复，但不能因有未答问题或基线未冻结就停止全部评估；整体暂停仅限整个评估对象无法可靠界定且不能分项/条件分析。未指定欧盟代表等通常不阻断实质分析，适用义务仍须跟踪。
- 指南决定实质评估，阶段展示、ID及版本是本产品交互/记录设计，不宣称由EDPB规定。
- 内部交付必须明确回答是否需要DPIA，条件性需要须同时展示前提及已记录触发依据，不能仅写“最终筛查未完成”。逐维度完成已有分析的归纳及review记录，区分分析进度、合规发现与措施落实；有风险论证不能被初始化的“待评估”覆盖，也不能自动当作全部维度已完成。具体契约见outputs.md。
- 合法性维度在内部评估阶段即按eu.md核对逐目的基础、特殊类别及犯罪数据；涉及终端存取时另核适用的特别规则与后续处理衔接。具体判断及其边界须进入内部报告，不能只留在筛查底稿或等到正式模板才检查。
- 材料描述、确认、观察、推断、未知、冲突及计划/实施/验证分别记录。不自行补业务设定，不用脚本把缺失需求或问题批量标成满足/已答。
- 从事实生成判断或报告时，执行[source-trace.md的事实传递核对](references/source-trace.md#事实传递核对)：保留证据状态、场景条件及动作时序。问题与Word批注共用经核对的差额，不重新概括成主题问卷。补答后同步缩小缺口和暂停范围；未提供例外材料不等于已证明例外不适用。
- 系统、部门或供应商类别不是法人或处理者。按实际决定行为分析法律角色，不让业务方回答法律结论。
- 风险针对个人权利与自由；罚款/声誉不替代个人损害。法律缺陷与风险等级分开，低分不抵销义务。停用本项目自拟4×4矩阵作为GDPR新评估默认方法，详见risk-method。
- 详细事实与推理留在底稿，对用户只展示当前需要确认或决定的内容。来源与评估判断分开，不把预写答案或其他报告混入测试输入。
- 规则快照不是实时效力保证；重要判断核验官方文本，记录日期、具体条款及未核验范围。不宣称某地全部要求已满足。
- 正式Word才调用documents能力并逐页检查；中文macOS使用用户级codex-render-docx入口。正式报告（含提前草稿）须读[report-release.md](references/report-release.md)，核对逐风险法律引用、当前等级、已知事实限定和逐字段留空批注；不能把文末法源表、集中问卷或渲染成功当成交付通过。未知选项不勾选，审批和签名不虚构，内部测试轮次不占业务版本栏。
- 不自动联系业务方、改配置、提交监管或批准处理。审阅旧报告先核对来源与版本，未经验证不继承结论。

## 最小执行入口

新建仅EU：
```
python3 <skill>/scripts/dpia.py init assessment.json --project '项目名' --jurisdictions EU
python3 <skill>/scripts/dpia.py validate assessment.json
python3 <skill>/scripts/dpia.py source-index assessment.json --source-id SRC-PRD --source-id SRC-QA --out source-index.json
python3 <skill>/scripts/dpia.py fact-list assessment.json --source-index source-index.json --intake-review intake-review.json --out facts-and-questions.md
python3 <skill>/scripts/dpia.py screen assessment.json
python3 <skill>/scripts/dpia.py internal-review assessment.json --source-index source-index.json --intake-review intake-review.json --out internal-review-r1.md
python3 <skill>/scripts/dpia.py revise previous.json edited-copy.json --out next.json
```

脚本提供记录校验、来源关联、报告生成及版本差异，不代替法律判断。筛查的确认范围独立于完整评估基线；内部局部评估不要求冻结，完整报告仍需实质门槛。提前报告保持draft，经文档能力按留空批注路径制作，不伪造frozen或review_ready。每轮明确具体阶段及未完成范围，不以孤立的“评估完成”描述部分评估。
