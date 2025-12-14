# Checkba Desktop (Electron)

## Dev

在一个终端启动前端：

```bash
cd frontend
npm run dev:h5
```

后端：桌面端启动时会自动拉起本机后端（端口 9696）。如需手动调试后端，也可以单独启动。

启动桌面端（会加载 `http://localhost:5173`）：

```bash
cd desktop
npm i
npm run dev
```

## Troubleshooting

- OCR 提示 `No handler registered for 'checkba:ocr-capture-screen'`：
  - 多半是桌面端未重启（主进程没加载新代码）。请先完全退出桌面端再重新 `npm run dev`。
  - 新版本已做 fallback（主进程 handler 缺失时会在 preload 里直接走 desktopCapturer）。

## Notes

- 开发模式下，Electron 会加载 Vite Dev Server（保留你的前端热更新体验）。
- 生产模式下，会加载 `frontend` 的构建产物（后续补齐打包路径）。


