// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import java.util.function.Supplier;

/**
 * Q24：「这次平台通道调用属于哪一轮对话」——本轮计费标记的线程作用域。
 *
 * <p>页脚显示的「本轮 ¥x.xx」必须等于这一轮实际扣的钱，所以轮次期间的每次平台调用都要带标记：
 * 主循环与子任务的流式请求经 handler 带（{@link ReasoningStreamingHandler#turnTag()}），标题生成、
 * 上下文压缩、附件识读等辅助调用经这里带——{@link ChatModelFactory} 建平台模型时读它，
 * {@link OpenRouterStreamingChatModel} 在 handler 没给标记时也回落到它。
 *
 * <p>跨线程同 {@link PlatformAiUserScope}：{@link PlatformAiUserScope#wrap} 一并捕获并重放本作用域；
 * 编排器在拿得到 RunGuard 的每个回调入口显式设置。标记只含散列，没有内容。
 */
public final class PlatformTurnScope {

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private PlatformTurnScope() {}

    /** 当前线程所属轮次的计费标记；不在轮次里返回 null。 */
    public static String current() {
        return CURRENT.get();
    }

    /** 在作用域内执行；tag 为 null 时沿用外层值。嵌套安全：退出时恢复外层值。 */
    public static void run(String tag, Runnable body) {
        String previous = CURRENT.get();
        if (tag != null) CURRENT.set(tag);
        try {
            body.run();
        } finally {
            restore(previous);
        }
    }

    public static <T> T call(String tag, Supplier<T> body) {
        String previous = CURRENT.get();
        if (tag != null) CURRENT.set(tag);
        try {
            return body.get();
        } finally {
            restore(previous);
        }
    }

    /**
     * 轮次里有平台计费调用没能带上标记（目前只有 pptx-service 生成演示文稿：它在外部进程里直连网关）。
     * 记下该轮的标记，费用查询据此告诉前端「本轮金额不含演示文稿生成」，不把少算的数当成总数显示。
     * 只存最近 1000 个标记（散列，无内容），进程内，不落盘。
     */
    private static final java.util.Map<String, Boolean> UNTAGGED_SPEND = java.util.Collections.synchronizedMap(
            new java.util.LinkedHashMap<>(64, 0.75f, false) {
                @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, Boolean> eldest) { return size() > 1000; }
            });

    /** 当前轮次里发生了一次带不上标记的平台计费调用。不在轮次里时什么也不做。 */
    public static void markUntaggedSpend() {
        String tag = CURRENT.get();
        if (tag != null) UNTAGGED_SPEND.put(tag, Boolean.TRUE);
    }

    public static boolean hadUntaggedSpend(String tag) {
        return tag != null && UNTAGGED_SPEND.containsKey(tag);
    }

    private static void restore(String previous) {
        if (previous == null) CURRENT.remove();
        else CURRENT.set(previous);
    }
}
