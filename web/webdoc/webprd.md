# 文档一：《King IDE / 核查宝 官网 PRD（V1）》

## 0. 文档控制

版本：V1.0
范围：官网营销 + 付费下载 + 插件广场 + 基础用户系统 + 最小后台
不包含：桌面端激活打通、团队空间/席位管理、插件评分评论体系、企业版合同流

## 1. 背景与目标

网站要同时完成三件事：产品叙事、交易转化、生态运营。核心闭环为：
闭环A：访客了解产品 → 选择版本 → 登录/注册 → 支付 → 订单成功 → 下载可得
闭环B：访客浏览插件 → 查看详情/定价 → 登录/注册 → 支付 → 插件可下载/可使用（V1 先以“可下载”呈现）

成功标准（V1）
1）两条闭环均可独立完成且无人工介入
2）后台可上架/下架插件、更新版本、修改定价、上传安装包而无需发版
3）关键漏斗可追踪：访问 → 定价 → 登录 → 支付 → 下载

## 2. 用户与角色

访客（未登录）：浏览、搜索插件、查看定价、发起购买
注册用户（已登录）：购买、下载、查看订单、查看已购插件
管理员（后台）：管理产品版本、插件、订单状态、内容配置

## 3. 产品范围（V1）

### 3.1 前台（用户可见）

页面集：
首页 / 产品概览 / 能力详情（可合并） / 解决方案（2–3个） / 定价 / 下载 / 插件广场 / 插件详情 / 插件定价（可并入详情） / 登录注册 / 用户中心 / 文档与更新日志（轻量） / 法律与信任

功能集：
账号：邮箱验证码登录（优先），可选密码登录（若你们希望）
交易：软件与插件均支持“商品化下单支付”
交付：支付成功后在用户中心出现“可下载项”，下载链接为短时效签名 URL
插件：支持列表检索、筛选、排序；插件详情展示截图/视频、版本、兼容性、价格
内容：FAQ、更新日志、数据源说明、安全与隐私声明

### 3.2 后台（Admin，最小可运营）

模块：
商品管理（软件版本/插件 SKU）｜文件管理（安装包/插件包）｜订单管理｜内容配置（FAQ/公告/首页模块开关）｜优惠码（可选）

## 4. 信息架构与路由

建议路由（可按你们工程风格调整）

* /
* /product（概览）
* /capabilities（核心能力）
* /solutions/{dd|litigation|compliance}
* /pricing
* /download
* /plugins
* /plugins/{slug}
* /account/login /account（用户中心）
* /docs /changelog
* /legal/terms /legal/privacy /legal/data-sources /legal/security

## 5. 关键业务流程（状态机）

### 5.1 下单与支付（通用：软件/插件）

订单状态：DRAFT → PENDING_PAYMENT → PAID → FULFILLED（生成下载权限） → REFUNDED（如有）
支付回调：服务端校验签名、金额、币种、订单号一致性后置为 PAID

异常与兜底：

* 支付成功但未到账：用户中心显示“处理中”，后台可手动重试回调入账（提供“重拉支付状态”按钮）
* 支付失败：回到订单页可重试支付
* 重复回调：幂等处理（订单号 + 支付流水号）

### 5.2 下载交付

策略：对象存储 + CDN + 短时效签名 URL（例如 10–30 分钟）
限制：未登录不可下载；未购买不可下载；已退款不可下载
记录：每次生成下载链接、每次下载行为都写审计日志（便于风控与统计）

## 6. 页面级 PRD（字段、模块、交互）

> 说明：以下以“模块化组件”表达，便于设计与前端复用。每页均给出“必须字段/可选字段/交互/埋点/验收”。

### 6.1 首页（/）

模块
1）Hero（定位+三按钮 CTA）

* 标题：一站式 AI 工作台，让法律人聚焦专业判断
* 副标题：集成查—净—抽—写—留痕—协作的工作流基础设施
* CTA：立即下载｜查看定价｜逛插件广场
* 右侧/背景：Hero 动效（见动效文档）

2）价值主张（三段）

* 效率：分屏/暂存区/剪贴板/快捷指令
* 风险与质量：可追溯、可复核、可回看（证据链表达）
* 资产化：项目空间沉淀可复用成果

3）工作流演示（滚动叙事）

* 以步骤卡展示：导入 → 结构化 → 核查 → 起草 → 导出 → 协作留痕
* 每步配一张动图/短视频 loop

4）功能墙（卡片矩阵）

