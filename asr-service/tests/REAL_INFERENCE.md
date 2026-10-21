<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Real local TTS and ASR acceptance

`real_inference.py` runs the product Kokoro and ASR `app.py` with the supplied Python and runtime `lib` directories. It uses only built-in synthetic Chinese/English phrases. It never downloads, installs packages, or accesses customer audio. Prepare and verify the runtime packs and model caches first; the model downloader is `desktop/main/services/model-fetch.py` (or the desktop ModelManager).

Run from the repository root, passing paths for the target operating system. Quote paths containing spaces:

```text
python asr-service/tests/real_inference.py --python "PATH_TO_BUNDLED_PYTHON" --asr-lib "ASR_RUNTIME/lib" --asr-models "ASR_MODEL_CACHE" --kokoro-lib "KOKORO_RUNTIME/lib" --kokoro-models "KOKORO_MODEL_CACHE" --output "NEW_EMPTY_EVIDENCE_DIRECTORY"
```

Model cache arguments are each component's `HF_HOME`, containing `hub/models--...`, not a snapshot directory. Output must not already exist. Allow about 1.5 GB additional disk for the ASR snapshot copy and sufficient memory for Whisper medium plus Kokoro. The probe materializes model snapshot/ref files instead of creating symbolic links, so Windows does not need Developer Mode or elevated symlink privileges.

The probe:

- Gives each process an isolated home/temp/cache and a dynamic loopback port, including Windows `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP` and `TMP`; runtime libraries and prepared source models are read-only. Bytecode writes are disabled. Runs with `HF_HUB_OFFLINE=1` and dead HTTP proxies; `report.json` records these settings under `networkPolicy`. This is not an OS network sandbox or proof of physical disconnection. Health requests have a two-second timeout within the sixty-second startup deadline.
- Generates Chinese (`zf_001`) and English (`af_maple`) WAV audio using real Kokoro models. It validates 24 kHz mono PCM, duration over one second and RMS above 0.005.
- Calls the real ASR endpoint with no model and requires HTTP 409. Then copies the already-verified model into its disposable cache and retries in the same service process, without a restart.
- Runs faster-whisper medium on the generated audio, requires segments and key phrases from both source texts, and records transcripts, duration, RMS and inference time in `report.json`. WAVs and service logs remain alongside it.
- Terminates only the child processes it created. No global install, model download, application update or release occurs.

A passing result establishes this machine/runtime/model combination, not every speaker, language, long recording or UI workflow. `--python` must be the product's target-platform Python, not an unrelated developer environment. Record runtime manifest version/signature/archive/content verification separately. The current official ASR medium repository uses `vocabulary.txt`; CTranslate2 also supports a `vocabulary.json` string array (preferred if both exist).
