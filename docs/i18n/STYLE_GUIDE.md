<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# AI WorkDeck 20-Locale Translation Style Guide

This guide defines the cross-surface localization rules for AI WorkDeck (`frontend/`, `desktop/`, `office-addin/`, `backend/`, `official-plugins/`, Website, and Mobile clients) across all 20 canonical locales (`dev-board#1477`). All translation subagents and reviewers must follow this document alongside [`glossary.json`](./glossary.json).

---

## 1. Canonical Locales & Register / Formality Rules

AI WorkDeck is a professional legal AI workbench used by lawyers, partners, in-house counsel, and paralegals. Copy must sound **precise, trustworthy, concise, and natural to legal & enterprise software**—never overly casual, slangy, or robotic.

| Canonical Code | Website Slug | Mobile Code | Native Name | Dir | Formality / Second-Person Register & Key Conventions |
|---|---|---|---|---|---|
| `zh-CN` | `zh` | `zh-Hans` | 简体中文 | `ltr` | Standard Mainland China legal & software terminology. Use `您` in formal account/billing/legal notices; omit pronoun or use `你` in compact UI prompts. |
| `zh-TW` | `zh-hant` | `zh-Hant` | 繁體中文 | `ltr` | Taiwan Traditional Chinese vocabulary and legal conventions (e.g., `專案`, `外掛`, `設定`, `儲存`, `契約`, `委任人`, `智慧財產權`), not raw character-by-character conversion. |
| `en-US` | `en` | `en` | English | `ltr` | American English spelling and legal terminology. Use Title Case for primary navigation, menu items, and dialog titles; Sentence case for body text, descriptions, and toasts. |
| `ja-JP` | `ja` | `ja` | 日本語 | `ltr` | Polite Desu/Masu (`です・ます`) for sentences, tooltips, and error messages; concise noun phrases (体言止め) for buttons, tabs, and labels (e.g., `保存`, `契約書レビュー`). |
| `ko-KR` | `ko` | `ko` | 한국어 | `ltr` | Polite formal `해요체` or `하십시오체` (`~습니다`/`~세요`) for sentences and notifications; concise noun forms for buttons and menu labels (e.g., `저장`, `삭제`, `사건`). |
| `th-TH` | `th` | `th` | ไทย | `ltr` | Polite professional Thai. Omit conversational particles (`ครับ/ค่ะ`) in compact UI buttons/labels; use `คุณ` when addressing the user in sentences. No spaces between words inside a clause. |
| `ms-MY` | `ms` | `ms` | Bahasa Melayu | `ltr` | Standard Malaysian Malay (`Bahasa Melayu`). Use `anda` for "you". Keep established English technical/legal loanwords in parentheses only when clarification is needed. |
| `id-ID` | `id` | `id` | Bahasa Indonesia | `ltr` | Formal Indonesian (`Bahasa Indonesia Baku`). Always use capitalized `Anda` for "you". Use Indonesian legal terms (`Perkara`, `Penggugat`, `Tergugat`, `Uji Tuntas`). |
| `vi-VN` | `vi` | `vi` | Tiếng Việt | `ltr` | Professional neutral Vietnamese. Use `bạn` when addressing the user in UI messages. Sentence case for buttons and headings (only capitalize the first word and proper nouns). |
| `fr-FR` | `fr` | `fr` | Français | `ltr` | Formal `vous` everywhere. Use infinitive verbs for action buttons (`Enregistrer`, `Supprimer`, `Se connecter`). Sentence case for titles and buttons. |
| `de-DE` | `de` | `de` | Deutsch | `ltr` | Formal `Sie` (`Ihr`, `Ihnen`) everywhere. Use infinitive verbs for buttons (`Speichern`, `Löschen`, `Anmelden`) and standard German compound capitalization. |
| `es-ES` | `es` | `es` | Español | `ltr` | Peninsular/Pan-Hispanic professional Spanish (`es-ES`). Use formal `usted` in legal/billing notices and neutral second-person or infinitive forms (`Guardar`, `Eliminar`) in UI controls. |
| `pt-BR` | `pt` | `pt-BR` | Português (Brasil) | `ltr` | Brazilian Portuguese (`você`). Use infinitive verbs for buttons (`Salvar`, `Excluir`, `Entrar`) and Brazilian legal terminology (`Caso`, `Autor`, `Réu`, `Procuração`). |
| `it-IT` | `it` | `it` | Italiano | `ltr` | Professional Italian (formal `Lei` or impersonal constructions in notices; 2nd-person singular imperative or noun/infinitive in compact UI buttons per Apple/Microsoft Italian conventions: `Salva`, `Elimina`, `Accedi`). |
| `ru-RU` | `ru` | `ru` | Русский | `ltr` | Formal `Вы` (lowercase `вы` in standard UI sentences) and infinitive verbs for actions (`Сохранить`, `Удалить`, `Войти`) or verbal nouns for process states (`Загрузка…`). |
| `el-GR` | `el` | `el` | Ελληνικά | `ltr` | Formal plural (`εσείς` / 2nd-person plural verbs) in sentences; verbal nouns for buttons and actions (`Αποθήκευση`, `Διαγραφή`, `Σύνδεση`). Never omit Greek tonos accents. |
| `tr-TR` | `tr` | `tr` | Türkçe | `ltr` | Formal `siz` (`-iniz`/`-unuz`) for messages and imperative/concise forms for buttons (`Kaydet`, `Sil`, `Giriş Yap`). Pay strict attention to dotted/dotless `İ/i` vs `I/ı`. |
| `nl-NL` | `nl` | `nl` | Nederlands | `ltr` | Polite `u`/`uw` in account, billing, and legal contexts; infinitive verbs for buttons (`Opslaan`, `Verwijderen`, `Inloggen`). |
| `hi-IN` | `hi` | `hi` | हिन्दी | `ltr` | Formal `आप` (`aap`) in Devanagari script. Use established Hindi legal vocabulary (`वादी`, `प्रतिवादी`, `साक्ष्य`, `न्यायालय`) while retaining widely understood transliterated software terms (`प्रोजेक्ट`, `फ़ोल्डर`, `प्लगइन`) where natural. |
| `ar-SA` | `ar` | `ar` | العربية | **`rtl`** | Modern Standard Arabic (الفصحى) suitable for legal professionals across MENA. Use Verbal Nouns (المصدر) for UI buttons (`حفظ`, `حذف`, `تسجيل الدخول`) and formal second-person address in sentences. |

