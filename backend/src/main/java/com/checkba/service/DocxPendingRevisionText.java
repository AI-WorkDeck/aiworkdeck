// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * docx 待处理修订的文本口径（gap-analysis R1）：正文按「接受修订后」显示，修订处内联标记。
 *
 * <p>Tika 抽 docx 时把 {@code w:delText} 与插入文字一起输出：第三条「7 → 15」抽成
 * 「收到货物后 715 日内验收」，模型以为是笔误、停下来问。这里在交给 Tika 之前改写
 * 正文部件，把修订换成下列标记（{@code ⟦⟧} 在法律文书里不会出现，〔〕会——文号「〔2020〕」）：
 * <ul>
 *   <li>{@code 15⟦原:7⟧}：改写（删除紧邻插入），插入文字照常输出，后面跟被删原文；</li>
 *   <li>{@code ⟦删:7⟧}：单纯删除；</li>
 *   <li>{@code ⟦增:违约方…⟧}：单纯插入。</li>
 * </ul>
 * 编辑器里的 doc_* 读取本来就是最终文本、不带标记；标记只出现在后端抽取的正文
 *（活跃文档注入、附件、extract_file_text、read_file 等）。{@link #stripMarkers} 还原为最终文本，
 * 供 doc_find_text 与全文检索使用。
 *
 * <p>任何异常都退回原字节：抽取不能因为这一步失败。
 */
public final class DocxPendingRevisionText {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(DocxPendingRevisionText.class);

    static final String W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    static final String W_NS_STRICT = "http://purl.oclc.org/ooxml/wordprocessingml/main";

    private static final Pattern TEXT_PART = Pattern.compile(
            "word/(document|header\\d*|footer\\d*|footnotes|endnotes)\\.xml");
    private static final Pattern HAS_REVISION = Pattern.compile("<(\\w+:)?(ins|del|moveFrom|moveTo)[\\s>/]");
    private static final int MAX_ENTRY_BYTES = 64 * 1024 * 1024;

    private static final Pattern REPLACED_OR_DELETED = Pattern.compile("⟦(?:原|删):[^⟧]*⟧");
    private static final Pattern INSERTED = Pattern.compile("⟦增:([^⟧]*)⟧");

    private DocxPendingRevisionText() {}

    /** 还原为接受修订后的文本：去掉 ⟦原:…⟧/⟦删:…⟧，⟦增:X⟧ 只留 X。 */
    public static String stripMarkers(String text) {
        if (text == null || text.indexOf('⟦') < 0) return text;
        return INSERTED.matcher(REPLACED_OR_DELETED.matcher(text).replaceAll("")).replaceAll("$1");
    }

    /** 不是 docx 或没有修订时原样返回同一个数组。 */
    public static byte[] render(byte[] bytes) {
        if (bytes == null || bytes.length < 4 || bytes[0] != 'P' || bytes[1] != 'K') return bytes;
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream(bytes.length);
            boolean changed = false;
            try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(bytes));
                 ZipOutputStream zout = new ZipOutputStream(out)) {
                ZipEntry entry;
                while ((entry = zin.getNextEntry()) != null) {
                    byte[] data = zin.readNBytes(MAX_ENTRY_BYTES + 1);
                    if (data.length > MAX_ENTRY_BYTES) return bytes;
                    if (TEXT_PART.matcher(entry.getName()).matches()) {
                        byte[] rewritten = rewritePart(data);
                        if (rewritten != data) {
                            data = rewritten;
                            changed = true;
                        }
                    }
                    zout.putNextEntry(new ZipEntry(entry.getName()));
                    zout.write(data);
                    zout.closeEntry();
                }
            }
            return changed ? out.toByteArray() : bytes;
        } catch (Exception e) {
            log.warn("Pending-revision rendering skipped: {}", e.toString());
            return bytes;
        }
    }

    private static byte[] rewritePart(byte[] xml) throws Exception {
        if (!HAS_REVISION.matcher(new String(xml, java.nio.charset.StandardCharsets.UTF_8)).find()) return xml;
        DocumentBuilderFactory f = DocumentBuilderFactory.newDefaultInstance();
        f.setNamespaceAware(true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        f.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        f.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        Document doc = f.newDocumentBuilder().parse(new ByteArrayInputStream(xml));

        List<Element> deletions = runLevel(doc, "del", "moveFrom");
        List<Element> insertions = runLevel(doc, "ins", "moveTo");
        if (deletions.isEmpty() && insertions.isEmpty()) return xml;

        Set<Element> paired = new HashSet<>();
        for (Element del : deletions) {
            String text = textOf(del, "delText", "t");
            Element after = nextElement(del);
            Element before = previousElement(del);
            Element ins = isInsertion(after) && !paired.contains(after) ? after
                    : isInsertion(before) && !paired.contains(before) ? before : null;
            Node parent = del.getParentNode();
            if (text.isEmpty()) {
                parent.removeChild(del);
                continue;
            }
            if (ins != null) {
                paired.add(ins);
                parent.insertBefore(markerRun(doc, del, "⟦原:" + text + "⟧"), ins.getNextSibling());
                parent.removeChild(del);
            } else {
                parent.replaceChild(markerRun(doc, del, "⟦删:" + text + "⟧"), del);
            }
        }
        for (Element ins : insertions) {
            if (paired.contains(ins) || textOf(ins, "t").isEmpty()) continue;
            Node parent = ins.getParentNode();
            parent.insertBefore(markerRun(doc, ins, "⟦增:"), ins);
            parent.insertBefore(markerRun(doc, ins, "⟧"), ins.getNextSibling());
        }

        var t = TransformerFactory.newDefaultInstance();
        t.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        t.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
        var transformer = t.newTransformer();
        transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
        ByteArrayOutputStream out = new ByteArrayOutputStream(xml.length + 256);
        transformer.transform(new DOMSource(doc), new StreamResult(out));
        return out.toByteArray();
    }

    /** 只取包住 run 的修订；rPr/pPr/trPr 里的同名元素是段落标记、表格行等属性修订，不是文字。 */
    private static List<Element> runLevel(Document doc, String... names) {
        List<Element> result = new ArrayList<>();
        for (String ns : new String[]{W_NS, W_NS_STRICT}) {
            for (String name : names) {
                NodeList list = doc.getElementsByTagNameNS(ns, name);
                for (int i = 0; i < list.getLength(); i++) {
                    Element e = (Element) list.item(i);
                    String parent = e.getParentNode().getLocalName();
                    if (parent != null && !parent.endsWith("Pr")) result.add(e);
                }
            }
        }
        return result;
    }

    private static boolean isInsertion(Element e) {
        if (e == null || !isW(e)) return false;
        String n = e.getLocalName();
        return "ins".equals(n) || "moveTo".equals(n);
    }

    private static boolean isW(Node n) {
        return W_NS.equals(n.getNamespaceURI()) || W_NS_STRICT.equals(n.getNamespaceURI());
    }

    private static String textOf(Element root, String... localNames) {
        StringBuilder sb = new StringBuilder();
        for (String name : localNames) {
            NodeList list = root.getElementsByTagNameNS(root.getNamespaceURI(), name);
            for (int i = 0; i < list.getLength(); i++) sb.append(list.item(i).getTextContent());
        }
        return sb.toString();
    }

    private static Element nextElement(Node n) {
        Node s = n.getNextSibling();
        while (s != null && s.getNodeType() != Node.ELEMENT_NODE) s = s.getNextSibling();
        return (Element) s;
    }

    private static Element previousElement(Node n) {
        Node s = n.getPreviousSibling();
        while (s != null && s.getNodeType() != Node.ELEMENT_NODE) s = s.getPreviousSibling();
        return (Element) s;
    }

    private static Element markerRun(Document doc, Element near, String text) {
        String ns = near.getNamespaceURI();
        String prefix = near.getPrefix() == null ? "" : near.getPrefix() + ":";
        Element r = doc.createElementNS(ns, prefix + "r");
        Element t = doc.createElementNS(ns, prefix + "t");
        t.setAttributeNS(XMLConstants.XML_NS_URI, "xml:space", "preserve");
        t.setTextContent(text);
        r.appendChild(t);
        return r;
    }
}
