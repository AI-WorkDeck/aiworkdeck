package com.checkba.service.ai.memory;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 项目记忆提取器测试
 */
class ProjectMemoryExtractorTest {

    private ProjectMemoryExtractor extractor;

    @Mock
    private MemoryManager memoryManager;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        extractor = new ProjectMemoryExtractor(memoryManager);
    }

    @Test
    @DisplayName("应该提取法律引用")
    void shouldExtractLegalReferences() {
        String content = """
            根据《公司法》第十六条和《证券法》第五十三条规定，
            以及《上市公司重大资产重组管理办法》的相关要求，
            本次交易需要获得股东大会批准。
            """;
        
        List<String> refs = extractor.extractLegalReferences(content);
        
        assertEquals(3, refs.size());
        assertTrue(refs.stream().anyMatch(r -> r.contains("公司法")));
        assertTrue(refs.stream().anyMatch(r -> r.contains("证券法")));
        assertTrue(refs.stream().anyMatch(r -> r.contains("重大资产重组")));
    }

    @Test
    @DisplayName("应该提取金额并转换单位")
    void shouldExtractAndConvertAmounts() {
        String content = """
            本次交易总金额为10.5亿元，其中：
            - 现金支付3亿元
            - 股份支付7.5亿元
            另外支付中介费用500万元。
            """;
        
        Map<String, BigDecimal> amounts = extractor.extractAmounts(content);
        
        assertFalse(amounts.isEmpty());
        
        // 验证金额转换
        assertTrue(amounts.values().stream()
                .anyMatch(a -> a.compareTo(new BigDecimal("1050000000")) == 0)); // 10.5亿
        assertTrue(amounts.values().stream()
                .anyMatch(a -> a.compareTo(new BigDecimal("5000000")) == 0)); // 500万
    }

    @Test
    @DisplayName("应该提取日期")
    void shouldExtractDates() {
        String content = """
            本协议于2024年1月15日签订，
            资产交割日期为2024年3月31日，
            业绩承诺期间为2024年1月1日至2026年12月31日。
            """;
        
        List<String> dates = extractor.extractDates(content);
        
        assertEquals(4, dates.size());
        assertTrue(dates.contains("2024年1月15日"));
        assertTrue(dates.contains("2024年3月31日"));
    }

    @Test
    @DisplayName("应该提取公司名称")
    void shouldExtractCompanyNames() {
        String content = """
            本次交易涉及的主体包括：
            上市公司：北京某某科技股份有限公司
            标的公司：深圳某某集团有限公司
            交易对方：上海某某投资有限公司
            """;
        
        List<String> companies = extractor.extractCompanies(content);
        
        assertTrue(companies.size() >= 3);
        assertTrue(companies.stream().anyMatch(c -> c.contains("科技股份有限公司")));
        assertTrue(companies.stream().anyMatch(c -> c.contains("集团有限公司")));
    }

    @Test
    @DisplayName("应该提取当事人信息")
    void shouldExtractParties() {
        String content = """
            甲方：北京某某科技股份有限公司
            乙方：张三
            上市公司：深圳某某集团有限公司
            交易对方：李四、王五
            """;
        
        Map<String, String> parties = extractor.extractParties(content);
        
        assertFalse(parties.isEmpty());
        assertTrue(parties.containsKey("甲方"));
        assertTrue(parties.containsKey("乙方"));
        assertTrue(parties.containsKey("上市公司"));
    }

    @Test
    @DisplayName("应该忽略短公司名称")
    void shouldIgnoreShortCompanyNames() {
        String content = "ABC有限公司是一家小型企业。"; // 太短，应该被忽略
        
        List<String> companies = extractor.extractCompanies(content);
        
        // 应该忽略太短的名称
        assertTrue(companies.stream().noneMatch(c -> c.equals("ABC有限公司")));
    }

    @Test
    @DisplayName("应该去重法律引用")
    void shouldDeduplicateLegalReferences() {
        String content = """
            根据《公司法》第十六条的规定，
            同时根据《公司法》第十六条的要求，
            另外《公司法》第十六条也有相关说明。
            """;
        
        List<String> refs = extractor.extractLegalReferences(content);
        
        // 相同的引用只应该出现一次
        assertEquals(1, refs.size());
    }

    @Test
    @DisplayName("应该正确处理不同金额单位")
    void shouldHandleDifferentAmountUnits() {
        String content = """
            交易金额：10亿元
            保证金：5000万元
            手续费：100万
            其他费用：50000元
            """;
        
        Map<String, BigDecimal> amounts = extractor.extractAmounts(content);
        
        // 验证单位转换正确
        assertTrue(amounts.values().stream()
                .anyMatch(a -> a.compareTo(new BigDecimal("1000000000")) == 0)); // 10亿
        assertTrue(amounts.values().stream()
                .anyMatch(a -> a.compareTo(new BigDecimal("50000000")) == 0)); // 5000万
    }
}

