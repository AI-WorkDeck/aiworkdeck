// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.writing;

import com.checkba.service.ai.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.data.message.*;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.output.*;
import okhttp3.Call;
import org.junit.jupiter.api.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static com.checkba.service.writing.WritingTypes.*;
import static com.checkba.service.writing.WritingContextService.*;
import static com.checkba.service.writing.WritingSuggestionService.*;

class WritingSuggestionServiceTest {
    WritingContextService contexts=mock(WritingContextService.class);
    ChatModelFactory models=mock(ChatModelFactory.class);
    TokenUsageService usage=mock(TokenUsageService.class);
    OpenRouterStreamingChatModel model=mock(OpenRouterStreamingChatModel.class);
    Call call=mock(Call.class);
    ObjectMapper json=new ObjectMapper();
    WritingSuggestionService service;
    AtomicReference<StreamingResponseHandler<AiMessage>> handler=new AtomicReference<>(), proofHandler=new AtomicReference<>(), valueHandler=new AtomicReference<>();
    Snapshot snapshot;
    @BeforeEach void setup() {
        service=new WritingSuggestionService(contexts,models,usage,json);
        snapshot=snapshot(new LitigationWritingProfile(),"原告：沈望舒\n被告：顾青原","被告：顾","");
        when(contexts.capture(eq(1L),eq(10L),any())).thenAnswer(i -> snapshot);
        when(models.getWritingModel(any())).thenReturn(model); when(models.getAutomaticWritingModel(any(),anyBoolean())).thenReturn(model); when(model.modelName()).thenReturn("synthetic-model");
        doAnswer(i -> {captureHandler(i.getArgument(0),i.getArgument(2)); return call;}).when(model).generateCancellable(anyList(),anyInt(),any());
    }
    @AfterEach void close() { service.close(); }
    Snapshot snapshot(WritingProfile profile,String body,String before,String selection) {
        String section=profile.id().equals("contract")?"正文":"事实与理由";
        Context c=new Context(profile.id(),profile.label(),section,before,"","原告","");
        Source source=new Source("active-document",100L,"合成文书","v1","当前文档",body);
        Request r=new Request(100L,"r1",body,before,"",selection,profile.label(),section,profile.id(),List.of());
        return new Snapshot(10L,1L,r,new Settings("原告","",List.of()),c,profile,List.of(source),profile.facts(c,List.of(source)),List.of());
    }
    View start(String mode) { return service.start(1L,10L,new Input(mode,snapshot.request())); }
    Fact defendant() { return snapshot.facts().stream().filter(f -> f.role().equals("被告")).findFirst().orElseThrow(); }
    String result(String text,String kind,Fact f) throws Exception {
        return json.writeValueAsString(Map.of("suggestions",List.of(new Advice(text,kind,List.of(f.id()),List.of(f.sourceId()),"材料所载"))));
    }
    void captureHandler(List<ChatMessage> messages,StreamingResponseHandler<AiMessage> h) throws Exception {
        var input=json.readTree(((UserMessage)messages.get(1)).singleText());
        if(input.has("candidate") && input.has("scopedFacts")) valueHandler.set(h);
        else if(input.has("candidate") && !input.has("facts")) proofHandler.set(h);
        else handler.set(h);
    }
    boolean grammarInput(List<ChatMessage> messages) {
        try {
            var input=json.readTree(((UserMessage)messages.get(1)).singleText());
            return input.has("candidate") && !input.has("facts") && !input.has("scopedFacts");
        } catch(Exception e) { throw new AssertionError(e); }
    }
    void complete(String raw) { (raw.contains("\"correctedText\"") || raw.contains("\"error\"") ? proofHandler : handler).get().onComplete(Response.from(AiMessage.from(raw),new TokenUsage(20,10))); }
    @Test void localCompletionNeverRequestsModelOrRecordsTokens() {
        View v=start("local"); assertEquals("READY",v.status()); assertEquals("青原",v.advice().get(0).text());
        verifyNoInteractions(models,usage);
    }
    @Test void contractAndDiligenceActualAdviceKindsRemainUsable() {
        Snapshot contract=snapshot(new ContractWritingProfile(),"甲方：北京澄屿设备有限公司\n乙方：杭州禾序商贸有限公司","甲方：北京","");
        var a=contract.profile().deterministic(contract.context(),contract.facts()); assertFalse(a.isEmpty());
        assertTrue(valid(contract,a.get(0),2000));
        Snapshot diligence=snapshot(new DiligenceWritingProfile(),"标的公司：北京澄屿设备有限公司","标的公司：北京","");
        var b=diligence.profile().deterministic(diligence.context(),diligence.facts()); assertFalse(b.isEmpty());
        assertTrue(valid(diligence,b.get(0),2000));
    }
    @Test void numericSuffixMustBeCheckedTogetherWithTypedPrefix() {
        Snapshot s=snapshot(new LitigationWritingProfile(),"借款本金：人民币360000元","借款本金：人民币36","");
        Advice a=s.profile().deterministic(s.context(),s.facts()).get(0);
        assertEquals("0000元",a.text()); assertTrue(valid(s,a,2000));
    }
    @Test void moneyUnitCannotInflateSupportedNumber() {
        Snapshot s=snapshot(new LitigationWritingProfile(),"借款本金：人民币360000元","",""); Fact f=s.facts().get(0);
        Advice a=new Advice("借款本金为人民币360000万元。","sentence",List.of(f.id()),List.of(f.sourceId()),"");
        assertFalse(valid(s,a,2000));
    }
    @Test void moneyUnitOnlySuffixCannotInflateTypedNumber() {
        Snapshot s=snapshot(new LitigationWritingProfile(),"借款本金：人民币360000元","借款本金：人民币360000",""); Fact f=s.facts().get(0);
        assertFalse(valid(s,new Advice("万元","fact",List.of(f.id()),List.of(f.sourceId()),""),2000));
        assertTrue(valid(s,new Advice("元","fact",List.of(f.id()),List.of(f.sourceId()),""),2000));
    }
    @Test void numberCannotSilentlyChangeCurrencySignOrDateUnit() {
        Snapshot s=snapshot(new LitigationWritingProfile(),"借款本金：人民币360000元\n借款日期：2025年4月8日","","");
        Fact money=s.facts().get(0), date=s.facts().get(1);
        for(String text:List.of("360000美元","-360000元","三十六万元")) assertFalse(valid(s,new Advice(text,"fact",List.of(money.id()),List.of(money.sourceId()),""),2000));
        assertFalse(valid(s,new Advice("2025年8月4日","fact",List.of(date.id()),List.of(date.sourceId()),""),2000));
    }
    @Test void existingButUnrelatedSourceCannotBeUsedAsDecorativeCitation() {
        Fact f=defendant(); var sources=new ArrayList<>(snapshot.sources()); sources.add(new Source("unrelated",101L,"其他材料","v1","第1页","无关材料"));
        Snapshot s=new Snapshot(snapshot.projectId(),snapshot.userId(),snapshot.request(),snapshot.settings(),snapshot.context(),snapshot.profile(),sources,snapshot.facts(),List.of());
        assertFalse(valid(s,new Advice("青原","entity",List.of(f.id()),List.of(f.sourceId(),"unrelated"),""),2000));
    }
    @Test void unknownFactsUnsupportedNumbersAndMissingSourcesAreRejected() throws Exception {
        Fact f=defendant();
        assertTrue(service.parse(snapshot,result("顾青原支付999元","sentence",f),"sentence").isEmpty());
        assertTrue(service.parse(snapshot,"{\"suggestions\":[{\"text\":\"顾青原\",\"kind\":\"sentence\",\"factIds\":[\"invented\"],\"sourceIds\":[\"active-document\"]}]}","sentence").isEmpty());
        assertFalse(valid(snapshot,new Advice("顾青原","entity",List.of(f.id()),List.of(),""),2000));
    }
    @Test void malformedAndTooManySuggestionsAreNotDisplayed() throws Exception {
        assertTrue(service.parse(snapshot,"{\"suggestions\":{}}","sentence").isEmpty());
        assertTrue(service.parse(snapshot,"{\"suggestions\":[{},{},{}]}","sentence").isEmpty());
        assertThrows(Exception.class, () -> service.parse(snapshot,"not-json","sentence"));
    }
    @Test void cancelledJobCannotResurrectWhenLateCompletionArrives() throws Exception {
        View v=start("sentence"); service.cancel(1L,10L,v.id());
        complete(result("青原","sentence",defendant()));
        View after=service.get(1L,10L,v.id()); assertEquals("CANCELLED",after.status()); assertTrue(after.advice().isEmpty());
        verify(call).cancel(); verify(usage).recordUsage(eq(10L),eq(1L),eq("synthetic-model"),any(),isNull());
    }
    @Test void requestAndCallbackUseCorrectUserScopeAndRestoreOuterScope() throws Exception {
        when(models.getWritingModel(any())).thenAnswer(i -> { assertEquals(1L,PlatformAiUserScope.current()); return model; });
        doAnswer(i -> {assertEquals(1L,PlatformAiUserScope.current()); return null;}).when(usage).recordUsage(any(),any(),any(),any(),any());
        PlatformAiUserScope.run(7L,() -> { start("sentence"); assertEquals(7L,PlatformAiUserScope.current()); });
        String raw=result("青原","sentence",defendant());
        CompletableFuture.runAsync(() -> { assertNull(PlatformAiUserScope.current()); complete(raw); assertNull(PlatformAiUserScope.current()); }).get(3,TimeUnit.SECONDS);
    }
    @Test void crossUserAndCrossProjectGetCancelAcceptAreForbidden() {
        View v=start("local");
        assertThrows(IllegalArgumentException.class,()->service.get(2L,10L,v.id()));
        assertThrows(IllegalArgumentException.class,()->service.cancel(1L,20L,v.id()));
        assertThrows(IllegalArgumentException.class,()->service.accept(2L,10L,v.id(),new Accept(0,"r1")));
    }
    @Test void revokedAccessOrStaleContextCannotAuthorizeInsertion() {
        View v=start("local"); doThrow(new IllegalArgumentException("stale")).when(contexts).revalidate(snapshot,"r2");
        assertThrows(IllegalArgumentException.class,()->service.accept(1L,10L,v.id(),new Accept(0,"r2")));
        assertEquals("READY",service.get(1L,10L,v.id()).status());
        doThrow(new IllegalArgumentException("revoked")).when(contexts).require(1L,10L,false);
        assertThrows(IllegalArgumentException.class,()->service.get(1L,10L,v.id()));
    }
    @Test void acceptanceIsSingleUseAndReturnsOriginalSnapshotRevision() {
        View v=start("local"); Accepted accepted=service.accept(1L,10L,v.id(),new Accept(0,"r1"));
        assertEquals("青原",accepted.text()); assertEquals("r1",accepted.revision()); assertEquals("",accepted.selection());
        assertThrows(IllegalArgumentException.class,()->service.accept(1L,10L,v.id(),new Accept(0,"r1")));
    }
    @Test void selectedTextRequiresRewriteModeBeforeModelAdmission() {
        snapshot=snapshot(new LitigationWritingProfile(),"被告：顾青原","被告：","顾青原");
        assertThrows(IllegalArgumentException.class,()->start("sentence")); verifyNoInteractions(models);
        snapshot=snapshot(new LitigationWritingProfile(),"被告：顾青原","被告：","");
        assertThrows(IllegalArgumentException.class,()->start("rewrite")); verifyNoInteractions(models);
    }
    @Test void rewriteAcceptanceReturnsExactOriginalSelection() throws Exception {
        snapshot=snapshot(new LitigationWritingProfile(),"被告：顾青原","被告：","顾青原");
        View v=start("rewrite"); complete(result("顾青原","rewrite",defendant()));
        assertEquals("顾青原",service.accept(1L,10L,v.id(),new Accept(0,"r1")).selection());
    }
    @Test void perMinuteQuotaStopsThirteenthModelRequest() {
        for(int i=0;i<12;i++) start("sentence");
        assertThrows(IllegalArgumentException.class,()->start("sentence")); verify(models,times(12)).getWritingModel(any());
        assertEquals("READY",start("local").status());
    }
    @Test void cancellationBeforeCallHandleAssignmentStillCancelsTransportWithoutDeadlock() throws Exception {
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        doAnswer(i -> { entered.countDown(); assertTrue(release.await(3,TimeUnit.SECONDS)); return call; }).when(model).generateCancellable(anyList(),anyInt(),any());
        var pending=CompletableFuture.supplyAsync(()->start("sentence")); assertTrue(entered.await(2,TimeUnit.SECONDS));
        View local=start("local"); assertEquals("READY",local.status()); release.countDown();
        assertEquals("CANCELLED",pending.get(3,TimeUnit.SECONDS).status()); verify(call).cancel();
    }
    @Test void oversizedStreamFailsAndCancelsEvenBeforeCallHandleAssigned() {
        doAnswer(i -> { StreamingResponseHandler<AiMessage> h=i.getArgument(2); h.onNext("x".repeat(16001)); return call; }).when(model).generateCancellable(anyList(),anyInt(),any());
        assertEquals("FAILED",start("sentence").status()); verify(call).cancel();
    }
    @Test void usageStorageFailureSettlesJobInsteadOfLeavingItRunning() throws Exception {
        View v=start("sentence");
        doThrow(new IllegalStateException("synthetic database failure")).when(usage).recordUsage(any(),any(),any(),any(),any());
        String raw=result("青原","sentence",defendant()); assertDoesNotThrow(()->complete(raw));
        View done=service.get(1L,10L,v.id()); assertEquals("FAILED",done.status()); assertEquals("reporting_failed",done.usageStatus());
        assertFalse(done.error().contains("database"));
    }
    @Test void oneUserRetainsEightRecentJobsAndCanKeepUsingLocalCompletion() {
        List<View> views=new ArrayList<>(); for(int i=0;i<140;i++) views.add(start("local"));
        for(int i=0;i<132;i++) { String id=views.get(i).id(); assertThrows(IllegalArgumentException.class,()->service.get(1L,10L,id)); }
        for(int i=132;i<139;i++) assertEquals("CANCELLED",service.get(1L,10L,views.get(i).id()).status());
        assertEquals("READY",service.get(1L,10L,views.get(139).id()).status());
        assertThrows(IllegalArgumentException.class,()->service.accept(1L,10L,views.get(138).id(),new Accept(0,"r1")));
    }
    Snapshot forUser(long uid) {
        return new Snapshot(snapshot.projectId(),uid,snapshot.request(),snapshot.settings(),snapshot.context(),snapshot.profile(),snapshot.sources(),snapshot.facts(),snapshot.warnings());
    }
    @Test void fullHistoryEvictsOldestFinishedJobInsteadOfBlockingAllUsers() {
        when(contexts.capture(anyLong(),eq(10L),any())).thenAnswer(i -> forUser(i.getArgument(0)));
        List<View> views=new ArrayList<>();
        for(long uid=1;uid<=128;uid++) views.add(service.start(uid,10L,new Input("local",snapshot.request())));
        View next=service.start(129L,10L,new Input("local",snapshot.request())); assertEquals("READY",next.status());
        assertThrows(IllegalArgumentException.class,()->service.get(1L,10L,views.get(0).id()));
        assertEquals("READY",service.get(2L,10L,views.get(1).id()).status());
    }
    @Test void sixteenActuallyRunningUsersBlockNewUserButAllowOwnReplacement() {
        when(contexts.capture(anyLong(),eq(10L),any())).thenAnswer(i -> forUser(i.getArgument(0)));
        for(long uid=1;uid<=16;uid++) service.start(uid,10L,new Input("sentence",snapshot.request()));
        assertThrows(IllegalArgumentException.class,()->service.start(17L,10L,new Input("sentence",snapshot.request())));
        assertEquals("RUNNING",service.start(1L,10L,new Input("sentence",snapshot.request())).status());
        verify(models,times(17)).getWritingModel(any());
    }
    @Test void cancellationDuringFactorySetupDoesNotStartPaidHttpCall() throws Exception {
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        when(models.getWritingModel(any())).thenAnswer(i -> { entered.countDown(); assertTrue(release.await(3,TimeUnit.SECONDS)); return model; });
        var pending=CompletableFuture.supplyAsync(()->start("sentence")); assertTrue(entered.await(2,TimeUnit.SECONDS));
        assertEquals("READY",start("local").status()); release.countDown();
        assertEquals("CANCELLED",pending.get(3,TimeUnit.SECONDS).status());
        verify(model,never()).generateCancellable(anyList(),anyInt(),any());
    }
    @Test void nullProviderCompletionCannotLeaveRequestRunning() {
        View v=start("sentence"); assertDoesNotThrow(()->handler.get().onComplete(null));
        assertEquals("FAILED",service.get(1L,10L,v.id()).status());
        assertEquals("pending_or_unreported",service.get(1L,10L,v.id()).usageStatus());
        verifyNoInteractions(usage);
    }
    @Test void emptyResponseStillRecordsKnownUsageUnderCorrectUser() {
        View v=start("sentence");
        doAnswer(i -> {assertEquals(1L,PlatformAiUserScope.current()); return null;}).when(usage).recordUsage(any(),any(),any(),any(),any());
        handler.get().onError(new OpenRouterStreamingChatModel.EmptyResponseException(new TokenUsage(10,256)));
        View failed=service.get(1L,10L,v.id()); assertEquals("FAILED",failed.status());
        assertEquals("reported",failed.usageStatus()); assertEquals(256,failed.outputTokens());
    }
    @Test void explicitEmptyPartyFieldUsesKnownBindingWithoutPaidGeneration() {
        snapshot=snapshot(new LitigationWritingProfile(),"原告：沈望舒\n被告：顾青原","原告：","");
        View v=start("sentence"); assertEquals("READY",v.status()); assertEquals("沈望舒",v.advice().get(0).text());
        assertEquals("not_requested",v.usageStatus()); verifyNoInteractions(models,usage);
    }
    @Test void singleJsonFenceIsParsedButSentenceCannotAddAnotherPartyLine() throws Exception {
        Fact f=defendant();
        assertEquals(1,service.parse(snapshot,"```json\n"+result("青原","sentence",f)+"\n```","sentence").size());
        assertTrue(service.parse(snapshot,result("青原\n原告：沈望舒","sentence",f),"sentence").isEmpty());
    }
    @Test void paragraphCannotBeJustANameFragment() throws Exception {
        assertTrue(service.parse(snapshot,result("顾青原","paragraph",defendant()),"paragraph").isEmpty());
    }

