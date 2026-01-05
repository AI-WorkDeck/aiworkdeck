# WPS 文档操作工具升级计划

## 一、升级背景与目标

### 1.1 背景分析

当前系统通过 WPS WebOffice SDK 实现了在线文档编辑能力，但 AI Agent 与 WPS 文档的交互仅限于：
- 通过 `useWpsBridge.js` 实现基本的文本写入（`wps_write` 工具）
- 开启修订模式（TrackRevisions）进行安全留痕
- 基本的插入操作（insert/replace/append）

**现有限制**：
1. Agent 无法**定位**到文档特定位置进行编辑
2. Agent 无法**查找**文档中的特定内容
3. Agent 无法**查看**当前选区或光标位置的文本内容
4. Agent 无法实现**精确替换**（基于位置或上下文）
5. 缺乏与用户**协同编辑**的能力（如同 Cursor 编辑代码）

### 1.2 升级目标

使 AI Agent 具备与用户**协同编辑**WPS文档的能力：
- **读取能力**：获取选区文本、光标位置、文档结构
- **定位能力**：基于关键词、书签、段落号定位光标
- **修改能力**：查找替换、插入、删除、格式化
- **协同能力**：修订模式下进行修改，支持用户审阅接受/拒绝

最终效果：用户视 Agent 为"另一个编辑者"，在与用户共同编辑文件。

---

## 二、WPS WebOffice API 能力分析

根据 WPS WebOffice 官方文档（https://solution.wps.cn/docs/client/api/Word/），核心 API 对象包括：

### 2.1 ActiveDocument（活动文档）

文档级别的操作入口：
```javascript
const doc = await wps.Application.ActiveDocument
```

关键属性和方法：
- `Content` - 获取文档主体内容的 Range 对象
- `Paragraphs` - 段落集合
- `Bookmarks` - 书签集合
- `Range(start, end)` - 获取指定范围的 Range 对象
- `TrackRevisions` - 修订模式开关
- `Revisions` - 修订集合

### 2.2 Selection（选区）

当前光标/选区的操作：
```javascript
const sel = await wps.Application.Selection
```

关键属性和方法：
- `Text` - 获取/设置选区文本
- `Start` / `End` - 选区起止位置
- `Range` - 获取选区的 Range 对象
- `TypeText(text)` - 在光标位置插入文本
- `InsertAfter(text)` / `InsertBefore(text)` - 在选区前后插入
- `Delete()` - 删除选区内容
- `MoveUp/MoveDown/MoveLeft/MoveRight()` - 移动光标
- `GoTo(what, which, count, name)` - 跳转到指定位置
- `Find` - 查找对象
- `HomeKey/EndKey()` - 移动到行首/行尾

### 2.3 Range（范围）

文档中任意范围的操作（核心对象）：
```javascript
const range = doc.Range(0, 100) // 获取前100个字符
```

关键属性和方法：
- `Text` - 获取/设置范围内文本
- `Start` / `End` - 范围起止位置
- `Select()` - 选中该范围
- `InsertAfter(text)` / `InsertBefore(text)` - 插入文本
- `Delete()` - 删除范围内容
- `Find` - 查找对象
- `Paragraphs` - 范围内的段落集合

### 2.4 Find（查找）

查找和替换功能：
```javascript
const find = sel.Find
find.Text = "要查找的文本"
find.Replacement.Text = "替换为"
find.Execute(findText, matchCase, matchWholeWord, ...)
```

关键属性和方法：
- `Text` - 查找文本
- `Replacement.Text` - 替换文本
- `MatchCase` - 区分大小写
- `MatchWholeWord` - 全字匹配
- `Forward` - 向前/向后搜索
- `Wrap` - 是否循环搜索
- `Execute(...)` - 执行查找/替换

---

