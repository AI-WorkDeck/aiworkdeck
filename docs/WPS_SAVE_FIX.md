# WPS 保存功能修复说明

## 问题描述

在保存 WPS 文档时出现以下错误：
1. **405 错误**：`/v3/3rd/files/{file_id}/upload/address` 接口返回 HTTP 405（方法不允许）
2. **事件监听错误**：`Invalid event name: save` 和 `Invalid event name: close`

## 修复内容

### 1. 修复 upload/address 接口的 HTTP 方法

**问题**：WPS 在保存文件时会调用 `/v3/3rd/files/{file_id}/upload/address` 接口获取上传地址，但接口返回 405（方法不允许），说明 HTTP 方法不正确。

**修复**：根据 WPS 官方文档，该接口应使用 **POST** 方法，而不是 GET。在 `WpsController.java` 中修复：

```java
/**
 * 获取上传地址（WPS 保存时调用）
 * POST /v3/3rd/files/{file_id}/upload/address
 * 
 * 说明：根据 WPS 官方文档，此接口使用 POST 方法
 */
@PostMapping("/files/{file_id}/upload/address")
public ResponseEntity<Map<String, Object>> getUploadAddress(@PathVariable("file_id") String fileId) {
    log.info("WPS callback: getUploadAddress (POST), fileId: {}", fileId);
    
    Map<String, Object> data = new HashMap<>();
    data.put("upload_url", wpsService.getCallbackBaseUrl() + "/api/files/" + fileId + "/upload");
    data.put("expires_in", 3600);
    
    Map<String, Object> result = new HashMap<>();
    result.put("code", 0);
    result.put("message", "");
    result.put("data", data);
    
    return ResponseEntity.ok(result);
}

/**
 * 获取上传地址（兼容 GET 方法，部分版本可能使用）
 * GET /v3/3rd/files/{file_id}/upload/address
 */
@GetMapping("/files/{file_id}/upload/address")
public ResponseEntity<Map<String, Object>> getUploadAddressGet(@PathVariable("file_id") String fileId) {
    // 复用 POST 方法的逻辑
    return getUploadAddress(fileId);
}
```

**关键修复点**：
- 主要接口使用 `@PostMapping`（POST 方法）
- 同时提供 GET 方法作为兼容（部分 WPS 版本可能使用 GET）
- **最重要**：返回字段名必须是 `url`，不是 `upload_url`，否则会出现"字段:url 不能为空"的错误

**修复后的代码**：
```java
Map<String, Object> data = new HashMap<>();
String uploadUrl = wpsService.getCallbackBaseUrl() + "/api/files/" + fileId + "/upload";
data.put("url", uploadUrl);  // 关键：字段名必须是 url，不是 upload_url
data.put("method", "PUT");   // 关键：必须指定上传方法，值必须是 "PUT" 或 "POST"
data.put("expires_in", 3600);
```

**重要说明**：
- `method` 字段的值必须与 `FileController` 中的上传接口使用的 HTTP 方法一致
- 当前 `FileController.uploadFile()` 使用 `@PutMapping`，所以 `method` 值为 `"PUT"`
- 如果将来改为 `@PostMapping`，则需要将 `method` 改为 `"POST"`

**位置**：`backend/src/main/java/com/checkba/controller/WpsController.java`

### 2. 修复 upload/prepare 接口返回格式和字段名

**问题**：
1. `upload/prepare` 接口返回格式不符合 WPS 要求的统一格式
2. 字段名使用了 `upload_url`，但 WPS 要求使用 `url`

**修复**：
```java
// 修复后
Map<String, Object> data = new HashMap<>();
String uploadUrl = wpsService.getCallbackBaseUrl() + "/api/files/" + fileId + "/upload";
data.put("url", uploadUrl);  // 关键：字段名必须是 url，不是 upload_url
data.put("expires_in", 3600);

Map<String, Object> result = new HashMap<>();
result.put("code", 0);
result.put("message", "");
result.put("data", data);
return ResponseEntity.ok(result);
```

**说明**：
- WPS 要求所有回调接口统一返回 `{ code, message, data }` 格式
- **关键**：`data` 中的字段名必须是 `url`，不是 `upload_url`（与 `download` 接口保持一致）

### 3. 移除无效的事件监听器

**问题**：组件中尝试监听 `save` 和 `close` 事件，但这些事件名称在 WPS SDK 中不存在，导致控制台报错：`Invalid event name: save` 和 `Invalid event name: close`。

**根本原因**：
根据 WPS 官方文档，保存和关闭事件是通过**后端回调接口** `/v3/3rd/notify` 接收的，而不是通过前端事件监听器。这些事件会在后端的 `WpsController.notify()` 方法中处理。

