<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 宿主服务目录（SDK 1.6，新宿主尚未发版）

本目录按当前固定动作实现整理。它描述可供第三方 Web 插件调用的接口，不表示现有已安装客户端已支持，也不表示兼容 VS Code 扩展 API。先 `await awd.ready()`；旧宿主、缺少能力或权限时应显示可恢复的错误，不要自行改走外部或付费服务。

实现来源：[业务服务](../../frontend/src/utils/pluginBusinessServices.js)、[日历与集合](../../frontend/src/utils/pluginCollectionServices.js)、[语音](../../frontend/src/utils/pluginVoiceServices.js)、[解析与审查](../../frontend/src/utils/pluginInsightServices.js)、[连接与设置](../../frontend/src/utils/pluginPlatformServices.js)。实际分派与项目上下文由 [PluginPane](../../frontend/src/components/PluginPane.vue) 持有。

## 调用、作用域与结果

```js
const result = await awd.services.request(service, operation, params, {
  signal: abortController.signal, // 可选 AbortSignal
  timeoutMs: 60000,              // 可选，1–120000 毫秒，默认 60000
  requestId: 'my-unique-request' // 可选，当前插件会话内唯一，最多 128 字符
});
```

固定服务名为 `search`、`sensitive`、`litigation`、`calendar`、`favorites`、`clipboard`、`voice`、`insight`。**`speech`、`tasks` 是权限名，不是服务名。** AI 使用单独的 `awd.ai.request`，连接/MCP 使用后文的独立方法，不能把它们当成 `services.request` 的任意代理。

`params` 必须为对象。除表中明确允许的日历 `projectId` 外，项目由已挂载宿主上下文确定，传入另一个 `projectId` 不会转移访问范围。权限只是第一道检查；当前用户登录、项目 ACL、文档可写性、套餐与宿主能力仍可能拒绝请求。

SDK 解开桥的 `result`，**不会统一解开业务返回值的 `data`**。下面 `E(x)` 表示 `{ code: 0, data: x }`；“后端原结果”表示保持已有接口形状，调用方不得假设它是数组。错误以 Promise rejection 返回，检查 `error.code`，例如 `permission_denied`、`no_project`、`invalid_params`、`not_found`、`cancelled`、`unknown_operation`/`unknown_method`、`unavailable`。

表中的权限为累计要求。“当前项目”表示必须有已挂载项目；“全局/项目”表示全局视图可访问用户有权访问的项目，项目视图仍仅限当前项目。

## 搜索、脱敏、诉讼可视化

这三个服务全部需要 `file_read` 和当前项目，包含环境状态查询、选择与打开动作。

| service / operation | 关键 params | 结果与副作用 | 附加权限 |
|---|---|---|---|
| `search / query` | `query` 字符串，最多 10000 字符；`caseSensitive?`、`wholeWord?`、`useRegex?`；`tagIds?` 正整数数组，最多 200 项 | 项目全文搜索原结果；文件类型固定为 docx/pdf/pptx/xlsx/txt/md | 无 |
| `search / tags` | `{}` | 当前项目标签原结果 | 无 |
| `search / open` | `fileId` | `{opened:true}`；打开当前项目文件 | 无 |
| `sensitive / options` | `{}` | 策略选项数组 | 无 |
| `sensitive / choose` | `{}` | 宿主文件选择结果；可能为 `null` | 无 |
| `sensitive / active` | `{}` | 当前项目内的活动编辑文件或 `null` | 无 |
| `sensitive / prepare` | `fileId` | 宿主保存准备结果；可能保存编辑中的内容 | `file_write` |
| `sensitive / preview` | `fileId`、`strategies?`、`mode?:'TOKEN'\|'MASK'`、`customTerms?`、`excludedTerms?`、`password?` | 保存最新内容后返回脱敏预览原结果，不生成脱敏副本 | `file_write` |
| `sensitive / redact` | 同 preview | 生成项目文件；结果含 `file`、`recoveryKit`、`counts`、`suspects`、`warnings`。本次准备发现文档刚改变时返回 `document_changed`，应重新预览 | `file_write` |
| `sensitive / restore` | `fileId`、`recoveryKit`、`password` | 保存源文件后生成复敏项目文件，返回处理结果 | `file_write` |
| `sensitive / open` | `fileId` | `{opened:true}`；打开当前项目文件 | 无 |
| `sensitive / download` | `content` 为 `AWD-RECOVERY-1:` 开头字符串，最多 20 MiB 字符；`name?` | `{downloaded:true}`；下载经清理文件名的 `.awd-recovery` 文件 | `file_write` |
| `litigation / status` | `{}` | 环境状态，如 `available`、`reason`、`python`、`graphviz` | 无 |
| `litigation / list` | `{}` | 当前项目图廊原结果 | 无 |
| `litigation / scope` | `{}` | 宿主出图范围选择结果 | 无 |
| `litigation / kickoff` | `scope?` 最多取 10000 字符；`diagramHint?` 最多取 2000 字符 | `{prompt}`；只生成启动提示词，不自动发送 AI 或出图 | 无 |
| `litigation / restyle` | 图廊中的 `folderId`、`mode:'奇川风'\|'歸藏风'\|'白描'`、`confirmOverwrite:true` | 等待已有编辑保存，再按语义地图重绘并覆盖图产物；返回后端结果 | `file_write` |
| `litigation / packStatus` | `{}` | 固定 `litigation-visual` 资源包状态 | 无 |
| `litigation / packInstall` | `{}` | 安装固定 `litigation-visual` 资源包；可能下载文件，返回包管理结果 | `file_write` |
| `litigation / open` | `fileId` | `{opened:true}`；打开当前项目文件 | 无 |

