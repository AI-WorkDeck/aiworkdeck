// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.baoqingtian;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import java.net.URI;
import java.util.*;
import static com.aiworkdeck.plugins.baoqingtian.BaoqingtianTools.*;
import static org.junit.jupiter.api.Assertions.*;

class NoteUploadsTest {
    static final String HOST="https://bqt-1251512257.cos.ap-beijing.myqcloud.com";
    static byte[] png(int size) { byte[] b=new byte[size]; System.arraycopy(new byte[]{(byte)137,80,78,71,13,10,26,10},0,b,0,8); return b; }
    static ObjectNode policy() { long now=System.currentTimeMillis()/1000; return object("cosHost",HOST,"cosKey","uploads/test.png","policy","PRIVATE_POLICY","qsignAlgorithm","sha1","qak","PRIVATE_AK","qkeyTime",(now-1)+";"+(now+600),"qsignature","PRIVATE_SIGNATURE"); }
    static class Fixture implements NoteUploads.Api,NoteUploads.CosTransport {
        NoteUploads uploads=new NoteUploads(this);
        ObjectNode args;
        List<String> calls=new ArrayList<>();
        ObjectNode row;
        int adds, finals, pushes;
        boolean notSentAdd,notSentFinalize,lostAdd,lostFinalize, failUpload, missingAck, rejectFinalize, visible=true;
        String owner="99";
        ObjectNode uploadPolicy=policy();
        Fixture() { args=object("operationId",UUID.randomUUID().toString(),"title","媒体测试","content","说明","status","draft","businessId","2","type","IMAGE","confirmed",true);
            args.set("files",JSON.valueToTree(List.of(object("name","a.png","mime","image/png","size",16)))); }
        public JsonNode call(String method,String path,JsonNode body,boolean write) {
            calls.add(path);
            if(path.endsWith("cert/status")) return object("status","cert_succeed");
            if(path.endsWith("/add")) {
                if(notSentAdd) throw fail("request_not_sent","预算耗尽，尚未发送");
                adds++; row=((ObjectNode)body).deepCopy(); row.put("id","901").put("lawyerId",owner).put("isDraft",1);
                if(lostAdd) throw fail("outcome_unknown","结果未知"); return object("noteId","901");
            }
            if(path.contains("/detail?")) { row.put("lawyerId",owner); return row; }
            if(path.endsWith("generatePolicy")) return uploadPolicy;
            if(path.endsWith("updateAfterUploadSuccess")) {
                if(notSentFinalize) throw fail("request_not_sent","预算耗尽，尚未发送");
                finals++; if(rejectFinalize) throw fail("remote_rejected","未完成"); row.set("content",body.get("content")); row.set("cover",body.get("cover")); row.put("isDraft",0);
                if(lostFinalize) throw fail("outcome_unknown","结果未知"); return missingAck?object():object("isSuccess",true);
            }
            if(path.endsWith("lawyer/page")) return object("list",visible?List.of(row):List.of(),"total",visible?1:0);
            throw new AssertionError(path);
        }
        public int upload(URI host,Map<String,String> fields,byte[] bytes,String name,String mime) {
            pushes++; assertEquals(HOST,host.toString()); assertFalse(fields.containsKey("appToken"));
            assertEquals("PRIVATE_SIGNATURE",fields.get("q-signature")); return failUpload?503:204;
        }
        JsonNode run(String action,JsonNode params) { return JSON.valueToTree(uploads.execute(1,"99",action,params,this)); }
        JsonNode begin() { return run("note_begin",args); }
        JsonNode part(String upload,int index,int offset,byte[] bytes) {return run("media_upload",object("uploadId",upload,"index",index,"offset",offset,"base64",Base64.getEncoder().encodeToString(bytes)));}
        JsonNode finish(String upload) { return run("note_finish",object("uploadId",upload)); }
    }
    @Test void imageRunsOfficialPendingUploadFinalizeAndReadback() {
        Fixture f=new Fixture(); JsonNode begun=f.begin(); String upload=begun.path("uploadId").asText();
        assertEquals("901",begun.path("id").asText()); assertFalse(begun.has("saved")); assertEquals("Y",f.row.path("isNoteDraft").asText());
        assertEquals("DRAFT",f.row.path("status").asText()); assertEquals("IMAGE",f.row.path("type").asText()); assertTrue(f.row.path("cover").asText().startsWith("local://aiworkdeck/"));
        JsonNode result=f.part(upload,0,0,png(16)); assertTrue(result.path("uploaded").asBoolean()); assertEquals(16,result.path("received").asInt());
        assertFalse(result.toString().contains("PRIVATE")); assertTrue(f.finish(upload).path("saved").asBoolean());
        assertEquals(1,f.adds);assertEquals(1,f.finals);assertEquals(HOST+"/uploads/test.png",f.row.path("content").asText());
        assertTrue(f.finish(upload).path("saved").asBoolean());assertEquals(1,f.finals);
    }
    @Test void operationIdIsIdempotentAndChangedPayloadConflicts() {
        Fixture f=new Fixture(); JsonNode first=f.begin(); assertEquals(first,f.begin());assertEquals(1,f.adds);
        f.args.put("content","changed"); assertEquals("operation_conflict",assertThrows(Failure.class,f::begin).code); assertEquals(1,f.adds);
    }
    @Test void unknownCreateNeverCreatesAgain() {
        Fixture f=new Fixture();f.lostAdd=true;
        assertEquals("outcome_unknown",assertThrows(Failure.class,f::begin).code);
        assertEquals("outcome_unknown",assertThrows(Failure.class,f::begin).code);assertEquals(1,f.adds);
    }
    @Test void chunksResumeAndDuplicateOffsetsNeverAppendAgain() {
        Fixture f=new Fixture();
        ((ObjectNode)f.args.path("files").get(0)).put("size",20);String u=f.begin().path("uploadId").asText();byte[] bytes=png(20);
        JsonNode first=f.part(u,0,0,Arrays.copyOfRange(bytes,0,10));assertEquals(10,first.path("received").asInt());assertFalse(first.path("uploaded").asBoolean());
        assertEquals(10,f.part(u,0,0,Arrays.copyOfRange(bytes,0,10)).path("received").asInt());
        assertEquals(10,f.part(u,0,15,new byte[5]).path("received").asInt()); assertEquals(0,f.pushes);
        assertTrue(f.part(u,0,10,Arrays.copyOfRange(bytes,10,20)).path("uploaded").asBoolean());assertEquals(1,f.pushes);
        assertTrue(f.part(u,0,10,Arrays.copyOfRange(bytes,10,20)).path("uploaded").asBoolean());assertEquals(1,f.pushes);
    }
    @Test void conflictingRepeatAndOversizeChunksAreRejected() {
        Fixture f=new Fixture();String u=f.begin().path("uploadId").asText(); f.part(u,0,0,Arrays.copyOf(png(16),8));
        assertEquals("operation_conflict",assertThrows(Failure.class,()->f.part(u,0,0,new byte[8])).code);
        assertEquals("invalid_params",assertThrows(Failure.class,()->f.part(u,0,8,new byte[9])).code);
    }
    @Test void failedCosUploadRetriesFileWithoutAnotherAdd() {
        Fixture f=new Fixture();String u=f.begin().path("uploadId").asText();f.failUpload=true;
        assertEquals("upload_failed",assertThrows(Failure.class,()->f.part(u,0,0,png(16))).code);
        f.failUpload=false;assertTrue(f.part(u,0,0,png(16)).path("uploaded").asBoolean());assertEquals(1,f.adds);assertEquals(2,f.pushes);
    }
    @Test void onlyOwnerAndOriginalAccountCanContinue() {
        Fixture f=new Fixture();String u=f.begin().path("uploadId").asText();
        assertEquals("upload_not_found",assertThrows(Failure.class,()->f.uploads.execute(2,"99","note_finish",object("uploadId",u),f)).code);
        assertEquals("upload_not_found",assertThrows(Failure.class,()->f.uploads.execute(1,"100","note_finish",object("uploadId",u),f)).code);
        f.part(u,0,0,png(16));f.owner="100";assertEquals("not_owner",assertThrows(Failure.class,()->f.finish(u)).code);assertEquals(0,f.finals);
    }
    @Test void finishRequiresAllFilesAndRecoversLostFinalResponseByReadOnlyCheck() {
        Fixture f=new Fixture();String u=f.begin().path("uploadId").asText();
        assertEquals("upload_incomplete",assertThrows(Failure.class,()->f.finish(u)).code);f.part(u,0,0,png(16));f.lostFinalize=true;
        assertEquals("outcome_unknown",assertThrows(Failure.class,()->f.finish(u)).code);
        assertTrue(f.finish(u).path("saved").asBoolean());assertEquals(1,f.adds);assertEquals(1,f.finals);
    }
    @Test void missingFinalAckDoesNotClaimSuccessAndNeedsVisibleListWhenFlagOmitted() {
        Fixture f=new Fixture();String u=f.begin().path("uploadId").asText();f.part(u,0,0,png(16));f.missingAck=true;
        assertEquals("outcome_unknown",assertThrows(Failure.class,()->f.finish(u)).code);f.row.remove(List.of("isDraft","isNoteDraft"));f.visible=false;
        assertEquals("outcome_unknown",assertThrows(Failure.class,()->f.finish(u)).code);assertEquals(1,f.finals);
        f.visible=true;assertTrue(f.finish(u).path("saved").asBoolean());assertEquals(1,f.finals);
    }
    @Test void videoRequiresSeparateCoverAndPreservesCorrectOrder() {
        Fixture f=new Fixture();f.args.put("type","VIDEO");f.args.set("files",JSON.valueToTree(List.of(object("name","v.mp4","mime","video/mp4","size",16),object("name","cover.png","mime","image/png","size",16))));
        String u=f.begin().path("uploadId").asText();assertTrue(f.row.path("cover").asText().endsWith("/1.png"));
        byte[] v=new byte[16];System.arraycopy("ftyp".getBytes(java.nio.charset.StandardCharsets.US_ASCII),0,v,4,4);f.uploadPolicy.put("cosKey","uploads/video.mp4");f.part(u,0,0,v);
        assertEquals("upload_incomplete",assertThrows(Failure.class,()->f.finish(u)).code);f.uploadPolicy.put("cosKey","uploads/cover.png");f.part(u,1,0,png(16));
        assertTrue(f.finish(u).path("saved").asBoolean());assertEquals(HOST+"/uploads/video.mp4",f.row.path("content").asText());assertEquals(HOST+"/uploads/cover.png",f.row.path("cover").asText());
    }
    @Test void invalidTypesSizesMetadataAndMagicNeverUpload() {
        Fixture f=new Fixture();f.args.put("type","TEXT");assertEquals("media_required",assertThrows(Failure.class,f::begin).code);
        f.args.put("type","VIDEO");assertEquals("invalid_params",assertThrows(Failure.class,f::begin).code);f.args.put("type","IMAGE");
        ObjectNode file=(ObjectNode)f.args.path("files").get(0);file.put("size",10*1024*1024+1);assertEquals("invalid_params",assertThrows(Failure.class,f::begin).code);
        file.put("size",16).put("name","../a.png");assertEquals("invalid_params",assertThrows(Failure.class,f::begin).code);file.put("name","a.png");
        String u=f.begin().path("uploadId").asText();assertEquals("invalid_params",assertThrows(Failure.class,()->f.part(u,0,0,new byte[16])).code);assertEquals(0,f.pushes);
    }
    @Test void uploadPolicyRejectsForeignHostsRedirectTargetsAndUnsafeKeys() {
        for(String host:List.of("http://bqt-1251512257.cos.ap-beijing.myqcloud.com","https://evil.example","https://bqt-1251512257.cos.ap-beijing.myqcloud.com.evil.example","https://127.0.0.1","https://user@bqt-1251512257.cos.ap-beijing.myqcloud.com","https://bqt-1251512257.cos.ap-beijing.myqcloud.com:443","https://bqt-1251512257.cos.ap-beijing.myqcloud.com/path")) {
            ObjectNode p=policy().put("cosHost",host);assertEquals("invalid_upload_policy",assertThrows(Failure.class,()->NoteUploads.policy(p)).code);
        }
        assertThrows(Failure.class,()->NoteUploads.policy(policy().put("cosKey","../other")));
        assertThrows(Failure.class,()->NoteUploads.policy(policy().put("qkeyTime","1;2")));
        ObjectNode p=policy();p.set("qSignAlgorithm",p.remove("qsignAlgorithm"));p.set("qAk",p.remove("qak"));p.set("qKeyTime",p.remove("qkeyTime"));p.set("qSignature",p.remove("qsignature"));assertEquals(HOST,NoteUploads.policy(p).host().toString());
    }
    @Test void rejectedFinalizationCanResumeSameNoteWithoutAnotherCreate() {
        Fixture f=new Fixture();String u=f.begin().path("uploadId").asText();f.part(u,0,0,png(16));f.rejectFinalize=true;
        assertEquals("remote_rejected",assertThrows(Failure.class,()->f.finish(u)).code);
        f.rejectFinalize=false;assertTrue(f.finish(u).path("saved").asBoolean());assertEquals(1,f.adds);assertEquals(2,f.finals);
    }
    @Test void unknownFinalizationWithoutMatchingReadbackNeverRepeatsWrite() {
        Fixture f=new Fixture();String u=f.begin().path("uploadId").asText();f.part(u,0,0,png(16));f.lostFinalize=true;
        assertThrows(Failure.class,()->f.finish(u));f.row.put("content","different");
        assertEquals("outcome_unknown",assertThrows(Failure.class,()->f.finish(u)).code);assertEquals(1,f.finals);assertEquals(1,f.adds);
    }
    @Test void fullFourMiBChunkAndTailPreserveBytesAndBoundMemory() {
        Fixture f=new Fixture();int size=4*1024*1024+16;((ObjectNode)f.args.path("files").get(0)).put("size",size);
        String u=f.begin().path("uploadId").asText();byte[] data=png(size);
        assertEquals(4*1024*1024,f.part(u,0,0,Arrays.copyOf(data,4*1024*1024)).path("received").asInt());
        Fixture other=new Fixture();other.uploads=f.uploads;String second=other.begin().path("uploadId").asText();
        assertEquals("upload_in_progress",assertThrows(Failure.class,()->other.part(second,0,0,png(16))).code);
        assertTrue(f.part(u,0,4*1024*1024,Arrays.copyOfRange(data,4*1024*1024,size)).path("uploaded").asBoolean());
        assertTrue(other.part(second,0,0,png(16)).path("uploaded").asBoolean());
    }

    @Test void deadlineBeforeSendingAddOrFinalizeAllowsSameOperationToResume() {
        Fixture f = new Fixture(); f.notSentAdd=true;
        assertEquals("request_not_sent",assertThrows(Failure.class,f::begin).code);
        assertEquals(0,f.adds); f.notSentAdd=false;
        String upload=f.begin().path("uploadId").asText();
        f.part(upload,0,0,png(16)); f.notSentFinalize=true;
        assertEquals("request_not_sent",assertThrows(Failure.class,()->f.finish(upload)).code);
        assertEquals(0,f.finals); f.notSentFinalize=false;
        assertTrue(f.finish(upload).path("saved").asBoolean());
        assertEquals(1,f.adds); assertEquals(1,f.finals);
    }

}
