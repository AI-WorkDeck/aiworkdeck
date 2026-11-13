// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.pitch;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * Word / PPT 模板填充：只用 JDK 的 zip 与 DOM，不依赖宿主类库。
 * 占位符 {{字段}} 可被 Word 拆成多个 run，先按段落合并再替换；列表字段按表格行、连续段落组或整页幻灯片复制。
 */
final class Ooxml {
    static final String W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    static final String A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    static final String P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    static final String PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
    static final String CT = "http://schemas.openxmlformats.org/package/2006/content-types";
    static final String SLIDE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
    static final String NOTES_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
    static final String R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    static final Pattern TOKEN = Pattern.compile("\\{\\{([^{}]{1,60})\\}\\}");
    static final long MAX_ENTRY = 10L * 1024 * 1024;
    static final int MAX_ENTRIES = 5000;
    static final long MAX_TOTAL = 200L * 1024 * 1024;

    /** 填充用的数据：单值字段 + 列表（键都是规范中文名）。 */
    record Data(Map<String, String> scalars, Map<String, List<Map<String, String>>> lists) {}

    /** 填充结果：文件字节 + 模板里没认出的占位符（原样保留，提醒律师）。 */
    record Result(byte[] bytes, Set<String> unknown, Set<Integer> overflowSlides) {}

    private final boolean pptx;
    private final Data data;
    private final Set<String> unknown = new TreeSet<>();
    /** 表格压缩行高后仍超出页面的幻灯片序号（1 起）。 */
    private final Set<Integer> overflow = new TreeSet<>();
    private static final long MIN_ROW = 228600;
    private long slideCy;
    private int slideNo;
    private final String pNs;
    private final String tName;

    private Ooxml(boolean pptx, Data data) {
        this.pptx = pptx;
        this.data = data;
        this.pNs = pptx ? A : W;
        this.tName = "t";
    }

    // 数据里的花括号先换成私用区字符，填完再换回：库或招标文件里的「{{…}}」文字不会被当成占位符
    private static final char OPEN = '\uE000';
    private static final char CLOSE = '\uE001';

    private static String escape(String v) { return v == null ? "" : v.replace('{', OPEN).replace('}', CLOSE); }

    private static Data escaped(Data d) {
        Map<String, String> sc = new LinkedHashMap<>();
        d.scalars().forEach((k, v) -> sc.put(k, escape(v)));
        Map<String, List<Map<String, String>>> lists = new LinkedHashMap<>();
        d.lists().forEach((k, items) -> {
            List<Map<String, String>> out = new ArrayList<>();
            for (Map<String, String> it : items) {
                Map<String, String> m = new LinkedHashMap<>();
                it.forEach((f, v) -> m.put(f, escape(v)));
                out.add(m);
            }
            lists.put(k, out);
        });
        return new Data(sc, lists);
    }

    static Result fill(byte[] template, boolean pptx, Data data) throws Exception {
        Ooxml engine = new Ooxml(pptx, escaped(data));
        Map<String, byte[]> parts = readZip(template);
        if (pptx ? !parts.containsKey("ppt/presentation.xml") : !parts.containsKey("word/document.xml")) {
            throw new PitchTools.Failure("template_invalid");
        }
        if (pptx) engine.fillPresentation(parts);
        else {
            for (String name : new ArrayList<>(parts.keySet())) {
                if (name.matches("word/(document|header\\d*|footer\\d*)\\.xml")) {
                    Document doc = parse(parts.get(name));
                    engine.fillWordPart(doc);
                    parts.put(name, serialize(doc));
                }
            }
        }
        for (Map.Entry<String, byte[]> e : parts.entrySet()) {
            if (!e.getKey().endsWith(".xml")) continue;
            String xml = new String(e.getValue(), StandardCharsets.UTF_8);
            if (xml.indexOf(OPEN) >= 0 || xml.indexOf(CLOSE) >= 0) {
                e.setValue(xml.replace(OPEN, '{').replace(CLOSE, '}').getBytes(StandardCharsets.UTF_8));
            }
        }
        return new Result(writeZip(parts), engine.unknown, engine.overflow);
    }

