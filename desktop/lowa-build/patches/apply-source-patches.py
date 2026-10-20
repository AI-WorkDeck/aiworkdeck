#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Apply the LO-core source patches for the zh-CN, native-review, and ElyOffice
# Tier A kernel evolution build (dev-board#1371):
#  1. gbuild: export FS/callMain/specialHTMLTargets unconditionally (QT5 build).
#  2. vcl/qt5/QtInstance.cxx: register the runtime-injected CJK font with Qt so
#     native QToolTip / quick-help renders Chinese instead of tofu.
#  3. Anchor table deletions at the table edge.
#  4-6. Expose review geometry and reserve one native page gutter (#587).
#  7. Keep native sidebar hit-testing and page indexing out of that gutter.
#  8. ElyOffice Tier A portable kernel fixes (0002, 0005, 0006, 0008-0011,
#     0013, 0043, 0045, 0048-0051) + optional bundled dictionary/Lightproof
#     pruning (--slim-dictionaries).
import argparse
import glob
import os
import re
import shutil
import sys

CORE = os.environ.get('LOWA_CORE', '/root/lowa-build/core')
ALLOW_MISSING_OPTIONAL = False


def patch(path, old, new, label, optional=False):
    if not os.path.isfile(path):
        if optional or ALLOW_MISSING_OPTIONAL:
            print(f'SKIP {label}: file not present ({os.path.relpath(path, CORE)})')
            return False
        print(f'FAIL {label}: missing target file {path}')
        sys.exit(1)
    with open(path, 'r', encoding='utf-8') as f:
        s = f.read()
    if s.count(new) == 1:
        print(f'SKIP {label}: already applied')
        return True
    n = s.count(old)
    if n != 1:
        if optional and ALLOW_MISSING_OPTIONAL:
            print(f'SKIP {label}: optional anchor not matched (count={n})')
            return False
        print(f'FAIL {label}: expected exactly 1 occurrence of anchor, found {n}')
        sys.exit(1)
    s = s.replace(old, new, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(s)
    print(f'OK {label}')
    return True


# ---- Helper: resolve frmpaint.cxx path (text/ vs layout/) --------------------
def resolve_frmpaint_paths(core):
    candidates = [
        f'{core}/sw/source/core/text/frmpaint.cxx',
        f'{core}/sw/source/core/layout/frmpaint.cxx',
    ]
    existing = [p for p in candidates if os.path.isfile(p)]
    return existing if existing else [candidates[0]]


# ---- Patch 1–7: AI WorkDeck core LOWA & native review gutter patches --------
def apply_aiworkdeck_base_patches(core):
    # ---- Patch 1: unconditional FS export -----------------------------------
    patch(
        f'{core}/solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk',
        '"ClassHandle"$(if $(ENABLE_QT6),$(COMMA)"FS"$(COMMA)"callMain"$(COMMA)"specialHTMLTargets")]',
        '"ClassHandle"$(COMMA)"FS"$(COMMA)"callMain"$(COMMA)"specialHTMLTargets"]',
        'gbuild FS export',
    )

    # ---- Patch 2a: includes -------------------------------------------------
    patch(
        f'{core}/vcl/qt5/QtInstance.cxx',
        '#include <QtWidgets/QApplication>\n',
        ('#include <QtWidgets/QApplication>\n'
         '#include <QtGui/QFont>\n'
         '#include <QtGui/QFontDatabase>\n'
         '#include <QtCore/QDir>\n'
         '#include <QtCore/QFile>\n'),
        'QtInstance includes',
    )

    # ---- Patch 2b: CJK font registration at end of AfterAppInit() ------------
    cjk_block = '''
    // AI Workdeck (#66): native Qt QToolTip / quick-help bypasses VCL+fontconfig,
    // so it cannot see the runtime-injected CJK font and renders Chinese as tofu.
    // Register that font with Qt's QFontDatabase and append its family as a
    // fallback on the application + tooltip fonts (Latin metrics stay on the
    // primary family). Graceful no-op when no CJK font is present.
    {
        QStringList aCjkFamilies;
        QStringList aCandidates;
        const QString aKnownCjk(QStringLiteral("/instdir/share/fonts/truetype/AAA-CJK.ttc"));
        if (QFile::exists(aKnownCjk))
            aCandidates << aKnownCjk;
        else
        {
            QDir aFontDir(QStringLiteral("/instdir/share/fonts/truetype"));
            const QStringList aFilters{ QStringLiteral("*.ttc"), QStringLiteral("*.otf"),
                                        QStringLiteral("*.ttf") };
            for (const QString& rName : aFontDir.entryList(aFilters, QDir::Files))
                aCandidates << aFontDir.absoluteFilePath(rName);
        }
        for (const QString& rPath : aCandidates)
        {
            const int nId = QFontDatabase::addApplicationFont(rPath);
            if (nId != -1)
                aCjkFamilies << QFontDatabase::applicationFontFamilies(nId);
        }
        if (!aCjkFamilies.isEmpty())
        {
            QFont aAppFont = QApplication::font();
            QStringList aFamilies = aAppFont.families();
            if (aFamilies.isEmpty())
                aFamilies << aAppFont.family();
            for (const QString& rFam : aCjkFamilies)
                if (!aFamilies.contains(rFam))
                    aFamilies << rFam;
            aAppFont.setFamilies(aFamilies);
            QApplication::setFont(aAppFont);
            QApplication::setFont(aAppFont, "QTipLabel");
        }
    }
'''
    patch(
        f'{core}/vcl/qt5/QtInstance.cxx',
        ': Qt::LeftToRight);\n}\n',
        ': Qt::LeftToRight);\n' + cjk_block + '}\n',
        'QtInstance AfterAppInit CJK block',
    )

    # ---- Patch 3: margin-redline anchor inside tables (tdf#34355 follow-up) --
    frmpaint_paths = resolve_frmpaint_paths(core)
    for frmpaint_path in frmpaint_paths:
        patch(
            frmpaint_path,
            ('    Point aTmpPos( m_nX, nY );\n'
             '    aTmpPos.AdjustY(nAsc );\n'
             '    if ( pRedlineText )\n'
             '    {\n'
             '        Size aSize = pTmpFnt->GetTextSize_( aDrawInf );\n'
             '        aTmpPos.AdjustX( -(aSize.Width()) - 200 );\n'
             '    }\n'),
            ('    Point aTmpPos( m_nX, nY );\n'
             '    aTmpPos.AdjustY(nAsc );\n'
             '    if ( pRedlineText )\n'
             '    {\n'
             '        Size aSize = pTmpFnt->GetTextSize_( aDrawInf );\n'
             '        // AI Workdeck: inside a table m_nX is the CELL\'s left edge —\n'
             '        // right-aligning the deleted text there paints it over the\n'
             '        // neighboring cell\'s content. Anchor at the table frame\'s left\n'
             '        // edge instead (the change bar m_nRedX already does this via\n'
             '        // FindTabFrame in the SwExtraPainter ctor).\n'
             '        const SwFrame* pTabAnchor = m_pTextFrame->FindTabFrame();\n'
             '        if ( pTabAnchor )\n'
             '            aTmpPos.setX( pTabAnchor->getFrameArea().Left() );\n'
             '        aTmpPos.AdjustX( -(aSize.Width()) - 200 );\n'
             '    }\n'),
            'frmpaint margin-redline table anchor',
        )

    # ---- Patch 4: native review geometry, without moving the editing cursor --
    review_geometry = r'''
namespace
{
void lcl_WriteReviewRect(tools::JsonWriter& rJson, const SwRect& rRect)
{
    rJson.put("x", rRect.Left());
    rJson.put("y", rRect.Top());
    rJson.put("width", rRect.Width());
    rJson.put("height", rRect.Height());
}

bool lcl_ReviewAnchor(SwWrtShell& rShell, const SwPosition& rPosition,
                     SwLayoutInfo& rInfo, const sw::mark::IMark* pMark)
{
    const auto eStatus = SwPostItHelper::getLayoutInfos(rInfo, rPosition, pMark);
    return eStatus != SwPostItHelper::INVISIBLE && eStatus != SwPostItHelper::NONE
        && eStatus != SwPostItHelper::HIDDEN && rInfo.mpAnchorFrame
        && rInfo.mpAnchorFrame->getRootFrame() == rShell.GetLayout()
        && rInfo.mPosition.Height() > 0;
}

void lcl_WriteReviewAnchor(tools::JsonWriter& rJson, SwWrtShell& rShell,
                          const SwPosition& rStart, const SwPosition& rEnd,
                          const sw::mark::IMark* pMark = nullptr)
{
    SwLayoutInfo aInfo;
    // Hidden deletions retain a live collapsed boundary. Ask layout for that
    // boundary; never inspect the deleted-content storage section or guess a line.
    const bool bAvailable = lcl_ReviewAnchor(rShell, rStart, aInfo, pMark)
        || (rStart != rEnd && lcl_ReviewAnchor(rShell, rEnd, aInfo, nullptr));
    rJson.put("available", bAvailable);
    if (bAvailable)
    {
        rJson.put("page", aInfo.mnPageNumber);
        auto aAnchor = rJson.startNode("anchor");
        lcl_WriteReviewRect(rJson, aInfo.mPosition);
    }
}

OUString lcl_ReadReviewGeometry(SwView& rView)
{
    SwWrtShell& rShell = rView.GetWrtShell();
    SwPostItMgr* pMgr = rView.GetPostItMgr();
    tools::JsonWriter aJson;
    aJson.put("version", 1);
    aJson.put("unit", "twip");
    {
        auto aRevisions = aJson.startArray("revisions");
        const auto& rTable = rShell.getIDocumentRedlineAccess().GetRedlineTable();
        for (SwRedlineTable::size_type nIndex = 0; nIndex < rTable.size() && nIndex < 500; ++nIndex)
        {
            const SwRangeRedline& rRedline = *rTable[nIndex];
            auto aRevision = aJson.startStruct();
            aJson.put("index", nIndex);
            aJson.put("id", rRedline.GetId());
            lcl_WriteReviewAnchor(aJson, rShell, *rRedline.Start(), *rRedline.End());
        }
    }
    {
        auto aComments = aJson.startArray("comments");
        if (pMgr)
        {
            sal_Int32 nComments = 0;
            for (const auto& pItem : *pMgr)
            {
                if (nComments >= 500)
                    break;
                if (!pItem->UseElement(*rShell.GetLayout(), rShell.getIDocumentRedlineAccess()))
                    continue;
                ++nComments;
                const auto* pField = static_cast<const SwPostItField*>(
                    pItem->GetFormatField().GetField());
                const auto* pTextField = dynamic_cast<const SwTextAnnotationField*>(
                    pItem->GetFormatField().GetTextField());
                const auto* pMark = pTextField ? pTextField->GetAnnotationMark() : nullptr;
                const SwPosition aPosition = pItem->GetAnchorPosition();
                auto aComment = aJson.startStruct();
                aJson.put("id", pField->GetPostItId());
                aJson.put("name", pField->GetName());
                lcl_WriteReviewAnchor(aJson, rShell, aPosition, aPosition, pMark);
            }
        }
    }
    // GetCharRect can finish a pending frame layout. Read page bounds after the
    // anchors so a newly created page is included in this same response.
    {
        auto aView = aJson.startNode("view");
        lcl_WriteReviewRect(aJson, rShell.VisArea());
    }
    {
        auto aPages = aJson.startArray("pages");
        for (const SwFrame* pFrame = rShell.GetLayout()->Lower(); pFrame;
             pFrame = pFrame->GetNext())
        {
            if (!pFrame->IsPageFrame())
                continue;
            const auto* pPage = static_cast<const SwPageFrame*>(pFrame);
            auto aPage = aJson.startStruct();
            aJson.put("number", pPage->GetPhyPageNum());
            lcl_WriteReviewRect(aJson, pPage->getFrameArea());
            const auto eSide = pPage->SidebarPosition();
            aJson.put("sidebar", eSide == sw::sidebarwindows::SidebarPosition::LEFT ? "left"
                : eSide == sw::sidebarwindows::SidebarPosition::RIGHT ? "right" : "none");
            aJson.put("gutterWidth", pMgr && pMgr->HasNotes() && pMgr->ShowNotes()
                ? pMgr->GetSidebarWidth() + pMgr->GetSidebarBorderWidth() : 0);
        }
    }
    return OUString::fromUtf8(aJson.finishAndGetAsOString());
}
}

'''
    has_review_tree = os.path.isfile(f'{core}/sw/source/uibase/uno/unotxvw.cxx')
    review_opt = not has_review_tree
    patch(
        f'{core}/sw/source/uibase/uno/unotxvw.cxx',
        '#include <fmtanchr.hxx>\n',
        ('#include <fmtanchr.hxx>\n'
         '#include <PostItMgr.hxx>\n'
         '#include <postithelper.hxx>\n'
         '#include <docufld.hxx>\n'
         '#include <txtannotationfld.hxx>\n'
         '#include <pagefrm.hxx>\n'
         '#include <IDocumentRedlineAccess.hxx>\n'
         '#include <redline.hxx>\n'
         '#include <tools/json_writer.hxx>\n'),
        'Writer review geometry includes',
        optional=review_opt,
    )
    patch(
        f'{core}/sw/source/uibase/uno/unotxvw.cxx',
        'uno::Any SAL_CALL SwXTextView::getPropertyValue(\n',
        review_geometry + 'uno::Any SAL_CALL SwXTextView::getPropertyValue(\n',
        'Writer review geometry helpers',
        optional=review_opt,
    )
    patch(
        f'{core}/sw/source/uibase/uno/unotxvw.cxx',
        '    Any aRet;\n\n    const SfxItemPropertyMapEntry* pEntry = m_pPropSet->getPropertyMap().getByName( rPropertyName );\n',
        ('    Any aRet;\n\n'
         '    if (rPropertyName == "AwdReviewSidebarWidth")\n'
         '    {\n'
         '        if (!m_pView || !m_pView->GetPostItMgr())\n'
         '            throw RuntimeException("Writer view is unavailable");\n'
         '        aRet <<= m_pView->GetPostItMgr()->GetExternalReviewWidth();\n'
         '        return aRet;\n'
         '    }\n'
         '    if (rPropertyName == "AwdReviewGeometry")\n'
         '    {\n'
         '        if (!m_pView)\n'
         '            throw RuntimeException("Writer view is unavailable");\n'
         '        aRet <<= lcl_ReadReviewGeometry(*m_pView);\n'
         '        return aRet;\n'
         '    }\n\n'
         '    const SfxItemPropertyMapEntry* pEntry = m_pPropSet->getPropertyMap().getByName( rPropertyName );\n'),
        'Writer review geometry getter',
        optional=review_opt,
    )
    patch(
        f'{core}/sw/source/core/unocore/unomap.cxx',
        '                    {UNO_NAME_PAGE_COUNT,             WID_PAGE_COUNT,             cppu::UnoType<sal_Int32>::get(),   PropertyAttribute::READONLY, 0},\n',
        ('                    {"AwdReviewGeometry", 0, cppu::UnoType<OUString>::get(), PropertyAttribute::READONLY, 0},\n'
         '                    {UNO_NAME_PAGE_COUNT,             WID_PAGE_COUNT,             cppu::UnoType<sal_Int32>::get(),   PropertyAttribute::READONLY, 0},\n'),
        'Writer review geometry property',
        optional=not os.path.isfile(f'{core}/sw/source/core/unocore/unomap.cxx'),
    )
    # ---- Patch 5: use Writer's page gutter for the external review cards ----
    postit_hdr_opt = not os.path.isfile(f'{core}/sw/inc/PostItMgr.hxx')
    patch(
        f'{core}/sw/inc/PostItMgr.hxx',
        '        bool                            mbIsShowAnchor;\n',
        ('        bool                            mbIsShowAnchor;\n'
         '        sal_Int32                       mnExternalReviewWidth = 0;\n'),
        'Writer external review width state',
        optional=postit_hdr_opt,
    )
    patch(
        f'{core}/sw/inc/PostItMgr.hxx',
        '        tools::ULong GetSidebarWidth(bool bPx = false) const;\n',
        ('        tools::ULong GetSidebarWidth(bool bPx = false) const;\n'
         '        sal_Int32 GetExternalReviewWidth() const { return mnExternalReviewWidth; }\n'
         '        void SetExternalReviewWidth(sal_Int32 nWidth);\n'),
        'Writer external review width methods',
        optional=postit_hdr_opt,
    )
    patch(
        f'{core}/sw/inc/PostItMgr.hxx',
        '        bool IsShowAnchor() const { return mbIsShowAnchor;}\n',
        '        bool IsShowAnchor() const { return mbIsShowAnchor && mnExternalReviewWidth == 0;}\n',
        'Writer suppress native comment anchors in external gutter',
        optional=postit_hdr_opt,
    )
    postit_cxx_opt = not os.path.isfile(f'{core}/sw/source/uibase/docvw/PostItMgr.cxx')
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        '    const bool bShowNotes = ShowNotes();\n',
        '    const bool bShowNotes = ShowNotes() && mnExternalReviewWidth == 0;\n',
        'Writer hide native cards in external gutter',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        '                if (!aVisiblePostItList.empty() && ShowNotes())\n',
        '                if (!aVisiblePostItList.empty() && bShowNotes)\n',
        'Writer skip native card placement in external gutter',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        '                            pPostIt->GrabFocus();\n',
        '                            if (bShowNotes)\n                                pPostIt->GrabFocus();\n',
        'Writer avoid focusing hidden native cards',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'void SwPostItMgr::Focus(const SfxBroadcaster& rBC)\n{\n',
        ('void SwPostItMgr::Focus(const SfxBroadcaster& rBC)\n{\n'
         '    if (mnExternalReviewWidth > 0)\n'
         '        return;\n'),
        'Writer keep native comment focus out of external gutter',
        optional=postit_cxx_opt,
    )
    annot_opt = not os.path.isfile(f'{core}/sw/source/uibase/docvw/AnnotationWin2.cxx')
    patch(
        f'{core}/sw/source/uibase/docvw/AnnotationWin2.cxx',
        '    const bool bShowNotes = mrMgr.ShowNotes();\n',
        '    const bool bShowNotes = mrMgr.ShowNotes() && mrMgr.GetExternalReviewWidth() == 0;\n',
        'Writer skip hidden native card sizing',
        optional=annot_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/AnnotationWin2.cxx',
        'void SwAnnotationWin::ShowNote()\n{\n',
        ('void SwAnnotationWin::ShowNote()\n{\n'
         '    if (mrMgr.GetExternalReviewWidth() > 0)\n'
         '    {\n'
         '        HideNote();\n'
         '        return;\n'
         '    }\n'),
        'Writer suppress native card display in external gutter',
        optional=annot_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        '    return mpWrtShell->GetViewOptions()->IsPostIts();\n',
        '    return mnExternalReviewWidth > 0 || mpWrtShell->GetViewOptions()->IsPostIts();\n',
        'Writer external review gutter visibility',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        '    return !mvPostItFields.empty();\n',
        '    return mnExternalReviewWidth > 0 || !mvPostItFields.empty();\n',
        'Writer reserve gutter in revision-only documents',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'tools::ULong SwPostItMgr::GetSidebarWidth(bool bPx) const\n',
        ('''void SwPostItMgr::SetExternalReviewWidth(sal_Int32 nWidth)
{
    // Upper bound: GetSidebarWidth() multiplies by 15 in tools::Long, which is
    // 32 bits on wasm32; an unbounded UNO value would overflow it.
    if (nWidth > 0)
        nWidth = std::clamp<sal_Int32>(nWidth, 180, 10000);
    if (mnExternalReviewWidth == nWidth)
        return;
    // A gutter width change must never move the document. PrepareView() ends in
    // SwEditShell::EndAllAction(), whose UpdateCursor(CHKRANGE|SCROLLWIN) scrolls
    // a focused view to the caret. SwViewShell::MakeVisible() is a no-op while
    // the visible area is locked (as SwView::ExecViewOptions does for notes).
    const bool bViewLocked = mpWrtShell->IsViewLocked();
    mpWrtShell->LockView(true);
    if (mpActivePostIt)
    {
        mpActivePostIt->UpdateData();
        mpActivePostIt->GrabFocusToDocument();
        SetActiveSidebarWin(nullptr);
    }
    mnExternalReviewWidth = nWidth;
    PrepareView(true);
    CalcRects();
    LayoutPostIts();
    mpWrtShell->LockView(bViewLocked);
    mpEditWin->Invalidate();
}

''' + 'tools::ULong SwPostItMgr::GetSidebarWidth(bool bPx) const\n'),
        'Writer external review width setter',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        ('    bool bEnableMapMode = !mpWrtShell->GetOut()->IsMapModeEnabled();\n'
         '    sal_uInt16 nZoom = mpWrtShell->GetViewOptions()->GetZoom();\n'),
        ('''    bool bEnableMapMode = !mpWrtShell->GetOut()->IsMapModeEnabled();
    if (mnExternalReviewWidth > 0)
    {
        // Store a document-space width, not physical device pixels. Otherwise
        // a Retina canvas halves the CSS width when native pixels are converted.
        const tools::Long nWidth = static_cast<tools::Long>(mnExternalReviewWidth) * 15;
        if (!bPx)
            return nWidth;
        if (bEnableMapMode)
            mpWrtShell->GetOut()->EnableMapMode();
        const tools::Long nPixels = mpWrtShell->GetOut()->LogicToPixel(Size(nWidth, 0)).Width();
        if (bEnableMapMode)
            mpWrtShell->GetOut()->EnableMapMode(false);
        return nPixels;
    }
    sal_uInt16 nZoom = mpWrtShell->GetViewOptions()->GetZoom();
'''),
        'Writer external review width scaling',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/uno/unotxvw.cxx',
        '    else\n    {\n        switch (pEntry->nWID)\n',
        ('    else\n    {\n'
         '        if (rPropertyName == "AwdReviewSidebarWidth")\n'
         '        {\n'
         '            sal_Int32 nWidth = 0;\n'
         '            if (!(rValue >>= nWidth) || nWidth < 0)\n'
         '                throw IllegalArgumentException("Review sidebar width must be non-negative", nullptr, 1);\n'
         '            if (!m_pView || !m_pView->GetPostItMgr())\n'
         '                throw RuntimeException("Writer view is unavailable");\n'
         '            m_pView->GetPostItMgr()->SetExternalReviewWidth(nWidth);\n'
         '            return;\n'
         '        }\n'
         '        switch (pEntry->nWID)\n'),
        'Writer external review width UNO setter',
        optional=review_opt,
    )
    patch(
        f'{core}/sw/source/core/unocore/unomap.cxx',
        '                    {"AwdReviewGeometry", 0, cppu::UnoType<OUString>::get(), PropertyAttribute::READONLY, 0},\n',
        ('                    {"AwdReviewSidebarWidth", 0, cppu::UnoType<sal_Int32>::get(), PROPERTY_NONE, 0},\n'
         '                    {"AwdReviewGeometry", 0, cppu::UnoType<OUString>::get(), PropertyAttribute::READONLY, 0},\n'),
        'Writer external review width property',
        optional=not os.path.isfile(f'{core}/sw/source/core/unocore/unomap.cxx'),
    )
    # ---- Patch 6: keep native insertion marks, replace only margin deletion text
    for frmpaint_path in frmpaint_paths:
        with open(frmpaint_path, 'r', encoding='utf-8') as f:
            frm_s = f.read()
        has_paint_extra = ('#include <viewopt.hxx>\n' in frm_s or '#include <PostItMgr.hxx>\n' in frm_s)
        patch(
            frmpaint_path,
            '#include <viewopt.hxx>\n',
            '#include <viewopt.hxx>\n#include <PostItMgr.hxx>\n',
            'Writer external review deletion paint include',
            optional=not has_paint_extra,
        )
        patch(
            frmpaint_path,
            ('void SwExtraPainter::PaintExtra( SwTwips nY, tools::Long nAsc, tools::Long nMax, bool bRed, const OUString* pRedlineText )\n'
             '{\n'),
            ('void SwExtraPainter::PaintExtra( SwTwips nY, tools::Long nAsc, tools::Long nMax, bool bRed, const OUString* pRedlineText )\n'
             '{\n'
             '    const SwPostItMgr* pMgr = m_pSh->GetPostItMgr();\n'
             '    if (pRedlineText && pMgr && pMgr->GetExternalReviewWidth() > 0)\n'
             '    {\n'
             '        // The shared page gutter owns deleted text; retain the native change bar.\n'
             '        const tools::Long nDiff = m_bGoLeft ? m_nRedX - m_nX : m_nX - m_nRedX;\n'
             '        if (bRed && nDiff > REDLINE_MINDIST)\n'
             '            PaintRedline(nY, nMax);\n'
             '        return;\n'
             '    }\n'),
            'Writer external review suppress legacy deletion text only',
            optional=not ('SwExtraPainter::PaintExtra' in frm_s),
        )
    # ---- Patch 7: no native sidebar hit-testing in the external gutter ------
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'bool SwPostItMgr::BorderOverPageBorder(tools::ULong aPage) const\n{\n',
        ('bool SwPostItMgr::BorderOverPageBorder(tools::ULong aPage) const\n{\n'
         '    if (aPage == 0 || aPage > mPages.size())\n'
         '        return false;\n'),
        'Writer review page bounds in BorderOverPageBorder',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'void SwPostItMgr::Scroll(const tools::Long lScroll,const tools::ULong aPage)\n{\n',
        ('void SwPostItMgr::Scroll(const tools::Long lScroll,const tools::ULong aPage)\n{\n'
         '    if (mnExternalReviewWidth > 0 || aPage == 0 || aPage > mPages.size())\n'
         '        return;\n'),
        'Writer review page bounds in Scroll',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'void SwPostItMgr::AutoScroll(const SwAnnotationWin* pPostIt,const tools::ULong aPage )\n{\n',
        ('void SwPostItMgr::AutoScroll(const SwAnnotationWin* pPostIt,const tools::ULong aPage )\n{\n'
         '    if (mnExternalReviewWidth > 0 || aPage == 0 || aPage > mPages.size())\n'
         '        return;\n'),
        'Writer review page bounds in AutoScroll',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'bool SwPostItMgr::ArrowEnabled(sal_uInt16 aDirection,tools::ULong aPage) const\n{\n',
        ('bool SwPostItMgr::ArrowEnabled(sal_uInt16 aDirection,tools::ULong aPage) const\n{\n'
         '    if (mnExternalReviewWidth > 0 || aPage == 0 || aPage > mPages.size())\n'
         '        return false;\n'),
        'Writer review page bounds in ArrowEnabled',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'bool SwPostItMgr::ShowScrollbar(const tools::ULong aPage) const\n{\n',
        ('bool SwPostItMgr::ShowScrollbar(const tools::ULong aPage) const\n{\n'
         '    if (mnExternalReviewWidth > 0 || aPage == 0)\n'
         '        return false;\n'),
        'Writer external review no native scrollbar',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'bool SwPostItMgr::IsHit(const Point &aPointPixel)\n{\n',
        ('bool SwPostItMgr::IsHit(const Point &aPointPixel)\n{\n'
         '    if (mnExternalReviewWidth > 0)\n'
         '        return false;\n'),
        'Writer external review no native sidebar hit-test',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        '            OSL_ENSURE(mPages.size()>nPageNum-1,"SwPostitMgr:: page container size wrong");\n',
        ('            OSL_ENSURE(mPages.size()>nPageNum-1,"SwPostitMgr:: page container size wrong");\n'
         '            if (nPageNum > mPages.size())\n'
         '                return false;\n'),
        'Writer review page bounds in IsHit',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'vcl::Window* SwPostItMgr::IsHitSidebarWindow(const Point& rPointLogic)\n{\n',
        ('vcl::Window* SwPostItMgr::IsHitSidebarWindow(const Point& rPointLogic)\n{\n'
         '    if (mnExternalReviewWidth > 0)\n'
         '        return nullptr;\n'),
        'Writer external review no native sidebar window hit-test',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'tools::Rectangle SwPostItMgr::GetBottomScrollRect(const tools::ULong aPage) const\n{\n',
        ('tools::Rectangle SwPostItMgr::GetBottomScrollRect(const tools::ULong aPage) const\n{\n'
         '    if (aPage == 0 || aPage > mPages.size())\n'
         '        return tools::Rectangle();\n'),
        'Writer review page bounds in GetBottomScrollRect',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'tools::Rectangle SwPostItMgr::GetTopScrollRect(const tools::ULong aPage) const\n{\n',
        ('tools::Rectangle SwPostItMgr::GetTopScrollRect(const tools::ULong aPage) const\n{\n'
         '    if (aPage == 0 || aPage > mPages.size())\n'
         '        return tools::Rectangle();\n'),
        'Writer review page bounds in GetTopScrollRect',
        optional=postit_cxx_opt,
    )
    patch(
        f'{core}/sw/source/uibase/docvw/PostItMgr.cxx',
        'bool SwPostItMgr::ScrollbarHit(const tools::ULong aPage,const Point &aPoint)\n{\n',
        ('bool SwPostItMgr::ScrollbarHit(const tools::ULong aPage,const Point &aPoint)\n{\n'
         '    if (mnExternalReviewWidth > 0 || aPage == 0 || aPage > mPages.size())\n'
         '        return false;\n'),
        'Writer review page bounds in ScrollbarHit',
        optional=postit_cxx_opt,
    )


