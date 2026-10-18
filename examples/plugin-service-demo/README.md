# 宿主服务与连接示例

同步引入 SDK 1.6，演示设置、宿主 AI、项目搜索、自带服务、MCP 与权益查询。所有业务调用由用户点击触发；没有填写凭据的 iframe 表单。

`service.example.invalid` 是保留的无效示例地址。先将 manifest 的连接、固定操作路径及订阅地址换成自己的 HTTPS 服务。Bearer 凭据在宿主可信 UI 输入；OAuth 连接改声明 `oauth2` 与授权端点，密钥不交给插件。MCP 只列出宿主允许的服务，不承诺兼容整个 VS Code 插件生态。服务商订阅状态操作应返回 `{active:boolean,plan?:string}`。

仓库根执行 `node scripts/plugin-dev.mjs validate examples/plugin-service-demo`，然后用 `package ... --out /tmp/plugin-service-demo.zip` 本地打包。开发安装需要先把源码导入宿主项目，再显式传 project/folder ID；命令见 SDK README。旧宿主返回 `unknown_method` 时显示升级提示。

测试只验证桥协议与本地工具链；示例占位服务、OAuth 供应商、真实 MCP 和付费订阅须另行验收。
