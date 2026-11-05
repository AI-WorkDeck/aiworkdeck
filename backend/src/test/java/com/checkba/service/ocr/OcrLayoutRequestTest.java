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
import org.mockito.ArgumentCaptor;

import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** layout=true asks both tiers for coordinates/stamps/tables/paragraphs; the default request is unchanged. */
class OcrLayoutRequestTest {

    @SuppressWarnings("unchecked")
    private Map<String, Object> platformParams(boolean layout, boolean useOverload) {
        PlatformGatewayClient gateway = mock(PlatformGatewayClient.class);
        ExternalProviderResolver resolver = mock(ExternalProviderResolver.class);
        when(resolver.resolve(any())).thenReturn(ExternalServiceProvider.PLATFORM);
        var data = new ObjectMapper().createObjectNode().put("content", "x").put("raw", "");
        when(gateway.call(anyString(), anyString(), anyMap(), anyInt()))
                .thenReturn(new PlatformGatewayClient.Result(data, 10, 1, "page"));
        OcrService service = new OcrService(mock(SystemSettingService.class), resolver, gateway);
        String image = Base64.getEncoder().encodeToString(new byte[]{1, 2, 3});
        if (useOverload) service.recognizeGeneral(image, layout); else service.recognizeGeneral(image);
        ArgumentCaptor<Map<String, Object>> params = ArgumentCaptor.forClass(Map.class);
        verify(gateway, times(1)).call(eq("ocr"), eq("recognize"), params.capture(), anyInt());
        return params.getValue();
    }

    @Test
    void platformTierSendsLayoutFlagOnlyWhenAsked() {
        assertEquals(Boolean.TRUE, platformParams(true, true).get("layout"));
        assertFalse(platformParams(false, true).containsKey("layout"), "plain request stays byte-identical");
        assertFalse(platformParams(false, false).containsKey("layout"));
    }

    @Test
    void byokRequestEnablesTheSameFourOutputsAsTheGateway() {
        var plain = AliyunOcrClient.buildRequest(new ByteArrayInputStream(new byte[0]), false);
        assertEquals("Advanced", plain.getType());
        assertNull(plain.getOutputCoordinate());
        assertNull(plain.getAdvancedConfig());

        var rich = AliyunOcrClient.buildRequest(new ByteArrayInputStream(new byte[0]), true);
        assertEquals("Advanced", rich.getType());
        assertEquals("points", rich.getOutputCoordinate());
        assertEquals(Boolean.TRUE, rich.getOutputStamp());
        assertEquals(Boolean.TRUE, rich.getAdvancedConfig().getOutputTable());
        assertEquals(Boolean.TRUE, rich.getAdvancedConfig().getOutputParagraph());
    }
}
