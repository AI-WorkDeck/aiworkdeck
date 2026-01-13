# WPS AI 替换功能 - 完整测试用例

## 测试环境
- **测试时间**：2025-01-11
- **文档名称**：`替换测试.docx` 或 `newdocument.docx`
- **初始内容**：
```
甲方和乙方签订了合同。甲方应支付货款，乙方应交付货物。
如果甲方违约，甲方应承担违约责任。如果乙方违约，乙方也应承担责任。
本合同由甲方和乙方共同签署。
```

---

## 测试前准备

### 1. 创建测试文档
1. 打开 WPS 编辑器
2. 创建新文档
3. 复制并粘贴上述初始内容
4. 保存为 `替换测试.docx`

### 2. 打开浏览器控制台
1. 按 F12 打开开发者工具
2. 切换到 "Console" 标签
3. 确保可以看到 `[WpsBridge]` 开头的日志

### 3. 准备 AI 对话
1. 在 AI 栏点击输入框
2. 确保文档已打开（WPS 编辑器可见）

---

## 测试用例

### TC-001: 全部替换功能

**测试步骤**：
1. 在 AI 栏输入：`把所有的'甲方'改成'买方'`
2. 点击发送按钮
3. 等待 AI 执行完成

**预期日志**：
```
[WpsBridge] findAndReplace called: find='甲方', replace='买方', all=true
[WpsBridge] TrackRevisions disabled for AI operation
[WpsBridge] found 5 raw matches via JS
[WpsBridge] 5 matches remain after filtering deleted ranges
[WpsBridge] executeDelete: Using range.Text = ""
[WpsBridge] Inserting "买方" via Selection.InsertAfter
```

**预期结果**：
```
买方和乙方签订了合同。买方应支付货款，乙方应交付货物。
如果买方违约，买方应承担违约责任。如果乙方违约，乙方也应承担责任。
本合同由买方和乙方共同签署。
```

**验证点**：
- [ ] 所有 5 处"甲方"都被替换为"买方"
- [ ] "乙方"保持不变
- [ ] 文档长度正确（5处替换，每处增加1个字符）

---

### TC-002: 替换第一个匹配项

**测试步骤**：
1. 在 AI 栏输入：`把第一个'乙方'改成'承包方'`
2. 点击发送按钮
3. 等待 AI 执行完成

**预期日志**：
```
[WpsBridge] replaceNthMatch: find='乙方', replace='承包方', index=1
[WpsBridge] found 5 raw matches via JS
[WpsBridge] replaceAtPosition: 3-5 => "承包方"
[WpsBridge] Range verification: 3-5, Text: "乙方"
[WpsBridge] executeDelete: Range: 3-5, Text: "乙方", Count: 2
[WpsBridge] executeDelete: Selection.Delete() completed
[WpsBridge] Inserting "承包方" via Selection.InsertAfter
```

**预期结果**：
```
买方和承包方签订了合同。买方应支付货款，乙方应交付货物。
如果买方违约，买方应承担违约责任。如果乙方违约，乙方也应承担责任。
本合同由买方和乙方共同签署。
```

**验证点**：
- [ ] 只有第1个"乙方"被替换为"承包方"
- [ ] 其他4个"乙方"保持不变
- [ ] 替换位置正确（开头的"乙方"）

---

### TC-003: 替换第 N 个匹配项

**测试步骤**：
1. 在 AI 栏输入：`把第3个'违约'改成'毁约'`
2. 点击发送按钮
3. 等待 AI 执行完成

**预期日志**：
```
[WpsBridge] replaceNthMatch: find='违约', replace='毁约', index=3
[WpsBridge] found 2 raw matches via JS
[WpsBridge] replaceAtPosition: XX-XX => "毁约"
[WpsBridge] executeDelete: Selection.Delete() completed
[WpsBridge] Inserting "毁约" via Selection.InsertAfter
```

**预期结果**：
```
买方和承包方签订了合同。买方应支付货款，乙方应交付货物。
如果买方毁约，买方应承担违约责任。如果乙方违约，乙方也应承担责任。
本合同由买方和乙方共同签署。
```

**验证点**：
- [ ] 第3个"违约"（在"如果买方违约"中）被替换为"毁约"
- [ ] 第2个"违约"（在"如果乙方违约"中）保持不变
- [ ] 替换位置精确

