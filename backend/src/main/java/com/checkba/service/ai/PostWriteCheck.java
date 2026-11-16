// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.LangText;
import com.checkba.service.ai.review.ContractStructureAudit.Paragraph;
import com.checkba.service.ai.review.PostWriteAudit;
import com.checkba.service.ai.tools.DocumentAuditTools;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BiFunction;

/**
 * 系统代做的写后核对（gap P5），挂在 RunGuard 上，一轮一份。
 *
 * <p>触发：本轮成功的正文写入 ≥ 2 次、或有一次结构性写入（新增段落/条款、删除选区、清空段落），
 * 模型要收尾、且最后一次写入之后没有自己读过文档。单处修改仍靠回执里的 paragraphAfterEdit。
 *
 * <p>做法：第一次正文写入<b>之前</b>用既有 {@code get_document_text} 读一份全文作底稿，收尾时再读一份，
 * 交 {@link PostWriteAudit} 只比较改动段落及前后邻段（编号断裂 / 新建空段或空标题 / 新出现的重复）。
 * 干净就照常收尾、对用户不可见；有问题返回一条给模型的隐形提醒（每轮最多一次）。
 * 读不到底稿、读不到改后全文、中途换了文档 —— 一律不核对，静默放行，绝不拿不完整的数据报错。
 *
 * <p>只认 LOWA（嵌入式编辑器）：Office/WPS 任务窗格走 office_* 执行器，没有 get_document_text，
 * 这里统计的 doc_* 写入在那边本来就不会出现；编排器另按客户端能力再拦一次。
 */
@Slf4j
final class PostWriteCheck {

    /** 会改正文文字的 doc_* 写入（格式、批注类不改文字，不计数）。 */
    static final Set<String> TEXT_WRITES = Set.of(
            "doc_find_replace", "doc_replace_selection", "doc_insert_at_cursor", "doc_modify_paragraph",
            "doc_insert_under_heading", "doc_replace_at_anchor", "doc_delete_selection",
            "doc_undo", "doc_redo", "doc_revisions");

    /** 模型自己回读过整段正文就算它核对过了。 */
    static final Set<String> READS = Set.of(
            "doc_get_document_text", "doc_get_paragraph", "doc_get_clauses", "doc_audit_structure");

    /** 底稿/改后全文最多读几页（每页 500 段、15000 字）；读不完就不核对。 */
    static final int MAX_PAGES = 8;
    /**
     * 每次读取的等待上限（秒）。读取类默认等 120 秒；这里用户没在等这一步，编辑器不在了（标签关了）时
     * 干等 120 秒会让已经流完的回答迟迟不收尾（11-11 矩阵实测一次）。正常读一份合同几十到几百毫秒。
     */
    static final int READ_TIMEOUT_SECONDS = 15;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private boolean baselineTried;
    private List<Paragraph> baseline;
    private Long baselineFileId;
    private int writes;
    private boolean structural;
    private boolean readAfterLastWrite;
    private boolean done;

    /** 工具执行前：本轮第一次正文写入之前读底稿。 */
    synchronized void beforeTool(String toolName, Long activeFileId,
                                 BiFunction<String, Map<String, Object>, String> bridge) {
        if (baselineTried || !TEXT_WRITES.contains(toolName)) return;
        baselineTried = true;
        DocumentAuditTools.ParagraphRead read = read(bridge);
        if (read.error() == null && read.complete()) {
            baseline = read.paragraphs();
            baselineFileId = activeFileId;
        } else {
            log.info("[PostWriteVerify] baseline unavailable: {}", read.error() == null ? "too long" : read.error());
        }
    }

    /** 工具执行后：记写入次数、是否结构性、最后一次写入之后有没有回读。 */
    synchronized void afterTool(String toolName, String argsJson, boolean success) {
        if (!success) return;
        if (TEXT_WRITES.contains(toolName)) {
            writes++;
            structural |= isStructural(toolName, argsJson);
            readAfterLastWrite = false;
        } else if (READS.contains(toolName) && writes > 0) {
            readAfterLastWrite = true;
        }
    }

    /**
     * 收尾时要不要由系统核对。结构性写入（新增/删除段落）即使模型回读过也核对：评测实录（tasks-10 v01，
     * deepseek 3 次里 2 次）模型插入「第七条 不可抗力」后回读了全文，却没发现原第七条起没顺延、条号重复，
     * 照样收尾。系统这一读是隐形的，干净就不说话。普通多处改字仍以模型回读为准。
     */
    synchronized boolean due() {
        return !done && baseline != null && (structural || (writes >= 2 && !readAfterLastWrite));
    }

