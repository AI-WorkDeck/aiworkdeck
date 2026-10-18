<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 清单助手：从粘贴文字到可复用清单

这是一个无需构建、无需模型或自有服务器的 Web 插件示例。粘贴每行一项的文字，点击「整理清单」，即可去掉常见清单前缀、合并完全相同的重复行，输出复选框或编号清单。保留首次出现的顺序，不按语义合并条目；`3.14` 等数字正文不会被当成编号删除。结果可选中复制。

正文只在当前 iframe 内处理，不发送给宿主、模型或外部服务，不写入文件或插件存储。关闭面板或切换账户/项目时清除本页文字。宿主只保存用户主动提交的格式偏好 `listStyle`。

## 宿主接入

Manifest 的 `permissions` 是空数组：无需文件、编辑器、AI、网络或剪贴板权限。`contributes.views` 声明全局侧栏入口，无项目时也可使用，可停靠左侧、右侧或底部。

- `awd.settings.get('listStyle')`：加载用户偏好，默认 `checkbox`。
- `awd.settings.update({ listStyle }, { scope: 'user' })`：点击保存后更新宿主用户设置。
- `awd.settings.open()`：打开可信宿主设置界面。
- `settings.changed`：重新读取设置；账户/项目变化时作废在途结果并清空正文。

SDK 必须同步加载并早于业务脚本，业务在 `awd.ready()` 后接入宿主。页面使用 `--awd-*` 主题变量、原生表单和可访问标签；旧宿主返回 `unknown_method` 时显示升级提示。设置操作有等待、失败与重试反馈，失败不清除正在整理的文字。

## 开发与安装

在仓库根运行（Node.js 20+）：

```sh
node scripts/plugin-dev.mjs validate examples/checklist-helper
node scripts/plugin-dev.mjs package examples/checklist-helper --out /tmp/checklist-helper-0.2.0.zip
```

输出 ZIP 已存在时命令会拒绝覆盖；改动已投稿版本应提高 `manifest.version`。

桌面本机安装：打开一个测试项目，把整个 `checklist-helper` 文件夹从 Finder/资源管理器拖入工作台的资源管理器。启用「插件开发」后，在其列表找到这个源码包，点击安装或重新安装；查看入口并点击使用。目录名称须与 manifest ID 一致。导入目录需要桌面文件能力，普通浏览器不能取得本机文件夹路径。

浏览器开发可通过「插件开发 → 新建插件」创建同名骨架，再在工作台文件树中编辑 `manifest.json` 和 `web/index.html`，等待保存完成后安装；骨架自带官方 SDK。源码修改后必须重新安装，不是自动热更新。另一条路线是让产品内 Agent 使用公开的 `plugin_dev_scaffold`、文件编辑工具及 `plugin_dev_install`，这些工具并非外部 CLI 命令。

CLI 安装需要已导入项目的源码文件夹 ID，可先读取实际宿主状态：

```sh
node scripts/plugin-dev.mjs status --endpoint http://127.0.0.1:5269 --project-id 7
node scripts/plugin-dev.mjs install --endpoint http://127.0.0.1:5269 --project-id 7 --folder-id 9
```

端口、项目 ID、folderId 以当前宿主和状态返回为准。只在已确认的本机免登模式下省略会话；鉴权模式使用本人已有的 `AWD_SESSION_ID`，不得伪造。完整安装与投稿步骤见 [SDK README](../../sdk/plugin-sdk/README.md)。本地安装不等于已审核、签名或公开发布。

## 验收提示

粘贴两行重复文字及一行 `3.14`，确认去重且数字保留；切换编号后保存，关闭重开应恢复格式。点击宿主设置，确认同一设置值；禁用后入口移除，重新启用立即恢复。测试等待、失败、重试和账户切换时不保留旧正文。真实本地验收不替代正式账号资格审核、OAuth、付款或发布验证。

## 源码与许可

`web/awd-plugin-sdk.js`、`web/awd-plugin-sdk.d.ts` 与 `manifest.schema.json` 是本仓 `sdk/plugin-sdk/` 对应文件的原样分发副本，应随官方 SDK 同步，不自行改桥协议。示例无第三方依赖，使用本仓 AGPL-3.0-or-later 许可并保留源文件版权头。
