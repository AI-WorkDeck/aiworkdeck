// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.merge;

import org.apache.poi.xwpf.usermodel.IBodyElement;
import org.apache.xmlbeans.XmlCursor;
import org.apache.xmlbeans.XmlObject;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;

import javax.xml.namespace.QName;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 把 docx 拆成比对单元。
 *
 * <p>段落键 {@code p{i}} 的 i 是**正文顶层段落**的枚举序（表格里的段落不占号），
 * 与引擎 {@code get_paragraph}/{@code select_paragraph} 的下标同构——重放计划按这个坐标写，
 * 错一位就写错段，所以这条是跨端契约，不是实现细节。
 *
 * <p>表格单元 {@code t{表序}.{行}.{列}} 紧跟在该表在 body 元素序里的位置之后，
 * 与段落混在同一条序列里。于是「同事改了表里一格、我改了表上面那段」天然是相邻，
 * 按 {@link ThreeWayAnalyzer} 的口径进人工裁决——这是刻意的。
 *
 * <p>不读 {@code w14:paraId}：引擎导出 docx 会整类丢弃它（spike B1），靠它对齐必然假绿。
 */
public final class DocxUnitReader {

    /** Unicode 分隔符 + 常规空白，折叠成一个半角空格。 */
    private static final Pattern WHITESPACE = Pattern.compile("[\\p{Z}\\s]+");

    private DocxUnitReader() {
    }

    public static List<Unit> read(byte[] docx) throws IOException {
        List<Unit> units = new ArrayList<>();
        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
            int paragraphIndex = 0;
            int tableIndex = 0;
            for (IBodyElement element : doc.getBodyElements()) {
                if (element instanceof XWPFParagraph paragraph) {
                    units.add(unit("p" + paragraphIndex, paragraph.getText(), revisionSignature(paragraph.getCTP())));
                    paragraphIndex++;
                } else if (element instanceof XWPFTable table) {
                    List<XWPFTableRow> rows = table.getRows();
                    for (int r = 0; r < rows.size(); r++) {
                        List<XWPFTableCell> cells = rows.get(r).getTableCells();
                        for (int c = 0; c < cells.size(); c++) {
                            units.add(unit("t" + tableIndex + "." + r + "." + c, cells.get(c).getText(),
                                    revisionSignature(cells.get(c).getCTTc())));
                        }
                    }
                    tableIndex++;
                }
            }
        }
        return units;
    }

    /** 去首尾空白、连续空白折一个、NFC。比对与溯源一律按这个结果。 */
    public static String normalize(String s) {
        if (s == null || s.isEmpty()) {
            return "";
        }
        String nfc = Normalizer.normalize(s, Normalizer.Form.NFC);
        return WHITESPACE.matcher(nfc).replaceAll(" ").trim();
    }

    private static Unit unit(String key, String text, String rev) {
        String raw = text == null ? "" : text;
        return new Unit(key, raw, normalize(raw), rev);
    }

    private static final String W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    /** 修订元素：段内插入/删除/移动、段落标记上的插入/删除（在 pPr/rPr 里，同名）、格式修订。 */
    private static final Set<String> REVISION_ELEMENTS = Set.of(
            "ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange", "tblPrChange", "trPrChange", "tcPrChange");

    /**
     * 一个段落或表格单元里待处理修订的签名：按文档顺序每条一行「类型|作者|日期|文字」，没有修订时为空串。
     * 同类型、同作者、同日期首尾相邻的几条并成一条——引擎导出时一条修订常按字符段拆成几个
     * {@code w:ins}（真机实测），Word 原件里是一个；不并的话同一条修订在两份文件里签名不同，
     * 平白算成「改过」、造出假冲突。{@code w:id} 不算（每次导出都重排）。
     */
    static String revisionSignature(XmlObject scope) {
        if (scope == null) {
            return "";
        }
        List<String[]> rows = new ArrayList<>();
        try (XmlCursor c = scope.newCursor(); XmlCursor end = scope.newCursor()) {
            end.toEndToken();
            while (c.isLeftOf(end) && c.hasNextToken()) {
                XmlCursor.TokenType t = c.toNextToken();
                if (!t.isStart()) {
                    continue;
                }
                QName q = c.getName();
                if (q == null || !W_NS.equals(q.getNamespaceURI()) || !REVISION_ELEMENTS.contains(q.getLocalPart())) {
                    continue;
                }
                String author = c.getAttributeText(new QName(W_NS, "author"));
                String date = c.getAttributeText(new QName(W_NS, "date"));
                String text = textWithin(c);
                String type = q.getLocalPart();
                String[] last = rows.isEmpty() ? null : rows.get(rows.size() - 1);
                if (last != null && last[0].equals(type) && last[1].equals(nz(author)) && last[2].equals(nz(date))) {
                    last[3] = last[3] + text;
                } else {
                    rows.add(new String[]{type, nz(author), nz(date), text});
                }
            }
        }
        StringBuilder sb = new StringBuilder();
        for (String[] row : rows) {
            sb.append(row[0]).append('|').append(row[1]).append('|').append(row[2]).append('|').append(normalize(row[3])).append('\n');
        }
        return sb.toString();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    /** 修订元素里的文字（w:t 与 w:delText）。 */
    private static String textWithin(XmlCursor at) {
        StringBuilder sb = new StringBuilder();
        try (XmlCursor c = at.newCursor(); XmlCursor end = at.newCursor()) {
            end.toEndToken();
            while (c.isLeftOf(end) && c.hasNextToken()) {
                XmlCursor.TokenType t = c.toNextToken();
                if (t.isStart()) {
                    QName q = c.getName();
                    if (q != null && W_NS.equals(q.getNamespaceURI())
                            && ("t".equals(q.getLocalPart()) || "delText".equals(q.getLocalPart()))) {
                        sb.append(c.getTextValue());
                    }
                }
            }
        }
        return sb.toString();
    }
}
