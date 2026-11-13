<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 设了打开密码的老二进制 Office 夹具（O14b）

供 `src/utils/legacyOfficeDecrypt.js` 的测试用：二进制 `.doc` / `.xls` / `.ppt` 的解密结果，逐流对照
msoffcrypto-tool 6.1.0 的输出（摘要写在 `tests/lowa-unit/legacy-office-decrypt.test.mjs` 里，CI 不需要 Python）。

| 文件 | 密码 | 来源 | 加密方式 |
|---|---|---|---|
| rc4cryptoapi_password.doc | `Password1234_` | msoffcrypto-tool 仓库 tests/inputs（MIT），真 Office 生成 | RC4 CryptoAPI |
| rc4cryptoapi_password.xls | `Password1234_` | 同上 | RC4 CryptoAPI |
| rc4cryptoapi_password.ppt | `Password1234_` | 同上 | RC4 CryptoAPI |
| xor_password_123456789012345.xls | `123456789012345` | 同上 | Excel XOR 混淆 |
| plain.ppt | （无） | 同上 | 未加密，检测的反例 |
| contract.doc | `awd-0414` | LibreOffice 26.2 Basic 宏 storeToURL（Password 参数） | Office 97 RC4（版本 1.1） |
| case-ledger.xls | `awd-0414` | 同上（明文来自 scripts/eval/fixtures 的案件台账） | Office 97 RC4（版本 1.1） |

LibreOffice 不会写加密的 .ppt，所以 .ppt 只有 Office 生成的 CryptoAPI 一份。
