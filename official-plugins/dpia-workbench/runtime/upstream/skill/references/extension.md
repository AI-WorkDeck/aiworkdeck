# 扩展规则包
先读assessment-requirements.md：每条required_facts必须展开成具体问题、活动/阶段及可接受证据，并在assessment_plan绑定。通用字符串不是完成标准；模板crosswalk不能替代规范要件。新增国家/行业不沿用其他国家的事实阈值。
新增法域时不复制已有法域法律结论。先核定地域/主体适用、数据分类、触发、例外、最低内容、意见/审批、监管程序、复评以及专项接口。每条rule含id、jurisdiction、kind、title、legal_force、source_refs、required_facts、logic、exceptions、output_field和version。
把官方原文、译文、发布日期/生效日/版本状态分别保存；法律效力statute/regulation/guidance/draft/internal_method分开。来自博客或开源Skill的语句不能登记为官方法源。保留访问失败、版本待核和原文/译文歧义。
包使用相同schema和未知状态，不通过多写“兜底条款”声称覆盖全部法域。增加模板时逐字段crosswalk，保留原标签、输出位置、必填条件和证据引用。
企业政策独立存放；比法律严格可补充，放宽不能覆盖法定底线。schema、规则包、模板与风险矩阵均带版本，变更运行依赖检查和反例测试。
完成扩展须测试：应触发、无需触发、有例外、事实不足、法源不全、特殊程序、正常运行影响、假控制。测试输入与预期结果隔离，实测记录区分人工评价/模型运行/确定性程序结果。

程序从jurisdictions/*/rules.json动态发现法域，JSON中的法域代码为开放字符串，但validate拒绝没有规则包的代码。新增时登记sources.json并加载该法域参考文件，初始化程序将实际规则包版本写入meta.rule_pack_versions。EU专属指标与例外逻辑不会套用到其他法域；若新法域需要特殊聚合/例外逻辑，扩展screen并添加反例测试后才启用。模板map同样显式新增。