## 三、技术架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户界面层                               │
│   ┌─────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│   │ WpsEditor   │  │ AI Chat Panel    │  │ 修订面板        │   │
│   │ (Vue组件)    │  │ (对话界面)        │  │ (接受/拒绝)     │   │
│   └──────┬──────┘  └────────┬─────────┘  └────────┬────────┘   │
└──────────┼──────────────────┼─────────────────────┼────────────┘
           │                  │                     │
           ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WPS Bridge 层                               │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              useWpsBridge.js (增强版)                    │   │
│   │  - executeWpsAction(action)                              │   │
│   │  - getSelectionInfo() → {text, start, end}              │   │
│   │  - findAndReplace(find, replace, options)               │   │
│   │  - goToPosition(type, target)                           │   │
│   │  - insertAtCursor(text)                                 │   │
│   │  - getDocumentOutline() → [{title, level, range}]       │   │
│   └─────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ SSE (client_action 事件)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                        后端 Agent 层                             │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              AgentOrchestrator.java                      │   │
│   │  - 新增 WPS 操作工具定义                                  │   │
│   │  - 处理 wps_* 系列工具调用                               │   │
│   │  - 通过 SSE 发送 client_action 到前端执行                 │   │
│   └─────────────────────────────────────────────────────────┘   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              WpsTools.java (新增)                        │   │
│   │  @Tool wps_get_selection()                               │   │
│   │  @Tool wps_find_text(keyword)                            │   │
│   │  @Tool wps_replace_text(find, replace)                   │   │
│   │  @Tool wps_insert_at_cursor(text)                        │   │
│   │  @Tool wps_goto(type, target)                            │   │
│   │  @Tool wps_get_paragraph(index)                          │   │
│   │  @Tool wps_modify_paragraph(index, newText)              │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 通信机制设计

由于 WPS 操作需要在**前端浏览器**执行（WPS SDK 运行在前端），而 Agent 逻辑在**后端**，需要设计双向通信：

#### 3.2.1 后端 → 前端（执行指令）

沿用现有 SSE `client_action` 事件机制：

```java
// 后端发送 WPS 操作指令
sseEmitterService.send(conversationId, "client_action", 
    "{\"tool\":\"wps_command\", \"action\":\"find_replace\", " +
    "\"params\":{\"find\":\"旧文本\", \"replace\":\"新文本\"}}");
```

```javascript
// 前端监听并执行
eventSource.addEventListener('client_action', (event) => {
    const action = JSON.parse(event.data);
    if (action.tool === 'wps_command') {
        wpsBridge.executeCommand(action.action, action.params);
    }
});
```

#### 3.2.2 前端 → 后端（返回结果）

新增 API 端点接收 WPS 操作结果：

```java
// 后端新增接口
@PostMapping("/api/ai/agent/wps-result")
public void receiveWpsResult(@RequestBody WpsResultPayload payload) {
    // conversationId, requestId, success, data
    // 将结果缓存或通过 CompletableFuture 解锁等待的工具调用
}
```

```javascript
// 前端执行完成后回调
async executeCommand(action, params) {
    const result = await wpsBridge.execute(action, params);
    await fetch('/api/ai/agent/wps-result', {
        method: 'POST',
        body: JSON.stringify({
            conversationId,
            requestId: params.requestId,
            success: result.success,
            data: result.data
        })
    });
}
```

---

## 四、工具定义设计

### 4.1 WpsTools.java 工具类

