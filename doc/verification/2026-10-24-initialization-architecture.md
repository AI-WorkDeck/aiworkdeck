<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 后端初始化与 Word 首开的架构排查（2026-10-24）

基线 `d499d8b86aca862e1a38e7c755d439f0833e69fb`（PR #1207），本轮分支 `codex/performance-init-architecture`；台账 dev-board#1472、#1474。用户要求继续优化、从底层定位、暂不发版。本轮使用隔离目录与合成资料，没有升级用户客户端。

## 根因与最小改动

后端诊断记录了 1,000 余个单例及 97 个 JPA repository 的创建。HTTP 过滤器经同步服务、项目存储解析器进入 repository/EntityManagerFactory；插件任务恢复、服务配置回填等启动回调也会提前访问数据库。简单把工作丢到线程池仍可能在下一次数据库访问处等待。

本地 Boot 3.2.4 的 JPA 执行器选择器在多池时按 Map 的正式 Bean 名查找 `applicationTaskExecutor`，不会按别名查找。原声明正式名是 `taskExecutor`，导致预期异步路径没有执行器。现在交换正式名与别名，保留原池参数和调用兼容；仅 desktop 配置使用 deferred repository bootstrap。实际探针确认 Hibernate 初始化从 main 改到 awd-async-1，全部 97 个 repository 仍在 context refresh 完成前校验，首个业务请求没有补做 repository 初始化。

deferred 会让 HTTP 端口早于完整启动就绪。健康接口现在先检查 `ApplicationAvailability` 接受流量，再做原有有界数据库检查，保留 UP/build 协议；必要 runner 或同步 ready listener 没完成、启动失败、正在关闭时不能提前报健康。没有开启全局 lazy 或调整 JVM 编译层级。

Word 预热池已有条目，但实际编辑器在 `.editors-grid v-else` 下，工作台空态时组件与 guest 根本没有挂载。本轮使网格常驻、空态覆盖其上，保留同一个容器与 key，接手文件不重建 guest。原 4 秒预热时机、内存预算和保存守卫保持不变。

## 完整启动对照

使用源码 Electron 的实际 main 入口、冻结的 JAR/H5。夹具仅把 backend descriptor.health 的临时 ctx.packaged 设为 true，调用生产健康端点与 build 校验；不改变启动资源/JVM/补丁目录。这样避开源码开发模式用 wizard 端点提前放行的问题。每轮新进程、新随机空端口，核对 Java 属于本轮进程树及实际 user.home、cwd、JDBC/storage，排除复用旧服务。不是正式签名包验收，也没有覆盖补丁激活/回滚。

原小范围后端候选的六轮结果：

| 组别 | 后端 health，第 1/2/3 轮 / ms | 工作台实际挂载，第 1/2/3 轮 / ms |
|---|---|---|
| 基线 | 6054 / 6167 / 6268 | 6528 / 6564 / 6710 |
| 异步初始化 + readiness | 6044 / 6213 / 6043 | 6577 / 6726 / 6573 |

后端 health 中位数 6167→6044ms；工作台 6564→6577ms，**没有整体首屏提速证据**。基线 health 仅查数据库、候选等待完整就绪，不能从这 123ms 推导等量工作的提速。每轮真实登录态读取、空项目列表、打开本地合成项目、嵌套文件下载/上传/磁盘回读通过，正常退出且所有测试端口与后端进程已释放，用户应用端口归属不变。

保留旧开发 health 分支的初轮源码结果，但不纳入结论：它绕过候选完整 readiness，提前出现窗口并不等于正式 App 提速。前两次夹具还错误假设子 JVM 与 Electron 同进程组、以及 JVM cwd 必须等于测试 cwd；修正为实际进程树归属及本轮 runtime/backend 后重新执行，不删除失败记录。

另作桌面禁用 WebTools 启动预热的局部实验，保留首次 browse_url 自行初始化的原路径。四轮基线/实验工作台分别为 6540/6602/6580/6724ms（顺序基线、实验、实验、基线），两对一慢一快，未建立稳定收益。该尝试已撤回，未合入产品。浏览器实例虽不复用，Playwright Driver 有静态初始化缓存，跳过预热还会把驱动解压/可能下载成本转移至首次抓网页；因此不能把预热描述成完全免费可删。

本轮最终结论：Word 在有预热机会时明显改善；后端异步执行器接线与真实就绪门修复已验证，但整体首屏仍约 6.6 秒。本轮不宣传 App 启动再次明显提速。剩余关键路径是 EMF、全部仓储验证和多个必需数据库启动回调的依赖；诊断支持后续围绕依赖边界继续拆分，未以未验证的大范围改造换取数字。

## 已有项目恢复与深层实验

相同的已正常关闭 H2 快照：10 个合成项目、每项目 1,000 个文件与 20 个子目录；逐轮复制 HOME/H2/storage，项目根仍指向同一组合成目录。探针只记录生命周期与调用时间。这些是后端诊断，不能当成正式 App 首屏时间。

| 顺序 | HTTP health / ms | Ready 通知 / ms | ACCEPTING_TRAFFIC / ms | 10 项目监听恢复 / ms |
|---|---:|---:|---:|---:|
| 原版 1 | 5787.736 | 5721.375 | 6222.258 | 469.062 |
| 候选 1 | 5864.780 | 5533.071 | 5813.883 | 251.864 |
| 候选 2 | 5973.841 | 5606.749 | 5966.964 | 330.784 |
| 原版 2 | 5682.020 | 5630.325 | 5896.245 | 235.418 |

