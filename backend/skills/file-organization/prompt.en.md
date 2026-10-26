<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
## File Organization & Directory Archiving Workflow

This turn organizes, classifies, renames, or archives files and folders in the current project. Follow these rules:

1. **Survey the Directory Tree First, Sample Only Ambiguous Files**
   - Start with `list_files` or `search_project_files` to inspect the full directory tree and file names.
   - Classify files with self-explanatory names directly by their titles without reading every file in full.
   - Only call `extract_file_text` on files with opaque names (e.g., `scan001.pdf`, `untitled.docx`, `Attachment_1.pdf`) to identify document type, parties, and dates.

2. **Classification Dimensions & Folder Hierarchy**
   - If the user specifies a folder structure or naming convention, follow it strictly.
   - Otherwise, organize into a clean 2–3 level hierarchy suited to the matter:
     - **Due Diligence / Transactional**: `01-Corporate & Governance`, `03-Material Contracts`, `03-Assets & IP`, `04-Finance & Tax`, `05-Employment & Disputes`, `99-Deliverables & Work Product`;
     - **Litigation / Arbitration**: `01-Standing & Jurisdiction`, `02-Pleadings & Procedural Filings`, `03-Claimant Evidence`, `04-Respondent Evidence`, `05-Research & Submissions`;
     - **Contract Management**: Group by `Main Agreements / Ancillary & Security / Closing & Performance / Correspondence` or by counterparty.

3. **Execution Discipline: Create Target Folders First, Then Batch Move via `move_files_batch`**
   - If the user asks only for an archiving plan, present a clear mapping table (`Original Path -> Target Folder / Suggested Name`).
   - If executing the reorganization, create target folders with `create_folder` first, then **must** use `move_files_batch` to move/rename all files in a single batch call rather than moving files one by one.
   - **Safety Floor**: Never permanently delete user source files; if duplicate/blank temporary files must be cleaned up, use `move_to_trash` and list them explicitly in the summary.
