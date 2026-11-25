// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { browserSafeChunks } from "./scripts/browser-safe-chunks.mjs";
import { uniInputSync } from "./scripts/uni-input-sync.mjs";
import { noFrameworkEgress } from "./scripts/no-framework-egress.mjs";
import { localMonaco } from "./scripts/local-monaco.mjs";
// https://vitejs.dev/config/
export default defineConfig({
    // uniInputSync：输入框 v-model 同步回写，修「点按钮时只剩第一个字」（UI-INPUT1）
    plugins: [uniInputSync(), uni(), noFrameworkEgress(), localMonaco(), browserSafeChunks()],
    resolve: {
        alias: {
            "punycode.js": "punycode",
        }
    },
    base: "./",
    server: {
        host: "0.0.0.0", // 允许外部访问
        port: 5173,
        strictPort: false, // 如果端口被占用，自动尝试下一个可用端口
        open: false, // 不自动打开浏览器
        cors: true, // 启用 CORS
        hmr: {
            overlay: true, // 显示错误覆盖层
        },
    },
    // 配置静态资源
    publicDir: "static",
});