```java
package com.checkba.service.ai.tools;

import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.P;
import org.springframework.stereotype.Component;

@Component
public class WpsTools {

    /**
     * 获取当前选区信息
     * 用于了解用户当前光标位置和选中的文本
     */
    @Tool(value = "获取WPS文档中当前选区的文本内容和位置信息")
    public String wps_get_selection() {
        // 发送指令到前端，等待结果返回
        // 返回格式: {"text": "选中的文本", "start": 100, "end": 150}
    }

    /**
     * 在文档中查找文本
     */
    @Tool(value = "在WPS文档中查找指定文本，返回所有匹配位置")
    public String wps_find_text(
        @P("要查找的文本") String keyword,
        @P("是否区分大小写，默认false") boolean matchCase
    ) {
        // 返回格式: {"found": true, "count": 3, "positions": [100, 250, 400]}
    }

    /**
     * 查找并替换文本
     */
    @Tool(value = "在WPS文档中查找并替换文本，支持全部替换或单次替换")
    public String wps_find_replace(
        @P("要查找的文本") String findText,
        @P("替换为的文本") String replaceText,
        @P("是否替换全部匹配项，默认true") boolean replaceAll
    ) {
        // 返回格式: {"success": true, "replacedCount": 5}
    }

    /**
     * 在当前光标位置插入文本
     */
    @Tool(value = "在WPS文档的当前光标位置插入文本内容")
    public String wps_insert_at_cursor(
        @P("要插入的文本内容") String text
    ) {
        // 返回格式: {"success": true, "insertedAt": 150}
    }

    /**
     * 移动光标到指定位置
     */
    @Tool(value = "移动WPS文档的光标到指定位置")
    public String wps_goto(
        @P("定位类型: paragraph(段落)/bookmark(书签)/start(文档开头)/end(文档结尾)/line(行号)") String type,
        @P("目标值: 段落号、书签名、行号等") String target
    ) {
        // 返回格式: {"success": true, "position": 500}
    }

    /**
     * 获取指定段落的文本
     */
    @Tool(value = "获取WPS文档中指定段落的文本内容")
    public String wps_get_paragraph(
        @P("段落索引，从1开始") int paragraphIndex
    ) {
        // 返回格式: {"text": "段落内容...", "start": 100, "end": 200}
    }

    /**
     * 修改指定段落的文本
     */
    @Tool(value = "修改WPS文档中指定段落的文本内容")
    public String wps_modify_paragraph(
        @P("段落索引，从1开始") int paragraphIndex,
        @P("新的段落文本") String newText
    ) {
        // 返回格式: {"success": true}
    }

    /**
     * 获取文档大纲结构
     */
    @Tool(value = "获取WPS文档的大纲结构，包括各级标题")
    public String wps_get_outline() {
        // 返回格式: [{"title": "第一章", "level": 1, "position": 0}, ...]
    }

    /**
     * 在指定标题下插入内容
     */
    @Tool(value = "在WPS文档的指定标题下方插入新内容")
    public String wps_insert_under_heading(
        @P("标题文本，用于定位") String headingText,
        @P("要插入的内容") String content
    ) {
        // 返回格式: {"success": true, "insertedAt": 300}
    }

    /**
     * 添加批注
     */
    @Tool(value = "在WPS文档的当前选区添加批注")
    public String wps_add_comment(
        @P("批注内容") String commentText
    ) {
        // 返回格式: {"success": true, "commentId": "xxx"}
    }
}
```

### 4.2 前端 WpsBridge 增强

