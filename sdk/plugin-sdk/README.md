# AI WorkDeck 插件 SDK（`awd-plugin-sdk.js`）

Web 插件与宿主之间那座 postMessage 桥的插件侧实现。单文件、无依赖、无构建步骤，
用普通同步 `<script>` 引入即可。

**这里是源头。** 官网插件模板 zip 里的 `web/awd-plugin-sdk.js`
（官网仓 `lib/plugin-template.ts` 的 `WEB_SDK_JS` 常量）与
本仓 `examples/hello-web-plugin/web/awd-plugin-sdk.js` 都是**分发副本**，
必须与本文件逐字节一致。改动顺序：先改这里，再同步两份副本。

对应的宿主端实现在 `frontend/src/components/PluginPane.vue`。
桥协议是双方共同的契约，任何一方单独改动都会让另一方的插件跑不起来——
改协议要同一批次改三处：本文件、PluginPane.vue、官网模板与宿主模拟器。

## 引入

```html
<script src="awd-plugin-sdk.js"></script>
<script>
  (async function () {
    const ctx = await awd.ready();   // 等宿主握手，resolve 值即 awd.context
    await awd.ui.toast('你好，' + ctx.pluginId);
  })();
</script>
```

SDK 必须排在业务脚本**之前**且用同步 `<script>`：宿主在 iframe `load`
之后立刻发 `init`，晚注册监听会错过握手，`ready()` 将永远挂起。

## 表面

| 成员 | 说明 |
|---|---|
| `awd.version` | SDK 版本（与桥协议版本无关） |
| `awd.ready()` | Promise，resolve 值即 `awd.context` |
| `awd.context` | `{ pluginId, projectId, language, theme }`；`ready()` 之前为 `null` |
| `awd.call(method, params)` | 原样调用任意 v1 方法，返回宿主的 `result` |
| `awd.files.list()` | 糖衣：直接返回数组 `[{ path, name, size }]` |
| `awd.files.read(path)` | 返回原始 result `{ path, content, truncated }` |
| `awd.ui.toast(message)` | 宿主弹一条提示 |
| `awd.storage.get(key)` | 糖衣：直接返回存过的值，没有则 `null` |
| `awd.storage.set(key, value)` | 插件级 KV，总量上限 64 KB |

失败时 Promise reject 出一个 `Error`，`err.code` 是错误码：
`permission_denied`（manifest 未声明所需权限）、`unknown_method`、
`quota_exceeded`（storage 超 64 KB）、`not_found`（文件不存在）。

## 协议

```
握手  宿主 -> 插件   { awd: 1, type: "init", context: {...} }
请求  插件 -> 宿主   { awd: 1, type: "call", seq, method, params }
响应  宿主 -> 插件   { awd: 1, type: "result", seq, ok, result | error: { code, message } }
```

插件侧 `postMessage` 的 targetOrigin 只能是 `'*'`：插件跑在
`sandbox="allow-scripts allow-forms"`（**无** `allow-same-origin`）的
iframe 里，是 opaque origin，拿不到宿主的真实 origin。来源校验因此是双向的——
插件校验 `event.source === window.parent`，宿主校验 `event.source === iframe.contentWindow`。

完整规范见 [docs/PLUGIN_SPEC.md](../../docs/PLUGIN_SPEC.md) §9，
最小可跑示例见 [examples/hello-web-plugin/](../../examples/hello-web-plugin/)。

## 项目沟通与文件材料（SDK 1.5.0，宿主 0.61.0+）

