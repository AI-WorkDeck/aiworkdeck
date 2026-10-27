// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const LOWA_DIR = path.join(REPO_ROOT, 'desktop', 'lowa-build')
const APPLY_PATCHES_PY = path.join(LOWA_DIR, 'patches', 'apply-source-patches.py')
const FS_IMAGE_PATCH_PY = path.join(LOWA_DIR, 'patches', 'fs-image-patch.py')
const ELYOFFICE_UPSTREAM_DIR = path.join(LOWA_DIR, 'upstream', 'elyoffice')
const AUDIT_MD = path.join(LOWA_DIR, 'ELYOFFICE_PATCH_AUDIT.md')
const ROOT_UPSTREAM_MD = path.join(REPO_ROOT, 'UPSTREAM.md')

function writeFileEnsured(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function createMockLibreOfficeTree(rootDir, { use242Layout = false } = {}) {
  writeFileEnsured(path.join(rootDir, 'vcl/qt5/QtFrame.cxx'), [
    '        else if (nStyle & SalFrameStyleFlags::TOOLTIP)',
    '            aWinFlags = Qt::ToolTip;',
    '        else if (isPopup())',
    '            aWinFlags = Qt::ToolTip | Qt::FramelessWindowHint;',
    '',
  ].join('\n'))
  // Exact changed anchors from core dced3bc711d18407a2cc2400eb46e8261b663d95.
  // This fixture validates patch application, not compiled Calc UI behavior.
  writeFileEnsured(path.join(rootDir, 'sc/source/ui/view/hdrcont.cxx'), [
    '    aNormFont = GetFont();',
    '    const StyleSettings& rStyleSettings = GetSettings().GetStyleSettings();',
    '    aSelLineColor.Merge( COL_BLACK, 0xe0 );        // darken just a little bit',
    '',
  ].join('\n'))

  writeFileEnsured(
    path.join(rootDir, 'solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk'),
    [
      '# Mock EMSCRIPTEN_INTEL_GCC.mk',
      'gb_LinkTarget_LDFLAGS += -s EXPORTED_RUNTIME_METHODS=["ClassHandle"$(if $(ENABLE_QT6),$(COMMA)"FS"$(COMMA)"callMain"$(COMMA)"specialHTMLTargets")]',
      '',
    ].join('\n')
  )

  writeFileEnsured(
    path.join(rootDir, 'vcl/qt5/QtInstance.cxx'),
    [
      '#include <QtWidgets/QApplication>',
      'void QtInstance::AfterAppInit()',
      '{',
      '    QApplication::setLayoutDirection(AllSettings::GetLayoutRTL() ? Qt::RightToLeft',
      ': Qt::LeftToRight);',
      '}',
      '',
    ].join('\n')
  )

  const frmpaintRel = use242Layout
    ? 'sw/source/core/layout/frmpaint.cxx'
    : 'sw/source/core/text/frmpaint.cxx'
  writeFileEnsured(
    path.join(rootDir, frmpaintRel),
    [
      '#include <viewopt.hxx>',
      'void SwExtraPainter::PaintExtra( SwTwips nY, tools::Long nAsc, tools::Long nMax, bool bRed, const OUString* pRedlineText )',
      '{',
      '    Point aTmpPos( m_nX, nY );',
      '    aTmpPos.AdjustY(nAsc );',
      '    if ( pRedlineText )',
      '    {',
      '        Size aSize = pTmpFnt->GetTextSize_( aDrawInf );',
      '        aTmpPos.AdjustX( -(aSize.Width()) - 200 );',
      '    }',
      '}',
      '',
    ].join('\n')
  )

  writeFileEnsured(
    path.join(rootDir, 'desktop/source/lib/init.cxx'),
    [
      '#include <sfx2/viewsh.hxx>',
      '#include <sfx2/viewfrm.hxx>',
      '#include <sfx2/dispatch.hxx>',
      'static bool doc_iniUnoCommands(LibreOfficeKitDocument* pThis, const char* pCommand)',
      '{',
      '    bool bResult = false;',
      '    if (bNotifyWhenFinished && pDocument->mpCallbackFlushHandlers.count(nView))',
      '    {',
      '        bResult = comphelper::dispatchCommand(aCommand, comphelper::containerToSequence(aPropertyValuesVector),',
      '                new DispatchResultListener(pCommand, pDocument->mpCallbackFlushHandlers[nView],',
      '                                           pDocSh && pDocSh->IsModified()));',
      '    }',
      '    else',
      '        bResult = comphelper::dispatchCommand(aCommand, comphelper::containerToSequence(aPropertyValuesVector));',
      '    {',
      '        updateConfig(OUString(pValue, strlen(pValue), RTL_TEXTENCODING_UTF8));',
      '    }',
      '                                if (x.mOriginalFont.indexOf(\'/\') == -1)',
      '                                    for (const auto &j : x.mUsedFonts)',
      '                                        if (j == x.mOriginalFont ||',
      '                                            j.startsWith(Concat2View(x.mOriginalFont + "/")))',
      '                                            return true;',
      '    return bResult;',
      '}',
      'void CallbackFlushHandler::scheduleFlush()',
      '{',
      '    if (!m_pFlushEvent)',
      '        m_pFlushEvent = Application::PostUserEvent(LINK(this, CallbackFlushHandler, FlushQueue));',
      '}',
      '',
    ].join('\n')
  )

  if (use242Layout) {
    writeFileEnsured(
      path.join(rootDir, 'vcl/jsdialog/executor.cxx'),
      [
        '#include <vcl/jsdialog/executor.hxx>',
        'bool ExecuteAction(const std::string& nWindowId, const OString& rWidget, StringMap& rData)',
        '{',
        '    vcl::Window* pWindow = vcl::Window::FindLOKWindow(std::stoull(nWindowId));',
        '    return pWindow != nullptr;',
        '}',
        '',
      ].join('\n')
    )
    writeFileEnsured(
      path.join(rootDir, 'vcl/source/window/builder.cxx'),
      [
        'void JSDialogNotifyIdle::Invoke()',
        '{',
        '    sendMessage();',
        '}',
        '',
      ].join('\n')
    )
  } else {
    writeFileEnsured(
      path.join(rootDir, 'vcl/jsdialog/jsdialogsender.cxx'),
      [
        'void JSDialogSender::send()',
        '{',
        '    {',
        '        std::scoped_lock aGuard(m_aQueueMutex);',
        '        std::swap(aMessageQueue, m_aMessageQueue);',
        '    }',
        '',
        '    for (auto& rMessage : aMessageQueue)',
        '    {',
        '    }',
        '}',
        '',
      ].join('\n')
    )
  }

  writeFileEnsured(
    path.join(rootDir, 'vcl/source/outdev/font.cxx'),
    [
      'bool OutputDevice::IsFontAvailable(const OUString& rFontName) const',
      '{',
      '    if (rFontName.indexOf(\';\') != -1)',
      '    {',
      '        return rFontName == aUsedFamily;',
      '    }',
      '    return false;',
      '}',
      '',
    ].join('\n')
  )

  writeFileEnsured(
    path.join(rootDir, 'svx/sdi/svx.sdi'),
    [
      'SvxSizeItem AttributePageSize SID_ATTR_PAGE_SIZE',
      '(',
      '    SvxSizeItem AttributePageSize SID_ATTR_PAGE_SIZE,',
      '    SfxUInt16Item PaperFormat FN_PARAM_1',
      ')',
      '',
    ].join('\n')
  )

  writeFileEnsured(
    path.join(rootDir, 'sw/sdi/swriter.sdi'),
    [
      'SfxVoidItem InsertCaptionDialog FN_INSERT_CAPTION',
      '()',
      'SfxVoidItem InsertMultiIndex FN_INSERT_MULTI_TOX',
      '()',
      'SfxVoidItem InsertObjectStarMath FN_INSERT_SMA',
      '()',
      '',
    ].join('\n')
  )

  writeFileEnsured(
    path.join(rootDir, 'sw/source/uibase/shells/textidx.cxx'),
    [
      'void SwTextShell::ExecIdx(SfxRequest const& rReq)',
      '{',
      '    switch (rReq.GetSlot())',
      '    {',
      '        case FN_INSERT_MULTI_TOX:',
      '        {',
      '            break;',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n')
  )

  writeFileEnsured(
    path.join(rootDir, 'sw/source/uibase/shells/textsh.cxx'),
    [
      'void SwTextShell::ExecInsert(SfxRequest &rReq)',
      '{',
      '    switch (rReq.GetSlot())',
      '    {',
      '    case FN_INSERT_SMA:',
      '        {',
      '            break;',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n')
  )

  writeFileEnsured(
    path.join(rootDir, 'sw/source/uibase/uno/loktxdoc.cxx'),
    [
      '/// Implements getCommandValues(".uno:Sections").',
      'void GetSections(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell)',
      '{',
      '}',
      'void SwXTextDocument::getCommandValues(tools::JsonWriter& rJsonWriter, std::string_view rCommand)',
      '{',
      '    if (false) {}',
      '    else if (o3tl::starts_with(rCommand, ".uno:Layout"sv))',
      '    {',
      '        GetLayout(rJsonWriter, m_pDocShell);',
      '    }',
      '}',
      '',
    ].join('\n')
  )

  // Mock instdir/share/extensions for slim_dictionaries verification
  writeFileEnsured(path.join(rootDir, 'instdir/share/extensions/dict-en/en_US.aff'), 'SET UTF-8\n')
  writeFileEnsured(path.join(rootDir, 'instdir/share/extensions/dict-en/Lightproof.py'), 'import uno\n')
  writeFileEnsured(path.join(rootDir, 'instdir/share/extensions/dict-en/Lightproof.components'), '<components/>\n')
  writeFileEnsured(path.join(rootDir, 'instdir/share/extensions/dict-en/pythonpath/lightproof_en.py'), 'pkg="en"\n')
  writeFileEnsured(
    path.join(rootDir, 'instdir/share/extensions/dict-en/META-INF/manifest.xml'),
    [
      '<manifest:manifest>',
      '  <manifest:file-entry manifest:full-path="Lightproof.components" manifest:media-type="application/vnd.sun.star.uno-components"/>',
      '  <manifest:file-entry manifest:full-path="dialog/OptionsDialog.xcs" manifest:media-type="application/vnd.sun.star.configuration-schema"/>',
      '  <manifest:file-entry manifest:full-path="en_US.aff" manifest:media-type="application/octet-stream"/>',
      '</manifest:manifest>',
      '',
    ].join('\n')
  )
  writeFileEnsured(path.join(rootDir, 'instdir/share/extensions/dict-fr/fr.dic'), 'bonjour\n')
  writeFileEnsured(path.join(rootDir, 'instdir/share/extensions/dict-de/de.dic'), 'hallo\n')
  writeFileEnsured(path.join(rootDir, 'instdir/share/extensions/dict-zh-CN/zh_CN.dic'), '你好\n')
}

function snapshotFiles(rootDir) {
  const out = new Map()
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        out.set(path.relative(rootDir, full), fs.readFileSync(full, 'utf8'))
      }
    }
  }
  walk(rootDir)
  return out
}