```javascript
// useWpsBridge.js 增强版

export function useWpsBridge() {
    const isProcessing = ref(false)
    const lastError = ref(null)
    const pendingRequests = new Map() // requestId -> resolve/reject

    /**
     * 获取当前选区信息
     */
    const getSelectionInfo = async () => {
        const wps = await getWpsInstance()
        const sel = await wps.Application.Selection
        return {
            text: await sel.Text,
            start: await sel.Start,
            end: await sel.End
        }
    }

    /**
     * 查找文本
     */
    const findText = async (keyword, matchCase = false) => {
        const wps = await getWpsInstance()
        const doc = await wps.Application.ActiveDocument
        const content = await doc.Content
        const find = await content.Find
        
        const positions = []
        let found = true
        
        // 重置查找位置
        await content.Select()
        const sel = await wps.Application.Selection
        await sel.HomeKey(6) // wdStory
        
        while (found) {
            find.Text = keyword
            find.MatchCase = matchCase
            find.Forward = true
            find.Wrap = 0 // wdFindStop
            
            found = await find.Execute()
            if (found) {
                positions.push(await sel.Start)
                await sel.MoveRight(1, 1) // 移动到下一个位置继续查找
            }
        }
        
        return { found: positions.length > 0, count: positions.length, positions }
    }

    /**
     * 查找并替换
     */
    const findAndReplace = async (findText, replaceText, replaceAll = true) => {
        const wps = await getWpsInstance()
        const doc = await wps.Application.ActiveDocument
        
        // 确保开启修订模式
        doc.TrackRevisions = true
        
        const content = await doc.Content
        const find = await content.Find
        
        find.Text = findText
        find.Replacement.Text = replaceText
        
        // wdReplaceAll = 2, wdReplaceOne = 1
        const replaceType = replaceAll ? 2 : 1
        const success = await find.Execute(
            findText,      // FindText
            false,         // MatchCase
            false,         // MatchWholeWord
            false,         // MatchWildcards
            false,         // MatchSoundsLike
            false,         // MatchAllWordForms
            true,          // Forward
            1,             // Wrap (wdFindContinue)
            false,         // Format
            replaceText,   // ReplaceWith
            replaceType    // Replace
        )
        
        return { success, message: success ? '替换成功' : '未找到匹配项' }
    }

    /**
     * 移动光标到指定位置
     */
    const goToPosition = async (type, target) => {
        const wps = await getWpsInstance()
        const sel = await wps.Application.Selection
        
        switch (type) {
            case 'paragraph':
                // wdGoToParagraph = 4
                await sel.GoTo(4, 1, parseInt(target))
                break
            case 'bookmark':
                // wdGoToBookmark = -1
                await sel.GoTo(-1, 0, 0, target)
                break
            case 'start':
                await sel.HomeKey(6) // wdStory
                break
            case 'end':
                await sel.EndKey(6) // wdStory
                break
            case 'line':
                // wdGoToLine = 3
                await sel.GoTo(3, 1, parseInt(target))
                break
        }
        
        return { success: true, position: await sel.Start }
    }

    /**
     * 在光标位置插入文本
     */
    const insertAtCursor = async (text) => {
        const wps = await getWpsInstance()
        const doc = await wps.Application.ActiveDocument
        
        // 确保开启修订模式
        doc.TrackRevisions = true
        
        const sel = await wps.Application.Selection
        const position = await sel.Start
        await sel.TypeText(text)
        
        return { success: true, insertedAt: position }
    }

    /**
     * 获取指定段落文本
     */
    const getParagraph = async (index) => {
        const wps = await getWpsInstance()
        const doc = await wps.Application.ActiveDocument
        const paras = await doc.Paragraphs
        
        if (index < 1 || index > await paras.Count) {
            return { error: '段落索引超出范围' }
        }
        
        const para = await paras.Item(index)
        const range = await para.Range
        
        return {
            text: await range.Text,
            start: await range.Start,
            end: await range.End
        }
    }

    /**
     * 修改指定段落文本
     */
    const modifyParagraph = async (index, newText) => {
        const wps = await getWpsInstance()
        const doc = await wps.Application.ActiveDocument
        
        // 确保开启修订模式
        doc.TrackRevisions = true
        
        const paras = await doc.Paragraphs
        
        if (index < 1 || index > await paras.Count) {
            return { error: '段落索引超出范围' }
        }
        
        const para = await paras.Item(index)
        const range = await para.Range
        
        // 保留段落标记
        const endPos = await range.End
        range.End = endPos - 1
        range.Text = newText
        
        return { success: true }
    }

    /**
     * 获取文档大纲
     */
    const getDocumentOutline = async () => {
        const wps = await getWpsInstance()
        const doc = await wps.Application.ActiveDocument
        const paras = await doc.Paragraphs
        
        const outline = []
        const count = await paras.Count
        
        for (let i = 1; i <= count; i++) {
            const para = await paras.Item(i)
            const style = await para.Style
            const styleName = await style.NameLocal
            
            // 检查是否是标题样式
            if (styleName && styleName.includes('标题')) {
                const range = await para.Range
                const level = styleName.match(/\d/) ? parseInt(styleName.match(/\d/)[0]) : 1
                
                outline.push({
                    title: (await range.Text).trim(),
                    level,
                    paragraphIndex: i,
                    position: await range.Start
                })
            }
        }
        
        return outline
    }

    /**
     * 执行来自后端的 WPS 命令
     */
    const executeCommand = async (action, params) => {
        try {
            isProcessing.value = true
            lastError.value = null
            
            let result
            
            switch (action) {
                case 'get_selection':
                    result = await getSelectionInfo()
                    break
                case 'find_text':
                    result = await findText(params.keyword, params.matchCase)
                    break
                case 'find_replace':
                    result = await findAndReplace(params.findText, params.replaceText, params.replaceAll)
                    break
                case 'insert_at_cursor':
                    result = await insertAtCursor(params.text)
                    break
                case 'goto':
                    result = await goToPosition(params.type, params.target)
                    break
                case 'get_paragraph':
                    result = await getParagraph(params.index)
                    break
                case 'modify_paragraph':
                    result = await modifyParagraph(params.index, params.newText)
                    break
                case 'get_outline':
                    result = await getDocumentOutline()
                    break
                default:
                    result = { error: `未知命令: ${action}` }
            }
            
            return { success: !result.error, data: result }
            
        } catch (e) {
            lastError.value = e.message
            return { success: false, error: e.message }
        } finally {
            isProcessing.value = false
        }
    }

    return {
        isProcessing,
        lastError,
        getSelectionInfo,
        findText,
        findAndReplace,
        goToPosition,
        insertAtCursor,
        getParagraph,
        modifyParagraph,
        getDocumentOutline,
        executeCommand
    }
}
```

