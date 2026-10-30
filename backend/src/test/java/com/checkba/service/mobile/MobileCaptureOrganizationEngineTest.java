// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.config.AiModelProperties;
import com.checkba.service.SystemSettingService;
import com.checkba.service.AppLanguageScope;
import com.checkba.service.ai.*;
import com.checkba.service.telemetry.TelemetryService;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.data.message.*;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.model.output.TokenUsage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MobileCaptureOrganizationEngineTest {
    final ObjectMapper json=new ObjectMapper();
    final ChatModelFactory models=mock(ChatModelFactory.class);
    final TokenUsageService usage=mock(TokenUsageService.class);
    final VoiceDictationService dictation=mock(VoiceDictationService.class);
    final MobileCaptureOrganizationEngine engine=new MobileCaptureOrganizationEngine(models,usage,json,dictation);
    final LocalDateTime captured=LocalDateTime.of(2026,10,30,10,11,12);
    @AfterEach void stop(){engine.shutdown();}

    String extraction(String type,String subject) throws Exception {
        return json.writeValueAsString(Map.of("type",type,"subject",subject,"needsReview",false));
    }
    @Test void acceptsOnlyASingleCompleteJsonFenceAndRejectsProseOrTrailingPayloads() throws Exception {
        String object=extraction("contract","供货合同");
        var plain=engine.parse(object,"source.jpg","image",captured,null,"image");
        assertEquals(plain,engine.parse("```json\n"+object+"\n```","source.jpg","image",captured,null,"image"));
        assertEquals(plain,engine.parse("```\n"+object+"\n```","source.jpg","image",captured,null,"image"));
        assertThrows(java.io.IOException.class,()->engine.parse("Here is the result: "+object,"source.jpg","image",captured,null,"image"));
        assertThrows(java.io.IOException.class,()->engine.parse(object+" {}","source.jpg","image",captured,null,"image"));
    }
    @Test void copyrightUsesOnlyClearlyLabeledRegistrationNumberAndPreservesDocumentDate() throws Exception {
        var data=new LinkedHashMap<String,Object>();
        data.put("type","copyright"); data.put("subject","测试系统");data.put("needsReview",false);
        data.put("identifier","2026SR123456"); data.put("identifierKind","registration_number");
        data.put("identifierLabel","登记号");data.put("identifierCertain",true);data.put("documentDate","2026-08-01");
        var result=engine.parse(json.writeValueAsString(data),"IMG_12.JPG","image",captured,null,"image");
        assertEquals("著作权登记证书_2026SR123456_测试系统_2026-08-01.JPG",result.fileName());
        assertEquals("registration_number",result.fields().get("identifierKind"));
        assertEquals(List.of("著作权登记证书"),result.tags());
        data.put("identifierLabel","证书号");data.put("identifierKind","certificate_number");
        result=engine.parse(json.writeValueAsString(data),"IMG_12.JPG","image",captured,null,"image");
        assertEquals("needs_review",result.state());assertEquals("IMG_12.JPG",result.fileName());
    }
    @Test void genericLicensesAndCertificatesRequireTheMatchingPrintedNumberLabel() throws Exception {
        var data=new LinkedHashMap<String,Object>();
        data.put("type","license");data.put("subject","示例食品公司");data.put("needsReview",false);
        data.put("identifier","JY11101010012345");data.put("identifierCertain",true);
        data.put("identifierKind","license_number");data.put("identifierLabel","食品经营许可证编号");
        var result=engine.parse(json.writeValueAsString(data),"food.jpg","image",captured,null,"image");
        assertEquals("ready",result.state());assertEquals("许可证_JY11101010012345_示例食品公司.jpg",result.fileName());
        assertEquals("license_number",result.fields().get("identifierKind"));
        data.put("identifierLabel","");
        assertEquals("needs_review",engine.parse(json.writeValueAsString(data),"food.jpg","image",captured,null,"image").state());
        data.put("type","certificate");data.put("identifierKind","certificate_number");data.put("identifierLabel","证书编号");
        data.put("identifier","D123456789");
        result=engine.parse(json.writeValueAsString(data),"qualification.jpg","image",captured,null,"image");
        assertEquals("证书_D123456789_示例食品公司.jpg",result.fileName());
        data.put("identifierKind","approval_number");data.put("identifierLabel","批准文号");data.put("identifier","国药准字H12345678");
        assertEquals("ready",engine.parse(json.writeValueAsString(data),"qualification.jpg","image",captured,null,"image").state());
    }
    @Test void missingNumberAndDateAreNeverInventedFromCaptureOrFilename() throws Exception {
        var result=engine.parse(extraction("contract","甲乙采购合同"),"20261030-12345.txt","document",captured,"合同","text_prefix:2");
        assertEquals("合同_甲乙采购合同.txt",result.fileName());
        assertFalse(result.fields().containsKey("identifier"));assertFalse(result.fields().containsKey("documentDate"));
        var field=engine.parse("{\"type\":\"field_photo\",\"description\":\"仓库门口\",\"needsReview\":false}",
                "capture.jpg","image",captured,null,"image");
        assertEquals("现场照片_仓库门口_2026-10-30_10-11-12.jpg",field.fileName());
    }
    @Test void uncertainOrUncorroboratedNumbersRetainOriginalName() throws Exception {
        String input="{\"type\":\"contract\",\"identifier\":\"CN-44\",\"identifierKind\":\"contract_number\","
                +"\"identifierLabel\":\"合同编号\",\"identifierCertain\":true,\"needsReview\":false}";
        var result=engine.parse(input,"note.txt","document",captured,"合同编号：CN-45","text_prefix:10");
        assertEquals("needs_review",result.state());assertEquals("note.txt",result.fileName());
        assertEquals("needs_review",engine.parse("{\"type\":\"business_license\",\"needsReview\":true}","a.jpg","image",captured,null,"image").state());
    }
    @Test void unsafePathsSensitiveNumbersAndLegalConclusionTagsNeverEnterGeneratedName() throws Exception {
        var data=new LinkedHashMap<String,Object>();data.put("type","contract");data.put("subject","../../foo:bar|合同");
        data.put("needsReview",false);data.put("tags",List.of("有效","已签署","6222021234567890123","采购","付款","第六标签"));
        var result=engine.parse(json.writeValueAsString(data),"../../IMG.JPG","image",captured,null,"image");
        assertFalse(result.fileName().contains("/"));assertFalse(result.fileName().contains(":"));assertFalse(result.fileName().contains("|"));
        assertTrue(result.fileName().endsWith(".JPG"));assertEquals(List.of("合同","采购","付款"),result.tags());
        data.put("subject","6222021234567890123");
        result=engine.parse(json.writeValueAsString(data),"a.jpg","image",captured,null,"image");
        assertEquals("合同.jpg",result.fileName());
        data.put("type","identity");data.put("subject","张三");data.put("identifier","110101199001011234");
        result=engine.parse(json.writeValueAsString(data),"a.jpg","image",captured,null,"image");
        assertEquals("身份证明.jpg",result.fileName());assertFalse(result.fields().containsKey("subject"));
    }
    @Test void imageCallUsesRequestAccountAndExactPlatformModelAndRecordsUsage() throws Exception {
        ChatLanguageModel model=mock(ChatLanguageModel.class);
        AtomicReference<List<ChatMessage>> sent=new AtomicReference<>();
        when(models.getPlatformAuxChatModel(any(),eq(700),eq(true))).thenAnswer(call->{
            assertEquals(47L,PlatformAiUserScope.current());
            Duration deadline=call.getArgument(0);assertTrue(deadline.toSeconds()<=30);
            return new ChatModelFactory.PlatformChatModel(model,"test/cheap-model");
        });
        TokenUsage tokens=new TokenUsage(10,20);
        when(model.generate(anyList())).thenAnswer(call->{
            assertEquals(47L,PlatformAiUserScope.current());sent.set(call.getArgument(0));
            return Response.from(AiMessage.from(extraction("contract","供货合同")),tokens);
        });
        var file=new MockMultipartFile("file",tinyPng());
        var result=engine.analyze(47L,file,"a.png","image",captured);
        assertEquals("ready",result.state());assertEquals("合同_供货合同.png",result.fileName());
        assertInstanceOf(SystemMessage.class,sent.get().get(0));assertInstanceOf(UserMessage.class,sent.get().get(1));
        verify(usage).recordPlatformUsage(null,47L,"test/cheap-model",tokens,"mobile-capture-organization");
        verify(models,never()).getAuxChatModel();assertNull(PlatformAiUserScope.current());
    }
    @Test void imageIsActuallySubmittedAndDecodeAndSizeFailuresNeverCallModel() throws Exception {
        BufferedImage image=new BufferedImage(2600,1400,BufferedImage.TYPE_INT_RGB);
        var out=new ByteArrayOutputStream();ImageIO.write(image,"png",out);image.flush();
        byte[] thumbnail=MobileCaptureOrganizationEngine.thumbnail(out.toByteArray());
        var decoded=ImageIO.read(new java.io.ByteArrayInputStream(thumbnail));
        assertTrue(decoded.getWidth()<=1280);assertTrue(decoded.getHeight()<=1280);decoded.flush();
        ChatLanguageModel model=mock(ChatLanguageModel.class);
        when(models.getPlatformAuxChatModel(any(),eq(700),eq(true))).thenReturn(new ChatModelFactory.PlatformChatModel(model,"test/vision"));
        when(model.generate(anyList())).thenAnswer(call->{
            List<ChatMessage> messages=call.getArgument(0);
            var user=(UserMessage)messages.get(1);assertTrue(user.contents().stream().anyMatch(ImageContent.class::isInstance));
            return Response.from(AiMessage.from(extraction("field_photo","")));
        });
        assertEquals("ready",engine.analyze(1L,new MockMultipartFile("file",out.toByteArray()),"capture.jpg","image",captured).state());
        clearInvocations(models);
        assertEquals("skipped",engine.analyze(1L,new MockMultipartFile("file",new byte[]{1,2,3}),"capture.jpg","image",captured).state());
        verifyNoInteractions(models);
    }
    @Test void unavailableVideoAudioUnsupportedTextAndProviderFailurePreserveName() throws Exception {
        var noVideo=new MobileCaptureOrganizationEngine(models,usage,json,dictation){@Override Path ffmpeg(){return null;}};
        try {
            var file=new MockMultipartFile("file",new byte[]{1,2,3});
            assertEquals("skipped",noVideo.analyze(1L,file,"a.mp4","video",captured).state());
            assertEquals("skipped",noVideo.analyze(1L,file,"a.m4a","audio",captured).state());
            assertEquals("skipped",engine.analyze(1L,file,"a.docx","document",captured).state());
            verifyNoInteractions(models);
            when(models.getPlatformAuxChatModel(any(),any(),eq(true))).thenThrow(new IllegalStateException("upstream-secret-detail"));
            var failed=engine.analyze(1L,new MockMultipartFile("file",tinyPng()),"a.png","image",captured);
            assertEquals("failed",failed.state());assertEquals("a.png",failed.fileName());assertTrue(failed.fields().isEmpty());
        } finally {noVideo.shutdown();}
    }
    @Test void realLocalVideoDecodingSuppliesOnlyBoundedSampledFrames() throws Exception {
        Path ffmpeg=engine.ffmpeg();
        org.junit.jupiter.api.Assumptions.assumeTrue(ffmpeg!=null,"ffmpeg executable unavailable");
        Path video=java.nio.file.Files.createTempFile("capture-fixture-", ".mp4");
        try {
            Process fixture=new ProcessBuilder(ffmpeg.toString(),"-nostdin","-loglevel","error","-f","lavfi","-i",
                    "color=c=blue:s=320x240:r=1","-t","12","-c:v","mpeg4","-y",video.toString())
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            try {assertTrue(fixture.waitFor(5,java.util.concurrent.TimeUnit.SECONDS));assertEquals(0,fixture.exitValue());}
            finally {if(fixture.isAlive())fixture.destroyForcibly();}
            ChatLanguageModel model=mock(ChatLanguageModel.class);
            when(models.getPlatformAuxChatModel(any(),eq(700),eq(true))).thenReturn(new ChatModelFactory.PlatformChatModel(model,"test/vision"));
            when(model.generate(anyList())).thenAnswer(call->{
                List<ChatMessage> messages=call.getArgument(0);
                var user=(UserMessage)messages.get(1);
                assertEquals(3,user.contents().stream().filter(ImageContent.class::isInstance).count());
                return Response.from(AiMessage.from(extraction("field_video","")));
            });
            var result=engine.analyze(1L,new MockMultipartFile("file",java.nio.file.Files.readAllBytes(video)),"clip.mp4","video",captured);
            assertEquals("ready",result.state());assertEquals("sampled_frames:3",result.fields().get("coverage"));
        } finally {java.nio.file.Files.deleteIfExists(video);}
    }
    @Test void disguisedPlaylistsCannotReadNetworkOrLocalAudioAndNeverReachModel() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(engine.ffmpeg()!=null,"ffmpeg executable unavailable");
        var requests=new java.util.concurrent.atomic.AtomicInteger();
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/audio.wav",exchange->{requests.incrementAndGet();exchange.sendResponseHeaders(404,-1);exchange.close();});
        server.start();
        try {
            String remote="#EXTM3U\n#EXT-X-TARGETDURATION:30\n#EXTINF:30,\nhttp://127.0.0.1:"+server.getAddress().getPort()+"/audio.wav\n#EXT-X-ENDLIST\n";
            String local="ffconcat version 1.0\nfile '/etc/passwd'\n";
            for(String playlist:List.of(remote,local)) {
                var bytes=playlist.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                assertEquals("skipped",engine.analyze(1L,new MockMultipartFile("file",bytes),"fake.mp4","video",captured).state());
                assertEquals("skipped",engine.analyze(1L,new MockMultipartFile("file",bytes),"fake.wav","audio",captured).state());
            }
            assertEquals(0,requests.get());verifyNoInteractions(dictation,models);
        } finally {server.stop(0);}
    }
    @Test void workerKeepsRequestLanguageAndFilenamesFitUtf8Budget() throws Exception {
        ChatLanguageModel model=mock(ChatLanguageModel.class);
        when(models.getPlatformAuxChatModel(any(),eq(700),eq(true))).thenReturn(new ChatModelFactory.PlatformChatModel(model,"test/cheap"));
        when(model.generate(anyList())).thenAnswer(call->{
            assertEquals("en-US",AppLanguageScope.current());
            return Response.from(AiMessage.from(extraction("contract","Supply Agreement")));
        });
        byte[] image=tinyPng();
        var result=AppLanguageScope.call("en-US",()->engine.analyze(1L,
                new MockMultipartFile("file",image),"a.png","image",captured));
        assertEquals("Contract_Supply Agreement.png",result.fileName());assertEquals(List.of("Contract"),result.tags());
        assertNull(AppLanguageScope.current());
        String longSubject="名".repeat(100);
        var bounded=engine.parse(extraction("copyright",longSubject),"image.jpg","image",captured,null,"image");
        assertTrue(bounded.fileName().getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=184);
    }
    private static byte[] tinyPng() throws Exception {
        var image=new BufferedImage(20,20,BufferedImage.TYPE_INT_RGB);var out=new ByteArrayOutputStream();
        ImageIO.write(image,"png",out);image.flush();return out.toByteArray();
    }
    @Test void audioIsActuallySampledTranscribedAndClassifiedWithBothUsageReceipts() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(engine.ffmpeg()!=null,"ffmpeg executable unavailable");
        int samples=16000;var wav=java.nio.ByteBuffer.allocate(44+samples*2).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes()).putInt(36+samples*2).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1)
                .putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16)
                .put("data".getBytes()).putInt(samples*2);
        TokenUsage audioTokens=new TokenUsage(100,20), textTokens=new TokenUsage(10,10);
        when(dictation.transcribeSample(eq(47L),anyString(),eq("wav"),eq(30000L),any(),eq(1200))).thenAnswer(call->{
            assertEquals(47L,PlatformAiUserScope.current());
            byte[] sample=Base64.getDecoder().decode((String)call.getArgument(1));
            assertTrue(sample.length>44);assertTrue(sample.length<1000000);
            assertEquals("RIFF",new String(sample,0,4,java.nio.charset.StandardCharsets.US_ASCII));
            return new VoiceDictationService.SampleDictation("今天讨论仓库盘点安排", "test/audio-model",audioTokens);
        });
        ChatLanguageModel model=mock(ChatLanguageModel.class);
        when(models.getPlatformAuxChatModel(any(),eq(700),eq(false))).thenReturn(new ChatModelFactory.PlatformChatModel(model,"test/cheap"));
        when(model.generate(anyList())).thenAnswer(call->{
            List<ChatMessage> sent=call.getArgument(0);
            assertTrue(((TextContent)((UserMessage)sent.get(1)).contents().get(0)).text().contains("今天讨论仓库盘点安排"));
            return Response.from(AiMessage.from("{\"type\":\"field_audio\",\"description\":\"仓库盘点安排\",\"needsReview\":false}"),textTokens);
        });
        var result=engine.analyze(47L,new MockMultipartFile("file",wav.array()),"recording.wav","audio",captured);
        assertEquals("ready",result.state());assertEquals("现场录音_仓库盘点安排_2026-10-30_10-11-12.wav",result.fileName());
        assertEquals("audio_prefix_at_most_30s",result.fields().get("coverage"));
        verify(usage).recordPlatformUsage(null,47L,"test/audio-model",audioTokens,"mobile-capture-audio-preview");
        verify(usage).recordPlatformUsage(null,47L,"test/cheap",textTokens,"mobile-capture-organization");
        assertFalse(result.fields().containsValue("今天讨论仓库盘点安排"));
    }
    @Test void explicitPlatformAuxiliaryCannotUseServerByokDefaultOrUpgradeNonVisualModel() {
        var properties=new AiModelProperties();properties.setProvider(AiModelProperties.Provider.OPENROUTER);
        var settings=mock(SystemSettingService.class);
        var channel=mock(PlatformAiChannel.class);var credits=mock(PlatformCreditsGate.class);
        var accountant=mock(PlatformUsageAccountant.class);var auxiliary=mock(AuxModelResolver.class);
        var factory=new ChatModelFactory(properties,settings,channel,credits,accountant,auxiliary,mock(TelemetryService.class));
        when(auxiliary.auxModelId()).thenReturn(AllowedModels.QWEN_3_7_FLASH.getModelId());
        when(channel.connection()).thenAnswer(call->{assertEquals(42L,PlatformAiUserScope.current());
            return new com.checkba.service.ai.PlatformAiKeyService.Resolved("test-platform-key", "test-snapshot", null);});
        assertThrows(RuntimeException.class,()->factory.getPlatformAuxChatModel(Duration.ofSeconds(2),700,true));
        var selected=PlatformAiUserScope.call(42L,()->factory.getPlatformAuxChatModel(Duration.ofSeconds(2),700,true));
        assertEquals(AllowedModels.QWEN_3_7_FLASH.getModelId(),selected.modelId());
        assertEquals(selected.modelId(),((OpenAiChatModel)selected.model()).modelName());
        verify(credits).ensureCredits(42L);verify(channel).connection();
        when(auxiliary.auxModelId()).thenReturn("deepseek/deepseek-v4-flash");
        assertThrows(RuntimeException.class,()->PlatformAiUserScope.call(42L,()->factory.getPlatformAuxChatModel(Duration.ofSeconds(2),700,true)));
        verify(channel,times(2)).connection();verify(channel,never()).apiKey();
        when(channel.usesMachineKey(43L)).thenReturn(true);
        assertThrows(RuntimeException.class,()->PlatformAiUserScope.call(43L,()->factory.getPlatformAuxChatModel(Duration.ofSeconds(2),700,false)));
    }
}
