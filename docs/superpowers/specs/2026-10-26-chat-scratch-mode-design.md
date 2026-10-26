<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Chat / Scratch Mode (`💬 对话 | 🛠 工作台`) Design Spec (`dev-board#1479`)

## 1. Background & Goals

AI WorkDeck traditionally opens into a 4-column IDE workbench (`left-rail` + `sidebar-left` + `content-area` + `side-panel-ai`) tailored for multi-file, long-running, collaborative projects. However, for lightweight Q&A, quick drafting, or ad-hoc cross-project synthesis, users often want an Antigravity/Claude-style **Chat-first Mode** without the overhead of creating a formal project first.

### Core Goals
1. **Dual-Mode Single Shell (`💬 对话 | 🛠 工作台`)**:
   - Persistent mode switcher in the top header (`viewMode: 'chat' | 'ide'`).
   - Switching between `chat` and `ide` happens **in-place inside `project-overview.vue`** without `uni.reLaunch`, preserving active SSE chat streams (`ChatInterface.vue`) and keeping `LibreOfficeEditor` (`<webview>`) instances alive in the DOM.
2. **Configurable Startup Mode + Welcome Quick Chat Entry**:
   - Keep `WelcomePane.vue` as the default startup view (`awd_startup_entry_mode = 'welcome' | 'chat' | 'last'`, defaulting to `'welcome'`) for smooth transition and future default toggling.
   - Add a **Hero Quick Chat input & action bar** on `WelcomePane.vue` so typing a prompt or clicking `进入随手对话` immediately provisions/loads the Scratch Workspace and enters `chat` mode.
3. **Orthogonal Mode × Project Model & Hidden Scratch Workspace (`Project.SCRATCH`)**:
   - When entering `chat` mode from a no-project state (`!hasProject`), automatically provision/load the user's hidden **Scratch Project (`projectType = "SCRATCH"`)** ("随手工作区").
   - Unlike `LOOSE_FILES`, `SCRATCH` uses managed project storage (`projects/{id}/...`), so `write_docx`, `write_file`, `createFromTemplate`, `LOWA` editing, `PlainTextEditor`, and file drag-and-drop work natively.
   - Hidden from `GET /api/projects/my` so it never clutters the formal project list.
   - One-click **Promote to Formal Project (`POST /api/projects/{id}/promote`)** converts `SCRATCH` -> `BLANK` with a user-chosen name in-place, preserving all files, open tabs, and conversation history.
4. **Lightweight Chat Sidebar & Cross-Project File Explorer (`ChatModeSidebar.vue`)**:
   - Collapsible left sidebar (`~240px`) in `chat` mode with three sections:
     1. **Recent Conversations** (`+ 新对话`, search, conversation history list).
     2. **Current Workspace Files** (`+ 新建 Word`, `+ 新建 Markdown`, current workspace files; clicking a file opens the right-hand **Canvas** editor).
     3. **Cross-Project Quick Explorer (`跨项目调取`)**: Lists the user's formal projects (`GET /api/projects/my`) with search filter; expanding a project lazy-loads its file tree (`GET /api/projects/{id}/files?tree=true`); each file offers `[+ 引用]` (attaches as a read-only cross-project `ContextItem` `@项目名/文件名` in `ChatInterface.vue`) or click-to-preview in Canvas.
5. **Cross-Project Read-Only Context & Tool Access**:
   - `ContextItem` carries optional `projectId`, `projectName`, `readOnly`.
   - `ToolFileGuard` adds read-permission validation (`rejectIfNoReadAccess`) so `read_document` and `extract_file_text` can read files from any project where the user has read permission (`projectMemberService.hasReadPermission(file.getProjectId(), userId)`), while all write/delete/move tools remain strictly restricted to the active `projectId`.
   - `FileTools` adds `search_across_projects(keyword)` so the AI agent can also discover files across the user's projects on demand.

---

## 2. Architecture & Component Mapping

### 2.1 Backend (`backend/src/main/java/com/checkba/controller` & `service`)
- **`Project.java`**:
  - Add `public static final String SCRATCH = "SCRATCH";`
  - Add `public boolean isScratchWorkspace() { return SCRATCH.equals(projectType); }`
- **`ProjectRepository.java`**:
  - `Optional<Project> findFirstByUserIdAndProjectTypeOrderByIdAsc(Long userId, String projectType);` (already exists).
