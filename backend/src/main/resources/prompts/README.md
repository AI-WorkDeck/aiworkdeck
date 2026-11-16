<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# prompts/ 维护说明

本目录的 `system_prompt*.md` 与 `tools-*.md` 会被 `ContextAssemblerService` **原样**读进系统提示。
本文件不会被加载，维护者说明一律写在这里，不要写进被加载的文件里。

## 文件

| 文件 | 何时加载 |
|---|---|
| `system_prompt.md` / `system_prompt.en.md` | 基底提示，按应用语言二选一（en 缺失时回退中文版） |
| `tools-lowa*.md` | 桌面编辑器（LOWA）会话，含未登记能力的兜底会话 |
| `tools-office-word*.md` / `tools-office-excel*.md` / `tools-office-ppt*.md` | Office / WPS 任务窗格，按宿主分 |
| `tools-none*.md` | 没有文档编辑执行器的纯对话会话 |

能力到片段文件名的唯一映射是 `ContextAssemblerService.toolGuidanceStem`。片段拼在基底里的
`<!-- awd:tool-guidance -->` 占位处（`spliceToolGuidance`）；**ASK 模式不拼任何片段**，占位换成空串。

## 工具协议变体（gap P2）

基底里成对出现的 `<!-- awd:protocol:xml -->` … `<!-- awd:protocol:native -->` … `<!-- awd:protocol:end -->`
是同一段的两种写法，`ToolProtocolPrompt.select` 按本轮的通道与模型二选一，标记行本身不发给模型：

- **xml 段** = 改造前的原文（`<thinking>` 必填、`<process><tool_code>` 文本调用），逐字节不许动——
  没有可靠原生工具调用的模型（本地 Ollama、`ai.prompt.native-protocol` 没列到的通道）与它的提示缓存前缀都靠它。
- **native 段** = 只讲函数调用：不出现 `<tool_code>` / `<process>` / `<thinking>`，只保留前端据以路由的
  `<final>` / `<question>` / `<artifact>` / `<title>` / `<walkthrough>`。

三个标记各占一整行；两版语言的变体块数量必须相同。`ContextAssemblerService` 里硬编码段（enforcement、模式约束、
工具目录）的原生写法在 `ToolProtocolPrompt.NATIVE_REWRITES`，改那些原文时同步改表（测试逐条对拍）。
新增规则若提到「怎么调工具」，两段都要写；与调用方式无关的规则写在变体块外面，两档共用。

## 规矩

1. **不要在被加载的文件里写 HTML 注释给维护者看。** 加载时不剥注释，注释会原样发给模型，
   每轮全价计费。例外：占位标记 `<!-- awd:tool-guidance -->`、上节的三个协议变体标记（加载时摘掉），以及基底里示例
   `<!-- STOP. Wait for tool_output. ... -->`（那是写给模型看的示例的一部分）。
2. **中英两版逐条对应。** 协议面（XML 标签、工具名、停机条件、输出顺序、编排器契约）两版完全一致，
   只有措辞与法域表述不同：中文版以内地法为默认专长、但「适用法域以文档为准」；英文版
   jurisdiction-neutral，`law_*` 只用于受内地法管辖的事项。改一版必须同步另一版。不用 emoji。
3. **基底只写与客户端能力无关的规则。** doc_* / sheet_* / slide_* / office_* / pptx_* / pdf_* / ref_*
   以及声明了 `@ToolMeta.requiresHost` 的工具，指引只能写进对应的 `tools-*.md` 片段。
4. **基底与 enforcement 不重复。** `ContextAssemblerService` 里的 `# SYSTEM ENFORCEMENT` 段与
   模式约束排在基底之后，本仓实证更靠后的那份才管用；两边都有的规则只留 enforcement 那份。
5. **per-tool 判据写在工具描述里。** 某个工具「什么时候用 / 别怎么用」的判据，先并进它的 `@Tool`
   描述，再从提示里删；提示里只留跨工具的取舍。
6. **一切稳定。** 这些文件整段属于提示缓存的稳定前缀，写进任何每轮会变的内容（时间、id、
   现查的记忆）都会让缓存永久失效且不报错。

## 守着这些文件的测试

- `SystemPromptToolVisibilityContractTest`：片段点名的工具在那一档可见；基底不点名挑客户端的工具；
  基底反引号里的名字要么是真下发的工具，要么在 `NON_TOOL_IDENTIFIERS` 里点名；签名与示例的参数名
  必须在下发 schema 里。
- `ToolProtocolPromptTest`：xml 段保留原文、native 段不教文本协议、两版变体块数量一致。
- `ContextAssemblerServiceTest` / `ContextAssemblerAskUserTest`：若干字串按位置钉住（Clarification、
  停机条件、ASK 约束等）。
- `FileToolsBatchMoveTest` / `FileToolsMoveToTrashTest`：两版基底要点名文件树原语与 `move_to_trash`。
- `MatchIndexBaseTest` / `NumberingRemovalContractTest` / `RedlineGranularityContractTest`：`tools-lowa*.md` 的判据句。
- `SystemPromptSizeReportTest`：五档会话 × 两种语言的体量报告，改完对账用。