    @Test void parserCannotSilentlyIgnoreSecondJsonObjectOrFence() throws Exception {
        String valid=result("青原","sentence",defendant());
        assertThrows(Exception.class, () -> service.parse(snapshot,valid+" {}","sentence"));
        assertThrows(Exception.class, () -> service.parse(snapshot,"```json\n"+valid+"\n```\n```json\n{}\n```","sentence"));
    }
    @Test void companyNameWithFullStopIsStillNotAParagraph() throws Exception {
        snapshot=snapshot(new LitigationWritingProfile(),"被告：北京澄屿设备股份有限公司","","");
        assertTrue(service.parse(snapshot,result("北京澄屿设备股份有限公司。","paragraph",defendant()),"paragraph").isEmpty());
    }

    @Test void shortPromptReferencesResolveToRealFactsAndUnknownAliasesStayRejected() throws Exception {
        AtomicReference<String> prompt=new AtomicReference<>();
        doAnswer(invocation -> {
            List<ChatMessage> messages=invocation.getArgument(0); prompt.set(((UserMessage)messages.get(1)).singleText()); return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        start("sentence");
        var facts=json.readTree(prompt.get()).path("facts");
        String alias="";
        for(var fact:facts) if(fact.path("role").asText().equals("被告")) alias=fact.path("id").asText();
        assertTrue(alias.matches("F[0-9]+")); assertFalse(prompt.get().contains(defendant().id()));
        String raw=json.writeValueAsString(Map.of("suggestions",List.of(new Advice("青原","sentence",List.of(alias),List.of("active-document"),"材料所载"))));
        assertEquals(List.of(defendant().id()),service.parse(snapshot,raw,"sentence").get(0).factIds());
        assertTrue(service.parse(snapshot,raw.replace("\""+alias+"\"","\"F9999\""),"sentence").isEmpty());
    }

    @Test void excludedRawSourceParagraphCannotReenterModelPrompt() {
        Snapshot original=snapshot;
        Source source=new Source("active-document",100L,"合成文书","v1","正文",original.sources().get(0).text()+"\n不应进入模型的旧附件定义：测试代号旧蓝图。");
        snapshot=new Snapshot(original.projectId(),original.userId(),original.request(),original.settings(),original.context(),original.profile(),List.of(source),original.facts(),List.of());
        AtomicReference<String> prompt=new AtomicReference<>();
        doAnswer(invocation -> {
            List<ChatMessage> messages=invocation.getArgument(0); prompt.set(((UserMessage)messages.get(1)).singleText()); return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        start("sentence");
        assertTrue(prompt.get().contains("原告：沈望舒")); assertFalse(prompt.get().contains("旧蓝图"));
    }


    Snapshot reportSnapshot() {
        var profile=new AutomaticWritingProfile();
        String body="平台按照事项集中展示项目材料，委员可以按事项查阅材料并办理相关工作。";
        return snapshot(profile,body,"平台集中整理了相关项目材料，","");
    }
    String automaticResult(Snapshot s,String text) throws Exception {
        Fact fact=s.facts().get(0);
        return json.writeValueAsString(Map.of("abstain",false,"usefulness","completes_current_thought","evidence","direct_support",
                "suggestions",List.of(new Advice(text,"sentence",List.of(fact.id()),List.of(fact.sourceId()),"沿用文中按事项查阅办理的用途"))));
    }
    String approvedReview(Snapshot s,String candidate,String reason) throws Exception {
        return json.writeValueAsString(Map.of("approve",true,"counterexamplePossible",false,"counterexample","","reason",reason,
                "reviewedText",s.context().before()+candidate+s.context().after(),
                "supportedText",s.context().before()+candidate+s.context().after()));
    }
    String approvedValue(Snapshot s,String candidate) throws Exception {
        return json.writeValueAsString(Map.of("approve",true,"reason","有依据地自然补完当前句，不要求新观点",
                "reviewedText",s.context().before()+candidate+s.context().after()));
    }
    void completeValue(Snapshot s,String candidate) throws Exception {
        valueHandler.get().onComplete(Response.from(AiMessage.from(approvedValue(s,candidate)),new TokenUsage(20,10)));
    }
    String unchangedProofread(Snapshot s,String candidate) throws Exception {
        return json.writeValueAsString(Map.of("correctedText",s.context().before()+candidate+s.context().after(),"error",""));
    }
    void completeApprovedThenProofread(Snapshot s,String candidate,String reason) throws Exception {
        complete(approvedReview(s,candidate,reason));
        complete(unchangedProofread(s,candidate));
        completeValue(s,candidate);
    }
    @Test void automaticReportUsesRealModelPathAndGenericFallbackThenExistingAcceptance() throws Exception {
        Snapshot report=reportSnapshot();
        snapshot=new Snapshot(report.projectId(),report.userId(),report.request(),report.settings(),report.context(),null,report.sources(),List.of(),List.of());
        View running=start("autocomplete");
        assertEquals("RUNNING",running.status()); assertEquals("general",running.profile());
        verify(models).getAutomaticWritingModel(argThat(d -> !d.isNegative() && !d.isZero() && d.toMillis()<=30000),eq(false));
        verify(model).generateCancellable(anyList(),eq(4096),any());
        complete(automaticResult(report,"便于委员按事项查阅和办理。"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        verify(model,times(4)).generateCancellable(anyList(),eq(4096),any());
        completeApprovedThenProofread(report,"便于委员按事项查阅和办理。","承接材料按事项办理的既有用途，没有增加事实或责任");
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status()); assertEquals(1,done.advice().size());
        assertEquals("便于委员按事项查阅和办理。",service.accept(1L,10L,running.id(),new Accept(0,"r1")).text());
        verify(usage,times(4)).recordUsage(eq(10L),eq(1L),eq("synthetic-model"),any(),isNull());
        verify(model).generateCancellable(argThat(this::grammarInput),eq(4096),any());
        assertEquals(80,done.inputTokens()); assertEquals(40,done.outputTokens()); assertEquals("reported",done.usageStatus());
    }
    @Test void automaticReadyOmitsUnreviewedExplanationButKeepsInternalCandidateAndCitations() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        String unreviewed="原文明确证明了这项安排带来的全部成效。";
        var generation=json.readTree(automaticResult(snapshot,candidate));
        ((com.fasterxml.jackson.databind.node.ObjectNode)generation.path("suggestions").get(0)).put("explanation",unreviewed);
        String raw=json.writeValueAsString(generation);
        Advice internal=service.parse(snapshot,raw,"autocomplete").get(0);
        assertEquals(unreviewed,internal.explanation(),"Generation parsing must not change the internal candidate");
        View running=start("autocomplete"); complete(raw);
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        completeApprovedThenProofread(snapshot,candidate,"候选正文有直接依据");
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(1,done.advice().size()); Advice displayed=done.advice().get(0);
        assertEquals("",displayed.explanation(),"Unreviewed generator explanation must not reach the user");
        assertEquals(candidate,displayed.text()); assertEquals(internal.kind(),displayed.kind());
        assertEquals(internal.factIds(),displayed.factIds()); assertEquals(internal.sourceIds(),displayed.sourceIds());
        verify(model,times(4)).generateCancellable(anyList(),eq(4096),any());
    }
    @Test void manualReadyKeepsItsExistingExplanation() throws Exception {
        View running=start("sentence"); complete(result("青原","sentence",defendant()));
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals("青原",done.advice().get(0).text()); assertEquals("材料所载",done.advice().get(0).explanation());
        verify(model,times(1)).generateCancellable(anyList(),anyInt(),any());
    }
    @Test void automaticAbstentionAndMissingQualityFieldsAreEmptyWithoutLocalFallback() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        complete("{\"abstain\":true,\"suggestions\":[]}");
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        Fact fact=snapshot.facts().get(0);
        assertTrue(service.parse(snapshot,result("便于委员按事项查阅和办理。","sentence",fact),"autocomplete").isEmpty());
        String valid=automaticResult(snapshot,"便于委员按事项查阅和办理。");
        assertTrue(service.parse(snapshot,valid.replace("direct_support","speculative"),"autocomplete").isEmpty());
        assertTrue(service.parse(snapshot,valid.replace("completes_current_thought","generic_filler"),"autocomplete").isEmpty());
        verify(model,times(1)).generateCancellable(anyList(),anyInt(),any());
    }
    @Test void automaticQualityChecksRejectUnsupportedNumbersObligationsClaimsAndEchoes() throws Exception {
        snapshot=reportSnapshot();
        for(String text:List.of("便于全部84名委员查阅和办理。","委员必须负责完成全部事项。","项目已经通过全部验收。",
                "平台集中整理了相关项目材料，便于查阅。","好。","便于委员查阅。\n并且办理。"))
            assertTrue(service.parse(snapshot,automaticResult(snapshot,text),"autocomplete").isEmpty(),text);
        String valid=automaticResult(snapshot,"便于委员按事项查阅和办理。");
        var tree=json.readTree(valid); ((com.fasterxml.jackson.databind.node.ArrayNode)tree.path("suggestions")).add(tree.path("suggestions").get(0).deepCopy());
        assertTrue(service.parse(snapshot,json.writeValueAsString(tree),"autocomplete").isEmpty());
        assertTrue(service.parse(snapshot,valid.replace(snapshot.facts().get(0).id(),"unknown-fact"),"autocomplete").isEmpty());
    }
    @Test void automaticSuggestionsDoNotRepeatExistingFollowingText() throws Exception {
        Snapshot report=reportSnapshot(); String after="便于委员按事项查阅和办理。";
        Context c=new Context("general",report.context().title(),report.context().section(),report.context().before(),after,"","");
        snapshot=new Snapshot(report.projectId(),report.userId(),report.request(),report.settings(),c,report.profile(),report.sources(),report.facts(),List.of());
        assertTrue(service.parse(snapshot,automaticResult(snapshot,after),"autocomplete").isEmpty());
    }
    @Test void automaticDoesNotCancelExplicitRunningOrReadyJobs() throws Exception {
        snapshot=reportSnapshot(); View explicit=start("sentence");
        assertEquals("EMPTY",start("autocomplete").status());
        assertEquals("RUNNING",service.get(1L,10L,explicit.id()).status()); verify(call,never()).cancel();
        complete(result("便于委员按事项查阅和办理。","sentence",snapshot.facts().get(0)));
        assertEquals("READY",service.get(1L,10L,explicit.id()).status());
        assertEquals("EMPTY",start("autocomplete").status()); verify(call,never()).cancel();
        verify(model,times(1)).generateCancellable(anyList(),anyInt(),any());
    }
    @Test void automaticIdleRequestsAreThrottledEvenWhenThePreviousOneWasCancelled() {
        snapshot=reportSnapshot(); View first=start("autocomplete");
        service.cancel(1L,10L,first.id());
        assertEquals("EMPTY",start("autocomplete").status());
        Snapshot old=snapshot; Context changed=new Context("general",old.context().title(),old.context().section(),"平台进一步集中整理相关项目材料，","","","");
        snapshot=new Snapshot(old.projectId(),old.userId(),old.request(),old.settings(),changed,old.profile(),old.sources(),old.facts(),List.of());
        assertEquals("EMPTY",start("autocomplete").status());
        verify(model,times(1)).generateCancellable(anyList(),anyInt(),any());
    }
    @Test void explicitRequestCanReplaceAutomaticAndLateResponseCannotResurrectIt() throws Exception {
        snapshot=reportSnapshot(); View automatic=start("autocomplete"); var automaticHandler=handler.get();
        View explicit=start("sentence"); verify(call).cancel();
        automaticHandler.onComplete(Response.from(AiMessage.from(automaticResult(snapshot,"便于委员按事项查阅和办理。")),new TokenUsage(20,10)));
        assertEquals("CANCELLED",service.get(1L,10L,automatic.id()).status());
        assertEquals("RUNNING",service.get(1L,10L,explicit.id()).status());
    }
    @Test void automaticNeedsEnoughCurrentContextAndUsableEvidenceBeforeRequestingModel() {
        snapshot=snapshot(new AutomaticWritingProfile(),"平台按照事项整理材料，委员可按事项查阅。","平台","");
        assertEquals("EMPTY",start("autocomplete").status());
        snapshot=snapshot(new AutomaticWritingProfile(),"短文","本次需要集中整理相关项目材料，","");
        assertEquals("EMPTY",start("autocomplete").status());
        verifyNoInteractions(models,usage);
    }


    @Test void shortCompleteSourceSentencesReachAutomaticModelContext() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"工作记录\n报名信息通过问卷收集。\n出席信息通过现场签到收集。",
                "报名与出席信息均有记录，这两类信息的收集方式分别是", "");
        AtomicReference<String> prompt=new AtomicReference<>();
        doAnswer(invocation -> {
            List<ChatMessage> messages=invocation.getArgument(0);
            prompt.set(((UserMessage)messages.get(1)).singleText());
            captureHandler(messages,invocation.getArgument(2)); return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        assertEquals("RUNNING",start("autocomplete").status());
        var input=json.readTree(prompt.get());
        assertEquals(2,input.path("facts").size());
        assertTrue(input.path("facts").get(0).path("quote").asText().endsWith("报名信息通过问卷收集。"));
        assertTrue(input.path("sources").get(0).path("text").asText().contains("报名信息通过问卷收集。"));
    }
    @Test void automaticCanNaturallyCompleteTheSentenceWithExistingSourceWording() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"申报材料包括申请表和说明文件。","依照现有材料清单，本次需要提交的文件包括", "");
        String candidate="申请表和说明文件。";
        assertTrue(snapshot.sources().get(0).text().contains(candidate));
        assertEquals(1,service.parse(snapshot,automaticResult(snapshot,candidate),"autocomplete").size(),
                "材料已写明不等于光标处没有补全价值；保留事实及自然度审读");
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        completeApprovedThenProofread(snapshot,candidate,"既有清单直接支持当前句的宾语");
        assertEquals("READY",service.get(1L,10L,running.id()).status());
    }
    @Test void nonAdjacentFollowingPhraseCanBeTheNaturalCompletion() throws Exception {
        Snapshot base=snapshot(new AutomaticWritingProfile(),"甲类申请的处理结果为待补充材料。乙类申请的处理结果也为待补充材料。",
                "当前甲类申请的处理结果为", "");
        Context c=new Context("general",base.context().title(),base.context().section(),base.context().before(),
                "，乙类申请的处理结果也为待补充材料。","","");
        snapshot=new Snapshot(base.projectId(),base.userId(),base.request(),base.settings(),c,base.profile(),base.sources(),base.facts(),List.of());
        String candidate="待补充材料";
        assertEquals(1,service.parse(snapshot,automaticResult(snapshot,candidate),"autocomplete").size());
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        completeApprovedThenProofread(snapshot,candidate,"两类分别陈述同一结果，非相邻重复有必要");
        assertEquals("READY",service.get(1L,10L,running.id()).status());
    }
    @Test void completeReviewsAcceptLegalLongContextWithoutResponseLengthCollision() throws Exception {
        Snapshot base=reportSnapshot();
        String before="这是已经存在的背景文字。".repeat(155)+base.context().before();
        String after="\n"+"这是另一段既有背景文字。".repeat(155);
        assertTrue(before.length()<=2000 && after.length()<=2000);
        Context c=new Context("general",base.context().title(),base.context().section(),before,after,"","");
        snapshot=new Snapshot(base.projectId(),base.userId(),base.request(),base.settings(),c,base.profile(),base.sources(),base.facts(),List.of());
        String candidate="便于委员按事项查阅和办理。";
        assertTrue(approvedReview(snapshot,candidate,"当前候选有直接依据").length()>4096);
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        completeApprovedThenProofread(snapshot,candidate,"当前候选有直接依据");
        assertEquals("READY",service.get(1L,10L,running.id()).status());
    }
    @Test void factEditorsCorrectionsOrMissingEditedTextNeverReachTheDocument() throws Exception {
        for(int variant=0;variant<4;variant++) {
            snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request()));
                complete(automaticResult(snapshot,candidate));
                var review=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(approvedReview(snapshot,candidate,"核对依据"));
                if(variant==0) review.put("supportedText",snapshot.context().before()+"可查阅材料。");
                if(variant==1) review.remove("supportedText");
                if(variant==2) review.put("supportedText",true);
                if(variant==3) review.put("supportedText","");
                complete(json.writeValueAsString(review));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
                assertTrue(s.get(1L,10L,running.id()).advice().isEmpty(),"修正版不能绕过生成或自动插入");
            } finally { s.close(); }
        }
    }
    @Test void approvalCannotOverrideCounterexampleOrMissingCounterexampleVerdict() throws Exception {
        for(int variant=0;variant<4;variant++) {
            snapshot=reportSnapshot();
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request()));
                complete(automaticResult(snapshot,"便于委员按事项查阅和办理。"));
                var review=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(approvedReview(snapshot,"便于委员按事项查阅和办理。","有依据"));
                if(variant==0) review.put("counterexamplePossible",true);
                if(variant==1) review.put("counterexample","此前采用同一流程，工作量没有变化");
                if(variant==2) review.remove("counterexamplePossible");
                if(variant==3) review.put("counterexamplePossible","false");
                complete(json.writeValueAsString(review));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
            } finally { s.close(); }
        }
    }
    @Test void shortGenericFillerIsJudgedBySemanticReviewNotLengthAlone() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        complete(automaticResult(snapshot,"便于查阅。"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        complete("{\"approve\":false,\"reason\":\"只是泛化重复前文，没有实际写作价值\"}");
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
    }
    @Test void conciseSemanticDimensionsStillRequireReviewAndCanBeAccepted() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"材料核对检查申请材料是否齐全。\n内容审查核实提交内容是否真实。",
                "材料核对与内容审查是不同的工作环节。两道程序分别关注申请材料的", "");
        String text="齐全性和真实性";
        Advice advice=new Advice(text,"sentence",snapshot.facts().stream().map(Fact::id).toList(),List.of("active-document"),"概括不同审查维度");
        String raw=json.writeValueAsString(Map.of("abstain",false,"usefulness","completes_current_thought","evidence","direct_support","suggestions",List.of(advice)));
        View running=start("autocomplete"); complete(raw);
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        completeApprovedThenProofread(snapshot,text,"两项概念均由材料支持，接缝通顺");
        assertEquals(List.of(new Advice(text,"sentence",advice.factIds(),advice.sourceIds(),"")),service.get(1L,10L,running.id()).advice());
    }
    @Test void automaticAllowsSemanticIntegrationAndDoesNotRejectSharedShortConnectives() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),
                "与此同时，资料检索和事项办理集中在同一入口。\n报名申请与活动通知分别使用独立页面。",
                "就现阶段各项功能的使用方式而言，","");
        assertEquals(2,snapshot.facts().size());
        String text="与此同时，统一入口与独立页面两种方式并存。";
        Advice advice=new Advice(text,"sentence",snapshot.facts().stream().map(Fact::id).toList(),
                List.of("active-document"),"整合材料中两组功能的不同入口，承接对使用方式的概括。");
        String raw=json.writeValueAsString(Map.of("abstain",false,"usefulness","completes_current_thought",
                "evidence","direct_support","suggestions",List.of(advice)));
        assertFalse(snapshot.sources().get(0).text().contains(text));
        assertEquals(List.of(advice),service.parse(snapshot,raw,"autocomplete"));
        View running=start("autocomplete"); complete(raw);
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        completeApprovedThenProofread(snapshot,text,"整合两组功能的入口差异，没有增加事实或改变语气");
        View done=service.get(1L,10L,running.id());
        assertEquals("READY",done.status()); assertEquals(List.of(new Advice(text,"sentence",advice.factIds(),advice.sourceIds(),"")),done.advice());
        assertEquals(80,done.inputTokens()); assertEquals(40,done.outputTokens());
    }


    @Test void independentReviewRejectsChangedModalityWithoutRetry() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"线上可以提交资料，现场办理可以当面核对材料。","就两种业务办理方式的区别而言，","");
        AtomicReference<String> reviewInput=new AtomicReference<>();
        doAnswer(i -> {
            List<ChatMessage> messages=i.getArgument(0); captureHandler(i.getArgument(0),i.getArgument(2));
            if(json.readTree(((UserMessage)messages.get(1)).singleText()).has("candidate") && json.readTree(((UserMessage)messages.get(1)).singleText()).has("facts")) {
                reviewInput.set(((UserMessage)messages.get(1)).singleText());
            }
            return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); complete(automaticResult(snapshot,"后者需要当面核对材料。"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        var input=json.readTree(reviewInput.get());
        assertEquals(snapshot.context().before(),input.path("before").asText());
        assertEquals("后者需要当面核对材料。",input.path("candidate").asText());
        assertEquals(snapshot.context().before()+"后者需要当面核对材料。"+snapshot.context().after(),input.path("assembledText").asText());
        assertEquals(snapshot.facts().get(0).quote(),input.path("facts").get(0).path("quote").asText());
        complete("{\"approve\":false,\"reason\":\"原文仅表示可以，候选改成需要，增强了模态强度\"}");
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        verify(model,times(4)).generateCancellable(anyList(),anyInt(),any());
        verify(usage,times(2)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void independentReviewRejectsUnsupportedCausalConsequence() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"成员信息分散保存在不同材料中。","从目前的成员信息管理情况来看，","");
        View running=start("autocomplete"); complete(automaticResult(snapshot,"增加了逐项核对的工作量。"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        complete("{\"approve\":false,\"reason\":\"材料分散并未直接说明核对工作量增加\"}");
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        verify(model,times(4)).generateCancellable(anyList(),anyInt(),any());
    }
    @Test void valueSeesUncitedScopedFactsButFactReviewNeverSeesThemOrExcludedRawSource() throws Exception {
        String conclusion="当前材料已明确支持委员按事项查阅并办理相关工作。";
        Snapshot original=snapshot(new AutomaticWritingProfile(),reportSnapshot().sources().get(0).text()+"\n"+conclusion,
                "平台集中整理了相关项目材料，","");
        Source originalSource=original.sources().get(0);
        Source source=new Source(originalSource.id(),originalSource.fileId(),originalSource.name(),originalSource.version(),
                originalSource.locator(),originalSource.text()+"\n不应进入模型的旧附件定义：测试代号旧蓝图。");
        snapshot=new Snapshot(original.projectId(),original.userId(),original.request(),original.settings(),original.context(),
                original.profile(),List.of(source),original.facts(),original.warnings());
        assertEquals(2,snapshot.facts().size());
        AtomicReference<String> reviewInput=new AtomicReference<>(), factInput=new AtomicReference<>();
        doAnswer(invocation -> {
            captureHandler(invocation.getArgument(0),invocation.getArgument(2));
            List<ChatMessage> messages=invocation.getArgument(0);
            String input=((UserMessage)messages.get(1)).singleText();
            if(json.readTree(input).has("candidate") && json.readTree(input).has("scopedFacts")) reviewInput.set(input);
            if(json.readTree(input).has("candidate") && json.readTree(input).has("facts")) factInput.set(input);
            return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); complete(automaticResult(snapshot,"便于委员按事项查阅和办理。"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        var input=json.readTree(reviewInput.get());
        assertFalse(input.has("facts"));
        assertEquals(json.valueToTree(List.of(snapshot.facts().get(0))),json.readTree(factInput.get()).path("facts"));
        assertFalse(json.readTree(factInput.get()).has("scopedFacts"));
        assertFalse(factInput.get().contains(conclusion)); assertFalse(factInput.get().contains("旧蓝图"));
        assertEquals(json.valueToTree(snapshot.facts()),input.path("scopedFacts"));
        assertEquals(conclusion,input.path("scopedFacts").get(1).path("quote").asText());
        assertFalse(input.has("sources")); assertFalse(reviewInput.get().contains("旧蓝图"));
        service.cancel(1L,10L,running.id());
    }
    @Test void malformedReviewAndNonBooleanApprovalCannotReleaseSuggestion() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        complete(automaticResult(snapshot,"便于委员按事项查阅和办理。"));
        complete(json.writeValueAsString(Map.of("approve","true","counterexamplePossible",false,"counterexample","","reason","看起来可以",
                "reviewedText",snapshot.context().before()+"便于委员按事项查阅和办理。"+snapshot.context().after())));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
    }
    @Test void approvalWithoutReviewedTextCannotReleaseSuggestion() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        complete(automaticResult(snapshot,"便于委员按事项查阅和办理。"));
        complete("{\"approve\":true,\"reason\":\"有直接依据\"}");
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
    }
    @Test void approvalThatRewritesTypedPrefixCannotReleaseSuggestion() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        String candidate="便于委员按事项查阅和办理。";
        complete(automaticResult(snapshot,candidate));
        complete(json.writeValueAsString(Map.of("approve",true,"counterexamplePossible",false,"counterexample","","reason","改写前文后通顺",
                "reviewedText","平台应该集中整理相关项目材料，"+candidate+snapshot.context().after())));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
    }
    @Test void approvalOfExactAssembledTextReleasesOriginalCandidate() throws Exception {
        Snapshot base=reportSnapshot(); Context c=base.context(); Request r=base.request();
        String after="下一节介绍活动安排。";
        snapshot=new Snapshot(base.projectId(),base.userId(),
                new Request(r.fileId(),r.revision(),r.documentText(),r.before(),after,r.selection(),r.title(),r.section(),r.documentType(),r.sourceFileIds()),
                base.settings(),new Context(c.documentType(),c.title(),c.section(),c.before(),after,c.stance(),c.cutoffDate()),
                base.profile(),base.sources(),base.facts(),base.warnings());
        View running=start("autocomplete");
        String candidate="便于委员按事项查阅和办理。";
        complete(automaticResult(snapshot,candidate));
        completeApprovedThenProofread(snapshot,candidate,"拼接全文自然，事实和语气保持一致");
        View done=service.get(1L,10L,running.id());
        assertEquals("READY",done.status()); assertEquals(candidate,done.advice().get(0).text());
    }
    @Test void synchronousGenerationDoesNotOverwriteReviewCallAndCancellationBlocksLateApproval() throws Exception {
        snapshot=reportSnapshot(); Call generationCall=mock(Call.class),reviewCall=mock(Call.class);
        AtomicReference<StreamingResponseHandler<AiMessage>> reviewer=new AtomicReference<>();
        doAnswer(i -> {
            StreamingResponseHandler<AiMessage> h=i.getArgument(2);
            List<ChatMessage> messages=i.getArgument(0);
            if(grammarInput(i.getArgument(0))) { proofHandler.set(h); return call; }
            if(!json.readTree(((UserMessage)messages.get(1)).singleText()).has("candidate")) {
                h.onComplete(Response.from(AiMessage.from(automaticResult(snapshot,"便于委员按事项查阅和办理。")),new TokenUsage(20,10)));
                return generationCall;
            }
            if(json.readTree(((UserMessage)messages.get(1)).singleText()).has("scopedFacts")) { valueHandler.set(h); return call; }
            reviewer.set(h); return reviewCall;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); assertEquals("RUNNING",running.status());
        service.cancel(1L,10L,running.id()); verify(reviewCall).cancel();
        reviewer.get().onComplete(Response.from(AiMessage.from(approvedReview(snapshot,"便于委员按事项查阅和办理。","有直接依据")),new TokenUsage(8,4)));
        View cancelled=service.get(1L,10L,running.id());
        assertEquals("CANCELLED",cancelled.status()); assertTrue(cancelled.advice().isEmpty());
        assertEquals(28,cancelled.inputTokens()); assertEquals(14,cancelled.outputTokens());
        verify(usage,times(2)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void missingReviewUsageRetainsKnownGenerationUsageAsPartialRatherThanZero() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        complete(automaticResult(snapshot,"便于委员按事项查阅和办理。"));
        handler.get().onComplete(Response.from(AiMessage.from(approvedReview(snapshot,"便于委员按事项查阅和办理。","有直接依据"))));
        complete(unchangedProofread(snapshot,"便于委员按事项查阅和办理。"));
        completeValue(snapshot,"便于委员按事项查阅和办理。");
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(60,done.inputTokens()); assertEquals(30,done.outputTokens());
        assertEquals("partial_or_unreported",done.usageStatus());
        verify(usage,times(3)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void missingGenerationUsageDoesNotTurnReviewUsageIntoCompleteTotal() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        handler.get().onComplete(Response.from(AiMessage.from(automaticResult(snapshot,"便于委员按事项查阅和办理。"))));
        completeApprovedThenProofread(snapshot,"便于委员按事项查阅和办理。","有直接依据");
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(60,done.inputTokens()); assertEquals(30,done.outputTokens());
        assertEquals("partial_or_unreported",done.usageStatus());
        verify(usage,times(3)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void reviewUsesRemainingSharedBudgetAndDuplicateCallbackIsNotDoubleCharged() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        var generator=handler.get(); String generated=automaticResult(snapshot,"便于委员按事项查阅和办理。");
        complete(generated); var reviewer=handler.get();
        generator.onComplete(Response.from(AiMessage.from(generated),new TokenUsage(20,10)));
        var budgets=org.mockito.ArgumentCaptor.forClass(Duration.class);
        verify(models,times(4)).getAutomaticWritingModel(budgets.capture(),anyBoolean());
        assertTrue(budgets.getAllValues().get(0).toMillis()<=30000);
        assertTrue(budgets.getAllValues().get(1).toMillis()<=budgets.getAllValues().get(0).toMillis());
        reviewer.onError(new OpenRouterStreamingChatModel.EmptyResponseException(new TokenUsage(8,4)));
        View done=service.get(1L,10L,running.id()); assertEquals("EMPTY",done.status());
        assertEquals(28,done.inputTokens()); assertEquals(14,done.outputTokens());
        verify(usage,times(2)).recordUsage(any(),any(),any(),any(),any());
    }


    @Test void proofreadingReceivesInsertionBoundariesWithoutFactsAndUsesRemainingBudget() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        AtomicReference<List<ChatMessage>> proofMessages=new AtomicReference<>();
        doAnswer(i -> {
            captureHandler(i.getArgument(0),i.getArgument(2));
            if(grammarInput(i.getArgument(0))) proofMessages.set(i.getArgument(0));
            return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        complete(approvedReview(snapshot,candidate,"有直接依据"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        List<ChatMessage> messages=proofMessages.get(); assertEquals(2,messages.size());
        var input=json.readTree(((UserMessage)messages.get(1)).singleText());
        assertEquals(snapshot.context().before()+candidate+snapshot.context().after(),input.path("assembledText").asText());
        assertEquals(snapshot.context().before(),input.path("before").asText());
        assertEquals(candidate,input.path("candidate").asText());
        assertEquals(snapshot.context().after(),input.path("after").asText());
        assertFalse(input.has("facts")); assertFalse(input.has("scopedFacts"));
        assertTrue(((SystemMessage)messages.get(0)).text().contains("中文语法校对员"));
        var budgets=org.mockito.ArgumentCaptor.forClass(Duration.class);
        var reviewing=org.mockito.ArgumentCaptor.forClass(Boolean.class);
        verify(models,times(4)).getAutomaticWritingModel(budgets.capture(),reviewing.capture());
        assertEquals(List.of(false,true,true,true),reviewing.getAllValues());
        for(int i=0;i<4;i++) {
            assertTrue(budgets.getAllValues().get(i).toMillis()>0 && budgets.getAllValues().get(i).toMillis()<=30000);
            if(i>0) assertTrue(budgets.getAllValues().get(i).compareTo(budgets.getAllValues().get(i-1))<=0);
        }
        complete(unchangedProofread(snapshot,candidate));
        completeValue(snapshot,candidate);
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(80,done.inputTokens()); assertEquals(40,done.outputTokens());
        assertEquals("reported",done.usageStatus()); verify(usage,times(4)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void proofreadingChangesErrorsAndMissingFieldsCannotReleaseSuggestion() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(int variant=0;variant<6;variant++) {
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request()));
                complete(automaticResult(snapshot,candidate)); complete(approvedReview(snapshot,candidate,"有直接依据"));
                assertEquals("RUNNING",s.get(1L,10L,running.id()).status());
                var proof=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(unchangedProofread(snapshot,candidate));
                if(variant==0) proof.put("correctedText","平台集中整理相关材料，"+candidate);
                if(variant==1) proof.put("error","主语与谓语搭配不当");
                if(variant==2) proof.remove("correctedText");
                if(variant==3) proof.remove("error");
                if(variant==4) proof.put("error",false);
                complete(json.writeValueAsString(proof)+(variant==5?" {}":""));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
                assertTrue(s.get(1L,10L,running.id()).advice().isEmpty());
            } finally { s.close(); }
        }
        verify(model,times(6)).generateCancellable(argThat(this::grammarInput),eq(4096),any());
    }
    @Test void synchronousEarlierStagesCannotOverwriteProofreadingCallAndLateResultCannotReviveCancelledJob() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        Call generation=mock(Call.class),review=mock(Call.class),proof=mock(Call.class);
        AtomicInteger stage=new AtomicInteger(); AtomicReference<StreamingResponseHandler<AiMessage>> proofreader=new AtomicReference<>();
        doAnswer(i -> {
            StreamingResponseHandler<AiMessage> h=i.getArgument(2);
            int current=stage.getAndIncrement();
            if(current<2) {
                h.onComplete(Response.from(AiMessage.from(current==0?automaticResult(snapshot,candidate)
                        :approvedReview(snapshot,candidate,"有直接依据")),new TokenUsage(20,10)));
                return current==0?generation:review;
            }
            if(current==3) { valueHandler.set(h); return call; }
            proofreader.set(h); return proof;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); assertEquals("RUNNING",running.status()); assertEquals(4,stage.get());
        service.cancel(1L,10L,running.id()); verify(proof).cancel();
        proofreader.get().onComplete(Response.from(AiMessage.from(unchangedProofread(snapshot,candidate)),new TokenUsage(8,4)));
        View cancelled=service.get(1L,10L,running.id());
        assertEquals("CANCELLED",cancelled.status()); assertTrue(cancelled.advice().isEmpty());
        assertEquals(48,cancelled.inputTokens()); assertEquals(24,cancelled.outputTokens());
        verify(usage,times(3)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void missingProofreadingUsageDoesNotTurnKnownStagesIntoCompleteTotal() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        complete(approvedReview(snapshot,candidate,"有直接依据"));
        proofHandler.get().onComplete(Response.from(AiMessage.from(unchangedProofread(snapshot,candidate))));
        completeValue(snapshot,"便于委员按事项查阅和办理。");
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(60,done.inputTokens()); assertEquals(30,done.outputTokens());
        assertEquals("partial_or_unreported",done.usageStatus());
        verify(usage,times(3)).recordUsage(any(),any(),any(),any(),any());
    }

    @Test void parallelReviewNeedsAllThreeApprovalsInEveryCompletionOrder() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(List<Integer> order:List.of(List.of(0,1,2),List.of(0,2,1),List.of(1,0,2),List.of(1,2,0),List.of(2,0,1),List.of(2,1,0))) {
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request()));
                complete(automaticResult(snapshot,candidate));
                var handlers=List.of(handler.get(),proofHandler.get(),valueHandler.get());
                var replies=List.of(approvedReview(snapshot,candidate,"有直接依据"),unchangedProofread(snapshot,candidate),approvedValue(snapshot,candidate));
                for(int i=0;i<3;i++) {
                    int phase=order.get(i);
                    handlers.get(phase).onComplete(Response.from(AiMessage.from(replies.get(phase)),new TokenUsage(8,4)));
                    assertEquals(i==2?"READY":"RUNNING",s.get(1L,10L,running.id()).status());
                }
                View done=s.get(1L,10L,running.id());
                assertEquals(44,done.inputTokens()); assertEquals(22,done.outputTokens()); assertEquals("reported",done.usageStatus());
                for(int phase=0;phase<3;phase++) {
                    handlers.get(phase).onComplete(Response.from(AiMessage.from(replies.get(phase)),new TokenUsage(8,4)));
                    handlers.get(phase).onError(new IllegalStateException("duplicate terminal callback"));
                }
                assertEquals(44,s.get(1L,10L,running.id()).inputTokens());
                assertEquals("READY",s.get(1L,10L,running.id()).status());
            } finally { s.close(); }
        }
        verify(usage,times(24)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void rejectingAnyParallelBranchCancelsOthersButLateUsageIsRecordedOnce() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(int rejectingPhase=0;rejectingPhase<3;rejectingPhase++) {
            List<Call> calls=List.of(mock(Call.class),mock(Call.class),mock(Call.class));
            doAnswer(i -> {
                List<ChatMessage> messages=i.getArgument(0); captureHandler(messages,i.getArgument(2));
                var input=json.readTree(((UserMessage)messages.get(1)).singleText());
                return input.has("scopedFacts")?calls.get(2):input.has("candidate") && !input.has("facts")?calls.get(1):calls.get(0);
            }).when(model).generateCancellable(anyList(),anyInt(),any());
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request()));
                complete(automaticResult(snapshot,candidate));
                var handlers=List.of(handler.get(),proofHandler.get(),valueHandler.get());
                var replies=List.of(approvedReview(snapshot,candidate,"有直接依据"),unchangedProofread(snapshot,candidate),approvedValue(snapshot,candidate));
                var rejection=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(replies.get(rejectingPhase));
                if(rejectingPhase==1) rejection.put("error","接缝搭配不当");
                else { rejection.put("approve",false); rejection.put("reason",rejectingPhase==0?"候选缺乏事实依据":"重复材料已经明说的关系"); }
                handlers.get(rejectingPhase).onComplete(Response.from(AiMessage.from(json.writeValueAsString(rejection)),new TokenUsage(8,4)));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
                for(int phase=0;phase<3;phase++) if(phase!=rejectingPhase) {
                    verify(calls.get(phase)).cancel();
                    handlers.get(phase).onComplete(Response.from(AiMessage.from(replies.get(phase)),new TokenUsage(8,4)));
                    handlers.get(phase).onComplete(Response.from(AiMessage.from(replies.get(phase)),new TokenUsage(8,4)));
                }
                View done=s.get(1L,10L,running.id()); assertEquals("EMPTY",done.status()); assertTrue(done.advice().isEmpty());
                assertEquals(44,done.inputTokens()); assertEquals("reported",done.usageStatus());
            } finally { s.close(); }
        }
        verify(usage,times(12)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void valueRequiresBooleanApprovalExactTextAndBoundedReason() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(int variant=0;variant<8;variant++) {
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request()));
                complete(automaticResult(snapshot,candidate)); complete(approvedReview(snapshot,candidate,"有直接依据"));
                complete(unchangedProofread(snapshot,candidate));
                assertEquals("RUNNING",s.get(1L,10L,running.id()).status());
                var value=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(approvedValue(snapshot,candidate));
                if(variant==0) value.put("approve","true");
                if(variant==1) value.remove("approve");
                if(variant==2) value.put("reason"," ");
                if(variant==3) value.put("reason","长".repeat(241));
                if(variant==4) value.remove("reason");
                if(variant==5) value.put("reviewedText","被模型改写的正文");
                if(variant==6) value.remove("reviewedText");
                valueHandler.get().onComplete(Response.from(AiMessage.from(json.writeValueAsString(value)+(variant==7?" {}":"")),new TokenUsage(8,4)));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status()); assertTrue(s.get(1L,10L,running.id()).advice().isEmpty());
            } finally { s.close(); }
        }
    }
    @Test void missingValueUsageRemainsPartialAndValueErrorCancelsBothOtherReviews() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        complete(approvedReview(snapshot,candidate,"有直接依据")); complete(unchangedProofread(snapshot,candidate));
        valueHandler.get().onComplete(Response.from(AiMessage.from(approvedValue(snapshot,candidate))));
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(60,done.inputTokens()); assertEquals("partial_or_unreported",done.usageStatus());
        var s=new WritingSuggestionService(contexts,models,usage,json);
        try {
            View next=s.start(1L,10L,new Input("autocomplete",snapshot.request())); complete(automaticResult(snapshot,candidate));
            valueHandler.get().onError(new OpenRouterStreamingChatModel.EmptyResponseException(new TokenUsage(8,4)));
            assertEquals("EMPTY",s.get(1L,10L,next.id()).status()); verify(call,times(2)).cancel();
            complete(approvedReview(snapshot,candidate,"有直接依据")); complete(unchangedProofread(snapshot,candidate));
            assertEquals("EMPTY",s.get(1L,10L,next.id()).status()); assertEquals(68,s.get(1L,10L,next.id()).inputTokens());
        } finally { s.close(); }
    }
    @Test void siblingRejectedBeforeItsCallReturnsIsCancelledOnRegistration() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        Call grammarCall=mock(Call.class);
        doAnswer(i -> {
            if(grammarInput(i.getArgument(0))) {
                proofHandler.set(i.getArgument(2));
                handler.get().onComplete(Response.from(AiMessage.from("{\"approve\":false}"),new TokenUsage(8,4)));
                return grammarCall;
            }
            handler.set(i.getArgument(2)); return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(grammarCall).cancel();
        proofHandler.get().onComplete(Response.from(AiMessage.from(unchangedProofread(snapshot,candidate)),new TokenUsage(9,5)));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        assertEquals(37,service.get(1L,10L,running.id()).inputTokens());
    }
    @Test void valueHandleReturnedAfterSiblingRejectionIsCancelledAndLateReplyCannotRevive() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。"; Call valueCall=mock(Call.class);
        doAnswer(i -> {
            List<ChatMessage> messages=i.getArgument(0); captureHandler(messages,i.getArgument(2));
            if(json.readTree(((UserMessage)messages.get(1)).singleText()).has("scopedFacts")) {
                complete("{\"approve\":false}");
                return valueCall;
            }
            return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(valueCall).cancel();
        completeValue(snapshot,candidate); complete(unchangedProofread(snapshot,candidate));
        View done=service.get(1L,10L,running.id());
        assertEquals("EMPTY",done.status()); assertEquals(80,done.inputTokens()); assertEquals("reported",done.usageStatus());
    }
    @Test void parallelReviewUsageFailureCancelsSiblingAndCannotRelease() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        doThrow(new IllegalStateException("synthetic usage failure")).when(usage).recordUsage(any(),any(),any(),any(),any());
        complete(approvedReview(snapshot,candidate,"有直接依据"));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(call,times(2)).cancel();
        complete(unchangedProofread(snapshot,candidate));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        assertEquals("reporting_failed",service.get(1L,10L,running.id()).usageStatus());
    }
    @Test void secondParallelReviewCannotExceedModelCallAllowance() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete");
        @SuppressWarnings("unchecked") var admissions=(Map<Long,Deque<Long>>)org.springframework.test.util.ReflectionTestUtils.getField(service,"admissions");
        Deque<Long> times=admissions.get(1L); while(times.size()<11) times.addLast(System.currentTimeMillis());
        complete(automaticResult(snapshot,candidate));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(call).cancel();
        verify(model,times(2)).generateCancellable(anyList(),anyInt(),any());
        verify(model,never()).generateCancellable(argThat(this::grammarInput),anyInt(),any());
        assertEquals(12,times.size());
    }
    @Test void thirdParallelReviewCannotExceedModelCallAllowance() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete");
        @SuppressWarnings("unchecked") var admissions=(Map<Long,Deque<Long>>)org.springframework.test.util.ReflectionTestUtils.getField(service,"admissions");
        Deque<Long> times=admissions.get(1L); while(times.size()<10) times.addLast(System.currentTimeMillis());
        complete(automaticResult(snapshot,candidate));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(call,times(2)).cancel();
        verify(model,times(3)).generateCancellable(anyList(),anyInt(),any());
        assertNull(valueHandler.get()); assertEquals(12,times.size());
        complete(approvedReview(snapshot,candidate,"有直接依据")); complete(unchangedProofread(snapshot,candidate));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
    }
    @Test void changedModelForParallelSiblingCancelsPendingReviewWithoutCallingReplacement() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        var replacement=mock(OpenRouterStreamingChatModel.class); when(replacement.modelName()).thenReturn("different-model");
        when(models.getAutomaticWritingModel(any(),eq(true))).thenReturn(model,replacement);
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(call).cancel();
        verify(replacement,never()).generateCancellable(anyList(),anyInt(),any());
        complete(approvedReview(snapshot,candidate,"有直接依据"));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        assertEquals(40,service.get(1L,10L,running.id()).inputTokens());
    }
    @Test void sharedDeadlineCancelsCurrentReviewAndLateApprovalStaysEmpty() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        complete(automaticResult(snapshot,"便于委员按事项查阅和办理。"));
        var reviewer=handler.get();
        var jobs=(Map<?,?>)org.springframework.test.util.ReflectionTestUtils.getField(service,"jobs");
        Object job=jobs.get(running.id());
        // Run the shared deadline deterministically, without a 30-second test sleep.
        var deadline=(Runnable)org.springframework.test.util.ReflectionTestUtils.getField(job,"deadline");
        assertNotNull(deadline); deadline.run();
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(call,times(3)).cancel();
        reviewer.onComplete(Response.from(AiMessage.from(approvedReview(snapshot,"便于委员按事项查阅和办理。","有直接依据")),new TokenUsage(8,4)));
        proofHandler.get().onComplete(Response.from(AiMessage.from(unchangedProofread(snapshot,"便于委员按事项查阅和办理。")),new TokenUsage(9,5)));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        assertTrue(service.get(1L,10L,running.id()).advice().isEmpty());
        completeValue(snapshot,"便于委员按事项查阅和办理。");
        assertEquals(57,service.get(1L,10L,running.id()).inputTokens());
    }

}