* AI 工作台｜开放插件生态｜大模型能力｜企查查/ TuShare 数据｜多人协作｜便捷工具｜快捷分屏｜自动工时

5）插件生态预览

* 分类入口（尽调/投研/诉讼/合规/效率）
* 热门插件（取 Top N）
* CTA：进入插件广场

6）信任与合规

* 数据源声明入口、安全说明入口、隐私与条款入口

交互要点

* CTA 固定在首屏可见范围，滚动到中段时出现顶部粘性 CTA（“下载/定价”）
  埋点
* home_cta_download_click / home_cta_pricing_click / home_cta_plugins_click
  验收
* 新用户不滚动即可找到“下载/定价/插件”入口；首屏加载指标达标（见非功能要求）

### 6.2 定价页（/pricing）

数据模型

* ProductPlan：id、name、price、billing（一次性/订阅）、features（列表）、limitations、recommended（bool）
* SKU：plan_id、currency、region、status、trial（可选）

模块

* 版本卡（免费试用/专业版/团队版/企业版咨询）
* 对比表（强制清晰）
* FAQ（退款、发票/收据、升级策略、插件兼容）

交互

* 点击“购买”若未登录 → 跳转登录并携带 return_to=checkout
  埋点
* pricing_plan_select、pricing_checkout_start
  验收
* 任一版本的权益差异在 20 秒内可读懂（UI 目标）；购买入口不超过两次跳转

### 6.3 结算页（/checkout）

字段

* 商品信息（名称、版本、价格、税费/折扣）
* 用户信息（邮箱、姓名/公司可选）
* 支付方式（按你们支付通道能力配置）
* 同意条款勾选（必选）

交互

* 创建订单（PENDING_PAYMENT）→ 拉起支付 → 回跳 success/cancel
  埋点
* checkout_order_created / checkout_payment_success / checkout_payment_fail
  验收
* 支付成功后 3 秒内在用户中心可看到“可下载项”

### 6.4 下载页（/download）

逻辑

* 未购买：展示版本与系统要求，引导“去定价”
* 已购买且登录：展示下载按钮（签名 URL）与版本号、校验值、更新日志入口

字段

* OS 选择（mac/windows）
* 当前版本号、发布日期、hash（sha256）
* 更新日志链接

埋点

* download_generate_link / download_click
  验收
* 链接过期提示明确，可一键重新获取

### 6.5 插件广场（/plugins）

列表字段（卡片）

* 名称、slogan、价格（免费/付费）、分类标签、更新时间、开发者名称、兼容版本

筛选与排序

* 搜索（name/keywords）
* 分类、多选标签
* 价格（免费/付费/区间）
* 排序（热门/最新/价格）

埋点

* plugins_search / plugins_filter_apply / plugins_card_click
  验收
* 搜索、筛选、排序可组合；列表分页或无限滚动性能稳定

### 6.6 插件详情（/plugins/{slug}）

模块

* Hero：名称、slogan、价格、CTA（购买/下载/试用若有）
* 解决的问题（3点）
* 功能与示例（截图/短视频）
* 版本与更新日志（插件自身）
* 兼容性：所需主程序版本、依赖数据源、权限说明
* 定价与授权说明（个人/团队，V1 可先个人）
* 支持与联系（工单/邮箱）

埋点

* plugin_view / plugin_buy_click / plugin_download_click
  验收
* 未登录点击购买自动引导登录并返回详情继续

### 6.7 登录/注册（/account/login）

方案

* 邮箱验证码：输入邮箱 → 发送验证码 → 登录成功
* 可选：密码登录/注册（若你们要求）

风控

* 验证码频率限制（同邮箱、同 IP）
  埋点
* auth_code_send / auth_login_success / auth_login_fail
  验收
* 登录成功后回跳到来源页（return_to 生效）

### 6.8 用户中心（/account）

模块

* 基本信息：邮箱、昵称、公司（可选）
* 订单列表：订单号、商品、金额、状态、时间
* 下载与许可证：软件安装包、插件包、历史版本（可选）
* 购买记录：已购插件列表

验收

* 用户能在此完成“再次下载”“查看订单”“下载插件”三件事

### 6.9 法律与信任（/legal/*）

页面

* Terms、Privacy、Data Sources（企查查、TuShare、其他）与免责声明、安全说明
  验收
* 结算页条款勾选可跳转到对应条款锚点

## 7. 后台 PRD（Admin）

### 7.1 登录与权限

