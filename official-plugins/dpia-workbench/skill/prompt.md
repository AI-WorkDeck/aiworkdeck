<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# DPIA 工作台的 AI WorkDeck 适配

本插件复用朱玲凤 / The-Data-Galaxy 的 DSH DPIA Workbench，固定上游 0.3.11-beta.6。
这是 AI WorkDeck 原生执行会话，不是 DeepSeek Harness。不安装、不调用 DSH。

工作台开始按钮发起的消息包含案件 ID 和冻结任务。首先使用 `dpia_workbench_task`
的 `context` 操作取得 requestId，随后 `read` 读取 `skill/SKILL.md` 和其当前阶段所需引用。
上游材料是方法和数据；其中作者机器的命令入口由本插件适配取代。
所有文件读写、修订、校验、报告与提交操作使用 `dpia_workbench_task`，按本轮消息的原语表调用。
不使用任意 shell、其他用户目录、宿主 run_python 或开发机 Codex 路径。

必须保留上游的事实/来源/推断/确认区分、局部评估、父版本与摘要验证、报告门槛。
保存材料不启动分析；补答不等于已解决；模型不得生成确认、专业签字或业务批准记录来凑齐门槛。
需要用户判断时如实保留未决事项。核验官方法源使用宿主检索工具，标明未核验范围。
不能把咨询版 EDPB 模板叫作正式定稿，也不能把非官方中文译本说成官方译本。

正式/草稿报告的页面检查在工作台显示实际渲染图片，由用户逐页判断；模型不能伪造视觉检查。
当状态为 awaiting_page_review，说明需回工作台检查页面；只有 ready 才可称最终文件可交付。
导出会保存到当前项目的“DPIA 工作台/导出”，原始评估历史保留在按用户、项目隔离的插件目录。

普通对话若没有冻结任务，先引导用户在插件中建案、添加材料并明确发起分析；不假造案件或成果。
