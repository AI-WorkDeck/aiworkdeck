<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Brand profiles (white-label editions) — design

Status: 2026-11-23. Goal: a licensed edition is "a private repo with `brands/<id>/`, one workflow call, a green
leak check". Same code and full feature set; nothing user-visible names AI WorkDeck except the AGPL notices
(copyright, "based on AI WorkDeck", source link), which must stay.

Brand folders are **not** kept in this public repo: each licensee's folder (names, domains, operator, art, legal
text) lives in that licensee's private repo. This repo only carries the tooling and the default brand.

## How it works (as built)

```
brands/<id>/brand.json     name, domain, appId, packageName, dataDirName, supportEmail, copyright,
                           defaultLanguage (optional: UI language until the user picks one, instead of the OS's),
                           replace[] (exact, brand-specific), keyOverrides{} (locale keys whose meaning changes)
brands/<id>/overlay/**     files copied over the tree after the rewrite (same paths as the repo)
brands/<id>/art/           sources + render.sh for the overlay's icons and installer art (outputs committed)
scripts/brand/apply.mjs    rewrites a throwaway checkout; the default brand is a no-op
scripts/brand/leak-check.mjs  scans built output (dirs, .asar, .jar) for the old name/domains
```

`node scripts/brand/apply.mjs --brand <id>` on a fresh checkout, then the normal build. In CI the licensee's
private repo calls `desktop-build.yml` (workflow_call, inputs `brand`, `source_ref`); the workflow checks out this
repo at `source_ref`, copies the caller's `brands/` in, applies the brand, skips the desktop unit tests (they assert
AI WorkDeck literals) and runs the leak check on the unpacked app. Artifacts are named `<brand>-<os>`.

Rewrite rules (every rule must match at least once, or the run fails as stale):
- product name `AI[ -]?Work[Dd]eck|WorkDeck AI` → name; `hi@aiworkdeck.com` → supportEmail;
  `*.aiworkdeck.com`, `*.workdeck.ai` → `*.<domain>` (except the shared partner-portal hosts);
  `.aiworkdeck` data dir → dataDirName; `com.aiworkdeck.desktop` → appId; local MCP ids → id.
- Lines kept as-is: SPDX headers, GitHub source links, `legalCopyright` / `portalSourceNotice` (AGPL
  attribution), outbound user agents, the version-store magic bytes.
- `desktop/package.json`: name (→ Electron userData), appId, productName, copyright, DMG title, NSIS shortcut.
- Typical overlay: backend `config/application.yml` (one site; id `intl` = the email + Turnstile flow, cn off,
  so no site switcher; `cross-border-consent: false` when the operator is outside mainland China), desktop `legal-notices.json` (trademark line names the licensee), icons and installer art.

Why a source rewrite instead of `{brand}` placeholders: zero churn in the default build, and it covers Java,
Vue, Electron, NSIS and plugin text uniformly. The leak check is what keeps it honest.

Lessons for the next licensee:
- The name hides in places beyond UI text: MCP server ids, Basic-auth realms, ProgIDs, git commit authors,
  redline author, smoke scripts, the shared `office-addin/taskpane/lib` and `shared/` imports.
- Some "names" are contracts and must not change: version-store magic bytes, outbound UA, `*.aiworkdeck.local`
  git identities, `com.checkba.*`, `AIWORKDECK_*` env vars.
- Headless Chrome has a minimum window width: give small art pages a fixed body size.

## Not changed (public contracts, see CLAUDE.md)

`com.checkba.*`, `checkba://` / `checkba:` IPC, `--awd-*`, `awd: 1`, ports `[5269, 5369, 5169]`, `__ai_anchor_`,
`X-AWD-*`. Two brands running at once share the port chain; the existing fallback order must hold (verify).
