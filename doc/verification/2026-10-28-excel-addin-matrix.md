<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Excel desktop / Office / WPS audit — 2026-10-28

## Native Excel evidence reviewed at 08:20 UTC

The Mac Excel taskpane now has real native evidence. The parent operated Excel 16.114.1 on macOS and reports visually checking all four charts and closing/reopening the synthetic workbook. This audit independently read the taskpane receipts and the saved XLSX; it did not operate that UI or independently observe the close/reopen action.

- `native-excel-qa-first.json` records the first native failure at **08:04:53Z**: pivot creation reached a `PropertyNotLoaded` error while reading `Worksheet.name`. The fix explicitly loads `sheet.name` before the first `context.sync()` and before creating the pivot.
- `native-evidence.jsonl` records the second native failure at **08:10:09Z**: date-validation serial bounds were rejected by `DataValidation.rule`. Numeric date/time bounds now become constant formulas (`=45000`, `=0.25`); date strings and existing formulas remain unchanged.
- **08:11:22Z** records successful actual handlers, native readback, `file_save`, and `run complete`. **08:13:03Z** records readback after the parent’s UI close/reopen: formula results 8/16/22/15, header bold/fill, four named charts with types ColumnClustered/BarClustered/Line/Pie, `QA_Pivot`, and all seven validation types (List/WholeNumber/Decimal/Date/Time/TextLength/Custom).
- The saved artifact `/tmp/excel-1576-product-evidence/office-native-reopened.xlsx` passes ZIP integrity checking. Its OOXML contains four chart parts, one pivot-table part, D2:D5 formulas with cached results 8/16/22/15, and seven validation rules. Date bounds persist as 45000/50000 and time bounds as 0.25/0.75, with input/error prompt text present. This corroborates saved content, independently of the UI report.
- The two targeted regressions for worksheet-name loading and date/time constant formulas passed in this audit (2/2). Source review found the fixes appropriately scoped; no date-epoch or locale conversion is introduced.

This proves the isolated real `hostBridge.executeCommand` → Office.js → native Excel route for the basic suite and saved artifact. It does **not** prove a full model-generated AI conversation, backend authentication/dispatch, project-file create/open/PDF upload, WPS, or Word/PPT. The advanced suite initially failed its merge-range assertion at **08:18:13Z**. That historical failure is superseded only by the explicit later advanced persistence checks below; it is not erased from the evidence history.

Evidence files are local QA artifacts: `/tmp/awd-native-excel-qa-20261028/native-excel-qa-first.json` and `/tmp/awd-native-excel-qa-20261028/native-evidence.jsonl`. Sections below describing preparation or unavailable native evidence are historical stages; this section supersedes them only for the explicitly listed basic Excel checks.

Evidence is source inspection and Node handler tests unless explicitly stated otherwise. A matching tool name does not prove matching optional parameters or host persistence. Native coverage is limited to the explicitly reviewed checks above.

| Capability | Desktop sheet_* | Office/WPS implementation and distinction |
|---|---|---|
| Overview/read/select | overview/read_range/select_range | get_overview/get_range/select_range; formulas now returned alongside computed values; Office/WPS return a matrix while LOWA returns cell-address entries. Read limits differ and truncation must be respected. |
| Write/formulas | write_cells | set_values + set_formulas; full rectangular matrix and scalar preflight added before format writes. Host formula dialect differs; LOWA normalization must not be copied to Excel. |
| Append formatting | write_cells inheritFormat | Both already implement inheritance; earlier documentation claiming absent support is stale. 19 existing format tests cover Office/WPS proxies, not native round trips. |
| Search | sheet_search range/matchCase | Both adapters accept rangeAddress/matchCase; Office now limits values transfer to 5000 rows before loading. Truncated/scannedRows/totalRows expose coverage. |
| Font/number/border/size | format_cells/set_borders/set_row_col | format_cells/set_borders/edit_rows_cols set_width/set_height. Width units are host-specific; verify rendered output, not equal raw numbers. |
| Structure/merge/sort/freeze/filter | manage_sheets/edit_rows_cols/merge_cells/sort_range/freeze_panes/set_autofilter | Corresponding handlers exist; host undo and loss of merged-cell contents require separate checks. |
| Conditional formats | conditional_format | Both have handlers, but parameter-level parity and persisted appearance require further validation. |
| Validation | list/wholeNumber/decimal/date/time/textLength/custom; 8 comparisons | Added decimal/time/textLength/custom and all comparisons, retaining existing operator aliases. Between/notBetween require both bounds before replacing existing rules. Prompt/error-message fields are forwarded on both adapters; Office shapes are officially documented, WPS properties require native verification. |
| Charts | column/bar/line/pie, title, optional name | Same four types supported by Office/WPS; no desktop area/scatter/doughnut support to copy. WPS now resolves source before creating chart. Optional name is now forwarded to both hosts; location remains host-specific. |
| Named ranges/protection/grouping | define_name/protect_sheet/group_rows_cols | Corresponding handlers exist. Password/error/quoted sheet-name and grouping behavior require native verification. |
| Pivot | add_pivot_table | Both now read source headers and validate requested fields before creation. WPS supports quoted cross-sheet destination and escaped source sheet names. Header validation does not prove data or placement validity; host failures after creation still need truthful partial-result handling. |
| Comments | add/get/delete_comment | Corresponding handlers exist; Office additionally has reply/resolve where supported; WPS legacy notes differ from threaded comments. |
| File creation/open/export | project file tools + LOWA host | Native file bridge implemented; copy/persistence semantics and tested scope in the current lifecycle matrix below. |

