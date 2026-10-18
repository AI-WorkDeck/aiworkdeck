# 数据契约与命令

## GDPR第一版入口（优先于下方历史说明）

来源/追问新增两份轻量文件`source-index.json`、`intake-review.json`，契约及必需命令见[source-trace.md](source-trace.md)。GDPR `fact-list`未提供两者或核对失败时拒绝输出；`validate`的结构通过不等于来源和问题通过。完整DPIA仍使用assessment_plan，不用轻量追问记录替代。

CLI新建仅EU，schema保持0.5.0以兼容既有对象；meta.workflow_version=gdpr-v1启用新增约束。非GDPR包和旧矩阵只供历史程序复现，不进入新评估默认命令。

- assessment_id永久标识评估；revision_id每次修订新建，parent_revision_id指向旧版。related_assessment_id只关联独立的新评估，不以相同PRD自动合并。主体尚未选定也可初始化。
- screening_confirmation独立记录本次筛查已确认的fact_ids、人类确认source_ids及digest。先向用户呈现实际筛查事实；已有授权确实覆盖该范围时按原来源复用，只补确认新增推断/冲突/变更，不因另开任务强制重新确认。再用gdpr_workflow.screening_digest(d, fact_ids)计算摘要；计算摘要不是确认，不自动制造human_confirmation。只引用该范围内的事实才能支持确定筛查结论。完整评估需求未齐不再全局阻断筛查。
- 完整事实基线仍用既有fact_baseline_*门槛，不为提前报告伪造冻结。提前报告保持draft，未知留空批注，按outputs.md制作；旧render不放宽完整门槛。
- risk_method=wp248-qualitative-v1，risks必须有legal_refs、legal_analysis、gdpr_rating及可追溯的措施/验收；格式见risk-method.md。旧数值维度留null而非零，工作报告读取定性字段，不使用自拟矩阵。
- `internal-review`是GDPR阶段性内部评估输出入口：要求来源校验及非空有依据的风险，每项关联具体action及acceptance，不要求完整基线冻结。0.7.4增加intake-review.report_topics事实呈现映射，契约见outputs.md；正文按事实、评估结果、集中整改组织，技术信息单独生成同名.audit.json。`validate`通过本身不保证可以交付风险报告（事实草稿允许risks为空）。技术索引记录assessment/source-index/intake-review整体摘要和正文摘要；实质更新回写底稿，纯呈现变化更新映射后重生成。pending_review_ids仍显示待复评，不能靠渲染清除。条件性入口不是最终筛查或完成门禁的替代品。
- revise previous.json edited-copy.json --out next.json保留原文件，新建修订ID、返回差异及pending_review_ids，清除过期确认和新版批准，受影响规则/风险改回未定。输出路径存在则拒绝覆盖。对象ID稳定不变；复核这些依赖后记录依据并逐项清理pending_review_ids，不只清空列表声称通过。
- 历史文件没有身份时需先由用户确认归属，再显式迁移、生成ID；不自动猜测。不同assessment_id的记录禁止用revise合并。每份正式报告另记report_id、对应revision_id、模板及法源版本。

工具不判断两次业务是否实质同一评估，也不自动判断法律、消除风险、处理Word批注或签发批准。

## 文件
`schemas/assessment.schema.json`约束主记录，`schemas/assessment-plan.schema.json`约束0.5需求计划；程序同时校验二者。`assessment.json`是项目状态，不是模型调用记录。状态与报告脚本只需Python3.9+标准库；官方DOCX填写工具另外需要lxml。工具不访问网络，不调用模型。
本版校验器实现此随附schema使用的type/enum/required/properties/additionalProperties/items/minimum/maximum；它不是任意JSON Schema通用实现。外部系统可以直接用标准JSON Schema验证器读取schema。

## 对象
meta：项目/版本/日期/范围/环境/角色/模板/规则包版本/法源复核说明。stage仅draft/review_ready。
jurisdictions：法律适用及其事实/法源、EU当地清单覆盖。pending与全域覆盖不同。
sources：项目证据，含标题、路径、版本、类型、定位、可选实际hash、观察日期；官方法源注册在references/sources.json，项目增补法源也可以存sources但source_refs必须指向可读取官方原文。
facts/activities/flows：稳定ID和关联，不把未知推断变成确定事实。
rule_assessments：规则ID、met/not_met/unknown/not_applicable、完整analysis、fact_ids和source_refs；对于content规则met表示已经完成该要素分析，不表示处理合法，分析可以得出不合规结论；not_met用于该必需分析未完成，不可用于表示已分析后得出不合规（后者在analysis写出并保持met）。
0.7.5的content规则可带review，分别记录progress、finding、limitations、risk_ids、action_ids；schema保持0.5.0兼容旧事实草稿，但internal-review要求逐维度显式记录，见outputs.md。新增关联参与已有递归依赖及修订待复评，不从整改状态推断评估是否完成。条件性筛查显示由intake-review.screening_conclusion引用已记录规则，不另存一份法律论证；条件与维度记录同时进入.audit.json以便复核。
controls/risks：控制证据与三种评级。程序不自动推断可能性、严重性或控制有效性。
actions/questions：责任、验收、证据、未决等级、具体合规影响及建议动作；关闭需要证据。
linked_assessments：专项状态；complete需要对应成果证据。
decisions：建议与人工审批证据分离；程序不签发批准。
changes：修改说明和受影响对象。
所有ID引用需要存在；全局对象ID唯一，规则ID命名空间独立。删除对象时先处理依赖。

