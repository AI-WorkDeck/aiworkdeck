好，下面直接给你一份可以扔进 `docs/ui-design-system.md` 的版本。整体默认你用 uni-app + Vue3，不绑具体组件库，只定义“设计 token + 使用规则”。

---

# S2《核查宝 UI 设计系统规范 v1.0》

> 目标：在 S1 的交互原则基础上，将“简洁、清爽、高级、重点突出”具体化为颜色、字体、间距、组件样式与动效规则，统一三端（桌面端 / 移动端 / 管理后台）的视觉风格，方便 Cursor 直接按此实现。

---

## 1. 设计理念与总体要求

1. 整体气质：简洁、清爽、高级。
   视觉上以**中性色 + 单一主色**为主，不搞花里胡哨的多色拼盘，不用大面积色块背景。
2. 重点突出：任何时刻，只允许有**一个主视觉焦点**（例如一个主按钮、一个当前选中卡片）。
3. 一致优先：相同类型的元素在全系统各处样式**必须一致**。例如：所有主按钮样式统一，不能某些页面是圆角 4px，另一些是 8px。
4. 默认是**亮色模式**（Light theme），深色模式暂不实现，只在设计上预留可能性。

---

## 2. 颜色系统

本系统采用“中性色为底 + 单主色为重点 + 少量语义色”的结构。你可以改具体 hex 值，但**结构与用途不变**。

### 2.1 颜色角色与命名

建议在样式层定义以下颜色 token（可用 CSS 变量 / SCSS 变量 / uni-app 自定义主题变量等方式）：

* 主色：`color-primary`
* 主色浅色系：`color-primary-light`
* 主色深色系：`color-primary-deep`
* 中性色：`color-bg`, `color-bg-soft`, `color-surface`, `color-border`, `color-text`, `color-text-secondary`, `color-text-muted`
* 语义色：`color-success`, `color-warning`, `color-danger`, `color-info`

### 2.2 建议色板（示例，可按需要微调）

你可以先用下面这一组，够简洁、清爽，也挺“核查感”的：

* 主色（Primary）：偏蓝绿的知性色

  * `color-primary`: `#2E7C9F`
  * `color-primary-light`: `#E4F1F6`
  * `color-primary-deep`: `#205870`
* 中性色

  * `color-bg`（全局背景）：`#F5F7FA`
  * `color-bg-soft`（卡片浅背景）：`#FFFFFF`
  * `color-surface`（输入框/表格等）：`#FFFFFF`
  * `color-border`: `#D6D9E0`
  * `color-text`（主文本）：`#1F2430`
  * `color-text-secondary`：`#4E5566`
  * `color-text-muted`：`#8A92A6`
* 语义色（保持克制使用）

  * `color-success`: `#18A058`
  * `color-warning`: `#F0A020`
  * `color-danger`: `#D03050`
  * `color-info`: `#2080F0`

### 2.3 使用规则

1. 背景

   * 页面底色统一使用 `color-bg`；
   * 卡片、模块容器统一使用 `color-bg-soft`；
   * 严禁使用大面积主色作为页面背景，以保持清爽和对比度。

2. 主色的使用

   * 主色只用于：

     * 主按钮（Primary Button）；
     * 当前选中状态（Tab 选中、当前步骤、当前菜单项的左边小条）；
     * 极少数关键数字/标签（如高优先级项目标识）。
   * 同一视图中，主色元素不超过 3 处，其中真正抢眼的只保留 1 处。

3. 语义色的使用

   * `success` 用于操作成功提示的 ICON、小标记，不大面积铺满背景；
   * `warning` 用于风险提醒、未完成提示；
   * `danger` 仅用于危险操作（删除、撤销）按钮与错误提示；
   * `info` 用于辅助信息、标签，不可与主色抢主角。

4. 状态变化

   * hover 状态：使用主色的浅色系或边框加深；
   * active 状态：颜色略深、阴影略减弱，表现“被按下”；
   * disabled 状态：统一降低不透明度 + 文本颜色改为 `color-text-muted`，禁止使用高饱和颜色。

