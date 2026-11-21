<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# hello-declarative-plugin

[简体中文](#简体中文) | [English](#english)

## 简体中文

零代码的声明式插件示例：宿主读取 `manifest.json`，注册模板、排版画像和设置项。无需 Java、JAR、前端页面或构建步骤。最低宿主版本为 **0.28.0**。

### 文件结构

```text
hello-declarative-plugin/
├── manifest.json                  插件信息、贡献项和设置声明
├── l10n/
│   ├── zh-CN.json                  中文名称与标签
│   └── en-US.json                  英文名称与标签
├── templates/
│   └── power-of-attorney.md        中文授权委托书模板
└── profiles/
    └── compact.json                紧凑排版画像
```

### 本地安装

把整个 `hello-declarative-plugin` 目录复制到插件目录，保留上面的相对路径：

| 运行方式 | 默认插件目录 |
|---|---|
| 本地开发（从 `backend/` 启动后端） | `backend/plugins/`（相对仓库根目录） |
| 打包桌面版 | `~/.aiworkdeck/plugins/`（`~` 为用户主目录） |

从仓库根目录执行，二选一：

```bash
# macOS / Linux
mkdir -p backend/plugins
cp -R examples/hello-declarative-plugin backend/plugins/
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force backend/plugins | Out-Null
Copy-Item -Recurse examples/hello-declarative-plugin backend/plugins/
```

自定义插件扫描目录时，复制到实际配置的目录。重启应用，或在插件广场点击「重新扫描」，再确认插件已启用。手动复制的插件通常默认启用；曾被禁用的插件需要重新启用。

本示例没有 `frontendEntry`，不会新增独立的左栏面板；通过宿主的模板、排版画像和插件设置入口使用它。

### 多语言标签

manifest 中的 `%key%` 引用 `l10n/<locale>.json` 的同名键，例如：

| manifest 值 | JSON 键 | 简体中文 | English |
|---|---|---|---|
| `%name%` | `name` | Hello 声明式插件 | Hello Declarative Plugin |
| `%tpl.poa%` | `tpl.poa` | 授权委托书（一般授权） | Power of Attorney (general) |
| `%profile.compact%` | `profile.compact` | 紧凑排版 | Compact layout |
| `%set.firm%` | `set.firm` | 律所名称 | Firm name |

同样，`%desc%` 和 `%set.autoNumber%` 分别引用 `desc`、`set.autoNumber`。修改标签时同步维护两份语言表。切换宿主语言会改变这些名称与标签，模板正文仍为中文。

### 贡献内容与试跑

| 贡献项 | 当前声明与行为 |
|---|---|
| 模板 `poa` | `genre: "letter"`，文件为 `templates/power-of-attorney.md`。创建时原样复制 Markdown；`【　】` 是人工填写位置。 |
| 排版画像 `compact` | `profiles/compact.json` 的正文为 11 pt 字号、14 pt 行距。需要显式选择；安装本身不会重新排版现有文档。 |
| 设置 `firmName` | 字符串，默认空字符串，标签为「律所名称」。 |
| 设置 `autoNumber` | 布尔类型，manifest 中默认值为字符串 `"true"`，标签为「自动编号」。 |

重新扫描并启用后，可查看并保存两项设置，从贡献模板创建 Markdown 文件并手动填空，再查看可用的紧凑排版画像。两个设置用于演示声明与保存，当前示例没有读取它们的执行代码，因此不会自动填入律所名称或生成编号。

进一步阅读：[插件开发指南](../../docs/plugin-guide.md)、[插件规范](../../docs/PLUGIN_SPEC.md)。

## English

A zero-code declarative plugin: the host reads `manifest.json` and registers a template, a style profile, and settings. No Java, JAR, frontend page, or build step is required. The minimum host version is **0.28.0**.

### Files

`manifest.json` declares the plugin and its contributions. `l10n/zh-CN.json` and `l10n/en-US.json` supply names and labels. The template is `templates/power-of-attorney.md`; the style profile is `profiles/compact.json`.

### Install locally

Copy the entire `hello-declarative-plugin` directory, keeping its relative paths intact:

| Mode | Default plugins directory |
|---|---|
| Local development, backend started from `backend/` | `backend/plugins/`, relative to the repository root |
| Packaged desktop | `~/.aiworkdeck/plugins/`, where `~` is your home directory |

From the repository root, use either command block:

```bash
# macOS / Linux
mkdir -p backend/plugins
cp -R examples/hello-declarative-plugin backend/plugins/
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force backend/plugins | Out-Null
Copy-Item -Recurse examples/hello-declarative-plugin backend/plugins/
```

If you configured a custom scan directory, copy there instead. Restart the app or click **Rescan** in the Plugin Marketplace, then confirm the plugin is enabled. Manually copied plugins are normally enabled by default; a previously disabled plugin must be enabled again.

This example has no `frontendEntry` and adds no standalone sidebar panel. Use the host's template, style-profile, and plugin-settings entry points.

### Localized labels

A manifest value such as `%name%` references the `name` key in `l10n/<locale>.json`. For example, it resolves to `Hello 声明式插件` in `zh-CN.json` and `Hello Declarative Plugin` in `en-US.json`.

The other references are `%desc%`, `%tpl.poa%`, `%profile.compact%`, `%set.firm%`, and `%set.autoNumber%`; remove the surrounding percent signs to find each JSON key. Keep both language files in sync when changing labels. Switching the host language changes these names and labels; the template body remains Chinese.

### Contributions and quick check

| Contribution | Current declaration and behavior |
|---|---|
| Template `poa` | Genre `letter`, backed by `templates/power-of-attorney.md`. Creation copies the Markdown unchanged; fill in the `【　】` markers manually. |
| Style profile `compact` | `profiles/compact.json` sets body font size to 11 pt and line spacing to 14 pt. Select it explicitly; installing the plugin does not reformat existing documents. |
| Setting `firmName` | String, default empty string, labeled "Firm name". |
| Setting `autoNumber` | Boolean type, declared with the string default `"true"`, labeled "Auto numbering". |

After rescanning and enabling the plugin, inspect and save the two settings, create a Markdown file from the contributed template and fill it in, then inspect the available compact style profile. The settings demonstrate declaration and storage. This example contains no execution code that reads them, so they do not fill in the firm name or generate numbering.

Further reading: [Plugin guide](../../docs/plugin-guide.md) and [Plugin specification](../../docs/PLUGIN_SPEC.md).
