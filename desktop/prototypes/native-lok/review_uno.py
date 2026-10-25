# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""URL-bound, read-only review details and typed display state over an owned LOK bridge.

Run only with an explicitly isolated/read-only pyuno runtime. Never bootstraps soffice.
"""
import argparse
import json
import sys
import uno

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, required=True)
args = parser.parse_args()
if not 0 < args.port < 65536:
    raise ValueError('Invalid loopback port')
local = uno.getComponentContext()
resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
remote = resolver.resolve(f'uno:socket,host=127.0.0.1,port={args.port};urp;StarOffice.ComponentContext')
desktop = remote.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', remote)


def model_for(url):
    components = desktop.getComponents().createEnumeration()
    matches = []
    while components.hasMoreElements():
        model = components.nextElement()
        if model.supportsService('com.sun.star.text.TextDocument') and model.getURL() == url:
            matches.append(model)
    if len(matches) != 1:
        raise RuntimeError('Expected exactly one URL-bound Writer model')
    return matches[0]


def dispatch(method, params):
    doc = model_for(params['documentUrl'])
    ctrl = doc.getCurrentController()
    if method == 'verify_location':
        redlines = doc.getRedlines()
        matches = []
        for i in range(redlines.getCount()):
            candidate = redlines.getByIndex(i)
            if str(candidate.getPropertyValue('RedlineIdentifier')) == params['identifier']:
                matches.append(candidate)
        if len(matches) != 1:
            raise RuntimeError('Revision identity is no longer unique')
        revision = matches[0]
        start, end = revision.getPropertyValue('RedlineStart'), revision.getPropertyValue('RedlineEnd')
        cursor = ctrl.getViewCursor()
        text = start.getText()
        located = (text.compareRegionStarts(start, cursor.getStart()) == 0
                   and text.compareRegionEnds(end, cursor.getEnd()) == 0)
        if not located:
            raise RuntimeError('The native selection does not match the requested revision')
        return {'located': True, 'identifier': params['identifier']}
    if method == 'view':
        if params['mode'] not in ('all', 'final'):
            raise ValueError('Unsupported display mode')
        value = 0 if params['mode'] == 'final' else 2
        uno.invoke(doc, 'setPropertyValue', ('RedlineDisplayType', uno.Any('short', value)))
        actual = doc.getPropertyValue('RedlineDisplayType')
        # Writer normalizes NONE(0) to INSERTED(1). The existing editor verifies
        # the readable ShowChanges property, not enum equality after normalization.
        shown = doc.getPropertyValue('ShowChanges')
        if shown != (params['mode'] == 'all'):
            raise RuntimeError('Display mode was not applied')
        return {'mode': params['mode'], 'displayType': actual, 'showChanges': shown}
    if method != 'snapshot':
        raise ValueError('Unsupported review operation')
    info = ctrl.getPropertySetInfo()
    capabilities = {name: info.hasPropertyByName(name) for name in ('AwdReviewGeometry', 'AwdReviewSidebarWidth')}
    entries = []
    redlines = doc.getRedlines()
    for index in range(redlines.getCount()):
        revision = redlines.getByIndex(index)
        text = None
        hidden = revision.getPropertyValue('RedlineText')
        if hidden:
            text = hidden.getString()
        if text is None:
            start = revision.getPropertyValue('RedlineStart')
            end = revision.getPropertyValue('RedlineEnd')
            cursor = start.getText().createTextCursorByRange(start)
            cursor.gotoRange(end, True)
            text = cursor.getString()
        date = revision.getPropertyValue('RedlineDateTime')
        entries.append({'identifier': str(revision.getPropertyValue('RedlineIdentifier')),
                        'author': revision.getPropertyValue('RedlineAuthor'),
                        'type': revision.getPropertyValue('RedlineType'), 'text': text,
                        'dateTime': f'{date.Year:04}-{date.Month:02}-{date.Day:02}T{date.Hours:02}:{date.Minutes:02}:{date.Seconds:02}',
                        'successor': str(revision.getPropertyValue('RedlineSuccessorData'))})
    return {'entries': entries, 'controllerCapabilities': capabilities,
            'displayType': doc.getPropertyValue('RedlineDisplayType')}


for line in sys.stdin:
    request = json.loads(line)
    try:
        response = {'id': request['id'], 'result': dispatch(request['method'], request['params'])}
    except Exception as error:
        response = {'id': request['id'], 'error': str(error)}
    print(json.dumps(response, ensure_ascii=False), flush=True)
