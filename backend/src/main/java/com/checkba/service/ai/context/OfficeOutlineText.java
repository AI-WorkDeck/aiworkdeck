// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.context;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.util.CellReference;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.apache.poi.xslf.usermodel.XSLFGraphicFrame;
import org.apache.poi.xslf.usermodel.XSLFNotes;
import org.apache.poi.xslf.usermodel.XSLFPictureShape;
import org.apache.poi.xslf.usermodel.XSLFShape;
import org.apache.poi.xslf.usermodel.XSLFSlide;
import org.apache.poi.xslf.usermodel.XSLFTable;
import org.apache.poi.xslf.usermodel.XSLFTableRow;
import org.apache.poi.xslf.usermodel.XSLFTextShape;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 活跃 xlsx / pptx 的「带坐标」正文（office-tier1，2026-11-12）。
 *
 * <p>原先 &lt;active_document&gt; 里是 Tika 抽出的纯文本：表格没有行号列标、幻灯片没有页码，
 * 模型要改「第 3 行的案号」「第 2 页标题」只能自己数，或先多花一轮 sheet_get_overview / slide_get_overview。
 * 这里按 sheet_* / slide_* 工具的同一套坐标（行号 1 起、列标 A 起、页码 1 起）列出内容。
 * 内容取自最近一次保存的文件，只是起跑时的快照；工具仍以编辑器实时读写为准。
 */
public final class OfficeOutlineText {

    static final int MAX_ROWS_PER_SHEET = 200;
    static final int MAX_COLS = 30;
    static final int MAX_CELL_CHARS = 120;
    static final int MAX_SHEETS = 20;

    private OfficeOutlineText() {
    }

    public static boolean supports(String fileName) {
        String n = fileName == null ? "" : fileName.toLowerCase(java.util.Locale.ROOT);
        return n.endsWith(".xlsx") || n.endsWith(".pptx");
    }

    public static String of(String fileName, byte[] bytes) throws IOException {
        String n = fileName.toLowerCase(java.util.Locale.ROOT);
        return n.endsWith(".xlsx") ? xlsx(bytes) : pptx(bytes);
    }

