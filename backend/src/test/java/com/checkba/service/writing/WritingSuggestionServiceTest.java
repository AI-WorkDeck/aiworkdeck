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
    AtomicReference<StreamingResponseHandler<AiMessage>> handler=new AtomicReference<>();
    Snapshot snapshot;
    @BeforeEach void setup() {
        service=new WritingSuggestionService(contexts,models,usage,json);
        snapshot=snapshot(new LitigationWritingProfile(),"原告：沈望舒\n被告：顾青原","被告：顾","");
        when(contexts.capture(eq(1L),eq(10L),any())).thenAnswer(i -> snapshot);
        when(models.getWritingModel(any())).thenReturn(model); when(models.getWritingReviewModel(any())).thenReturn(model); when(model.modelName()).thenReturn("synthetic-model");
        when(model.generateCancellable(anyList(),anyInt(),any())).thenAnswer(i -> {handler.set(i.getArgument(2)); return call;});
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
    void complete(String raw) { handler.get().onComplete(Response.from(AiMessage.from(raw),new TokenUsage(20,10))); }
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
        when(model.generateCancellable(anyList(),anyInt(),any())).thenAnswer(i -> { entered.countDown(); assertTrue(release.await(3,TimeUnit.SECONDS)); return call; });
        var pending=CompletableFuture.supplyAsync(()->start("sentence")); assertTrue(entered.await(2,TimeUnit.SECONDS));
        View local=start("local"); assertEquals("READY",local.status()); release.countDown();
        assertEquals("CANCELLED",pending.get(3,TimeUnit.SECONDS).status()); verify(call).cancel();
    }
    @Test void oversizedStreamFailsAndCancelsEvenBeforeCallHandleAssigned() {
        when(model.generateCancellable(anyList(),anyInt(),any())).thenAnswer(i -> { StreamingResponseHandler<AiMessage> h=i.getArgument(2); h.onNext("x".repeat(16001)); return call; });
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
        when(model.generateCancellable(anyList(),anyInt(),any())).thenAnswer(invocation -> {
            List<ChatMessage> messages=invocation.getArgument(0); prompt.set(((UserMessage)messages.get(1)).singleText()); return call;
        });
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
        when(model.generateCancellable(anyList(),anyInt(),any())).thenAnswer(invocation -> {
            List<ChatMessage> messages=invocation.getArgument(0); prompt.set(((UserMessage)messages.get(1)).singleText()); return call;
        });
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
        return json.writeValueAsString(Map.of("approve",true,"reason",reason,
                "reviewedText",s.context().before()+candidate+s.context().after()));
    }
    @Test void automaticReportUsesRealModelPathAndGenericFallbackThenExistingAcceptance() throws Exception {
        Snapshot report=reportSnapshot();
        snapshot=new Snapshot(report.projectId(),report.userId(),report.request(),report.settings(),report.context(),null,report.sources(),List.of(),List.of());
        View running=start("autocomplete");
        assertEquals("RUNNING",running.status()); assertEquals("general",running.profile());
        verify(models).getWritingModel(argThat(d -> !d.isNegative() && !d.isZero() && d.toMillis()<=20000));
        verify(model).generateCancellable(anyList(),eq(512),any());
        complete(automaticResult(report,"便于委员按事项查阅和办理。"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        verify(model).generateCancellable(anyList(),eq(4096),any());
        complete(approvedReview(report,"便于委员按事项查阅和办理。","承接材料按事项办理的既有用途，没有增加事实或责任"));
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status()); assertEquals(1,done.advice().size());
        assertEquals("便于委员按事项查阅和办理。",service.accept(1L,10L,running.id(),new Accept(0,"r1")).text());
        verify(usage,times(2)).recordUsage(eq(10L),eq(1L),eq("synthetic-model"),any(),isNull());
        assertEquals(40,done.inputTokens()); assertEquals(20,done.outputTokens()); assertEquals("reported",done.usageStatus());
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
                "平台集中整理了相关项目材料，便于查阅。","便于查阅。","便于委员查阅。\n并且办理。"))
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


    @Test void automaticRejectsSourceSentenceCopiesEvenAwayFromTheCurrentPrefix() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"成员信息来源不一，项目组需要逐一核对。","从目前的信息管理情况来看，","");
        Fact fact=snapshot.facts().get(0);
        String copied="项目组需要逐一核对。";
        assertFalse(snapshot.context().before().contains(copied));
        assertTrue(valid(snapshot,new Advice(copied,"sentence",List.of(fact.id()),List.of(fact.sourceId()),"来源记载"),100),
                "原文引用本身有效，但不能仅因此成为有价值的自动建议");
        for(String text:List.of(copied,"项目组需要，逐一核对！","项目组需要 逐一核对。"))
            assertTrue(service.parse(snapshot,automaticResult(snapshot,text),"autocomplete").isEmpty(),text);
        assertEquals(1,service.parse(snapshot,result(copied,"sentence",fact),"sentence").size(),"手动有据续写的既有行为保留");
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
        complete(approvedReview(snapshot,text,"整合两组功能的入口差异，没有增加事实或改变语气"));
        View done=service.get(1L,10L,running.id());
        assertEquals("READY",done.status()); assertEquals(List.of(advice),done.advice());
        assertEquals(40,done.inputTokens()); assertEquals(20,done.outputTokens());
    }


    @Test void independentReviewRejectsChangedModalityWithoutRetry() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"线上可以提交资料，现场办理可以当面核对材料。","就两种业务办理方式的区别而言，","");
        AtomicReference<String> reviewPrompt=new AtomicReference<>(),reviewInput=new AtomicReference<>();
        when(model.generateCancellable(anyList(),anyInt(),any())).thenAnswer(i -> {
            List<ChatMessage> messages=i.getArgument(0); handler.set(i.getArgument(2));
            if((int)i.getArgument(1)==4096) {
                reviewPrompt.set(((SystemMessage)messages.get(0)).text());
                reviewInput.set(((UserMessage)messages.get(1)).singleText());
            }
            return call;
        });
        View running=start("autocomplete"); complete(automaticResult(snapshot,"后者需要当面核对材料。"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        assertTrue(reviewPrompt.get().contains("模态强度")); assertTrue(reviewPrompt.get().contains("工作量增加"));
        var input=json.readTree(reviewInput.get());
        assertEquals(snapshot.context().before(),input.path("before").asText());
        assertEquals("后者需要当面核对材料。",input.path("candidate").asText());
        assertEquals(snapshot.context().before()+"后者需要当面核对材料。"+snapshot.context().after(),input.path("assembledText").asText());
        assertEquals(snapshot.facts().get(0).quote(),input.path("facts").get(0).path("quote").asText());
        complete("{\"approve\":false,\"reason\":\"原文仅表示可以，候选改成需要，增强了模态强度\"}");
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        verify(model,times(2)).generateCancellable(anyList(),anyInt(),any());
        verify(usage,times(2)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void independentReviewRejectsUnsupportedCausalConsequence() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"成员信息分散保存在不同材料中。","从目前的成员信息管理情况来看，","");
        View running=start("autocomplete"); complete(automaticResult(snapshot,"增加了逐项核对的工作量。"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        complete("{\"approve\":false,\"reason\":\"材料分散并未直接说明核对工作量增加\"}");
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        verify(model,times(2)).generateCancellable(anyList(),anyInt(),any());
    }
    @Test void malformedReviewAndNonBooleanApprovalCannotReleaseSuggestion() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        complete(automaticResult(snapshot,"便于委员按事项查阅和办理。"));
        complete(json.writeValueAsString(Map.of("approve","true","reason","看起来可以",
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
        complete(json.writeValueAsString(Map.of("approve",true,"reason","改写前文后通顺",
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
        complete(approvedReview(snapshot,candidate,"拼接全文自然，事实和语气保持一致"));
        View done=service.get(1L,10L,running.id());
        assertEquals("READY",done.status()); assertEquals(candidate,done.advice().get(0).text());
    }
    @Test void synchronousGenerationDoesNotOverwriteReviewCallAndCancellationBlocksLateApproval() throws Exception {
        snapshot=reportSnapshot(); Call generationCall=mock(Call.class),reviewCall=mock(Call.class);
        AtomicReference<StreamingResponseHandler<AiMessage>> reviewer=new AtomicReference<>();
        when(model.generateCancellable(anyList(),anyInt(),any())).thenAnswer(i -> {
            StreamingResponseHandler<AiMessage> h=i.getArgument(2);
            if((int)i.getArgument(1)==512) {
                h.onComplete(Response.from(AiMessage.from(automaticResult(snapshot,"便于委员按事项查阅和办理。")),new TokenUsage(20,10)));
                return generationCall;
            }
            reviewer.set(h); return reviewCall;
        });
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
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(20,done.inputTokens()); assertEquals(10,done.outputTokens());
        assertEquals("partial_or_unreported",done.usageStatus());
        verify(usage,times(1)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void missingGenerationUsageDoesNotTurnReviewUsageIntoCompleteTotal() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        handler.get().onComplete(Response.from(AiMessage.from(automaticResult(snapshot,"便于委员按事项查阅和办理。"))));
        complete(approvedReview(snapshot,"便于委员按事项查阅和办理。","有直接依据"));
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(20,done.inputTokens()); assertEquals(10,done.outputTokens());
        assertEquals("partial_or_unreported",done.usageStatus());
        verify(usage,times(1)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void reviewUsesRemainingSharedBudgetAndDuplicateCallbackIsNotDoubleCharged() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        var generator=handler.get(); String generated=automaticResult(snapshot,"便于委员按事项查阅和办理。");
        complete(generated); var reviewer=handler.get();
        generator.onComplete(Response.from(AiMessage.from(generated),new TokenUsage(20,10)));
        var budgets=org.mockito.ArgumentCaptor.forClass(Duration.class);
        verify(models).getWritingModel(budgets.capture());
        verify(models).getWritingReviewModel(budgets.capture());
        assertTrue(budgets.getAllValues().get(0).toMillis()<=20000);
        assertTrue(budgets.getAllValues().get(1).toMillis()<=budgets.getAllValues().get(0).toMillis());
        reviewer.onError(new OpenRouterStreamingChatModel.EmptyResponseException(new TokenUsage(8,4)));
        View done=service.get(1L,10L,running.id()); assertEquals("EMPTY",done.status());
        assertEquals(28,done.inputTokens()); assertEquals(14,done.outputTokens());
        verify(usage,times(2)).recordUsage(any(),any(),any(),any(),any());
    }


    @Test void sharedDeadlineCancelsCurrentReviewAndLateApprovalStaysEmpty() throws Exception {
        snapshot=reportSnapshot(); View running=start("autocomplete");
        complete(automaticResult(snapshot,"便于委员按事项查阅和办理。"));
        var reviewer=handler.get();
        var jobs=(Map<?,?>)org.springframework.test.util.ReflectionTestUtils.getField(service,"jobs");
        Object job=jobs.get(running.id());
        // Run the scheduled deadline action deterministically, without a 20-second test sleep.
        var deadline=(Runnable)org.springframework.test.util.ReflectionTestUtils.getField(job,"deadline");
        assertNotNull(deadline); deadline.run();
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(call).cancel();
        reviewer.onComplete(Response.from(AiMessage.from(approvedReview(snapshot,"便于委员按事项查阅和办理。","有直接依据")),new TokenUsage(8,4)));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        assertTrue(service.get(1L,10L,running.id()).advice().isEmpty());
    }

}
