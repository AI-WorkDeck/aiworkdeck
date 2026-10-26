#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Apply WASM input fixes before configuring/building the pinned Qt base.

Usage: python3 apply-qt-patches.py /root/lowa-build/qt5/qtbase

Source inspected: allotropia/qt5@3d440b7787f9b5ba15e5f8bcd7aef39b388f94fa,
whose qtbase gitlink is EXPECTED_QTBASE below. qwasmeventtranslator.cpp uses
emscripten_date_now() (epoch milliseconds, double), implicitly converted to the
32-bit ulong timestamp. That conversion is out of range on WASM32. Use Qt's
existing no-timestamp overloads: both use eventTime.elapsed(), a QElapsedTimer
started by QGuiApplication. No new clock, event dispatch or scrolling policy.

The compositor must also honor WindowTransparentForInput (#1515). LibreOffice
marks real tooltip frames with this flag; interactive combo popups also use
Qt::ToolTip, so checking the window type would incorrectly disable them.
Only hit testing changes: stacking, painting and focus stay unchanged.

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
COMPOSITOR_SOURCE = Path('src/plugins/platforms/wasm/qwasmcompositor.cpp')
COMPOSITOR_OLD = '''        if (compositedWindow.visible && geometry.contains(globalPoint))
            return m_windowStack.at(index)->window();'''
COMPOSITOR_NEW = '''        if (compositedWindow.visible
            && !compositedWindow.window->window()->flags().testFlag(Qt::WindowTransparentForInput)
            && geometry.contains(globalPoint))
            return m_windowStack.at(index)->window();'''
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


def patch_compositor(source):
    if source.count(COMPOSITOR_OLD) == 0 and source.count(COMPOSITOR_NEW) == 1:
        return source
    if source.count(COMPOSITOR_OLD) != 1 or source.count(COMPOSITOR_NEW) != 0:
        raise ValueError('Qt input-transparent patch: expected one unique original hit-test anchor')
    return source.replace(COMPOSITOR_OLD, COMPOSITOR_NEW, 1)


def apply(qtbase):
    qtbase = Path(qtbase)
    head = subprocess.check_output(['git', '-C', str(qtbase), 'rev-parse', 'HEAD'], text=True).strip()
    if head != EXPECTED_QTBASE:
        raise ValueError('unsupported qtbase commit: ' + head)
    # Read and validate both files before any write. A missing/drifted compositor
    # must not leave a newly patched clock file behind (and vice versa).
    changes = []
    for relative, transform, label in (
        (SOURCE, patch_source, 'QT_INPUT_CLOCK'),
        (COMPOSITOR_SOURCE, patch_compositor, 'QT_INPUT_TRANSPARENT'),
    ):
        path = qtbase / relative
        before = path.read_text(encoding='utf-8')
        changes.append((path, before, transform(before), label))
    for path, before, after, label in changes:
        if after == before:
            print(label + '_ALREADY_APPLIED')
        else:
            path.write_text(after, encoding='utf-8')
            print(label + '_PATCHED')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('qtbase', type=Path)
    args = parser.parse_args()
    try:
        apply(args.qtbase)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print('FAIL Qt input patches: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
