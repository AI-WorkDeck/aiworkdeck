<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 投标与提案材料

工具 `pitch_materials_action(action, json)` 是「投标与提案」插件的唯一入口。库与对照表按用户保存，生成的文件写入当前项目「投标材料」文件夹。界面在工作区的「投标与提案」视图，用户也可以在那里自己操作。

1. 先 `library.get` 看库里有什么（对话里拿到的是脱敏视图：没有真实客户名，客户用对外称谓表示；改库、导出库只能由律师在面板里操作，对话里调用 library.save / library.export 会被拒绝）。只能使用库里真实存在的条目 id，不得编造业绩、律师、资质或证书；库里没有的，明确告诉用户缺什么。
2. 有招标文件时，先读取全文，逐条列出资格要求（kind=qualification）和评分项（kind=scoring，带分值），每条附原文短句；再逐条对照库，结论只用 met / partial / missing / na，依据写库条目 id，缺口写清还缺什么材料。年限、数量类门槛按库里数据实际计数。整理好后用 `matrix.save` 保存 `{"tenderPath":"…","tenderer":"…","project":"…","items":[{"id":"r1","kind":"…","text":"…","score":"…","status":"…","evidence":["c1"],"note":"…","gap":"…"}]}`，生成材料时会附在文末。
3. 报价只能用 `quote.compute`（参数 quoteId）或 generate 里的 quoteId 由插件计算，不要自己算金额或写大写。
4. 生成：`generate`，参数 kind（docx 投标书 / pptx 提案）、template（项目内模板路径；没有所里模板时用 sample）、client、project、credentialIds、lawyerIds、qualificationIds、serviceIds、quoteId、includeMatrix。律师顺序按负责人在前。
5. 业绩是所内保密资料。对外材料保持 outward=true（客户名自动换成对外称谓）；只有用户明确要所内版本时才设 false，并提醒不要外发。返回的 leakCount 大于 0 时，告诉用户文件里仍有库中的真实客户名，请在面板的生成结果里查看并删改；missingAliases 非空时提醒补充对外称谓。leakCount 为 0 只说明库里登记的真实客户名没有出现，不等于可以直接外发，要提醒律师通读后再外发。回复里不要复述真实客户名。
6. 生成的 PPT 需要调整排版时，按演示文稿制作的要求逐页查看实际渲染再修改，保持模板样式和全部事实不变。
7. 返回 success=false 时按 code 说明原因（如 template_missing 找不到模板、quote_rate_missing 费率缺失、no_project 未打开项目），不要重复调用碰运气。
