// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.context.ProjectContextHolder;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** compare_docx_summary / compare_docx_redline（tool-system-v2 V7 D1）。 */
class DocCompareToolsTest {

    private ProjectFileRepository repo;
    private ProjectFileService files;
    private EditorBridgeService bridge;
    private DocCompareTools tools;

    @BeforeEach
    void setUp() throws Exception {
        ProjectContextHolder.setProjectId("7");
        repo = Mockito.mock(ProjectFileRepository.class);
        files = Mockito.mock(ProjectFileService.class);
        bridge = Mockito.mock(EditorBridgeService.class);
        tools = new DocCompareTools(repo, files, bridge);
        register(1L, "合同v1.docx", 7L, docx(
                "第一条 标的", "甲方转让 30% 股权。", "第二条 价款", "价款 1000 万元，10 日内支付。",
                "第三条 违约责任", "违约金为转让价款的 10%。"));
        register(2L, "合同v2.docx", 7L, docx(
                "第一条 标的", "甲方转让 30% 股权。", "第二条 价款", "价款 1000 万元，15 日内支付。",
                "第三条 违约责任", "违约金为转让价款的 20%。", "第四条 保密", "双方应严格保密。"));
        register(3L, "说明.pdf", 7L, new byte[]{1});
        register(4L, "别的项目.docx", 99L, docx("x"));
    }

    @AfterEach
    void tearDown() {
        ProjectContextHolder.clear();
    }

    private void register(long id, String name, long projectId, byte[] bytes) throws Exception {
        ProjectFile pf = new ProjectFile();
        pf.setId(id);
        pf.setName(name);
        pf.setProjectId(projectId);
        pf.setIsFolder(false);
        pf.setFileType(name.substring(name.lastIndexOf('.') + 1));
        when(repo.findById(id)).thenReturn(Optional.of(pf));
        when(files.getFileBytes(id)).thenReturn(bytes);
    }

    private static byte[] docx(String... paragraphs) throws Exception {
        try (XWPFDocument d = new XWPFDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            for (String p : paragraphs) {
                d.createParagraph().createRun().setText(p);
            }
            d.write(out);
            return out.toByteArray();
        }
    }

    @Test
    @DisplayName("摘要：列出改了的条款（修改与新增），不碰编辑器")
    void summaryListsChangedClauses() {
        String out = tools.compare_docx_summary(1L, 2L, null);
        assertFalse(out.startsWith("Error"), out);
        assertTrue(out.contains("第二条") && out.contains("15 日"), out);
        assertTrue(out.contains("第三条") && out.contains("20%"), out);
        assertTrue(out.contains("第四条") && out.contains("保密"), out);
        assertFalse(out.contains("第一条 标的\n"), "未改动的条款不应出现在差异里");
        assertFalse(out.contains("propose_revision"), "includeEdits 缺省时不附 edits");
        Mockito.verifyNoInteractions(bridge);
    }

    @Test
    @DisplayName("摘要：includeEdits 附 propose_revision 同形的 find/replace，find 取基准稿原文")
    void summaryWithEdits() {
        String out = tools.compare_docx_summary(1L, 2L, true);
        assertTrue(out.contains("\"find\" : \"价款 1000 万元，10 日内支付。\""), out);
        assertTrue(out.contains("\"replace\" : \"违约金为转让价款的 20%。\""), out);
    }

    @Test
    @DisplayName("摘要：同一份文件比自己，没有差异")
    void identicalFiles() {
        String out = tools.compare_docx_summary(1L, 1L, null);
        assertTrue(out.contains("未发现文字差异"), out);
    }

    @Test
    @DisplayName("摘要：非 docx、跨项目无读权限的文件被拒")
    void rejectsNonDocxAndForeignProject() {
        assertTrue(tools.compare_docx_summary(1L, 3L, null).startsWith("Error"));
        assertTrue(tools.compare_docx_summary(1L, 4L, null).contains("does not belong"));
        assertTrue(tools.compare_docx_summary(null, 2L, null).startsWith("Error"));
    }

    @Test
    @DisplayName("修订比对稿：把两个 fileId 交给编辑器宿主动作，成功时返回新文件（db_id）")
    void redlineDelegatesToHost() {
        ProjectFile created = new ProjectFile();
        created.setId(50L);
        created.setName("合同v2（比对稿）.docx");
        created.setProjectId(7L);
        when(repo.findById(50L)).thenReturn(Optional.of(created));
        when(bridge.executeEditorCommand(eq("compare_docx_files"), any()))
                .thenReturn("{\"fileId\":50,\"fileName\":\"合同v2（比对稿）.docx\"}");
        String out = tools.compare_docx_redline(1L, 2L);
        assertEquals(Long.valueOf(50L), GeneratedFileLocation.createdId(out), out);
        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<Map<String, Object>> cap = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(bridge).executeEditorCommand(eq("compare_docx_files"), cap.capture());
        assertEquals(1L, cap.getValue().get("baseFileId"));
        assertEquals(2L, cap.getValue().get("revisedFileId"));
    }

    @Test
    @DisplayName("修订比对稿：编辑器报错原样转成 Error；跨项目文件不发命令")
    void redlineErrorsAndGuards() {
        when(bridge.executeEditorCommand(eq("compare_docx_files"), any()))
                .thenReturn("{\"error\":\"比对失败\"}");
        assertEquals("Error: 比对失败", tools.compare_docx_redline(1L, 2L));
        Mockito.clearInvocations(bridge);
        assertTrue(tools.compare_docx_redline(1L, 4L).startsWith("Error"));
        verify(bridge, never()).executeEditorCommand(any(), any());
    }

    @Test
    @DisplayName("工具声明：摘要 READ 不挑宿主；比对稿 WRITE 且必须 LOWA")
    void toolMetaContract() throws Exception {
        ToolMeta summary = DocCompareTools.class.getMethod("compare_docx_summary", Long.class, Long.class, Boolean.class)
                .getAnnotation(ToolMeta.class);
        ToolMeta redline = DocCompareTools.class.getMethod("compare_docx_redline", Long.class, Long.class)
                .getAnnotation(ToolMeta.class);
        assertEquals(ToolMeta.Access.READ, summary.access());
        assertEquals(ToolMeta.Host.NONE, summary.requiresHost());
        assertEquals(ToolMeta.Access.WRITE, redline.access());
        assertEquals(ToolMeta.Host.LOWA, redline.requiresHost());
        assertEquals("ADDED", redline.fileEffect());
    }

    @Test
    @DisplayName("关键词：比对 / 回稿 / 动了哪些地方等说法起跑时预放回 compare 类目；中性问句不放回")
    void compareKeywordsPutCategoryBack() {
        com.checkba.service.ai.ToolDisclosurePolicy policy = new com.checkba.service.ai.ToolDisclosurePolicy(true, true);
        for (String prompt : List.of("把合同v1和v2比对一下，看改了哪些条款", "对方发回了修订稿（v2），帮我看看他们动了哪些地方",
                "对比这两份合同有什么不同", "Compare the two versions and tell me which clauses changed.")) {
            assertTrue(policy.categoriesHintedBy(prompt).contains("compare"), prompt);
        }
        assertFalse(policy.categoriesHintedBy("这份合同有什么风险？").contains("compare"));
        assertEquals("compare", policy.categoryOf("compare_docx_summary"));
        assertEquals("compare", policy.categoryOf("compare_docx_redline"));
    }
}