---

### TC-004: 删除所有匹配项

**测试步骤**：
1. 在 AI 栏输入：`删除所有的'应'字`
2. 点击发送按钮
3. 等待 AI 执行完成

**预期日志**：
```
[WpsBridge] deleteText called: text='应', all=true
[WpsBridge] found 2 raw matches via JS
[WpsBridge] executeDelete: Using range.Text = ""
[WpsBridge] executeDelete: Selection.Delete() completed
```

**预期结果**：
```
买方和承包方签订了合同。买方支付货款，乙方交付货物。
如果买方违约，买方承担违约责任。如果乙方违约，乙方也承担责任。
本合同由买方和乙方共同签署。
```

**验证点**：
- [ ] 所有"应"字被删除（2处）
- [ ] 词语连贯性保持（"应支付" → "支付"，"应承担" → "承担"）

---

### TC-005: 删除第 N 个匹配项

**测试步骤**：
1. 在 AI 栏输入：`删除第2个'合同'`
2. 点击发送按钮
3. 等待 AI 执行完成

**预期日志**：
```
[WpsBridge] deleteMatch called: find='合同', matchIndex=2
[WpsBridge] found 2 raw matches via JS
[WpsBridge] executeDelete: Selection.Delete() completed
```

**预期结果**：
```
买方和承包方签订了。买方应支付货款，乙方应交付货物。
如果买方违约，买方应承担违约责任。如果乙方违约，乙方也应承担责任。
本合同由买方和乙方共同签署。
```

**验证点**：
- [ ] 第2个"合同"（在"本合同由..."中）被删除
- [ ] 第1个"合同"（在"签订了合同"中）保持不变
- [ ] 删除位置精确，不影响前后文字

---

### TC-006: 边界测试 - 替换不存在的文本

**测试步骤**：
1. 在 AI 栏输入：`把所有的'丙方'改成'丁方'`
2. 点击发送按钮
3. 等待 AI 执行完成

**预期日志**：
```
[WpsBridge] findAndReplace called: find='丙方', replace='丁方', all=true
[WpsBridge] found 0 raw matches via JS
```

**预期 AI 响应**：
```
<thinking>用户要求替换"丙方"，但文档中未找到该文本。</thinking>
<final>
文档中未找到"丙方"，无法进行替换。请检查：
1. 文档中是否包含"丙方"文本
2. 拼写是否正确
</final>
```

**验证点**：
- [ ] AI 正确识别文本不存在
- [ ] 不会进行无效的替换操作
- [ ] 给出友好的提示信息

---

### TC-007: 边界测试 - 索引超出范围

**测试步骤**：
1. 在 AI 栏输入：`把第10个'甲方'改成'买方'`
2. 点击发送按钮
3. 等待 AI 执行完成

**预期日志**：
```
[WpsBridge] replaceNthMatch: find='甲方', replace='买方', index=10
[WpsBridge] found 5 raw matches via JS
```

**预期 AI 响应**：
```
<thinking>用户要求替换第10个"甲方"，但文档中只有5个。</thinking>
<final>
文档中只找到 5 个"甲方"，无法替换第 10 个。请检查索引是否正确。
可用索引：1-5
</final>
```

**验证点**：
- [ ] AI 正确识别索引超出范围
- [ ] 告知用户实际匹配数量
- [ ] 不会执行无效操作

---

## 测试结果记录表

| 用例编号 | 测试时间 | 执行结果 | 成功/失败 | 备注 |
|---------|---------|---------|-----------|------|
| TC-001 | | | ☐ 成功 ☐ 失败 | 全部替换"甲方"→"买方" |
| TC-002 | | | ☐ 成功 ☐ 失败 | 替换第1个"乙方"→"承包方" |
| TC-003 | | | ☐ 成功 ☐ 失败 | 替换第3个"违约"→"毁约" |
| TC-004 | | | ☐ 成功 ☐ 失败 | 删除所有"应"字 |
| TC-005 | | | ☐ 成功 ☐ 失败 | 删除第2个"合同" |
| TC-006 | | | ☐ 成功 ☐ 失败 | 替换不存在的文本 |
| TC-007 | | | ☐ 成功 ☐ 失败 | 索引超出范围 |

