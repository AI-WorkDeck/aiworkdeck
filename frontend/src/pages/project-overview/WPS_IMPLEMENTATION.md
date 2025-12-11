# WPS 编辑器实现方式说明

## 当前实现方式

**当前使用**：WpsEditor 组件方式（新方式）  
**更新日期**：2025-12-10

## 两种实现方式对比

### 方式一：WpsEditor 组件方式（当前使用）

**文件**：`project-overview.vue`

**优点**：
- ✅ 代码简洁，逻辑封装在组件内部
- ✅ 可复用，其他页面可直接使用
- ✅ 统一的状态管理和错误处理
- ✅ 自动处理生命周期（销毁等）

**实现要点**：
```vue
<WpsEditor
  :file-id="wpsFileId"
  :file-name="wpsFileName"
  :app-id="wpsAppId"
  :mode="'edit'"
  :auto-load="false"
  @ready="onWpsEditorReady"
  @error="onWpsEditorError"
  ref="wpsEditor"
/>
```

**关键代码**：
- 使用 `showWpsEditor` 控制组件显示/隐藏
- 点击"开始编辑"后设置 `wpsFileId` 和 `wpsFileName`，然后调用 `$refs.wpsEditor.load()`
- 通过事件监听器处理编辑器状态

---

### 方式二：手动集成方式（备份）

**文件**：`project-overview.vue.backup`

**优点**：
- ✅ 完全控制加载流程
- ✅ 可以自定义每个步骤的处理逻辑
- ✅ 便于调试，所有逻辑都在当前文件中

**实现要点**：
```javascript
// 手动创建会话
const session = await createWpsSession({ fileId })
const token = session.token

// 手动初始化编辑器
this.wpsInstance = await initWpsEditor({
  containerId: this.wpsContainerId,
  appId: this.wpsAppId,
  fileId: fileId,
  fileName: fileName,
  mode: 'edit',
  token,
})
```

**关键代码**：
- 使用 `wpsEverTried`、`wpsLoading`、`wpsInstanceReady` 管理状态
- 手动处理 DOM 元素查找和渲染等待
- 手动管理编辑器实例的生命周期

---

## 如何切换实现方式

### 从组件方式切换到手动方式

如果组件方式出现问题，可以按以下步骤恢复：

1. **备份当前文件**：
   ```bash
   cp project-overview.vue project-overview.vue.component
   ```

2. **恢复备份文件**：
   ```bash
   cp project-overview.vue.backup project-overview.vue
   ```

3. **或者手动替换**：
   - 将 `project-overview.vue.backup` 的内容复制到 `project-overview.vue`
   - 注意保留样式部分（`.backup` 文件中样式部分被省略了）

### 从手动方式切换到组件方式

如果手动方式出现问题，可以按以下步骤切换：

1. **查看当前实现**：
   - 当前 `project-overview.vue` 已使用组件方式
   - 参考本文档的"方式一"部分

2. **确保组件存在**：
   - 检查 `frontend/src/components/WpsEditor.vue` 是否存在
   - 如果不存在，从备份或文档中恢复

---

## 调试建议

### 组件方式调试

如果使用组件方式时出现问题：

1. **检查组件是否正确引入**：
   ```javascript
   import WpsEditor from '@/components/WpsEditor.vue'
   ```

2. **检查组件是否正确注册**：
   ```javascript
   components: {
     WpsEditor
   }
   ```

3. **检查 ref 是否正确**：
   ```javascript
   this.$refs.wpsEditor.load()  // 确保 ref="wpsEditor" 存在
   ```

4. **查看组件内部日志**：
   - 打开 `WpsEditor.vue` 查看控制台输出
   - 检查组件内部的状态管理

### 手动方式调试

如果使用手动方式时出现问题：

1. **检查 SDK 加载**：
   ```javascript
   const SDK = await loadWpsSDK()  // 确保 SDK 加载成功
   ```

2. **检查容器元素**：
   ```javascript
   const containerElement = document.getElementById(this.wpsContainerId)
   // 确保元素存在且已渲染
   ```

3. **检查会话创建**：
   ```javascript
   const session = await createWpsSession({ fileId })
   // 确保后端接口正常
   ```

4. **检查初始化参数**：
   ```javascript
   // 确保所有必需参数都正确传递
   appId, fileId, fileName, mode, token
   ```

---

## 常见问题

### Q1: 组件方式加载失败，如何快速切换到手动方式？

**A**: 直接恢复备份文件：
```bash
cp project-overview.vue.backup project-overview.vue
```

### Q2: 两种方式可以共存吗？

**A**: 不建议。两种方式会冲突，只能使用其中一种。

### Q3: 如何判断应该使用哪种方式？

**A**: 
- **组件方式**：推荐用于生产环境，代码更简洁，易于维护
- **手动方式**：推荐用于调试阶段，可以完全控制每个步骤

### Q4: 组件方式失败时，如何保留错误信息？

**A**: 组件方式会通过 `@error` 事件传递错误信息，可以在 `onWpsEditorError` 方法中处理。

---

## 文件清单

- `project-overview.vue` - 当前实现（组件方式）
- `project-overview.vue.backup` - 备份实现（手动方式）
- `WpsEditor.vue` - WPS 编辑器组件（位于 `frontend/src/components/`）
- `wps-sdk.js` - WPS SDK 工具类（位于 `frontend/src/utils/`）

---

**最后更新**：2025-12-10  
**维护者**：开发团队

