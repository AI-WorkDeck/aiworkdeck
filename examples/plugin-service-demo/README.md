<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 宿主服务与独立连接示例

本例使用 SDK 1.6，演示用户主动发起的设置保存、宿主 AI、项目搜索、Bearer 与 OAuth 独立登录、固定服务操作、MCP、平台权益和服务商订阅。页面不会接收或保存凭据。连接凭据只能在宿主可信设置页面输入，OAuth 在外部浏览器授权。

`https://service.example.invalid` 是保留的无效示例地址。使用前将 manifest 中的连接、授权端点、MCP 地址和订阅地址替换为自己控制的 HTTPS 服务，并完成服务商的 OAuth 客户端登记。示例没有内置测试账号、API 密钥或生产付费商品。宿主仍检查地址、权限与项目访问，不能用示例绕过限制访问本机或内网服务。

## 本例的服务协议

两条连接分别是 `example-provider`（Bearer）和 `oauth-provider`（OAuth）。OAuth 使用 `/oauth/authorize`、`/oauth/token`，客户端 ID 为 `plugin-service-demo`，scope 为 `profile`。请按实际宿主授权请求中的 `redirect_uri` 登记回调地址，并保留宿主发出的 state 和 PKCE 参数；授权码交换由宿主完成，不经过插件 iframe。

两条连接均只声明以下固定操作：

| 操作 | 请求 | 预期用途 |
| --- | --- | --- |
| `query` | `POST /v1/query`，JSON `{ "input": "用户输入" }` | 返回自己的业务查询结果 |
| `subscription` | `GET /v1/subscription` | 返回 `{ "active": true, "plan": "示例方案" }`，active 必须是布尔值 |

自有订阅页面为 `/plans`，状态使用 `subscription` 操作。平台权益与自有订阅分开查询；打开付款页面不代表付款完成，也不代表存在自动分账。

MCP 服务 ID 为 `example-mcp`，地址 `/mcp`，绑定 Bearer 连接。声明工具 `echo`，接受对象 `{ "text": "要回显的文字" }`；服务端必须按宿主支持的 HTTP MCP 协议实现工具调用。工具返回 `isError: true` 时，示例将其显示为执行失败，不能因为 HTTP 成功就显示操作成功。

## 本地开发和操作顺序

在仓库根执行 `node scripts/plugin-dev.mjs validate examples/plugin-service-demo`，再运行 `node scripts/plugin-dev.mjs package examples/plugin-service-demo --out /tmp/plugin-service-demo.zip`。按照 [公开 SDK 指南](../../sdk/plugin-sdk/README.md) 将源码目录导入宿主项目、使用开发安装入口，并在可信宿主设置确认开发来源。详情见 [服务接口](../../sdk/plugin-sdk/SERVICES.md)。旧宿主返回 `unknown_method` 时页面会提示升级。

1. 打开插件，保存 greeting 或进入宿主设置。AI 按宿主当前通道与额度运行；项目搜索需要 `file_read` 权限。
2. 选择 Bearer 或 OAuth，点击“打开所选连接设置”，在宿主完成凭据输入或外部浏览器授权，然后点击“刷新连接状态”。打开设置本身不等于已经登录。
3. 用所选连接发送查询，分别验证两条连接的状态与请求；断开连接后再次请求应失败。
4. 查询 MCP 服务并调用 echo；修改参数检查错误反馈。
5. 分别查询平台权益和服务商订阅。打开订阅页面仍需宿主确认，返回后再次查询状态；本示例不自动付款。
6. 长请求可取消等待。已经开始的远端操作可能继续执行，重试有副作用的请求前先查询状态。账号或项目变化会清空旧输入与结果并要求重新打开插件。

## 验证边界

`frontend/tests/plugin-sdk/service-demo.test.mjs` 验证实际示例脚本的选择、错误和生命周期行为，使用可控 SDK 替身，不属于供应商集成验收。`service-opening.test.mjs` 验证浏览器阻止或系统打开失败不会报成功。完整验收还需用真实宿主和服务端协议走登录、回调、请求、MCP 与权益查询。

隔离集成可以使用合成协议服务，但公共示例不内置回环地址放行或重定向。合成服务证明宿主协议和 UI 路径，不证明任何真实供应商账号、生产支付、分账或结算可用；不要在生产广场或真实账户制造测试订单。