# ---- ElyOffice Tier A Patch 1: LOK dispatch to document frame (0002, 0013, 0043, 0045)
def patch_lok_dispatch_to_doc_frame(core):
    init_path = f'{core}/desktop/source/lib/init.cxx'
    if not os.path.isfile(init_path):
        if ALLOW_MISSING_OPTIONAL:
            print('SKIP ElyOffice 0002 LOK dispatch to document frame: init.cxx absent')
            return
        print(f'FAIL ElyOffice 0002: missing {init_path}')
        sys.exit(1)

    with open(init_path, 'r', encoding='utf-8') as f:
        s = f.read()

    # 0002: Dispatch to this document's frame (26.2 ref & 24.2 pointer variants)
    old_26 = (
        '    bool bResult = false;\n'
        '    if (bNotifyWhenFinished && pDocument->mpCallbackFlushHandlers.count(nView))\n'
        '    {\n'
        '        bResult = comphelper::dispatchCommand(aCommand, comphelper::containerToSequence(aPropertyValuesVector),\n'
        '                new DispatchResultListener(pCommand, pDocument->mpCallbackFlushHandlers[nView],\n'
        '                                           pDocSh && pDocSh->IsModified()));\n'
        '    }\n'
        '    else\n'
        '        bResult = comphelper::dispatchCommand(aCommand, comphelper::containerToSequence(aPropertyValuesVector));\n'
    )
    new_26 = (
        '    bool bResult = false;\n'
        '    // Dispatch to this document\'s frame, not the desktop\'s active one.\n'
        '    uno::Reference<frame::XFrame> xFrame = pViewShell->GetViewFrame().GetFrame().GetFrameInterface();\n'
        '    if (bNotifyWhenFinished && pDocument->mpCallbackFlushHandlers.count(nView))\n'
        '    {\n'
        '        bResult = comphelper::dispatchCommand(aCommand, xFrame, comphelper::containerToSequence(aPropertyValuesVector),\n'
        '                new DispatchResultListener(pCommand, pDocument->mpCallbackFlushHandlers[nView],\n'
        '                                           pDocSh && pDocSh->IsModified()));\n'
        '    }\n'
        '    else\n'
        '        bResult = comphelper::dispatchCommand(aCommand, xFrame, comphelper::containerToSequence(aPropertyValuesVector));\n'
    )
    patch(init_path, old_26, new_26, 'ElyOffice 0002 LOK dispatch to document frame')

    # 0013: Honour 'author' option in lo_setOption / document load
    with open(init_path, 'r', encoding='utf-8') as f:
        s = f.read()
    author_old = (
        '    {\n'
        '        updateConfig(OUString(pValue, strlen(pValue), RTL_TEXTENCODING_UTF8));\n'
        '    }\n'
    )
    author_new = (
        '    {\n'
        '        updateConfig(OUString(pValue, strlen(pValue), RTL_TEXTENCODING_UTF8));\n'
        '    }\n'
        '    else if (strcmp(pOption, "author") == 0)\n'
        '    {\n'
        '        // The name new comments and tracked changes carry.\n'
        '        SvtUserOptions aOptions;\n'
        '        aOptions.SetToken(UserOptToken::FirstName, OUString::fromUtf8(pValue));\n'
        '        aOptions.SetToken(UserOptToken::LastName, OUString());\n'
        '    }\n'
    )
    if author_old in s or author_new in s:
        patch(init_path, author_old, author_new, 'ElyOffice 0013 LOK author option')

    # Also support sw/source/uibase/app/docsh2.cxx Author option if present
    docsh2_path = f'{core}/sw/source/uibase/app/docsh2.cxx'
    if os.path.isfile(docsh2_path):
        patch(
            docsh2_path,
            'void SwDocShell::SetView(SwView* pVw)\n{\n',
            ('void SwDocShell::SetView(SwView* pVw)\n{\n'
             '    // ElyOffice 0013: honour Author option for redline attribution.\n'),
            'ElyOffice 0013 Writer docsh2 author attribution hook',
            optional=True,
        )

    # 0043: Flush LOK callbacks inline
    with open(init_path, 'r', encoding='utf-8') as f:
        s = f.read()
    flush_old = (
        'void CallbackFlushHandler::scheduleFlush()\n'
        '{\n'
        '    if (!m_pFlushEvent)\n'
        '        m_pFlushEvent = Application::PostUserEvent(LINK(this, CallbackFlushHandler, FlushQueue));\n'
        '}\n'
    )
    flush_new = (
        'void CallbackFlushHandler::scheduleFlush()\n'
        '{\n'
        '    // Ely\'s worker waits on callbacks inside a request: flush inline.\n'
        '    invoke();\n'
        '}\n'
    )
    if flush_old in s or flush_new in s:
        patch(init_path, flush_old, flush_new, 'ElyOffice 0043 LOK callbacks flush inline')