---

## 自动化测试脚本

如果需要自动化测试，可以使用以下 Jest 测试套件：

```javascript
describe('WPS 替换功能测试', () => {
  // 需要先打开测试文档
  beforeAll(async () => {
    // 打开测试文档
    await page.click('[data-testid="file-item:替换测试.docx"]')
    await page.waitForSelector('[data-testid="wps-editor"]')
  })

  test('TC-001: 全部替换', async () => {
    await page.fill('[data-testid="ai-input"]', '把所有的"甲方"改成"买方"')
    await page.click('[data-testid="ai-send-button"]')

    // 等待 AI 响应
    await page.waitForSelector('[data-testid="ai-response"]')

    // 验证结果
    const content = await page.evaluate(() => {
      return window.wpsApp.ActiveDocument.Content.Text
    })

    expect(content).toContain('买方')
    expect(content).not.toContain('甲方')
  })

  test('TC-002: 替换第一个', async () => {
    await page.fill('[data-testid="ai-input"]', '把第一个"乙方"改成"承包方"')
    await page.click('[data-testid="ai-send-button"]')

    // 验证只有第一个被替换
    const content = await page.evaluate(() => {
      return window.wpsApp.ActiveDocument.Content.Text
    })

    // 计算替换次数
    const matches = (content.match(/承包方/g) || []).length
    expect(matches).toBe(1)
  })

  // ... 其他测试用例
})
```

---

## 已知问题和限制

### 1. 删除位置索引问题
- **问题**：`replaceAll=true` 时从后向前替换，索引可能不准确
- **影响**：TC-001
- **状态**：✅ 已修复（使用 `replaceAtPosition` 直接创建 Range）

### 2. Selection.Delete 参数问题
- **问题**：`Selection.Delete(1)` 只删除1个字符
- **影响**：所有删除操作
- **状态**：✅ 已修复（使用 `Selection.Delete()` 不传参数）

### 3. range.Text = "" 不生效
- **问题**：在非修订模式下，直接赋值可能不工作
- **影响**：所有替换操作
- **状态**：✅ 已修复（备用 Selection.Delete）

### 4. Range 对象没有 Delete 方法
- **问题**：`range.Delete()` 不存在
- **影响**：使用 Range 删除时
- **状态**：✅ 已修复（使用 `range.Text = ""` 或 `Selection.Delete()`）

### 5. Range 对象没有 InsertAfter 方法
- **问题**：`range.InsertAfter()` 不存在
- **影响**：使用 Range 插入时
- **状态**：✅ 已修复（使用 `sel.InsertAfter()`）

---

## 测试清理

测试完成后：
1. 关闭测试文档（不保存）
2. 或保存为 `替换测试-已测试.docx` 用于对比
3. 清空对话历史
4. 准备下一轮测试

---

## 测试成功标准

**整体成功标准**：
- [ ] 所有 7 个测试用例通过
- [ ] 没有控制台错误
- [ ] AI 响应符合预期
- [ ] 文档内容正确更新

**必须通过的核心用例**：
- [ ] TC-001: 全部替换（基础功能）
- [ ] TC-002: 替换第N个（精确控制）
- [ ] TC-004: 删除所有（删除功能）

**可选用例**：
- [ ] TC-003: 替换第N个（进一步验证）
- [ ] TC-005: 删除第N个（删除精确性）
- [ ] TC-006/007: 边界测试（错误处理）

---

## 相关文件

- **System Prompt**: `backend/src/main/resources/prompts/system_prompt.md`
- **WPS Tools**: `backend/src/main/java/com/checkba/service/ai/tools/WpsTools.java`
- **WPS Bridge**: `frontend/src/composables/useWpsBridge.js`
- **单元测试**: `backend/src/test/java/com/checkba/service/ai/tools/WpsReplaceIntentTest.java`
- **测试用例文档**: `docs/WPS_REPLACE_TEST_CASES.md`

---

## 更新历史

| 日期 | 版本 | 更新内容 |
|------|------|---------|
| 2025-01-11 | 1.0 | 初始版本，创建完整测试用例 |
| 2025-01-11 | 1.1 | 添加已知问题和限制 |
| 2025-01-11 | 1.2 | 添加自动化测试脚本示例 |