* Admin 账号仅内部创建，不开放注册
* 权限：SUPER_ADMIN / OPERATOR（V1 可先单一角色）

### 7.2 商品管理

软件版本

* 字段：name、version、os、file_id、price、status、release_notes、hash
  插件
* 字段：slug、name、slogan、description、category、tags、price、status、compatibility、assets（截图/视频）、package_file_id、changelog

### 7.3 订单管理

* 列表：筛选状态、时间、商品类型
* 详情：支付流水、回调记录、下载权限记录
* 操作：重拉支付状态、标记退款（如需）、导出 CSV（可选）

### 7.4 内容配置（可选但建议）

* 首页模块开关、公告位、FAQ 编辑、推荐插件配置

## 8. 数据模型（核心表建议）

User(id, email, nickname, company, created_at)
ProductPlan(id, type[software|plugin], name, status)
SKU(id, plan_id, currency, price, status)
Order(id, user_id, amount, currency, status, items_json, created_at)
Payment(id, order_id, provider, provider_txn_id, status, raw_payload, created_at)
AssetFile(id, type, os, storage_key, sha256, size, created_at)
Entitlement(id, user_id, type[software|plugin], target_id, status, valid_from, valid_to)
Plugin(id, slug, name, …)
AuditLog(id, user_id, action, meta_json, created_at)

## 9. 埋点与分析（最小事件表）

* page_view（自动）
* funnel：pricing_plan_select → checkout_order_created → payment_success → download_click
* plugin：plugins_search / plugin_view / plugin_buy_click / plugin_download_click
* auth：auth_code_send / auth_login_success
* 运营：cta_click（首页各 CTA）

## 10. 非功能要求（必须写进验收）

性能

* 首屏 LCP、CLS、TTFB 目标在工程侧设定，并提供动效降级策略
  安全
* 支付回调幂等、下载签名短时效、日志审计可追溯
  可运营
* 后台改价、上架、换包不发版
  可用性
* 移动端可用；主要转化流程不依赖 hover

---

# 文档二：《VI Design Tokens（可直接进前端变量）》

以下提供 Light / Dark 双主题 token（深绿为主、青绿为强调，整体克制高级）。你们可按品牌微调，但建议先冻结一版用于统一视觉与动效。

## 1. 颜色 Tokens（JSON）

```json
{
  "color": {
    "brand": {
      "primary": { "value": "#1A5336", "usage": "主按钮/关键强调/Logo主色" },
      "primaryHover": { "value": "#2D7A52", "usage": "主按钮hover" },
      "accent": { "value": "#5BD197", "usage": "高亮/链接hover/动效光标" },
      "accentHover": { "value": "#84E0B3", "usage": "accent hover" }
    },
    "semantic": {
      "success": { "value": "#5BD197" },
      "warning": { "value": "#F1C40F" },
      "danger": { "value": "#E74C3C" },
      "info": { "value": "#3498DB" }
    },
    "neutral": {
      "white": { "value": "#FFFFFF" },
      "darkBg": { "value": "#212629" },
      "grayDark": { "value": "#2C3338" },
      "grayMedium": { "value": "#6C757D" },
      "grayLight": { "value": "#E9ECEF" },
      "grayPale": { "value": "#F8F9FA" }
    },
    "theme": {
      "light": {
        "bg": { "value": "#F8F9FA", "usage": "页面背景" },
        "surface": { "value": "#FFFFFF", "usage": "卡片/弹层" },
        "surfaceAlt": { "value": "#E9ECEF", "usage": "次级容器" },
        "textPrimary": { "value": "#2C3338" },
        "textSecondary": { "value": "#6C757D" },
        "border": { "value": "#E9ECEF" },
        "divider": { "value": "#E9ECEF" },
        "focusRing": { "value": "rgba(91, 209, 151, 0.35)" }
      },
      "dark": {
        "bg": { "value": "#212629", "usage": "深色背景" },
        "surface": { "value": "#2C3338" },
        "surfaceAlt": { "value": "#343A40" },
        "textPrimary": { "value": "#FFFFFF" },
        "textSecondary": { "value": "rgba(255, 255, 255, 0.78)" },
        "textTertiary": { "value": "rgba(255, 255, 255, 0.58)" },
        "border": { "value": "rgba(91, 209, 151, 0.18)" },
        "divider": { "value": "rgba(255, 255, 255, 0.10)" },
        "focusRing": { "value": "rgba(91, 209, 151, 0.40)" }
      }
    }
  }
}
```