- `awd.im.request(action, params)`：声明 `im` 权限后调用固定聊天动作。会话成员权限由服务端检查，项目文件导入/关联/归档另需 `file_write` 和项目写权限；发送项目文件需 `file_read/file_write` 与原文件读权限，首次保存项目标识另需内部项目写权限。不会向插件返回账号密钥。
- `awd.chat.addFile(path)`：将当前项目文件加入 AI 材料，不自动发送消息。
- `awd.files.prepareDrag(path, rect)`：预备一次拖拽，返回经宿主验证的文件描述及 `dragToken/dragType/expiresAt`。在 hover/focus 预备，传按钮局部矩形 `{left,top,width,height}`；宿主将原生拖柄限制在该 iframe 内，返回 `hostHandle:true` 后使用宿主拖柄完成跨 iframe 拖拽。不要放宽 sandbox。取消时可调 `awd.files.endDrag()`。仅当前项目、短时有效、使用一次，切换身份/项目立即失效。
- `account.changed`：无正文的账户变更事件；清除缓存、草稿和在途结果后重新读取身份。

旧宿主返回 `unknown_method`，应提示升级；不得用插件本机 KV 冒充跨用户聊天存储。

`awd.call('im.downloadAttachment', {conversationId, attachmentId})` 直接下载服务端已授权附件，仅需 `im`，不写入项目。成功返回 `{started:true,name}` 表示已发起下载；用户可以取消另存为。

## SDK 1.6：宿主服务、连接与调用生命周期

`awd.call(method, params, options)` 和全部异步便利方法接受可选的最后一个 `options`：`{signal, timeoutMs}`。默认 60 秒，范围 1–120000 毫秒；`ai.request(prompt, options)` 将其与 `system/purpose` 放在同一个对象。超时返回 `code=timeout`，取消返回 `code=aborted` / `name=AbortError`，并清除等待项与监听器；迟到响应不再生效。一般调用取消只停止等待，不能保证撤销已经完成的宿主写入。`services.request` 另向宿主发送取消请求，是否中止实际工作取决于宿主操作实现。

| API | 桥方法与参数 |
| --- | --- |
| `services.request(service, operation, params, {requestId?, ...options})` | `services.request {service,operation,params,requestId}`；缺省生成请求 ID |
| `services.cancel({requestId}, options)` | `services.cancel {requestId}` |
| `mcp.servers(options)` | `mcp.servers {}` |
| `mcp.call(serverId, name, args, options)` | `mcp.call {serverId,name,arguments:args}` |
| `connections.list(options)` | `connections.list {}` |
| `connections.connect(id, options)` / `disconnect(id, options)` | `{id}`；连接时由宿主可信 UI 输入凭据或发起 OAuth |
| `connections.request(id, operation, params, options)` | `{id,operation,params}`；只能调用 manifest 声明的固定操作 |
| `billing.status(connectionId?, options)` / `checkout(connectionId?, options)` | `{connectionId}`；无 ID 时查询/打开宿主权益入口 |
| `settings.open(options)` | `settings.open {}` |
| `settings.update(values, {scope?,projectId?,...options})` | `{values,scope,projectId}`；只写 user/project 范围声明的非密设置；installation 范围在宿主表单修改 |

所有新方法在旧宿主上保留 `unknown_method` 拒绝，插件应显示升级提示，不用假数据冒充成功。项目范围、能力权限、供应商额度和 MCP 授权由宿主执行；SDK 不是绕过这些边界的通道。账户密钥不进入 iframe，也不将服务商订阅描述为平台代收分账。

类型入口为 `awd-plugin-sdk.d.ts`，manifest 类型为 `manifest.d.ts`，编辑器 JSON Schema 为 `manifest.schema.json`。通过 `<script>` 使用时可在业务 TypeScript 中写 `/// <reference path="./awd-plugin-sdk.d.ts" />`；模块中可用 `import type { SDK } from './awd-plugin-sdk'` 引入类型，以 `const sdk: SDK = window.awd` 取得实例；运行时仍由同步脚本提供全局 `awd`，不要把这个浏览器脚本当成 Node 模块加载。

## 本地开发命令

需要 Node.js 20+，运行时仅使用 Node 内置模块，无下载或自动登录步骤。以下命令在仓库根运行：

```sh
node scripts/plugin-dev.mjs init /tmp/my-plugin --id my-plugin
node scripts/plugin-dev.mjs validate /tmp/my-plugin
node scripts/plugin-dev.mjs package /tmp/my-plugin --out /tmp/my-plugin.zip
node scripts/plugin-dev.mjs status /tmp/my-plugin
```

