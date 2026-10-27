# NSIS KnownFolder 补丁来源

`patch-nsis-known-folder.js` 及其测试中的 NSIS 模板片段来源于 [electron-builder](https://github.com/electron-userland/electron-builder)，MIT 许可；完整许可声明保留在相关源文件中。

- 被修版本：app-builder-lib 24.13.3，`templates/nsis/multiUser.nsh` 的 `setInstallModePerUser`。
- 上游修复：[PR #9769](https://github.com/electron-userland/electron-builder/pull/9769)，固定提交 `a356198ec7c54c7795659342bff36d9a5162cd93`，文件 `packages/app-builder-lib/templates/nsis/multiUser.nsh`。
- 本地改动：通过 postinstall 精确回移有界复制、寄存器保护和 COM 内存释放；已有安装目录、回退目录及 `/D` 行为保持。未知模板结构阻止构建。
- `test-nsis-known-folder.ps1` 的保护页复现方法参考同一 PR 中 Adam Gauthier 的复现；本地适配为抽取实际已修模板的复制块，另验真实 KnownFolder 查询。故意崩溃的负例只在一次性 Windows Actions runner 执行。
- 验证：JavaScript 补丁与异常结构测试、Windows 保护页负例/修复正例/API 查询，以及真实安装器安装→重装→卸载门。Mac 编译成功不等于 Windows 运行验证。
- 升级 electron-builder 时先核对上游模板；已包含修复后移除本地补丁及 postinstall 接线，保留必要的行为回归。
