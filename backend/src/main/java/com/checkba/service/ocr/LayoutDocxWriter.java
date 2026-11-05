// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

import com.checkba.service.ai.AiDocxExportService;
import com.checkba.service.ocr.OcrLayout.*;
import com.checkba.util.DocxStyleHelper;
import org.docx4j.XmlUtils;
import org.docx4j.dml.wordprocessingDrawing.Anchor;
import org.docx4j.dml.wordprocessingDrawing.Inline;
import org.docx4j.jaxb.Context;
import org.docx4j.openpackaging.packages.WordprocessingMLPackage;
import org.docx4j.openpackaging.parts.WordprocessingML.BinaryPartAbstractImage;
import org.docx4j.openpackaging.parts.WordprocessingML.MainDocumentPart;
import org.docx4j.wml.*;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.util.List;

/**
 * Renders an {@link OcrLayout} to Word with docx4j: page size and margins of the source page,
 * Title/Heading2 styles (so headings show in the navigation pane), alignment, two-character first
 * line indents, tables with real merged cells, and seals as page-anchored pictures behind the text.
 *
 * <p>Deliberately does not run the house style profile ({@code DocxStyleHelper.applyProfile}): it
 * resets page setup, numbers headings and restyles tables, which would undo the reconstruction.
 */
public final class LayoutDocxWriter {

    private static final ObjectFactory W = Context.getWmlObjectFactory();
    private static final long EMU_PER_PT = 12700;
    private static final String BODY_FONT_EAST_ASIA = "宋体";
    private static final String BODY_FONT_LATIN = "Times New Roman";

    private LayoutDocxWriter() {}

    public static byte[] write(List<Page> pages) throws Exception {
        WordprocessingMLPackage pkg = WordprocessingMLPackage.createPackage();
        DocxStyleHelper.addMissingStyles(pkg);
        MainDocumentPart main = pkg.getMainDocumentPart();
        setDefaultFont(main);
        int pictureId = 1;
        for (int i = 0; i < pages.size(); i++) {
            Page page = pages.get(i);
            // Floating pictures are anchored to the paragraph that follows them in the block list.
            List<Picture> pending = new java.util.ArrayList<>();
            for (Block block : page.blocks()) {
                P host = null;
                if (block instanceof Para para) {
                    host = paragraph(para, page);
                    main.getContent().add(host);
                } else if (block instanceof Table table) {
                    main.getContent().add(table(table, page));
                } else if (block instanceof Picture pic && pic.xPt() != null) {
                    pending.add(pic);
                } else if (block instanceof Picture pic) {
                    host = W.createP();
                    host.getContent().add(drawingRun(inline(pkg, pic, pictureId++)));
                    main.getContent().add(host);
                }
                if (host != null) {
                    for (Picture pic : pending) host.getContent().add(0, drawingRun(anchor(pkg, pic, pictureId++)));
                    pending.clear();
                }
            }
            if (!pending.isEmpty()) {
                P host = W.createP();
                for (Picture pic : pending) host.getContent().add(drawingRun(anchor(pkg, pic, pictureId++)));
                main.getContent().add(host);
            }
            if (i < pages.size() - 1) main.getContent().add(pageBreak());
        }
        if (!pages.isEmpty()) main.getContents().getBody().setSectPr(section(pages.get(0)));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        pkg.save(out);
        return out.toByteArray();
    }

    // ------------------------------------------------------------------ text