---

## 3. 字体与排版

### 3.1 字体家族

中英文混排建议：

* 中文：`"PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont`
* 英文/数字：继承同一套 system-ui 字体，保证跨平台较统一。

### 3.2 字号与层级

以桌面端为基准，移动端可适度放大 1–2px：

* 页面主标题（H1）：20–22px，行高 1.4
* 模块/卡片标题（H2）：16–18px，行高 1.4
* 正文文本：14–15px，行高 1.6
* 次要说明、小标签：12–13px，行高 1.5

规则：

1. 一个页面只允许有 1 个 H1，其他使用 H2/H3 或普通文本 +强调。
2. 避免超过 3 个字号层级，字号层级过多看起来就不高级了。
3. 所有中文正文统一使用常规字重（400），标题适度使用中等字重（500–600），不要滥用粗体。

### 3.3 文本对齐与段落

1. 表格内容、数字统一右对齐或居中，对比性强的字段（金额、百分比）采用右对齐；
2. 多行正文文案默认左对齐，段落间距不小于 8px；
3. 说明文案一律用短句，避免法律条文式长句挂在 UI 上。

---

## 4. 间距与布局

### 4.1 基础间距单位

全系统采用统一的 spacing 单位：**4px 网格**。

常用间距组合：

* XS：4px（极小间距）
* S：8px
* M：12px
* L：16px
* XL：24px
* XXL：32px

### 4.2 页面布局

1. 页面左右留白：桌面端建议在内容区两侧各保留至少 24px；
2. 顶部与标题之间：16–24px；
3. 模块之间：至少 16px 间距，不要让卡片直接贴在一起。

### 4.3 组件内间距

1. 按钮内边距：

   * 高度：32–40px（桌面），28–36px（移动）；
   * 水平 padding：16–20px。
2. 表单项：

   * 输入框高度：32–40px；
   * 表单项上下之间：12–16px；
   * 分组块之间：24px。
3. 卡片：

   * 内容区 padding：16–20px；
   * 卡片之间：16px。

---

## 5. 关键组件视觉规范

以下样式规则适用于三端（桌面/移动/管理），在实现时仅考虑端上的尺寸适配，不改变视觉逻辑。实现层面，优先通过 TDesign 组件（如 Button/Input/Table/Dialog/Drawer/Tabs 等）来完成，以下规范是对 TDesign 组件的使用约束与二次封装规则，而不是另起炉灶重做一套组件。

### 5.1 按钮（Button）

定义四种按钮类型：

1. 主按钮（Primary Button）

   * 背景：`color-primary`
   * 文本：白色
   * 圆角：6–8px；
   * 阴影：极轻（如有），以边框/颜色变化为主；
   * 禁止在一个区域内出现多个 primary 按钮，只保留一个主动作。

2. 次按钮（Secondary Button）

   * 背景：白色
   * 边框：`color-border`
   * 文本：`color-text`
   * hover 时仅边框稍加深或背景略带浅灰/浅主色。

3. 文字按钮（Text Button）

   * 无背景，仅文字 + 简单下划线或主色文本；
   * 用于辅助操作（“查看详情”“更多筛选”）。

4. 危险按钮（Danger Button）

   * 背景：`color-danger` 或边框危险色；
   * 只能用于破坏性操作（删除、撤销、清空）。

所有按钮需有统一的交互状态：

* hover：略微提高亮度或加深边框；
* active：轻微压下效果（可通过阴影减弱或颜色加深）；
* disabled：降低不透明度，禁止 pointer 事件，鼠标指针保持默认或不变。

### 5.2 输入控件（Input / Select / Textarea）

1. 基础样式

   * 背景：`color-surface`（通常为白色）；
   * 边框：1px 实线 `color-border`；
   * 圆角：6px；
   * 焦点态（focus）：边框颜色变为 `color-primary`，可附带轻微发光（不强烈）。

