// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import dev.langchain4j.data.message.ImageContent;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 工具 → 编排器的图片侧信道（office-tier1 doc_view_pages）。
 *
 * <p>工具结果（ToolExecutionResultMessage）只能是文本；要让主模型亲眼看到渲染出的页面，
 * 工具把图片按会话放进这里，编排器在这一批工具跑完后取走，作为一条带图的用户消息挂到末尾。
 * 只留最新一批：同一会话再放就覆盖。图片从不落库（落库的是执行日志文本）。
 */
@Component
public class ToolImageInbox {

    public record Batch(String caption, List<ImageContent> images) {}

    private final Map<String, Batch> pending = new ConcurrentHashMap<>();

    public void put(String conversationId, String caption, List<ImageContent> images) {
        if (conversationId == null || images == null || images.isEmpty()) return;
        pending.put(conversationId, new Batch(caption, List.copyOf(images)));
    }

    /** 取走并清空；没有时返回 null。 */
    public Batch take(String conversationId) {
        return conversationId == null ? null : pending.remove(conversationId);
    }
}