    static P paragraph(Para para, Page page) {
        P p = W.createP();
        PPr ppr = W.createPPr();
        if (para.kind() != Kind.BODY) {
            PPrBase.PStyle style = W.createPPrBasePStyle();
            style.setVal(para.kind() == Kind.TITLE ? "Heading1" : "Heading2");
            ppr.setPStyle(style);
        }
        PPrBase.Spacing spacing = W.createPPrBaseSpacing();
        if (para.kind() == Kind.BODY && page != null) {
            spacing.setLine(twips(page.linePitchPt()));
            spacing.setLineRule(STLineSpacingRule.EXACT);
            spacing.setBefore(BigInteger.ZERO);
            spacing.setAfter(twips(page.bodyPt() * 0.5));
        } else if (para.kind() != Kind.BODY) {
            spacing.setBefore(twips(page == null ? 6 : page.bodyPt()));
            spacing.setAfter(twips(page == null ? 6 : page.bodyPt() * 0.5));
        } else {
            spacing.setBefore(BigInteger.ZERO);
            spacing.setAfter(BigInteger.ZERO);
        }
        ppr.setSpacing(spacing);
        Jc jc = W.createJc();
        jc.setVal(switch (para.align()) {
            case CENTER -> JcEnumeration.CENTER;
            case RIGHT -> JcEnumeration.RIGHT;
            default -> JcEnumeration.BOTH;
        });
        if (para.kind() != Kind.BODY && para.align() == Align.LEFT) jc.setVal(JcEnumeration.LEFT);
        ppr.setJc(jc);
        if (para.firstLineIndent()) {
            PPrBase.Ind ind = W.createPPrBaseInd();
            ind.setFirstLineChars(BigInteger.valueOf(200));
            ppr.setInd(ind);
        }
        p.setPPr(ppr);
        R r = W.createR();
        RPr rpr = W.createRPr();
        double body = page == null ? 12 : page.bodyPt();
        double pt = switch (para.kind()) {
            case TITLE -> Math.max(body * 1.6, 16);
            case HEADING -> body * 1.15;
            default -> body;
        };
        HpsMeasure size = W.createHpsMeasure();
        size.setVal(BigInteger.valueOf(Math.round(pt * 2)));
        rpr.setSz(size);
        rpr.setSzCs(size);
        if (para.kind() != Kind.BODY) {
            rpr.setB(W.createBooleanDefaultTrue());
            rpr.setRFonts(fonts("黑体"));
            Color black = W.createColor();
            black.setVal("000000");
            rpr.setColor(black);
        }
        r.setRPr(rpr);
        Text t = W.createText();
        t.setValue(AiDocxExportService.stripXmlInvalidChars(para.text()));
        t.setSpace("preserve");
        r.getContent().add(t);
        p.getContent().add(r);
        return p;
    }

    static RFonts fonts(String eastAsia) {
        RFonts f = W.createRFonts();
        f.setEastAsia(eastAsia);
        f.setAscii(BODY_FONT_LATIN);
        f.setHAnsi(BODY_FONT_LATIN);
        return f;
    }

    static void setDefaultFont(MainDocumentPart main) {
        var styles = main.getStyleDefinitionsPart();
        if (styles == null) return;
        try {
            DocDefaults defaults = styles.getJaxbElement().getDocDefaults();
            if (defaults == null) { defaults = W.createDocDefaults(); styles.getJaxbElement().setDocDefaults(defaults); }
            DocDefaults.RPrDefault rd = defaults.getRPrDefault();
            if (rd == null) { rd = W.createDocDefaultsRPrDefault(); defaults.setRPrDefault(rd); }
            RPr rpr = rd.getRPr();
            if (rpr == null) { rpr = W.createRPr(); rd.setRPr(rpr); }
            rpr.setRFonts(fonts(BODY_FONT_EAST_ASIA));
            HpsMeasure size = W.createHpsMeasure();
            size.setVal(BigInteger.valueOf(24));
            rpr.setSz(size);
            rpr.setSzCs(size);
        } catch (Exception ignored) {
            // style defaults are cosmetic; the document is still valid without them
        }
    }

    static P pageBreak() {
        P p = W.createP();
        R r = W.createR();
        Br br = W.createBr();
        br.setType(STBrType.PAGE);
        r.getContent().add(br);
        p.getContent().add(r);
        return p;
    }

    static SectPr section(Page page) {
        SectPr sect = W.createSectPr();
        SectPr.PgSz size = W.createSectPrPgSz();
        size.setW(twips(page.widthPt()));
        size.setH(twips(page.heightPt()));
        if (page.widthPt() > page.heightPt()) size.setOrient(STPageOrientation.LANDSCAPE);
        sect.setPgSz(size);
        SectPr.PgMar mar = W.createSectPrPgMar();
        mar.setLeft(twips(page.marginLeft()));
        mar.setRight(twips(page.marginRight()));
        mar.setTop(twips(page.marginTop()));
        mar.setBottom(twips(page.marginBottom()));
        mar.setHeader(BigInteger.valueOf(720));
        mar.setFooter(BigInteger.valueOf(720));
        sect.setPgMar(mar);
        return sect;
    }

    static BigInteger twips(double pt) {
        return BigInteger.valueOf(Math.round(pt * 20));
    }

    // ------------------------------------------------------------------ tables

