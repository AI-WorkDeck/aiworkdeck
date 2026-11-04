# #1701 客户端专项设计（只读调查，2026-11-04）

本稿未改源码、未运行产品测试。已读取手机仓 AGENTS.md/CLAUDE.md 与 contract-change 技能；本阶段仅按其契约次序规划，未生成契约。绝对根：手机 `/Users/zewei/Documents/2024-2044/5-Tech/1-3 aiworkdeck_mobile`；桌面后端 `/Users/zewei/Documents/2024-2044/5-Tech/1-2 checkba_cloud`。

## 已核对证据

- 四个手机端均有真实订阅门槛，不能只修 iOS：iOS `Model/ProjectFiles.swift:82` 的 canReadCloud=enabled&&subscriptionActive；`Features/Settings/BackupConsentView.swift:15-19`；`Features/Personal/PersonalWorkspaceView.swift:76,220-259,314` 分别控制日历、个人助理和发送。`Services/ProjectFilesService.swift:162` 云文件访问再次检查 canReadCloud。
- 小程序 `utils/backup-consent.ts:10-16` 用订阅判断按钮甚至将确认转换为 false；`utils/file-preview.ts:88` 拦云读取；`pages/personal/personal.wxml`、`utils/personal.ts` 仍用订阅态。
- Android `services/ProjectFilesService.kt:116`、`features/settings/BackupConsentScreen.kt:44-46`、`features/personal/PersonalWorkspaceScreen.kt:178-294` 同类门槛。
- Harmony `model/ProjectFiles.ets:22,97-98` 强制解析 subscriptionActive，`services/ProjectFilesService.ets:171`、`services/BackupConsentService.ets:28-32` 拦入口。
- 桌面 `frontend/src/components/MobileBackupConsent.vue` 的入口、文案、按钮以 subscriptionActive 控制；现有 epoch/accountScope/requestId 换账户保护必须保留。
- `MobileRelayClientService.java:312,348,404,479,770,827` 分别在分享/恢复/版本备份/普通备份/日历/个人助理后台同步做订阅检查。
- **清空后自动重传已可从代码证明**：同文件 475-555 的 syncFileBackups 先列云文件，再遍历本机文件；云端缺少行时 old=null，会上传本机文件。服务端只清空对象、保留 enabled 和准入会在下次轮询重新上传。循环尾部只向云删除本地已不存在对象，此段没有云删除反向删除本机路径；这不证明所有协作同步路径安全。
- iOS `Services/ProjectFilesService.swift:147-155` 云/备份 quote 固定 credits=0，只有桌面取件调用传输报价；若云下载也收费必须一起改，不可展示零后后台扣款。
- iOS `Services/Backend.swift:532-535` 已有余额和 subscription；`contract/api/mobile-v1.yaml` 当前仍将 subscriptionActive 写入 required，存储额度解释为当前订阅持久额度。

## 建议契约

订阅身份保持真实；独立返回服务端权威 cloudAccess，至少区分读/写/付费执行/导出及 reason。保留 subscriptionActive 老字段，不把非订阅伪造成会员。债务快照包含赠送余额、充值余额、授信上限/已用/可用、未结算预占、应付欠款、超限开始/提醒/清理时间及账单版本。所有金额用现有精确整数单位，不用客户端浮点计算准入。

生命周期及数据代次独立：cloudLifecycle=active/restricted/purge_pending/purging/purged（具体命名由主设计统一），cloudEpoch 为服务器控制的代次。旧请求不能在清理后发布新云数据；后台任务收到状态停止上传而保留本机原文件、版本历史和未上传队列。purged 不等于帐号删除或退出登录。

客户端在未付/清理阶段显示应付额、实际截至时间、付款/导出入口；不把账务服务故障展示成零余额或清理到期。倒计时以服务端时间为基准，仅供展示，不能由手机触发删除。

## 清理与恢复

- 清理前停止新上传、目录镜像、摘要生成、日历推送以及在途发布；仅客户端停不够，服务端按账户代次拒绝旧请求。
- 不发送普通文件 tombstone、项目删除命令、注销命令到本机；手机本地已拍摄原件、录音、编辑草稿、待上传队列与用户明确保存的下载文件必须保留。临时预览缓存是否清掉另行定义，不能把“清云端”推导成“清本机”。
- 既有备份 consent 与欠费暂停分开记录。还清后解除账务限制；若已清理，建议要求明确“重新建立云备份”，避免本机立刻全量上传造成新费用。云历史无法凭缴费恢复这一事实应如实展示；本机版本仍可重新备份。
- 导出流程要支持云端独有文件、对话、日历、项目元数据，不能仅提供单文件预览冒充完整备份。当前调查未证实已有全账户导出，应列新增工作包。导出期间流量如何收费、是否允许增加欠款待政策决定。
- 离线旧桌面客户端复上线时必须先获取服务器限制/代次；不能因本地旧 consent=true 绕过限制。服务端是最终闸，禁止按客户端版本豁免收费。

## 旧版兼容和上线次序

先增加字段，保持老字段语义与响应结构。旧版本仍会把非订阅拦住，不能声称上线服务器即可覆盖所有手机；提供明确最低支持版本及升级提示，新版本按新字段，缺字段才走旧服务兼容。账务与清理功能开关分开。先上线能力契约与新客户端，再灰度计费；清理仅在告知、账务核对和通知链验证后开启。旧版上传写操作同样由新服务器执法，不让老版本重新填满已清理云空间。

## 工作包与验收

1. 主仓 OpenAPI 与 MobileApiContractTest → 手机 pull-api → contract 状态/词典/fixtures → gen/check；覆盖20语种和RTL。
2. 四端与桌面入口改能力判断、账务面板、错误分层，保留账户切换代次；覆盖非订阅正余额、授信内、到限、超限、账务不可用、旧服务缺字段。
3. 跨端后台同步与清理隔离：制造本机文件及历史、云独有文件、在途上传、离线客户端；清理前后校验本机字节哈希和历史计数不变；恢复联网不自动补传；换账户不串数据。
4. 通知/导出：72h/120h精确边界、时区、重复推送、通知被关闭/未送达、导出中途失败和断点续传。站内提示持久可见，外部通知失败保留可审计重试，不伪称用户已收到。
5. 支付恢复：部分还款、全额还款、清理开始时还款、旧通知点击、purged后再次启用及费用预估。
6. 验证命令遵循手机仓：contract check、npm typecheck/test、iOS WorkdeckTests，Android/Harmony对应测试；桌面 check:locales。实际设备与正式版本验收单独记，源码/fixture测试不代替真实入口。

## 必须确定

授信基数与无赠送新用户授信、赠送跨期是否抵欠；超限时是否停止新增收费；3/5天起点和部分付款是否重置；云清理范围（协作共同数据、账务记录不能按个人文件直接删）；清理后重新备份是否需确认；导出流量费用；通知渠道和未送达是否延期；老用户新条款告知与生效时间。均不能由客户端自行决定。