2. 占位符

   * 颜色使用 `color-text-muted`；
   * 文案简短，指示输入格式或示例。

3. 错误态

   * 边框变为 `color-danger`；
   * 下方显示错误文案，字符数尽量控制在 30 字以内。

### 5.3 卡片与列表

1. 卡片（Card）

   * 背景：`color-bg-soft`
   * 边框：1px 或 阴影极轻（仅一层，小范围，避免“浮起来像广告”）；
   * 圆角：8px；
   * 卡片之间保持 16px 间距；
   * 点击卡片整体时需有 hover 效果（背景轻微加深或边框高亮）。

2. 列表（List）和表格（Table）

   * 与卡片同一风格；
   * 奇偶行色差不要太明显，浅灰即可；
   * 表头背景色可以略深于内容行，文本加粗。

### 5.4 标签（Tag / Badge）

1. 标签用于轻量状态展示，如“进行中”“已完成”“风险”。
2. 颜色规则：主色标签表示当前关注的标签类型，其余使用中性色或语义色浅版；
3. 形状：小圆角矩形，左右内边距 6–8px，高度约 20–24px。

### 5.5 弹窗（Modal）与抽屉（Drawer）

1. 弹窗

   * 宽度一般为视口宽度的 30–40%，最大不超过 640px；
   * 背景白色，圆角 8–10px，阴影适中；
   * 头部：标题 + 可选说明；
   * 底部：右侧对齐按钮组，最多 2–3 个按钮。

2. 抽屉

   * 从右侧滑出，宽度占视口的 30–40%；
   * 内容滚动，不浮动到底部；
   * 顶部固定标题和关闭按钮，底部可固定操作区。

两者都必须遵守：**主按钮放在右侧，取消/关闭放左**，避免反直觉排布。

### 5.6 Tab / Steps / Breadcrumb

1. Tab

   * 采用下划线高亮式（主色线条 + 主色文字），非选中项用次文本色；
   * Tab 数量不超过 5 个，多余的用下拉菜单归类。

2. Steps

   * 横向步骤条，当前步骤用主色填充，已完成用主色浅色，未开始用中性色；
   * 步骤名简短可读，不使用过长法律条文标题。

3. Breadcrumb（如有）

   * 简洁文本 + 分隔符（`>`），不附带图标，避免视觉噪音。

---

## 6. 图标与插画

1. 图标风格

   * 采用线性图标（outline），线宽统一；
   * 关键交互图标可使用主色，其余使用次文本色。

2. 插画

   * 只在空状态页和少数 landing 区域使用；
   * 风格简洁、扁平，避免复杂人物细节，尽量用抽象的法律/文档/流程元素。

3. 禁忌

   * 禁止使用过多 Emoji；
   * 禁止使用过于可爱或娱乐化的插画（降低“高级感”和严肃度）。

---

## 7. 动效与过渡

1. 动效使用场景

   * 按钮点击、弹窗打开/关闭、抽屉滑出/收起、Tab 切换、列表新增项的淡入。
   * 禁止在无意义场景大量使用动画（比如数字滚动特效、背景渐变闪烁等）。

2. 动画参数建议

   * 时长：150–250ms；
   * 缓动：`ease-out` / `cubic-bezier(0.4, 0, 0.2, 1)`；
   * 位移动效（如抽屉）可以结合轻微的透明度变化。

3. Loading 动效

   * 采用简洁的 spinner 或 skeleton，不用花哨的 Lottie 动画。

项目已安装 anime.js。默认情况下，动效优先使用 TDesign 内建过渡和 CSS 过渡；只有在首页首屏、关键数据变化、少量微交互等场景下，才使用 anime.js 实现增强，不得在表单和日常操作中大量使用复杂动画。

---

## 8. 响应式与多端适配原则

1. 桌面端

   * 设计宽度约 1200–1440px，内容区域居中；
   * 列表与表格为主，保持足够列宽，不强塞过多列。

