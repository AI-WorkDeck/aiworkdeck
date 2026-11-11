// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.checkba.service.ai.ClientCapabilityService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.tools.AgentToolComponent;
import com.checkba.service.ai.tools.ToolMeta;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolSpecification;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code @ToolMeta} 声明层的契约（dev-board#799，审计 A9 / A15）。
 *
 * <p>两件事，各有一条自维护的绊线：
 * <ol>
 *   <li><b>requiresHost</b>：哪些工具声明了 LOWA 宿主依赖，逐名钉住；
 *       并扫源码找出「往桌面前端发了文档级 UI 指令」的组件，与声明对拍——
 *       新增工具开始发 open_file / reload_file 而没人声明宿主时，这里会红。</li>
 *   <li><b>offerToModel</b>：永久停用/调试类工具不下发规格，但仍然登记
 *       （只裁 spec、不裁 resolve/execute，是本仓已经确立的口径）。</li>
 * </ol>
 */
class ToolDeclarationContractTest {

    /**
     * 工具收尾走 EditorBridgeService 的四个<b>文档级 UI 指令</b>时就要声明
     * {@code requiresHost = LOWA}。这四条都指名一份文档、要求桌面前端把它打开或重新加载。
     *
     * <p>{@code sendRefreshFilesAction}（刷文件树）与 {@code sendComponentRequiredAction}
     * （引导下载组件）刻意不在此列：它们是环境通知不是交付物，按它们判会把
     * {@code write_docx} / {@code create_folder} 这类纯后端建文件的工具一并锁进 LOWA，
     * Office 会话里连新建文件都做不了。
     */
    private static final List<String> DOCUMENT_UI_ACTIONS = List.of(
            "sendOpenFileAction",
            "sendReloadFileAction",
            "sendTextReloadFileAction",
            "sendPptConfigAction");

    /**
     * 声明了 {@code requiresHost = LOWA} 的全部工具，逐名钉住（审计 A9）。
     *
     * <p>判据是上面那四个 send。逐条来历：
     * <ul>
     *   <li>{@code litigation_render} /
     *       {@code litigation_timeline_render} / {@code pdf_to_word} —— sendOpenFileAction，
     *       交付物是「在桌面编辑器里打开给用户看」，返回文案也这么写；</li>
     *   <li>{@code pptx_generate} —— sendPptConfigAction，发完就返回「等待用户操作...」，
     *       而那个配置界面在任务窗格里根本不存在，模型会停在那里等一个永远不会来的确认；</li>
     *   <li>{@code pdf_highlight} / {@code pdf_annotate} / {@code pdf_redact} /
     *       {@code pdf_replace_text} —— PdfTools.finishModification 里的 sendReloadFileAction；</li>
     *   <li>{@code text_write_file} / {@code text_find_replace} ——
     *       TextFileEditTools.writeBack 里的 sendTextReloadFileAction。</li>
     *   <li><b>管线前置步骤跟随收尾工具</b>（dev-board#1065 T-10）：一个工具如果唯一的用途是给某个
     *       已声明 LOWA 的工具供料，它也声明 LOWA——否则模型在 Office / none 会话里陪用户走完几轮确认，
     *       走到最后一步才发现收尾工具不在清单里。{@code litigation_reference} / {@code litigation_checkpoint}
     *       供 litigation_render；{@code litigation_timeline_start} / {@code litigation_timeline_step} 供
     *       litigation_timeline_render；{@code pptx_generate_outline} / {@code pptx_refine_outline} /
     *       {@code pptx_check_service} 为 pptx_generate 做准备，{@code pptx_get_project_pages} /
     *       {@code pptx_export_editable} 要的 serviceProjectId 只能来自 pptx_generate。
     *       这一组不发上述四个 send，所以不在下面的调用点绊线里，只靠这份清单钉住。</li>
     *   <li>{@code doc_export_pdf}（T-25）—— PDF 字节是桌面编辑器里的引擎导出来的；doc_ 前缀链本来就只放给
     *       LOWA，声明是为了让这份清单一眼看得出它离不开桌面编辑器。</li>
     *   <li>{@code version_*}（dev-board#1498）—— 项目版本操作经宿主保存并重载打开的编辑器；
     *       只读入口跟随同一桌面项目版本面，不要求已有活动文档。</li>
     * </ul>
     *
     * <p><b>要增删先读这一段</b>：后四组（pdf_* 与 text_*）的实际写入是纯服务端的，
     * 声明 LOWA 等于在 Office/none 会话里一并收走那份真能力。这是按审计口径做的取舍
     * （那些会话里用户既没有文件树也没有预览，拿不到结果，而工具还在承诺「编辑器会重载」），
     * 不是顺手扩大的——改口径要连同 {@code ToolMeta.requiresHost} 的 javadoc 一起改。
     */
    private static final Set<String> EXPECTED_LOWA_ONLY = new TreeSet<>(Set.of(
            "pptx_generate",
            "litigation_render",
            "litigation_timeline_render",
            "pdf_to_word",
            "pdf_highlight",
            "pdf_annotate",
            "pdf_redact",
            "pdf_replace_text",
            "text_write_file",
            "text_find_replace",
            // 管线前置步骤（dev-board#1065 T-10）
            "litigation_reference",
            "litigation_checkpoint",
            "litigation_timeline_start",
            "litigation_timeline_step",
            "pptx_generate_outline",
            "pptx_refine_outline",
            "pptx_outline",
            "pptx_get_project_pages",
            "pptx_check_service",
            "pptx_export_editable",
            // 项目版本（dev-board#1498）：宿主门禁，不是活动文档门禁
            "version_status",
            "version_history",
            "version_changes",
            "version_commit",
            "version_pull",
            "version_restore",
            // 导出 PDF（dev-board#1065 T-25）
            "doc_export_pdf",
            // 两份 docx 修订比对稿（V7 D1）：原生比较在桌面隐藏引擎里跑
            "compare_docx_redline"));