## 2. 排版 Tokens

```json
{
  "typography": {
    "fontFamily": {
      "sans": { "value": "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, PingFang SC, Microsoft YaHei" },
      "mono": { "value": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace" }
    },
    "fontSize": {
      "xs": { "value": "12px" },
      "sm": { "value": "14px" },
      "md": { "value": "16px" },
      "lg": { "value": "18px" },
      "xl": { "value": "22px" },
      "2xl": { "value": "28px" },
      "3xl": { "value": "36px" },
      "4xl": { "value": "48px" }
    },
    "lineHeight": {
      "tight": { "value": "1.2" },
      "snug": { "value": "1.35" },
      "normal": { "value": "1.55" },
      "relaxed": { "value": "1.75" }
    },
    "fontWeight": {
      "regular": { "value": 400 },
      "medium": { "value": 500 },
      "semibold": { "value": 600 },
      "bold": { "value": 700 }
    }
  }
}
```

排版规范（落地约束）
标题层级：H1 48/56、H2 36/44、H3 28/36；正文 16/24；辅助 14/22；数据/代码片段使用 mono。
行宽：正文段落最大宽度建议 680–760px，避免“科技风但难读”。

## 3. 间距 / 圆角 / 阴影 / 描边 Tokens

```json
{
  "layout": {
    "spacing": {
      "2": "8px",
      "3": "12px",
      "4": "16px",
      "5": "20px",
      "6": "24px",
      "8": "32px",
      "10": "40px",
      "12": "48px",
      "16": "64px"
    },
    "radius": {
      "sm": "10px",
      "md": "14px",
      "lg": "18px",
      "xl": "22px",
      "2xl": "28px"
    },
    "shadow": {
      "sm": "0 6px 18px rgba(11, 15, 13, 0.08)",
      "md": "0 10px 30px rgba(11, 15, 13, 0.10)",
      "lg": "0 16px 48px rgba(11, 15, 13, 0.14)"
    },
    "borderWidth": {
      "hairline": "1px",
      "thick": "2px"
    }
  }
}
```

## 4. 动效 Tokens（用于统一“酷炫但克制”）

```json
{
  "motion": {
    "duration": {
      "fast": "120ms",
      "normal": "200ms",
      "slow": "320ms",
      "hero": "900ms"
    },
    "easing": {
      "standard": "cubic-bezier(0.2, 0.8, 0.2, 1)",
      "enter": "cubic-bezier(0.16, 1, 0.3, 1)",
      "exit": "cubic-bezier(0.7, 0, 0.84, 0)"
    },
    "blur": {
      "glass": "14px"
    }
  }
}
```

## 5. CSS Variables（可直接落地）

```css
:root[data-theme="light"]{
  --bg: #F8F9FA;
  --surface: #FFFFFF;
  --surface-alt: #E9ECEF;

  --text-1: #2C3338;
  --text-2: #6C757D;
  --text-3: #ADB5BD;

  --brand: #1A5336;
  --brand-hover: #2D7A52;
  --accent: #5BD197;
  --accent-hover: #84E0B3;

  --border: #E9ECEF;
  --divider: #E9ECEF;
  --focus: rgba(91, 209, 151, 0.35);

  --shadow-sm: 0 6px 18px rgba(11, 15, 13, 0.08);
  --shadow-md: 0 10px 30px rgba(11, 15, 13, 0.10);
  --shadow-lg: 0 16px 48px rgba(11, 15, 13, 0.14);

  --radius-xl: 22px;
  --radius-2xl: 28px;
}

:root[data-theme="dark"]{
  --bg: #212629;
  --surface: #2C3338;
  --surface-alt: #343A40;

  --text-1: #FFFFFF;
  --text-2: rgba(255,255,255,0.78);
  --text-3: rgba(255,255,255,0.58);

  --brand: #1A5336;
  --brand-hover: #2D7A52;
  --accent: #5BD197;
  --accent-hover: #84E0B3;

  --border: rgba(91, 209, 151, 0.18);
  --divider: rgba(255, 255, 255, 0.10);
  --focus: rgba(91, 209, 151, 0.40);
}
```

---

# 文档三：《动效脚本分镜（Hero/滚动叙事/插件页转场）》

## 1. 动效总原则（写进实现规范）

动效必须服务信息传达，优先突出三件事：
工作台形态（分屏 + 文件树 + 暂存区）｜证据链/可追溯（节点/时间轴）｜生态（插件模块化接入）

