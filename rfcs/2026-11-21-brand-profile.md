<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 品牌配置（Brand Profile）：同一套代码构建贴牌版本

- **状态**：Draft
- **日期**：2026-11-21

## 一句话结论

一份品牌配置（`brand.json` + 素材目录）对应一套安装包。构建前由 `scripts/brand/apply-brand.mjs` 把配置分发给
desktop / frontend / backend。**默认品牌 `aiworkdeck` 构建出的产物与今天逐字一致**，这是整个方案的兼容锚点。
品牌只换「门面」与少量运行参数：账户体系、计费、插件生态、`/api/` 契约全部共用。

客户的品牌配置与素材可以放在本仓 `brands/<id>/`，也可以放在本仓之外（`--brand-dir <path>`），
后者用于尚未公开的客户。

## 1. 换什么，不换什么

### 1.1 换（品牌配置管）

| 维度 | 字段 | 现状位置 |
|---|---|---|
| 产品名（菜单、关于、通知、窗口标题、安装器、快捷方式） | `name` | `desktop/package.json` build.productName、`app-menu.js`、`about-window.js`、`main.js` 通知、`installer.nsh` |
| 界面文案里的产品名 | 构建期替换（§4） | `frontend/src/locales/**`、`desktop/main/app-language.js`、`office-addin/taskpane/locales` |
| 应用标识 | `appId` | `com.aiworkdeck.desktop` |
| 本机数据目录 | `dataDirName` | `desktop/main/awd-home.js`；后端 `security.license.dir` |
| Electron userData 目录 | `userDataDirName` | 默认由 package.json `name` 推导（见 `app-menu.js` 注释里的地雷） |
| 图标、DMG 背景、Windows 安装器图、登录页 logo | `assets/` | `desktop/build/*`、`frontend/src/static/*` |
| 主题色 | `tokens` | `frontend/src/App.vue` `--awd-*` |
| 固定站点 | `site` | `SiteProfileService`、`application.yml` `ai.account.sites` |
| 更新通道 | `update.manifestUrls` | `desktop/main/services/update-service.js` |
| 预装插件 | `bundledPlugins` | `desktop/package.json` extraResources 过滤表、`PluginBundledInstaller.IDS` |
| 付费门槛 | `gate` | 新增（§5） |

### 1.2 不换

- **公开契约**：`checkba://`、`com.checkba.*`、`--awd-` 令牌名、`X-AWD-*`、`AWD_*` / `CHECKBA_*` 环境变量名、端口链
  `[5269, 5369, 5169]`、插件握手 `awd: 1`、UA 产品记号 `AIWorkDeck/<ver>`。
- **AGPL 告示**：关于页、设置页、加载项页脚的许可告示与 `X-Source-Code` 响应头保留原文。贴牌版另加一行
  「{name} 基于 AI WorkDeck（AGPL-3.0）」。商标说明不允许把修改版叫 AI WorkDeck，所以名称替换是必须的；
  告示里的「AI WorkDeck」指出处，不替换。
- **`/api/` 契约、插件签名公钥、试用码公钥**：全品牌共用。

## 2. 配置文件

```
brands/
  README.md
  aiworkdeck/brand.json      # 默认品牌：所有字段等于今天的取值
  example/brand.json         # 示例贴牌，供测试与文档
```

```json
{
  "id": "example",
  "name": "Example Desk",
  "appId": "com.example.desk",
  "dataDirName": ".exampledesk",
  "userDataDirName": "exampledesk-desktop",
  "site": "intl",
  "update": { "manifestUrls": [] },
  "bundledPlugins": { "add": [], "remove": [] },
  "gate": null,
  "assets": { "icon": "assets/icon.png" }
}
```

## 3. 构建出口

`node scripts/brand/apply-brand.mjs [--brand <id> | --brand-dir <path>]`（默认 `aiworkdeck`）：

1. 校验配置；
2. 写运行期配置 `desktop/main/brand.json` 与 `frontend/src/brand/brand.json`。这两个文件**以默认品牌内容入库**，
   贴牌构建时被覆盖。CI 门禁：`apply-brand --brand aiworkdeck` 后 `git diff --exit-code`；