    /** 抽出全部可见文字（脱敏复查用）。 */
    static String text(byte[] file, boolean pptx) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, byte[]> e : readZip(file).entrySet()) {
            String name = e.getKey();
            boolean wanted = pptx ? name.matches("ppt/(slides/slide|notesSlides/notesSlide)\\d+\\.xml")
                    : name.matches("word/(document|header\\d*|footer\\d*|footnotes|endnotes|comments)\\.xml");
            if (!wanted) continue;
            Document doc = parse(e.getValue());
            NodeList paras = doc.getElementsByTagNameNS(pptx ? A : W, "p");
            for (int i = 0; i < paras.getLength(); i++) {
                for (Element t : texts((Element) paras.item(i), pptx ? A : W)) sb.append(t.getTextContent());
                sb.append('\n');
            }
        }
        return sb.toString();
    }

    // ------------------------------------------------------------------ Word

    private void fillWordPart(Document doc) {
        Element root = doc.getDocumentElement();
        mergeAll(root);
        expandRows(root, W);
        Element body = first(root, W, "body");
        expandParagraphGroups(body != null ? body : root);
        // 内容控件（w:sdt）里的段落组同样展开
        for (Element sdt : list(root, W, "sdtContent")) expandParagraphGroups(sdt);
        replaceScalars(root);
    }

    /** 容器的直接子段落里，连续引用同一列表的一组段落按条目整体复制。 */
    private void expandParagraphGroups(Element container) {
        List<Element> children = childElements(container);
        int i = 0;
        while (i < children.size()) {
            Element el = children.get(i);
            String coll = isPara(el) ? collectionOf(el) : null;
            if (coll == null) { i++; continue; }
            int j = i;
            while (j + 1 < children.size() && isPara(children.get(j + 1)) && coll.equals(collectionOf(children.get(j + 1)))) j++;
            List<Element> group = children.subList(i, j + 1);
            List<Map<String, String>> items = data.lists().getOrDefault(coll, List.of());
            List<Element> originals = new ArrayList<>(group);
            Node anchor = originals.get(0);
            for (Map<String, String> item : items) {
                for (Element g : originals) {
                    Element copy = (Element) g.cloneNode(true);
                    container.insertBefore(copy, anchor);
                    fillItem(copy, coll, item);
                }
            }
            // 填充时多段值会把一个段落拆成几段，按「原组之前的元素数」重新定位
            Node next = originals.get(originals.size() - 1).getNextSibling();
            for (Element g : originals) container.removeChild(g);
            children = childElements(container);
            i = next == null ? children.size() : children.indexOf(firstElementFrom(next));
            if (i < 0) i = children.size();
        }
    }

    private static Element firstElementFrom(Node n) {
        for (Node c = n; c != null; c = c.getNextSibling()) if (c instanceof Element e) return e;
        return null;
    }

    private boolean isPara(Element el) {
        return pNs.equals(el.getNamespaceURI()) && "p".equals(el.getLocalName());
    }

    // ------------------------------------------------------------------ 表格行

    private void expandRows(Element root, String ns) {
        Map<Element, Long> before = new LinkedHashMap<>();
        if (pptx) for (Element tbl : list(root, A, "tbl")) before.put(tbl, rowHeights(tbl));
        for (Element tr : list(root, ns, "tr")) {
            if (tr.getParentNode() == null) continue;
            String coll = collectionOf(tr);
            if (coll == null) continue;
            List<Map<String, String>> items = data.lists().getOrDefault(coll, List.of());
            Node parent = tr.getParentNode();
            for (Map<String, String> item : items) {
                Element copy = (Element) tr.cloneNode(true);
                parent.insertBefore(copy, tr);
                fillItem(copy, coll, item);
            }
            parent.removeChild(tr);
        }
        before.forEach((tbl, h) -> reflow(tbl, rowHeights(tbl) - h));
    }

    private static long rowHeights(Element tbl) {
        long sum = 0;
        for (Element tr : list(tbl, A, "tr")) {
            try { sum += Long.parseLong(tr.getAttribute("h")); } catch (NumberFormatException ignored) { /* 无行高按 0 */ }
        }
        return sum;
    }

    /**
     * PPT 表格行数变了：表格框随之变高，原来在表格下方的形状一起下移（或上移），不压在表格上；
     * 页脚区（页面底部 12%）的形状不动。表格或被下推的形状会超出页面时，先按比例压低行高
     * （每行不低于按文字估算的所需高度），仍放不下的由 checkFit 记提示交给律师处理。
     */
    private void reflow(Element tbl, long delta) {
        if (delta == 0) return;
        Element frame = ancestor(tbl, P, "graphicFrame");
        if (frame == null || !(frame.getParentNode() instanceof Element tree)) return;
        Element off = first(frame, A, "off");
        Element ext = first(frame, A, "ext");
        if (off == null || ext == null) return;
        long top = attr(off, "y");
        long oldCy = attr(ext, "cy");
        long bottom = top + oldCy;
        long limit = slideCy > 0 ? slideCy * 94 / 100 : Long.MAX_VALUE;
        long footer = slideCy > 0 ? slideCy * 88 / 100 : Long.MAX_VALUE;
        List<Element> below = new ArrayList<>();
        long belowBottom = bottom;
        for (Element shape : childElements(tree)) {
            if (shape == frame || !P.equals(shape.getNamespaceURI())) continue;
            Element o = first(shape, A, "off");
            Element e = first(shape, A, "ext");
            if (o == null || attr(o, "y") < bottom - 12700 || attr(o, "y") >= footer) continue;
            below.add(o);
            belowBottom = Math.max(belowBottom, attr(o, "y") + (e == null ? 0 : attr(e, "cy")));
        }
        long newCy = Math.max(0, oldCy + delta);
        // 表格自身和被下推的形状都要留在页面里：算出表格最多能长到多高
        long maxCy = Math.min(limit - top, oldCy + (limit - belowBottom));
        if (newCy > maxCy) {
            List<Element> rows = list(tbl, A, "tr");
            long sum = rowHeights(tbl);
            long target = Math.max(maxCy, rows.size() * MIN_ROW);
            if (sum > target && sum > 0) {
                for (Element tr : rows) tr.setAttribute("h", String.valueOf(Math.max(Math.max(MIN_ROW, rowNeed(tbl, tr)), attr(tr, "h") * target / sum)));
                newCy = rowHeights(tbl);
            }
        }
        ext.setAttribute("cy", String.valueOf(newCy));
        long shift = newCy - oldCy;
        for (Element o : below) o.setAttribute("y", String.valueOf(Math.max(0, attr(o, "y") + shift)));
    }

    // ------------------------------------------------------------------ 版面估算（PPT）
    // JAR 里没有排版引擎，按字数、字号、框宽保守估算文字实际占用的高度：中日韩字符按一个字宽、其余按 0.6 个字宽，
    // 行高取字号的 1.2 倍乘行距。只用于判断「会不会超出页面」，宁可多报，不可漏报。

    private static final long EMU_PER_PT = 12700;
    private static final int DEFAULT_SZ = 1800;

    /** 一段文字在给定宽度里需要的高度（EMU）。 */
    private static long paragraphHeight(Element p, long width) {
        int sz = 0;
        StringBuilder text = new StringBuilder();
        for (Element t : texts(p, A)) text.append(t.getTextContent());
        for (Element r : list(p, A, "rPr")) sz = Math.max(sz, (int) attr(r, "sz"));
        Element end = first(p, A, "endParaRPr");
        if (sz == 0 && end != null) sz = (int) attr(end, "sz");
        if (sz == 0) {
            Element def = first(p, A, "defRPr");
            sz = def != null && attr(def, "sz") > 0 ? (int) attr(def, "sz") : DEFAULT_SZ;
        }
        double ptSize = sz / 100.0;
        double units = 0;
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            units += Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN || (cp >= 0x3000 && cp <= 0x30FF) || (cp >= 0xFF00 && cp <= 0xFFEF) ? 1.0 : 0.6;
            i += Character.charCount(cp);
        }
        double perLine = Math.max(1, width / (ptSize * EMU_PER_PT));
        long lines = Math.max(1, (long) Math.ceil(units / perLine));
        double spacing = 1.2;
        Element spc = first(p, A, "spcPct");
        if (spc != null && attr(spc, "val") > 0 && ancestor(spc, A, "lnSpc") != null) spacing = 1.2 * attr(spc, "val") / 100000.0;
        return (long) Math.ceil(lines * ptSize * spacing * EMU_PER_PT);
    }

    /** 表格行按各单元格文字估算的最低所需高度。 */
    private static long rowNeed(Element tbl, Element tr) {
        List<Long> cols = new ArrayList<>();
        for (Element g : list(tbl, A, "gridCol")) cols.add(attr(g, "w"));
        long need = 0;
        int col = 0;
        for (Element tc : childElements(tr)) {
            if (!"tc".equals(tc.getLocalName())) continue;
            int span = tc.hasAttribute("gridSpan") ? (int) Math.max(1, attr(tc, "gridSpan")) : 1;
            long width = 0;
            for (int k = col; k < Math.min(cols.size(), col + span); k++) width += cols.get(k);
            col += span;
            Element pr = first(tc, A, "tcPr");
            long insetX = (pr != null && pr.hasAttribute("marL") ? attr(pr, "marL") : 91440) + (pr != null && pr.hasAttribute("marR") ? attr(pr, "marR") : 91440);
            long insetY = (pr != null && pr.hasAttribute("marT") ? attr(pr, "marT") : 45720) + (pr != null && pr.hasAttribute("marB") ? attr(pr, "marB") : 45720);
            long h = insetY;
            for (Element p : list(tc, A, "p")) h += paragraphHeight(p, Math.max(EMU_PER_PT, width - insetX));
            need = Math.max(need, h);
        }
        return need;
    }

    /** 填完的幻灯片：表格或文本框按估算会伸出页面底部的，记一条提示。 */
    private void checkFit(Element root) {
        if (slideCy <= 0) return;
        long limit = slideCy * 97 / 100;
        for (Element tbl : list(root, A, "tbl")) {
            Element frame = ancestor(tbl, P, "graphicFrame");
            Element off = frame == null ? null : first(frame, A, "off");
            if (off == null) continue;
            long total = 0;
            for (Element tr : list(tbl, A, "tr")) total += Math.max(attr(tr, "h"), rowNeed(tbl, tr));
            if (attr(off, "y") + total > limit) overflow.add(slideNo);
        }
        for (Element sp : list(root, P, "sp")) {
            Element body = first(sp, P, "txBody");
            Element off = first(sp, A, "off");
            Element ext = first(sp, A, "ext");
            if (body == null || off == null || ext == null) continue;
            Element bodyPr = first(body, A, "bodyPr");
            long insetX = (bodyPr != null && bodyPr.hasAttribute("lIns") ? attr(bodyPr, "lIns") : 91440) + (bodyPr != null && bodyPr.hasAttribute("rIns") ? attr(bodyPr, "rIns") : 91440);
            long h = (bodyPr != null && bodyPr.hasAttribute("tIns") ? attr(bodyPr, "tIns") : 45720) + (bodyPr != null && bodyPr.hasAttribute("bIns") ? attr(bodyPr, "bIns") : 45720);
            for (Element p : list(body, A, "p")) h += paragraphHeight(p, Math.max(EMU_PER_PT, attr(ext, "cx") - insetX));
            if (attr(off, "y") + h > limit) overflow.add(slideNo);
        }
    }

    private static long attr(Element el, String name) {
        try { return Long.parseLong(el.getAttribute(name)); } catch (NumberFormatException e) { return 0; }
    }

    // ------------------------------------------------------------------ PPT

    private void fillPresentation(Map<String, byte[]> parts) throws Exception {
        Document pres = parse(parts.get("ppt/presentation.xml"));
        Document presRels = parse(parts.get("ppt/_rels/presentation.xml.rels"));
        Document types = parse(parts.get("[Content_Types].xml"));
        Element sldIdLst = first(pres.getDocumentElement(), P, "sldIdLst");
        if (sldIdLst == null) throw new PitchTools.Failure("template_invalid");
        Element sldSz = first(pres.getDocumentElement(), P, "sldSz");
        slideCy = sldSz == null ? 0 : attr(sldSz, "cy");
        Map<String, String> relTarget = new HashMap<>();
        for (Element rel : list(presRels.getDocumentElement(), PKG_REL, "Relationship")) {
            relTarget.put(rel.getAttribute("Id"), rel.getAttribute("Target"));
        }
        int nextSlide = 1;
        for (String name : parts.keySet()) {
            Matcher m = Pattern.compile("ppt/slides/slide(\\d+)\\.xml").matcher(name);
            if (m.matches()) nextSlide = Math.max(nextSlide, Integer.parseInt(m.group(1)) + 1);
        }
        long nextId = 256;
        int nextRel = 1;
        for (Element s : childElements(sldIdLst)) nextId = Math.max(nextId, Long.parseLong(s.getAttribute("id")) + 1);
        for (String id : relTarget.keySet()) {
            Matcher m = Pattern.compile("rId(\\d+)").matcher(id);
            if (m.matches()) nextRel = Math.max(nextRel, Integer.parseInt(m.group(1)) + 1);
        }

        int position = 0;
        for (Element sldId : childElements(sldIdLst)) {
            String rid = sldId.getAttributeNS(R_NS, "id");
            slideNo = ++position;
            String target = relTarget.get(rid);
            if (target == null) continue;
            String part = "ppt/" + target.replaceFirst("^/?ppt/", "").replaceFirst("^\\./", "");
            byte[] bytes = parts.get(part);
            if (bytes == null) continue;
            Document slide = parse(bytes);
            Element root = slide.getDocumentElement();
            mergeAll(root);
            expandRows(root, A);
            String coll = collectionOutsideTables(root);
            String relsName = part.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
            if (coll == null) {
                replaceScalars(root);
                checkFit(root);
                parts.put(part, serialize(slide));
                continue;
            }
            List<Map<String, String>> items = data.lists().getOrDefault(coll, List.of());
            byte[] base = serialize(slide);
            byte[] rels = parts.get(relsName);
            Node after = sldId.getNextSibling();
            for (int k = 0; k < items.size(); k++) {
                Document copy = parse(base);
                fillItem(copy.getDocumentElement(), coll, items.get(k));
                replaceScalars(copy.getDocumentElement());
                int keep = slideNo;
                slideNo = keep + k;
                checkFit(copy.getDocumentElement());
                slideNo = keep;
                if (k == 0) {
                    parts.put(part, serialize(copy));
                    continue;
                }
                String newPart = "ppt/slides/slide" + nextSlide + ".xml";
                parts.put(newPart, serialize(copy));
                if (rels != null) parts.put("ppt/slides/_rels/slide" + nextSlide + ".xml.rels", withoutNotes(rels));
                Element override = types.createElementNS(CT, "Override");
                override.setAttribute("PartName", "/" + newPart);
                override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
                types.getDocumentElement().appendChild(override);
                String newRid = "rId" + nextRel++;
                Element rel = presRels.createElementNS(PKG_REL, "Relationship");
                rel.setAttribute("Id", newRid);
                rel.setAttribute("Type", SLIDE_REL);
                rel.setAttribute("Target", "slides/slide" + nextSlide + ".xml");
                presRels.getDocumentElement().appendChild(rel);
                Element newId = pres.createElementNS(P, "p:sldId");
                newId.setAttribute("id", String.valueOf(nextId++));
                newId.setAttributeNS(R_NS, "r:id", newRid);
                sldIdLst.insertBefore(newId, after);
                nextSlide++;
            }
            position += items.size() - 1; // 生成稿里的页序随复制/删除变化
            if (items.isEmpty()) {
                // 没有条目：整页删掉（幻灯片、关系、类型声明一起清理）
                sldIdLst.removeChild(sldId);
                parts.remove(part);
                parts.remove(relsName);
                for (Element rel : list(presRels.getDocumentElement(), PKG_REL, "Relationship")) {
                    if (rel.getAttribute("Id").equals(rid)) rel.getParentNode().removeChild(rel);
                }
                for (Element o : list(types.getDocumentElement(), CT, "Override")) {
                    if (o.getAttribute("PartName").equals("/" + part)) o.getParentNode().removeChild(o);
                }
            }
        }
        parts.put("ppt/presentation.xml", serialize(pres));
        parts.put("ppt/_rels/presentation.xml.rels", serialize(presRels));
        parts.put("[Content_Types].xml", serialize(types));
    }

    /** 复制出的幻灯片不共享原页的备注页（两页指向同一备注会被 PowerPoint 判为需要修复）。 */
    private static byte[] withoutNotes(byte[] rels) throws Exception {
        Document doc = parse(rels);
        for (Element rel : list(doc.getDocumentElement(), PKG_REL, "Relationship")) {
            if (NOTES_REL.equals(rel.getAttribute("Type"))) rel.getParentNode().removeChild(rel);
        }
        return serialize(doc);
    }

    private String collectionOutsideTables(Element root) {
        for (Element p : list(root, A, "p")) {
            if (ancestor(p, A, "tbl") != null) continue;
            String c = collectionOf(p);
            if (c != null) return c;
        }
        return null;
    }

    // ------------------------------------------------------------------ 占位符

    /** 合并被拆进多个文字节点的占位符：整段占位符挪到它开始的那个节点里。 */
    private void mergeAll(Element root) {
        for (Element p : list(root, pNs, "p")) mergeParagraph(p);
    }

    private void mergeParagraph(Element p) {
        List<Element> ts = texts(p, pNs);
        if (ts.size() < 2) return;
        for (int guard = 0; guard < 200; guard++) {
            StringBuilder all = new StringBuilder();
            int[] starts = new int[ts.size()];
            for (int i = 0; i < ts.size(); i++) { starts[i] = all.length(); all.append(ts.get(i).getTextContent()); }
            Matcher m = TOKEN.matcher(all);
            boolean changed = false;
            while (m.find()) {
                int a = m.start();
                int b = m.end();
                int i = nodeAt(starts, a);
                int j = nodeAt(starts, b - 1);
                if (i == j) continue;
                String si = ts.get(i).getTextContent();
                setText(ts.get(i), si.substring(0, a - starts[i]) + m.group());
                for (int k = i + 1; k < j; k++) setText(ts.get(k), "");
                String sj = ts.get(j).getTextContent();
                setText(ts.get(j), sj.substring(b - starts[j]));
                changed = true;
                break;
            }
            if (!changed) return;
        }
    }

    private static int nodeAt(int[] starts, int offset) {
        int idx = 0;
        for (int i = 0; i < starts.length; i++) if (starts[i] <= offset) idx = i;
        // 空节点与下一个节点起点相同：取最后一个起点 ≤ offset 的非空节点由调用方保证
        return idx;
    }

    /** 元素里出现的第一个列表字段所属的列表名；没有返回 null。 */
    private String collectionOf(Element el) {
        for (Element t : allTexts(el)) {
            Matcher m = TOKEN.matcher(t.getTextContent());
            while (m.find()) {
                Fields.Key k = Fields.resolve(m.group(1));
                if (k != null && k.list() != null) return k.list();
            }
        }
        return null;
    }

    private void fillItem(Element el, String coll, Map<String, String> item) {
        replaceIn(el, key -> {
            Fields.Key k = Fields.resolve(key);
            if (k == null || !coll.equals(k.list())) return null;
            return item.getOrDefault(k.field(), "");
        });
    }

    private void replaceScalars(Element root) {
        replaceIn(root, key -> {
            Fields.Key k = Fields.resolve(key);
            if (k == null) { unknown.add("{{" + key + "}}"); return null; }
            if (k.list() != null) return null;
            return data.scalars().getOrDefault(k.field(), "");
        });
        // 还留着的列表占位符（放在无法复制的位置，如嵌套表格）也报给律师，不静默保留
        for (Element t : allTexts(root)) {
            Matcher m = TOKEN.matcher(t.getTextContent());
            while (m.find()) {
                Fields.Key k = Fields.resolve(m.group(1));
                if (k != null && k.list() != null) unknown.add(m.group());
            }
        }
    }

    private interface Lookup { String get(String key); }

    private void replaceIn(Element root, Lookup lookup) {
        List<Element> paras = list(root, pNs, "p");
        if (pNs.equals(root.getNamespaceURI()) && "p".equals(root.getLocalName())) paras.add(0, root);
        for (Element p : paras) {
            if (p.getParentNode() == null) continue;
            List<Element> ts = texts(p, pNs);
            // 段落里只有一个占位符且值是多段文字：按段复制段落，保留段落格式
            Matcher only = TOKEN.matcher(joined(ts).trim());
            if (only.matches()) {
                String v = lookup.get(only.group(1));
                if (v != null && v.contains("\n")) { splitParagraph(p, v); continue; }
            }
            for (Element t : ts) {
                String s = t.getTextContent();
                if (!s.contains("{{")) continue;
                Matcher m = TOKEN.matcher(s);
                StringBuilder out = new StringBuilder();
                int last = 0;
                boolean hit = false;
                while (m.find()) {
                    String v = lookup.get(m.group(1));
                    if (v == null) continue;
                    out.append(s, last, m.start()).append(v);
                    last = m.end();
                    hit = true;
                }
                if (!hit) continue;
                out.append(s.substring(last));
                setMultiline(t, out.toString());
            }
        }
    }

    private void splitParagraph(Element p, String value) {
        Node parent = p.getParentNode();
        String[] lines = value.split("\n", -1);
        for (String line : lines) {
            Element copy = (Element) p.cloneNode(true);
            List<Element> cts = texts(copy, pNs);
            boolean placed = false;
            for (Element t : cts) {
                if (!placed && t.getTextContent().contains("{{")) { setText(t, line); placed = true; }
                else setText(t, "");
            }
            parent.insertBefore(copy, p);
        }
        parent.removeChild(p);
    }

    /** 值里的换行：Word 用 w:br，PPT 用 a:br（拆成相邻 run）。 */
    private void setMultiline(Element t, String value) {
        if (!value.contains("\n")) { setText(t, value); return; }
        String[] lines = value.split("\n", -1);
        Element run = (Element) t.getParentNode();
        Document doc = t.getOwnerDocument();
        if (!pptx) {
            setText(t, lines[0]);
            Node ref = t.getNextSibling();
            for (int i = 1; i < lines.length; i++) {
                run.insertBefore(doc.createElementNS(W, "w:br"), ref);
                Element nt = doc.createElementNS(W, "w:t");
                setText(nt, lines[i]);
                run.insertBefore(nt, ref);
            }
            return;
        }
        Node para = run.getParentNode();
        Node ref = run.getNextSibling();
        setText(t, lines[0]);
        for (int i = 1; i < lines.length; i++) {
            Element br = doc.createElementNS(A, "a:br");
            Element rPr = first(run, A, "rPr");
            if (rPr != null) br.appendChild(rPr.cloneNode(true));
            para.insertBefore(br, ref);
            Element r2 = (Element) run.cloneNode(true);
            setText(first(r2, A, "t"), lines[i]);
            para.insertBefore(r2, ref);
        }
    }

    private void setText(Element t, String s) {
        t.setTextContent(clean(s));
        if (!pptx) t.setAttributeNS(XMLConstants.XML_NS_URI, "xml:space", "preserve");
    }

    static String clean(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length());
        s.codePoints().forEach(c -> {
            if (c == 0x9 || c == 0xA || c == 0xD || (c >= 0x20 && c <= 0xD7FF) || (c >= 0xE000 && c <= 0xFFFD) || c >= 0x10000) sb.appendCodePoint(c);
        });
        return sb.toString();
    }

    private static String joined(List<Element> ts) {
        StringBuilder sb = new StringBuilder();
        for (Element t : ts) sb.append(t.getTextContent());
        return sb.toString();
    }

    /** 段落自己的文字节点（不含嵌套文本框里的段落）。 */
    private static List<Element> texts(Element p, String ns) {
        List<Element> out = new ArrayList<>();
        NodeList nl = p.getElementsByTagNameNS(ns, "t");
        for (int i = 0; i < nl.getLength(); i++) {
            Element t = (Element) nl.item(i);
            if (ancestor(t, ns, "p") == p) out.add(t);
        }
        return out;
    }

    private List<Element> allTexts(Element el) {
        List<Element> out = new ArrayList<>();
        NodeList nl = el.getElementsByTagNameNS(pNs, tName);
        for (int i = 0; i < nl.getLength(); i++) out.add((Element) nl.item(i));
        return out;
    }

    // ------------------------------------------------------------------ DOM / zip 工具

    private static Element ancestor(Node n, String ns, String local) {
        for (Node c = n.getParentNode(); c != null; c = c.getParentNode()) {
            if (c instanceof Element e && ns.equals(e.getNamespaceURI()) && local.equals(e.getLocalName())) return e;
        }
        return null;
    }

    static List<Element> list(Element root, String ns, String local) {
        NodeList nl = root.getElementsByTagNameNS(ns, local);
        List<Element> out = new ArrayList<>(nl.getLength());
        for (int i = 0; i < nl.getLength(); i++) out.add((Element) nl.item(i));
        return out;
    }

    private static Element first(Element root, String ns, String local) {
        NodeList nl = root.getElementsByTagNameNS(ns, local);
        return nl.getLength() == 0 ? null : (Element) nl.item(0);
    }

    private static List<Element> childElements(Node n) {
        List<Element> out = new ArrayList<>();
        for (Node c = n.getFirstChild(); c != null; c = c.getNextSibling()) if (c instanceof Element e) out.add(e);
        return out;
    }

    static Document parse(byte[] xml) throws Exception {
        // 用 JDK 自带实现：宿主类路径上的 Xerces/Xalan 等不一定支持下面的安全开关
        DocumentBuilderFactory f = DocumentBuilderFactory.newDefaultInstance();
        f.setNamespaceAware(true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        f.setFeature("http://xml.org/sax/features/external-general-entities", false);
        f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        f.setXIncludeAware(false);
        f.setExpandEntityReferences(false);
        f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        DocumentBuilder b = f.newDocumentBuilder();
        Document d = b.parse(new ByteArrayInputStream(xml));
        d.setXmlStandalone(true);
        return d;
    }

    static byte[] serialize(Document doc) throws Exception {
        TransformerFactory tf = TransformerFactory.newDefaultInstance();
        tf.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        tf.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
        Transformer t = tf.newTransformer();
        t.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
        t.setOutputProperty(OutputKeys.INDENT, "no");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        t.transform(new DOMSource(doc), new StreamResult(out));
        return out.toByteArray();
    }

    static Map<String, byte[]> readZip(byte[] zip) throws IOException {
        Map<String, byte[]> parts = new LinkedHashMap<>();
        long total = 0;
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(zip), StandardCharsets.UTF_8)) {
            ZipEntry e;
            while ((e = in.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                String name = e.getName();
                if (name.contains("..") || name.startsWith("/")) throw new PitchTools.Failure("template_invalid");
                if (parts.size() >= MAX_ENTRIES) throw new PitchTools.Failure("template_too_large");
                // 媒体文件可以大，XML 部件会整份载入 DOM：单个部件不超过 10 MB
                byte[] bytes = readLimited(in, name.endsWith(".xml") || name.endsWith(".rels") ? MAX_ENTRY : MAX_TOTAL);
                total += bytes.length;
                if (total > MAX_TOTAL) throw new PitchTools.Failure("template_too_large");
                parts.put(name, bytes);
            }
        } catch (java.util.zip.ZipException e) {
            throw new PitchTools.Failure("template_invalid");
        }
        if (parts.isEmpty()) throw new PitchTools.Failure("template_invalid");
        return parts;
    }

    private static byte[] readLimited(InputStream in, long max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        long n = 0;
        int r;
        while ((r = in.read(buf)) > 0) {
            n += r;
            if (n > max) throw new PitchTools.Failure("template_too_large");
            out.write(buf, 0, r);
        }
        return out.toByteArray();
    }

    static byte[] writeZip(Map<String, byte[]> parts) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
            List<String> names = new ArrayList<>(parts.keySet());
            names.remove("[Content_Types].xml");
            names.add(0, "[Content_Types].xml");
            for (String name : names) {
                byte[] b = parts.get(name);
                if (b == null) continue;
                ZipEntry e = new ZipEntry(name);
                e.setTime(0L);
                z.putNextEntry(e);
                z.write(b);
                z.closeEntry();
            }
        }
        return out.toByteArray();
    }
}
