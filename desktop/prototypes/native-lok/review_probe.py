# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Isolated native review/input regression; no UI, IME or performance claim."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import select
import shutil
import struct
import subprocess
import threading


class Worker:
    def __init__(self, worker, runtime, out):
        self.events, self.replies, self.seq = [], queue.Queue(), 0
        self.epoch = None
        for name in ('home', 'temp', 'profile'):
            (out / name).mkdir()
        self.env = dict(HOME=str(out / 'home'), TMPDIR=str(out / 'temp'), PATH='/usr/bin:/bin:/usr/sbin:/sbin', LANG='en_US.UTF-8', LC_ALL='en_US.UTF-8', LOK_WORKDIR=str(out), SAL_LOK_OPTIONS='unipoll', PYTHONDONTWRITEBYTECODE='1', PYTHONPYCACHEPREFIX=str(out / 'python-cache'))
        self.stderr = (out / 'worker-stderr.log').open('wb')
        self.proc = subprocess.Popen([str(worker), str(runtime), (out / 'profile').as_uri(), str(out)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, env=self.env, cwd=out, start_new_session=True)
        threading.Thread(target=self.read, daemon=True).start()
        ready, _ = self.replies.get(timeout=60)
        assert ready['type'] == 'engine-ready', ready
        self.ready = ready

    def read_exact(self, count):
        result = bytearray()
        while len(result) < count:
            chunk = self.proc.stdout.read(count - len(result))
            if not chunk:
                raise EOFError('worker ended')
            result.extend(chunk)
        return result

    def read(self):
        try:
            while True:
                h, b = struct.unpack('<II', self.read_exact(8))
                assert 0 < h and h + b <= 64 * 1024 * 1024
                msg = json.loads(self.read_exact(h))
                data = bytes(self.read_exact(b)) if b else b''
                if msg['type'] in ('callback', 'phase'):
                    self.events.append(msg)
                else:
                    self.replies.put((msg, data))
        except Exception as exc:
            self.replies.put(({'error': repr(exc)}, b''))

    def call(self, action, require=True, **params):
        self.seq += 1
        if self.epoch is not None:
            params.setdefault('documentEpoch', self.epoch)
        raw = json.dumps(dict(action=action, reqId=self.seq, **params), ensure_ascii=False).encode()
        self.proc.stdin.write(struct.pack('<II', len(raw), 0) + raw)
        self.proc.stdin.flush()
        msg, data = self.replies.get(timeout=60)
        assert msg.get('reqId') == self.seq, msg
        if require:
            assert msg.get('success'), msg
        return msg, data

    def stop(self):
        if self.proc.poll() is None:
            try:
                self.call('shutdown')
                self.proc.wait(timeout=10)
            finally:
                if self.proc.poll() is None:
                    self.proc.terminate()
                    self.proc.wait(timeout=10)
        self.stderr.close()


class UnoReview:
    def __init__(self, worker, host, runtime, out):
        port = worker.call('start_urp')[0]['port']
        home = runtime / 'Frameworks/LibreOfficePython.framework/Versions/3.12'
        env = dict(worker.env, PYTHONHOME=str(home),
                   PYTHONPATH=str(runtime / 'Resources') + ':' + str(runtime / 'Frameworks'),
                   URE_BOOTSTRAP='vnd.sun.star.pathname:' + str(runtime / 'Resources/fundamentalrc'))
        self.stderr = (out / 'uno-stderr.log').open('w')
        self.proc = subprocess.Popen([str(host), str(home / 'LibreOfficePython'),
                                      str(Path(__file__).with_name('review_uno.py').resolve()), '--port', str(port)],
                                     env=env, cwd=out, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=self.stderr, text=True)
        self.url, self.seq = (out / 'document.docx').as_uri(), 0

    def call(self, method, **params):
        self.seq += 1
        self.proc.stdin.write(json.dumps({'id': self.seq, 'method': method,
                                         'params': {'documentUrl': self.url, **params}}) + '\n')
        self.proc.stdin.flush()
        assert select.select([self.proc.stdout], [], [], 30)[0], 'UNO response timeout'
        reply = json.loads(self.proc.stdout.readline())
        assert reply.get('id') == self.seq and 'error' not in reply, reply
        return reply['result']

    def stop(self):
        try:
            try:
                self.proc.stdin.close()
            except BrokenPipeError:
                pass
            self.proc.wait(timeout=10)
        finally:
            if self.proc.poll() is None:
                self.proc.terminate()
                self.proc.wait(timeout=10)
            self.stderr.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--worker', type=Path, required=True)
    ap.add_argument('--runtime', type=Path, required=True)
    ap.add_argument('--fixture', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--uno-host', type=Path)
    ap.add_argument('--uno-runtime', type=Path)
    args = ap.parse_args()
    if bool(args.uno_host) != bool(args.uno_runtime):
        ap.error('--uno-host and --uno-runtime must be provided together')
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(args.fixture, out / 'document.docx')
    result = {'scope': 'native CAPI functional test, not system IME or performance', 'fixtureSha256': hashlib.sha256(args.fixture.read_bytes()).hexdigest()}
    worker = Worker(args.worker.resolve(), args.runtime.resolve(), out)
    review = None
    try:
        opened, _ = worker.call('open', path=str(out / 'document.docx'))
        worker.epoch = opened['documentEpoch']
        result['open'] = opened
        worker.call('set_viewport', width=800, height=900, widthTwips=11906, heightTwips=13395, xTwips=0, yTwips=0)
        painted, pixels = worker.call('paint', width=800, height=900, widthTwips=11906, heightTwips=13395, xTwips=0, yTwips=0)
        assert painted['pixelsChanged'] and len(pixels) == 800*900*4
        before, _ = worker.call('selection_text')
        snapshot, _ = worker.call('review_snapshot')
        after, _ = worker.call('selection_text')
        assert len(snapshot['items']) == 600 and before['text'] == after['text']
        assert len({i['revisionId'] for i in snapshot['items']}) == 600
        result['snapshotReadPreservedSelection'] = True
        result['revisionCount'] = len(snapshot['items'])
        result['revisionSample'] = snapshot['items'][:2]
        (out / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
        first = snapshot['items'][0]
        if args.uno_host:
            review = UnoReview(worker, args.uno_host.resolve(), args.uno_runtime.resolve(), out)
            details = review.call('snapshot')
            assert len(details['entries']) == 600
            result['controllerCapabilities'] = details['controllerCapabilities']
        goto, _ = worker.call('review_goto', refreshEpoch=snapshot['refreshEpoch'], revisionId=first['revisionId'])
        assert '合成测试条款0' in goto['text'], goto
        result['goto'] = goto
        if review:
            for mode in ('all', 'final', 'all'):
                display = review.call('view', mode=mode)
                assert display['showChanges'] == (mode == 'all')
                for index in (0, 1, 1):
                    current, _ = worker.call('review_snapshot')
                    worker.call('review_goto', refreshEpoch=current['refreshEpoch'], revisionId=current['items'][index]['revisionId'])
                    assert review.call('verify_location', identifier=details['entries'][index]['identifier'])['located']
            result['repeatedNativeRangeLocationAndViewReadback'] = True
        snapshot, _ = worker.call('review_snapshot')
        accepted, _ = worker.call('review_resolve', refreshEpoch=snapshot['refreshEpoch'], revisionId=first['revisionId'], decision='accept')
        assert accepted['applied'] and accepted['remainingCount'] == 599
        result['accepted'] = accepted
        stale, _ = worker.call('review_resolve', require=False, refreshEpoch=snapshot['refreshEpoch'], revisionId=snapshot['items'][1]['revisionId'], decision='reject')
        assert stale.get('error') == 'STALE_REVIEW', stale
        result['staleReviewRejected'] = True
        snapshot, _ = worker.call('review_snapshot')
        rejected, _ = worker.call('review_resolve', refreshEpoch=snapshot['refreshEpoch'], revisionId=snapshot['items'][0]['revisionId'], decision='reject')
        assert rejected['applied'] and rejected['remainingCount'] == 598
        result['rejected'] = rejected
        worker.call('command', command='.uno:GoToEndOfDoc', arguments='{}')
        typed, _ = worker.call('input_text', inputSeq=1, text='文档内中文提交核验')
        assert typed['applied'] and typed['lastInputSeq'] == 1 and typed['documentEpoch'] == worker.epoch
        barrier, _ = worker.call('input_barrier', inputSeq=1)
        assert barrier['lastInputSeq'] == 1 and barrier['applied']
        duplicate, _ = worker.call('input_text', require=False, inputSeq=1, text='不可重复')
        assert duplicate.get('error') == 'INPUT_SEQUENCE_MISMATCH'
        result['duplicateInputRejected'] = True
        worker.call('save', path=str(out / 'saved.docx'))
        from probe import docx_projection
        text = docx_projection(out / 'saved.docx')
        assert text['final'].endswith('文档内中文提交核验') and '不可重复' not in text['all']
        assert '合成测试条款0：' in text['final'] and '合成测试条款1：' in text['final']
        result['nativeTextCommitExportReadback'] = True
        old_epoch = worker.epoch
        worker.call('close')
        worker.epoch = None
        reopened, _ = worker.call('open', path=str(out / 'saved.docx'))
        worker.epoch = reopened['documentEpoch']
        old, _ = worker.call('input_text', require=False, documentEpoch=old_epoch, inputSeq=1, text='旧文档污染')
        assert old.get('error') == 'STALE_DOCUMENT'
        result['reopenEpochRejectedOldInput'] = True
        result['success'] = True
    except Exception as exc:
        result['failure'] = repr(exc)
    finally:
        try:
            if review:
                review.stop()
                result['unoExitCode'] = review.proc.returncode
        finally:
            worker.stop()
        result['exitCode'] = worker.proc.returncode
        (out / 'events.json').write_text(json.dumps(worker.events, ensure_ascii=False, indent=2))
        (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get('success') else 1


if __name__ == '__main__':
    raise SystemExit(main())