脱敏 `strategies` 最多取 50 项，省略/非法 mode 按 `TOKEN`。恢复密码与映射虽属于处理输入，也不应写日志、发给 AI 或持久化进插件源码。重绘的 `confirmOverwrite:true` 是调用约束，插件须先把覆盖后果呈现给用户，不能把它当作已经弹过宿主确认框。

## 日历与事项：`calendar`

全部需要 `tasks`，支持全局/项目上下文。写入还要求目标项目角色为 OWNER、MANAGER、ADMIN 或 PARTICIPANT；后端仍独立核验权限。

| operation | 关键 params | 结果与副作用 | 附加权限 |
|---|---|---|---|
| `projects` | `{}` | `[{id,name,myRole}]`；项目视图只返回当前项目 | 无 |
| `list` | `from?`、`to?`，ISO 日期，含端点 | `E({tasks:[...]})`；省略区间取全部；项目视图只查本项目 | 无 |
| `projectTasks` | `projectId`、`from?`、`to?`、`fileId?` | `E({tasks:[...]})`；项目视图不能指定别的项目 | 无 |
| `summary` | `{}` | 全局为 `E({overdue,today,week,nextDue})`；项目视图返回 `E({})`，应从项目事项计算汇总 | 无 |
| `files` | `projectId` | 文件元数据数组：id/name/parentId/fileType/isFolder/isDir/isDeleted | `file_read` |
| `members` | `projectId` | `E([{userId,username,displayName,role}])` | 无 |
| `openProject` | `projectId` | `{ok:true}`；宿主导航 | 无 |
| `openFile` | `projectId`、`fileId` | `{ok:true}`；文件必须属于可见项目且不是目录 | `file_read` |
| `create` | `data:{projectId,title,...}` | `E(task)`；创建真实事项并更新宿主缓存 | 有 `fileIds` 时需 `file_read` |
| `update` | `id`、`data:{...}` | `E(task)`；只更新已查询到的可见事项，不能改所属项目 | 有 `fileIds` 时需 `file_read` |
| `delete` | `id` | `E(宿主删除结果)`；删除真实事项；本动作不自动弹确认框 | 无 |

create/update 仅转发 `title`、`dueDate`、`dueTime`、`status`、`type`、`priority`、`notes`、`assigneeId`、`remindBefore`、`fileIds`。日期为 ISO 日期、时间为 `HH:mm`，状态为 `OPEN`/`DONE`；字段进一步由后端验证。`fileIds` 出现时整体替换关联集合，必须全为目标项目内文件。写事项不额外要求 `file_write`，但绝不跳过项目写权限。

## 收藏与剪贴板：`favorites` / `clipboard`