性能约束（必须实现降级）

* motion-reduce：系统设置减少动效时，自动切换为静态插画/首屏短视频 poster
* 移动端：禁用复杂粒子与大范围模糊，保留关键位移动效
* 首屏资源：Hero 动画优先 Lottie/SVG；避免 WebGL 作为 V1 默认实现

## 2. Hero 分镜（首页首屏核心记忆点）

### Hero-1：工作台“装配”动画（0s–2.2s，首屏加载后自动播放一次）

画面元素

* 背景：深色/浅色主题皆可，暗纹“网格 + 轻微数据流”
* 主体：三块浮层窗口（左：文件树；中：编辑/预览；右：核查面板/数据源）
* 底部：暂存区（Tray）与剪贴板图标

时间轴
0.0–0.4s：背景网格由虚转实，透明度从 0 → 1（极弱）
0.2–0.8s：文件树滑入（x: -24 → 0，opacity: 0 → 1）
0.6–1.2s：中间主窗口缩放弹出（scale: 0.98 → 1）
0.9–1.6s：右侧核查面板滑入（x: +24 → 0）
1.2–2.2s：底部暂存区“吸附出现”（y: +16 → 0）并出现 2–3 个文件卡片落入 tray（轻量弹性）

信息点（必须让用户一眼看懂）

* 这是“工作台”，不是普通官网
* 左中右三块对应“材料/内容/核查”
* 底部托盘表达“暂存与效率工具”

交互
鼠标移动（桌面端）：窗口边缘出现极轻微高光随 cursor 追踪（限制范围，不要全屏）
CTA hover：accent 高亮 + 微抬升

实现建议

* Lottie：装配过程；CSS/Framer Motion：hover 与小交互
* 资源准备：窗口矢量、文件卡片、图标

### Hero-2：证据链“点亮”（2.2s–3.2s，衔接式）

动作

* 从文件树选中一个文件（高亮条滑过）
* 中间窗口出现“引用标注”样式的高亮片段
* 右侧面板出现 2–3 个“核查节点”并点亮连线（线条 1px，accent 轻微发光）

目的
把“可追溯、可复核”在 1 秒内视觉化，而不需要文字解释。

## 3. 首页滚动叙事（Scroll Storytelling）

分 4 段，对应你们核心流程：“导入—结构化—核查—起草/导出”
触发

* 当段落进入视口 40%：当前段卡片高亮（brand 边框增强），上一段淡出为次级
* 背景同步切换一个“隐喻图层”：导入（文件飞入）→ 结构化（表格/字段）→ 核查（节点）→ 导出（PDF 图标）

每段动效预算

* 单段动画总时长不超过 800ms
* 同屏最多一处主动画，避免眩晕与性能问题

## 4. 功能墙与卡片微交互（全站复用）

卡片 hover（桌面）

* y: 0 → -4px
* border 透明度提升
* 内部 icon 做 6% 以内的 scale 呼吸一次（不循环）

按钮 hover

* 主按钮：brand-hover；阴影增强一级
* 次按钮：border 变清晰；文字色向 brand 靠拢

## 5. 插件广场动效（可运营感与秩序感）

搜索输入

* 输入时出现“匹配高亮”与“筛选 chips 区域自动收拢/展开”
* 列表刷新采用“高度不抖动”的 skeleton 方案（避免 CLS）

插件卡片进入

* 分批淡入（stagger 40ms），最多 12 张；超出即不再 stagger

## 6. 插件详情页转场（“像 IDE 的窗口”）

进入详情页

* 列表卡片点击后，卡片扩展为详情 Hero（共享元素转场）
* 页面顶部出现“窗口标题栏”样式（暗示 IDE 语境），但保持克制（不要拟物过度）

截图 gallery

* 切换采用“窗口滑动”而非淡入淡出，更贴近“分屏工作台”联想

## 7. 降级策略（必须实现）

* prefers-reduced-motion：所有自动播放动画替换为静态图；滚动叙事只保留淡入
* 低端移动端：禁用光晕、模糊与粒子，仅保留位移/透明度
* 首屏未加载完：展示静态 poster + 进度占位，避免跳动

## 8. 动效资产清单（交付给设计）

* Hero 窗口矢量（light/dark 两套）
* 文件树图标、文件卡片、托盘组件
* 证据链节点与连线（SVG）
* 4 段滚动叙事对应的简化动图/矢量
* 插件分类图标一套（线性，统一线宽）
