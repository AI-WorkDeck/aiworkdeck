# Contributing / 参与贡献

This is an unofficial DeepSeek Harness plugin. Contributions that make assessments more traceable, usable, and reproducible are welcome. Please open an issue describing the user problem before a substantial change.

这是非官方 DeepSeek Harness 插件。欢迎改进评估的可追溯性、易用性与可复现性；较大改动请先用 Issue 说明用户问题。

## Scope and review / 范围与审查

- Keep facts, source references, professional decisions, and delivery state distinct. Do not turn a model suggestion into an automatic legal approval.
- Use synthetic fixtures. Do not submit client assessments, personal data, API keys, access tokens, or proprietary documents to issues or pull requests.
- Describe the affected DSH version, profile, operating system, steps to reproduce, expected result, and observed result. Redact local paths and credentials from logs.
- Contributions to original plugin code and project-authored documentation on `main` are submitted under `AGPL-3.0-only`. The earlier `v0.3.11-beta.5` release remains Apache-2.0. The EDPB template and unofficial Chinese working translation have separate notices in [NOTICE](NOTICE); do not assume they are AGPL material.

请保持事实、材料来源、专业决定和交付状态的区分。测试只用合成材料；Issue 和 PR 不提交真实评估、个人数据、密钥或专有文档。报告问题时写明 DSH 版本、profile、系统、复现步骤和实际结果，并清除日志中的凭据及个人路径。

## Local checks / 本地核验

The JavaScript entry points need a current Node.js runtime. The bundled Skill needs Python 3.9+; document and PDF checks require the optional dependencies listed in [README.md](README.md). Run the focused public smoke checks from the repository root:

```sh
node --test test/plugin.test.mjs
node --test test/report-client.test.mjs test/report-summary.test.mjs
```

These commands cover only the named test files. State which checks you ran in a pull request, including any skipped checks and why. Report generation, DSH host integration, and cross-platform compatibility need separate evidence.

以上命令只覆盖所列测试文件。提交 PR 时请写明执行与未执行的检查及原因；报告生成、DSH 宿主集成和跨平台兼容性需要另行给出证据。
