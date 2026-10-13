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
