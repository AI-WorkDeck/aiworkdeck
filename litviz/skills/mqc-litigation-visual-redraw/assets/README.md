# assets/ 是给人看的，模型不要读

这个目录下是公众号长图、三风格对照图、截图与品牌图，**运行一次都用不到**。

它们是 SVG 与 PNG：SVG 对模型来说是纯文本，一张 `visual-system-qichuan.svg` 有 703 KB，
读一遍约 20 万 token，一轮对话就废了；PNG 要走读图，同样慢而且贵。

**运行时真正要读的只有两类：** `examples/*.json`（每份约 2 KB 的语义地图示例）与
`references/quick-map.md`（约 5 KB 的速查页）。

唯一的例外是 `style-tokens.json`：那是代码读的调色与字号表，模型也不必读。