2. 移动端

   * 单列布局，所有卡片/表单全宽；
   * 按钮高度适当增大，点击区域不少于 44x44px。

3. 管理后台

   * 以桌面端为主，暂不针对极小屏幕专门适配；
   * 可以适度在表格上使用横向滚动，但尽量通过列折叠/字段分组优化信息量。

---

## 9. 实现建议（给 Cursor 用的落地提示）

这一节是写给 Cursor 的实践建议，便于你后面直接引用：

1. 在项目的公共样式文件中（例如 `styles/theme.scss` 或 `uni.scss`），定义上述颜色和 spacing token。
2. 所有页面和组件**禁止直接写硬编码颜色**（如 `#409EFF`），必须通过 token 变量引用。
3. 编写基础 UI 组件（Button/Input/Card/Tag/Modal/Drawer/Empty/Toast），统一使用这些 token。
4. 对于第三方组件库（如果用到），通过自定义主题/覆盖样式的方式强行贴合本规范，而不是随组件默认样式走。


## S2 补充：与 TDesign + anime.js 的适配规范

### 10.1 总体原则

1. **TDesign 是默认组件库基线**

   * 所有按钮、输入框、表格、弹窗、抽屉、Tabs、Steps 等，**优先用 TDesign 组件** 实现，不再自己造一整套轮子。
   * S2 前面写的“按钮/输入框/卡片规范”，视为对 TDesign 组件使用的**约束和二次封装规则**，不是和 TDesign 对着干。

2. **颜色、字号等 token → 映射到 TDesign 主题变量**

   * 不在各个页面里随便写 `#xxxxxx`，而是在 TDesign 主题层统一改色。
   * S2 里给的 `color-primary`、`color-success` 等，**要映射到 TDesign 的品牌色 / 语义色配置**。

3. **anime.js 只做“加分项动效”，不是 Everywhere**

   * 默认使用 TDesign 自带的过渡（Dialog、Drawer、Message 等），
   * anime.js 仅用于**少数场景**：比如页面首屏进场、进度条/时间轴流动感、小卡片的 subtle hover，不改变我们在 S2 里定的“150–250ms + 简洁”的基调。

---

### 10.2 颜色系统与 TDesign 主题对齐

你可以这么理解：

* S2 里的颜色变量：**产品视角的设计 token**；
* TDesign 里的 `brandColor` / `successColor` 等：**技术实现层的 token**。

我们做一层映射，例如（伪代码/概念示意）：

```ts
// 设计层（S2 定的）
const designTokens = {
  colorPrimary: '#2E7C9F',
  colorSuccess: '#18A058',
  colorWarning: '#F0A020',
  colorDanger:  '#D03050',
  colorInfo:    '#2080F0',
  // 中性色
  colorText: '#1F2430',
  colorBg: '#F5F7FA',
  // ...
}

// TDesign 主题配置层（示意）
const tdesignTheme = {
  brandColor: designTokens.colorPrimary,
  successColor: designTokens.colorSuccess,
  warningColor: designTokens.colorWarning,
  errorColor: designTokens.colorDanger,
  infoColor: designTokens.colorInfo,
  // 如果支持 textColor / bgColor 之类，也一起映射
}
```

**对 Cursor 的约束可以写成：**

* 不允许在组件上直接写死颜色，例如：`style="color: #2E7C9F"`；
* 必须通过：

  * TDesign 主题（推荐），或者
  * 全局 CSS 变量（`var(--color-primary)`）
    来使用颜色。

这样，TDesign 自己的 Button/Dialog 等，也会自动“长成我们那套颜色气质”。

---

### 10.3 S2 中各组件规则如何落到 TDesign

可以简单做一个映射表，你后面丢给 Cursor 很好用：

#### 按钮（Button）映射

