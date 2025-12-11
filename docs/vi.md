一、更新后的 VI 规范（主色：深墨蓝 + 品牌金）

适用对象：核查宝 / 证券律师 SaaS 全站
核心气质：专业、稳健、可信、略带科技感与金融质感。

1. 品牌气质与整体风格

关键词：稳健、专业、尊贵、清晰。

视觉调性：
- 摒弃传统的“互联网蓝”或“森林绿”，采用深墨蓝作为基底，传递冷静与理性。
- 辅以金色作为点缀和强调，传达金融服务的价值感与尊贵感。
- 背景采用暖白/米色系，营造舒适、纸质般的阅读体验，缓解长时间工作的视觉疲劳。

2. 颜色系统

:root {
  /* 品牌色 */
  --color-brand-gold: #C8A45D;       /* 品牌金：用于高亮、强调、选中态边框、次级按钮文本 */
  --color-brand-dark: #12344D;       /* 深墨蓝：功能主色，用于主按钮背景、重要标题、侧边栏背景 */
  
  /* 背景色 */
  --color-bg-warm: #F7F5F0;          /* 暖白背景：用于全站页面底色 */
  --color-bg-card: #FFFFFF;          /* 卡片背景：纯白 */
  --color-bg-sidebar: #FAFAFA;       /* 侧边栏/次级面板背景 */

  /* 状态色 */
  --color-success: #059669;          /* 成功 */
  --color-warning: #D97706;          /* 警告/进行中 */
  --color-danger: #DC2626;           /* 错误/删除/危险操作 */

  /* 文本色 */
  --color-text-main: #1A1A1A;        /* 主标题、正文 */
  --color-text-secondary: #666666;   /* 次级文本、说明 */
  --color-text-muted: #999999;       /* 辅助文本、占位符 */
  --color-text-inverse: #FFFFFF;     /* 反色文本（用于深色背景上） */

  /* 边框与分割线 */
  --color-border-light: #E0E0E0;
  --color-border-hover: #C8A45D;     /* 悬停/聚焦时的边框色（金色） */
}

3. UI 组件规范

按钮 (Buttons):
- 主按钮 (Primary): 背景色 --color-brand-dark (#12344D)，文字白色。Hover 时可轻微提亮或加深阴影。
- 次按钮 (Secondary/Outline): 背景透明或白色，边框 --color-brand-dark 或 --color-brand-gold。
- 强调按钮 (Accent): 某些特定高频操作可使用 --color-brand-gold 背景，白色文字。

卡片 (Cards):
- 背景白色，圆角 8px - 16px。
- 阴影：柔和的阴影，如 `0 2px 8px rgba(0,0,0,0.05)`。
- 头部可带有金色装饰条或下划线。

输入框 (Inputs):
- 背景白色。
- 默认边框浅灰，Focus 时边框变为 --color-brand-dark 或 --color-brand-gold，并带有轻微光晕。

导航与侧边栏:
- 侧边栏背景推荐浅色 (#FAFAFA) 或白色。
- 选中项高亮：背景色可为淡金色 (#C8A45D 的低透明度) 或淡蓝色，左侧或底部有 --color-brand-dark 指示条。

4. 布局原则

- 左右分栏或“工作台”式布局。
- 内容区最大宽度限制（如 1200px - 1600px），保持阅读舒适度。
- 模块间距适中（16px - 24px），避免过于拥挤。

5. 交互反馈

- 所有可点击元素 Hover 时应有明确反馈（颜色变化、阴影加深）。
- 耗时操作必须有 Loading 状态。
- 操作结果必须有 Toast 或 Modal 提示。
