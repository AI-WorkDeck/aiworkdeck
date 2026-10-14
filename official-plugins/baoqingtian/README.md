<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 包晴天 · 案源与笔记

AI WorkDeck 的独立 Marketplace 插件。先打开一个项目，在插件中心安装并启用，再点击左侧「包晴天 · 案源与笔记」打开独立工作区。需要 AI WorkDeck 0.60.0 或更新版本，以及包晴天律师账号。

## 使用范围

- 浏览案源广场及详情，不自动抢案、联系客户或改变案源状态。
- 查看本人的平台笔记，区分草稿、公开和仅自己可见。
- 新建图文或视频笔记：图片 1–9 张，或一个视频加一张独立封面；修改已有笔记的标题与正文时保留原媒体。公开发布与删除需要明确确认。
- 登录使用包晴天官方 PC 端的手机号验证码接口。验证码由用户点击发送；若平台拒绝或要求进一步验证，原样遵守平台要求，不绕过验证。

包晴天账号与 AI WorkDeck 账号分别登录。会话仅保留在本机后端内存，并按 AI WorkDeck 用户隔离；退出插件登录或重启后端后需重新登录。插件不从其他应用提取登录状态。笔记保存到包晴天平台；未保存的编辑文本只在当前页面，关闭标签前请先保存。新增按平台流程先建立上传暂存记录，再上传媒体，最后回填资源并确认保存。业务草稿与上传暂存不同；仅拿到笔记编号不代表已保存。上传失败后留在当前页，使用「继续上传同一篇笔记」续传同一记录；创建响应丢失时使用「恢复同一次创建」，复用原操作标识核对，避免重复提交。后端重启或关闭页面可能丢失续传所需的本地文件，请勿在上传中关闭页面。

图片每张不超过 10 MiB，视频不超过 50 MiB；这些是插件的处理上限。上传的文件由用户在插件中主动选择，视频封面需单独选择。

`network` 用于直接访问包晴天服务及平台签发的腾讯云 COS 上传地址；`file_read` 仅用于公开宿主接口的当前项目成员校验，不读取或上传项目文件正文。工作区页面操作不主动调用模型，也不把案源或笔记上传到 Marketplace。工具桥仅供插件页面加密调用，不开放 AI 对话中的明文业务调用；登录信息、笔记与媒体分片不会以明文经过旧宿主的工具调试日志。数据处理说明见根目录 `legal/PRIVACY.md`。

## 构建与验证

```sh
./official-plugins/baoqingtian/build.sh
NODE_PATH=frontend/node_modules node --test official-plugins/baoqingtian/tests/web-*.mjs
```

构建产物在 `dist/baoqingtian-1.0.0.zip`。必须经过官网受理、扫描、审核与签名流程才可上架。构建成功不代表已上架；合成接口测试不代表真实账号业务联调通过。

## Sources and scope

This independently implemented plugin uses the existing Baoqingtian lawyer APIs. The upstream application repositories are read-only reference material; no upstream source code, credentials or private business records are distributed. Brand colors and component conventions follow the design system supplied by the project owner. The bundled SDK is copied unchanged from this repository's public plugin SDK.

The plugin is distributed independently from the desktop client. Publishing it does not require a desktop release or an upgrade of the user's client. Actual release and account verification evidence belongs in the delivery record.
