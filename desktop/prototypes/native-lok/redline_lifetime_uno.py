# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Stress helper only: deliberately drops temporary UNO redlines between calls.

The ordinary review helper retains its established inline snapshot loop. This
separate helper exercises the early-release pattern seen in a real crash.
"""
import hashlib
import json
import review_uno

dispatch_review = review_uno.dispatch

def stress(method, params, model, uno):
    if method != 'stress':
        return dispatch_review(method, params, model, uno)
    redlines = model.getRedlines()
    entries = [review_uno.detail_of(redlines.getByIndex(i)) for i in range(redlines.getCount())]
    # Successor representations may contain proxy addresses. The unchanged
    # synthetic fixture is compared by native identity and actual text fields.
    for entry in entries:
        entry.pop('successor', None)
    payload = json.dumps(entries, sort_keys=True, ensure_ascii=False).encode()
    return {'count': len(entries), 'sha256': hashlib.sha256(payload).hexdigest()}

if __name__ == '__main__':
    review_uno.dispatch = stress
    review_uno.main()
