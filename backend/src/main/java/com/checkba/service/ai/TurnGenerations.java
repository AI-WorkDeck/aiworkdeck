// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import dev.langchain4j.model.chat.listener.ChatModelListener;
import dev.langchain4j.model.chat.listener.ChatModelResponseContext;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Q24 国际平台通道：一轮对话里 OpenRouter 返回的生成 id（{@code gen-…}），按本轮计费标记分组。
 *
 * <p>国际通道直连 OpenRouter，官网账上没有按轮的记录；轮次结束后用同一把运行凭据按 id 查
 * OpenRouter 的实扣金额（{@link TurnCostService}）。只在进程内保存最近 1000 轮、每轮最多 200 个 id，
 * 不落盘、不发给渲染层；id 本身不含内容。
 */
public final class TurnGenerations {

    static final int MAX_TURNS = 1000;
    static final int MAX_PER_TURN = 200;
    private static final Pattern GENERATION_ID = Pattern.compile("^gen-[A-Za-z0-9_-]{1,120}$");

    private static final Map<String, List<String>> BY_TAG = Collections.synchronizedMap(
            new LinkedHashMap<>(64, 0.75f, false) {
                @Override protected boolean removeEldestEntry(Map.Entry<String, List<String>> eldest) { return size() > MAX_TURNS; }
            });
    /** 轮次里有拿不到生成 id 的国际平台调用（非流式辅助调用）：这一轮的金额查不全。 */
    private static final Map<String, Boolean> INCOMPLETE = Collections.synchronizedMap(
            new LinkedHashMap<>(64, 0.75f, false) {
                @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) { return size() > MAX_TURNS; }
            });

    private static final Pattern TURN_TAG = Pattern.compile("^[0-9a-f]{32}$");

    /**
     * 国际平台通道的非流式调用（记忆摘要、下一句建议、辅助整理…）：OpenRouter 响应体的 {@code id} 就是生成 id。
     * langchain4j 在调用线程上同步回调，所以轮次标记直接取 {@link PlatformTurnScope#current()}；
     * 回来的响应没有生成 id 时这一轮的金额查不全。
     */
    static final ChatModelListener NON_STREAMED = new ChatModelListener() {
        @Override public void onResponse(ChatModelResponseContext context) {
            String tag = PlatformTurnScope.current();
            if (tag == null || !TURN_TAG.matcher(tag).matches()) return;
            String id = context.response() == null ? null : context.response().id();
            if (id != null && GENERATION_ID.matcher(id).matches()) record(tag, id);
            else INCOMPLETE.put(tag, Boolean.TRUE);
        }
    };

    private TurnGenerations() {}

    static void record(String tag, String generationId) {
        if (tag == null || generationId == null || !GENERATION_ID.matcher(generationId).matches()) return;
        synchronized (BY_TAG) {
            List<String> ids = BY_TAG.computeIfAbsent(tag, k -> new ArrayList<>());
            if (ids.size() >= MAX_PER_TURN) { INCOMPLETE.put(tag, Boolean.TRUE); return; }
            if (!ids.contains(generationId)) ids.add(generationId);
        }
    }

    static List<String> idsFor(String tag) {
        synchronized (BY_TAG) {
            List<String> ids = tag == null ? null : BY_TAG.get(tag);
            return ids == null ? List.of() : List.copyOf(ids);
        }
    }

    static boolean incomplete(String tag) {
        return tag != null && INCOMPLETE.containsKey(tag);
    }
}
