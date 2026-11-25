// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * zh-TW fallback quality (readiness POLISH Q4/Q5): every backend zh-TW string that only has a zh-CN source goes
 * through {@link ZhHantConverter}, so a wrong mapping shows up everywhere at once.
 */
class ZhHantConverterTest {

    /** Simplified-only characters that must never survive conversion (their Traditional forms differ). */
    private static final String SIMPLIFIED_ONLY =
            "这们个设项语览开关录务计档发应实时间进显为与无会认证账户编辑选择删换页单帮种签网络云题话历类级达动态后说请输从对还没让给过现点击费将该样导识规则别内尽";

    @Test
    void conjunctionBingBecomesBingWithDotsNotMergeBing() {
        // 并 "and" is 並 in Traditional; 併 only in merge words (合併, 併購 ...)
        assertEquals("提交並退出", ZhHantConverter.toTraditional("提交并退出"));
        assertEquals("請先登入並連接官方帳戶", ZhHantConverter.toTraditional("请先登录并连接官方账户"));
        assertEquals("立案申請已提交並完成利衝掃描", ZhHantConverter.toTraditional("立案申请已提交并完成利冲扫描"));
        assertEquals("合併兩份文件", ZhHantConverter.toTraditional("合并两份文件"));
        assertEquals("併購交易", ZhHantConverter.toTraditional("并购交易"));
        assertEquals("兼併與吞併", ZhHantConverter.toTraditional("兼并与吞并"));
        // already-Traditional input stays put
        assertEquals("並且", ZhHantConverter.toTraditional("並且"));
        assertEquals("合併", ZhHantConverter.toTraditional("合併"));
    }

    @Test
    void ambiguousCharactersKeepTheirCommonMeaning() {
        // 签: sign = 簽, tag/label = 籤
        assertEquals("簽名與簽約", ZhHantConverter.toTraditional("签名与签约"));
        assertEquals("標籤", ZhHantConverter.toTraditional("标签"));
        // 制: system/control stay 制; make/copy = 製
        assertEquals("控制與制度", ZhHantConverter.toTraditional("控制与制度"));
        assertEquals("製作並複製", ZhHantConverter.toTraditional("制作并复制"));
        // 注: attention stays 注; register/annotate = 註
        assertEquals("注意", ZhHantConverter.toTraditional("注意"));
        assertEquals("註冊與批註", ZhHantConverter.toTraditional("注册与批注"));
    }

    @Test
    void commonUiSentencesLeaveNoSimplifiedCharacters() {
        List<String> samples = List.of(
                // Q5: the OCR consent text in Settings, as seen half-converted on 2026-11-24
                "云端识别会将这份文档的页面图片发送至阿里云 OCR；平台通道按识别页数消耗 Credits，自备服务按供应商规则计费。结果为识别内容，不保证保留原版布局。",
                "请稍后再试",
                "这个项目还没有文件，请从左侧导入",
                "点击这里查看详细说明",
                "让 AI 给出修改建议",
                "当前网络不可用，已自动切换到本机模式",
                "内容已尽量保留原样");
        for (String s : samples) {
            String out = ZhHantConverter.toTraditional(s);
            for (char c : out.toCharArray()) {
                assertTrue(SIMPLIFIED_ONLY.indexOf(c) < 0, () -> "Simplified character '" + c + "' left in: " + out);
            }
        }
    }
}