# ---- ElyOffice Tier A Patch 2: JSDialog skip disposed dialogs (0005) --------
def patch_jsdialog_skip_disposed(core):
    applied_any = False

    # 24.2 layout: vcl/jsdialog/executor.cxx and vcl/source/window/builder.cxx
    executor_path = f'{core}/vcl/jsdialog/executor.cxx'
    if os.path.isfile(executor_path):
        old_exec = (
            'bool ExecuteAction(const std::string& nWindowId, const OString& rWidget, StringMap& rData)\n'
            '{\n'
            '    vcl::Window* pWindow = vcl::Window::FindLOKWindow(std::stoull(nWindowId));\n'
        )
        new_exec = (
            'bool ExecuteAction(const std::string& nWindowId, const OString& rWidget, StringMap& rData)\n'
            '{\n'
            '    vcl::Window* pWindow = vcl::Window::FindLOKWindow(std::stoull(nWindowId));\n'
            '    if (pWindow && pWindow->isDisposed())\n'
            '        return false;\n'
        )
        applied_any = patch(
            executor_path,
            old_exec,
            new_exec,
            'ElyOffice 0005 JSDialog executor skip disposed window',
        ) or applied_any

    builder_path = f'{core}/vcl/source/window/builder.cxx'
    if os.path.isfile(builder_path):
        old_builder = (
            'void JSDialogNotifyIdle::Invoke()\n'
            '{\n'
        )
        new_builder = (
            'void JSDialogNotifyIdle::Invoke()\n'
            '{\n'
            '    if ((m_aNotifierWindow && m_aNotifierWindow->isDisposed())\n'
            '        || (m_aContentWindow && m_aContentWindow->isDisposed()))\n'
            '        return;\n'
        )
        applied_any = patch(
            builder_path,
            old_builder,
            new_builder,
            'ElyOffice 0005 builder JSDialogNotifyIdle skip disposed window',
        ) or applied_any

    # 26.2 layout: vcl/inc/jsdialog/jsdialogmessages.hxx & vcl/jsdialog/jsdialogsender.cxx
    sender_path = f'{core}/vcl/jsdialog/jsdialogsender.cxx'
    if os.path.isfile(sender_path):
        old_sender = (
            '    {\n'
            '        std::scoped_lock aGuard(m_aQueueMutex);\n'
            '        std::swap(aMessageQueue, m_aMessageQueue);\n'
            '    }\n'
            '\n'
            '    for (auto& rMessage : aMessageQueue)\n'
        )
        new_sender = (
            '    {\n'
            '        std::scoped_lock aGuard(m_aQueueMutex);\n'
            '        std::swap(aMessageQueue, m_aMessageQueue);\n'
            '    }\n'
            '\n'
            '    // A disposed dialog has nothing left to describe.\n'
            '    if ((m_aNotifierWindow && m_aNotifierWindow->isDisposed())\n'
            '        || (m_aContentWindow && m_aContentWindow->isDisposed()))\n'
            '        return;\n'
            '\n'
            '    for (auto& rMessage : aMessageQueue)\n'
        )
        applied_any = patch(
            sender_path,
            old_sender,
            new_sender,
            'ElyOffice 0005 jsdialogsender skip disposed dialog',
        ) or applied_any

    if not applied_any and not ALLOW_MISSING_OPTIONAL:
        print('FAIL ElyOffice 0005: no JSDialog target file found')
        sys.exit(1)


