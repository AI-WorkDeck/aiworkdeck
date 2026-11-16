// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.version.merge.Decision;
import com.checkba.version.merge.MergeRecord;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 「相邻、已自动合入」的单元记进 {@code X-AWD-Merges}（action {@code N}，2026-11-15）：
 * 自动合并那一笔追加 {@code Np3T} 项（老读侧按首字母只认 M/T，多出来的项跳过——兼容），
 * 逐处裁决那一笔与其它裁决同一写法 {@code p3TN}。
 */
class MergeNeighborTrailerTest {

    @Test
    @DisplayName("自动合并：两侧计数之后追加相邻单元，读回来在 decisions 里")
    void autoRecordCarriesNeighbors() {
        String v = ProjectRepoService.mergesTrailerValue(List.of(new MergeRecord("合同.docx", "auto",
                List.of(new Decision("p3", "T", "N"), new Decision("p5", "M", "N")), 1, 2)));
        assertEquals("合同.docx=auto:M1,T2,Np3T,Np5M", v);
        var back = ProjectRepoService.parseMerges(v).get(0);
        assertEquals(1, back.mainCount());
        assertEquals(2, back.otherCount());
        assertEquals(List.of(new Decision("p3", "T", "N"), new Decision("p5", "M", "N")), back.decisions());
    }

    @Test
    @DisplayName("没有相邻单元的自动合并：尾注与以前逐字相同")
    void autoWithoutNeighborsUnchanged() {
        assertEquals("合同.docx=auto:M1,T2", ProjectRepoService.mergesTrailerValue(
                List.of(new MergeRecord("合同.docx", "auto", List.of(), 1, 2))));
    }

    @Test
    @DisplayName("逐处裁决那一笔里的相邻单元：p3TN，读回原样")
    void manualRecordCarriesNeighbors() {
        String v = ProjectRepoService.mergesTrailerValue(List.of(new MergeRecord("合同.docx", "manual",
                List.of(new Decision("p4", "T", "A"), new Decision("p3", "T", "N")), 0, 0)));
        assertEquals("合同.docx=manual:p4TA,p3TN", v);
        assertEquals(List.of(new Decision("p4", "T", "A"), new Decision("p3", "T", "N")),
                ProjectRepoService.parseMerges(v).get(0).decisions());
    }
}