---

## 2. Placeholder & Formatting Preservation Rules

1. **Named Placeholders (`{var}`)**:
   - Preserve exact placeholder names and braces: `{count}`, `{name}`, `{names}`, `{status}`, `{percent}`, `{version}`, `{year}`, `{month}`, `{day}`, `{time}`.
   - **Never** translate the identifier inside `{...}` (e.g., `{count}` must remain `{count}`, never `{nombre}` or `{عدد}`).
   - **Never** insert spaces inside braces (`{ count }` is invalid).
   - Reorder placeholders freely to match the natural grammar of the target language.
2. **Positional & Printf Placeholders (`{0}`, `{1}`, `%s`, `%d`)**:
   - In backend `.properties` or native client strings, keep `{0}`, `{1}`, `%s`, `%d` intact.
   - In Java `.properties` files using `MessageFormat`, remember that a literal single quote `'` in languages like `fr-FR` (`d'utilisation`, `l'application`) or `it-IT` (`d'interesse`) must be escaped as `''` **only** when the string is processed by `MessageFormat` (i.e., contains `{0}`). For plain key-value strings without `{0}`, verify how the caller reads the property.
3. **HTML, Markdown & Escape Sequences**:
   - Preserve inline tags, Markdown markers (`**bold**`, `[link](url)`), and line breaks (`\n`) exactly.
   - Never leak Simplified Chinese characters (`[\u4e00-\u9fff]`) into any non-CJK locale (`en-US`, `th-TH`, `ms-MY`, `id-ID`, `vi-VN`, `fr-FR`, `de-DE`, `es-ES`, `pt-BR`, `it-IT`, `ru-RU`, `el-GR`, `tr-TR`, `nl-NL`, `hi-IN`, `ar-SA`). Automated CI gates fail on CJK leakage.