已有数据恢复安全检查通过，尚不能证明稳定提速：第二对候选较慢，监听恢复本身相差约 234ms。每轮均保留全部项目/文件 ID 与目录关系、10 个真实 watcher；首个文件下载、上传、磁盘回读和再次下载通过，其余 9 个项目文件数也正确。正常退出后恢复合成样本的字节和 mtime。原版 health 早于完整就绪，候选 health 均晚于 ACCEPTING_TRAFFIC，二者不能仅按 health 数字比较工作量。

另以诊断入口将 7 组原启动回调按顺序暂缓到单例构建后，只跑一对：完整就绪 5591→5304ms。新的等待转移到配置回填访问 EMF，且 Hibernate 工作线程跨度增加；这不足以支持加入生产初始化协调层。该实验没有合入，原回调仍按原生命周期执行。完整顺序、每回调恰好一次及后续业务检查均有本地记录；并发区间重叠不等于已证明某一线程持锁归因。

## Word 完整打开、输入和保存

macOS、源码 Electron、同一 QA 0.71.0 LOWA 资源、1280×900 CSS 视口（截图 2560×1800）、60 段/600 条合成修订。每轮新 HOME/profile/H2/端口。在空工作台停留 5.2 秒后，从可见文件树点击开始计时；两组条件相同。首帧只计实际 guest 正文中的原生纸张和修订文字，排除预览、标尺和边栏；相同视口空白帧为负例。括号是最后失败帧到首个通过帧的采样区间，后者为上界。

| 条件 | 原版正文首帧区间 / ms | 候选正文首帧区间 / ms |
|---|---:|---:|
| 停留 5.2 秒，第 1 对 | (6273, 6634] | (4827, 5234] |
| 停留 5.2 秒，第 2 对 | (6285, 6659] | (3891, 4253] |
| 停留 5.2 秒，第 3 对 | (6295, 6662] | (4848, 5232] |
| 立即点击，单对冷路径 | (6532, 6912] | (6491, 6880] |

有预热机会的首个通过帧中位数 **6659→5232ms，减少 1427ms（21.4%）**。立即点击的冷路径区间重叠，没有证据证明冷打开提速。host ready 中位数 4663→2868ms，仅代表宿主事件，不代替正文首帧。IME 检查完成时间包含首帧之后的检查和焦点操作，不能当作最早可编辑时间。

八轮均在真实 guest 通过 IME composition/commit 写入唯一标记，先回读引擎正文，再通过产品保存至原 DOCX。主任务逐个独立核对落盘 XML 文本投影、600 条原文顺序、600 位原修订作者及输入标记。候选冷路径另验证关闭最后一个脏文档仍落盘、空态点击与尺寸、欢迎页关闭、分屏及同一 guest 身份。八轮正常退出、无强杀/残留，原客户端端口归属不变。真实 GUI 由 Word 子代理执行；主任务回读产物、截图和 DOCX，不把产物审计称作另一轮独立 GUI 复现。

保留的诊断失败轮不纳入统计：800×600 结构探针不是完整首帧测量；早期截图计算未正确处理 DPR；首次输入夹具未将标记送入实际引擎。修正夹具后以同视口空白/正文负正对照和引擎文本→原 DOCX 双重确认验收，不删失败记录。

## 回归与证据

- 旧 health 实现下 3 个真实 HTTP 生命周期用例均在预期断言变红（200 而非 503），不是运行错误；候选通过。启动夹具为显式 `@TestConfiguration`，避免扫描污染完整应用测试。
- 后端 JDK 21：DesktopHealthControllerTest 5、DesktopStartupReadinessTest 3、AsyncExecutorConfigTest 2、DesktopContextSmokeTest 2，共 12 项通过，随后 package 成功。包含完整 desktop Spring 上下文及真实多池/JPA customizer；没有手动伪造 full-context readiness。
- 前端 project-home、toolbar、revision-view 共 1900 项通过；常驻预热实例的两项行为回归在旧模板变红、候选通过。H5 构建成功。
- 桌面全套 382 项通过、4 项既有平台跳过、0 失败。静态复核核对了 Bean 名称兼容、生命周期、空态与实例身份；不称其为独立性能复现。

本地证据根：`~/.codex/artifacts/2026-10-24-initialization-architecture/`，不提交原日志、数据库、profile 或原始截图。主要索引：`startup/`、`backend/NEXT-VALIDATION.md`、`backend/runtime-validation-summary.json`、`word/word-final-summary.json`、`word/word-final-report.md`、`evidence/root-word-artifact-audit.json`、`evidence/*-related.log`、`evidence/backend-targeted-package.log`、`evidence/desktop-full.log`、`review/`。

冻结 JAR SHA-256：

- 基线：`9a7adc29cb0de552b46a853b58b1ef88bbfdb2d69eecfd6b59ea969fb0bfd8d8`
- 候选：`d5e1afa486301a1a003cdada5e79de4013f4dde248274a8c0f313e2b1844f48d`

测量期间没有重新构建被 JVM 使用的 JAR，没有并行运行其他性能测试。未清操作系统缓存。正式签名安装包、Windows/低内存设备、跨项目保活和用户客户端升级未验证；本轮没有发版、部署或安装。