test('audit document, root UPSTREAM.md, and curated ElyOffice patch archive exist with required provenance', () => {
  assert.ok(fs.existsSync(AUDIT_MD), 'ELYOFFICE_PATCH_AUDIT.md must exist')
  assert.ok(fs.existsSync(ROOT_UPSTREAM_MD), 'root UPSTREAM.md must exist')
  assert.ok(fs.existsSync(ELYOFFICE_UPSTREAM_DIR), 'upstream/elyoffice directory must exist')

  const auditText = fs.readFileSync(AUDIT_MD, 'utf8')
  assert.match(auditText, /0d991e1c715859abd1282981fd46989e7e2319c7/)
  assert.match(auditText, /0001-/)
  assert.match(auditText, /0051-/)
  assert.match(auditText, /Tier A/)
  assert.match(auditText, /Tier B/)

  const upstreamText = fs.readFileSync(ROOT_UPSTREAM_MD, 'utf8')
  assert.match(upstreamText, /0d991e1c715859abd1282981fd46989e7e2319c7/)
  assert.match(upstreamText, /AGPL-3\.0-or-later/)
  assert.match(upstreamText, /distro\/allotropia\/zeta-24-2/)

  const patchFiles = fs.readdirSync(ELYOFFICE_UPSTREAM_DIR).filter((f) => f.endsWith('.patch')).sort()
  const expectedPrefixes = [
    '0002-',
    '0005-',
    '0006-',
    '0008-',
    '0009-',
    '0010-',
    '0011-',
    '0013-',
    '0043-',
    '0045-',
    '0048-',
    '0049-',
    '0050-',
    '0051-',
  ]
  assert.equal(patchFiles.length, expectedPrefixes.length)
  for (let i = 0; i < expectedPrefixes.length; i++) {
    assert.ok(
      patchFiles[i].startsWith(expectedPrefixes[i]),
      `Expected patch ${patchFiles[i]} to start with ${expectedPrefixes[i]}`
    )
  }
})