3. 写 `desktop/build/brand/electron-builder.json`：package.json `build` 段与品牌覆盖项深合并后的完整配置
   （productName、appId、dmg.title、nsis.shortcutName、图标）。贴牌构建用
   `electron-builder --config build/brand/electron-builder.json`；默认品牌照旧用 package.json，不受影响；
4. 复制品牌素材。

### 3.1 运行期

- **desktop**：`desktop/main/brand.js` 读取 `brand.json`，向 `app-menu`、`about-window`、`awd-home`、`update-service`、
  `main.js` 通知文案提供名称、数据目录、更新地址。
- **数据隔离**：非默认品牌在拿单实例锁之前把 userData 指到 `<appData>/<userDataDirName>`，数据目录为
  `<home>/<dataDirName>`，并以 `SECURITY_LICENSE_DIR` 把后端状态目录（账户、授权、站点、H2 库等）指过去。
  这样贴牌版与 AI WorkDeck 可以装在同一台电脑上，账户、数据互不干扰。后端仍有三处直接拼
  `${user.home}/.aiworkdeck`（H2 地址、插件凭据密钥、反馈日志路径），改为先认 `security.license.dir`，默认值不变。
- **后端复用判定**：端口链上找到的已有后端，build 指纹必须带品牌，避免贴牌版复用 AI WorkDeck 的后端。
- **固定站点**：配置了 `site` 的品牌经 `AI_ACCOUNT_RESOLVED_SITE` 固定站点，界面不出现站点切换。

## 4. 文案替换

不逐条把 2000 多条词条改成 `{brand}` 占位符（改动面大、与 `check-locale-parity` 冲突、翻译易漏）：

- `frontend/src/i18n/index.js` 的 `buildMessages` 在非默认品牌下把「AI WorkDeck」替换为 `name`；
- 受保护键（AGPL 告示、商标说明、版权、源码链接）不替换，清单在 `frontend/src/brand/protected-keys.js`；
- 桌面主进程与 Office 加载项同样处理；
- 新增检查：非默认品牌构建产物里的「AI WorkDeck」只能出现在受保护键里。

## 5. 付费门槛（可选）

`gate: { "feature": "<entitlement>", "offlineGraceDays": 7 }`：

- 启动后必须登录账户；`EntitlementService.isEnabled(feature)` 为假时只显示订阅页，不进入工作台；
- 本地检查只是体验层。真正的门槛在服务端：贴牌客户的专属服务与平台模型调用由服务端核验同一个特性；
- 默认品牌 `gate` 为 `null`，行为不变。

## 6. 账户与记账（官网仓）

账户、订单、钱包与支付回调在官网仓，本仓只经 HTTP 调用。

- 账户增加不可变的 `brand`，标记注册来源；客户端登录、注册时带上品牌 id；
- 订单、钱包流水、网关用量带 `brand`，支付渠道的订单元数据同步写入；
- 官网后台按品牌出月度收支表；
- 贴牌客户迁出时按 `brand` 导出账户、订单、流水。

## 7. 分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | `brands/`、`apply-brand`、desktop 名称、图标、appId、数据隔离、frontend 名称与 logo | 默认品牌零差异、现有测试全绿；示例品牌本地打包可与 AI WorkDeck 并装并跑，界面无残留旧名（受保护键除外） |
| P2 | 后端固定站点、预装插件、登录带品牌 | 示例品牌新账户在官网带品牌标记 |
| P3 | 付费门槛、订阅页、服务端核验 | 未订阅账户进不了工作台 |
| P4 | 订单与用量带品牌、月度收支表 | 测试数据出表并与支付后台逐笔核对 |
| P5 | CI 品牌矩阵、签名、独立更新通道、Office 加载项 | 正式签名安装包；各品牌更新清单互不串 |

## 8. 待定

- 各品牌独立的更新清单是否共用同一把更新签名密钥（建议共用，发布方相同）；
- Office 加载项是否随品牌出独立 manifest（需要新 GUID 与独立托管域名）。
