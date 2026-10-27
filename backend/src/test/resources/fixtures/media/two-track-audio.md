# Synthetic QTA fixture (dev-board#1310)

`two-track-audio.qta` is a QuickTime/MOV container generated locally from two sine
waves, with PCM mono as stream 0 and AAC stereo as stream 1. The PCM sample-entry
fourcc is then changed to `apac` as an **undecodable placeholder**, not real APAC
encoded data. It contains no user recording. Generation command (FFmpeg):

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=220:sample_rate=16000:duration=1' \
  -f lavfi -i 'sine=frequency=880:sample_rate=48000:duration=1' \
  -map 0:a -map 1:a -c:a:0 pcm_s16le -c:a:1 aac -ac:a:1 2 -b:a:1 64k \
  -f mov two-track-audio.qta
python3 - <<'PY'
from pathlib import Path
p = Path('two-track-audio.qta')
b = p.read_bytes()
assert b.count(b'sowt') == 1
p.write_bytes(b.replace(b'sowt', b'apac'))
PY
```

The tests change sample-entry fourcc values on temporary copies to simulate an
unsupported track. These are **not real APAC samples**. They prove stream
selection, AAC conversion, and source preservation using bundled FFmpeg 6.1.1;
they do not prove decoding every Apple spatial audio variant.

Apple describes QTA with AAC compatibility and APAC spatial tracks:
https://developer.apple.com/videos/play/wwdc2025/251/

`single-track-audio.qta` is a single PCM track to verify supported non-AAC input:

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=220:sample_rate=16000:duration=1' \
  -c:a pcm_s16le -f mov single-track-audio.qta
```

`layered-audio.qta` contains two independent AAC mono sine-wave tracks, to prove
that layered recordings are rejected rather than silently transcribing only one:

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=220:sample_rate=48000:duration=1' \
  -f lavfi -i 'sine=frequency=880:sample_rate=48000:duration=1' \
  -map 0:a -map 1:a -c:a aac -b:a 32k -f mov layered-audio.qta
```

Apple's layered-recording documentation describes separating layers into M4A:
https://support.apple.com/en-ie/guide/ipad/ipadb372d34f/27/ipados/27
