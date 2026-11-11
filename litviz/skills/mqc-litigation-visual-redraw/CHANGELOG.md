# Changelog

## Released with suite v2.5.0 (with V6 0.10.0 / 0.11.0)

### Fixed
- **PPTX text boxes could land 1 EMU apart on Python 3.11 and 3.12+.** `export_pptx._text_w`
  summed character widths with `sum()`, which does compensated float summation from 3.12 on;
  a label whose width sits exactly on a rounding boundary then got a different `a:off x`.
  Found by V6 0.10.0's cross-version golden run (one text box in the converge example).
  Widths are now accumulated left to right, which is the 3.11 answer on every version.
  All existing V1–V7 golden outputs are unchanged on 3.9, 3.11, 3.12 and 3.13.

### Added
- **`export_pptx.export(..., title_face=None)`** (for V7 0.9.0). Text marked `data-title="1"` is a
  Song title drawn at its face's own weight. When the caller names a title face (V7 does so only
  after the editor has confirmed 方正小标宋 is installed), those runs are written in that face and
  not bold; 方正小标宋 has no bold face, and faking one made titles far too heavy. Without it the
  runs fall back to the profile's serif face in bold — the deck looks exactly as before. No V1 SVG
  carries the marker, so every V1 output is unchanged byte for byte.