| 设计规范中的按钮类型    | TDesign 组件 & 属性建议                                                                          | 备注                       |
| ------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
| 主按钮 Primary   | `<t-button theme="primary" variant="base">`                                                | 只保留一个主动作，颜色来自 brandColor |
| 次按钮 Secondary | `<t-button theme="default" variant="outline">`                                             | 白底 + 边框，符合“次级”规范         |
| 文字按钮 Text     | `<t-button theme="default" variant="text">`                                                | 只用在辅助操作，如“查看详情”          |
| 危险按钮 Danger   | `<t-button theme="danger" variant="base">` 或 `<t-button theme="danger" variant="outline">` | 只用于删除/破坏性操作              |

要求：

* **一个操作区最多 1 个 `theme="primary"` 按钮**，避免多个主按钮抢主角；
* 禁止随意自定义红色按钮，如果是危险操作，统一用 TDesign 的 danger 色，和 S2 的 `color-danger` 对齐。

#### 表单组件映射

* 文本输入：`<t-input>` / `<t-textarea>`
* 选择：`<t-select>` / `<t-radio-group>` / `<t-checkbox-group>`
* 日期时间：`<t-date-picker>` 等

对 Cursor 的约束：

1. 统一在表单组件上使用 TDesign 自带的 `status="error"` 或 `tips` 属性做错误态展示，**不要自己再写一套红框逻辑**。
2. focus 态、hover 态交互，尽量依赖 TDesign 的默认设计，**仅通过主题色来调整气质**，不重写所有样式。

#### 卡片 / 列表 / 表格

* 卡片：优先考虑 `<t-card>`，并通过类名或 slot 定制内边距；
* 表格：使用 `<t-table>`，表头背景、行高、分隔线全部跟随 TDesign 默认，只在主题层调整颜色、字号。

S2 里对卡片“圆角 8px、阴影轻、卡片之间留 16px”的要求，可以通过：

* 自定义全局 `.kcb-card` 类包一层 TDesign 组件；
* 在这个类里统一设置 margin/padding，避免页面里每个地方都特殊写。

#### 弹窗 / 抽屉 / Tabs / Steps

* 弹窗：`<t-dialog>`
* 抽屉：`<t-drawer>`
* Tabs：`<t-tabs>`（建议使用带下划线样式）
* Steps：`<t-steps>`

对齐方式：

1. 大小和布局遵循 S2 的比例（Dialog 宽度 30–40% 等），通过 TDesign 的 props（如 `width`、`placement`）控制；
2. 保持 S2 里的操作逻辑：

   * 右侧主按钮、左侧取消按钮；
   * 尽量不在一个弹窗里塞太多按钮。

---

### 10.4 动效部分：TDesign + anime.js 的边界

#### 1）优先使用 TDesign 内建过渡

* Dialog 的出现/消失、Drawer 滑入滑出、Message/Notification 的出现，**默认用 TDesign 自带动画**；
* 不要为了用 anime.js 而强行重写这些基础动效，除非未来真有特别需求。

#### 2）anime.js 允许使用的场景（白名单）

仅在以下类型场景里可以用 anime.js：

1. **首页/主工作台的首屏进场**

   * 比如几个关键卡片轻微淡入 + 上移 8px；
   * 时间控制在 200–300ms，一次性执行，不循环。

2. **关键数据/进度的变化**

   * 如项目进度条变化时，用 anime.js 做一个平滑过渡，而不是生硬跳变；
   * 或者某个指标从旧值变更到新值时数字平滑滚动一次。

3. **微交互**

   * 鼠标 hover 某个重要卡片，图标轻微放大 1.05 倍 + 阴影变化；
   * 点击“展开更多”时内容的展开高度使用 anime.js 做一个平滑过渡。

#### 3）anime.js 禁用场景（黑名单）

禁止在以下场景滥用 anime.js：

* 表单输入时给输入框做花哨动效（会显得很廉价，而且影响可用性）；
* 背景元素不断运动、闪烁、颜色渐变；
* 长时间循环动画导致注意力被分散、性能下降。