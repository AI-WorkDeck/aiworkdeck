// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "网络连接中断，请求没有发出去。请检查网络后点“重试”。",
  "timeout": "等待太久，服务没有及时响应。请稍后重试；文件较大时可以拆成几份再处理。",
  "localServiceDown": "本机服务还没准备好或已停止。请稍等几秒；如果一直这样，请重启 AI WorkDeck。",
  "signInRequired": "这项功能需要登录 AI WorkDeck 账户。登录后会自动回到这里。",
  "sessionExpired": "登录已过期，请重新登录。没保存的内容不会丢失。",
  "forbidden": "你没有这项操作的权限。如需开通，请联系项目负责人或律所管理员。",
  "balanceLow": "AI 额度已用完，这次没有扣费。请到“设置 → 账户与余额”充值。",
  "rateLimited": "请求太频繁，模型服务暂时限流。请等一分钟再试。",
  "modelUnavailable": "所选模型暂时不可用。请稍后重试，或在输入框下方换一个模型。",
  "modelKeyInvalid": "这台电脑还在用旧版设置里的模型 Key，已被模型服务拒绝。请登录 AI WorkDeck 账户，改用官方 AI 通道。",
  "streamInterrupted": "回答中途断开了，已收到的内容保留在上面。点“重试”重新生成。",
  "streamInterruptedResumable": "回答中途断开了，已收到的内容保留在上面。点“继续”接着写，或点“重试”重新生成。",
  "streamInterruptedTwice": "又断开了。点“重试”重新生成整个回答。",
  "serverError": "服务出了点问题，这次操作没有完成。请稍后重试；如果反复出现，请点“反馈”告诉我们。",
  "conflict": "内容在别处被改过，或上一个操作还没结束。请刷新后再试。",
  "fileTooLarge": "文件太大，超过了上限 {limit}。请压缩或拆分后再上传。",
  "fileUnreadable": "这个文件打不开，可能已损坏或设了密码。请用原程序另存一份再试。",
  "notFound": "找不到这项内容，可能已被移动或删除。请刷新列表。",
  "marketplaceUnavailable": "暂时连不上插件市场，已安装的插件不受影响。请检查网络后点“刷新”。",
  "pluginInstallFailed": "插件“{name}”没能安装，你现有的内容没有变化。请稍后重试；如果仍失败，请点“反馈”并附上详情。",
  "unknown": "操作没有完成。请重试；如果反复出现，请点“反馈”并附上详情。",
  "actions": {
    "retry": "重试",
    "details": "详情",
    "hideDetails": "收起详情",
    "continue": "继续",
    "continueTooltip": "从断开处接着写，不重新生成已有内容",
    "refresh": "刷新",
    "signIn": "登录",
    "feedback": "反馈"
  }
}
