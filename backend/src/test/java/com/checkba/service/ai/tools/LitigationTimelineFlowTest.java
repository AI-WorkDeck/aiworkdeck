// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import cn.hutool.json.JSONUtil;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.LitigationPngService;
import com.checkba.service.ai.LitigationVisualService;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.file.ProjectFileTextExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 时间轴大师工具面的确定性守卫。
 *
 * <p>与 {@link LitigationVisualFlowTest} 同一条经验：skill 注入按轮生效，用户的勾选
 * 答复里没有触发词，所以「下一步做什么」必须写进<b>工具返回文本</b>。这里钉住那些
 * 指引句，并用真实管线（真 python + vendor 的 mqc-timeline-master）把
 * start → 五问 → 模型产出 → render 的整条 Java 链走一遍。
 *
 * <p>三条上游契约坑的对策也在这里钉住（见契约盘点，dev-board#164）：
 * style 空参在上游默认成歸藏风（文档承诺奇川风）——Java 层必须显式传 "1"；
 * mark 空参在上游 exit 1——Java 层空参转 "0"；
 * 溯源索引的 node 路线桌面端不可用——由服务端按 trace.json 出 POI 三线表。
 */
class LitigationTimelineFlowTest {

    private static LitigationVisualService svc;

    @BeforeAll
    static void setUp() {
        svc = new LitigationVisualService();
        ReflectionTestUtils.setField(svc, "configuredDir", "");
        ReflectionTestUtils.setField(svc, "configuredPython", "");
        ReflectionTestUtils.setField(svc, "configuredGraphvizDir", "");
    }

    @AfterEach
    void clearContext() {
        ProjectContextHolder.clear();
    }

    private static void requireRuntime() {
        assumeTrue(svc.unavailableReason() == null, "跳过：" + svc.unavailableReason());
    }

    private static LitigationTimelineTools bareTools() {
        return new LitigationTimelineTools(svc, null, null, null, null, null, null);
    }

    @Test
    @DisplayName("没有会话时 step/render 给出明确指路，不抛异常")
    void stepWithoutSessionExplains() {
        ProjectContextHolder.setConversationId("tl-none-" + System.nanoTime());
        String out = bareTools().litigation_timeline_step("pick", "全部", null, null);
        assertTrue(out.contains("litigation_timeline_start"), out);
        String out2 = bareTools().litigation_timeline_render(7L, "图", null, null);
        assertTrue(out2.contains("litigation_timeline_start"), out2);
    }

    @Test
    @DisplayName("未知阶段被挡下并列出可用阶段")
    void unknownStageRejected() {
        String out = bareTools().litigation_timeline_step("肯定没有", null, null, null);
        assertTrue(out.contains("未知阶段"), out);
        assertTrue(out.contains("pick"), out);
    }

    @Test
    @DisplayName("start 指引钉住：编号对账、modelFilesJson、<question> 协议、禁 write_file")
    void startGuidancePinned() {
        String g = LitigationTimelineTools.START_GUIDANCE;
        assertTrue(g.contains("不要发给用户"));
        assertTrue(g.contains("modelFilesJson"));
        assertTrue(g.contains("<question>"));
        assertTrue(g.contains("write_file"));
        assertTrue(g.contains("子序列"));
        assertTrue(LitigationTimelineTools.STEP_GUIDANCE.contains("<question>"));
    }

    @Test
    @DisplayName("时间轴旧包在读材料前报告为工具失败，并保留语义地图回退")
    void unavailableTimelineStopsBeforeReadingMaterials() {
        LitigationVisualService old = mock(LitigationVisualService.class);
        when(old.timelineUnavailableReason()).thenReturn(
                "请更新资源包；可用 litigation_checkpoint + litigation_render 回退。");
        ProjectFileTextExtractor docText = mock(ProjectFileTextExtractor.class);
        LitigationTimelineTools tools = new LitigationTimelineTools(old, null, docText, null, null, null, null);
        String result = tools.litigation_timeline_start(7L, "101");
        assertTrue(result.startsWith("Error:"), "必须被工具失败判据识别，不能当作成功继续重试");
        assertTrue(result.contains("litigation_checkpoint"));
        assertTrue(result.contains("litigation_render"));
        Mockito.verifyNoInteractions(docText);
    }