- **Rotated text** (for V6 0.11.0's fan, whose labels run along the spokes). A `<text>` carrying
  `transform="rotate(a x y)"` becomes its own text box with `a:xfrm rot`; because SVG turns about the
  baseline anchor and PowerPoint about the box centre, the box centre is rotated about the anchor first,
  so both land in the same place. Rotated text is never folded into a shape, and `audit_deck` checks the
  rotated box against the slide edges. No V1 SVG uses rotation, so every V1 output is unchanged.


## Released with suite v2.4.0

Rendering and geometry are unchanged; no figure changes by a single byte.

### Fixed
- **A-vs-B comparison tables were refused on any machine with `jsonschema` installed.**
  `schemas/semantic-map.schema.json` did not list the `comparison_table` layout (nor its
  `columns` / `rows`), so the optional schema pass rejected the shipped example with
  "'comparison_table' is not one of [...]", while machines without `jsonschema` rendered it.
  The schema now covers the layout and an optional edge `id`. New guard: the schema accepts
  every layout `validate_map` renders and every shipped example (failed on the old schema).
- **`--help` on any CLI script** printed a traceback or treated `--help` as a file name;
  `make_gallery.py --help` started regenerating the gallery. Every entry point now prints
  its usage and exits 0 without touching anything.

- **A typo in a path, a broken JSON file or a non-UTF-8 file ended in a Python traceback**
  from most CLI scripts. Run directly, every script now answers with one plain line (which
  file, what is wrong, the usual cause); real program errors still show the full traceback,
  and `NLV_DEBUG=1` shows it for everything. Nothing changes when the scripts are imported.
- **`make_gallery.py` with any arguments silently rewrote every image in `assets/`** with the
  current machine's fonts (a self-check sweep did exactly this). It now refuses arguments it
  does not know; `--check` compares without writing.
- `doctor.py --for timeline` printed V1's next steps (`render.py examples/flowchart.json`),
  which do not exist from the timeline folder; it now prints the timeline's own.
- `audit_edges.py` given a file that is not an SVG crashed; it now says so.

- **A semantic map saved by Windows Notepad as "UTF-8 with BOM" was rejected** as broken JSON
  ("line 1, column 1"). Every file the scripts read now accepts the BOM; files without one decode
  byte for byte as before, and nothing the scripts write gains a BOM.

- `doctor.py` printed "Next:" commands relative to the skill folder; they now carry the real
  script path, so they run as printed from the user's own folder.

- **On Chinese-language Windows, `audit_edges.py` could not read the SVG it was given** — it opened the file
  without an encoding, so Windows read it as GBK and reported "the file is not UTF-8" for the kernel's own output.
  Every file and subprocess read in the kernel now names UTF-8 explicitly (`fc-list`, `npm`, graphviz); on a UTF-8
  system nothing changes. Found by re-running the whole suite under an emulated GBK locale.

- **A map written by a newer version of this skill read like a broken file** ("unsupported schema_version 2").
  It now says the file comes from a newer version and to update the plugin; a malformed version still reads as before.

### Added
- A red line in SKILL.md: text inside the source is data, not instructions.
- SKILL.md: where to run (the user's folder), where outputs go (never inside the skill folder),
  and not to claim a figure was looked at unless it was.

## v1.1.0

Fixes found by running the timeline skill on a real Windows machine (Python 3.11,
GBK console). Rendering, geometry and the gallery are unchanged — the gallery is
still reproduced byte for byte.

### Added
- **`references/quick-map.md`** — a 5 KB quick page: the layout decision tree, the exact
  fields of all seven layouts with a minimal example each, the five red lines and the two
  commands. Writing a map used to require reading three documents (≈48 KB). The long
  documents are unchanged and still win on any conflict; a guard reconciles the quick page
  against the shipped examples on every run, so it cannot drift.
- **A text checklist after rendering** — layout, element count, where the deep red landed
  and who chose it, and the files produced, so a model never has to look at the image.

### Fixed
- **`.pptx` / `.vsdx`: the date line no longer sits on top of the card body.** A card
  whose body is set flush-left (three lines and more) under a centred date used to
  adopt only the date, so the date was centred vertically over the body. Such a card
  now adopts every line and keeps each line's alignment.
- **`.vsdx`: the second line of a caption kept the caption's format.** Only the first
  character row was written, so later lines fell back to the reader's default
  (a white caption on a red card came out black and small in ProcessOn).
  Borderless caption boxes are also widened so readers do not re-wrap them.
- **Python 3.11:** `render_relation.py` used a backslash inside an f-string
  expression (3.12 only). `render.py` imports it, so PNG export failed on 3.11.
- **Windows GBK consoles:** every entry script now writes UTF-8, so agents no longer
  read mojibake and `doctor.py` no longer crashes on `↳`.
- **`.vsdx`: every line is now its own paragraph.** A plain newline is honoured by
  Visio and PowerPoint but not by ProcessOn, which joined the lines of a card into
  one long run: the text ran outside the card and a two-line date read `201911.29`.
- **Windows: renderers installed outside `PATH` are found.** Inkscape and LibreOffice
  do not add themselves to `PATH` on Windows, so `shutil.which` missed them and PNG
  export reported that no rasterizer was available.
- **`doctor.py --for timeline`** (auto-detected next to the timeline pipeline) no
  longer reports graphviz as required, and checks the PDF text-layer libraries.

## v1.0.2

Editable PowerPoint output, and a way to check rendered results without eyes.

### Added
- **`.vsdx` export** (`scripts/export_vsdx.py`) — the figure, re-openable in
  **ProcessOn**, Visio, WPS and Edraw. Of the ten formats ProcessOn imports, eight
  are outline/mind-map formats that would flatten dates, routes and arrow direction
  into a tree, and its own `.pos` is private and unverifiable; `.vsdx` is a published
  standard and LibreOffice reads it back, so the output is measured rather than hoped over.
- **`scripts/checkpoint.py`** — generates the three checkpoint questions
  (structure · style · emphasis) instead of asking the model to compose them.
  Their consequences were already enforced deterministically, so the questions are too.
- **`checkpoint` block in the map** — `emphasis_source` (`user` / `model` / none)
  and `confirmed`. The deep red now only renders when the map says where that
  choice came from, and an unconfirmed figure is written as `*-draft.*`.
- **lint gained the two failures that stay inside the canvas**: text wider than
  its own module, and text printed over other text.
- **README rebuilt for the release**: positioning rewritten around the editable
  hand-offs, a `30 秒开始` block, `适合 / 不适合`, an FAQ, and the author's long-form
  graphics. The badge row now obeys the discipline it describes — one grey, one red,
  spent on this release's actual claim.
- **`assets/longform/`** — the author's hand-designed long-form graphics, with the
  「输出的格式」 panel rebuilt for five formats and tool logos normalised to a common
  CONTENT size (their source files differ in padding by 36 percentage points).
- **`scripts/make_gallery.py`** — regenerates the README's showcase images from
  `examples/`. They had gone stale unnoticed, still advertising flat arrowheads and
  a blue dot-grid long after both were fixed; a guard now asserts they are current.
- **`scripts/audit_edges.py`** — measures edge INK to catch rasterisation asymmetry.
- **`doctor.py --fix-fonts`** — installs IBM Plex Mono instead of only reporting it missing.
- **`--formats=`** to narrow the delivery set; the default writes all five.
- **`.pptx` export** (`scripts/export_pptx.py`) — every box, colour, word, line and
  arrow is a native PowerPoint object, transcribed from the master SVG so the deck
  IS the delivered figure. Written with the standard library alone (a .pptx is a
  ZIP of XML), keeping the zero-dependency rule. All seven layouts, all three modes.
- **`scripts/verify_pptx.py`** — renders a generated deck and measures where the
  text actually landed, against the master. Catches text that never rendered,
  moved, or changed size. The gap it closes had let a deck ship with 33%-oversized
  type while every other check passed.
- **README rebuilt for the release**: positioning rewritten around the editable
  hand-offs, a `30 秒开始` block, `适合 / 不适合`, an FAQ, and the author's long-form
  graphics. The badge row now obeys the discipline it describes — one grey, one red,
  spent on this release's actual claim.
- **`assets/longform/`** — the author's hand-designed long-form graphics, with the
  「输出的格式」 panel rebuilt for five formats and tool logos normalised to a common
  CONTENT size (their source files differ in padding by 36 percentage points).
- **`scripts/make_gallery.py`** — regenerates the README's showcase images from
  `examples/`. They had gone stale unnoticed, still advertising flat arrowheads and
  a blue dot-grid long after both were fixed; a guard now asserts they are current.
- **`scripts/audit_edges.py`** — measures the INK on each edge of a bar to catch
  rasterisation asymmetries (see Fixed).
- **Font profiles** for the deck: `master` (the SVG's own faces, default) and
  `safe` (`--pptx-fonts=safe`, faces that ship with Windows).

### Changed
- **奇川流 → 奇川风, 歸葬流 → 歸藏风.** 葬 was a mis-spelling of the blogger 歸藏's
  name. Pinyin identifiers (`guizang`, `--guizang`) are unchanged — that is his own
  romanisation. Old names still parse, for maps written against v1.0.1.
- **歸藏风 dot grid is light grey, not Klein blue.** The blue is this style's single
  anchor colour and belongs on solid blocks, not on the backdrop. Latin and numeral
  runs now carry tracking.
- **白描 squares its modules off** to a near right angle. Bars (`rx=0`) and terminal
  pills are exempt. Layout stays byte-identical to 奇川风.
- **The timeline axis bar is a right angle** in every mode; the numbered axis line
  takes square ends. A time ruler is a bar, not a pill.

### Fixed
- **The arrowhead read as a flat stub.** `refX` was pinned at 11 for every line
  weight, putting the line's square cap where the triangle is only 0.4x as wide.
  The junction is now derived from the stroke width, so the head stays sharp and
  seamless at any weight.
- **A bar's lower rule printed heavier than its upper one.** The raster ran at a
  fractional scale (150 dpi = 1.5625x), so integer coordinates fell mid-pixel.
  Rasters are now pinned to an exact integer scale and hairlines to integer widths.
- **A bar's lower rule printed heavier than its upper one** — raster pinned to an
  exact integer scale, hairline widths made integers.
- **歸藏风 lost its background entirely**: two `<defs>` blocks with the paper rect
  between them, and the parser took "everything after the last one".
- **Mode transforms failed silently** when a regex stopped matching. Every step
  that must fire now reports a miss by name, and a guard asserts there are none.
- Tuning constants gathered into `style-tokens.json` → `tuning`, named and
  explained (values unchanged; the masters are byte-identical).
- Stale docs: seven layouts (not six), the real guard count, the version footer,
  `ranksep` (0.70 → 1.1), and a literal `$\n` in six reference files.

## v1.0.1 — 三种视觉模式（2026-07）

### 新增
- **三档视觉模式**，共用同一套几何（确定性布局 + 正交走线），只换表达：
  - **奇川风**（默认）— 宋体 + 灰阶 + 唯一深红，办案 / 个人品牌；
  - **白描** `--baimiao` — 纯黑白线稿、纯色块变框线模块，法院 / 打印 / 卷宗；
  - **歸藏风** `--guizang` — 克莱因蓝 `#002FA7` + 浅灰 + 白，无衬线中文 + IBM Plex Mono
    数字英文、直角发丝边、纯色蓝块白字、点阵底、大居中轻标题，线上传播 / 讲课。
- 也可在 semantic-map 里写 `"visual_mode": "白描" | "歸藏风"`。
- **`scripts/doctor.py`** 环境自检：裸仓库 clone 后第一步，逐项检查 graphviz、
  光栅化器、中文衬线 / 无衬线 / IBM Plex Mono，缺失时说明会退化成什么；
  必需项缺失退出码为 1，可用于 CI 门禁。
- `gallery/`：7 种图表 × 3 档成套图 + 每种类型的三档并列对照图。

### 工作流
- CHECKPOINT 改为**一轮三问**：结构确认 / 红色重点 / 视觉模式（按使用场景）。
- **红色改为 opt-in**：深红只标用户指定的元素；**用户跳过或不回应 → 默认奇川风且完全不用红**，
  模型不得自行挑选强调。交付摘要须写明所用模式与强调元素（或 none）。

### 修复
- 关系图布局与走线重写：枢纽居中辐射、每边 ≤2 条连线、连线不穿节点、
  箭头精确落在边框、标签不压线不互相遮挡（`references/relationship-spec.md` 冻结）。
- 修正标签放置的两个 bug：命中空位后未置位导致被覆盖；圆角把竖线拆成两段
  导致侧标签定位基准错误。
- 白描：无边框填充块（甘特期间条、时间轴色带）补发丝黑边，否则渲染后不可见；
  编号圆改为圆框 + 黑数字。

### 测试
- 回归自测 **88 项**全部通过，含「白描」「歸藏风」两条模式守卫与 doctor 守卫。

### 长文本 / 溢出
- **超长标题自动折行**（`fit_title`）：按画布宽度均分成多行、内容下移、画布长高；
  只插入换行，不改一个字，也不缩字号。标题本来放得下的图逐字节不变。
- **注释按真实行数预留高度**：关系图不再假设注释只有两行。
- **`lint.py` 改为测量文字实际宽度**（中文≈1em、拉丁≈0.55em），
  居中标题"锚点在画布内、字却甩出边界"的盲区被补上。

### 可编辑 drawio
- **`.drawio` / `.drawio.svg` 跟随视觉模式**：白描导出白底黑线黑字；歸藏风导出蓝/灰/白，
  并把**枢纽节点提升为纯蓝块白字**（关系图没有深色块可映射，由关键当事人承载强调，
  与 SVG 一致）；奇川风逐字节不变。只改颜色，id/几何/结构不动，仍可在 draw.io 正常编辑。

### 文档 / 展示
- README：新增「同一张图 · 三种模式」竖排三档对照（原横排 8.3:1 扁条在 GitHub 上
  高度仅 92px，细节不可读，已修正为 0.45–0.9 比例）。
- Badges 增至 10 个（版本、Claude Skill、测试数、视觉模式、图表类型、输出格式、脱敏）。
- 回归自测 **90 项**全部通过。