`favorites` 需要 `file_read` 和当前项目；`clipboard` 需要 `clipboard`，可处于全局或项目视图，它读的是宿主剪贴板历史而非任意系统剪贴板 API。对条目调用操作前必须先 `list`；宿主按本会话缓存中的条目执行，不接受插件伪造内容或路径。

| operation | 适用服务 / params | 结果与副作用 | 附加权限 |
|---|---|---|---|
| `list` | 两者：`query?`，最多取 2000 字符 | 最多 80 项。favorites 返回安全元数据数组；clipboard 返回 `{items,limited,hiddenCount}` | 无 |
| `image` | 两者：`id`，必须为图片条目 | `{dataUrl}`；最多 20 MiB，按文件签名允许 PNG/JPEG/GIF/WebP/BMP，不返回宿主鉴权 URL | 无 |
| `delete` | 两者：`id` | `{ok:true}`；删除条目并发出刷新事件；无自动确认框 | favorites 额外 `file_write` |
| `copy` | 两者：`id` | `{ok:true}` 或无可复制文本时 `{ok:false}`；写系统剪贴板。收藏优先复制 sourceUrl，其次 content/title；剪贴板仅复制 TEXT | `clipboard` |
| `insert` | 两者：`id` | `{ok:true}` 或无内容时 `{ok:false}`；向当前编辑器插入文本/图片 | `editor`，编辑器自身还会核验可写性 |
| `open` | 仅 favorites：`id` | `{ok:true}`；打开条目的 HTTP/HTTPS 来源 | 无 |
| `preview` | 仅 clipboard 的 IMAGE：`id` | `{ok:true}`；宿主图片预览 | 无 |
| `account` | 仅 clipboard：`{}` | `{ok:true}`；打开账户页 | 无 |
| `purchase` | 仅 clipboard：`{}` | 宿主确认后购买固定 `feature:clipboard.unlimited` 权益，可能消费 Credits；返回 `{purchased:true}`、`{purchased:false}` 或 `{cancelled:true}` | 无额外 manifest 权限；仍检查账户余额与已有权益 |

favorites 条目包含 id/title/content/sourceUrl/sourceHost/createdAt，图片只以 `imagePath:'image'` 标识存在。clipboard 条目仅含 id/type/text/meta/fileName/createdAt，不提供本地磁盘路径或带 session 的下载 URL。`purchase` 仅是宿主固定权益入口，不是第三方插件自定义收费接口。

## 语音与会议录音：`voice`

全部需要 `speech`。下面明确区分不依赖项目的合成/环境动作，与需要当前项目的录音动作。语音服务使用宿主已配置的本机/云端渠道，不返回供应商凭据。