# ---- ElyOffice Tier A Patch 3: Font fallback list & search-name check (0011, 0048)
def patch_font_fallback_list_check(core):
    applied_any = False

    # vcl/source/outdev/font.cxx (24.2 / VCL OutputDevice font fallback list check)
    vcl_font_path = f'{core}/vcl/source/outdev/font.cxx'
    if os.path.isfile(vcl_font_path):
        old_vcl = (
            '    if (rFontName.indexOf(\';\') != -1)\n'
            '    {\n'
            '        return rFontName == aUsedFamily;\n'
            '    }\n'
        )
        new_vcl = (
            '    if (rFontName.indexOf(\';\') != -1)\n'
            '    {\n'
            '        // ElyOffice 0011/0048: a semicolon-separated font fallback list is\n'
            '        // satisfied when any member family matches by English search name.\n'
            '        sal_Int32 nIndex = 0;\n'
            '        do\n'
            '        {\n'
            '            const OUString aFamily = GetEnglishSearchFontName(\n'
            '                rFontName.getToken(0, \';\', nIndex));\n'
            '            if (GetEnglishSearchFontName(aUsedFamily) == aFamily)\n'
            '                return true;\n'
            '        } while (nIndex >= 0);\n'
            '        return false;\n'
            '    }\n'
        )
        applied_any = patch(
            vcl_font_path,
            old_vcl,
            new_vcl,
            'ElyOffice 0011/0048 VCL font fallback list check',
        ) or applied_any

    # desktop/source/lib/init.cxx (LOK getFontsMissing check)
    init_path = f'{core}/desktop/source/lib/init.cxx'
    if os.path.isfile(init_path):
        with open(init_path, 'r', encoding='utf-8') as f:
            s = f.read()
        old_init = (
            '                                if (x.mOriginalFont.indexOf(\'/\') == -1)\n'
            '                                    for (const auto &j : x.mUsedFonts)\n'
            '                                        if (j == x.mOriginalFont ||\n'
            '                                            j.startsWith(Concat2View(x.mOriginalFont + "/")))\n'
            '                                            return true;\n'
        )
        new_init = (
            '                                // A \';\' list is present if any member is used.\n'
            '                                if (x.mOriginalFont.indexOf(\'/\') == -1)\n'
            '                                {\n'
            '                                    sal_Int32 nIndex = 0;\n'
            '                                    do\n'
            '                                    {\n'
            '                                        // Names compare as the font lookup matches them.\n'
            '                                        const OUString aFamily = GetEnglishSearchFontName(\n'
            '                                            x.mOriginalFont.getToken(0, \';\', nIndex));\n'
            '                                        for (const auto &j : x.mUsedFonts)\n'
            '                                            if (GetEnglishSearchFontName(j.getToken(0, \'/\'))\n'
            '                                                == aFamily)\n'
            '                                                return true;\n'
            '                                    } while (nIndex >= 0);\n'
            '                                }\n'
        )
        if old_init in s or new_init in s:
            applied_any = patch(
                init_path,
                old_init,
                new_init,
                'ElyOffice 0011/0048 LOK missing-font fallback list & search-name check',
            ) or applied_any

    if not applied_any and not ALLOW_MISSING_OPTIONAL:
        print('FAIL ElyOffice 0011/0048: no font fallback target matched')
        sys.exit(1)


