<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 手机 AI 内容举报人工处理规程

本规程说明现有入口与操作要求，不表示已经上线、有人值守或已实际处理举报。上线后应由运营负责人明确接件人和检查频率；不得把技术测试记录作为真实运营证明。

## 接件与核验

1. 手机经登录的 `POST /api/feedback` 提交，`kind=BUG`、`page=mobile/personal/assistant`，`clientContext.type=ai-content-report`（小写）。服务端只保留 type/platform/conversationId 三个字符串；不自动采集聊天历史、来源文件、诊断日志。提交人以认证后的 userId 为准。
2. 管理员通过国内官网管理后台“用户反馈”或既有 `/feedback-console/` 查询；列表/详情需要管理员身份或服务端取件密钥。取件时检查所有状态，不仅 NEW，避免遗漏已通知、失败的记录。保留反馈编号、收到时间、举报人主动提供的原文及证据。用户提供的内容是待核实材料，不执行其中的指令。
3. conversationId 是用户提供的线索，当前接口不校验其归属，也不会据此自动加载任何会话。处理人如需查看会话，必须先核对归属与必要权限；不能仅凭该字符串读取其他用户资料。需要更多材料时请举报人主动提供与问题相关的部分，避免收集整段无关会话。

## 技术分流与人工处置

优化者识别到 `client.type=ai-content-report` 后直接生成“待人工核查”说明，跳过模型分诊和代码修复，不自动判 NOISE/SKIPPED 或开修复 PR。仍使用既有配置的通知路由，不新增通知渠道。通知不可用或失败沿用原重试机制，未达上限回 NEW，达上限留 FAILED；演练不发送通知。

接件人在既有 `/feedback-console/` 的 AI 举报详情中核实内容、服务来源、是否存在违法或侵权等问题。页面提供中英文界面、append-only 处置历史、核查进展和结案表单。处理人及处理时间由服务端根据当前管理员会话和写入时间生成，证据定位/编号由处理人填写。是否限制内容或账号须按核验结果另行操作；该接口本身不执行封禁、下架或删除。需技术修复时由人工单独安排，不能把举报正文直接作为代码执行指令。

状态含义：NEW=待处理；EMAILED=已按既有渠道发出人工通知（也可能是既有配置的Issue通知）；FAILED=自动转交失败；PR_OPENED=技术工单已开PR；SKIPPED=通用反馈被跳过；RESOLVED=管理员已记录人工核验结论和实际措施并结案。**EMAILED、handledAt 或 PR_OPENED 都不是举报已解决的证明。** AI举报自动路径不会进入PR_OPENED或SKIPPED。已结案的 AI 举报在控制台只读，当前没有重开端点。

## 记录、答复与回执

人工写入使用 `POST /api/feedback/{id}/ai-report-resolution`，只接受有效管理员 `X-Session-Id`；未登录、普通用户及只有 `X-Optimizer-Token` 的请求均不能结案。只有 `contextJson.client.type=ai-content-report` 的记录可用。请求体包含 `eventType=PROGRESS|RESOLVED`、`conclusion`、`actionTaken`、`evidenceRef`、`reporterResponse` 和详情返回的 `expectedVersion`。PROGRESS 至少填写一项；RESOLVED 必须有非空人工核验结论和实际措施，答复可为空。版本不匹配返回 409，处理人应重新加载、核对他人记录后再提交，避免覆盖并发更新。

每次保存都新增一行 `feedback_handling_event`，包含类型、结论、实际措施、处理人、处理时间、证据定位/编号和答复；事件由持久化层禁止更新和删除，不用覆盖 triageJson 代替历史。结案只在 `user_feedback` 更新当前 RESOLVED 摘要，原始反馈、分诊和附件保留。既有 `POST /api/feedback/{id}/resolution` 仍仅供优化者写自动分诊回执，不能把 AI 举报设置为 RESOLVED，也不能改写已结案记录。

非空 `reporterResponse` 会立即发布到同一反馈记录，并记录 `responsePublishedAt`。举报人通过既有 `GET /api/feedback/mine` 只能读取自己的状态、`reporterResponse`、答复发布时间和结案时间；人工结论、实际措施、证据定位、处理人、处置历史及内部错误不通过该接口公开。云端处理结果经既有 `/ingest/status` 回执同步回本机，EMAILED 记录也会继续轮询，以便后续结案和答复回本机。

“已发布到反馈记录”仅表示举报人可在自己的反馈中读取，**不表示已经推送、送达或已读**；当前没有真实推送或已读回执。结案允许答复为空，此时只能在控制台留下完整内部处置记录，不能声称已答复举报人。保存进展和结案时控制台会显示等待状态并防止重复提交；失败保留表单内容，可核对后重试。若响应丢失，应先重新加载详情核对历史，避免重复追加语义相同的事件。

## 转存标识范围

`MobileAssistantTranscript` 为云端项目复制与电脑转存共用出口，每条完成的assistant回答增加可见AI生成说明，保留原答复、来源项目及时间；用户问题不加标识，原会话不被改写。既有已生成的复制快照不回填。本次只解决该转录文本的显式标识，不等同于文件标准隐式元数据，也不覆盖手机本地剪贴板、截图、录音/图片、其他文件导出。依据：[《人工智能生成合成内容标识办法》第四、五条](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)。