| operation | 关键 params | 结果与副作用 | 项目 / 附加权限 |
|---|---|---|---|
| `voices` | `{}` | 音色数组；字段以宿主音色结果为准 | 不要求项目 |
| `synthesize` | `text` 字符串，最多 2000 字符；`voice` 字符串，最多 200 字符 | WAV `ArrayBuffer`；调用本地 TTS，生成速率固定为 1。播放器倍速由插件自行控制 | 不要求项目 |
| `download` | `content: ArrayBuffer` | 校验 PCM WAV，最多 256 MiB；下载 `voice_<时间>.wav`，返回 `{downloaded:true}` | `file_write` |
| `importText` | `{}` | 宿主选择/导入的文本字符串；记住来源文件供高亮使用 | `file_read`；依赖宿主导入 UI |
| `highlight` / `clearHighlight` | highlight: `sentence`，最多取 4000 字符；clear: `{}` | 调用宿主来源文档高亮/清除动作；不替换正文 | `editor`；需合适的来源文档 |
| `capabilities` | `{}` | `{desktop:boolean}`，表示是否有宿主 model 桥 | 不要求项目 |
| `modelStatus` | `{}` | 宿主模型状态；无桥时 `{components:[]}` | 不要求项目 |
| `modelCancel` | `id:'kokoro-models'\|'asr-models'` | 宿主模型下载取消结果；无桥可能没有结果 | 不要求项目 |
| `ensure` | `{}` | 确保固定 `kokoro-service` 启动；无桥可能没有结果 | 不要求项目 |
| `components` | `{}` | 只列 kokoro-runtime/asr-runtime，含 installing 状态 | 不要求项目 |
| `componentInstall` | `packId:'kokoro-runtime'\|'asr-runtime'` | 启动宿主后台安装并立即返回组件状态；**返回不代表安装完成** | 不要求项目；会下载/安装资源 |
| `probe` | `{}` | 本地 ASR 探测原结果 | 不要求项目 |
| `requireAccount` | `{}` | 宿主账户连接流程结果 | 不要求项目；可能打开 UI |
| `tier` | `{}` | `{platformAvailable,accountConnected,services:[{service:'asr',provider,hasLocal,hasByokCredentials}]}` | 不要求项目；不含凭据 |
| `setTier` | `provider:'local'\|'platform'` | 修改宿主 ASR 渠道；platform 先弹音频上传确认 | platform 额外 `network` |
| `notice` | `{}` | 云端转写告知状态/正文 | 不要求项目 |
| `acknowledgeNotice` | `{}` | 宿主展示告知并由用户确认后记录 | `network` |
| `recordingState` | `{}` | 当前录音状态副本；其他项目在录音时隐藏其 projectId/时长/电平 | 当前项目 + `file_read` |
| `devices` | `{}` | 可用音频输入设备数组；可能受浏览器/系统授权限制 | 当前项目 + `file_read` |
| `list` | `{}` | 当前项目会议列表及 tier 等原结果 | 当前项目 + `file_read` |
| `start` | `deviceId?`，仅使用枚举到的设备，否则默认设备 | 用户确认后开始真实录音并保存项目；返回 recorderState 副本 | 当前项目 + `file_read` + `file_write`；非 local 渠道额外 `network` |
| `pause` / `resume` | `{}` | 暂停/恢复当前项目录音；完成结果可能为空，重新读 recordingState | 当前项目 + `file_read` + `file_write` |
| `stop` | `{}` | 等待录音分块收尾，返回 meeting 或 `null`；现有宿主流程可能随后提交转写 | 当前项目 + `file_read` + `file_write` |
| `get` | `id`，当前项目录音 ID | 录音详情原结果；后端可能顺带查询转写进度 | 当前项目 + `file_read` |
| `audio` | `id` | `{bytes:ArrayBuffer,type:string}`；读取这份录音的音频 | 当前项目 + `file_read` |
| `minutes` | `id` | 会议纪要提示词原结果；不自动发送 AI | 当前项目 + `file_read` |
| `transcribe` | `id` | 请求转写原结果；先检查渠道、告知与付费确认，可能上传音频/消耗用量 | 当前项目 + `file_read` + `file_write`；非 local 额外 `network` |
| `update` | `id`、`payload:{title?,speakerNames?}` | 更新录音元信息；title 最多取 500 字符 | 当前项目 + `file_read` + `file_write` |
| `export` | `id` | 转写导出原结果；会在宿主执行导出操作 | 当前项目 + `file_read` + `file_write` |
| `delete` | `id` | 用户在宿主确认后删除录音，返回原结果 | 当前项目 + `file_read` + `file_write` |

未确认平台转写告知时会返回 `notice_required`。已启动的录音在切换面板或卸载插件后仍可能继续；应通过 `stop` 结束，不要把取消一次桥请求当作停止录音。组件下载同样由宿主后台管理，轮询真实状态或订阅进度，不以 Promise 已完成判定资源安装成功。

## 当前文档解析与合同审查：`insight`

全部需要 `file_read` 和当前项目。除 `context` 外，必须存在当前解析文档；可传 `docFileId` 来确认目标，不能据此选择另一个文档。文档变化返回 `stale_document`，应重新读取 context。下表的“可写”同时要求上下文 `canWrite`。