    @Test
    @DisplayName("start 走统一抽取器（含 OCR），读不出字时带原因报失败，不再把模型指去 pdf_to_word（dev-board#1065 T-24）")
    void startReadsMaterialsThroughTheUnifiedExtractor() throws Exception {
        ProjectContextHolder.setConversationId("tl-extract-" + System.nanoTime());
        ProjectContextHolder.setProjectId("7");

        ProjectFile scan = new ProjectFile();
        scan.setId(201L);
        scan.setProjectId(7L);
        scan.setName("判决书扫描件.pdf");
        scan.setIsFolder(false);
        scan.setFileType("pdf");
        ProjectFile photo = new ProjectFile();
        photo.setId(202L);
        photo.setProjectId(7L);
        photo.setName("聊天截图.jpg");
        photo.setIsFolder(false);
        photo.setFileType("image");

        ProjectFileRepository repo = mock(ProjectFileRepository.class);
        when(repo.findById(201L)).thenReturn(Optional.of(scan));
        when(repo.findById(202L)).thenReturn(Optional.of(photo));
        ProjectFileTextExtractor extractor = mock(ProjectFileTextExtractor.class);
        when(extractor.extractText(scan)).thenReturn("");
        when(extractor.extractText(photo)).thenThrow(
                new ProjectFileTextExtractor.OcrFailedException("Credits 不足", null));
        LitigationVisualService visual = mock(LitigationVisualService.class);

        LitigationTimelineTools tools = new LitigationTimelineTools(
                visual, null, extractor, repo, null, null, null);
        String result = tools.litigation_timeline_start(7L, "201,202");

        Mockito.verify(extractor).extractText(scan);
        Mockito.verify(extractor).extractText(photo);
        assertTrue(result.startsWith("错误"), "一份都读不出来是失败，必须被失败判据认出：" + result);
        assertTrue(result.contains("判决书扫描件.pdf") && result.contains("自动做过文字识别"), result);
        assertTrue(result.contains("聊天截图.jpg") && result.contains("Credits 不足"),
                "文字识别失败的真实原因要原样带给模型：" + result);
        assertFalse(result.contains("pdf_to_word"),
                "pdf_to_word 是桌面端专属工具，扫描件本来就会自动识别，别再把模型指过去：" + result);
        Mockito.verify(visual, Mockito.never()).timeline(any(), any(), any(), any());
    }

