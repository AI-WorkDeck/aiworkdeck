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
       # `secrets: inherit` only works inside one org/enterprise; a licensee's repo is in another account,
       # so pass each secret explicitly (the called workflow declares them under workflow_call.secrets).
       secrets:
         CSC_LINK: ${{ secrets.CSC_LINK }}
         CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
         APPLE_API_KEY_B64: ${{ secrets.APPLE_API_KEY_B64 }}
         APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
         APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
         AZURE_SIGNING_CLIENT_ID: ${{ secrets.AZURE_SIGNING_CLIENT_ID }}
         AZURE_SIGNING_TENANT_ID: ${{ secrets.AZURE_SIGNING_TENANT_ID }}
         AZURE_SIGNING_SUBSCRIPTION_ID: ${{ secrets.AZURE_SIGNING_SUBSCRIPTION_ID }}
         UPDATE_SIGNING_KEY: ${{ secrets.UPDATE_SIGNING_KEY }}
   ```

3. Signing secrets in that repo (optional; unsigned without them): `CSC_LINK`, `CSC_KEY_PASSWORD`,
   `APPLE_API_KEY_B64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `AZURE_SIGNING_*`, `UPDATE_SIGNING_KEY`
   (+ a `windows-signing` environment and an Azure federated credential for
   `repo:<owner>/<repo>:environment:windows-signing`). Check the build log: "skipped macOS application code
   signing" means the secrets did not arrive.
4. Local check before CI: on a scratch worktree, copy the brand folder into `brands/`, run
   `node scripts/brand/apply.mjs --brand <id>`, build frontend and backend, then
   `node scripts/brand/leak-check.mjs frontend/dist/build/h5 backend/target/*.jar`.

Tests: `node --test scripts/brand/brand.test.mjs`.