    static Tbl table(Table table, Page page) {
        Tbl tbl = W.createTbl();
        TblPr pr = W.createTblPr();
        TblBorders borders = W.createTblBorders();
        borders.setTop(border()); borders.setBottom(border()); borders.setLeft(border());
        borders.setRight(border()); borders.setInsideH(border()); borders.setInsideV(border());
        pr.setTblBorders(borders);
        CTTblLayoutType layout = W.createCTTblLayoutType();
        layout.setType(STTblLayoutType.FIXED);
        pr.setTblLayout(layout);
        tbl.setTblPr(pr);
        TblGrid grid = W.createTblGrid();
        for (double w : table.colWidths()) {
            TblGridCol col = W.createTblGridCol();
            col.setW(twips(w));
            grid.getGridCol().add(col);
        }
        tbl.setTblGrid(grid);
        for (int r = 0; r < table.rows(); r++) {
            Tr tr = W.createTr();
            for (int c = 0; c < table.cols(); ) {
                Cell cell = covering(table, r, c);
                int span = cell == null ? 1 : cell.c1() - cell.c0() + 1;
                Tc tc = W.createTc();
                TcPr tcPr = W.createTcPr();
                TblWidth width = W.createTblWidth();
                double w = 0;
                for (int k = c; k < c + span && k < table.colWidths().length; k++) w += table.colWidths()[k];
                width.setW(twips(w));
                width.setType("dxa");
                tcPr.setTcW(width);
                if (span > 1) {
                    TcPrInner.GridSpan gs = W.createTcPrInnerGridSpan();
                    gs.setVal(BigInteger.valueOf(span));
                    tcPr.setGridSpan(gs);
                }
                String text = "";
                if (cell != null && cell.r1() > cell.r0()) {
                    TcPrInner.VMerge vm = W.createTcPrInnerVMerge();
                    if (cell.r0() == r) vm.setVal("restart");
                    tcPr.setVMerge(vm);
                }
                if (cell != null && cell.r0() == r) text = cell.text();
                tc.setTcPr(tcPr);
                tc.getContent().add(paragraph(new Para(text, Kind.BODY, Align.LEFT, false), null));
                if (page != null) {
                    var run = (R) ((P) tc.getContent().get(0)).getContent().get(0);
                    HpsMeasure cellSize = W.createHpsMeasure();
                    cellSize.setVal(BigInteger.valueOf(Math.round(page.bodyPt() * 2)));
                    run.getRPr().setSz(cellSize);
                    run.getRPr().setSzCs(cellSize);
                }
                tr.getContent().add(tc);
                c += span;
            }
            tbl.getContent().add(tr);
        }
        return tbl;
    }

    static Cell covering(Table table, int r, int c) {
        for (Cell cell : table.cells()) {
            if (cell.r0() <= r && r <= cell.r1() && cell.c0() <= c && c <= cell.c1()) return cell;
        }
        return null;
    }

    static CTBorder border() {
        CTBorder b = W.createCTBorder();
        b.setVal(STBorder.SINGLE);
        b.setSz(BigInteger.valueOf(4));
        b.setColor("000000");
        return b;
    }

    // ------------------------------------------------------------------ pictures

    static Inline inline(WordprocessingMLPackage pkg, Picture pic, int id) throws Exception {
        BinaryPartAbstractImage part = BinaryPartAbstractImage.createImagePart(pkg, pic.png());
        return part.createImageInline("seal-" + id, "seal", id, id + 1,
                Math.round(pic.widthPt() * EMU_PER_PT), Math.round(pic.heightPt() * EMU_PER_PT), false);
    }

    static Anchor anchor(WordprocessingMLPackage pkg, Picture pic, int id) throws Exception {
        Inline inline = inline(pkg, pic, id);
        String graphic = XmlUtils.marshaltoString(inline.getGraphic(), true, false,
                Context.jc, "http://schemas.openxmlformats.org/drawingml/2006/main", "graphic",
                org.docx4j.dml.Graphic.class);
        long cx = inline.getExtent().getCx(), cy = inline.getExtent().getCy();
        String xml = "<wp:anchor xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\""
                + " xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\""
                + " distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\" simplePos=\"0\" relativeHeight=\"" + (251658240 + id) + "\""
                + " behindDoc=\"1\" locked=\"0\" layoutInCell=\"1\" allowOverlap=\"1\">"
                + "<wp:simplePos x=\"0\" y=\"0\"/>"
                + "<wp:positionH relativeFrom=\"page\"><wp:posOffset>" + Math.round(pic.xPt() * EMU_PER_PT) + "</wp:posOffset></wp:positionH>"
                + "<wp:positionV relativeFrom=\"paragraph\"><wp:posOffset>" + Math.round(pic.yPt() * EMU_PER_PT) + "</wp:posOffset></wp:positionV>"
                + "<wp:extent cx=\"" + cx + "\" cy=\"" + cy + "\"/>"
                + "<wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>"
                + "<wp:wrapNone/>"
                + "<wp:docPr id=\"" + id + "\" name=\"seal-" + id + "\"/>"
                + "<wp:cNvGraphicFramePr/>"
                + graphic
                + "</wp:anchor>";
        return (Anchor) XmlUtils.unmarshalString(xml, Context.jc, Anchor.class);
    }

    static R drawingRun(Object drawingChild) {
        R r = W.createR();
        Drawing drawing = W.createDrawing();
        drawing.getAnchorOrInline().add(drawingChild);
        r.getContent().add(drawing);
        return r;
    }
}