    @Test
    @DisplayName("整条链路：start → 五问 → 模型产出 → render 交付（真管线）")
    void fullPipelineFlow() throws Exception {
        requireRuntime();
        String conv = "tl-flow-" + System.nanoTime();
        ProjectContextHolder.setConversationId(conv);
        ProjectContextHolder.setProjectId("7");

        // 材料：上游自带的短 fixture（聊天记录式，五个带日期的事实）
        Path fixture = svc.runtime().litvizDir()
                .resolve("skills/mqc-timeline-master/tests/fixtures/m7-short.txt");
        assumeTrue(Files.isRegularFile(fixture), "上游 fixture 不在");
        String materialText = Files.readString(fixture, StandardCharsets.UTF_8);

        ProjectFile pf = new ProjectFile();
        pf.setId(101L);
        pf.setProjectId(7L);
        pf.setName("催告经过.txt");
        pf.setIsFolder(false);
        pf.setFileType("txt");

        ProjectFileRepository repo = mock(ProjectFileRepository.class);
        when(repo.findById(101L)).thenReturn(Optional.of(pf));
        ProjectFileTextExtractor docText = mock(ProjectFileTextExtractor.class);
        when(docText.extractText(pf)).thenReturn(materialText);

        LitigationPngService png = mock(LitigationPngService.class);
        when(png.ensurePngFor(any())).thenReturn(List.of());
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        LitigationVisualTools visual = mock(LitigationVisualTools.class);
        ProjectFile folder = new ProjectFile();
        folder.setId(900L);
        folder.setName("催告经过时间轴");
        folder.setIsFolder(true);
        when(visual.createFolderTolerant(anyLong(), any(), anyString())).thenReturn(folder);
        when(visual.outputParentId(7L, null)).thenReturn(500L);
        when(visual.registerArtifact(anyLong(), anyLong(), any(Path.class), anyString()))
                .thenAnswer(inv -> {
                    ProjectFile r = new ProjectFile();
                    r.setId(1000L + inv.getArgument(2, Path.class).getFileName().toString().hashCode() % 1000);
                    r.setName(inv.getArgument(2, Path.class).getFileName().toString());
                    return r;
                });

        LitigationTimelineTools tools = new LitigationTimelineTools(
                svc, png, docText, repo, null, bridge, visual);

        // ---- start：读材料，拿逐句清单 ----
        String started = tools.litigation_timeline_start(7L, "101");
        assertTrue(started.contains("句子清单"), started.substring(0, Math.min(400, started.length())));
        assertTrue(started.contains("不要发给用户"), "执行指引必须挂在返回文本里");

        Map<Integer, String> sentences = parseSentences(started);
        assertTrue(sentences.size() >= 5, "句子清单要能解析：" + sentences.size());

        // ---- 三轮勾选。style 故意传空：必须落到奇川风（上游裸默认是歸藏风的坑） ----
        assertTrue(tools.litigation_timeline_step("pick", "全部", null, null).contains("──给你（AI）──"));
        tools.litigation_timeline_step("span", "全部", null, null);
        tools.litigation_timeline_step("style", "", null, null);

        // ---- 模型产出：verdicts + parts 随 offer 提交 ----
        Pattern dateRe = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
        List<Map<String, Object>> verdicts = new ArrayList<>();
        List<Integer> allSids = new ArrayList<>();
        for (Map.Entry<Integer, String> e : sentences.entrySet()) {
            boolean isEvent = dateRe.matcher(e.getValue()).find();
            verdicts.add(Map.of("i", e.getKey(), "is_event", isEvent,
                    "why", isEvent ? "带日期的已发生事实" : "标题"));
            allSids.add(e.getKey());
        }
        List<String> ordered = new ArrayList<>(sentences.values());
        Map<String, Object> part = new LinkedHashMap<>();
        part.put("id", 1);
        part.put("name", "催告经过");
        part.put("sids", allSids);
        part.put("first", ordered.get(0));
        part.put("last", ordered.get(ordered.size() - 1));
        String offerFiles = JSONUtil.toJsonStr(Map.of(
                "verdicts.json", verdicts, "parts.json", List.of(part)));
        String offered = tools.litigation_timeline_step("offer", null, offerFiles, null);
        assertTrue(offered.contains("催告经过"), offered);

        // 用户点「全部」：上游 budget 只认 all，int("全部") 抛错会把用户反复带回第四轮（dev-board#1713）
        String budgeted = tools.litigation_timeline_step("budget", "全部", null, null);
        assertFalse(budgeted.startsWith("阶段 budget 未通过"), budgeted);
        assertTrue(budgeted.contains("勾选了部分"), budgeted);

        // ---- skeleton 随 capacity 提交 ----
        List<Map<String, Object>> skeleton = new ArrayList<>();
        for (Map.Entry<Integer, String> e : sentences.entrySet()) {
            Matcher m = dateRe.matcher(e.getValue());
            if (!m.find()) continue;
            skeleton.add(Map.of("id", String.valueOf(skeleton.size() + 1),
                    "src_sids", List.of(e.getKey()), "certainty", "exact",
                    "kind", "occur", "raw", m.group(), "date", m.group()));
        }
        String capacity = tools.litigation_timeline_step("capacity", null,
                JSONUtil.toJsonStr(Map.of("skeleton.json", skeleton)), null);
        // 只有奇川风才有第五轮标红候选——它出现即证明空 style 落到了奇川风，
        // 而不是上游裸默认的歸藏风。
        assertTrue(capacity.contains("深红") || capacity.contains("标红"),
                "空 style 必须默认奇川风（capacity 应给标红候选）：" + capacity);
        assertTrue(capacity.contains("items.json"), capacity);

        assertFalse(tools.litigation_timeline_step("title", "催告经过时间轴", null, null)
                .startsWith("阶段 title 未通过"));

        // ---- mark：空参不许把上游的 exit 1 漏给模型 ----
        String marked = tools.litigation_timeline_step("mark", "", null, "none");
        assertFalse(marked.contains("未通过"), marked);

        // ---- items + render ----
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> ent : skeleton) {
            int sid = (Integer) ((List<?>) ent.get("src_sids")).get(0);
            String s = sentences.get(sid);
            String head = s.replaceFirst("^\\S+\\s+\\S+\\s+", "").trim();
            Map<String, Object> it = new LinkedHashMap<>(ent);
            it.put("head", head);
            items.add(it);
        }
        String note = tools.litigation_timeline_render(7L, "催告经过时间轴", null,
                JSONUtil.toJsonStr(Map.of("items.json", items)));
        assertTrue(note.contains("[本图已交付]"), note);
        assertTrue(note.contains(".svg") || note.contains("svg"), note);
        assertTrue(note.contains("溯源索引"), "溯源索引（POI 三线表）应随交付生成：" + note);
        // 产出文件夹统一收进根目录下的「诉讼可视化」父文件夹（dev-board#1713）
        Mockito.verify(visual).createFolderTolerant(Mockito.eq(7L), Mockito.eq(500L), anyString());

