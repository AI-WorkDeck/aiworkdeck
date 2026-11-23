<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# White-label editions

Design and lessons: `docs/superpowers/specs/2026-11-23-brand-profile-design.md`.

## Add a licensee

1. Private repo with `brands/<id>/brand.json` (copy the fields of `brands/aiworkdeck/brand.json`; add
   `replace[]` for the update feed and update-signing public key, `keyOverrides{}` for the trademark notice),
   `brands/<id>/overlay/**` (files copied over the tree) and `brands/<id>/art/` (sources + render script).
   Optional `bundledPlugins: ["<plugin id>"]`: official plugins the edition preinstalls (with their backend JARs);
   apply.mjs lists them for `PluginBundledInstaller`, CI's `stage-bundled-plugins.mjs` adds the SDK and builds the JARs.
2. `.github/workflows/build.yml` in that repo:

   ```yaml
   on: workflow_dispatch
   permissions: { contents: write, id-token: write, actions: read }
   jobs:
     desktop:
       uses: AI-WorkDeck/aiworkdeck/.github/workflows/desktop-build.yml@master
       with: { brand: <id>, source_ref: master }
       secrets: inherit
   ```

3. Signing secrets in that repo (optional; unsigned without them): `CSC_LINK`, `CSC_KEY_PASSWORD`,
   `APPLE_API_KEY_B64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `AZURE_SIGNING_*` (+ an Azure federated
   credential for `repo:<owner>/<repo>:environment:windows-signing`).
4. Local check before CI: on a scratch worktree, copy the brand folder into `brands/`, run
   `node scripts/brand/apply.mjs --brand <id>`, build frontend and backend, then
   `node scripts/brand/leak-check.mjs frontend/dist/build/h5 backend/target/*.jar`.

Tests: `node --test scripts/brand/brand.test.mjs`.
