// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { build } from 'esbuild';
import { readFile, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { adaptUpstream } from './web-src/adapt-upstream.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const upstream = await readFile(new URL('./web-src/upstream-client.js', import.meta.url), 'utf8');
await build({
  absWorkingDir: root, entryPoints: ['web-src/main.jsx'], outfile: 'web/panel.js', bundle: true,
  format: 'iife', target: ['es2020'], minify: true, legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: '/*! AI WorkDeck DPIA adapter. Includes DSH DPIA Workbench 0.3.11-beta.6 (AGPL-3.0-only), The-Data-Galaxy. See THIRD_PARTY_NOTICES.txt and upstream LICENSE/NOTICE. */' },
  plugins: [{ name: 'dpia-upstream-adapter', setup(builder) {
    builder.onResolve({ filter: /^dpia-upstream-client$/ }, () => ({ path: 'client.js', namespace: 'dpia-upstream' }));
    builder.onLoad({ filter: /.*/, namespace: 'dpia-upstream' }, () => ({ contents: adaptUpstream(upstream), loader: 'js', resolveDir: root }));
  } }],
});
await copyFile(new URL('../../sdk/plugin-sdk/awd-plugin-sdk.js', import.meta.url), new URL('./web/awd-plugin-sdk.js', import.meta.url));
const notices = ['DSH DPIA Workbench 0.3.11-beta.6\nThe-Data-Galaxy\nhttps://github.com/The-Data-Galaxy/dsh-dpia-workbench\nCommit: 66c5e11c022277625072a50765793b257a6626a7\nLicense: AGPL-3.0-only. The unmodified client source is retained in web-src/upstream-client.js.\nThe upstream LICENSE and NOTICE accompany the plugin distribution.\n'];
for (const pkg of ['react', 'react-dom', 'scheduler']) {
  const meta = JSON.parse(await readFile(new URL(`./node_modules/${pkg}/package.json`, import.meta.url), 'utf8'));
  const license = await readFile(new URL(`./node_modules/${pkg}/LICENSE`, import.meta.url), 'utf8');
  notices.push(`${pkg} ${meta.version}\n${license}`);
}
await writeFile(new URL('./web/THIRD_PARTY_NOTICES.txt', import.meta.url), notices.join('\n\n'));