---

## 五、实现步骤

### 第一阶段：基础能力建设（1-2周）

#### 5.1 Week 1：前端 WPS Bridge 增强

1. **扩展 `useWpsBridge.js`**
   - 实现 `getSelectionInfo()` 方法
   - 实现 `findText()` 方法
   - 实现 `findAndReplace()` 方法
   - 实现 `goToPosition()` 方法

2. **单元测试**
   - 在 WpsEditor 组件中添加测试入口
   - 验证各 API 调用的正确性

3. **错误处理**
   - WPS 实例不存在时的降级处理
   - API 调用超时处理

#### 5.2 Week 2：后端工具注册与 SSE 通信

1. **创建 `WpsTools.java`**
   - 定义工具规范（Tool annotations）
   - 实现 SSE 指令发送逻辑

2. **实现前后端通信**
   - 后端发送 `client_action` 事件
   - 前端执行并返回结果
   - 后端接收结果的 API 端点

3. **集成到 AgentOrchestrator**
   - 注册 WPS 工具
   - 处理工具调用

### 第二阶段：高级功能（2-3周）

#### 5.3 Week 3：段落级操作

1. **实现段落操作**
   - `getParagraph(index)` - 获取段落
   - `modifyParagraph(index, text)` - 修改段落
   - `insertParagraph(afterIndex, text)` - 插入段落

2. **实现大纲操作**
   - `getDocumentOutline()` - 获取文档结构
   - `insertUnderHeading(heading, content)` - 在标题下插入

#### 5.4 Week 4：协同编辑与批注

1. **修订模式增强**
   - 确保所有修改都在修订模式下进行
   - 支持接受/拒绝特定修订

2. **批注功能**
   - `addComment(text)` - 添加批注
   - `getComments()` - 获取批注列表

### 第三阶段：优化与稳定性（1周）

#### 5.5 Week 5：测试与优化

1. **端到端测试**
   - 各种文档格式测试
   - 大文档性能测试
   - 并发编辑测试

2. **错误恢复**
   - 操作失败后的回滚机制
   - 网络中断时的重试机制

3. **用户体验**
   - 操作进度指示
   - 操作结果反馈

---

## 六、System Prompt 更新

为支持 WPS 协同编辑能力，需要更新 Agent 的 System Prompt：