    /**
     * 源码里出现上述四个 send 的工具组件，连<b>调用点条数</b>一起钉住。
     *
     * <p>为什么连条数一起钉：只钉文件名的话，往 {@code PptxTools} 里再加一个发 open_file 的
     * 新工具不会让集合变化，绊线形同虚设。钉条数之后，任何一处新增/删除都会红，
     * 改的人必须回来决定「这个新工具要不要声明 requiresHost」。
     *
     * <p>{@code DocumentEditTools} 在列但<b>不需要声明</b>：它里面发 open_file 的是
     * {@code doc_open_file}、{@code sheet_create_file} 与 {@code slide_create_file}，均带 doc_/sheet_/slide_ 前缀，
     * 前缀链本来就只放给 LOWA 会话，声明是多余的。
     */
    private static final Map<String, Integer> DOCUMENT_UI_ACTION_CALL_SITES = new TreeMap<>(Map.of(
            "DocumentEditTools.java", 3,      // doc_open_file、sheet_create_file、slide_create_file（前缀链已管）
            "LitigationTimelineTools.java", 1, // litigation_timeline_render
            "LitigationVisualTools.java", 1,   // litigation_render
            "PdfTools.java", 4,                // pdf_to_word 三个分支 + finishModification
            "PptxTools.java", 1,               // pptx_generate
            "TextFileEditTools.java", 1));     // writeBack（text_write_file 与 text_find_replace 共用）

    /**
     * 只登记、不下发规格的工具（offerToModel = false）。
     *
     * <p>tool-system-v2 V3 已删除全部 22 个长期隐藏工具（delete_file、read_document、
     * search_knowledge_base、pptx_open_file 等）；V4 起名单只剩合并留下的兼容壳
     * （{@link ToolShimContractTest#V4_SHIMS}，0.83 删），任何新增的 offerToModel = false
     * 都要回来改这份清单并说明理由。已删除的名字由 {@code permanentlyHiddenToolsAreStillRegistered}
     * 旁的 {@code deletedHiddenToolsAreGone} 钉住「不再注册」。
     */
    private static final Set<String> EXPECTED_NOT_OFFERED = new TreeSet<>(ToolShimContractTest.V4_SHIMS);

    static {
        EXPECTED_NOT_OFFERED.addAll(ToolShimContractTest.V5_SHIMS);
    }

