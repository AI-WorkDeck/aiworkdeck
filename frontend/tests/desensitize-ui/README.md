<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Desensitize sidebar acceptance

From `frontend`, run `node tests/desensitize-ui/run.mjs /tmp/awd-desensitize-ui`.

The test compiles the production component with the real Uni H5 compiler in the TTS test's temporary scaffold. All file metadata, strategy options and preview responses are synthetic. It does not call a backend, read user documents or generate a real desensitized file.

Coverage: 220/260/420px in light/dark themes, sidebar background against the resolved design token, file-action spacing, control boundaries, import-current action, expanded options, preview and recovery-password field. Outputs include the source hash, build log, screenshots and geometry. The installed Electron client and actual file processing remain separate checks.
