// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.service.sensitive.SensitiveDocx;
import com.checkba.service.sensitive.SensitiveTextEngine;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SensitiveAddressRecognitionTest {
    @TempDir Path dir;
    private final SensitiveService service = new SensitiveService();
    private SensitiveService.Options options(String mode) {
        return new SensitiveService.Options(List.of("ADDRESS"), mode, List.of(), List.of(), "address-test-2026");
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "注册地址：北京市朝阳区建国路88号SOHO现代城A座3层301室|注册地址：XX市XX区XXXX",
        "住所：北京市海淀区中关村大街27号（集中办公区）|住所：XX市XX区XXXX",
        "通讯地址：广东省深圳市南山区科技园科苑路15号 A栋 1201室|通讯地址：XX省XX市XX区XXXX",
        "注册地址：北京市朝阳区广渠路36号院5号楼1至2层101|注册地址：XX市XX区XXXX",
        "注册地址：北京市朝阳区酒仙桥路甲10号3号楼12层1201|注册地址：XX市XX区XXXX",
        "办公地址：深圳市南山区粤海街道科技园南区18栋302|办公地址：XX市XX区XXXX",
        "住所：万达广场|住所：XXXX",
        "注册地址：北京市朝阳区建国路88号（集中办公区）|注册地址：XX市XX区XXXX",
        "注册地址：北京市朝阳区建国路88号 联系人 李明|注册地址：XX市XX区XXXX 联系人 李明",
        "本公司在北京市朝阳区建国路88号办公。|本公司在XX市XX区XXXX办公。",
        "注册地址：广东省深圳市南山区科技南路18号A座1201室|注册地址：XX省XX市XX区XXXX",
        "注册地址为北京市朝阳区建国路88号|注册地址为XX市XX区XXXX",
        "住所：北京市朝阳区|住所：XX市XX区XXXX",
        "通讯地址：幸福路8号2幢301室|通讯地址：XXXX",
        "送达地址：浙江省杭州市桐庐县富春路12号|送达地址：XX省XX市XX县XXXX",
        "住所地：广西壮族自治区南宁市青秀区民族大道20号|住所地：XX自治区XX市XX区XXXX",
        "公司位于广东省深圳市南山区科技南路18号，双方签署合同。|公司位于XX省XX市XX区XXXX，双方签署合同。",
        "请寄至北京市朝阳区建国路88号。|请寄至XX市XX区XXXX。",
        "北京市朝阳区建国路88号|XX市XX区XXXX",
        "成都市武侯区人民南路10号|XX市XX区XXXX",
        "公司在成都市武侯区人民南路10号签署合同。|公司在XX市XX区XXXX签署合同。",
        "幸福路8号2幢301室|XXXX",
        "通讯地址：幸福小区8号楼1201室|通讯地址：XXXX",
        "我们在幸福路8号签署本合同。|我们在XXXX签署本合同。",
        "地址：北京市朝阳区自在路8号|地址：XX市XX区XXXX",
        "注册地址：北京市朝阳区建国路88号 联系人：李明|注册地址：XX市XX区XXXX 联系人：李明",
        "注册地址：北京市朝阳区建国路88号法定代表人：李明|注册地址：XX市XX区XXXX法定代表人：李明",
        "公司在北京市朝阳区建国路88号签署本合同。|公司在XX市XX区XXXX签署本合同。"
    })
    void addressFieldsAndBodyKeepOnlyAdministrativeStructure(String input, String expected) {
        assertEquals(expected, service.replaceSensitiveData(input, "ADDRESS"));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "双方应当按注册地址送达通知，地址变更应书面告知。",
        "注册地址：待补充；通讯地址：另行通知。",
        "本合同适用于广东省，双方应按约履行。",
        "北京市朝阳区人民法院依法审理本案。",
        "甲方：北京市朝阳区星河科技有限公司。",
        "市场发展空间广阔，地区经济不断增长。",
        "地址：合同中约定的送达地址。"
    })
    void ordinaryProseAndOrganizationsAreNotAddresses(String input) {
        assertEquals(input, service.replaceSensitiveData(input, "ADDRESS"));
    }

    @Test void defaultStrategiesKeepBoundariesAcrossMixedContractEntities() throws Exception {
        String original = "甲方：北京星河科技有限公司。注册地址为北京市朝阳区建国路88号 联系人：张三；电话：13800001111。\n"
                + "乙方：上海远航实业有限公司。通讯地址：广东省深圳市南山区科技园科苑路15号 A栋 1201室；邮箱：contact@example.com。\n"
                + "双方应当按照约定履行义务。";
        Path source = dir.resolve("mixed-contract.txt"); Files.writeString(source, original);
        var defaults = new SensitiveService.Options(List.of("COMPANY", "CHINESE_NAME", "PHONE", "ID_CARD",
                "UNIFIED_SOCIAL_CREDIT", "LAWYER_LICENSE", "EMAIL", "BANK_CARD", "ADDRESS"),
                "TOKEN", List.of(), List.of(), "address-test-2026");
        var result = service.processFile(source.toString(), defaults);
        assertEquals(2, result.counts().get("ADDRESS"));
        assertEquals(2, result.counts().get("COMPANY"));
        assertEquals(1, result.counts().get("CHINESE_NAME"));
        assertEquals(1, result.counts().get("PHONE"));
        assertEquals(1, result.counts().get("EMAIL"));
        String output = Files.readString(Path.of(result.path()));
        for (String value : List.of("星河", "远航", "建国路", "科苑路", "张三", "13800001111", "contact@example.com"))
            assertFalse(output.contains(value), output);
        assertTrue(output.contains(" 联系人："));
        assertTrue(output.endsWith("双方应当按照约定履行义务。"));
        var restored = service.restoreFile(result.path(), result.recoveryKit(), "address-test-2026");
        assertEquals(original, Files.readString(Path.of(restored.path())));
    }

    @Test void exclusionsAndDisabledAddressStrategyRemainEffective() {
        String address = "北京市朝阳区建国路88号";
        for (var engine : List.of(
                new SensitiveTextEngine(List.of("ADDRESS"), false, List.of(), List.of(address)),
                new SensitiveTextEngine(List.of("PHONE"), false, List.of(), List.of()))) {
            engine.learn("注册地址：" + address);
            assertEquals("注册地址：" + address, engine.apply("注册地址：" + address));
        }
    }

    @Test void fieldNeverCrossesLineOrConsumesFollowingFields() {
        String input = "注册地址：北京市朝阳区建国路88号\n电话：13800001111\n地址：\n双方应履行合同。";
        assertEquals("注册地址：XX市XX区XXXX\n电话：13800001111\n地址：\n双方应履行合同。", service.replaceSensitiveData(input, "ADDRESS"));
    }

    @Test void textPreviewGenerationAndDistinctReversibleTokensAgree() throws Exception {
        String original = "注册地址为北京市朝阳区建国路88号。\n通讯地址：北京市朝阳区建国路99号。\n北京市朝阳区建国路88号";
        Path source = dir.resolve("address.txt"); Files.writeString(source, original);
        var preview = service.previewFile(source.toString(), options("MASK"));
        var masked = service.processFile(source.toString(), options("MASK"));
        assertEquals(preview.text(), Files.readString(Path.of(masked.path())));
        assertEquals(3, masked.counts().get("ADDRESS"));
        var reversible = service.processFile(source.toString(), options("TOKEN"));
        String output = Files.readString(Path.of(reversible.path()));
        assertFalse(output.contains("北京")); assertFalse(output.contains("建国"));
        var tokens = SensitiveTextEngine.TOKEN.matcher(output).results().map(r -> r.group()).toList();
        assertEquals(3, tokens.size()); assertEquals(tokens.get(0), tokens.get(2));
        assertNotEquals(tokens.get(0), tokens.get(1));
        assertTrue(tokens.get(0).contains("XX市XX区XXXX"));
        var repeated = service.processFile(reversible.path(), options("TOKEN"));
        assertEquals(output, Files.readString(Path.of(repeated.path())));
        assertTrue(repeated.counts().isEmpty());
        var restored = service.restoreFile(reversible.path(), reversible.recoveryKit(), "address-test-2026");
        assertEquals(original, Files.readString(Path.of(restored.path())));
    }

    @Test void docxAcrossRunsAndSeparateTableCellsUsesSameRecognition() throws Exception {
        Path source = dir.resolve("address.docx");
        try (var doc = new XWPFDocument()) {
            var p = doc.createParagraph(); p.createRun().setText("注册地址为广东省深圳市");
            p.createRun().setText("南山区科技南路18号");
            var end = p.createRun(); end.setBold(true); end.setText("；双方签署合同。");
            var table = doc.createTable(1, 2);
            table.getRow(0).getCell(0).setText("通讯地址");
            table.getRow(0).getCell(1).setText("幸福路8号2幢301室");
            try (var out = Files.newOutputStream(source)) { doc.write(out); }
        }
        var preview = service.previewFile(source.toString(), options("MASK"));
        var result = service.processFile(source.toString(), options("MASK"));
        assertEquals(2, result.counts().get("ADDRESS"));
        assertEquals(preview.counts(), result.counts());
        try (var doc = new XWPFDocument(Files.newInputStream(Path.of(result.path())))) {
            assertEquals("注册地址为XX省XX市XX区XXXX；双方签署合同。", doc.getParagraphs().get(0).getText());
            assertTrue(doc.getParagraphs().get(0).getRuns().get(2).isBold());
            assertEquals("XXXX", doc.getTables().get(0).getRow(0).getCell(1).getText());
        }
        var reversible = service.processFile(source.toString(), options("TOKEN"));
        var restored = service.restoreFile(reversible.path(), reversible.recoveryKit(), "address-test-2026");
        assertEquals(new SensitiveDocx(source).texts(), new SensitiveDocx(Path.of(restored.path())).texts());
    }
}
