// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.contractreview;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.service.ai.*;
import com.checkba.service.contractreview.ContractReviewViews.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.model.output.FinishReason;
import org.junit.jupiter.api.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.support.TransactionCallback;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ContractReviewServiceTest {
    ContractReviewStandardRepository standards = mock(ContractReviewStandardRepository.class);
    ContractReviewRunRepository runs = mock(ContractReviewRunRepository.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectRepository projects = mock(ProjectRepository.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    ProjectFileAccessService acl = mock(ProjectFileAccessService.class);
    DocumentTextService texts = mock(DocumentTextService.class);
    ChatModelFactory models = mock(ChatModelFactory.class);
    AuxModelResolver aux = mock(AuxModelResolver.class);
    TokenUsageService usage = mock(TokenUsageService.class);
    ChatLanguageModel model = mock(ChatLanguageModel.class);
    ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    TransactionTemplate tx = mock(TransactionTemplate.class);
    ContractReviewService service;
    ContractReviewStandard standard;
    ProjectFile file;
    ContractReviewRun savedRun;
    static final String TEXT = "甲方应于签约后十日内支付价款。";
    static final String VALID = "{\"results\":[{\"ruleId\":\"pay\",\"status\":\"PASS\",\"quote\":\"十日内支付价款\",\"reason\":\"符合十日付款要求\",\"suggestion\":\"\"}]}";

    @BeforeEach void setup() throws Exception {
        when(tx.execute(any())).thenAnswer(i -> ((TransactionCallback<?>) i.getArgument(0)).doInTransaction(null));
        doAnswer(i -> { ((Consumer<?>) i.getArgument(0)).accept(null); return null; }).when(tx).executeWithoutResult(any());
        when(members.hasReadPermission(1L, 2L)).thenReturn(true);
        when(members.hasWritePermission(1L, 2L)).thenReturn(true);
        when(projects.lockForImWrite(1L)).thenReturn(Optional.of(new Project()));
        standard = new ContractReviewStandard(); standard.setId(4L); standard.setProjectId(1L);
        standard.setName("付款标准"); standard.setVersion(1); standard.setConfirmedVersion(1L);
        standard.setRulesJson(mapper.writeValueAsString(List.of(new Rule("pay", "付款期限", "十日内付款"))));
        when(standards.lockInProject(4L, 1L)).thenReturn(Optional.of(standard));
        when(standards.saveAndFlush(any())).thenAnswer(i -> i.getArgument(0));
        file = new ProjectFile(); file.setId(3L); file.setProjectId(1L); file.setName("合同.docx");
        when(files.findById(3L)).thenReturn(Optional.of(file));
        when(texts.extractText(file)).thenReturn(TEXT);
        when(aux.auxModelId()).thenReturn("test-model");
        when(models.getAuxChatModel(any())).thenReturn(model);
        when(model.generate(anyList())).thenAnswer(i -> {
            assertEquals(2L, PlatformAiUserScope.current());
            return Response.from(AiMessage.from(VALID));
        });
        when(runs.saveAndFlush(any())).thenAnswer(i -> { savedRun = i.getArgument(0); savedRun.setId(7L); return savedRun; });
        service = new ContractReviewService(standards, runs, files, projects, members, acl, texts, models, aux, usage, mapper, tx);
    }
    @AfterEach void close() { service.close(); }

    @Test void confirmedStandardProducesPersistentTraceableResultsAndDetectsChangedDocument() throws Exception {
        RunView result = service.run(2L, 1L, new StartRun(3L, 4L, 1));
        assertEquals("DONE", result.status()); assertEquals("PASS", result.results().get(0).status());
        assertEquals("pay", result.results().get(0).ruleId()); assertEquals(1, result.standard().version());
        assertEquals(64, result.documentHash().length()); assertFalse(result.stale());
        assertNotNull(savedRun); verify(models).ensurePaidAccess(2L); verify(acl, atLeastOnce()).requireRead(file, 2L);
        when(runs.findFirstByProjectIdAndDocFileIdOrderByIdDesc(1L, 3L)).thenReturn(Optional.of(savedRun));
        when(texts.extractText(file)).thenReturn(TEXT + "修改后的正文");
        assertTrue(service.latest(2L, 1L, 3L).stale());
        assertNull(PlatformAiUserScope.current());
    }

    @Test void editsInvalidateConfirmationAndRejectOldSaveOrRunVersions() {
        StandardView edited = service.save(2L, 1L, new SaveStandard(4L, 1L, "新标准", "甲方", "中国法",
                List.of(new Rule("pay", "付款期限", "五日内付款"))));
        assertEquals(2, edited.version()); assertNull(edited.confirmedVersion());
        assertThrows(IllegalArgumentException.class, () -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
        assertThrows(IllegalArgumentException.class, () -> service.run(2L, 1L, new StartRun(3L, 4L, 2)));
        assertThrows(IllegalArgumentException.class, () -> service.confirm(2L, 1L, 4L, 1));
        assertThrows(IllegalArgumentException.class, () -> service.save(2L, 1L,
                new SaveStandard(4L, 1L, "旧覆盖", "", "", List.of(new Rule("pay", "付款", "十日")))));
        assertEquals(2L, service.confirm(2L, 1L, 4L, 2).confirmedVersion());
        verifyNoInteractions(model);
    }

    @Test void deniesReadOnlyWriteCrossProjectIdsAndFileAcl() {
        when(members.hasWritePermission(1L, 2L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
        when(members.hasWritePermission(1L, 2L)).thenReturn(true);
        assertThrows(IllegalArgumentException.class, () -> service.run(2L, 1L, new StartRun(3L, 99L, 1)));
        file.setProjectId(99L);
        assertThrows(IllegalArgumentException.class, () -> service.latest(2L, 1L, 3L));
        file.setProjectId(1L);
        doThrow(new ProjectFileAccessService.FileAccessDeniedException()).when(acl).requireRead(file, 2L);
        assertThrows(IllegalArgumentException.class, () -> service.latest(2L, 1L, 3L));
        assertThrows(IllegalArgumentException.class, () -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
        verifyNoInteractions(model, runs);
    }

    @Test void modelFailureIsPersistedAsFailedWithEveryRuleUnreviewedAndReleasesSingleFlight() {
        doThrow(new RuntimeException("private upstream payload")).when(model).generate(anyList());
        RunView result = service.run(2L, 1L, new StartRun(3L, 4L, 1));
        assertEquals("FAILED", result.status()); assertEquals("UNREVIEWED", result.results().get(0).status());
        assertFalse(result.error().contains("private")); assertNotNull(savedRun);
        assertDoesNotThrow(() -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
    }

    @Test void truncatedModelResponseCannotPassEvenWhenJsonLooksComplete() {
        doReturn(Response.from(AiMessage.from(VALID), null, FinishReason.LENGTH)).when(model).generate(anyList());
        RunView result = service.run(2L, 1L, new StartRun(3L, 4L, 1));
        assertEquals("PARTIAL", result.status()); assertEquals("UNREVIEWED", result.results().get(0).status());
    }

    @Test void missingPositionOrJurisdictionIsRejected() {
        for (SaveStandard body : List.of(
                new SaveStandard(null, null, "标准", "", "中国法", List.of(new Rule("pay", "付款", "十日"))),
                new SaveStandard(null, null, "标准", "甲方", "", List.of(new Rule("pay", "付款", "十日"))))) {
            assertThrows(IllegalArgumentException.class, () -> service.save(2L, 1L, body));
        }
        verify(standards, never()).saveAndFlush(any());
    }

    @Test void accountAndCreditsFailuresKeepTheirStructuredExceptionsAfterRecordingFailedRun() {
        for (RuntimeException failure : List.of(
                new com.checkba.service.account.AccountException(
                        com.checkba.service.account.AccountException.Kind.NOT_CONNECTED, "请连接账户"),
                new com.checkba.service.platform.GatewayException(
                        com.checkba.service.platform.GatewayException.Kind.NO_CREDITS, "额度不足"))) {
            doThrow(failure).when(models).ensurePaidAccess(2L);
            RuntimeException received = assertThrows(RuntimeException.class,
                    () -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
            assertSame(failure, received);
            assertEquals("FAILED", savedRun.getStatus());
        }
        verifyNoInteractions(model);
    }

    @Test void oversizedDocumentIsRejectedWithoutPaidCall() throws Exception {
        when(texts.extractText(file)).thenReturn("字".repeat(60_001));
        assertThrows(IllegalArgumentException.class, () -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
        verifyNoInteractions(models, runs);
    }

    @Test void revocationDuringModelCallPreventsSavingSensitiveResult() {
        doAnswer(i -> {
            when(members.hasWritePermission(1L, 2L)).thenReturn(false);
            return Response.from(AiMessage.from(VALID));
        }).when(model).generate(anyList());
        assertThrows(IllegalArgumentException.class, () -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
        verifyNoInteractions(runs);
    }

    @Test void concurrentSameDocumentIsRejectedUntilFirstRunFinishes() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        doAnswer(i -> {
            entered.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS));
            return Response.from(AiMessage.from(VALID));
        }).when(model).generate(anyList());
        ExecutorService caller = Executors.newSingleThreadExecutor();
        try {
            Future<RunView> first = caller.submit(() -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            assertThrows(IllegalArgumentException.class, () -> service.run(2L, 1L, new StartRun(3L, 4L, 1)));
            release.countDown(); assertEquals("DONE", first.get(5, TimeUnit.SECONDS).status());
        } finally { release.countDown(); caller.shutdownNow(); }
    }
}