    /**
     * 核对一次（之后本轮不再核对）。返回给模型的提醒；干净或核对不了返回 null。
     * 日志行 {@code [PostWriteVerify] conv=… result=…} 供 model-matrix 统计。
     */
    synchronized String verify(String conversationId, Long activeFileId,
                               BiFunction<String, Map<String, Object>, String> bridge) {
        done = true;
        if (!Objects.equals(baselineFileId, activeFileId)) {
            log.info("[PostWriteVerify] conv={} result=skipped reason=document-switched writes={}", conversationId, writes);
            return null;
        }
        DocumentAuditTools.ParagraphRead read = read(bridge);
        if (read.error() != null || !read.complete()) {
            log.info("[PostWriteVerify] conv={} result=unavailable writes={} reason={}", conversationId, writes,
                    read.error() == null ? "too long" : read.error());
            return null;
        }
        PostWriteAudit.Result result = PostWriteAudit.check(baseline, read.paragraphs());
        log.info("[PostWriteVerify] conv={} result={} writes={} structural={} changed={} deleted={} issues={}",
                conversationId, result.clean() ? "clean" : "issues", writes, structural, result.changed(),
                result.deletions(), result.issues().size());
        return result.clean() ? null : reminder(result.issues());
    }

    static boolean isStructural(String toolName, String argsJson) {
        switch (toolName) {
            case "doc_insert_under_heading", "doc_delete_selection" -> {
                return true;
            }
            case "doc_insert_at_cursor" -> {
                JsonNode args = parse(argsJson);
                return args.path("newParagraph").asBoolean(false)
                        || "true".equalsIgnoreCase(args.path("newParagraph").asText())
                        || args.path("text").asText("").strip().contains("\n");
            }
            case "doc_modify_paragraph" -> {
                JsonNode args = parse(argsJson);
                return args.has("newText") && args.path("newText").asText("").isBlank();
            }
            default -> {
                return false;
            }
        }
    }

    static String reminder(List<PostWriteAudit.Issue> issues) {
        StringBuilder zh = new StringBuilder(), en = new StringBuilder();
        int n = 0;
        for (PostWriteAudit.Issue i : issues) {
            if (++n > 8) break;
            String where = "段 " + i.paragraph() + (i.excerpt().isEmpty() ? "" : "「" + i.excerpt() + "」");
            String whereEn = "paragraph " + i.paragraph() + (i.excerpt().isEmpty() ? "" : " \"" + i.excerpt() + "\"");
            zh.append("\n- ").append(where).append("：").append(kindZh(i.kind())).append("——").append(i.detail());
            en.append("\n- ").append(whereEn).append(": ").append(kindEn(i.kind())).append(" — ").append(i.detail());
        }
        return LangText.of(
                "[系统提醒] 系统在你最后一次修改后回读了改动处及前后段落（段号 0 起，与 doc_get_document_text 一致），"
                        + "发现以下改前没有的问题：" + zh
                        + "\n先用读取工具核对这些段落：确属本轮修改造成的，修正后再收尾；修不了或本来就该如此的，"
                        + "在 <final> 里如实告诉用户。不要改动用户没要求改的其它内容。",
                "[System reminder] After your last edit the system re-read the changed paragraphs and their neighbours "
                        + "(0-based, same as doc_get_document_text) and found these problems that were not there before:"
                        + en
                        + "\nRead those paragraphs first. If your edits caused them, fix them before finishing; if they "
                        + "cannot be fixed or are intended, say so plainly in <final>. Do not change anything the user "
                        + "did not ask you to change.");
    }

    private static String kindZh(PostWriteAudit.Kind k) {
        return switch (k) {
            case NUMBERING -> "编号断裂";
            case EMPTY_PARAGRAPH -> "空段落";
            case EMPTY_HEADING -> "空标题";
            case DUPLICATE -> "重复";
        };
    }

    private static String kindEn(PostWriteAudit.Kind k) {
        return switch (k) {
            case NUMBERING -> "numbering break";
            case EMPTY_PARAGRAPH -> "empty paragraph";
            case EMPTY_HEADING -> "empty heading";
            case DUPLICATE -> "duplicate";
        };
    }

    private static DocumentAuditTools.ParagraphRead read(BiFunction<String, Map<String, Object>, String> bridge) {
        return DocumentAuditTools.readParagraphs(bridge, MAX_PAGES);
    }

    private static JsonNode parse(String json) {
        try {
            JsonNode n = json == null ? null : MAPPER.readTree(json);
            return n == null ? MAPPER.createObjectNode() : n;
        } catch (Exception e) {
            return MAPPER.createObjectNode();
        }
    }
}
