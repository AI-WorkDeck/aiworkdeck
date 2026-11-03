// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.checkba.controller.AuthController;
import com.checkba.controller.MobileAssistantDesktopCopyController;
import com.checkba.config.GlobalExceptionHandler;
import com.checkba.service.mobile.MobileAssistantDesktopCopyService;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import static com.atlassian.oai.validator.mockmvc.OpenApiValidationMatchers.openApi;
import static org.mockito.Mockito.*;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class MobileAssistantDesktopCopyContractTest {
    @Test void isolatedRoutesMatchOpenApiAndNeverExposeSnapshotInReceipts() throws Exception {
        var mapper=JsonMapper.builder().addModule(new JavaTimeModule()).disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
        String spec=new String(getClass().getResourceAsStream("/openapi/mobile-v1.yaml").readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
        var validator=OpenApiInteractionValidator.createForInlineApiSpecification(spec).build();
        var service=mock(MobileAssistantDesktopCopyService.class);
        var mvc=MockMvcBuilders.standaloneSetup(new MobileAssistantDesktopCopyController(service))
                .setControllerAdvice(new GlobalExceptionHandler()).setMessageConverters(new MappingJackson2HttpMessageConverter(mapper)).build();
        String request=UUID.randomUUID().toString(),source=UUID.randomUUID().toString(),target=UUID.randomUUID().toString(),conversation=UUID.randomUUID().toString();
        var body=new MobileAssistantDesktopCopyService.Request(request,target,"desktop","7");
        var receipt=new MobileAssistantDesktopCopyService.Receipt(request,"QUEUED",true,false,source,conversation,target,"desktop","7",410,Instant.now().plusSeconds(86400),null,null);
        var envelope=new MobileAssistantDesktopCopyService.Envelope(request,conversation,target,"desktop","7","{}","a".repeat(64),410,receipt.expiresAt());
        when(service.create(1L,source,body)).thenReturn(receipt);when(service.get(1L,request)).thenReturn(receipt);
        when(service.history(1L,source)).thenReturn(List.of(receipt));when(service.pending(1L,"desktop")).thenReturn(List.of(envelope));
        var ack=new MobileAssistantDesktopCopyService.Ack("desktop",target,"a".repeat(64),"DELIVERED",null);
        when(service.ack(1L,request,ack)).thenReturn(receipt);
        try(var auth=mockStatic(AuthController.class)) {
            auth.when(()->AuthController.getUserIdFromSession(null)).thenReturn(null);
            auth.when(()->AuthController.getUserIdFromSession("synthetic")).thenReturn(1L);
            mvc.perform(post("/api/mobile/assistant/conversations/"+source+"/copy-to-desktop").header("X-Session-Id","synthetic").contentType(APPLICATION_JSON).content(mapper.writeValueAsString(body)))
                    .andExpect(openApi().isValid(validator)).andExpect(jsonPath("$.data.status").value("QUEUED")).andExpect(jsonPath("$.data.snapshotJson").doesNotExist());
            mvc.perform(get("/api/mobile/assistant/desktop-copies/"+request).header("X-Session-Id","synthetic"))
                    .andExpect(openApi().isValid(validator)).andExpect(jsonPath("$.data.snapshotJson").doesNotExist());
            mvc.perform(get("/api/mobile/assistant/conversations/"+source+"/desktop-copies").header("X-Session-Id","synthetic"))
                    .andExpect(openApi().isValid(validator)).andExpect(jsonPath("$.data[0].snapshotJson").doesNotExist());
            mvc.perform(get("/api/mobile/assistant/desktop-copies/pending").param("deviceId","desktop").header("X-Session-Id","synthetic"))
                    .andExpect(openApi().isValid(validator)).andExpect(jsonPath("$.data[0].messageCount").value(410));
            mvc.perform(post("/api/mobile/assistant/desktop-copies/"+request+"/ack").header("X-Session-Id","synthetic").contentType(APPLICATION_JSON).content(mapper.writeValueAsString(ack)))
                    .andExpect(openApi().isValid(validator));
            mvc.perform(get("/api/mobile/assistant/desktop-copies/"+request))
                    .andExpect(openApi().isValid(validator)).andExpect(jsonPath("$.code").value(4010));
        }
    }
}
