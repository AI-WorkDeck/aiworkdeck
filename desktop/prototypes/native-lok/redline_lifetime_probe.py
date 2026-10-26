# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Repeated real URP redline allocation/release on an owned synthetic document.

This is a stress regression, not proof that every native race is absent. Run
the same worker and fixture against baseline and patched runtimes separately.
"""
import argparse
import json
from pathlib import Path
import shutil
from review_probe import Worker, UnoReview

def main():
    parser = argparse.ArgumentParser()
    for name in ('worker', 'runtime', 'fixture', 'out', 'uno-host', 'uno-runtime'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--rounds', type=int, default=20)
    args = parser.parse_args()
    if not 1 <= args.rounds <= 100:
        parser.error('--rounds must be 1..100')
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(args.fixture, out / 'document.docx')
    result = {'scope': 'native temporary-redline lifetime stress, not performance', 'rounds': []}
    worker = Worker(args.worker.resolve(), args.runtime.resolve(), out)
    review = None
    try:
        opened, _ = worker.call('open', path=str(out / 'document.docx'))
        worker.epoch = opened['documentEpoch']
        before, _ = worker.call('selection_text')
        review = UnoReview(worker, args.uno_host.resolve(), args.uno_runtime.resolve(), out,
                           script=Path(__file__).with_name('redline_lifetime_uno.py').resolve())
        for number in range(args.rounds):
            snapshot = review.call('stress')
            assert snapshot['count'] == 600, snapshot
            if result['rounds']:
                assert snapshot == result['rounds'][0], 'Revision identity/text changed during read'
            result['rounds'].append(snapshot)
            print('Completed read-only round', number + 1, flush=True)
        after, _ = worker.call('selection_text')
        assert before['text'] == after['text'], 'Selection changed during read'
        result['success'] = True
    except Exception as error:
        result['failure'] = repr(error)
    finally:
        try:
            if review:
                review.stop()
                result['unoExitCode'] = review.proc.returncode
        finally:
            worker.stop()
        result['exitCode'] = worker.proc.returncode
        result['cleanupErrors'] = [error for error in (worker.cleanup_error, review.cleanup_error if review else None) if error]
        result['success'] = bool(result.get('success') and result['exitCode'] == 0
                                 and result.get('unoExitCode') == 0 and not result['cleanupErrors'])
        (out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    return 0 if result['success'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