**修复**：移除无效的事件监听器：

```javascript
// 修复前（错误）：
this.instance.ApiEvent.AddApiEventListener('save', (data) => {
  // ...
})

this.instance.ApiEvent.AddApiEventListener('close', (data) => {
  // ...
})

// 修复后（正确）：
// 注意：WPS 的保存和关闭事件是通过后端回调接口 /v3/3rd/notify 接收的
// 而不是通过前端事件监听器。这些事件会在后端 WpsController.notify() 方法中处理
// 如果需要在前端感知保存/关闭，可以通过轮询后端状态或使用其他机制
```

**说明**：
- WPS SDK 不支持 `save` 和 `close` 前端事件
- 保存和关闭通知通过后端 `/v3/3rd/notify` 接口接收
- 后端已实现该接口，可以处理 `file.save` 和 `file.close` 事件

**位置**：`frontend/src/components/WpsEditor.vue`

## 修复逻辑总结

### 保存流程

1. **用户点击保存** → WPS SDK 触发保存流程
2. **获取上传地址** → WPS 调用 `/v3/3rd/files/{file_id}/upload/address`
3. **上传文件** → WPS 使用获取到的 `upload_url` 上传文件内容
4. **保存完成** → 触发 `save` 事件

### 接口调用链（三段式保存流程）

```
用户保存
  ↓
1. WPS SDK 调用: POST /v3/3rd/files/{file_id}/upload/address
   后端返回: { code: 0, data: { url: "...", method: "PUT", expires_in: 3600 } }
  ↓
2. WPS SDK 使用 url 上传文件: PUT /api/files/{fileId}/upload
   FileController 接收文件并保存到本地
   返回成功: { code: 0, message: "", data: {} }
  ↓
3. WPS SDK 调用: POST /v3/3rd/files/{file_id}/upload/complete
   后端确认上传完成
   返回成功: { code: 0, message: "", data: { id, name, version, ... } }
```

### 关键接口

1. **`POST /v3/3rd/files/{file_id}/upload/address`**（修复方法、字段名和 method 字段）
   - 用途：获取文件上传地址
   - HTTP 方法：**POST**（根据官方文档）
   - 返回：`{ code: 0, data: { url, method, expires_in } }`
   - **关键字段**：
     - `url`：上传地址（不是 `upload_url`）
     - `method`：上传方法，必须是 `"PUT"` 或 `"POST"`（必须与 `FileController` 中的上传接口方法一致）
     - `expires_in`：有效期（秒）
   - 兼容：同时提供 GET 方法作为兼容

2. **`GET /v3/3rd/files/{file_id}/upload/prepare`**（已修复）
   - 用途：准备上传（三阶段保存的第一步）
   - 返回：`{ code: 0, data: { upload_url, expires_in } }`

3. **`PUT /api/files/{fileId}/upload`**（已存在）
   - 用途：实际接收文件内容并保存
   - 位置：`FileController.java`

4. **`POST /v3/3rd/files/{file_id}/upload/complete`**（新增）
   - 用途：完成上传（三段式保存的最后一步）
   - 返回：`{ code: 0, message: "", data: { id, name, version, ... } }`
   - 说明：在文件上传完成后被调用，用于确认上传完成。**必须返回完整的文件元信息**，特别是 `id` 字段必须存在。

## 验证方法

1. **测试保存功能**：
   - 在编辑器中编辑文档
   - 点击保存按钮
   - 检查是否出现保存成功提示

2. **检查后端日志**：
   ```bash
   tail -f backend/app.log | grep -E "(upload|save)"
   ```
   - 应该看到 `getUploadAddress` 和 `uploadFile` 的日志

3. **检查文件是否保存**：
   ```bash
   ls -lh ../data/wps-files/
   ```
   - 应该能看到保存的文件

## 注意事项

1. **文件存储位置**：
   - 文件保存在 `../data/wps-files/{fileId}.docx`
   - 如果目录不存在，会自动创建

2. **事件名称**：
   - WPS SDK 的事件名称可能因版本而异
   - 如果 `save` 和 `close` 事件仍然无效，需要查看 WPS SDK 文档确认正确的事件名称

3. **错误处理**：
   - 事件监听器已使用 try-catch 包裹，避免错误事件名称导致组件崩溃
   - 如果事件监听失败，会在控制台输出警告，但不影响编辑器正常使用

## 相关文件

- `backend/src/main/java/com/checkba/controller/WpsController.java` - 回调接口
- `backend/src/main/java/com/checkba/controller/FileController.java` - 文件上传接口
- `frontend/src/components/WpsEditor.vue` - WPS 编辑器组件

---

**修复日期**：2025-12-10  
**修复者**：开发团队

