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
    OpenRouterStreamingChatModel reviewer0=mock(OpenRouterStreamingChatModel.class), reviewer1=mock(OpenRouterStreamingChatModel.class);
    Call reviewCall0=mock(Call.class), reviewCall1=mock(Call.class);
    ObjectMapper json=new ObjectMapper();
    WritingSuggestionService service;
    AtomicReference<StreamingResponseHandler<AiMessage>> handler=new AtomicReference<>(), reviewHandler0=new AtomicReference<>(), reviewHandler1=new AtomicReference<>();
    Snapshot snapshot;
    @BeforeEach void setup() {
        service=new WritingSuggestionService(contexts,models,usage,json);
        snapshot=snapshot(new LitigationWritingProfile(),"原告：沈望舒\n被告：顾青原","被告：顾","");
        when(contexts.capture(eq(1L),eq(10L),any())).thenAnswer(i -> snapshot);
        when(models.getWritingModel(any())).thenReturn(model); when(models.getAutomaticWritingModel(any())).thenReturn(model);
        when(models.getAutomaticWritingReviewModel(any(),eq(0))).thenReturn(reviewer0);
        when(models.getAutomaticWritingReviewModel(any(),eq(1))).thenReturn(reviewer1);
        when(reviewer0.modelName()).thenReturn("moonshotai/kimi-k3"); when(reviewer1.modelName()).thenReturn("qwen/qwen3.8-max"); when(model.modelName()).thenReturn("synthetic-model");
        doAnswer(i -> {captureHandler(i.getArgument(0),i.getArgument(2)); return call;}).when(model).generateCancellable(anyList(),anyInt(),any());
        doAnswer(i -> {reviewHandler0.set(i.getArgument(2)); return reviewCall0;}).when(reviewer0).generateCancellable(anyList(),anyInt(),any());
        doAnswer(i -> {reviewHandler1.set(i.getArgument(2)); return reviewCall1;}).when(reviewer1).generateCancellable(anyList(),anyInt(),any());
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
    void captureHandler(List<ChatMessage> messages,StreamingResponseHandler<AiMessage> h) { handler.set(h); }
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
        return json.writeValueAsString(Map.of("reason",reason,"facts","entailed","grammar","valid",
                "continuation","appropriate","reviewedCandidate",candidate,
                "evidence",List.of(Map.of("factId",s.facts().get(0).id(),"quote",s.facts().get(0).quote()))));
    }
    void review(int index,String raw) {
        (index==0?reviewHandler0:reviewHandler1).get().onComplete(Response.from(AiMessage.from(raw),new TokenUsage(20,10)));
    }
    void completeBothReviews(Snapshot s,String candidate,String reason) throws Exception {
        review(0,approvedReview(s,candidate,reason)); review(1,approvedReview(s,candidate,reason));
    }
    com.fasterxml.jackson.databind.node.ObjectNode approvedNode(String candidate) throws Exception {
        return (com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(approvedReview(snapshot,candidate,"事实有据，完整句自然接续"));
    }
    String rejection(String candidate,String dimension,String verdict,String reason) throws Exception {
        var node=approvedNode(candidate); node.put(dimension,verdict); node.put("reason",reason); return json.writeValueAsString(node);
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
        completeBothReviews(snapshot,candidate,"候选正文有直接依据");
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(1,done.advice().size()); Advice displayed=done.advice().get(0);
        assertEquals("",displayed.explanation(),"Unreviewed generator explanation must not reach the user");
        assertEquals(candidate,displayed.text()); assertEquals(internal.kind(),displayed.kind());
        assertEquals(internal.factIds(),displayed.factIds()); assertEquals(internal.sourceIds(),displayed.sourceIds());
        verify(model).generateCancellable(anyList(),eq(4096),any());
        verify(reviewer0).generateCancellable(anyList(),eq(8192),any());
        verify(reviewer1).generateCancellable(anyList(),eq(8192),any());
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
        completeBothReviews(snapshot,candidate,"既有清单直接支持当前句的宾语");
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
        completeBothReviews(snapshot,candidate,"两类分别陈述同一结果，非相邻重复有必要");
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
        assertTrue(before.length()+after.length()>3700);
        assertTrue(approvedReview(snapshot,candidate,"当前候选有直接依据").length()<4096);
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        completeBothReviews(snapshot,candidate,"当前候选有直接依据");
        assertEquals("READY",service.get(1L,10L,running.id()).status());
    }
    @Test void conciseSemanticDimensionsStillRequireReviewAndCanBeAccepted() throws Exception {
        snapshot=snapshot(new AutomaticWritingProfile(),"材料核对检查申请材料是否齐全。\n内容审查核实提交内容是否真实。",
                "材料核对与内容审查是不同的工作环节。两道程序分别关注申请材料的", "");
        String text="齐全性和真实性";
        Advice advice=new Advice(text,"sentence",snapshot.facts().stream().map(Fact::id).toList(),List.of("active-document"),"概括不同审查维度");
        String raw=json.writeValueAsString(Map.of("abstain",false,"usefulness","completes_current_thought","evidence","direct_support","suggestions",List.of(advice)));
        View running=start("autocomplete"); complete(raw);
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        completeBothReviews(snapshot,text,"两项概念均由材料支持，接缝通顺");
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
        completeBothReviews(snapshot,text,"整合两组功能的入口差异，没有增加事实或改变语气");
        View done=service.get(1L,10L,running.id());
        assertEquals("READY",done.status()); assertEquals(List.of(new Advice(text,"sentence",advice.factIds(),advice.sourceIds(),"")),done.advice());
        assertEquals(60,done.inputTokens()); assertEquals(30,done.outputTokens());
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
        completeBothReviews(snapshot,candidate,"拼接全文自然，事实和语气保持一致");
        View done=service.get(1L,10L,running.id());
        assertEquals("READY",done.status()); assertEquals(candidate,done.advice().get(0).text());
    }

    @Test void automaticReportUsesPinnedThreeModelsAndExistingAcceptance() throws Exception {
        Snapshot report=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        snapshot=new Snapshot(report.projectId(),report.userId(),report.request(),report.settings(),report.context(),null,report.sources(),List.of(),List.of());
        View running=start("autocomplete"); assertEquals("RUNNING",running.status()); assertEquals("general",running.profile());
        verify(models).getAutomaticWritingModel(argThat(d -> d.toMillis()>0 && d.toMillis()<=30000));
        verify(models).getAutomaticWritingReviewModel(argThat(d -> d.toMillis()>0 && d.toMillis()<=30000),eq(0));
        verify(models).getAutomaticWritingReviewModel(argThat(d -> d.toMillis()>0 && d.toMillis()<=30000),eq(1));
        verify(model).generateCancellable(anyList(),eq(4096),any());
        complete(automaticResult(report,candidate));
        verify(reviewer0).generateCancellable(anyList(),eq(8192),any());
        verify(reviewer1).generateCancellable(anyList(),eq(8192),any());
        review(0,approvedReview(report,candidate,"当前用途由材料直接支持"));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        review(1,approvedReview(report,candidate,"完整句有据且通顺"));
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status());
        assertEquals(candidate,service.accept(1L,10L,running.id(),new Accept(0,"r1")).text());
        assertThrows(IllegalArgumentException.class,()->service.accept(1L,10L,running.id(),new Accept(0,"r1")));
        verify(usage).recordUsage(eq(10L),eq(1L),eq("synthetic-model"),any(),isNull());
        verify(usage).recordUsage(eq(10L),eq(1L),eq("moonshotai/kimi-k3"),any(),isNull());
        verify(usage).recordUsage(eq(10L),eq(1L),eq("qwen/qwen3.8-max"),any(),isNull());
        assertEquals(60,done.inputTokens()); assertEquals(30,done.outputTokens()); assertEquals("reported",done.usageStatus());
    }
    @Test void bothReviewsReceiveFullInsertionAndOnlyFilteredEvidenceNotEachOthersAnswers() throws Exception {
        String conclusion="当前材料已明确支持委员按事项查阅并办理相关工作。";
        Snapshot original=snapshot(new AutomaticWritingProfile(),reportSnapshot().sources().get(0).text()+"\n"+conclusion,
                "平台集中整理了相关项目材料，","");
        Source raw=original.sources().get(0);
        Source source=new Source(raw.id(),raw.fileId(),raw.name(),raw.version(),raw.locator(),raw.text()+"\n不应进入模型的旧附件定义：测试代号旧蓝图。");
        snapshot=new Snapshot(original.projectId(),original.userId(),original.request(),original.settings(),original.context(),original.profile(),List.of(source),original.facts(),List.of());
        String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        var inputs=org.mockito.ArgumentCaptor.forClass(List.class);
        verify(reviewer0).generateCancellable(inputs.capture(),eq(8192),any());
        verify(reviewer1).generateCancellable(inputs.capture(),eq(8192),any());
        for(List<?> messages:inputs.getAllValues()) {
            String rawInput=((UserMessage)messages.get(1)).singleText(); var input=json.readTree(rawInput);
            assertEquals(snapshot.context().before(),input.path("before").asText()); assertEquals(candidate,input.path("candidate").asText());
            assertEquals(snapshot.context().after(),input.path("after").asText());
            assertEquals(snapshot.context().before()+candidate+snapshot.context().after(),input.path("assembledText").asText());
            assertEquals(json.valueToTree(List.of(snapshot.facts().get(0))),input.path("facts"));
            assertFalse(input.has("scopedFacts")); assertFalse(rawInput.contains(conclusion));
            assertEquals(json.valueToTree(List.of(snapshot.facts().get(0).id())),input.path("candidateCitations"));
            assertFalse(input.has("sources")); assertFalse(rawInput.contains("旧蓝图"));
            assertFalse(input.has("otherReview")); assertFalse(input.has("reviewerVerdict"));
        }
        service.cancel(1L,10L,running.id());
    }
    @Test void reviewApprovalNeedsExactTypedProtocolAndRealCitedEvidenceWithoutCertaintyScore() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        Advice advice=service.parse(snapshot,automaticResult(snapshot,candidate),"autocomplete").get(0);
        var valid=approvedNode(candidate);
        assertFalse(valid.has("confidence")); assertFalse(valid.has("certainty"));
        assertTrue(reviewApproved(valid,advice,snapshot.facts()));
        for(int variant=0;variant<24;variant++) {
            var node=valid.deepCopy();
            switch(variant) {
                case 0 -> node.put("facts","unsupported");
                case 1 -> node.put("facts","uncertain");
                case 2 -> node.put("grammar","invalid");
                case 3 -> node.put("grammar","uncertain");
                case 4 -> node.put("continuation","inappropriate");
                case 5 -> node.put("continuation","uncertain");
                case 6 -> node.put("facts",true);
                case 7 -> node.put("grammar","true");
                case 8 -> node.remove("continuation");
                case 9 -> node.put("reviewedCandidate",candidate+" ");
                case 10 -> node.put("reviewedCandidate","模型修订后的其他候选");
                case 11 -> node.remove("reviewedCandidate");
                case 12 -> node.put("reason"," ");
                case 13 -> node.put("reason","长".repeat(241));
                case 14 -> node.put("reason",true);
                case 15 -> node.remove("reason");
                case 16 -> node.remove("evidence");
                case 17 -> node.putArray("evidence");
                case 18 -> ((com.fasterxml.jackson.databind.node.ObjectNode)node.path("evidence").get(0)).put("quote","材料没有记载的改述");
                case 19 -> ((com.fasterxml.jackson.databind.node.ObjectNode)node.path("evidence").get(0)).put("factId","unknown");
                case 20 -> ((com.fasterxml.jackson.databind.node.ObjectNode)node.path("evidence").get(0)).put("quote"," ");
                case 21 -> ((com.fasterxml.jackson.databind.node.ObjectNode)node.path("evidence").get(0)).put("factId",true);
                case 22 -> { var evidence=node.withArray("evidence"); while(evidence.size()<9)evidence.add(evidence.get(0).deepCopy()); }
                case 23 -> node.put("reviewedCandidate",true);
            }
            node.put("confidence",1.0); node.put("approve",true);
            assertFalse(reviewApproved(node,advice,snapshot.facts()),"certainty cannot override a failed guard: "+variant);
        }
    }
    @Test void reviewCannotCiteExistingButUnselectedFactEvenWhenQuoteIsIdentical() throws Exception {
        Snapshot base=reportSnapshot(); Fact first=base.facts().get(0);
        Fact other=new Fact("uncited",first.kind(),first.label(),first.value(),first.role(),first.status(),first.sourceId(),first.quote());
        snapshot=new Snapshot(base.projectId(),base.userId(),base.request(),base.settings(),base.context(),base.profile(),base.sources(),List.of(first,other),base.warnings());
        String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        var node=approvedNode(candidate); ((com.fasterxml.jackson.databind.node.ObjectNode)node.path("evidence").get(0)).put("factId","uncited");
        review(0,json.writeValueAsString(node)); review(1,approvedReview(snapshot,candidate,"有据"));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
    }
    @Test void malformedOrOversizedReviewCannotReleaseSuggestion() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。"; String valid=approvedReview(snapshot,candidate,"有据");
        for(String raw:List.of("not-json",valid+" {}","```json\n"+valid+"\n```","x".repeat(16001))) {
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request())); complete(automaticResult(snapshot,candidate));
                review(0,raw); review(1,valid);
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status()); assertTrue(s.get(1L,10L,running.id()).advice().isEmpty());
            } finally { s.close(); }
        }
    }
    @Test void twoApprovalsAreRequiredInEitherCompletionOrderAndDuplicatesAreChargedOnce() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(int first:List.of(0,1)) {
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request())); var generator=handler.get();
                complete(automaticResult(snapshot,candidate));
                String reply=approvedReview(snapshot,candidate,"事实有据且自然");
                review(first,reply); assertEquals("RUNNING",s.get(1L,10L,running.id()).status());
                review(1-first,reply); assertEquals("READY",s.get(1L,10L,running.id()).status());
                generator.onComplete(Response.from(AiMessage.from(automaticResult(snapshot,candidate)),new TokenUsage(20,10)));
                for(var h:List.of(reviewHandler0.get(),reviewHandler1.get())) {
                    h.onComplete(Response.from(AiMessage.from(reply),new TokenUsage(20,10))); h.onError(new IllegalStateException("duplicate terminal"));
                }
                View done=s.get(1L,10L,running.id()); assertEquals(60,done.inputTokens()); assertEquals(30,done.outputTokens());
                assertEquals("reported",done.usageStatus()); assertEquals("READY",done.status());
            } finally { s.close(); }
        }
        verify(usage,times(6)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void everyDimensionOnEitherReviewerCanVetoAndLateApprovalCannotRevive() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        Map<String,String> rejected=Map.of("facts","unsupported","grammar","invalid","continuation","inappropriate");
        for(int rejecting=0;rejecting<2;rejecting++) for(var dimension:rejected.entrySet()) {
            clearInvocations(reviewCall0,reviewCall1);
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request())); complete(automaticResult(snapshot,candidate));
                review(rejecting,rejection(candidate,dimension.getKey(),dimension.getValue(),"当前候选在该维度未通过"));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
                verify(rejecting==0?reviewCall1:reviewCall0).cancel();
                review(1-rejecting,approvedReview(snapshot,candidate,"另一个模型认为可用"));
                review(1-rejecting,approvedReview(snapshot,candidate,"重复回调"));
                View done=s.get(1L,10L,running.id()); assertEquals("EMPTY",done.status()); assertTrue(done.advice().isEmpty());
                assertEquals(60,done.inputTokens()); assertEquals("reported",done.usageStatus());
            } finally { s.close(); }
        }
        verify(usage,times(18)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void eitherReviewerUncertaintyAfterPeerApprovalStillStaysEmpty() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(int uncertain=0;uncertain<2;uncertain++) {
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request())); complete(automaticResult(snapshot,candidate));
                review(1-uncertain,approvedReview(snapshot,candidate,"有依据"));
                review(uncertain,rejection(candidate,"facts","uncertain","无法确定材料足以支持完整判断"));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
            } finally { s.close(); }
        }
    }
    @Test void actualModalityAndCausalRejectionsRemainSilentWithoutRetry() throws Exception {
        for(String dimension:List.of("modality","causal")) {
            snapshot=snapshot(new AutomaticWritingProfile(),dimension.equals("modality")?"线上可以提交资料，现场办理可以当面核对材料。":"成员信息分散保存在不同材料中。",
                    "从目前业务开展的实际情况来看，","");
            String candidate=dimension.equals("modality")?"后者需要当面核对材料。":"增加了逐项核对的工作量。";
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request())); complete(automaticResult(snapshot,candidate));
                review(0,rejection(candidate,"facts","unsupported",dimension.equals("modality")?"可以不能改为需要":"材料分散不直接说明工作量增加"));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
            } finally { s.close(); }
        }
        verify(model,times(2)).generateCancellable(anyList(),eq(4096),any());
        verify(reviewer0,times(2)).generateCancellable(anyList(),eq(8192),any());
        verify(reviewer1,times(2)).generateCancellable(anyList(),eq(8192),any());
    }
    @Test void pinnedInstancesSurviveSettingsChangesAndUsageKeepsEachActualModel() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。"; View running=start("autocomplete");
        var replacement=mock(OpenRouterStreamingChatModel.class);
        when(models.getAutomaticWritingModel(any())).thenReturn(replacement);
        when(models.getAutomaticWritingReviewModel(any(),anyInt())).thenReturn(replacement);
        complete(automaticResult(snapshot,candidate)); completeBothReviews(snapshot,candidate,"有依据");
        assertEquals("READY",service.get(1L,10L,running.id()).status());
        verify(replacement,never()).generateCancellable(anyList(),anyInt(),any());
        verify(models,times(1)).getAutomaticWritingModel(any());
        verify(models,times(1)).getAutomaticWritingReviewModel(any(),eq(0)); verify(models,times(1)).getAutomaticWritingReviewModel(any(),eq(1));
        verify(usage).recordUsage(eq(10L),eq(1L),eq("synthetic-model"),any(),isNull());
        verify(usage).recordUsage(eq(10L),eq(1L),eq("moonshotai/kimi-k3"),any(),isNull());
        verify(usage).recordUsage(eq(10L),eq(1L),eq("qwen/qwen3.8-max"),any(),isNull());
    }
    @Test void sameReviewerModelCannotMasqueradeAsIndependentAgreement() {
        snapshot=reportSnapshot(); when(reviewer1.modelName()).thenReturn("moonshotai/kimi-k3");
        assertEquals("EMPTY",start("autocomplete").status());
        verify(model,never()).generateCancellable(anyList(),anyInt(),any());
        verify(reviewer0,never()).generateCancellable(anyList(),anyInt(),any());
        verify(reviewer1,never()).generateCancellable(anyList(),anyInt(),any()); verifyNoInteractions(usage);
    }
    @Test void missingUsageForAnyOfThreeRequestsKeepsKnownTotalPartial() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(int missing=0;missing<3;missing++) {
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request()));
                String generated=automaticResult(snapshot,candidate);
                handler.get().onComplete(missing==0?Response.from(AiMessage.from(generated)):Response.from(AiMessage.from(generated),new TokenUsage(20,10)));
                String reply=approvedReview(snapshot,candidate,"有依据");
                for(int r=0;r<2;r++) (r==0?reviewHandler0:reviewHandler1).get().onComplete(missing==r+1?Response.from(AiMessage.from(reply)):Response.from(AiMessage.from(reply),new TokenUsage(20,10)));
                View done=s.get(1L,10L,running.id()); assertEquals("READY",done.status());
                assertEquals(40,done.inputTokens()); assertEquals(20,done.outputTokens()); assertEquals("partial_or_unreported",done.usageStatus());
            } finally { s.close(); }
        }
        verify(usage,times(6)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void eitherReviewErrorRecordsKnownUsageAndCancelsPeer() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(int failed=0;failed<2;failed++) {
            clearInvocations(reviewCall0,reviewCall1);
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request())); complete(automaticResult(snapshot,candidate));
                (failed==0?reviewHandler0:reviewHandler1).get().onError(new OpenRouterStreamingChatModel.EmptyResponseException(new TokenUsage(8,256)));
                verify(failed==0?reviewCall1:reviewCall0).cancel();
                View empty=s.get(1L,10L,running.id()); assertEquals("EMPTY",empty.status()); assertEquals(28,empty.inputTokens());
                assertEquals(266,empty.outputTokens()); assertEquals("partial_or_unreported",empty.usageStatus());
                review(1-failed,approvedReview(snapshot,candidate,"迟到批准"));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status()); assertEquals(48,s.get(1L,10L,running.id()).inputTokens());
            } finally { s.close(); }
        }
    }
    @Test void nullReviewAndOversizedStreamAreConservativeEmpty() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(boolean overflow:List.of(false,true)) {
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request())); complete(automaticResult(snapshot,candidate));
                if(overflow) reviewHandler0.get().onNext("x".repeat(16001)); else reviewHandler0.get().onComplete(null);
                review(1,approvedReview(snapshot,candidate,"另一模型批准"));
                assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
            } finally { s.close(); }
        }
    }
    @Test void reviewUsageStorageFailureCancelsPeerAndCannotRelease() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        doThrow(new IllegalStateException("synthetic usage failure")).when(usage).recordUsage(any(),any(),any(),any(),any());
        review(0,approvedReview(snapshot,candidate,"有据")); verify(reviewCall1).cancel();
        review(1,approvedReview(snapshot,candidate,"迟到批准"));
        View done=service.get(1L,10L,running.id()); assertEquals("EMPTY",done.status()); assertEquals("reporting_failed",done.usageStatus());
    }
    @Test void sharedDeadlineCancelsBothReviewsAndLateApprovalsStayEmpty() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        var jobs=(Map<?,?>)org.springframework.test.util.ReflectionTestUtils.getField(service,"jobs");
        var deadline=(Runnable)org.springframework.test.util.ReflectionTestUtils.getField(jobs.get(running.id()),"deadline");
        assertNotNull(deadline); deadline.run();
        verify(reviewCall0).cancel(); verify(reviewCall1).cancel();
        completeBothReviews(snapshot,candidate,"迟到批准");
        View done=service.get(1L,10L,running.id()); assertEquals("EMPTY",done.status()); assertTrue(done.advice().isEmpty());
        assertEquals(60,done.inputTokens()); assertEquals("reported",done.usageStatus());
    }
    @Test void synchronousGenerationCannotOverwriteReviewHandles() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        doAnswer(i -> {
            StreamingResponseHandler<AiMessage> h=i.getArgument(2);
            h.onComplete(Response.from(AiMessage.from(automaticResult(snapshot,candidate)),new TokenUsage(20,10))); return call;
        }).when(model).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); assertEquals("RUNNING",running.status());
        service.cancel(1L,10L,running.id()); verify(reviewCall0).cancel(); verify(reviewCall1).cancel();
        completeBothReviews(snapshot,candidate,"迟到批准");
        assertEquals("CANCELLED",service.get(1L,10L,running.id()).status()); assertEquals(60,service.get(1L,10L,running.id()).inputTokens());
    }
    @Test void synchronousFirstReviewApprovalCannotStandInForSecondReview() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        doAnswer(i -> {
            StreamingResponseHandler<AiMessage> h=i.getArgument(2);
            h.onComplete(Response.from(AiMessage.from(approvedReview(snapshot,candidate,"有据")),new TokenUsage(20,10))); return reviewCall0;
        }).when(reviewer0).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        assertEquals("RUNNING",service.get(1L,10L,running.id()).status());
        service.cancel(1L,10L,running.id()); verify(reviewCall1).cancel();
        review(1,approvedReview(snapshot,candidate,"迟到批准")); assertEquals("CANCELLED",service.get(1L,10L,running.id()).status());
    }
    @Test void siblingRejectedBeforeHandleRegistrationCancelsReturnedHandle() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        doAnswer(i -> {
            reviewHandler1.set(i.getArgument(2)); review(0,rejection(candidate,"grammar","invalid","接缝句式不搭配")); return reviewCall1;
        }).when(reviewer1).generateCancellable(anyList(),anyInt(),any());
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        assertEquals("EMPTY",service.get(1L,10L,running.id()).status()); verify(reviewCall1).cancel();
        review(1,approvedReview(snapshot,candidate,"迟到批准")); assertEquals("EMPTY",service.get(1L,10L,running.id()).status());
        assertEquals(60,service.get(1L,10L,running.id()).inputTokens());
    }
    @Test void reviewRequestsEachConsumeExistingModelAllowance() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        for(int used:List.of(11,12)) {
            clearInvocations(reviewer0,reviewer1,reviewCall0,reviewCall1);
            var s=new WritingSuggestionService(contexts,models,usage,json);
            try {
                View running=s.start(1L,10L,new Input("autocomplete",snapshot.request()));
                @SuppressWarnings("unchecked") var admissions=(Map<Long,Deque<Long>>)org.springframework.test.util.ReflectionTestUtils.getField(s,"admissions");
                Deque<Long> times=admissions.get(1L); while(times.size()<used) times.addLast(System.currentTimeMillis());
                complete(automaticResult(snapshot,candidate)); assertEquals("EMPTY",s.get(1L,10L,running.id()).status());
                verify(reviewer0,times(used==11?1:0)).generateCancellable(anyList(),anyInt(),any());
                verify(reviewer1,never()).generateCancellable(anyList(),anyInt(),any());
                if(used==11) verify(reviewCall0).cancel(); assertEquals(12,times.size());
            } finally { s.close(); }
        }
    }
    @Test void cancellationDuringPinnedFactorySetupCannotStartPaidRequest() throws Exception {
        snapshot=reportSnapshot(); CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        when(models.getAutomaticWritingReviewModel(any(),eq(0))).thenAnswer(i -> { entered.countDown(); assertTrue(release.await(3,TimeUnit.SECONDS)); return reviewer0; });
        var pending=CompletableFuture.supplyAsync(()->start("autocomplete")); assertTrue(entered.await(2,TimeUnit.SECONDS));
        // An explicit request owns the editor after cancellation; its own model request is allowed.
        start("sentence"); release.countDown(); assertEquals("CANCELLED",pending.get(3,TimeUnit.SECONDS).status());
        verify(model,times(1)).generateCancellable(anyList(),anyInt(),any());
        verify(reviewer0,never()).generateCancellable(anyList(),anyInt(),any()); verify(reviewer1,never()).generateCancellable(anyList(),anyInt(),any());
    }
    @Test void automaticAcceptanceStillRevalidatesRevisionAndRevokedAccess() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate)); completeBothReviews(snapshot,candidate,"有据");
        doThrow(new IllegalArgumentException("stale")).when(contexts).revalidate(snapshot,"r2");
        assertThrows(IllegalArgumentException.class,()->service.accept(1L,10L,running.id(),new Accept(0,"r2")));
        doThrow(new IllegalArgumentException("revoked")).when(contexts).require(1L,10L,false);
        assertThrows(IllegalArgumentException.class,()->service.accept(1L,10L,running.id(),new Accept(0,"r1")));
    }

    @Test void automaticFactoryCallsAndCallbacksKeepTheCorrectUserScope() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        when(models.getAutomaticWritingModel(any())).thenAnswer(i -> { assertEquals(1L,PlatformAiUserScope.current()); return model; });
        when(models.getAutomaticWritingReviewModel(any(),anyInt())).thenAnswer(i -> { assertEquals(1L,PlatformAiUserScope.current()); return ((Integer)i.getArgument(1))==0?reviewer0:reviewer1; });
        doAnswer(i -> { assertEquals(1L,PlatformAiUserScope.current()); return null; }).when(usage).recordUsage(any(),any(),any(),any(),any());
        AtomicReference<View> running=new AtomicReference<>();
        PlatformAiUserScope.run(7L,() -> { running.set(start("autocomplete")); assertEquals(7L,PlatformAiUserScope.current()); });
        String generated=automaticResult(snapshot,candidate), approved=approvedReview(snapshot,candidate,"有据");
        CompletableFuture.runAsync(() -> {
            assertNull(PlatformAiUserScope.current()); complete(generated); review(0,approved); review(1,approved); assertNull(PlatformAiUserScope.current());
        }).get(3,TimeUnit.SECONDS);
        assertEquals("READY",service.get(1L,10L,running.get().id()).status());
    }
    @Test void simultaneousApprovalsSettleExactlyOnce() throws Exception {
        snapshot=reportSnapshot(); String candidate="便于委员按事项查阅和办理。";
        View running=start("autocomplete"); complete(automaticResult(snapshot,candidate));
        String approved=approvedReview(snapshot,candidate,"有据"); CountDownLatch ready=new CountDownLatch(2),release=new CountDownLatch(1);
        var first=CompletableFuture.runAsync(() -> { ready.countDown(); try { assertTrue(release.await(3,TimeUnit.SECONDS)); } catch(InterruptedException e) { throw new AssertionError(e); } review(0,approved); });
        var second=CompletableFuture.runAsync(() -> { ready.countDown(); try { assertTrue(release.await(3,TimeUnit.SECONDS)); } catch(InterruptedException e) { throw new AssertionError(e); } review(1,approved); });
        assertTrue(ready.await(2,TimeUnit.SECONDS)); release.countDown(); CompletableFuture.allOf(first,second).get(3,TimeUnit.SECONDS);
        View done=service.get(1L,10L,running.id()); assertEquals("READY",done.status()); assertEquals(1,done.advice().size());
        assertEquals(60,done.inputTokens()); verify(usage,times(3)).recordUsage(any(),any(),any(),any(),any());
    }
    @Test void reviewerSetupFailureIsEmptyBeforeAnyProviderRequest() {
        snapshot=reportSnapshot(); when(models.getAutomaticWritingReviewModel(any(),eq(1))).thenThrow(new IllegalStateException("synthetic unavailable reviewer"));
        View done=start("autocomplete"); assertEquals("EMPTY",done.status()); assertTrue(done.advice().isEmpty());
        verify(model,never()).generateCancellable(anyList(),anyInt(),any()); verify(reviewer0,never()).generateCancellable(anyList(),anyInt(),any());
        verify(reviewer1,never()).generateCancellable(anyList(),anyInt(),any()); verifyNoInteractions(usage);
    }

}
