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

重新生成：`msoffcrypto-tool -e -p awd-0414 <明文> <输出>`。明文需大于 4 KB（msoffcrypto 5.x 写小于 4 KB 的
EncryptedPackage 时复合文档结构有误，olefile 读回的是 EncryptionInfo 的内容）。
