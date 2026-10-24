# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Run with LibreOffice's bundled Python; connect only to this probe's LOK bridge.

This does not bootstrap or launch soffice. It tests a few real UNO primitives,
not AI WorkDeck's complete editor protocol or its input method implementation.
"""
import argparse
import json
import sys

import uno


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--document-url", required=True)
    args = ap.parse_args()
    if not 0 < args.port < 65536:
        raise ValueError("invalid loopback port")
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    remote = resolver.resolve(f"uno:socket,host=127.0.0.1,port={args.port};urp;StarOffice.ComponentContext")
    desktop = remote.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", remote)
    components = desktop.getComponents().createEnumeration()
    matches = []
    while components.hasMoreElements():
        model = components.nextElement()
        if model.supportsService("com.sun.star.text.TextDocument") and model.getURL() == args.document_url:
            matches.append(model)
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one URL-bound model, found {len(matches)}")
    doc = matches[0]
    info = doc.getPropertySetInfo()
    properties = {name: info.hasPropertyByName(name) for name in (
        "RecordChanges", "ShowChanges", "RedlineDisplayType", "AwdReviewGeometry", "AwdReviewSidebarWidth")}
    result = {"urlBoundModel": True, "documentProperties": properties, "redlineCountBefore": doc.getRedlines().getCount()}
    old_show = doc.getPropertyValue("ShowChanges")
    old_display = doc.getPropertyValue("RedlineDisplayType")
    old_record = doc.getPropertyValue("RecordChanges")
    result["recordChangesBefore"] = old_record
    marker = "X原生合成输入核验"
    replacement = marker + "｜UNO锚点核验"
    try:
        # Match the existing editor contract: ShowChanges is readable but its setter
        # can silently do nothing. A typed RedlineDisplayType controls the view.
        uno.invoke(doc, "setPropertyValue", ("RedlineDisplayType", uno.Any("short", 0)))
        result["finalViewVerified"] = doc.getPropertyValue("ShowChanges") is False
        doc.setPropertyValue("RecordChanges", True)
        # Work from this model's own XText, never a focused global current document.
        text = doc.getText()
        anchor = text.createTextCursorByRange(text.getEnd())
        if not anchor.goLeft(len(marker), True) or anchor.getString() != marker:
            raise RuntimeError("anchor text mismatch; no edit performed")
        result["anchorTextVerified"] = True
        undo = doc.getUndoManager()
        undo.enterUndoContext("Native prototype anchored edit")
        try:
            anchor.setString(replacement)
        finally:
            undo.leaveUndoContext()
        result["anchoredEditReadback"] = text.getString().endswith(replacement)
        undo.undo()
        result["undoRestoredMarker"] = text.getString().endswith(marker)
        undo.redo()
        result["redoRestoredReplacement"] = text.getString().endswith(replacement)
        paragraphs = text.createEnumeration()
        count = 0
        while paragraphs.hasMoreElements():
            node = paragraphs.nextElement()
            if node.supportsService("com.sun.star.text.Paragraph"):
                count += 1
        result["bodyParagraphs"] = count
        result["redlineCountAfter"] = doc.getRedlines().getCount()
        final_text = text.getString()
        result["finalTextContainsAll300InsertedClauses"] = all(
            f"合成测试条款{i}：按期核验并交付文件。" in final_text for i in range(0, 600, 2))
        result["finalTextExcludesAll300DeletedClauses"] = all(
            f"合成测试条款{i}：按期核验并交付文件。" not in final_text for i in range(1, 600, 2))
    finally:
        uno.invoke(doc, "setPropertyValue", ("RedlineDisplayType", uno.Any("short", old_display)))
        doc.setPropertyValue("RecordChanges", old_record)
        result["originalViewRestored"] = doc.getPropertyValue("ShowChanges") == old_show
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"failure": str(exc)}, ensure_ascii=False))
        sys.exit(1)