`validate` 检查权限、manifest 类型、声明文件存在、连接/OAuth/视图约束；`package` 生成可解压的 ZIP，拒绝符号链接及路径逃逸，并排除 `.env*`、常见凭据文件、私钥文件、Git、依赖目录及旧 ZIP。检测到文件正文中的私钥会拒绝打包。自定义命名的密码或令牌不能靠静态扫描穷尽，提交前仍须核对包内容。开发包限制与宿主一致：200 文件、单文件 5 MB、合计 20 MB；已有输出 ZIP 不覆盖。

开发安装使用**已经导入宿主项目**的源码文件夹，`folderId` 是项目内数据库 ID，不是磁盘路径。`dev` 是一次安装/重新安装命令，不提供文件监视。桌面单机免登模式可以不设 `AWD_SESSION_ID`，由原有宿主回环地址保护与本机身份机制鉴权。需要登录的宿主仍须已有会话；CLI 不读取客户端凭据或生成令牌。也可直接使用插件开发面板安装，无需复制会话：

```sh
node scripts/plugin-dev.mjs install --endpoint http://127.0.0.1:5269 --project-id 7 --folder-id 9
node scripts/plugin-dev.mjs dev --endpoint http://127.0.0.1:5269 --project-id 7 --folder-id 9
node scripts/plugin-dev.mjs status --endpoint http://127.0.0.1:5269 --project-id 7
```

端口由当前宿主实际地址确定；CLI 不启动后端。安装调用现有 `/api/plugins/dev/install`，状态调用 `/api/plugins/dev/status`，保留管理员、纯 Web 包与同名包保护；不提供免签 JAR 安装。

投稿前登录官网「开发者中心」，填写资料并通过基本资料审核，然后创建专用投稿令牌，通过环境变量 `AWD_PLUGIN_TOKEN` 传入。令牌只用于本人插件投稿和状态查询，可过期、撤销；不要写入插件、命令参数或聊天记录。投稿仅在显式执行 `submit` 时上传，必须显式给出完整 HTTPS 投稿端点，路径通常是官网 `/api/plugins`，不跟随重定向。旧自动化的 `AWD_PLUGIN_SESSION_COOKIE` 暂时兼容；同时设置时只发送专用令牌：

```sh
node scripts/plugin-dev.mjs submit /tmp/my-plugin --endpoint https://YOUR-PORTAL/api/plugins
node scripts/plugin-dev.mjs submissions --endpoint https://YOUR-PORTAL/api/plugins
```

官网投稿版本目前只接受 `x.y.z` 三段数字，不能带预发布或构建后缀；本地 validate/package 仍支持完整语义版本。可选 `--price-cents 0`，缺省不更改上版定价。提交返回 `pending` 等服务端实际状态，不等于已审核、已签名或已发布。超时/异常结果不明时先到开发者后台核对，不自动重复上传。本地 `status` 只检查源包，不能冒充服务端审核状态。

完整按钮示例见 `examples/plugin-service-demo/`。从需求到安装、调试、申请、投稿的步骤见 [外部开发者指南](../../docs/plugin-developer-journey.md)，可运行的最小业务示例见 [清单助手](../../examples/checklist-helper/)。CLI 单测使用合成 loopback / fetch 契约夹具；真实旅程的验证范围另见示例记录，不把夹具当作生产认证或正式上架。

侧栏服务事件：`calendar.changed` 需 tasks、`favorites.changed` 需 file_read、`clipboard.changed` 需 clipboard，收到后重新读取授权数据。`speech.progress` 需 speech，只转发本机 Kokoro/ASR 组件进度。事件不携带平台凭据；账户/项目变更必须丢弃旧请求和缓存。新宿主能力目前尚未发版。

宿主固定服务、权限与取消语义详见 [SERVICES.md](SERVICES.md)。
