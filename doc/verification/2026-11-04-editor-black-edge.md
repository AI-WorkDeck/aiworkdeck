# 编辑器黑边 #1688

2026-11-04，隔离 Ego Chromium 页面与本地真实 LOWA（主仓 dist/zetaoffice/lowa），合成/仓库测试文件，无用户文件。

复现：空白引擎就绪 → load_document(flexmark-table.docx) → set_chrome 隐藏菜单/工具栏。顶部26 CSS px与左4 CSS px为 RGB(45,45,45)，与用户截图同形状。原生Fullscreen=true，container/component均0,0并铺满，说明仅检查可见性/UNO几何不足。单次同尺寸window resize后顶部为标尺色(224,220,206)、左边为画布色(175,175,175)，get_cursor_rect的viewData、光标与窗口几何逐字段相同。重复Fullscreen=true不修复，异步false→true还会露出Qt标题栏，未采用。

修复：实际set_chrome变更结束通知ui_layout；Boot在ready、非零画布下发一次同尺寸resize。无定时器、无CSS遮盖、无尺寸抖动。只读查询无通知，隐藏/未就绪/销毁后的画布不触发。

实测：Writer/Calc/Impress在修复后加载、隐藏原生菜单、写入英文标记、export_document后load_document重开，均读回EDGE FIX SAVED，逐幅截图无黑条。Writer表格、Calc单元格、PPT文本框仍可见。截图为/tmp/black-edge-fixed-{writer,calc,impress}.png；复现前后为/tmp/black-edge-{before,after}-same2.png。隔离环境未装随包CJK字体，所以中文呈方块，未将字体呈现算作通过。

PDF实查：PdfPreviewPane→FilePreview→本地blob iframe/Chromium PDF引擎，不走Qt/LOWA/set_chrome，本改动不适用。未实跑PDF编辑/批注保存，不声称四格式完整验收。

验证：LOWA/revision-view单元测试431项通过（含通知/无心跳/只读不通知）；语言门禁与构建另见卡。上述编辑保存测试为引擎导出重开，不能替代完整客户端正常自动保存、正式Electron、用户原文件或Windows验收。

原生上游对照：Qt WASM窗口frameMargins按4px边框、18px标题计算顶部26px，hasTitleBar依赖windowState；https://raw.githubusercontent.com/allotropia/qtbase/5.15.2%2Bwasm/src/plugins/platforms/wasm/qwasmwindow.cpp 。该对照支持几何解释，不代表已在C++层定位所有触发条件。
