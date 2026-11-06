# 数据保留与删除（草稿）

> **草稿，待法务审阅。** 起草 2026-11-05；最近审阅：【待填写】。
> 下表的期限取自代码常量、部署文档和 `legal/PRIVACY.md`。三者以代码为准；
> 读不出代码依据的，写「以服务端配置为准」或标【待确认】。

## 一、原则（现状）

1. **桌面端数据由用户自己掌控。** 本机数据目录（`~/.aiworkdeck`）和项目文件不会被 AWD 远程删除或自动过期；删除由用户在应用内操作或直接删目录。
2. **中转区「送达即删」。** 手机影像、跨设备传输、插件文档镜像以桌面端确认收取（ACK）为主删除机制，代码 TTL 与对象存储生命周期规则兜底。
3. **会话与案卷类云端数据保留到用户删除为止**，没有另设自动到期日（PRIVACY 第二节、第二之二节）。
4. **账务流水与账户共存续**，不含请求内容、结果内容与文件名（PRIVACY 第三节）。
5. **已发送给第三方的数据不在 AWD 删除范围内**：模型供应商、数据服务商按各自政策处理（见 `vendor-management.md`）。

## 二、保留期限表

| 数据 | 位置 | 保留 / 删除规则 | 出处 |
|---|---|---|---|
| 本地项目、AI 对话、设置 | 用户本机 | 用户删除前一直保留 | `application-desktop.yml` |
| 本地使用统计明细 | 用户本机 | 90 天滚动清理 | `TelemetryService.RETENTION_DAYS = 90` |
| 下一句建议及反馈 | 用户本机 | 30 天；删除或回退会话时同步清除 | PRIVACY 第一节 |
| 桌面端日志 `~/.aiworkdeck/logs/*.log` | 用户本机 | **没有找到轮转或清理代码**【待确认】 | `desktop/main/main.js`、`services/service-manager.js` |
| 手机影像 / 插件文档镜像中转 | OSS `mobile-relay/` | 桌面端 ACK 后立即删除；代码 TTL 30 天（每日清理）；OSS 生命周期 35 天兜底，失败分片 7 天 | `MobileRelayStoreService.TTL`、`deploy/cloud/setup-relay-oss.py` |
| 跨设备文件传输 | OSS 中转区 | 对方确认收取后删除；推送方向最长 30 天、拉取方向最长 7 天，每小时清理 | `MobileTransferService.cleanupExpired` |
| 会议录音音频 | 对象存储 | 转写完成或失败即删；PRIVACY 与应用内提示称有 24 小时生命周期规则兜底，**该存储桶规则不在本仓库中，无法从代码核实**【待确认】 | `MeetingRecordingNotice`、PRIVACY 第二节 |
| 平台代采的 OCR、搜索、企查查、Tushare、北大法宝请求 | 不落盘 | 调用结束即无 | PRIVACY 第二节 |
| 插件云会话记录 | 插件云 PostgreSQL | 保留至用户删除会话；排队正文内存副本最长 30 分钟 | PRIVACY 第二节 |
| 案件库项目、版本历史、客户上传材料 | 案件库服务器 | 保留至按项目规则删除；撤销访问码不删除已上传材料；具体保留期与备份以服务端配置为准 | PRIVACY 第二之二节 |
| 文件云端备份 `mobile-backup/` | OSS | 用户取消同意后后台删除；不设生命周期自动过期 | PRIVACY 第二之二节、`deploy/cloud/README.md` |
| 项目沟通 IM 消息与附件 | 协作服务 | 没有自动到期删除规则，需要删除时联系平台 | PRIVACY 第二节 |
| 登录会话 | 服务端数据库 | 滑动过期：云端与案件库 7 天无活动失效，默认 365 天；每日清理 | `application-cloud.yml`、`application-case.yml`、`UserSessionService` |
| 用户活动日志 | 服务端数据库 | 180 天，每日清理 | `UserActivityLogService.RETENTION_DAYS = 180` |
| 账务流水 | 服务端数据库 | 与账户共存续 | PRIVACY 第三节 |
| 服务端应用日志 | 服务器 | 后端没有自定义日志配置（无 logback 文件），保留期取决于 systemd/journald 等服务器设置【待确认】 | `backend/src/main/resources` |
| 服务端备份 | 服务器 | 见第四节 | `deploy/case/README.md` |

## 三、删除途径

- **注销账户**：应用内调用 `POST /api/auth/account/delete`（`AccountDeletionService`）。先通知官网账户系统删除，失败则本地中止；随后删除中转媒体、目录镜像、设备心跳、传输记录、会话、账户绑定、设备令牌和用户记录。不删除用户本机的文件。
- **删除项目**：`DELETE /api/projects/{id}`，仅项目创建者可操作。「打开本地文件夹」型项目只解除绑定，不删除用户文件夹；云端项目由 `ProjectService.deleteOwnedCloudProject` 清理。
- **删除文件**：先进回收站，`/{fileId}/permanent` 永久删除。
- **删除 AI 会话**：`DELETE /conversation/{conversationId}`（只有会话所有者可删，运行中的会话返回 409）。
- **关闭版本记录并删除历史**：`POST /version/disable`。
- **关闭文件云端备份**：后台删除自动备份副本，失败会重试。
- **IM 消息与附件**：PRIVACY 写明需要删除服务端数据时联系平台（hi@aiworkdeck.com）。【待确认】处理时限。

## 四、备份与删除的关系

- 案件库部署文档写明当时处于「零备份状态」，并给出了备份规格（每日 rsync 案卷仓库、每日 `pg_dump`、备份不出本机）。**仓库中没有找到落地的备份脚本或定时任务。**【待确认】生产环境当前是否已有备份、备份保留多久。
- 插件云后端文档建议定期 `pg_dump`（`deploy/cloud/README.md`）。【待确认】是否已执行。
- PRIVACY 已说明：运维备份与已发送给第三方的内容不等于在线数据库，不能承诺追溯删除全部副本。【待确认】备份中已删除数据的最长残留时间。

## 五、法定留存与诉讼保全

【待确认】AWD 目前没有书面的诉讼保全（legal hold）流程，也没有针对法定留存要求（如电子商务、税务记录）的单独规则。
