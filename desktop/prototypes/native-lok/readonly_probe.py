# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Owned native read-only view regression, with a strictly reading UNO helper.

Uses isolated copies and fresh profiles. It does not write the source fixture,
export a read-only model, or claim UI/IME candidate-window coverage.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def helper(port):
    import uno
    from review_uno import dispatch, model_for
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    remote = resolver.resolve(f'uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext')
    desktop = remote.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', remote)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            if request['method'] != 'read_model':
                raise ValueError('Read-only probe helper refuses writes')
            model = model_for(desktop, request['params']['documentUrl'])
            result = {'text': model.getText().getString(), 'modified': model.isModified(),
                      'recordChanges': model.getPropertyValue('RecordChanges'),
                      'review': dispatch('snapshot', {}, model, uno)}
            reply = {'id': request['id'], 'result': result}
        except Exception as error:
            reply = {'id': request['id'], 'error': str(error)}
        print(json.dumps(reply, ensure_ascii=False), flush=True)


def run(args):
    from review_probe import Worker, UnoReview
    from probe import docx_projection
    out, source = args.out.resolve(), args.fixture.resolve()
    out.mkdir(parents=True, exist_ok=False)
    source_hash = digest(source)
    shutil.copyfile(source, out / 'document.docx')
    shutil.copyfile(source, out / 'writable.docx')
    result = {'worker': str(args.worker.resolve()), 'workerSha256': digest(args.worker),
              'runtime': str(args.runtime.resolve()), 'sourceSha256': source_hash,
              'checks': {}, 'rejections': [], 'cleanupErrors': [], 'passed': False}
    worker = review = None
    error = None
    try:
        worker = Worker(args.worker.resolve(), args.runtime.resolve(), out)
        opened, _ = worker.call('open', path=str(out / 'document.docx'), readOnly=True)
        worker.epoch = opened['documentEpoch']
        result['opened'] = opened
        review = UnoReview(worker, args.uno_host.resolve(), args.uno_runtime.resolve(), out, Path(__file__).resolve())
        before = review.call('read_model')
        (out / 'model-before.json').write_text(json.dumps(before, ensure_ascii=False, indent=2))
        assert len(before['review']['entries']) == 600
        worker.call('set_viewport', width=800, height=800, widthTwips=opened['widthTwips'],
                    heightTwips=opened['widthTwips'], xTwips=0, yTwips=0)
        tile, _ = worker.call('paint', width=800, height=800, widthTwips=opened['widthTwips'],
                             heightTwips=opened['widthTwips'], xTwips=0, yTwips=0)
        assert tile['pixelsChanged']
        seq = 0

        def input_call(action, **params):
            nonlocal seq
            reply, _ = worker.call(action, inputSeq=seq + 1, **params)
            seq += 1
            assert reply.get('applied') is True and reply.get('lastInputSeq') == seq, reply
            return reply

        def key(code, event=0):
            return input_call('input_key', eventType=event, charCode=0, keyCode=code)

        key(0x2000 | 512)  # Ctrl/Cmd+A, the input component's native modifier mapping.
        key(0x2000 | 512, 1)
        copied, _ = worker.call('selection_text')
        # Writer's copy returns the final projection (omitting deleted text),
        # while the UNO body can include the inline deletion representation.
        copied_final = copied['text'].replace('\r', '').replace('\n', '')
        result['checks']['copySelectedText'] = copied_final == docx_projection(source)['final']
        assert result['checks']['copySelectedText'], 'Native copy differs from the fixture final projection'
        key(1028); key(1028, 1)  # Home collapses selection before the rejected text attempt.
        attempted, _ = worker.call('input_text', require=False, inputSeq=seq + 1, text='只读禁止输入')
        result['rejections'].append({'action': 'input_text', 'reply': attempted})
        # Preserve an actual old-worker negative control: inspect model text
        # after its unprotected write, then fail the same read-only contract.
        if attempted.get('success') or opened.get('readOnly') is not True:
            after = review.call('read_model')
            result['legacyWriteAccepted'] = attempted.get('success') is True
            result['legacyTextChanged'] = before['text'] != after['text']
            (out / 'model-after.json').write_text(json.dumps(after, ensure_ascii=False, indent=2))
            raise AssertionError('READ_ONLY_DOCUMENT was not enforced before native text input')
        assert attempted.get('error') == 'READ_ONLY_DOCUMENT' and attempted['lastInputSeq'] == seq

        def reject(action, **params):
            reply, _ = worker.call(action, require=False, **params)
            result['rejections'].append({'action': action, 'params': params, 'reply': reply})
            assert reply.get('success') is False and reply.get('error') == 'READ_ONLY_DOCUMENT', reply
            if action.startswith('input_'):
                assert reply['lastInputSeq'] == seq, reply

        for code, char in [(1280, 0), (1282, 0), (1283, 0), (1286, 0),
                           (0x2000 | 513, 0), (0x2000 | 533, 0), (0x2000 | 535, 0),
                           (0x2000 | 537, 0), (0x4000 | 1029, 0), (1029, 20013)]:
            reject('input_key', inputSeq=seq + 1, eventType=0, charCode=char, keyCode=code)
        for command in ('.uno:Undo', '.uno:Redo', '.uno:Bold', '.uno:Paste', '.uno:TrackChanges', '.uno:InsertAnnotation'):
            reject('command', command=command, arguments='{}')
        reject('key', eventType=0, charCode=ord('中'), keyCode=0)
        reject('paste')
        reject('save', path=str(out / 'forbidden-export.docx'))
        snapshot, _ = worker.call('review_snapshot')
        for decision in ('accept', 'reject'):
            reject('review_resolve', refreshEpoch=snapshot['refreshEpoch'],
                   revisionId=snapshot['items'][0]['revisionId'], decision=decision)
        assert not (out / 'forbidden-export.docx').exists()
        for code in range(1024, 1032):
            key(code); key(code, 1); key(code | 0x1000); key(code | 0x1000, 1)
        key(0x2000 | 513, 1)  # Releasing a denied shortcut must not write either.
        worker.call('input_barrier', inputSeq=seq)
        result['checks']['navigationAndSequence'] = True

        snapshot, _ = worker.call('review_snapshot')
        rect = next(item['rects'][0] for item in snapshot['items'] if item['type'] == 'Insert' and item['rects'])
        x, y = int(rect['x'] + 5), int(rect['y'] + rect['height'] / 2)
        right = x + max(240, int(rect['width'] / 2))
        def mouse(kind, xpos, ypos):
            return input_call('input_mouse', eventType=kind, xTwips=xpos, yTwips=ypos,
                              clickCount=1, buttons=1, modifier=0)
        mouse(0, x, y); mouse(2, right, y); mouse(1, right, y)
        selection, _ = worker.call('selection_text')
        assert selection['text'], 'Native mouse drag did not select any text'
        result['checks']['mouseSelection'] = selection['text']
        # Attempt to drag the selected text into a different position. A view
        # marked read-only must keep this a selection/navigation operation.
        mouse(0, x + 20, y); mouse(2, right + 300, y + 300); mouse(1, right + 300, y + 300)
        after = review.call('read_model')
        (out / 'model-after.json').write_text(json.dumps(after, ensure_ascii=False, indent=2))
        for field in ('text', 'modified', 'recordChanges', 'review'):
            assert after[field] == before[field], 'Read-only operations changed ' + field
        result['checks']['modelAnd600RevisionsUnchanged'] = True
        assert digest(out / 'document.docx') == source_hash
        old_epoch = worker.epoch
        worker.call('close')

        for bad in (None, 0, 1, 'true', 'false', [], {}):
            reply, _ = worker.call('open', require=False, path=str(out / 'writable.docx'), readOnly=bad)
            assert reply.get('success') is False and reply.get('error') == 'INVALID_READ_ONLY', reply
        result['checks']['strictBoolean'] = True
        writable, _ = worker.call('open', path=str(out / 'writable.docx'), readOnly=False)
        worker.epoch = writable['documentEpoch'];seq = 0
        assert writable.get('readOnly') is False and worker.epoch != old_epoch
        stale, _ = worker.call('input_text', require=False, documentEpoch=old_epoch, inputSeq=1, text='旧回包禁止输入')
        assert stale.get('error') == 'STALE_DOCUMENT', stale
        review.url = (out / 'writable.docx').as_uri()
        key(1028); key(1028, 1)
        input_call('input_text', text='切回可写输入成功')
        writable_state = review.call('read_model')
        assert '切回可写输入成功' in writable_state['text']
        assert '旧回包禁止输入' not in writable_state['text']
        worker.call('save', path=str(out / 'writable-export.docx'))
        saved = docx_projection(out / 'writable-export.docx')
        assert '切回可写输入成功' in saved['final']
        result['checks']['writableAfterReadOnly'] = True
    except Exception as exc:
        error = exc
        result['error'] = repr(exc)
    finally:
        if review:
            review.stop(); result['unoExit'] = review.proc.returncode
            if review.cleanup_error: result['cleanupErrors'].append(review.cleanup_error)
        if worker:
            worker.stop(); result['workerExit'] = worker.proc.returncode
            if worker.cleanup_error: result['cleanupErrors'].append(worker.cleanup_error)
            (out / 'callbacks.json').write_text(json.dumps(worker.events, ensure_ascii=False, indent=2))
        result['sourceUnchanged'] = digest(source) == source_hash
        result['readonlyCopyUnchanged'] = digest(out / 'document.docx') == source_hash
        result['passed'] = (error is None and result['sourceUnchanged'] and result['readonlyCopyUnchanged']
                            and result.get('workerExit') == 0 and result.get('unoExit') == 0
                            and not result['cleanupErrors'])
        (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    if error:
        raise error
    assert result['passed'], result
    print(json.dumps({'passed': True, 'result': str(out / 'result.json')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int)
    for name in ('worker', 'runtime', 'fixture', 'uno-host', 'uno-runtime', 'out'):
        parser.add_argument('--' + name, type=Path)
    arguments = parser.parse_args()
    if arguments.port:
        helper(arguments.port)
    else:
        if not all(getattr(arguments, name) for name in ('worker', 'runtime', 'fixture', 'uno_host', 'uno_runtime', 'out')):
            parser.error('worker, runtime, fixture, uno-host, uno-runtime and out are required')
        run(arguments)
