<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# TTS panel: real Uni H5 browser acceptance

From `frontend`, run:

```sh
node tests/tts-panel-ui/run.mjs /tmp/tts-1339-ui
```

Requires installed frontend dependencies and Chrome. `CHROME` overrides the default `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` executable. Every run compiles a temporary Uni H5 app using the repository's actual `@dcloudio/vite-plugin-uni`, `EasyVoicePane.vue`, `AwdSelect.vue`, App stylesheet/tokens, locales, and TTS reader utilities. It starts a temporary loopback HTTP server and a new headless Chrome profile; profiles and temporary build trees are removed on completion. `--smoke` records only the compiled DOM and initial screenshot. `--visuals-only` skips the interaction sequence, so its success is not full acceptance.

This is an isolated single-page component harness, **not** the full workbench, installed Electron application, Java service, Kokoro inference, system accessibility service, or OS display scaling. No production backend, credentials, customer text, user profile, or paid service is used. The API fixture supplies 44 synthetic voices and delayed synthetic 24 kHz PCM WAV files, including a controlled HTTP failure. Host and component-download bridges are inert. Unknown outbound traffic fails the test; Uni's known toast shadow image request is answered locally with a transparent pixel. Chrome is muted; the real HTMLAudioElement still decodes and advances time. No autoplay-policy override is used.

Uni `view`, `button`, `textarea`, `input`, `slider`, and `scroll-view` are compiled unchanged. Tests use trusted browser keyboard/mouse input and CDP text insertion, not replacement native controls or synthetic DOM key events. Selecting the textarea's existing fixture range uses `select()`; text insertion remains native. Native textarea and search input accessible names are read from the Chrome Accessibility tree, not inferred from wrapper attributes.

The full run covers:

- Native rapid consecutive text inputs followed immediately by start, and import/start within the Uni update window.
- Tab, Enter and Space for import/clear, search reopening/filtering/selection/Escape, slider arrows/Home/End/PageDown/reset, start/pause/resume/stop, and WAV download.
- Immediate in-flight speed change without new speech requests, paused playback clock, current subtitle, real Uni subtitle scroll, synthetic failure/retry, decoded export, reduced motion.
- 160/220/260/420 px widths × light/dark × Chinese/English screenshots and horizontal control geometry.
- Coarse-pointer touch control sizes; 150% and 200% **CSS zoom** screenshots. CSS zoom is a layout proxy, not browser UI zoom or OS scaling.

The output directory contains `results.json`, `uni-build.log`, source hashes in `build.json`, screenshots, and the downloaded WAV. Failures additionally save DOM, a screenshot, and relevant focus/input/audio request state. Test text is synthetic and safe to retain. Browser keyboard/focus behavior is evidence for this Chrome + Uni H5 build only; installed Electron, assistive technology speech, physical touch devices, and all desktop OS variants still require their own testing.