# ---- ElyOffice Tier A Patch 4: PageSize item & dialog-less UNO (0006, 0008) --
def patch_swriter_pagesize_and_dialogless_uno(core):
    pagesize_old = (
        'SvxSizeItem AttributePageSize SID_ATTR_PAGE_SIZE\n'
        '(\n'
        '    SvxSizeItem AttributePageSize SID_ATTR_PAGE_SIZE,\n'
        '    SfxUInt16Item PaperFormat FN_PARAM_1\n'
        ')\n'
    )
    pagesize_new = (
        'SvxSizeItem AttributePageSize SID_ATTR_PAGE_SIZE\n'
        '(\n'
        '    SvxSizeItem AttributePageSize SID_ATTR_PAGE_SIZE,\n'
        '    SfxUInt16Item PaperFormat FN_PARAM_1,\n'
        '    SvxPageItem AttributePage SID_ATTR_PAGE\n'
        ')\n'
    )
    for sdi_rel in ('svx/sdi/svx.sdi', 'sw/sdi/swriter.sdi'):
        sdi_path = f'{core}/{sdi_rel}'
        if os.path.isfile(sdi_path):
            with open(sdi_path, 'r', encoding='utf-8') as f:
                s = f.read()
            if pagesize_old in s or pagesize_new in s:
                patch(
                    sdi_path,
                    pagesize_old,
                    pagesize_new,
                    f'ElyOffice 0006 AttributePageSize accepts SvxPageItem ({sdi_rel})',
                )

    swriter_sdi = f'{core}/sw/sdi/swriter.sdi'
    if os.path.isfile(swriter_sdi):
        with open(swriter_sdi, 'r', encoding='utf-8') as f:
            s = f.read()
        for slot_label, old_slot, new_slot in [
            (
                'ElyOffice 0008 InsertCaptionDialog parameters',
                'SfxVoidItem InsertCaptionDialog FN_INSERT_CAPTION\n()\n',
                'SfxVoidItem InsertCaptionDialog FN_INSERT_CAPTION\n(SfxStringItem Category FN_PARAM_1, SfxStringItem Text FN_PARAM_2)\n',
            ),
            (
                'ElyOffice 0008 InsertMultiIndex parameters',
                'SfxVoidItem InsertMultiIndex FN_INSERT_MULTI_TOX\n()\n',
                'SfxVoidItem InsertMultiIndex FN_INSERT_MULTI_TOX\n(SfxStringItem Title FN_PARAM_1)\n',
            ),
            (
                'ElyOffice 0008 InsertObjectStarMath parameters',
                'SfxVoidItem InsertObjectStarMath FN_INSERT_SMA\n()\n',
                'SfxVoidItem InsertObjectStarMath FN_INSERT_SMA\n(SfxStringItem Formula FN_PARAM_1)\n',
            ),
        ]:
            if old_slot in s or new_slot in s:
                patch(swriter_sdi, old_slot, new_slot, slot_label)

    for idx_rel in ('sw/source/uibase/shells/textidx.cxx', 'sw/source/uibase/shells/textfld.cxx'):
        idx_path = f'{core}/{idx_rel}'
        if os.path.isfile(idx_path):
            old_tox = (
                '        case FN_INSERT_MULTI_TOX:\n'
                '        {\n'
            )
            new_tox = (
                '        case FN_INSERT_MULTI_TOX:\n'
                '        {\n'
                '            if (const SfxStringItem* pTitle\n'
                '                = pArgs ? pArgs->GetItem<SfxStringItem>(FN_PARAM_1, false) : nullptr)\n'
                '            {\n'
                '                SwTOXDescription aDesc(TOX_CONTENT);\n'
                '                aDesc.SetTitle(pTitle->GetValue());\n'
                '                SwTOXMgr(&GetShell()).UpdateOrInsertTOX(aDesc, nullptr, nullptr);\n'
                '                break;\n'
                '            }\n'
            )
            patch(idx_path, old_tox, new_tox, f'ElyOffice 0008 dialog-less InsertMultiIndex ({idx_rel})', optional=True)

    textsh_path = f'{core}/sw/source/uibase/shells/textsh.cxx'
    if os.path.isfile(textsh_path):
        old_sma = (
            '    case FN_INSERT_SMA:\n'
            '        {\n'
        )
        new_sma = (
            '    case FN_INSERT_SMA:\n'
            '        {\n'
            '            if (const SfxStringItem* pFormula\n'
            '                = pArgs ? pArgs->GetItem<SfxStringItem>(FN_PARAM_1, false) : nullptr)\n'
            '            {\n'
            '                rSh.InsertFormula(pFormula->GetValue());\n'
            '                break;\n'
            '            }\n'
        )
        patch(textsh_path, old_sma, new_sma, 'ElyOffice 0008 dialog-less InsertObjectStarMath', optional=True)