| operation | 关键 params | 结果与副作用 | 附加权限 |
|---|---|---|---|
| `context` | `{}` | 宿主解析上下文，含 docFileId/canWrite 等 | 无 |
| `get` | `docFileId?` | 当前文档解析原结果 | 无 |
| `parse` | `docFileId?` | 保存当前文档后启动解析；可能联网与更新解析记录 | `file_write` + `network` + 可写 |
| `entity` / `refreshEntity` | `entityId`、`docFileId?` | 仅允许当前文档权威实体；返回实体详情/刷新结果 | refresh 额外 `file_write` + `network` + 可写，并先保存 |
| `prepare` | `docFileId?` | 宿主文档保存准备结果 | `file_write` + 可写 |
| `execute` | `action:'find_navigate'`、`params:{keyword}` | 向下查找；keyword 最多取 10000 字符 | `editor` |
| `execute` | `action:'find_replace'`、`params:{findText,replaceText}` | 每个字符串最多 10000 字符，findText 非空；仅精确命中一次才替换，否则 `ambiguous_selection` | `editor` + `file_write` + 可写 |
| `entities` | `docFileId?` | 宿主重载当前权威实体索引用于编辑器命中，返回 `{updated:true}`；忽略 iframe 自造实体正文 | 无 |
| `openUrl` | `url` 为 HTTP/HTTPS | `{opened:true}`；打开宿主浏览器 | 无 |
| `openSettings` | `{}` | `{opened:true}`；打开账户设置 | 无 |
| `openHover` | `payload:{entity:{id},x?,y?}` | 从当前文档重新核验实体并打开悬浮信息；只采用 id 和有限坐标，不信任插件实体正文 | 无 |
| `openDoc` | 当前项目 `fileId` | `{opened:true}`；打开文件 | 无 |
| `standards` | `{}` | 当前项目审查标准数组 | 无 |
| `saveStandard` | `id?`、`expectedVersion?`、`name`、`position`、`jurisdiction`、`rules` | 保存审查标准；已有 id 必须属于当前项目；整体 params JSON 最多 100000 字符 | `file_write` + 可写 |
| `confirmStandard` | `id`、`version` | 确认已列出的标准版本，返回后端结果 | `file_write` + 可写 |
| `review` | `docFileId?` | 当前文档已有审查结果 | 无 |
| `runReview` | `standardId`、`version`、`docFileId?` | 保存文档后执行审查并返回结果；可能联网与消耗宿主用量 | `file_write` + `network` + 可写 |

## 设置、BYO 连接、MCP 与收费（独立方法）

这些接口使用 `awd.settings.*`、`awd.connections.*`、`awd.mcp.*`、`awd.billing.*`，不是上述 service/operation 组合。所有数据与凭据均限当前插件命名空间。

| SDK 方法 | 参数 / 结果 | 权限、依赖与副作用 |
|---|---|---|
| `settings.open()` | → `{opened:true}` | 打开可信宿主插件设置 UI |
| `settings.get(key)` | → 字符串；空值为 `''` | 只读已声明非 secret 设置；按声明的 installation/user/project scope 解析 |
| `settings.update(values)` | → `{}` | 只允许本插件非 secret 的 user/project 设置；项目 scope 需当前项目；不能改 installation 设置 |
| `connections.list()` | → `{connections:[...]}` | `network`；当前插件声明的连接状态，不返回令牌 |
| `connections.connect(id)` | → `{opened:true}` | 仅打开宿主指定连接设置，不代表已经登录；Bearer/OAuth 输入在宿主完成 |
| `connections.disconnect(id)` | → 服务结果 | `network`；断开当前用户在本插件下的连接 |
| `connections.request(id, operation, params)` | → 服务 JSON | `network`；仅 manifest 固定 HTTPS 来源与 GET/POST 路径；凭据由宿主注入，不接受任意 URL/请求头 |
| `mcp.servers()` | → `{servers:[...]}` | `network`；只列本插件已声明的 MCP 服务 |
| `mcp.call(serverId,name,args)` | → MCP CallToolResult，如 `{content,isError}` | `network`，并受项目访问与服务声明约束；远端工具名/schema 必须匹配审核声明；`isError:true` 不等于桥 Promise 必然 reject |
| `billing.status(connectionId?)` | → 权益/订阅状态 | 不传 connectionId 为平台插件购买权益；传入为开发者服务状态，需 `network` |
| `billing.checkout(connectionId?)` | → `{opened:true}` | 用户确认后打开 HTTPS 结账页；传连接需 `network`；opened 不代表已支付 |