    static String xlsx(byte[] bytes) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("[电子表格内容：每行以行号开头，单元格写成「列标=值」，与 sheet_* 工具的地址一致；公式写成「=公式 → 结果」]\n");
        DataFormatter formatter = new DataFormatter(java.util.Locale.ROOT);
        try (XSSFWorkbook wb = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
            int sheets = wb.getNumberOfSheets();
            for (int si = 0; si < Math.min(sheets, MAX_SHEETS); si++) {
                Sheet sheet = wb.getSheetAt(si);
                int lastRow = -1, lastCol = -1;
                for (Row row : sheet) {
                    for (Cell cell : row) {
                        if (!valueOf(cell, formatter).isEmpty()) {
                            lastRow = Math.max(lastRow, row.getRowNum());
                            lastCol = Math.max(lastCol, cell.getColumnIndex());
                        }
                    }
                }
                sb.append("\n## 工作表 ").append(si + 1).append("「").append(sheet.getSheetName()).append("」");
                if (lastRow < 0) {
                    sb.append("（空）\n");
                    continue;
                }
                sb.append(" 已用区域 A1:").append(CellReference.convertNumToColString(lastCol)).append(lastRow + 1)
                        .append("（").append(lastRow + 1).append(" 行 × ").append(lastCol + 1).append(" 列）");
                if (sheet.getPaneInformation() != null && sheet.getPaneInformation().isFreezePane()) {
                    sb.append("，已冻结窗格");
                }
                sb.append('\n');
                int shown = 0;
                for (int r = 0; r <= lastRow && shown < MAX_ROWS_PER_SHEET; r++) {
                    Row row = sheet.getRow(r);
                    if (row == null) continue;
                    List<String> parts = new ArrayList<>();
                    for (int c = 0; c <= Math.min(lastCol, MAX_COLS - 1); c++) {
                        String v = valueOf(row.getCell(c), formatter);
                        if (!v.isEmpty()) parts.add(CellReference.convertNumToColString(c) + "=" + v);
                    }
                    if (parts.isEmpty()) continue;
                    sb.append(r + 1).append(": ").append(String.join(" | ", parts)).append('\n');
                    shown++;
                }
                int remaining = 0;
                for (int r = 0; r <= lastRow; r++) if (sheet.getRow(r) != null) remaining++;
                remaining -= shown;
                if (remaining > 0 || lastCol >= MAX_COLS) {
                    sb.append("（此处只列出前 ").append(shown).append(" 个非空行、前 ").append(MAX_COLS)
                            .append(" 列；其余用 sheet_read_range 读取）\n");
                }
            }
            if (sheets > MAX_SHEETS) {
                sb.append("\n（共 ").append(sheets).append(" 个工作表，此处只列出前 ").append(MAX_SHEETS).append(" 个）\n");
            }
        }
        return sb.toString();
    }

    private static String valueOf(Cell cell, DataFormatter formatter) {
        if (cell == null || cell.getCellType() == CellType.BLANK) return "";
        String v;
        if (cell.getCellType() == CellType.FORMULA) {
            String cached;
            try {
                cached = switch (cell.getCachedFormulaResultType()) {
                    case NUMERIC -> formatter.formatRawCellContents(cell.getNumericCellValue(),
                            cell.getCellStyle().getDataFormat(), cell.getCellStyle().getDataFormatString());
                    case STRING -> cell.getStringCellValue();
                    case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
                    default -> "";
                };
            } catch (RuntimeException e) {
                cached = "";
            }
            v = "=" + cell.getCellFormula() + (cached.isEmpty() ? "" : " → " + cached);
        } else {
            v = formatter.formatCellValue(cell);
        }
        v = v == null ? "" : v.replace('\n', ' ').replace('|', '｜').strip();
        return v.length() > MAX_CELL_CHARS ? v.substring(0, MAX_CELL_CHARS) + "…" : v;
    }

    static String pptx(byte[] bytes) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("[演示文稿内容：按页码（1 起，与 slide_* 工具一致）列出每页的标题、正文要点、表格与备注]\n");
        try (XMLSlideShow show = new XMLSlideShow(new ByteArrayInputStream(bytes))) {
            List<XSLFSlide> slides = show.getSlides();
            sb.append("共 ").append(slides.size()).append(" 页\n");
            for (int i = 0; i < slides.size(); i++) {
                XSLFSlide slide = slides.get(i);
                String title = slide.getTitle();
                sb.append("\n## 第 ").append(i + 1).append(" 页");
                if (title != null && !title.isBlank()) sb.append("：").append(oneLine(title));
                sb.append('\n');
                for (XSLFShape shape : slide.getShapes()) {
                    if (shape instanceof XSLFTextShape text) {
                        String t = text.getText();
                        if (t == null || t.isBlank()) continue;
                        if (title != null && t.strip().equals(title.strip())) continue;
                        for (String line : t.split("\\R")) {
                            if (!line.isBlank()) sb.append("- ").append(line.strip()).append('\n');
                        }
                    } else if (shape instanceof XSLFTable table) {
                        sb.append("[表格 ").append(table.getNumberOfRows()).append(" 行 × ")
                                .append(table.getNumberOfColumns()).append(" 列]\n");
                        for (XSLFTableRow row : table.getRows()) {
                            List<String> cells = new ArrayList<>();
                            row.getCells().forEach(c -> cells.add(oneLine(c.getText())));
                            sb.append("  | ").append(String.join(" | ", cells)).append(" |\n");
                        }
                    } else if (shape instanceof XSLFPictureShape) {
                        sb.append("[图片]\n");
                    } else if (shape instanceof XSLFGraphicFrame frame && frame.hasChart()) {
                        sb.append("[图表]\n");
                    }
                }
                XSLFNotes notes = slide.getNotes();
                if (notes != null) {
                    StringBuilder nt = new StringBuilder();
                    for (XSLFShape s : notes.getShapes()) {
                        // 备注页的正文在 BODY 占位里；缩略图、页码占位不算
                        if (s instanceof XSLFTextShape ts && ts.getPlaceholder() == org.apache.poi.sl.usermodel.Placeholder.BODY
                                && ts.getText() != null) {
                            nt.append(oneLine(ts.getText()));
                        }
                    }
                    if (!nt.isEmpty()) sb.append("备注：").append(nt).append('\n');
                }
            }
        }
        return sb.toString();
    }

    private static String oneLine(String s) {
        return s == null ? "" : s.replaceAll("\\s*\\R\\s*", " / ").strip();
    }
}
