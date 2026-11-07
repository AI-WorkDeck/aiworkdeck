# hello-web-plugin

Minimal pure-frontend plugin example: no Java, no build step — `web/index.html` is the whole panel.

```
hello-web-plugin/
├── manifest.json            frontendEntry points at web/index.html; permissions declare file_read
└── web/
    ├── index.html           panel UI
    └── awd-plugin-sdk.js    SDK copy (source of truth: sdk/plugin-sdk/, byte-identical)
```

## Try it locally

Copy the whole directory into the plugins folder, restart or click **Rescan** in the Plugin Marketplace, then enable it there. A new entry appears in the left rail:

| Mode | Plugins directory |
|---|---|
| Local development | `backend/plugins/` |
| Packaged desktop | `~/.aiworkdeck/plugins/` |

```bash
cp -R examples/hello-web-plugin backend/plugins/
```

Plugins dropped manually into `plugins/` are **enabled** on install (only Marketplace online installs start disabled and need an explicit **Enable**). After a rescan they show up in the left rail.

## What it demonstrates

- `awd.ready()` — handshake context (`pluginId` / `projectId` / `language` / `theme`)
- `awd.files.list()` / `awd.files.read(path)` — requires `file_read` in the manifest.
  Set `permissions` to `[]` and rescan to exercise the `permission_denied` branch
- `awd.ui.toast(message)`
- `awd.storage.get/set` — plugin-scoped KV stored by the host, 64 KB total cap
- `awd.evidence.list({})` — lists evidence linked to the focused Word document (needs `file_read`);
  with no Word document open you hit the `no_active_document` branch.
  Linking (`awd.evidence.link`) / locating (`awd.evidence.locate`) need the `editor` permission; this example does not declare it

## Sandbox boundaries

The panel runs in an iframe with `sandbox="allow-scripts allow-forms"` (**no** `allow-same-origin`). Static assets are served by the backend at `/api/plugin-web/hello-web-plugin/...` with a strict CSP: without a declared `network` permission, `connect-src` is `'none'`, so the plugin cannot make its own requests. Every capability goes through the postMessage bridge and is clipped to the manifest permissions.

Spec: [docs/PLUGIN_SPEC.md](../../docs/PLUGIN_SPEC.md) §9. SDK: [sdk/plugin-sdk/](../../sdk/plugin-sdk/).