共享宿主渠道例子是 `awd.ai.request(prompt, options)`、`voice.synthesize`、会议转写和文档审查：使用宿主现有配置、账户、用量和权限，不让 iframe 读取供应商密钥。`awd.ai.request` 需 `ai`，有现有长度/频率/计费约束；它返回文本，不是任意 Agent 工具执行器。要把任务作为可见用户消息交给宿主 Agent，用现有 `awd.chat.send(prompt)`，不会通过 services 新建私有 Agent 会话。

官方桌面模式的云端 AI 调用固定使用当前登录账户，忽略遗留全局 BYOK 密钥；服务端/私有部署可按其设置使用宿主 BYOK。插件自有服务不依赖该全局选择，使用下面的独立 connections。

BYO 则用 manifest 的 `contributes.connections` 声明公开 HTTPS origin、auth 与固定 operations，或用 `mcpServers` 声明工具。支持 none、Bearer、OAuth2 公共客户端 PKCE；凭据按用户/插件/连接由宿主保管，不能作为 connect 参数传入 iframe。开发安装的远程服务还需管理员在宿主设置页明确授权；完整 manifest 改变会使该信任失效。此授权不开放开发 JAR 或本地进程。

OAuth 使用 Authorization Code + S256 PKCE 公共客户端流程。桌面单机模式回调为实际监听端口的 `http://127.0.0.1:<port>/api/plugins/oauth/callback`；服务端部署必须配置 `ai.plugins.oauth-redirect-uri` 为可信 HTTPS 回调，并在供应商处登记。不要在插件中放 client secret。授权状态一次有效；连接失效或无刷新令牌的凭据过期后，`connections.list()` 返回 `connected:false, needsReconnect:true`。用户断开或重新连接会取消旧连接的在途 HTTP；已到服务商的副作用不会因此回滚。

平台 `billing.status()` 每次主动刷新当前账户权益；`refreshed:false` 表示刷新失败或未连接账户，`active` 可能来自有效期内的本账户缓存，不能作为新支付的确认。开发者状态操作须返回布尔 `active`，可附字符串 `plan`；宿主不接收任意状态作为已付款证明。`checkout` 等待外部浏览器打开结果，失败会 reject；页面成功打开也必须随后重新查询权益。平台结账入口跟随宿主站点和语言，自有结账入口只使用 manifest 固定 URL。

宿主阻止连接操作把当前原始 access/refresh token 直接回显到 iframe（包括嵌套 JSON）；这不是对恶意服务商编码泄露的通用防护。使用自己控制或信任的服务端，并自行完成供应商 OAuth、订阅回调和真实环境验收。可运行示例见 [plugin-service-demo](../../examples/plugin-service-demo/)，覆盖 Bearer、OAuth、MCP、两种计费入口及共享 AI；完整测试边界见 [服务验收](../../docs/plugin-services-validation.md)。

当前 MCP 只支持公网 HTTPS Streamable HTTP，不支持 stdio、私网地址、任意重定向或通用 JSON Schema。schema 子集与连接声明见 [manifest.schema.json](manifest.schema.json) 和 [类型声明](manifest.d.ts)。平台 billing 仅有插件购买权益，不提供第三方按调用代收或分账；开发者自有订阅需走自己声明的 statusOperation/checkoutUrl。剪贴板 `purchase` 是另一个固定宿主权益动作，不能改商品 ID。

## 取消的精确含义

| 场景 | 现在的行为 |
|---|---|
| `services.request` 的 signal abort / SDK timeout | SDK reject `aborted` / `timeout`，并尽力发送 `services.cancel({requestId})`；发送前已经 aborted 则不启动调用 |
| 显式 `awd.services.cancel({requestId})` | 找到当前插件会话的在途请求则 abort 对应 controller，返回 `{cancelled:true}`；找不到为 false。不是事务回滚证明 |
| 支持 signal 的路径 | 搜索、脱敏预览/处理、TTS 合成、录音音频下载、收藏/剪贴板图片读取等会向相应请求传递 signal；HTTP 中止不保证服务端已经开始的工作停止 |
| 其余业务 API、宿主 UI 动作 | 在异步边界检查取消/当前上下文并丢弃迟到结果；并非所有底层 API 都能中断，已经写入的事项、文件、订阅购买不会自动撤销 |
| 插件卸载、项目或账户上下文改变 | 宿主使旧会话失效并清理在途 controller；插件自身也应丢弃旧数据、停止播放和清理监听 |
| 已开始的录音、组件安装 | 生命周期归宿主；取消请求/卸载面板不等于停止录音或下载。录音用 `voice / stop`；模型下载仅有明确的 `modelCancel` 动作 |
| connections/MCP/settings/billing 的 signal/timeout | SDK 停止等待；这些独立方法没有对应的 services requestId 取消登记。宿主销毁服务时会中止其已登记的请求，但不能承诺每次 SDK abort 都中断远端工作 |

