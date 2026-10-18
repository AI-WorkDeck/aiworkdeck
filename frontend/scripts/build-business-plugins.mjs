// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ids = process.argv.slice(2)
const license = 'SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors\nSPDX-License-Identifier: AGPL-3.0-or-later'
async function licenseAssets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name)
    if (entry.isDirectory()) await licenseAssets(file)
    else if (/\.(js|css|html)$/.test(entry.name)) {
      const data = await readFile(file, 'utf8')
      if (!data.slice(0, 1000).includes('SPDX-License-Identifier:')) await writeFile(file, (entry.name.endsWith('.html') ? '<!-- ' + license + ' -->\n' : '/*! ' + license + ' */\n') + data)
    }
  }
}
for (const id of ids.length ? ids : ['search', 'voice', 'desensitize', 'litigation-visual', 'calendar', 'favorites', 'clipboard', 'insight']) {
  const result = spawnSync(process.execPath, ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', 'build', '-p', 'h5', '--config', 'vite.business-plugins.config.js'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, AWD_BUSINESS_PLUGIN: id, VITE_ROOT_DIR: resolve(root, 'plugin-app'), UNI_INPUT_DIR: resolve(root, 'plugin-app'), UNI_OUTPUT_DIR: resolve(root, '../official-plugins', id, 'web') },
  })
  if (result.status !== 0) process.exit(result.status || 1)
  const assets = resolve(root, '../official-plugins', id, 'web/static')
  await mkdir(assets, { recursive: true })
  await copyFile(resolve(root, 'src/static/iconmark_v2.png'), resolve(assets, 'iconmark_v2.png'))
  await licenseAssets(resolve(root, '../official-plugins', id, 'web'))
}