```markdown
## WPS 文档编辑能力

你具备直接编辑用户正在打开的 WPS 文档的能力，如同另一个编辑者在与用户协同工作。

### 可用工具

1. **wps_get_selection** - 获取用户当前选中的文本和位置
2. **wps_find_text** - 在文档中查找文本
3. **wps_find_replace** - 查找并替换文本
4. **wps_insert_at_cursor** - 在光标位置插入内容
5. **wps_goto** - 移动光标到指定位置
6. **wps_get_paragraph** - 获取指定段落内容
7. **wps_modify_paragraph** - 修改指定段落内容
8. **wps_get_outline** - 获取文档大纲结构
9. **wps_insert_under_heading** - 在指定标题下插入内容
10. **wps_add_comment** - 添加批注

### 使用规范

1. **始终以修订模式操作**：所有修改都会以"修订"形式显示，用户可以审阅后接受或拒绝
2. **先了解上下文**：在修改前，使用 wps_get_selection 或 wps_get_paragraph 了解当前内容
3. **精确定位**：使用 wps_goto 或 wps_find_text 定位到正确位置再操作
4. **分步操作**：复杂修改分步进行，每步确认成功后再继续
5. **解释修改**：向用户说明你正在进行的修改及原因

### 典型场景

- 用户说"帮我把第三段的表述改得更专业"→ 先用 wps_get_paragraph(3) 获取内容，理解后用 wps_modify_paragraph(3, newText) 修改
- 用户说"在这里插入一个总结"→ 用 wps_insert_at_cursor(text) 在当前位置插入
- 用户说"把所有的'该公司'改成'目标公司'"→ 用 wps_find_replace("该公司", "目标公司", true) 批量替换
```

---

## 七、风险与注意事项

### 7.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WPS WebOffice API 兼容性 | 不同版本 API 可能有差异 | 封装统一接口，做版本检测 |
| 前后端通信延迟 | 工具调用响应慢 | 设置合理超时，提供进度反馈 |
| 并发编辑冲突 | 用户和 Agent 同时编辑 | 修订模式天然支持，增加冲突提示 |
| 大文档性能 | 操作卡顿 | 限制单次操作范围，分批处理 |

### 7.2 法律领域特殊考虑

1. **修改留痕**：所有 Agent 修改必须以修订模式进行，便于律师审阅
2. **引用准确性**：涉及法条引用时，需验证后再插入
3. **格式规范**：法律文书有严格格式要求，修改时需保持格式一致
4. **保密性**：确保文档内容不会泄露到不安全的外部服务

### 7.3 用户体验考虑

1. **操作透明**：每次 Agent 操作前告知用户
2. **可撤销**：所有操作都可通过"拒绝修订"撤销
3. **实时反馈**：操作完成后立即反馈结果
4. **错误友好**：操作失败时给出清晰的错误信息和建议

---

## 八、验收标准

### 8.1 功能验收

- [ ] Agent 能够获取用户当前选中的文本
- [ ] Agent 能够在文档中查找指定内容
- [ ] Agent 能够执行查找替换操作
- [ ] Agent 能够在光标位置插入文本
- [ ] Agent 能够移动光标到指定位置
- [ ] Agent 能够获取和修改指定段落
- [ ] Agent 能够获取文档大纲结构
- [ ] 所有修改都以修订模式进行

### 8.2 性能验收

- [ ] 单次操作响应时间 < 3秒
- [ ] 支持 100 页以上文档的操作
- [ ] 连续 10 次操作稳定可靠

### 8.3 用户体验验收

- [ ] 操作过程有进度提示
- [ ] 操作结果有明确反馈
- [ ] 错误信息清晰可理解
- [ ] 用户可随时查看和管理 Agent 的修订

---

## 九、参考资料

1. WPS WebOffice 官方文档：https://solution.wps.cn/docs/client/api/
2. Word VBA 对象模型参考（WPS 兼容）：https://docs.microsoft.com/en-us/office/vba/api/overview/word
3. 现有项目文档：
   - `/docs/wpsmanual.md` - WPS 集成使用手册
   - `/docs/ai_agent_dev.md` - AI Agent 架构与开发规范
   - `/frontend/src/composables/useWpsBridge.js` - 现有 WPS Bridge 实现