---

## 3. Punctuation & Typography Rules

- **Ellipsis (`…`)**: Use the single Unicode ellipsis character `…` (`U+2026`) for loading/in-progress states (`Loading…`, `Chargement…`, `جاري التحميل…`).
- **Quotation Marks**:
  - `zh-CN`: `“…”` or `「…」` (match surrounding file style)
  - `zh-TW` / `ja-JP`: `「…」`
  - `en-US` / `ko-KR` / `th-TH` / `ms-MY` / `id-ID` / `vi-VN` / `pt-BR` / `tr-TR` / `nl-NL` / `hi-IN`: `"…"` or `“…”`
  - `fr-FR`: `« … »` (with non-breaking space) or `"…"` in compact JSON strings
  - `de-DE`: `„…“` or `"…"`
  - `es-ES` / `it-IT` / `ru-RU` / `el-GR`: `«…»` or `"…"`
- **French (`fr-FR`) Spacing**: Before `:`, `;`, `!`, `?`, use a space (` :`, ` ?`).
- **Spanish (`es-ES`) & Greek (`el-GR`)**:
  - `es-ES`: Always include opening `¿` and `¡` for questions and exclamations.
  - `el-GR`: Use the Greek question mark `;` (`U+003B` / `U+037E`), never `?`.
- **Hindi (`hi-IN`) & Arabic (`ar-SA`)**:
  - `hi-IN`: Use Devanagari Danda `।` (`U+0964`) at the end of full declarative sentences; do not add `।` to short button labels or titles.
  - `ar-SA`: Use Arabic comma `،` (`U+060C`), Arabic semicolon `؛` (`U+061B`), and Arabic question mark `؟` (`U+061F`).

---

## 4. Do-Not-Translate (DNT) List

Never translate or alter the casing/spelling of the following brand names, product identifiers, file formats, and internal protocol tokens:

- **Brand & Product Tiers**: `AI WorkDeck`, `WorkDeck`, `Pro`
- **Third-Party & Ecosystem Names**: `Microsoft Office`, `Word`, `Excel`, `PowerPoint`, `WPS`, `LibreOffice`, `Git`, `GitHub`, `macOS`, `Windows`, `iOS`, `Android`, `HarmonyOS`, `WeChat` (may localize display name where appropriate, e.g., `微信` in Chinese)
- **Technical Acronyms & File Formats**: `AI`, `OCR`, `PDF`, `DOCX`, `XLSX`, `PPTX`, `Markdown`, `JSON`, `CSV`, `HTML`, `HTTP`, `HTTPS`, `SSE`, `API`, `URL`, `AGPL-3.0-or-later`, `SPDX`
- **Internal Code & Wire Contracts (NEVER touch in code)**: `com.checkba.*`, `--awd-*`, `checkba://`, `X-AWD-*`, `X-App-Language`, `X-Source-Code`, `awd: 1`, `__ai_anchor_*`, `doc_*`

---

## 5. Right-to-Left (RTL) Rules for Arabic (`ar-SA`)

`ar-SA` is the only RTL locale (`dir="rtl"`) in the 20-locale matrix. Follow these rules strictly:

1. **Natural Logical Order**: Write Arabic strings in standard logical Unicode order. Do not manually reverse characters or words; the browser/client layout engine handles bidirectional rendering via `dir="rtl"`.
2. **Mixed LTR Tokens (`AI WorkDeck`, `{version}`, URLs, HTTP codes)**:
   - Keep English brand names (`AI WorkDeck`, `Office`, `OCR`), placeholders (`{count}`, `{name}`), and version numbers (`v1.2.0`) in their original Latin characters.
   - If a Latin token or placeholder at the start/end of an Arabic sentence causes punctuation (`:`,`!`,`...`) to jump to the wrong side, wrap the token or isolate direction at the UI component level rather than hardcoding visual hacks.
3. **Numerals & Dates**:
   - Use standard Western Arabic numerals (`0-9`) for version numbers, HTTP status codes, counts (`{count}`), and ISO-style dates (`{year}-{month}-{day} {time}`) so they remain consistent with system logs and legal citations.
