# Isolated TTS browser acceptance

Run from the frontend directory with the isolated Kokoro service already listening on **127.0.0.1:18937**:

Start that service in a separate terminal from the repository root. The following values are placeholders: choose the existing Python executable compatible with the installed runtime, its `lib` directory, and the already populated model cache. Do not point the benchmark at the application's live service. Check that port 18937 is unused first; this command requires no credentials or downloads:

```sh
PORT=18937 HF_HOME="/absolute/path/to/cached-kokoro-models" \
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  PYTHONPATH="/absolute/path/to/kokoro-runtime/1.0.1/lib" \
  /absolute/path/to/compatible/python kokoro-service/app.py
```

Stop only this separate process with Ctrl-C when acceptance is finished. In a second terminal, install the project's locked frontend dependencies if needed (`npm ci`), then run:

```sh
node tests/tts-browser/run.mjs /tmp/tts-1337-benchmark/ui
```

`CHROME` can select a Chrome executable. Set `KOKORO_COLD=1` only when the operator has confirmed the service process has not synthesized since startup; retain its initialization log as corroboration. Without this flag the first result is explicitly not claimed to be cold. The script never starts, stops, or resets Kokoro.

The script uses a temporary Vite server, cache, and Chrome profile; Chrome is headless with audio output muted. Only the fixed isolated Kokoro endpoint is proxied; browser requests to other origins are rejected. Input is synthetic and never taken from the user's documents.

It loads the actual `EasyVoicePane.vue`, reader, text splitter, WAV merger, Chinese translations, and application CSS tokens. A template-only adapter maps Uni `view/text/scroll-view` to browser elements and `tap` to `click`; the slider emits Uni-style values. HTTP calls bypass Java/auth and connect to Kokoro's `input/voice/speed` API. Host/component-download bridges are inert. This is **component/browser acceptance, not installed Electron or Java end-to-end acceptance**.

Controlled delayed WAV responses exercise first playback before completion, active subtitles, immediate playback speed changes without regeneration, pause through generation completion, resume, complete playback, decoded full WAV export via the real download button, cancellation on stop/unmount, and synthesis failure. Three real Kokoro runs measure first audible-media `playing` events and prove playback starts before the last segment completes: first short, warm short, and warm 744-character text identical to the original whole-document benchmark. The long case waits for all synthesis and WAV decoding, then stops without waiting for the entire recording to play. Results include character/segment counts, first audio and full generation times, exact transcript preservation, decoded duration, and cleanup timings. HTMLAudioElement is real, with passive event instrumentation; actual sound is muted.

Outputs: `results.json`, `panel-380.png`, and a downloaded WAV. Assertions set a nonzero exit code and still save diagnostics on failure. Temporary Chrome profile and Vite cache are deleted at exit; output evidence is retained.

For media-only regression without starting a model, append `--synthetic-only`; `realMeasurements` will be empty and no latency claim is produced. Keyboard, actual Uni controls, accessible names and layout acceptance use `../tts-panel-ui/README.md` instead of this template adapter.
