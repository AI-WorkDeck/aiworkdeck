// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.context;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class OfficeOutlineTextTest {

    private static byte[] fixture(String name) throws Exception {
        return Files.readAllBytes(Path.of("..", "scripts", "eval", "fixtures", name));
    }

    @Test
    void xlsxOutlineCarriesRowNumbersColumnLettersAndReadableDates() throws Exception {
        String out = OfficeOutlineText.of("案件台账.xlsx", fixture("case-ledger.xlsx"));
        assertThat(out).contains("## 工作表 1「台账」 已用区域 A1:F9（9 行 × 6 列）");
        assertThat(out).contains("3: A=(2025)示0105民初1187号 | B=样例物流");
        assertThat(out).contains("E=2025-03-02");
        assertThat(out).contains("## 工作表 2「费用」");
    }

    @Test
    void pptxOutlineCarriesPageNumbersTitlesAndBullets() throws Exception {
        String out = OfficeOutlineText.of("案件汇报.pptx", fixture("case-report.pptx"));
        assertThat(out).contains("共 5 页");
        assertThat(out).contains("## 第 2 页：案件概况");
        assertThat(out).contains("- 原告：示范科技有限公司");
        assertThat(out).contains("## 第 5 页：风险提示");
    }
}
