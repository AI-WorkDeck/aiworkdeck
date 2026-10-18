<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Bundled business plugin build provenance

These packages reuse this repository’s Vue panels and compile them with its existing frontend dependencies. They are independently built Web plugins; no third-party repository was copied or rewritten for this migration. Version and license facts below are from `frontend/package-lock.json` at implementation time.

| Dependency | Locked version | License |
| --- | --- | --- |
| vue | 3.4.21 | MIT |
| vue-i18n | 9.14.5 | MIT |
| @dcloudio/uni-app | 3.0.0-4080420251103001 | Apache-2.0 |
| @dcloudio/uni-h5 | 3.0.0-4080420251103001 | Apache-2.0 |
| @dcloudio/vite-plugin-uni | 3.0.0-4080420251103001 | Apache-2.0 |
| @intlify/message-compiler | 9.1.9 | MIT |
| vite | 5.2.8 | MIT |

Upstream sources: [Vue](https://github.com/vuejs/core), [vue-i18n and Intlify compiler](https://github.com/intlify/vue-i18n), [Uni-app](https://github.com/dcloudio/uni-app), [Vite](https://github.com/vitejs/vite). License declarations and full texts remain in the installed dependency packages and repository dependency notices; consult the lockfile for exact resolved artifacts and integrity values. Build tooling is not necessarily shipped in runtime output.

`frontend/scripts/build-business-plugins.mjs` builds the eight packages into `official-plugins/*/web`. Its first-party SPDX banner is additive: it must not replace or remove upstream license comments emitted by the compiler. The first-party source license does not relicense third-party dependencies. Generated source retains compiler-emitted notices; the shared app icon is copied from this repository’s `frontend/src/static/iconmark_v2.png`.