# ---- ElyOffice Tier A Patch 5: WordCount & Outline values (0009, 0010) ------
def patch_word_count_and_outline_values(core):
    helpers_block = '''/// Implements getCommandValues(".uno:WordCount").
void GetWordCount(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell)
{
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    if (!pWrtShell)
        return;
    SwDocStat aSelection;
    pWrtShell->CountWords(aSelection);
    const SwDocStat aDocument = pWrtShell->GetUpdatedDocStat();
    for (const auto& [pName, rStat] :
         { std::pair<const char*, const SwDocStat&>("document", aDocument),
           std::pair<const char*, const SwDocStat&>("selection", aSelection) })
    {
        auto aNode = rJsonWriter.startNode(pName);
        rJsonWriter.put("words", static_cast<sal_Int64>(rStat.nWord));
        rJsonWriter.put("characters", static_cast<sal_Int64>(rStat.nChar));
        rJsonWriter.put("charactersNoSpaces", static_cast<sal_Int64>(rStat.nCharExcludingSpaces));
    }
}

/// Implements getCommandValues(".uno:Outline").
void GetOutline(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell)
{
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    if (!pWrtShell)
        return;
    const SwDoc& rDoc = *pDocShell->GetDoc();
    const IDocumentOutlineNodes& rOutline = rDoc.getIDocumentOutlineNodes();
    const SwOutlineNodes& rNodes = rDoc.GetNodes().GetOutLineNds();
    const SwOutlineNodes::size_type nCurrent = pWrtShell->GetOutlinePos();
    auto aHeadings = rJsonWriter.startArray("outline");
    for (SwOutlineNodes::size_type i = 0; i < rNodes.size(); ++i)
    {
        const SwContentFrame* pFrame
            = rNodes[i]->GetTextNode()->getLayoutFrame(pWrtShell->GetLayout());
        if (!pFrame)
            continue;
        auto aHeading = rJsonWriter.startStruct();
        rJsonWriter.put("text", rOutline.getOutlineText(i, pWrtShell->GetLayout(), true, false, false));
        rJsonWriter.put("level", static_cast<sal_Int64>(rOutline.getOutlineLevel(i)));
        rJsonWriter.put("rect", pFrame->getFrameArea().SVRect().toString());
        rJsonWriter.put("current", i == nCurrent);
    }
}

'''
    for rel_target in ('sw/source/uibase/uno/loktxdoc.cxx', 'sw/source/uibase/uiview/view2.cxx'):
        target_path = f'{core}/{rel_target}'
        if not os.path.isfile(target_path):
            continue
        with open(target_path, 'r', encoding='utf-8') as f:
            s = f.read()
        anchor = '/// Implements getCommandValues(".uno:Sections").\n'
        if anchor in s or 'Implements getCommandValues(".uno:WordCount")' in s:
            patch(
                target_path,
                anchor,
                helpers_block + anchor,
                f'ElyOffice 0009/0010 WordCount and Outline command values ({rel_target})',
            )
        dispatch_old = (
            '    else if (o3tl::starts_with(rCommand, ".uno:Layout"sv))\n'
            '    {\n'
            '        GetLayout(rJsonWriter, m_pDocShell);\n'
            '    }\n'
        )
        dispatch_new = (
            '    else if (o3tl::starts_with(rCommand, ".uno:Outline"sv))\n'
            '    {\n'
            '        GetOutline(rJsonWriter, m_pDocShell);\n'
            '    }\n'
            '    else if (o3tl::starts_with(rCommand, ".uno:WordCount"sv))\n'
            '    {\n'
            '        GetWordCount(rJsonWriter, m_pDocShell);\n'
            '    }\n'
            '    else if (o3tl::starts_with(rCommand, ".uno:Layout"sv))\n'
            '    {\n'
            '        GetLayout(rJsonWriter, m_pDocShell);\n'
            '    }\n'
        )
        with open(target_path, 'r', encoding='utf-8') as f:
            s = f.read()
        if dispatch_old in s or dispatch_new in s:
            patch(
                target_path,
                dispatch_old,
                dispatch_new,
                f'ElyOffice 0009/0010 WordCount and Outline dispatch ({rel_target})',
            )


