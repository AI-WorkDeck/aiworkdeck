<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 设了打开密码的 OOXML 夹具（O14）

密码一律 `awd-0414`。由独立实现 msoffcrypto-tool（Agile，AES-256 / SHA-512，spinCount 100000）加密，
不是我们自己的 `officeEncryption.js` 写出来的——测试拿它校验解密，避免「自己写自己读」。

| 文件 | 明文来源 |
|---|---|
| flexmark-table.docx | ../flexmark-table.docx |
| case-ledger.xlsx | scripts/eval/fixtures/case-ledger.xlsx |
| case-report.pptx | scripts/eval/fixtures/case-report.pptx |

重新生成：`msoffcrypto-tool -e -p awd-0414 <明文> <输出>`。明文需大于 4 KB：msoffcrypto-tool（5.x 起，2026-11 用 6.1.0 实测
仍然如此）加密后的 EncryptedPackage 流小于 4096 字节（复合文档迷你流的界限）时，写出的复合文档结构有误，
olefile 读回的 EncryptedPackage 实际是 EncryptionInfo 的内容（9 KB 的明文包则一切正常）。这是上游工具的问题，
不是 `officeEncryption.js` 的；夹具都已大于该界限，新增夹具请先用 olefile 读回核对。