## Local checks

`node --test office-addin/taskpane/lib/wpsEtHandlers.test.js office-addin/taskpane/lib/excelFormatHosts.test.js`: 79 passed after translation-key migration and matrix/source/pivot/validation changes. New tests verify invalid matrix rejection before workbook access, invalid chart source before creation, quoted cross-sheet pivot target, Office missing-field rejection before creation, and added validation rules/bounds. No real Office/WPS call is made by these tests.

## Native host availability

Microsoft Excel/Word/PowerPoint on this Mac have subsequently completed the native checks linked below. The earlier suspended-VM/licensing finding was historical: Windows 11 is now running with restored Standard licensing, but `prlctl exec` still requires Pro and current CUA input has not operated WPS reliably. An isolated JS add-in QA package is prepared and served only on private VM adapter 10.211.55.2; registration/execution awaits user interaction. No new WPS native handler or saved-document result is established by preparing that package. COM probes and mocked handlers are not substitutes.

## API references

- [Excel validation rule, ExcelApi 1.8](https://learn.microsoft.com/en-us/javascript/api/excel/excel.datavalidationrule): decimal/time/textLength/custom field shapes.
- [WPS validation enums](https://open.wps.cn/documents/app-integration-dev/docs-center/online-preview-edit/client/Enum/Excel): validation type values 1–7. This enum reference alone does not establish a specific native JSAPI call signature; existing native adapter calling convention is retained.
- [WPS chart enums](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/kso/enum/XlChartType).

## Current file lifecycle implementation and evidence

The initial audit found missing native create/open/save/PDF commands. Those findings drove the implemented `fileOperations.js` bridge and are no longer current capability gaps. The authoritative current host matrix and native evidence are in [file operation audit](2026-10-28-file-parity-audit.md).

| Action | Current add-in behavior | Verified scope / remaining distinction |
|---|---|---|
| Create Word / Excel / PPT | `office_file_create` creates a blank document in the current native host | Native create checks exist; this is not creation of a persisted project file. WPS `Collection.Add` remains native-unverified. |
| Open project file | `office_file_open` permission-checks project file and opens a new native copy | Office Word saved copy 38 assertions; fixed PPT copy 48 assertions and native border metadata pass. Excel native copied metadata pass; no independent full copied-XLSX package comparison claimed here. WPS temporary-copy path remains native-unverified. |
| Save current file | `office_file_save`: Word saved documents use basic save, never-saved use WordApi1.5 Prompt; Excel uses Prompt | Word/Excel existing-file save and reopen verified; Word first-save cancellation verified. PowerPoint public original-save API unavailable: hidden/rejected, not a successful cancel test. Native Save As used for its artifact evidence. |
| PDF export/upload | `office_file_export_pdf` exports native bytes then creates/uploads a real project file | All three Mac Office hosts independently downloaded, hashed, rendered and checked; WPS export/upload remains native-unverified. Print layout limitations are documented. |
| Snapshot/archive | Separate capture of compressed document or WPS saved disk file | Snapshot is neither save nor PDF export, and WPS disk reads do not establish that unsaved edits are persisted. |

Project-backed desktop editing and native copy editing remain distinct: no automatic replacement of the project source by native edits. Actual command routing, source identity guards, partial upload failures and native evidence are detailed in the linked audit. Real-model Excel coverage is recorded separately in [real AI native Excel](2026-10-28-real-ai-native-excel.md), and does not establish the complete signed-in product-chat path.

## Actual Office taskpane test entry

The repository development manifest points to `https://localhost:3000/taskpane.html`. Vite reads `~/.office-addin-dev-certs/localhost.key` and `.crt`; without them it falls back to HTTP, which cannot validate native Office loading. The documented Mac entry is the per-application `Data/Documents/wef/` sideload directory, then Home/Add-ins to activate the add-in. PowerPoint ribbon absence alone is not failure (README documents a prior native observation). A browser opening this URL without Office is UI-only testing.

For an actual loaded native taskpane, `await import('/taskpane/lib/officeExecutor.js')` exposes `executeOfficeCommand(command,args)`; calling that export inside the Office webview exercises the host guard, command dispatch, real Office.js and returned errors. This is a viable dev-server entry, not a claim it has been run. Use a new synthetic document; verify cell values/formulas, all four charts, pivot/validation/formatting, then save/reopen and inspect artifacts. Driving equivalent COM/AppleScript APIs does not exercise this JS route. WPS must separately use its actual taskpane and wpsAdapter dispatch.

### Subsequent implementation (same work session)

The initial lifecycle gaps above now have `office_file_create`, `office_file_save`, `office_file_export_pdf`, and `office_file_open` backend tools plus shared `fileOperations.js`. Open accepts a project file ID, checks current-project ownership, native extension, 50 MB bounded bytes and ZIP signature, and forwards a host-tagged base64 payload. It opens a **copy**, not the project original. WPS uses a verified temporary-file write and requires Save As for durable ownership; host API availability is checked at runtime. Microsoft PowerPoint save is hidden; WPS PowerPoint save remains available. Create is host-local blank creation, not project persistence. PDF upload must return a real project file ID. These source and mocked-handler checks still do not constitute native Office/WPS acceptance. The parent owns final dispatch/UI integration and native saved/reopened artifacts.

## Follow-up gap review and harness scope

The isolated native Excel page currently exercises values/formulas, font/fill/number formatting, all four supported chart types, pivot creation, all seven data-validation types, native readback, and host save. It does **not** exercise conditional formatting, sorting/filtering, names/protection/grouping, append-format inheritance, comments, or create/open/PDF project upload. Those rows remain separate native acceptance work; preparing this page is not a passing test.

A further source review fixed two concrete issues: WPS named ranges now escape apostrophes in worksheet names (`O'Brien` becomes `='O''Brien'!...`); both Office and WPS reject unknown conditional-format actions before clearing existing rules. Focused Excel tests: 90 passed. These are mocked host-contract tests. `excelConditionalActionInvalid` and the coordinated Word/PPT additions have all 20 translations; `frontend npm run check:locales` passed.

Independent Word/PPT QA page and acceptance plan are prepared at `/tmp/awd-native-word-ppt-qa-20261028/`, without installing them or changing the running Excel page/service. Auto-open investigation produced a new synthetic workbook and candidate QA manifest in `/tmp/awd-native-autoopen-20261028/`; XML/ZIP/schema checks pass, and the parent subsequently loaded the real Excel taskpane; the native receipts reviewed above establish the basic Excel route, not Word/PPT or WPS. The official auto-open feature supports Mac and sideloaded add-ins; the development-catalog reference must still be verified on this Mac build.

## Advanced native Excel persistence review (08:33:40 UTC)

This audit independently read the **08:33:40.097Z `VERIFY PASS`** receipt from the real `native-excel-advanced` suite and inspected `/tmp/excel-1576-product-evidence/office-native-advanced-reopened.xlsx` (ZIP integrity passes). The parent performed the native save/close/reopen; the audit verified the resulting receipt and file, not the UI action itself.

The reopened native readback verifies sorted complete records (keys 1/2/3, amounts 10/20/30, formula results 20/40/60), relative formulas `=B2*2` through `=B4*2`, attached row fills, appended-row inheritance (0.000, bold, #D9EAF7), a GreaterThan conditional rule with bound 15, the named range, enabled AutoFilter, the final unprotected state, preserved row/column markers, and collapsed row/column groups. The OOXML independently corroborates the sorted formulas/cached values, appended row and style references, `AWD_QA_Advanced_Numbers` at B2:B4, AutoFilter A1:D4, conditional formatting B2:B4, J12/K12 markers, hidden grouped rows 22–24 and columns 14–16, and no remaining sheet-protection element.

This extends native persistence evidence to those advanced outcomes. A final unprotected state alone does not prove protection blocked an edit; no comment parts or frozen-pane elements are present in this saved artifact. The `VERIFY PASS` payload does not independently assert merged-area geometry. These absent checks must not be inferred from the suite name. Full AI conversation/backend routing, project-file lifecycle, other platforms, and WPS remain distinct acceptance items.