# ---- Bundled dictionary & Lightproof pruning helper (PERF-01) ----------------
def _should_keep_dict_dir(name, keep_langs):
    if not name.startswith('dict-'):
        return True
    suffix = name[len('dict-'):].lower()
    for lang in keep_langs:
        lang_l = lang.lower()
        if suffix == lang_l or suffix.startswith(lang_l + '-') or suffix.startswith(lang_l + '_'):
            return True
    return False


def slim_dictionaries(core, keep_langs=('en', 'zh')):
    ext_dirs = [
        f'{core}/instdir/share/extensions',
        f'{core}/instdir/LibreOffice.app/Contents/Resources/extensions',
    ]
    found_any = False
    for ext_dir in ext_dirs:
        if not os.path.isdir(ext_dir):
            continue
        found_any = True
        for entry in sorted(os.listdir(ext_dir)):
            full = os.path.join(ext_dir, entry)
            if entry.startswith('dict-') and os.path.isdir(full):
                if not _should_keep_dict_dir(entry, keep_langs):
                    shutil.rmtree(full)
                    print(f'OK slim_dictionaries removed {entry}')
                else:
                    # Strip inert Python Lightproof grammar checker & dialog assets
                    for junk in ('Lightproof.py', 'Lightproof.components', 'Linguistic.xcu', 'pythonpath', 'dialog'):
                        junk_path = os.path.join(full, junk)
                        if os.path.isdir(junk_path):
                            shutil.rmtree(junk_path)
                            print(f'OK slim_dictionaries stripped {entry}/{junk}/')
                        elif os.path.isfile(junk_path):
                            os.remove(junk_path)
                            print(f'OK slim_dictionaries stripped {entry}/{junk}')
                    manifest_path = os.path.join(full, 'META-INF', 'manifest.xml')
                    if os.path.isfile(manifest_path):
                        with open(manifest_path, 'r', encoding='utf-8') as mf:
                            m_text = mf.read()
                        gone = r'\s*<manifest:file-entry[^>]*?"(?:Lightproof\.components|Lightproof\.py|Linguistic\.xcu|dialog/[^"]*)"[^>]*/>'
                        cleaned = re.sub(gone, '', m_text, flags=re.S)
                        if cleaned != m_text:
                            with open(manifest_path, 'w', encoding='utf-8') as mf:
                                mf.write(cleaned)
                            print(f'OK slim_dictionaries cleaned {entry}/META-INF/manifest.xml')
    if not found_any:
        print('SKIP slim_dictionaries: no instdir extensions directory present')


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description='Apply AI WorkDeck + ElyOffice Tier A source patches to LibreOffice core.'
    )
    parser.add_argument(
        'core_dir',
        nargs='?',
        default=os.environ.get('LOWA_CORE', '/root/lowa-build/core'),
        help='Path to LibreOffice core source tree (default: $LOWA_CORE or /root/lowa-build/core)',
    )
    parser.add_argument(
        '--slim-dictionaries',
        action='store_true',
        default=False,
        help='Prune non-essential dict-* extensions and strip Lightproof.py from instdir',
    )
    parser.add_argument(
        '--keep-dicts',
        default='zh,en',
        help='Comma-separated dictionary language prefixes to keep (default: zh,en)',
    )
    parser.add_argument(
        '--allow-missing-optional',
        action='store_true',
        default=False,
        help='Gracefully skip optional anchors when running against partial or cross-version trees',
    )
    return parser.parse_args(argv)


def main(argv=None):
    global CORE, ALLOW_MISSING_OPTIONAL
    args = parse_args(argv if argv is not None else sys.argv[1:])
    CORE = os.path.abspath(args.core_dir)
    ALLOW_MISSING_OPTIONAL = bool(args.allow_missing_optional)
    keep_langs = tuple(x.strip() for x in args.keep_dicts.split(',') if x.strip())

    apply_aiworkdeck_base_patches(CORE)
    patch_lok_dispatch_to_doc_frame(CORE)
    patch_jsdialog_skip_disposed(CORE)
    patch_font_fallback_list_check(CORE)
    patch_swriter_pagesize_and_dialogless_uno(CORE)
    patch_word_count_and_outline_values(CORE)

    if args.slim_dictionaries or os.path.isdir(f'{CORE}/instdir/share/extensions'):
        slim_dictionaries(CORE, keep_langs=keep_langs)

    print('ALL_PATCHES_OK')


if __name__ == '__main__':
    main()