        // ---- 幂等：同一份 items 再渲染一次要被短路 ----
        String again = tools.litigation_timeline_render(7L, "催告经过时间轴", null, null);
        assertTrue(again.contains("[本次调用没有重新出图]"), again);
    }

    @Test
    @DisplayName("溯源索引：按 trace.json 出 POI 三线表，五列、行数对得上")
    void traceDocxBuilder() throws Exception {
        Path dir = Files.createTempDirectory("tl-trace-");
        Path trace = dir.resolve("图-trace.json");
        Files.writeString(trace, JSONUtil.toJsonStr(Map.of(
                "title", "某案时间轴 · 溯源索引",
                "note", "逐项对回材料",
                "rows", List.of(
                        Map.of("no", "1", "head", "双方签订合同", "file", "判决书.txt",
                                "locator", "句[2]", "quote", "2023年1月5日双方签订合同"),
                        Map.of("no", "2", "head", "发出催告", "file", "判决书.txt",
                                "locator", "句[5]", "quote", "2023年3月发出催告")),
                "foot", "读图事项请回原件复核")), StandardCharsets.UTF_8);

        Path docx = LitigationTimelineTools.buildTraceDocx(trace, "某案时间轴");
        assertNotNull(docx);
        assertTrue(Files.isRegularFile(docx));
        try (InputStream is = Files.newInputStream(docx); XWPFDocument doc = new XWPFDocument(is)) {
            assertEquals(1, doc.getTables().size());
            assertEquals(3, doc.getTables().get(0).getRows().size(), "表头 + 两行数据");
            assertEquals(5, doc.getTables().get(0).getRow(0).getTableCells().size());
        }
    }

    @Test
    @DisplayName("勾选答复规范化：全部/全选/all 统一成 all，风格名映射成真实编号（dev-board#1713）")
    void answersNormalizedToUpstreamShapes() {
        for (String all : List.of("全部", "全选", "all", "ALL", "「全部」", "[全部]", "全部部分", "所有", "全部材料", "全都要")) {
            assertEquals("all", LitigationTimelineTools.normalizeAnswer("budget", all), all);
            assertEquals("all", LitigationTimelineTools.normalizeAnswer("pick", all), all);
            assertEquals("all", LitigationTimelineTools.normalizeAnswer("span", all), all);
        }
        assertEquals("1,2", LitigationTimelineTools.normalizeAnswer("budget", "1、2"));
        assertEquals("1,3", LitigationTimelineTools.normalizeAnswer("pick", "1，3"));
        // 真实编号以 pick.py STYLES 为准：1 奇川风 / 2 歸藏风 / 3 白描
        assertEquals("1", LitigationTimelineTools.normalizeAnswer("style", "奇川风"));
        assertEquals("1", LitigationTimelineTools.normalizeAnswer("style", ""));
        assertEquals("2", LitigationTimelineTools.normalizeAnswer("style", "歸藏风"));
        assertEquals("2", LitigationTimelineTools.normalizeAnswer("style", "归藏风"));
        assertEquals("3", LitigationTimelineTools.normalizeAnswer("style", "白描"));
        assertEquals("3", LitigationTimelineTools.normalizeAnswer("style", "1 法官白描"),
                "旧提示的错号标签：用户点的是名字，数字不可信");
        assertEquals("1", LitigationTimelineTools.normalizeAnswer("style", "2 当事人奇川风"));
        assertEquals("2", LitigationTimelineTools.normalizeAnswer("style", "2"));
        assertEquals("4", LitigationTimelineTools.normalizeAnswer("style", "你定"));
        assertEquals(null, LitigationTimelineTools.normalizeAnswer("style", "彩色的那种"));
        assertEquals("0", LitigationTimelineTools.normalizeAnswer("mark", ""));
    }

    @Test
    @DisplayName("中文数字日期归一成阿拉伯数字，否则上游 _DATE 认不出、合同被判成 0 句带日期（dev-board#1713）")
    void chineseNumeralDatesNormalized() {
        assertEquals("本合同于2026年2月20日签订。",
                LitigationTimelineTools.normalizeChineseDates("本合同于二〇二六年二月二十日签订。"));
        assertEquals("2025年12月31日 与 2024年10月1号 与 2023年11月",
                LitigationTimelineTools.normalizeChineseDates("二零二五年十二月三十一日 与 二〇二四年十月一号 与 二〇二三年十一月"));
        assertEquals("2026年3月15日", LitigationTimelineTools.normalizeChineseDates("2026年三月十五日"));
        String untouched = "2024-03-05 我方催告；2024年3月8日对方回复；质保期为十二个月；三年二月";
        assertEquals(untouched, LitigationTimelineTools.normalizeChineseDates(untouched));
    }

    @Test
    @DisplayName("真管线：风格名直接交给 stage_style 不再 ValueError；中文数字日期进管线后可认（dev-board#1713）")
    void styleNameAndChineseDatesThroughRealPipeline() throws Exception {
        requireRuntime();
        ProjectContextHolder.setConversationId("tl-style-" + System.nanoTime());
        ProjectContextHolder.setProjectId("7");
        ProjectFile pf = new ProjectFile();
        pf.setId(301L);
        pf.setProjectId(7L);
        pf.setName("合同.txt");
        pf.setIsFolder(false);
        pf.setFileType("txt");
        ProjectFileRepository repo = mock(ProjectFileRepository.class);
        when(repo.findById(301L)).thenReturn(Optional.of(pf));
        ProjectFileTextExtractor docText = mock(ProjectFileTextExtractor.class);
        when(docText.extractText(pf)).thenReturn(
                "甲乙双方于二〇二六年二月二十日签订本合同。\n乙方应于二〇二六年三月十五日前交货。\n甲方于二〇二六年四月一日付款。\n");
        LitigationTimelineTools tools = new LitigationTimelineTools(svc, null, docText, repo, null, null, null);

        String started = tools.litigation_timeline_start(7L, "301");
        assertTrue(started.contains("2026年2月20日"), started);
        tools.litigation_timeline_step("pick", "全部", null, null);
        tools.litigation_timeline_step("span", "全部", null, null);
        String styled = tools.litigation_timeline_step("style", "歸藏风", null, null);
        assertFalse(styled.startsWith("阶段 style 未通过"), styled);
        assertTrue(styled.contains("已选：歸藏风"), styled);
    }

    /** 从 start 返回文本里解析「i: 句子」清单（清单结束于空行或指引分隔线）。 */
    private static Map<Integer, String> parseSentences(String started) {
        Map<Integer, String> out = new LinkedHashMap<>();
        boolean in = false;
        for (String line : started.split("\n")) {
            if (line.startsWith("── 句子清单")) {
                in = true;
                continue;
            }
            if (!in) continue;
            Matcher m = Pattern.compile("^(\\d+): (.*)$").matcher(line);
            if (m.matches()) {
                out.put(Integer.parseInt(m.group(1)), m.group(2));
            } else if (line.contains("──────────")) {
                break;
            }
        }
        return out;
    }
}
