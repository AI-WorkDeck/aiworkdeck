<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 服务型插件验收：登录、订阅、MCP 与通道

适用于 SDK 1.6 源码中的服务能力；源码合并不等于客户端发版或官网部署。以 `examples/plugin-service-demo` 为起点，在专用测试项目安装，不使用个人客户材料、正式凭据或真实收费账户。

## 必须验收的行为

| 范围 | 成功路径 | 失败与隔离 |
| --- | --- | --- |
| Bearer | 宿主设置输入凭据；插件只能看到连接状态；真实 HTTP 操作 | 错误凭据、401/403、断开、账户切换、重连；iframe 不得收到原始凭据 |
| OAuth | 外部浏览器授权 → 实际宿主回调 → PKCE 换码 → 加密保存 → 操作 | 过期/重复 state、错误 verifier、过期 token、刷新失败与并发刷新、刷新中断开、旧请求迟到 |
| 自有订阅 | 固定 statusOperation 返回布尔 active；固定 checkoutUrl 打开后重新查询 | 打开失败不能报 opened；打开不代表付款；断开和查询失败不能保留旧有效提示；402 不冒充认证失效 |
| 平台插件购买 | 正确站点/语言结账；购买后主动同步权益 | 余额不足、订单金额错误、他人订单、未支付、重复结算、重复购买、账户切换和离线缓存 |
| MCP | manifest 声明匹配远端工具/schema，经真实宿主桥与 HTTP 调用 | isError、schema 不符、401、超时、停用/撤权/断开、迟到结果；不得盲目重放工具 |
| 共享 AI / 自带密钥 | 宿主当前通道、账户与模型配置生效，独立记录请求与用量 | 平台余额不足不得偷偷转 BYOK；BYOK 错误不得转平台；密钥与返回结果不能串账户 |

OAuth 为公共客户端 Authorization Code + S256 PKCE。单机回调使用当前监听端口的 `http://127.0.0.1:<port>/api/plugins/oauth/callback`，服务端模式需配置可信 HTTPS `ai.plugins.oauth-redirect-uri`；供应商须支持并登记相应回调。连接状态的 `needsReconnect` 表示应由用户重新连接。平台 `billing.status().refreshed` 表示本次刷新是否成功；false 时 active 可能来自尚有效的本账户缓存，不能用来确认刚发生的付款。

MCP 当前为公网 HTTPS Streamable HTTP，不支持 stdio、本地进程或私网。共享 AI 指调用宿主已经配置的通道，不保证所有宿主都使用平台付费账户。开发者自有订阅的付款处理和 webhook 属于其服务商；宿主提供连接、状态和结账入口，不提供任意按调用代收接口。

## 自动回归

在主仓运行；后端先安装 `backend/plugin-api`，本机 Maven 使用 JDK 21：

```sh
mvn -f backend/plugin-api/pom.xml install
mvn -f backend/pom.xml -Dtest='Plugin*Test,EntitlementServiceTest' test
node --test frontend/tests/plugin-sdk/*.test.mjs frontend/tests/plugins/*.test.mjs sdk/plugin-sdk/tests/*.test.mjs scripts/tests/plugin-dev.test.mjs
node scripts/plugin-dev.mjs validate examples/plugin-service-demo
```

`PluginConnectionHttpTest` 使用真实 HTTP、加密凭据存储与控制器，身份/插件清单为合成测试对象；`PluginMcpEndToEndTest` 使用真实清单、注册器、凭据及 HTTP；`PluginAiRoutingIntegrationTest` 通过真实控制器、模型工厂与两个独立 HTTP 服务验证选路，账户签发/额度依赖仍为测试对象。它们与下面完整宿主验收相互补充，不能只看通过数量。

官网仓 `npm run test:plugin-billing` 应分别设 `NEXT_PUBLIC_AWD_SITE=cn` 和 `intl`。它在全新临时目录使用真实账户、订单、SQLite、路由、Ed25519 签名、下载文件 SHA-256 和权益；只有支付供应商为合成 HTTP。同时跑既有 `verify-payments.mts` 的两站契约，包括已有回调校验测试。测试检查付费文件响应 `private, no-store` 与 `Vary: Authorization`，免费文件保持公共缓存。将来部署这项缓存修复时，需清理可能存在的旧付费下载共享缓存；本次没有部署或检查生产 CDN。

## 完整宿主的隔离服务

仓库提供两个仅用于本机测试的供应商，均只监听 `127.0.0.1`，只使用写明的合成凭据，不向外部服务转发：

```sh
PROVIDER_PORT=19853 CALLBACK_ORIGIN=http://127.0.0.1:19851 node scripts/test-fixtures/plugin-services-provider.mjs
node scripts/test-fixtures/plugin-shared-account-fixture.mjs --port 19854
```

前者提供 Bearer/OAuth S256、服务请求、订阅网页及 MCP；后者提供合成账户、余额、平台模型密钥、模型 HTTP 和平台权益。合成结账按钮只是改测试状态，不是真实扣款。二者默认将审计写入系统临时目录，仅记录去敏事件/计数。

`backend/src/test/.../PluginServicesFixtureApplication` 是只存在于 test classpath 的完整 Spring 启动入口。先 `test-compile`，用 Maven `dependency:build-classpath` 取得依赖，再用 `target/test-classes:target/classes:<依赖>` 启动该类。必须传 `--fixture-port=19853`、实际宿主端口、desktop profile，并通过 `-Duser.home`、HOME、工作目录及存储配置指定全新临时路径。不要复用用户客户端的 HOME、数据库、项目或已安装插件。

该启动器仅把生产已校验的 `https://service.example.invalid` 精确映射到本机合成 HTTP；保留真实控制器、数据库、开发服务信任与凭据存储。它不在正式 JAR 中，禁止将其变为生产代理或放宽 SSRF。浏览器端 OAuth/结账页也需要测试浏览器对这个精确域名做传输转发，业务响应来自实际合成 HTTP，不能伪造桥返回成功。

共享账户测试可将 `ai.account.base-url` 指向第二个服务，模型 `ai.model.open-router.base-url` 指向其 `/v1`。平台 checkout 按生产规则只打开 HTTPS：要测试此入口，可在隔离服务前设置本机 HTTPS 代理，证书仅放入此测试 JVM 的独立 truststore，测试浏览器也使用独立 context；不要修改系统信任或产品 URL 校验。BYOK 地址则通过真实宿主设置 `external.openrouter.baseUrl` 配置，与平台模型地址分开。

从真实插件开发入口创建源码、安装、授予服务信任、打开工作区，然后逐项执行上表。源码新文件必须经宿主资源管理器导入/创建；直接往项目磁盘目录复制未注册的新文件，不等于已进入安装清单。实际操作应保留截图、去敏服务审计、请求计数和断言，尤其核对 iframe 与可信宿主设置页各自的职责。

## 验证边界

本机合成供应商用于验证产品的真实接入链和状态变化，不代表真实第三方 OAuth 应用审核、支付资质、签名密钥轮换、真实扣款/退款、生产 DNS/TLS/CDN 或正式 Electron 系统浏览器均已认证。每个正式供应商仍须在其沙箱或授权环境单独验收。测试没有执行客户端升级、Release 或官网部署。

连接取消、插件停用和账户切换会拒绝旧结果；不能保证已经提交到服务端的操作回滚。原始 token 回显检测只针对直接字符串，不是对恶意服务商编码泄漏的万能过滤器。权限、幂等和服务商可信度仍需开发者设计。
