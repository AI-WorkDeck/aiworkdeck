<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 插件界面版式规范（必读）

插件面板嵌在宿主工作台里，和宿主自己的面板并排出现。用户不区分「这是插件」还是「这是宿主」——
插件版式难看，用户的感受就是「AI WorkDeck 难看」。本文的每一条都来自实际踩过的坑
（2026-11 的版式排查：律所管理、项目沟通、客户协作、消息中心、设置页），不是审美偏好。

## 1. 先用 SDK 自带的样式，别自造

SDK 会自动注入 `awd-plugin-ui.css` 的核心规则，可直接用：

| 用途 | 类名 |
|---|---|
| 页面容器 / 刊头 | `.awd-plugin-stage` `.awd-plugin-header` `.awd-title` `.awd-subtitle` `.awd-header-actions` |
| 卡片 | `.awd-card` `.awd-card-header` `.awd-card-title` |
| 按钮 / 输入 | `.awd-btn` `.awd-btn-primary` `.awd-btn-sm` `.awd-input` `.awd-select` `.awd-textarea` |
| 指标 | `.awd-kpi-grid` `.awd-kpi-card` `.awd-kpi-label` `.awd-kpi-value` |
| 标签 / 分段切换 | `.awd-subnav` `.awd-subnav-item`（不折行，放不下横向滚动） |
| 徽标 | `.awd-badge` `.awd-badge-accent/-warning/-danger/-info/-gold` |
| 表格（SDK 1.9） | `.awd-table-wrap` > `table.awd-table`；长文本列的 `td` 加 `.awd-cell-text` |
| 提示条（SDK 1.9） | `.awd-notice` `.awd-notice-danger/-warning/-success` |
| 空状态（SDK 1.9） | `.awd-empty` > `.awd-empty-title` + `.awd-empty-desc` |

```html
<div class="awd-notice awd-notice-danger" role="alert">请先连接 AI WorkDeck 账户 <button class="awd-btn awd-btn-xs">去连接</button></div>
<div class="awd-table-wrap"><table class="awd-table">…<td class="awd-cell-text">东海精密装备诉华星半导体…</td>…</table></div>
<div class="awd-empty"><p class="awd-empty-title">还没有发票</p><p class="awd-empty-desc">在「提交发票申请」里开第一张</p></div>
```

自己写样式时尺寸与宿主一致：正文 12–13px、卡片标题 14px/600、卡片内边距 12px 14px、圆角用 `--awd-radius-*`。

## 2. 只用 `--awd-*` 令牌，名字要写对，并且带兜底值

```css
color: var(--awd-text-2, #6B675C);          /* ✓ */
background: var(--awd-danger-wash);          /* ✗ 宿主没有这个令牌，整条声明静默失效 */
```

- **写错令牌名不会报错**，属性直接失效、退回继承值——这是「看起来没样式」最隐蔽的来源。
  可用的令牌以宿主下发的为准（`awd.context.themeTokens` 的键，或宿主 `frontend/src/App.vue`）。
  常用：`--awd-text` `--awd-text-2` `--awd-text-3` `--awd-surface` `--awd-surface-2` `--awd-bg`
  `--awd-border` `--awd-border-subtle` `--awd-accent` `--awd-accent-text` `--awd-accent-wash`
  `--awd-danger-text` `--awd-danger-soft` `--awd-warning-text` `--awd-warning-soft`
  `--awd-info-text` `--awd-info-soft`（宿主没有 `success` 系令牌，成功态用 `accent`）。
- 插件可能跑在老宿主或独立预览里，**每个 `var()` 都给兜底值**。
- 不写死颜色、不写死深浅色——深色主题下宿主会换一整套令牌值。

## 3. 中文会在任意两个字之间断行：表格、标签、按钮要防挤压

中文没有空格，浏览器可以在任何两个字之间折行。容器一窄，「苏婉清（合伙人）」会被拆成三行，
「收案与立项」标签会变成「收案与立 / 项」。

- **表格**：外面套 `overflow-x: auto` 的容器；`th, td { white-space: nowrap; }`；
  只给真正的长文本列（案件名、主体名称）单独开折行，并给 `min-width`/`max-width`（如 12em–22em）。
- **标签栏 / 分段切换**：`white-space: nowrap; flex: none;`，放不下就横向滚动，不要折行。
- **按钮**：按钮文字不折行；按钮组用 `flex-wrap: wrap` 让整个按钮换行，而不是让字换行。
- **固定列数的网格**（如 5 步进度 `repeat(5, 1fr)`）在窄卡片里必然挤字。
  改用 `repeat(auto-fill, minmax(120px, 1fr))`，放不下自动多排。

## 4. 清掉浏览器默认样式

- `<p>`、`<h1>`–`<h3>`、`<ul>` 自带上下外边距（16px 左右），堆起来卡片会又高又散。
  在面板里统一重置为 `margin: 0`，间距由容器的 `gap` 决定。
- 没有设 `font-size` 的元素会继承浏览器默认 16px，比宿主正文大一号，非常扎眼。
  根容器（或 `.awd-plugin-stage`）设好 `font-size`，所有文字从这里继承。
- 原生 `<select>`、日期框外观随系统变；能用 `.awd-select` 就用。

## 5. 错误、提示、空状态要有形制

- 错误不是一行裸红字：用提示条（左侧 3px 色条 + `--awd-danger-soft` 浅底 + 12px 文字 + 内边距），
  能操作的给「重试」「去连接」按钮。
- **同一条错误只显示一次**。顶部已经提示「请先连接账户」，列表里不要再重复一遍。
- 空状态写清楚「为什么空、下一步做什么」，不要只留一行表头。

## 6. 不把内部码给用户看

规则码、枚举值、接口字段（如 `RED · R2_RETAINER_ADVERSARY`、`Y1_EXISTING_CLIENT_OTHER_MATTER`、`FIXED`）
是给程序看的。界面上用中文标签与徽标表达；需要留痕的放进导出文件或详情折叠区。

## 7. 和宿主配合，别画两遍

- 宿主侧栏已经有的（会话列表、搜索、新建按钮），面板里就不要再画一份。宿主会通过
  `sidebar.command` 发 `host-sidebar` 告诉你它接管了侧栏——**这条消息可能比 `context.get` 先到**，
  要先记下来，拿到 context 后再套用，否则会时有时无地出现两份列表。
- 宿主标签页已经显示了插件名，面板刊头不需要再放一个同名大标题加同一句说明。

## 8. 自动检查

`node scripts/check-ui-hygiene.mjs`（CI 必跑）会查官方插件与宿主前端：引用了宿主不存在的 `--awd-*` 令牌、
插件里的 `var(--awd-*)` 没带兜底值、模板里用了却没有任何样式的类名。它只能挡住「写错了」，
挡不住「挤、丑」——那要靠下一条的截图。

## 9. 交付前自检（截图核对，不能只看代码）

在宿主里打开插件，逐项截图看一遍：

1. **三档宽度**：窄（工作台右侧栏展开、面板约 560px）、中（约 900px）、宽（约 1400px）。
2. **四种数据**：空数据、一两条、很多条、超长名称（20 字以上的案件名/公司名）。
3. **异常态**：未登录/未连接账户、接口报错、无权限。
4. **深色主题**、**英文界面**各看一遍（英文通常更长，最容易撑破按钮和标签）。
5. 每个标签页、每个弹窗、每种状态（待处理/已通过/已驳回）都点到。

每一条都没有字被逐字拆行、没有横向撑破、没有裸红字、没有内部码，才算版式过关。