4. **Directional Arrows in Text**:
   - Avoid hardcoding directional arrows (`→` / `▸`) inside translated strings when possible; if an inline arrow indicates progression in `ar-SA`, use `←` or `◂` so it points left in RTL flow.

---

## 6. Legal-Document Reference Disclaimer (All 20 Locales)

All translated legal documents (Privacy Policy and Terms of Service) outside the authoritative Chinese (`zh-CN`) and English (`en-US`) versions must display the following disclaimer banner at the top of the document. Use the exact string below for each locale:

| Canonical Code | Exact Disclaimer Text |
|---|---|
| `zh-CN` | 本文件以中文及英文版本为准；其他语言译本仅供参考。 |
| `zh-TW` | 本文件以中文及英文版本為準；本翻譯版本僅供參考，如有歧義概以中英文正本為準。 |
| `en-US` | The Chinese and English versions of this document prevail; translations into other languages are provided for reference only. |
| `ja-JP` | 本規約・ポリシーは中国語版および英語版を正文とし、本翻訳は参考のためにのみ提供されます。内容に相違がある場合は、中国語版または英語版が優先されます。 |
| `ko-KR` | 본 문서의 정본은 중국어판 및 영어판이며, 본 번역본은 참고용으로만 제공됩니다. 해석상 차이가 있는 경우 중국어판 또는 영어판이 우선합니다. |
| `th-TH` | เอกสารฉบับภาษาจีนและภาษาอังกฤษถือเป็นฉบับที่มีผลบังคับใช้ คำแปลฉบับนี้จัดทำขึ้นเพื่อใช้เป็นข้อมูลอ้างอิงเท่านั้น |
| `ms-MY` | Versi Bahasa Cina dan Bahasa Inggeris dokumen ini adalah muktamad; terjemahan ini disediakan untuk tujuan rujukan sahaja. |
| `id-ID` | Versi bahasa Mandarin dan bahasa Inggris dari dokumen ini yang berlaku; terjemahan ini disediakan hanya sebagai referensi. |
| `vi-VN` | Phiên bản tiếng Trung và tiếng Anh của tài liệu này có giá trị ưu tiên áp dụng; bản dịch này chỉ mang tính chất tham khảo. |
| `fr-FR` | Les versions chinoise et anglaise du présent document font foi ; cette traduction est fournie à titre purement indicatif. |
| `de-DE` | Maßgeblich sind die chinesische und die englische Fassung dieses Dokuments; diese Übersetzung dient ausschließlich zu Referenzzwecken. |
| `es-ES` | Prevalecen las versiones en chino e inglés de este documento; la presente traducción se facilita únicamente a título informativo. |
| `pt-BR` | As versões em chinês e inglês deste documento prevalecem; esta tradução é fornecida apenas para fins de referência. |
| `it-IT` | Fanno fede le versioni in lingua cinese e inglese del presente documento; questa traduzione è fornita esclusivamente a scopo di riferimento. |
| `ru-RU` | Преимущественную силу имеют версии настоящего документа на китайском и английском языках; данный перевод предоставляется исключительно в справочных целях. |
| `el-GR` | Υπερισχύουν οι εκδόσεις του παρόντος εγγράφου στην κινεζική και την αγγλική γλώσσα· η παρούσα μετάφραση παρέχεται αποκλειστικά για σκοπούς αναφοράς. |
| `tr-TR` | Bu belgenin Çince ve İngilizce nüshaları geçerlidir; bu çeviri yalnızca bilgi ve referans amacıyla sunulmuştur. |
| `nl-NL` | De Chinese en Engelse versies van dit document zijn bindend; deze vertaling wordt uitsluitend ter referentie verstrekt. |
| `hi-IN` | इस दस्तावेज़ के चीनी और अंग्रेज़ी संस्करण ही मान्य एवं प्रभावी होंगे; यह अनुवाद केवल संदर्भ के लिए प्रदान किया गया है। |
| `ar-SA` | تسود النسختان الصينية والإنجليزية من هذه الوثيقة؛ وتُقدَّم هذه الترجمة على سبيل الاسترشاد والمرجع فحسب. |
