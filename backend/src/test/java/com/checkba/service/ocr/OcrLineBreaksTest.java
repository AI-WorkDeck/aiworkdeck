// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.service.OcrService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.platform.ExternalProviderResolver;
import com.checkba.service.platform.ExternalServiceProvider;
import com.checkba.service.platform.PlatformGatewayClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Aliyun RecognizeAllText joins a whole page into one space-separated {@code content} line, so the
 * explorer TXT/Word export came out as one paragraph per page. Lines must come from the per-line
 * {@code blockDetails} in {@code raw} (shape captured from a real platform response, 2026-11-05,
 * fictional sample).
 */
class OcrLineBreaksTest {

    static final String RAW = """
            {"content":"股权转让协议 协议编号：XQ-2026-0815 签署地：江州市临川区","height":1754,"width":1240,
             "subImageCount":1,"subImages":[{"angle":0,"subImageId":0,"type":"通用文字识别高精版",
             "blockInfo":{"blockCount":3,"blockDetails":[
               {"blockAngle":1,"blockConfidence":99,"blockContent":"股权转让协议","blockId":0},
               {"blockAngle":0,"blockConfidence":99,"blockContent":"协议编号：XQ-2026-0815","blockId":1},
               {"blockAngle":1,"blockConfidence":99,"blockContent":"签署地：江州市临川区","blockId":2}]}}]}""";

    @Test
    void platformTierReturnsOneLinePerRecognizedBlock() {
        PlatformGatewayClient gateway = mock(PlatformGatewayClient.class);
        ExternalProviderResolver resolver = mock(ExternalProviderResolver.class);
        when(resolver.resolve(any())).thenReturn(ExternalServiceProvider.PLATFORM);
        var data = new ObjectMapper().createObjectNode()
                .put("content", "股权转让协议 协议编号：XQ-2026-0815 签署地：江州市临川区").put("raw", RAW);
        when(gateway.call(eq("ocr"), eq("recognize"), anyMap(), anyInt()))
                .thenReturn(new PlatformGatewayClient.Result(data, 10, 1, "page"));
        OcrService service = new OcrService(mock(SystemSettingService.class), resolver, gateway);

        OcrResult result = service.recognizeGeneral(Base64.getEncoder().encodeToString(new byte[]{1, 2, 3}));

        assertEquals("股权转让协议\n协议编号：XQ-2026-0815\n签署地：江州市临川区", result.getText());
        assertEquals(RAW, result.getRaw(), "raw stays untouched for coordinate-aware consumers");
        verify(gateway, times(1)).call(anyString(), anyString(), anyMap(), anyInt()); // still one billed call
    }

    @Test
    void multipleSubImagesAreSeparatedByABlankLine() {
        String raw = "{\"subImages\":[{\"blockInfo\":{\"blockDetails\":[{\"blockContent\":\"甲\"},{\"blockContent\":\"乙\"}]}},"
                + "{\"blockInfo\":{\"blockDetails\":[{\"blockContent\":\"丙\"}]}}]}";
        assertEquals("甲\n乙\n\n丙", OcrResult.lines(raw, "甲 乙 丙"));
    }

    @Test
    void fallsBackToContentWhenRawHasNoBlocks() {
        assertEquals("纯文本", OcrResult.lines("", "纯文本"));
        assertEquals("纯文本", OcrResult.lines("not json", "纯文本"));
        assertEquals("纯文本", OcrResult.lines("{\"content\":\"纯文本\"}", "纯文本"));
        assertEquals("", OcrResult.lines(null, null));
    }

    @Test
    void blankBlocksAreSkipped() {
        String raw = "{\"subImages\":[{\"blockInfo\":{\"blockDetails\":[{\"blockContent\":\" \"},{\"blockContent\":\"有字\"}]}}]}";
        assertEquals("有字", OcrResult.lines(raw, "有字"));
    }

    @Test
    void explorerWordExportKeepsEachLineSeparate() {
        String markdown = FileOcrService.toMarkdown(OcrResult.lines(RAW, "ignored"));
        assertEquals("股权转让协议\\\n协议编号：XQ\\-2026\\-0815\\\n签署地：江州市临川区", markdown);
    }
}