    /** V3 删除的 22 个长期隐藏工具（docs/plans/tool-system-v2-inventory.csv 里 verdict=deprecate 的行）。 */
    private static final Set<String> DELETED_IN_V3 = new TreeSet<>(Set.of(
            "doc_get_selection", "doc_set_selection", "doc_replace_nth_match", "doc_delete_match",
            "doc_delete_text", "doc_search_related_docs", "doc_debug_revisions", "scan_files",
            "delete_file", "move_file", "read_document", "get_user_profile", "get_project_context",
            "search_knowledge_base", "deep_search", "get_conversation_summary", "pdf_list_files",
            "pptx_list_files", "pptx_search_files", "pptx_open_file", "pptx_apply_format", "pptx_edit_page"));

    private static RecordingToolRegistry registry() {
        RecordingToolRegistry registry =
                new RecordingToolRegistry(RealToolBeans.instantiateAll(), new PluginService());
        registry.init();
        return registry;
    }

    /** 直接从真实工具类的注解里读声明——不经注册表，避免"注册表没推就全绿"的假绿。 */
    private static Set<String> declaredHosts(ToolMeta.Host host) {
        Set<String> names = new TreeSet<>();
        for (AgentToolComponent bean : RealToolBeans.instantiateAll()) {
            for (Method m : bean.getClass().getDeclaredMethods()) {
                ToolMeta meta = m.getAnnotation(ToolMeta.class);
                if (m.isAnnotationPresent(Tool.class) && meta != null && meta.requiresHost() == host) {
                    names.add(m.getName());
                }
            }
        }
        return names;
    }

    @Test
    @DisplayName("声明了 requiresHost = LOWA 的工具逐名钉住（新增/删除都要来改这份清单）")
    void theLowaOnlyDeclarationSetIsPinned() {
        assertEquals(EXPECTED_LOWA_ONLY, declaredHosts(ToolMeta.Host.LOWA));
        // 今天没有任何工具声明 OFFICE：office_* 由前缀链管，ref_* 由 isToolVisible 里
        // 那一行单独管（dev-board#717），两条都不需要声明。
        assertEquals(Set.of(), declaredHosts(ToolMeta.Host.OFFICE));
    }

    @Test
    @DisplayName("绊线：源码里发文档级 UI 指令的调用点连条数一起钉住——新增一处就会红")
    void everyComponentSendingADocumentUiActionIsAccountedFor() throws IOException {
        Path toolsDir = Path.of("src/main/java/com/checkba/service/ai/tools");
        assertTrue(Files.isDirectory(toolsDir), "找不到工具源码目录：" + toolsDir.toAbsolutePath());

        Map<String, Integer> found = new TreeMap<>();
        try (Stream<Path> files = Files.list(toolsDir)) {
            for (Path f : files.filter(p -> p.getFileName().toString().endsWith(".java")).toList()) {
                String src = Files.readString(f, StandardCharsets.UTF_8);
                int hits = 0;
                for (String action : DOCUMENT_UI_ACTIONS) {
                    // 只数真实调用（含 "("），不数注释里提到的名字——注释里写的是判据说明，
                    // 本文件与 ToolMeta 的 javadoc 里都会反复出现这些名字。
                    int from = 0;
                    String needle = action + "(";
                    while ((from = src.indexOf(needle, from)) >= 0) {
                        if (!isInsideComment(src, from)) {
                            hits++;
                        }
                        from += needle.length();
                    }
                }
                if (hits > 0) {
                    found.put(f.getFileName().toString(), hits);
                }
            }
        }
        assertEquals(DOCUMENT_UI_ACTION_CALL_SITES, found,
                "有组件新增（或删掉）了往桌面前端发文档级 UI 指令的调用点。新增的那个要么给对应的"
                        + " @Tool 方法声明 requiresHost = LOWA，要么说明为什么不用（例如工具名本来就带"
                        + " doc_/sheet_/slide_ 前缀，前缀链已经把它锁在 LOWA 会话里），然后来改这份清单。");
    }

    /** 这一行是不是 {@code //} 注释（本仓里这四个名字在注释里出现得很多）。 */
    private static boolean isInsideComment(String src, int index) {
        int lineStart = src.lastIndexOf('\n', index) + 1;
        String before = src.substring(lineStart, index);
        return before.stripLeading().startsWith("//") || before.stripLeading().startsWith("*");
    }

