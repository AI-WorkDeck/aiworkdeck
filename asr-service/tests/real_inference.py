# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Opt-in real local TTS -> ASR acceptance. Requires prepared runtimes/models; never downloads.
All writable homes, caches, audio and logs live in --output. No customer input is accepted.
"""
import argparse
import array
import contextlib
import json
import math
import os
from pathlib import Path
import socket
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[2]
TEXTS = {
    'zh': ('你好，欢迎使用工作平台。今天我们讨论合同审查，会议下午三点开始。', 'zf_001', ['工作平台', '合同审查', '下午']),
    'en': ("Hello. The contract review meeting starts at three o clock. Please bring the final report.", 'af_maple', ['contract review', 'meeting starts', 'final report']),
}


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def request(port, endpoint, data=None, content_type=None, timeout=300):
    req = urllib.request.Request(f'http://127.0.0.1:{port}{endpoint}', data=data)
    if content_type:
        req.add_header('Content-Type', content_type)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def transcribe(port, audio, language):
    boundary = 'awd-synthetic-local-inference'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{language}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.wav"\r\n'
            'Content-Type: audio/wav\r\n\r\n').encode() + audio + f'\r\n--{boundary}--\r\n'.encode()
    return request(port, '/v1/audio/transcriptions', body, f'multipart/form-data; boundary={boundary}')


@contextlib.contextmanager
def service(args, name, library, model_home, output):
    port = free_port()
    env = dict(os.environ, HOME=str(output / 'home'), TMPDIR=str(output / 'tmp'),
               USERPROFILE=str(output / 'home'), APPDATA=str(output / 'appdata'),
               LOCALAPPDATA=str(output / 'localappdata'), TEMP=str(output / 'tmp'), TMP=str(output / 'tmp'),
               XDG_CACHE_HOME=str(output / 'cache'), PYTHONPATH=str(library),
               PYTHONDONTWRITEBYTECODE='1', HF_HOME=str(model_home), HF_HUB_OFFLINE='1',
               HF_HUB_CACHE=str(Path(model_home) / 'hub'),
               HUGGINGFACE_HUB_CACHE=str(Path(model_home) / 'hub'),
               ASR_MODEL='Systran/faster-whisper-medium', ASR_DEVICE='cpu', ASR_COMPUTE_TYPE='int8',
               ASR_BEAM_SIZE='5', ASR_OUTPUT_SCRIPT='simplified', KOKORO_REPO_ID='hexgrad/Kokoro-82M-v1.1-zh',
               PORT=str(port), HTTP_PROXY='http://127.0.0.1:1', HTTPS_PROXY='http://127.0.0.1:1',
               ALL_PROXY='http://127.0.0.1:1', NO_PROXY='127.0.0.1,localhost',
               http_proxy='http://127.0.0.1:1', https_proxy='http://127.0.0.1:1',
               all_proxy='http://127.0.0.1:1', no_proxy='127.0.0.1,localhost')
    with (output / f'{name}.log').open('w') as log:
        process = subprocess.Popen([args.python, str(ROOT / name / 'app.py')], cwd=output, env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'{name} exited: inspect {log.name}')
                try:
                    status, _ = request(port, '/health', timeout=min(2, max(.1, deadline - time.monotonic())))
                    if status == 200:
                        break
                except OSError:
                    pass
                time.sleep(.2)
            else:
                raise RuntimeError(f'{name} startup timed out')
            yield port
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['python', 'asr-lib', 'asr-models', 'kokoro-lib', 'kokoro-models', 'output']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    for child in ['home', 'cache', 'tmp', 'asr-cache', 'appdata', 'localappdata']:
        (output / child).mkdir()
    report = {'syntheticOnly': True, 'networkPolicy': {
        'hfHubOffline': True, 'proxy': 'http://127.0.0.1:1',
        'noProxy': '127.0.0.1,localhost', 'osNetworkIsolation': False,
    }, 'samples': []}
    with service(args, 'kokoro-service', args.kokoro_lib, args.kokoro_models, output) as tts, \
         service(args, 'asr-service', args.asr_lib, output / 'asr-cache', output) as asr:
        for language, (text, voice, anchors) in TEXTS.items():
            start = time.monotonic()
            status, audio = request(tts, '/v1/audio/speech', json.dumps({'input': text, 'voice': voice}).encode(), 'application/json')
            assert status == 200, audio.decode(errors='replace')
            tts_seconds = time.monotonic() - start
            wav_path = output / (language + '.wav')
            wav_path.write_bytes(audio)
            with wave.open(str(wav_path)) as wav:
                assert wav.getsampwidth() == 2 and wav.getnchannels() == 1 and wav.getframerate() == 24000
                samples = array.array('h', wav.readframes(wav.getnframes()))
                duration = wav.getnframes() / wav.getframerate()
                rms = math.sqrt(sum(x*x for x in samples) / len(samples)) / 32768
                assert duration > 1 and rms > .005, (duration, rms)
            if language == 'zh':
                missing_status, missing = transcribe(asr, audio, language)
                assert missing_status == 409, missing
                report['beforeInstall'] = {'status': missing_status, 'response': json.loads(missing)}
                # Installing already-verified models into this disposable service cache needs no restart.
                # Materialize only the model snapshot/ref, not duplicate cache blobs. Regular copies
                # also work on Windows without Developer Mode or symlink administrator privileges.
                source_hub = Path(args.asr_models).resolve() / 'hub'
                staged = output / 'asr-cache/preparing'
                staged.mkdir()
                for source_repo in source_hub.glob('models--*'):
                    for name in ['refs', 'snapshots']:
                        if (source_repo / name).is_dir():
                            shutil.copytree(source_repo / name, staged / source_repo.name / name)
                staged.rename(output / 'asr-cache/hub')
            start = time.monotonic()
            status, result = transcribe(asr, audio, language)
            assert status == 200, result.decode(errors='replace')
            asr_seconds = time.monotonic() - start
            result = json.loads(result)
            assert result['segments'] and all(word in result['text'].lower() for word in anchors), result
            record = dict(language=language, voice=voice, source=text, audioSeconds=duration, rms=rms,
                          ttsSeconds=tts_seconds, asrSeconds=asr_seconds, transcription=result)
            report['samples'].append(record)
            (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(record, ensure_ascii=False), flush=True)
    print('PASS: real local TTS, audio validation, missing-model 409 and same-process ASR recovery', flush=True)


if __name__ == '__main__':
    main()