## 示例调用
```
python3 <skill>/scripts/dpia.py init assessment.json --project '产品A' --jurisdictions EU
python3 <skill>/scripts/dpia.py validate assessment.json
python3 <skill>/scripts/dpia.py fact-list assessment.json --source-index source-index.json --intake-review intake-review.json --out fact-list.md
python3 <skill>/scripts/dpia.py screen assessment.json
python3 <skill>/scripts/dpia.py internal-review assessment.json --source-index source-index.json --intake-review intake-review.json --out internal-review-r1.md
python3 <skill>/scripts/dpia.py render assessment.json --out reports
python3 <skill>/scripts/dpia.py diff previous.json assessment.json
python3 <skill>/scripts/test_dpia.py
```
init拒绝覆盖。render拒绝覆盖已存在同名报告，换版本目录。validate返回JSON errors/warnings和schema_valid；exit0无错误、exit1校验失败。draft未决项为warnings并显式显示，但该输出仅为内部工作底稿；结构破坏、伪闭环证据、非法引用始终为errors。review_ready要求适用法域有完整content覆盖、结论和无blocking问题，但不代表风险已被接受，也不能替代interaction.md的实质交付门槛。模板填写脚本同样不判断可交付性。
screen缺trigger返回unknown；触发与适用性结论依赖inferred/unknown/conflict事实时按未决处理，不把手填met直接升级为required；已经确认某强制触发且法律适用时可返回required，其他缺口继续列出。EU exception与trigger冲突保持conflict；WP248数量只建议开展。local覆盖未完成不输出无条件“不需要”。适用性未知不能required最终化。
diff比较对象内容，不仅数量；遍历依赖直到稳定。meta法源/方法/模板变更触发对应重新复核，不自动写回。

## 0.2交付与国家范围
保持0.1状态文件兼容；新增meta.countries见countries.md。旧记录缺国家时draft提示，review_ready不通过。国家范围明确和当地法律核验是独立状态，候选国家不能当作已覆盖。0.2初始化不推定具体国家。
render默认只生成一份法律文风草稿，模型必须继续编辑，不自动代替法律意见；加 --workpapers 才在workpapers子目录导出五份内部记录。模板映射不代表原件输出，官方原件使用fill_official_docx.py，见official-templates.md。

## 0.3待确认事项与Word批注
0.3版引入questions的compliance_impact与recommendation，用于表达“待补充/确认—合规影响—建议”三段结构。历史0.4完整报告门槛保留；GDPR第一版按outputs.md允许用户提前要草稿时未知留空批注，不表示已确认或评估完成。旧版0.1–0.3底稿可继续读取；补建并冻结事实基线后才可进入评估。

## 0.4事实基线门槛
0.4历史文件保留其类别覆盖、全局未决项与人工确认校验语义。它不能证明0.5需求充分性；新评估或复评先迁移，不直接沿用旧门禁结果。

## 0.5评估需求契约
新建使用schema_version 0.5.0及assessment_plan。先读assessment-requirements.md。程序校验问题/需求、规则required_facts映射、值类型、活动范围、证据及实施状态、本阶段充分性；facts.assessment_impact不再必需，重要性放到需求关系。meta.fact_baseline_digest在真实用户确认后记录，用于拒绝过期基线。分类覆盖仅作人工检查，非输入或未来阶段未知项不全局阻塞。完整报告仍须通过既有实质门槛。

计划契约1.1为显式选用的兼容扩展：新增shared_requirements、问题requirement_refs及规则范围coverage_level；详见assessment-requirements.md。init使用1.1，旧计划不自动切换；使用新字段却未声明1.1时拒绝。共用需求ID参与全局引用及变更检测。EU规则的project_procedure仅控制程序引用粒度，不更新法源核验日期或法律判断条件。