    @Test
    @DisplayName("声明 LOWA 的工具在 Office / none 会话里既不下发规格、也分发不到")
    void lowaOnlyToolsAreGoneFromNonLowaSessions() {
        RecordingToolRegistry registry = registry();
        ClientCapabilityService caps = registry.capabilities();
        caps.record("conv-lowa", "lowa");
        caps.record("conv-word", "office");
        caps.record("conv-excel", "office", "excel");
        caps.record("conv-ppt", "office", "powerpoint");
        caps.record("conv-none", "none");

        for (String conv : new String[]{"conv-word", "conv-excel", "conv-ppt", "conv-none"}) {
            List<String> names = registry.getAllSpecifications(conv, null).stream()
                    .map(ToolSpecification::name).toList();
            assertFalse(names.contains("slide_create_file"), "跨类型新建仍须 LOWA 宿主：" + conv);
            assertTrue(registry.resolve("slide_create_file", conv).isEmpty());
            for (String tool : EXPECTED_LOWA_ONLY) {
                assertFalse(names.contains(tool), tool + " 不该下发给 " + conv);
                assertTrue(registry.resolve(tool, conv).isEmpty(),
                        tool + " 在 " + conv + " 里应当分发不到（能力闸两头都管）");
            }
        }

        List<String> lowaNames = registry.getAllSpecifications("conv-lowa", null).stream()
                .map(ToolSpecification::name).toList();
        assertTrue(lowaNames.contains("slide_create_file"));
        assertTrue(registry.resolve("slide_create_file", "conv-lowa").isPresent());
        for (String tool : EXPECTED_LOWA_ONLY) {
            if (EXPECTED_NOT_OFFERED.contains(tool)) {
                // 两道闸是叠加的：requiresHost 管「换一类客户端还剩什么」，offerToModel 管
                // 「这个工具压根还该不该出现在模型面前」。pptx_open_file / pptx_apply_format
                // 两样都占（dev-board#808），在 LOWA 会话里也照样不下发——这不是漏网，
                // 逐名清单在 EXPECTED_NOT_OFFERED 那条测试里钉着。
                assertFalse(lowaNames.contains(tool),
                        tool + " 声明了 offerToModel = false，LOWA 会话里也不该下发");
                continue;
            }
            assertTrue(lowaNames.contains(tool), tool + " 必须仍然下发给 LOWA 会话");
        }
    }

    @Test
    @DisplayName("PDF 的读取面不受影响：Office 会话仍看得见权威清单 doc_list_project_files 与 pdf_inspect")
    void readOnlyPdfToolsSurviveInOfficeSessions() {
        RecordingToolRegistry registry = registry();
        registry.capabilities().record("conv-word", "office");
        List<String> names = registry.getAllSpecifications("conv-word", null).stream()
                .map(ToolSpecification::name).toList();
        // 收窄的只有"改"，不是"读"——任务窗格里照样能列 PDF、读 PDF 正文。
        // 文件 ID 的来源是全类型的权威清单（dev-board#1065 T-01：纯后端，三档会话都可见），
        // 按类型过滤的 pdf_list_files / pptx_list_files 已只登记不下发（T-27）。
        assertTrue(names.contains("doc_list_project_files"), names.toString());
        assertTrue(names.contains("pdf_inspect"), names.toString());
        assertTrue(names.contains("pptx_inspect_format"), names.toString());
        assertFalse(names.contains("pdf_list_files"), names.toString());
    }

    // ==================== offerToModel（审计 A15） ====================

    @Test
    @DisplayName("offerToModel = false 的工具不进规格清单，但登记还在（只裁 spec、不裁 execute）")
    void permanentlyHiddenToolsAreStillRegistered() {
        RecordingToolRegistry registry = registry();
        List<String> names = registry.getAllSpecifications().stream()
                .map(ToolSpecification::name).toList();

        for (String tool : EXPECTED_NOT_OFFERED) {
            assertFalse(names.contains(tool),
                    tool + " 每轮白付一份 schema，而且用户说「把这个文件删掉」时模型会先调一次"
                            + "再转述拒绝，白烧一个往返：" + names.size() + " specs");
            assertTrue(registry.resolve(tool).isPresent(),
                    tool + " 的登记要保留：XML 兜底路径调到时，工具自己那句可行动的错误"
                            + "远好过一句 'Tool not found'（后者会让模型以为这个能力整个不存在）");
        }
    }