test('apply-source-patches.py applies all C++ kernel & dictionary patches cleanly and is strictly idempotent', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-lowa-patches-'))
  try {
    createMockLibreOfficeTree(tmpDir)

    const run1 = spawnSync(
      'python3',
      [APPLY_PATCHES_PY, tmpDir, '--slim-dictionaries', '--keep-dicts=en,zh'],
      { encoding: 'utf8' }
    )
    assert.equal(run1.status, 0, `First run failed:\n${run1.stderr}\n${run1.stdout}`)

    // Verify key anchors in patched files
    const gbuildMk = fs.readFileSync(path.join(tmpDir, 'solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk'), 'utf8')
    assert.match(gbuildMk, /"ClassHandle"\$\(COMMA\)"FS"\$\(COMMA\)"callMain"\$\(COMMA\)"specialHTMLTargets"\]/)

    const qtInstanceCxx = fs.readFileSync(path.join(tmpDir, 'vcl/qt5/QtInstance.cxx'), 'utf8')
    assert.match(qtInstanceCxx, /AAA-CJK\.ttc/)

    const qtFrameCxx = fs.readFileSync(path.join(tmpDir, 'vcl/qt5/QtFrame.cxx'), 'utf8')
    assert.match(qtFrameCxx, /SalFrameStyleFlags::TOOLTIP\)\n        \{\n            aWinFlags = Qt::ToolTip;\n            if \(QGuiApplication::platformName\(\) == "wasm"\)\n                aWinFlags \|= Qt::WindowTransparentForInput;/)
    assert.match(qtFrameCxx, /else if \(isPopup\(\)\)\n            aWinFlags = Qt::ToolTip \| Qt::FramelessWindowHint;/)
    assert.equal(qtFrameCxx.match(/WindowTransparentForInput/g).length, 1)

    const frmpaintCxx = fs.readFileSync(path.join(tmpDir, 'sw/source/core/text/frmpaint.cxx'), 'utf8')
    assert.match(frmpaintCxx, /FindTabFrame\(\)/)
    assert.match(frmpaintCxx, /GetExternalReviewWidth\(\)/)

    const initCxx = fs.readFileSync(path.join(tmpDir, 'desktop/source/lib/init.cxx'), 'utf8')
    assert.match(initCxx, /GetViewFrame\(\)\.GetFrame\(\)\.GetFrameInterface\(\)/)
    assert.match(initCxx, /strcmp\(pOption, "author"\) == 0/)
    assert.match(initCxx, /GetEnglishSearchFontName/)

    const senderCxx = fs.readFileSync(path.join(tmpDir, 'vcl/jsdialog/jsdialogsender.cxx'), 'utf8')
    assert.match(senderCxx, /m_aNotifierWindow->isDisposed\(\)/)

    const fontCxx = fs.readFileSync(path.join(tmpDir, 'vcl/source/outdev/font.cxx'), 'utf8')
    assert.match(fontCxx, /GetEnglishSearchFontName/)

    const svxSdi = fs.readFileSync(path.join(tmpDir, 'svx/sdi/svx.sdi'), 'utf8')
    assert.match(svxSdi, /SvxPageItem AttributePage SID_ATTR_PAGE/)

    const swriterSdi = fs.readFileSync(path.join(tmpDir, 'sw/sdi/swriter.sdi'), 'utf8')
    assert.match(swriterSdi, /SfxStringItem Category FN_PARAM_1/)
    assert.match(swriterSdi, /SfxStringItem Title FN_PARAM_1/)
    assert.match(swriterSdi, /SfxStringItem Formula FN_PARAM_1/)

    const loktxdocCxx = fs.readFileSync(path.join(tmpDir, 'sw/source/uibase/uno/loktxdoc.cxx'), 'utf8')
    assert.match(loktxdocCxx, /void GetWordCount\(/)
    assert.match(loktxdocCxx, /void GetOutline\(/)

    // The embedded C++ palette must remain in sync with the product tokens.
    const header = fs.readFileSync(path.join(tmpDir, 'sc/source/ui/view/hdrcont.cxx'), 'utf8')
    const roles = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'design/tokens/awd-palette.json'), 'utf8')).roles
    const roleBySetter = { FaceColor: 'bg', ButtonTextColor: 'text-2', DarkShadowColor: 'border', AccentColor: 'accent', HighlightColor: 'accent-text' }
    for (const [setter, role] of Object.entries(roleBySetter)) {
      const colors = header.match(new RegExp(`Set${setter}\\(bHeaderDark \\? Color\\(0x([A-Fa-f0-9]{6})\\) : Color\\(0x([A-Fa-f0-9]{6})\\)\\)`))
      assert.ok(colors, `${setter} must have explicit light and dark colors`)
      assert.equal('#' + colors[1], roles.dark[role])
      assert.equal('#' + colors[2], roles.light[role])
    }
    const selectedText = header.match(/SetHighlightTextColor\(Color\(0x([A-Fa-f0-9]{6})\)\)/)
    assert.equal('#' + selectedText[1], roles.light['text-on-accent'])
    assert.equal('#' + selectedText[1], roles.dark['text-on-accent'])

    // Verify instdir dictionary slimming & Lightproof removal
    assert.ok(fs.existsSync(path.join(tmpDir, 'instdir/share/extensions/dict-en/en_US.aff')))
    assert.ok(fs.existsSync(path.join(tmpDir, 'instdir/share/extensions/dict-zh-CN/zh_CN.dic')))
    assert.ok(!fs.existsSync(path.join(tmpDir, 'instdir/share/extensions/dict-fr')))
    assert.ok(!fs.existsSync(path.join(tmpDir, 'instdir/share/extensions/dict-de')))
    assert.ok(!fs.existsSync(path.join(tmpDir, 'instdir/share/extensions/dict-en/Lightproof.py')))
    assert.ok(!fs.existsSync(path.join(tmpDir, 'instdir/share/extensions/dict-en/Lightproof.components')))
    assert.ok(!fs.existsSync(path.join(tmpDir, 'instdir/share/extensions/dict-en/pythonpath')))
    const manifestXml = fs.readFileSync(
      path.join(tmpDir, 'instdir/share/extensions/dict-en/META-INF/manifest.xml'),
      'utf8'
    )
    assert.doesNotMatch(manifestXml, /Lightproof\.components/)
    assert.match(manifestXml, /en_US\.aff/)

    const afterRun1 = snapshotFiles(tmpDir)

    // Run a second time to verify strict idempotency
    const run2 = spawnSync(
      'python3',
      [APPLY_PATCHES_PY, tmpDir, '--slim-dictionaries', '--keep-dicts=en,zh'],
      { encoding: 'utf8' }
    )
    assert.equal(run2.status, 0, `Second run failed:\n${run2.stderr}\n${run2.stdout}`)

    const afterRun2 = snapshotFiles(tmpDir)
    assert.deepEqual(afterRun2, afterRun1, 'Second run must be a strict no-op')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('apply-source-patches.py also supports LibreOffice 24.2 file paths (layout/frmpaint.cxx, executor.cxx, builder.cxx)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-lowa-patches-242-'))
  try {
    createMockLibreOfficeTree(tmpDir, { use242Layout: true })

    const run1 = spawnSync('python3', [APPLY_PATCHES_PY, tmpDir], { encoding: 'utf8' })
    assert.equal(run1.status, 0, `24.2 layout run failed:\n${run1.stderr}\n${run1.stdout}`)

    const frmpaint = fs.readFileSync(path.join(tmpDir, 'sw/source/core/layout/frmpaint.cxx'), 'utf8')
    assert.match(frmpaint, /FindTabFrame\(\)/)

    const executor = fs.readFileSync(path.join(tmpDir, 'vcl/jsdialog/executor.cxx'), 'utf8')
    assert.match(executor, /pWindow->isDisposed\(\)/)

    const builder = fs.readFileSync(path.join(tmpDir, 'vcl/source/window/builder.cxx'), 'utf8')
    assert.match(builder, /m_aNotifierWindow->isDisposed\(\)/)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('Calc header patch rejects a missing target or changed upstream font anchor', () => {
  for (const missing of [true, false]) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-lowa-calc-drift-'))
    try {
      createMockLibreOfficeTree(tmpDir)
      const header = path.join(tmpDir, 'sc/source/ui/view/hdrcont.cxx')
      if (missing) fs.unlinkSync(header)
      else fs.writeFileSync(header, fs.readFileSync(header, 'utf8').replace('aNormFont = GetFont();', 'aNormFont = GetControlFont();'))
      const result = spawnSync('python3', [APPLY_PATCHES_PY, tmpDir], { encoding: 'utf8' })
      assert.notEqual(result.status, 0)
      assert.match(result.stdout, /FAIL Calc header UI font:/)
      assert.doesNotMatch(result.stdout, /ALL_PATCHES_OK/)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }
})

test('WASM tooltip patch rejects changed or duplicated tooltip anchors', () => {
  for (const duplicate of [false, true]) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-lowa-tooltip-drift-'))
    try {
      createMockLibreOfficeTree(tmpDir)
      const target = path.join(tmpDir, 'vcl/qt5/QtFrame.cxx')
      const source = fs.readFileSync(target, 'utf8')
      const invalid = duplicate ? source + source : source.replace('SalFrameStyleFlags::TOOLTIP', 'SalFrameStyleFlags::FLOAT')
      fs.writeFileSync(target, invalid)
      const result = spawnSync('python3', [APPLY_PATCHES_PY, tmpDir], { encoding: 'utf8' })
      assert.notEqual(result.status, 0)
      assert.match(result.stdout, /FAIL WASM tooltip input transparency:/)
      assert.equal(fs.readFileSync(target, 'utf8'), invalid)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }
})

test('fs-image-patch.py strips Lightproof.py and non-zh/en dicts while preserving dict-en, zh-CN langpack, and exact byte offsets', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-fs-image-'))
  try {
    // 1. Create a mock CustomTarget_emscripten_fs_image.mk
    const mkPath = path.join(tmpDir, 'static', 'CustomTarget_emscripten_fs_image.mk')
    writeFileEnsured(
      mkPath,
      [
        'gb_emscripten_fs_image_files := \\',
        '    $(INSTROOT)/share/registry/main.xcd',
        'endif # !ENABLE_WASM_STRIP_CHART',
        '',
      ].join('\n')
    )

    // 2. Create a mock soffice.data + soffice.data.js.metadata + soffice.js.metadata
    const entries = [
      {
        filename: '/instdir/share/extensions/dict-en/en_US.aff',
        payload: Buffer.from('SET UTF-8\nTRY esianrtolcdugmphbyfvkwzESIANRTOLCDUGMPHBYFVKWZ\n', 'utf8'),
        mustKeep: true,
      },
      {
        filename: '/instdir/share/extensions/dict-en/Lightproof.py',
        payload: Buffer.from('# Lightproof Python grammar checker (broken in WASM)\nimport uno\n', 'utf8'),
        mustKeep: false,
      },
      {
        filename: '/instdir/share/extensions/dict-en/Lightproof.components',
        payload: Buffer.from('<components><component loader="com.sun.star.loader.Python"/></components>', 'utf8'),
        mustKeep: false,
      },
      {
        filename: '/instdir/share/extensions/dict-en/pythonpath/lightproof_en.py',
        payload: Buffer.from('pkg = "en"\n', 'utf8'),
        mustKeep: false,
      },
      {
        filename: '/instdir/share/extensions/dict-fr/fr.dic',
        payload: Buffer.from('100\nbonjour\nmonde\n', 'utf8'),
        mustKeep: false,
      },
      {
        filename: '/instdir/share/extensions/dict-de/de_DE_frami.dic',
        payload: Buffer.from('100\nHallo\nWelt\n', 'utf8'),
        mustKeep: false,
      },
      {
        filename: '/instdir/share/extensions/dict-zh-CN/zh_CN.dic',
        payload: Buffer.from('你好\n世界\n', 'utf8'),
        mustKeep: true,
      },
      {
        filename: '/instdir/share/registry/Langpack-zh-CN.xcd',
        payload: Buffer.from('<oor:data xmlns:oor="http://openoffice.org/2001/registry">zh-CN</oor:data>', 'utf8'),
        mustKeep: true,
      },
      {
        filename: '/instdir/share/registry/ZZZ-aiworkdeck-locale-zh-CN.xcd',
        payload: Buffer.from('<oor:data>ooLocale=zh-CN</oor:data>', 'utf8'),
        mustKeep: true,
      },
      {
        filename: '/instdir/program/resource/zh_CN/LC_MESSAGES/sw.mo',
        payload: Buffer.from('\xde\x12\x04\x95\x00\x00\x00\x00zh_CN_sw_mo_catalog', 'binary'),
        mustKeep: true,
      },
      {
        filename: '/instdir/share/fonts/truetype/LiberationSans-Regular.ttf',
        payload: Buffer.from('TTF_LIBERATION_SANS', 'utf8'),
        mustKeep: true,
      },
      {
        filename: '/instdir/share/fonts/truetype/opens___.ttf',
        payload: Buffer.from('TTF_OPENSYMBOL', 'utf8'),
        mustKeep: true,
      },
      {
        filename: '/instdir/share/fonts/truetype/LinLibertine_R.ttf',
        payload: Buffer.from('TTF_LINLIBERTINE_BLOATED', 'utf8'),
        mustKeep: false,
      },
    ]

    const chunks = []
    const metaFiles = []
    let cursor = 0
    for (const item of entries) {
      const start = cursor
      const end = start + item.payload.length
      chunks.push(item.payload)
      metaFiles.push({ filename: item.filename, start, end })
      cursor = end
    }

    const dataPath = path.join(tmpDir, 'soffice.data')
    const dataMetaPath = path.join(tmpDir, 'soffice.data.js.metadata')
    const jsMetaPath = path.join(tmpDir, 'soffice.js.metadata')

    fs.writeFileSync(dataPath, Buffer.concat(chunks))
    const initialMetaJson = JSON.stringify({
      files: metaFiles,
      remote_package_size: cursor,
    })
    fs.writeFileSync(dataMetaPath, initialMetaJson, 'utf8')
    fs.writeFileSync(jsMetaPath, initialMetaJson, 'utf8')

    // First run
    const run1 = spawnSync('python3', [FS_IMAGE_PATCH_PY, tmpDir], { encoding: 'utf8' })
    assert.equal(run1.status, 0, `fs-image-patch first run failed:\n${run1.stderr}\n${run1.stdout}`)

    // Check CustomTarget_emscripten_fs_image.mk
    const mkPatched = fs.readFileSync(mkPath, 'utf8')
    assert.match(mkPatched, /ZZZ-aiworkdeck-locale-zh-CN\.xcd/)
    assert.match(mkPatched, /filter-out[\s\S]*%\/Lightproof\.py/)

    // Check repacked soffice.data and metadata
    const repackedData = fs.readFileSync(dataPath)
    const updatedMeta = JSON.parse(fs.readFileSync(dataMetaPath, 'utf8'))
    const updatedJsMeta = JSON.parse(fs.readFileSync(jsMetaPath, 'utf8'))
    assert.deepEqual(updatedMeta, updatedJsMeta)

    const expectedKept = entries.filter((e) => e.mustKeep)
    assert.equal(updatedMeta.files.length, expectedKept.length)
    assert.equal(updatedMeta.remote_package_size, repackedData.length)

    let expectedCursor = 0
    for (let i = 0; i < expectedKept.length; i++) {
      const expected = expectedKept[i]
      const actualEntry = updatedMeta.files[i]
      assert.equal(actualEntry.filename, expected.filename)
      assert.equal(actualEntry.start, expectedCursor)
      assert.equal(actualEntry.end, expectedCursor + expected.payload.length)
      const actualSlice = repackedData.subarray(actualEntry.start, actualEntry.end)
      assert.deepEqual(actualSlice, expected.payload, `Payload mismatch for ${expected.filename}`)
      expectedCursor = actualEntry.end
    }
    assert.equal(expectedCursor, repackedData.length)

    // Ensure stripped entries are gone
    const keptNames = new Set(updatedMeta.files.map((f) => f.filename))
    assert.ok(!keptNames.has('/instdir/share/extensions/dict-en/Lightproof.py'))
    assert.ok(!keptNames.has('/instdir/share/extensions/dict-en/Lightproof.components'))
    assert.ok(!keptNames.has('/instdir/share/extensions/dict-en/pythonpath/lightproof_en.py'))
    assert.ok(!keptNames.has('/instdir/share/extensions/dict-fr/fr.dic'))
    assert.ok(!keptNames.has('/instdir/share/extensions/dict-de/de_DE_frami.dic'))
    assert.ok(keptNames.has('/instdir/share/extensions/dict-en/en_US.aff'))
    assert.ok(keptNames.has('/instdir/share/extensions/dict-zh-CN/zh_CN.dic'))
    assert.ok(keptNames.has('/instdir/share/registry/Langpack-zh-CN.xcd'))
    assert.ok(keptNames.has('/instdir/program/resource/zh_CN/LC_MESSAGES/sw.mo'))

    // Second run must be idempotent
    const run2 = spawnSync('python3', [FS_IMAGE_PATCH_PY, tmpDir], { encoding: 'utf8' })
    assert.equal(run2.status, 0, `fs-image-patch second run failed:\n${run2.stderr}\n${run2.stdout}`)
    assert.deepEqual(fs.readFileSync(dataPath), repackedData)
    assert.equal(fs.readFileSync(dataMetaPath, 'utf8'), JSON.stringify(updatedMeta))
    assert.equal(fs.readFileSync(mkPath, 'utf8'), mkPatched)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
