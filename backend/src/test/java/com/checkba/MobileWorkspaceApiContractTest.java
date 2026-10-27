// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.report.*;
import com.checkba.controller.AuthController;
import com.checkba.service.ai.ChatModelFactory;
import com.checkba.service.ai.tools.WebTools;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import java.time.Instant;
import java.util.*;
import static com.atlassian.oai.validator.mockmvc.OpenApiValidationMatchers.openApi;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:mobile-workspace-api;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "security.local-mode=false","mobile.calendar.apns.enabled=false","storage.local.root-path=${java.io.tmpdir}/mobile-workspace-api-store"})
@AutoConfigureMockMvc
@ActiveProfiles("desktop")
class MobileWorkspaceApiContractTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @MockBean WebTools webTools;
    @MockBean CloudStorageQuotaService quota;
    @MockBean ChatModelFactory models;
    static OpenApiInteractionValidator validator;
    @BeforeAll static void spec() throws Exception {
        String spec=new String(MobileWorkspaceApiContractTest.class.getResourceAsStream("/openapi/mobile-v1.yaml").readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
        validator=OpenApiInteractionValidator.createForInlineApiSpecification(spec).withLevelResolver(LevelResolver.create()
                .withLevel("validation.request",ValidationReport.Level.IGNORE)
                .withLevel("validation.request.path.missing",ValidationReport.Level.ERROR).build()).build();
    }
    @BeforeEach void setup() {
        when(quota.persistentQuota(anyLong())).thenReturn(1000L);
        var model=mock(ChatLanguageModel.class);
        when(model.generate(anyList(),anyList())).thenReturn(Response.from(AiMessage.from("Synthetic response without external calls.")));
        when(model.generate(any(dev.langchain4j.data.message.ChatMessage[].class))).thenReturn(Response.from(AiMessage.from("Synthetic project summary.")));
        when(models.getPlatformChatModel(any(),any())).thenReturn(new ChatModelFactory.PlatformChatModel(model,"synthetic-model"));
    }
    String register() throws Exception {
        String name="workspace_"+UUID.randomUUID();
        var result=mvc.perform(post("/api/auth/register").contentType(APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username",name,"password","fixture12345","displayName","Synthetic user"))))
                .andExpect(status().isOk()).andReturn();
        String sid=json.readTree(result.getResponse().getContentAsString()).path("data").path("sessionId").asText();
        assertFalse(sid.isBlank());return sid;
    }
    ResultActions put(String path,String sid,Object body) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(path).header("X-Session-Id",sid)
                .contentType(APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().isOk()).andExpect(openApi().isValid(validator));
    }
    @Test void calendarConsentSnapshotIsolationAndRevocationUseRealAuthAndPersistence() throws Exception {
        String sid=register(),other=register(),device=UUID.randomUUID().toString();
        put("/api/mobile/projects",sid,Map.of("deviceId",device,"deviceName","Synthetic desktop","projects",List.of(Map.of("key","42","name","Fixture project"))));
        put("/api/mobile/calendar/settings",sid,Map.of("enabled",true,"consentVersion","2026-10-27"))
                .andExpect(jsonPath("$.data.enabled").value(true));
        var task=Map.of("projectKey","42","taskId","7","title","Synthetic hearing","dueDate","2026-11-02","dueTime","09:00","status","OPEN","remindBefore",60);
        put("/api/mobile/calendar/snapshots",sid,Map.of("deviceId",device,"timeZone","Asia/Shanghai","sourceUpdatedAt",Instant.now().toString(),"events",List.of(task)))
                .andExpect(jsonPath("$.data.accepted").value(true));
        mvc.perform(get("/api/mobile/calendar/events").header("X-Session-Id",sid)).andExpect(openApi().isValid(validator))
                .andExpect(jsonPath("$.data.events[0].remindAt").value("2026-11-02T00:00:00Z"));
        mvc.perform(get("/api/mobile/calendar/events").header("X-Session-Id",other)).andExpect(openApi().isValid(validator))
                .andExpect(jsonPath("$.data.events").isEmpty());
        put("/api/mobile/calendar/settings",sid,Map.of("enabled",false,"consentVersion","2026-10-27"));
        mvc.perform(get("/api/mobile/calendar/events").header("X-Session-Id",sid)).andExpect(openApi().isValid(validator))
                .andExpect(jsonPath("$.data.events").isEmpty());
        mvc.perform(get("/api/mobile/calendar/push/status").header("X-Session-Id",sid)).andExpect(openApi().isValid(validator))
                .andExpect(jsonPath("$.data.available").value(false));
    }
    @Test void assistantReturnsTypedStatusHistoryAndIdempotentChatWithoutProjectSelection() throws Exception {
        String sid=register(),request=UUID.randomUUID().toString(),device=UUID.randomUUID().toString();
        put("/api/mobile/backup-consent",sid,Map.of("enabled",true,"consentVersion","2026-10-11"));
        put("/api/mobile/assistant/settings",sid,Map.of("enabled",true,"consentVersion","2026-10-27"))
                .andExpect(jsonPath("$.data.enabled").value(true));
        put("/api/mobile/projects",sid,Map.of("deviceId",device,"deviceName","Synthetic desktop","projects",List.of(Map.of("key","42","name","Fixture project"))));
        put("/api/mobile/assistant/snapshots",sid,Map.of("deviceId",device,"projectKey","42","projectName","Fixture project",
                "sourceUpdatedAt",Instant.now().toString(),"context","Synthetic client and upcoming preparation task."))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.sources[0].readForSummary").value(true));
        var response=mvc.perform(post("/api/mobile/assistant/chat").header("X-Session-Id",sid).contentType(APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("requestId",request,"message","What should I prepare?"))))
                .andExpect(openApi().isValid(validator)).andExpect(jsonPath("$.data.status").value("completed")).andReturn();
        String conversation=json.readTree(response.getResponse().getContentAsString()).path("data").path("conversationId").asText();
        mvc.perform(get("/api/mobile/assistant/requests/"+request).header("X-Session-Id",sid)).andExpect(openApi().isValid(validator))
                .andExpect(jsonPath("$.data.answer").value("Synthetic response without external calls."));
        mvc.perform(get("/api/mobile/assistant/conversations/"+conversation).header("X-Session-Id",sid)).andExpect(openApi().isValid(validator))
                .andExpect(jsonPath("$.data.messages.length()").value(2));
        mvc.perform(get("/api/mobile/assistant/summaries").header("X-Session-Id",sid)).andExpect(openApi().isValid(validator))
                .andExpect(jsonPath("$.data.length()").value(1)).andExpect(jsonPath("$.data[0].sources[0].id").value("context"));
        put("/api/mobile/assistant/settings",sid,Map.of("enabled",false,"consentVersion","2026-10-27"));
        mvc.perform(get("/api/mobile/assistant/conversations/"+conversation).header("X-Session-Id",sid)).andExpect(openApi().isValid(validator))
                .andExpect(jsonPath("$.code").value(1));
        assertNotNull(AuthController.getUserIdFromSession(sid));
    }
    @Test void unauthorizedRoutesNeverExposeUserData() throws Exception {
        for(String path:List.of("/api/mobile/calendar/events","/api/mobile/calendar/settings","/api/mobile/calendar/push/status",
                "/api/mobile/assistant/status","/api/mobile/assistant/summaries","/api/mobile/assistant/requests/"+UUID.randomUUID()))
            mvc.perform(get(path)).andExpect(openApi().isValid(validator)).andExpect(jsonPath("$.code").value(4010));
    }
}
