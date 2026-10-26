// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const patcher = path.resolve(__dirname, '../lowa-build/patches/apply-qt-patches.py')
// Minimal Qt input code, including both independent event paths. It deliberately
// retains unrelated scrolling and dispatch behavior around the four anchors.
const fixture = `void QWasmEventTranslator::processMouse(int eventType, const EmscriptenMouseEvent *mouseEvent)
{
    auto timestamp = emscripten_date_now();
    QPoint targetPoint(mouseEvent->targetX, mouseEvent->targetY);
    if (window2 && interior) {
        QWindowSystemInterface::handleMouseEvent<QWindowSystemInterface::SynchronousDelivery>(
            window2, timestamp, localPoint, globalPoint, pressedButtons, button, buttonEventType, modifiers);
    }
}
void wheel_cb() {
    Qt::KeyboardModifiers modifiers = translator->translateMouseEventModifier(&mouseEvent);
    auto timestamp = emscripten_date_now();
    QPoint targetPoint(mouseEvent.targetX, mouseEvent.targetY);
    if (g_useNaturalScrolling) scrollFactor = -scrollFactor;
    QWindowSystemInterface::handleWheelEvent(window2, timestamp, localPoint,
                                             globalPoint, QPoint(), pixelDelta, modifiers);
    QWasmEventDispatcher::maintainTimers();
}
`
// windowAt code at qtbase a320678c85ec8029d5394bcd673d4c208af1de3a,
// with only blank lines and existing debug comments omitted.
const compositorFixture = `QWindow *QWasmCompositor::windowAt(QPoint globalPoint, int padding) const
{
    int index = m_windowStack.count() - 1;
    while (index >= 0) {
        const QWasmCompositedWindow &compositedWindow = m_compositedWindows[m_windowStack.at(index)];
        QRect geometry = compositedWindow.window->windowFrameGeometry()
                         .adjusted(-padding, -padding, padding, padding);
        if (compositedWindow.visible && geometry.contains(globalPoint))
            return m_windowStack.at(index)->window();
        --index;
    }
    return 0;
}
`
function run(body, source = fixture, compositor = compositorFixture) {
  return spawnSync('python3', ['-c', `
import importlib.util, json, sys, tempfile
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('qt_patch', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
payload = json.load(sys.stdin)
source, compositor = payload['source'], payload['compositor']
def make_tree(root):
    target = root / m.SOURCE
    target.parent.mkdir(parents=True)
    target.write_text(source)
    hit_test = root / m.COMPOSITOR_SOURCE
    hit_test.write_text(compositor)
    return target, hit_test
${body}
`, patcher], { input: JSON.stringify({ source, compositor }), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
}
function succeeds(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

test('both event paths use existing Qt elapsed-time overloads and retain dispatch/scrolling', () => {
  const result = succeeds(run('print(m.patch_source(source), end="")'))
  assert.doesNotMatch(result, /emscripten_date_now|window2, timestamp/)
  assert.match(result, /handleMouseEvent<QWindowSystemInterface::SynchronousDelivery>\(\n            window2, localPoint/)
  assert.match(result, /handleWheelEvent\(window2, localPoint,/)
  assert.match(result, /if \(g_useNaturalScrolling\) scrollFactor = -scrollFactor;/)
  assert.match(result, /QWasmEventDispatcher::maintainTimers\(\);/)
  assert.equal(result, fixture.replaceAll('    auto timestamp = emscripten_date_now();\n', '').replaceAll('window2, timestamp,', 'window2,'))
})

test('applying twice leaves the exact first result', () => {
  succeeds(run('once = m.patch_source(source)\nassert m.patch_source(once) == once'))
})

for (const [name, source] of [
  ['missing wheel path', fixture.replace('handleWheelEvent(window2, timestamp,', 'handleWheelEvent(window3, timestamp,')],
  ['duplicated original anchors', fixture + fixture],
  ['partial previous application', fixture.replace('window2, timestamp, localPoint, globalPoint, pressedButtons', 'window2, localPoint, globalPoint, pressedButtons')],
]) {
  test(`rejects ${name} without writing the file`, () => {
    succeeds(run(`
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    target, hit_test = make_tree(root)
    with patch.object(m.subprocess, 'check_output', return_value=m.EXPECTED_QTBASE):
        try:
            m.apply(root)
        except ValueError:
            pass
        else:
            raise AssertionError('invalid source accepted')
    assert target.read_text() == source
    assert hit_test.read_text() == compositor
`, source))
  })
}

test('rejects unpinned Qt commit before modifying source', () => {
  succeeds(run(`
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    target, hit_test = make_tree(root)
    with patch.object(m.subprocess, 'check_output', return_value='0' * 40):
        try:
            m.apply(root)
        except ValueError as error:
            assert 'unsupported qtbase commit' in str(error)
        else:
            raise AssertionError('wrong commit accepted')
    assert target.read_text() == source
    assert hit_test.read_text() == compositor
`))
})

test('pinned source writes once and repeat application preserves modification time', () => {
  succeeds(run(`
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    target, hit_test = make_tree(root)
    with patch.object(m.subprocess, 'check_output', return_value=m.EXPECTED_QTBASE):
        m.apply(root)
        first = target.read_text()
        stamp = target.stat().st_mtime_ns
        first_hit_test = hit_test.read_text()
        hit_test_stamp = hit_test.stat().st_mtime_ns
        m.apply(root)
        assert target.read_text() == first
        assert target.stat().st_mtime_ns == stamp
        assert hit_test.read_text() == first_hit_test
        assert hit_test.stat().st_mtime_ns == hit_test_stamp
`))
})

test('hit testing honors input transparency without excluding interactive tooltip-type popups', () => {
  const result = succeeds(run('print(m.patch_compositor(compositor), end="")'))
  assert.equal(result, compositorFixture.replace(
    'if (compositedWindow.visible && geometry.contains(globalPoint))',
    'if (compositedWindow.visible\n            && !compositedWindow.window->window()->flags().testFlag(Qt::WindowTransparentForInput)\n            && geometry.contains(globalPoint))'))
  assert.doesNotMatch(result, /Qt::ToolTip|Qt::Popup/)
  succeeds(run('once = m.patch_compositor(compositor)\nassert m.patch_compositor(once) == once'))
})

for (const mode of ['missing file', 'changed anchor', 'duplicate anchor', 'mixed original and patched']) {
  test(`rejects compositor ${mode} before writing either source`, () => {
    succeeds(run(`
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    target, hit_test = make_tree(root)
    mode = ${JSON.stringify(mode)}
    if mode == 'missing file':
        hit_test.unlink()
    elif mode == 'changed anchor':
        hit_test.write_text(compositor.replace('geometry.contains(globalPoint)', 'geometry.contains(otherPoint)'))
    elif mode == 'duplicate anchor':
        hit_test.write_text(compositor + compositor)
    else:
        hit_test.write_text(compositor + m.patch_compositor(compositor))
    before = hit_test.read_text() if hit_test.exists() else None
    with patch.object(m.subprocess, 'check_output', return_value=m.EXPECTED_QTBASE):
        try:
            m.apply(root)
        except (ValueError, FileNotFoundError):
            pass
        else:
            raise AssertionError('invalid compositor accepted')
    assert target.read_text() == source
    assert (hit_test.read_text() if hit_test.exists() else None) == before
`))
  })
}

test('adds hit-test fix to an already clock-patched tree without rewriting clock source', () => {
  succeeds(run(`
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    target, hit_test = make_tree(root)
    target.write_text(m.patch_source(source))
    before = target.read_text()
    stamp = target.stat().st_mtime_ns
    with patch.object(m.subprocess, 'check_output', return_value=m.EXPECTED_QTBASE):
        m.apply(root)
    assert target.read_text() == before
    assert target.stat().st_mtime_ns == stamp
    assert hit_test.read_text() == m.patch_compositor(compositor)
`))
})

test('command line reports nonzero on absent Qt source checkout', () => {
  const result = spawnSync('python3', [patcher, '/nonexistent/awd-qt-patch-source'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /FAIL Qt input patches/)
})