    @Test
    @DisplayName("V3 删除的 22 个长期隐藏工具不再注册，也没有任何 @Tool 方法")
    void deletedHiddenToolsAreGone() {
        RecordingToolRegistry registry = registry();
        Set<String> declared = new TreeSet<>();
        for (AgentToolComponent bean : RealToolBeans.instantiateAll()) {
            for (Method m : bean.getClass().getDeclaredMethods()) {
                if (m.isAnnotationPresent(Tool.class)) {
                    declared.add(m.getName());
                }
            }
        }
        for (String tool : DELETED_IN_V3) {
            assertFalse(declared.contains(tool), tool + " 应已删除，却仍有 @Tool 方法");
            assertTrue(registry.resolve(tool).isEmpty(), tool + " 应已删除，却仍在注册表里");
        }
    }

    @Test
    @DisplayName("声明 offerToModel = false 的工具逐名钉住（别顺手再藏别的）")
    void theHiddenSetIsPinned() {
        Set<String> declared = new TreeSet<>();
        for (AgentToolComponent bean : RealToolBeans.instantiateAll()) {
            for (Method m : bean.getClass().getDeclaredMethods()) {
                ToolMeta meta = m.getAnnotation(ToolMeta.class);
                if (m.isAnnotationPresent(Tool.class) && meta != null && !meta.offerToModel()) {
                    declared.add(m.getName());
                }
            }
        }
        assertEquals(EXPECTED_NOT_OFFERED, declared);
    }

    @Test
    @DisplayName("其余工具一个都没少：改动前后注册的工具总数不变，只是少下发了两份规格")
    void nothingElseDisappeared() {
        RecordingToolRegistry registry = registry();
        List<String> offered = registry.getAllSpecifications().stream()
                .map(ToolSpecification::name).toList();
        List<String> missing = new ArrayList<>();
        for (String name : new String[]{"write_docx", "create_folder", "move_files", "move_to_trash",
                "extract_file_text", "read_file", "search_project_content", "copy_files", "write_file", "search_web", "todo_write", "dispatch_subtask",
                "doc_find_replace", "doc_undo", "doc_list_revisions", "sheet_write_cells"}) {
            if (!offered.contains(name)) {
                missing.add(name);
            }
        }
        assertTrue(missing.isEmpty(), "这些工具不该受本次改动影响，却不见了：" + missing);
    }
    /**
     * 描述里写着「不传 / 可选 / 默认 / optional」的参数不能标成 required（langchain4j 的 {@code @P} 缺省
     * required = true）。标错时严格的模型（Claude / GPT）会被逼着把每个「不改则不传」的格式参数都填上，
     * 例如 doc_set_paragraph_format 填 headingLevel=0 就把标题打回正文。只看参数自己的说明，
     * 说明里的 JSON 示例（如 {@code "reason":"…（可选）"}）不算。
     */
    private static final java.util.regex.Pattern OPTIONAL_WORDING =
            java.util.regex.Pattern.compile("不传|可选|不填|[Oo]ptional|默认|缺省|留空");

    @Test
    @DisplayName("说明里写了可不传的参数不得是 required")
    void optionalWordingIsNeverRequired() throws Exception {
        List<String> wrong = new ArrayList<>();
        for (ToolSpecification spec : registry().getAllSpecifications()) {
            if (spec.parameters() == null || spec.parameters().required() == null) continue;
            for (String name : spec.parameters().required()) {
                Object prop = spec.parameters().properties().get(name);
                if (prop == null) continue;
                Object desc = prop.getClass().getMethod("description").invoke(prop);
                String own = desc == null ? "" : desc.toString().replaceAll("\\[\\{.*?\\}\\]?", "");
                if (OPTIONAL_WORDING.matcher(own).find()) wrong.add(spec.name() + "." + name);
            }
        }
        assertTrue(wrong.isEmpty(), "这些参数说明写着可不传，却被标成 required（给 @P 加 required = false）：" + wrong);
    }
}