业务路由还保留内部 `operation:'cancel'` 分支；第三方 SDK 应统一用 `awd.services.cancel`，不要用普通 request 生成一个新的 requestId 去取消旧请求。非幂等动作结果不明时先重读状态，禁止盲目重试购买、创建、转写或删除。

## 可直接交给 Agent 使用的例子

下面代码在已同步加载 SDK 的插件页面内运行。调用前应由用户点击对应按钮；项目写入和收费动作不要放进页面加载回调。manifest 只声明实际需要的权限。

搜索当前项目，带停止按钮：

```js
let searchController;
async function search(query) {
  searchController?.abort();
  searchController = new AbortController();
  try {
    return await awd.services.request('search', 'query', { query }, {
      signal: searchController.signal, timeoutMs: 30000
    });
  } catch (error) {
    if (['aborted', 'cancelled'].includes(error.code)) return null;
    throw error;
  }
}
function stopSearch() { searchController?.abort(); }
// manifest.permissions: ['file_read']; 必须挂载在项目内。
```

读取日程后显式创建事项：

```js
const ctx = await awd.ready();
const response = await awd.services.request('calendar', 'list', {});
const tasks = response.data.tasks;
async function createTaskFromUser(title, dueDate) {
  if (!ctx.projectId) throw new Error('请先打开目标项目');
  return awd.services.request('calendar', 'create', {
    data: { projectId: ctx.projectId, title, dueDate }
  });
}
// manifest.permissions: ['tasks']; createTaskFromUser 仅由明确创建操作触发。
```

生成短句并播放，清理时释放音频资源：

```js
let audio, audioUrl;
async function speak(text, voice, signal) {
  disposeAudio();
  const bytes = await awd.services.request('voice', 'synthesize', { text, voice }, { signal });
  audioUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  audio = new Audio(audioUrl);
  await audio.play(); // 浏览器仍可能要求用户点击；失败时提供播放按钮。
}
function disposeAudio() {
  audio?.pause(); audio = null;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
}
// manifest.permissions: ['speech']; 长文自行分句，每次最多 2000 字符。
// disposeAudio 不取消已发出的生成；同时 abort 对应请求的 controller。
```

开发者自有服务（先在 manifest 声明同名连接、固定操作与 `network`）：

```js
await awd.connections.connect('my-service'); // 只打开宿主设置
// 等用户在宿主完成连接后，由“重试”按钮重新读取状态/请求。
const state = await awd.connections.list();
const output = await awd.connections.request('my-service', 'summarize', { text: '合成示例文本' });
// MCP 的服务/工具也必须事先声明：
const toolResult = await awd.mcp.call('my-mcp', 'summarize', { text: '合成示例文本' });
if (toolResult.isError) throw new Error('工具返回错误，请检查 content');
```

监听 `calendar.changed`（tasks）、`favorites.changed`（file_read）、`clipboard.changed`（clipboard）、`speech.progress`（speech）后，应重新读取已授权状态。`speech.progress` 是组件进度，不是逐音频帧流。可用 `awd.events.on(name, callback)`，并在清理时调用其返回的取消订阅函数。

本目录由实现核对整理；示例未调用真实客户数据、供应商、录音或付款。它不提供任意 fetch、系统设置读写、进程启动、全量编辑器命令、实时 TTS PCM 流、任意 MCP schema 或自动收费能力。真实宿主验收应覆盖权限拒绝、项目切换、失败重试、取消和已产生副作用的状态核对。