- **`ProjectService.java`**:
  - In `getUserProjects(Long userId)`: filter `!p.isLooseFileWorkspace() && !p.isScratchWorkspace()`.
  - Add `ensureScratchProject(Long userId)`: idempotently finds or creates the user's `SCRATCH` project (`name = LangText.of("随手工作区", "Scratch Workspace")`, `projectType = Project.SCRATCH`, `versionOptOut = true`, `userId`, plus `ADMIN` `ProjectMember`).
  - Add `promoteScratchProject(Long projectId, String newName, Long userId)`: verifies ownership/admin and that project is `SCRATCH` (or allows renaming/promoting), updates `projectType = Project.BLANK`, `name = newName.trim()`, `versionOptOut = false`, saves and returns the updated `Project`.
- **`ProjectController.java`**:
  - `POST /api/projects/scratch`: returns `{ code: 0, data: project }`.
  - `POST /api/projects/{id}/promote`: accepts `{ "name": "..." }`, calls `projectService.promoteScratchProject(id, name, userId)`, returns `{ code: 0, data: project }`.
- **`AiAgentController.java` (`ContextItem`)**:
  - Add `private Long projectId;`, `private String projectName;`, `private boolean readOnly;` with getters/setters.
- **`ToolFileGuard.java`, `LegalTools.java`, `FileTools.java`, `ContextAssemblerService.java`**:
  - `ToolFileGuard.rejectIfNoReadAccess(ProjectFile file, ProjectMemberService projectMemberService)`: allows same-project read OR cross-project read when `projectMemberService.hasReadPermission(file.getProjectId(), userId)` is `true`.
  - `LegalTools.read_document` & `FileTools.extract_file_text`: use `ToolFileGuard.rejectIfNoReadAccess(pf, projectMemberService)`.
  - `FileTools.search_across_projects(String keyword)`: searches across readable user projects and returns `[项目: <projectName> (projectId=<pid>)] <fileName> (fileId=<fid>, path=<wpsPath>)`.
  - `ContextAssemblerService`: includes `project="<projectName>" readonly="true"` on `<file>` XML tags when `item.getProjectName()` is present or `item.getProjectId()` differs from current `projectId`.

### 2.2 Frontend (`frontend/src`)
- **`frontend/src/services/api.js`**:
  - `ensureScratchProject()` -> `POST /api/projects/scratch`
  - `promoteScratchProject(projectId, name)` -> `POST /api/projects/${projectId}/promote`
- **`frontend/src/pages/project-overview/chatMode.js`**:
  - Pure helper functions + Vue mixin/methods for:
    - `STARTUP_ENTRY_MODE_KEY = 'awd_startup_entry_mode'` (`'welcome' | 'chat' | 'last'`, default `'welcome'`)
    - `VIEW_MODE_STORAGE_KEY = 'awd_last_view_mode'` (`'chat' | 'ide'`)
    - `normalizeViewMode(mode)`, `resolveInitialViewMode({ queryMode, startupEntryMode, lastViewMode })`
    - `isScratchProject(project)` (`Boolean(project && project.projectType === 'SCRATCH')`)
    - `shouldShowChatCanvas({ viewMode, chatCanvasOpen, openTabs })`
    - `buildCrossProjectContextItem(file, project)`
- **`frontend/src/components/chat/ChatModeSidebar.vue`**:
  - Emits: `['toggle-collapse', 'new-chat', 'select-conversation', 'delete-conversation', 'create-doc', 'open-file', 'attach-cross-project-file', 'preview-cross-project-file', 'promote-scratch', 'switch-project']`
  - Sections: Conversations, Current Workspace Files (`+ 新建 Word`, `+ 新建 Markdown`), Cross-Project Explorer (`跨项目调取` with search & lazy tree expand).
- **`frontend/src/components/welcome/WelcomePane.vue`**:
  - Adds Hero Quick Chat input box (`quickPrompt`) + quick entry buttons (`💬 进入随手对话`, `📝 新建空白文稿`).
  - Emits: `['create-project', 'open-local-folder', 'open-loose-files', 'open-project', 'start-chat', 'quick-create-doc']`.
- **`frontend/src/pages/project-overview/project-overview.vue` & `project-overview.scss` & `frontend/src/App.vue`**:
  - Header mode segmented control `[ 💬 对话 | 🛠 工作台 ]` in `.header-center`.
  - Scratch Workspace indicator badge + `[转为正式项目]` button in `.header-left`.
  - `.page-project-overview.chat-mode` CSS flex layout:
    - Hides `.left-rail` and `.sidebar-left`; displays `<ChatModeSidebar>` on the left.
    - Reorders `.workbench-main` children so `.side-panel-ai` is `order: 1` (centered 840px stream when Canvas is closed, 42% left pane when Canvas is open) and `.content-area` is `order: 2` (0-width hidden when Canvas is closed so `<webview>` stays alive, 58% right Canvas with `[收起画布]` button when open).
  - Preserves all `check-navigation-contract.mjs`, `check:emits`, and `titlebar-drag-region.test.mjs` invariants.
