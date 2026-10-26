#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Apply the WASM input-clock fix before configuring/building the pinned Qt base.

Usage: python3 apply-qt-patches.py /root/lowa-build/qt5/qtbase

Source inspected: allotropia/qt5@3d440b7787f9b5ba15e5f8bcd7aef39b388f94fa,
whose qtbase gitlink is EXPECTED_QTBASE below. qwasmeventtranslator.cpp uses
emscripten_date_now() (epoch milliseconds, double), implicitly converted to the
32-bit ulong timestamp. That conversion is out of range on WASM32. Use Qt's
existing no-timestamp overloads: both use eventTime.elapsed(), a QElapsedTimer
started by QGuiApplication. No new clock, event dispatch or scrolling policy.

Low-level acceptance (not implied by patch application): compare stock r6 and
rebuilt engine using the same fixture and wrapper. Record two presses at the
same word >1s apart through QtWidget::fillSalAbstractMouseEvent; rebuilt mnTime
must advance and the second press must be a caret, not a double-click word
selection. Two rapid real clicks must still select the word. In a test-only
wrapper disable the distant reset click, then repeat selected-text-drag-move
with revisions off/on and Undo, followed by drag-wheel and four-format smoke.
Keep the production wrapper compensation for older engines until that matrix
passes. Source/anchor tests are not evidence of compiled-engine behavior.
"""

import argparse
from pathlib import Path
import subprocess
import sys

EXPECTED_QTBASE = 'a320678c85ec8029d5394bcd673d4c208af1de3a'
SOURCE = Path('src/plugins/platforms/wasm/qwasmeventtranslator.cpp')
REPLACEMENTS = (
    (
        'void QWasmEventTranslator::processMouse(int eventType, const EmscriptenMouseEvent *mouseEvent)\n'
        '{\n    auto timestamp = emscripten_date_now();\n',
        'void QWasmEventTranslator::processMouse(int eventType, const EmscriptenMouseEvent *mouseEvent)\n'
        '{\n',
    ),
    (
        '            window2, timestamp, localPoint, globalPoint, pressedButtons, button, buttonEventType, modifiers);',
        '            window2, localPoint, globalPoint, pressedButtons, button, buttonEventType, modifiers);',
    ),
    (
        '    Qt::KeyboardModifiers modifiers = translator->translateMouseEventModifier(&mouseEvent);\n'
        '    auto timestamp = emscripten_date_now();\n',
        '    Qt::KeyboardModifiers modifiers = translator->translateMouseEventModifier(&mouseEvent);\n',
    ),
    (
        '    QWindowSystemInterface::handleWheelEvent(window2, timestamp, localPoint,',
        '    QWindowSystemInterface::handleWheelEvent(window2, localPoint,',
    ),
)


def patch_source(source):
    # Validate the entire input before changing it: a partial previous patch or
    # changed/duplicated anchor must fail, rather than build a mixed clock path.
    old_counts = [source.count(old) for old, _ in REPLACEMENTS]
    if old_counts == [0] * len(REPLACEMENTS):
        if all(source.count(new) == 1 for _, new in REPLACEMENTS):
            return source
        raise ValueError('Qt input-clock patch: incomplete or changed patched anchors')
    if old_counts != [1] * len(REPLACEMENTS):
        raise ValueError('Qt input-clock patch: expected all four unique original anchors')
    for old, new in REPLACEMENTS:
        source = source.replace(old, new, 1)
    return source


def apply(qtbase):
    qtbase = Path(qtbase)
    head = subprocess.check_output(['git', '-C', str(qtbase), 'rev-parse', 'HEAD'], text=True).strip()
    if head != EXPECTED_QTBASE:
        raise ValueError('unsupported qtbase commit: ' + head)
    path = qtbase / SOURCE
    before = path.read_text(encoding='utf-8')
    after = patch_source(before)
    if after == before:
        print('QT_INPUT_CLOCK_ALREADY_APPLIED')
        return
    path.write_text(after, encoding='utf-8')
    print('QT_INPUT_CLOCK_PATCHED')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('qtbase', type=Path)
    args = parser.parse_args()
    try:
        apply(args.qtbase)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print('FAIL Qt input-clock patch: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
