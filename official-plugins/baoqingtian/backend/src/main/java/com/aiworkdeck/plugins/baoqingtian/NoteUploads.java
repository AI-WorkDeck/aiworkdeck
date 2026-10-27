// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.baoqingtian;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static com.aiworkdeck.plugins.baoqingtian.BaoqingtianTools.*;

/** One create operation, resumable media transfer, and verified finalization. All state is backend-only. */
final class NoteUploads {
    interface Api { JsonNode call(String method, String path, JsonNode body, boolean write); }
    interface CosTransport { int upload(URI host, Map<String,String> fields, byte[] bytes, String name, String mime) throws Exception; }
    record FileSpec(String name, long size, String mime, String ext) {}
    private static final long TTL = Duration.ofHours(1).toMillis();
    private final Map<String, Pending> operations = new ConcurrentHashMap<>();
    private final CosTransport cos;
    NoteUploads(CosTransport cos) { this.cos = cos; }
    private static final class Pending {
        final long user, expires;
        final String account, operationId, uploadId = UUID.randomUUID().toString(), fingerprint, type, status, title, description;
        final List<FileSpec> files;
        final Map<Integer,String> urls = new HashMap<>();
        String noteId;
        Failure beginFailure;
        boolean finalizeAttempted, saved;
        byte[] buffer;
        int bufferIndex=-1, received;
        Pending(long user, String account, String op, String fingerprint, String type, String status, String title, String description, List<FileSpec> files) {
            this.user=user; this.account=account; this.operationId=op; this.fingerprint=fingerprint; this.type=type; this.status=status;
            this.title=title; this.description=description; this.files=files; expires=System.currentTimeMillis()+TTL;
        }
    }
    Object execute(long user, String account, String action, JsonNode args, Api api) {
        operations.values().forEach(p -> { if(p.user==user&&p.expires<System.currentTimeMillis()) p.buffer=null; });
        if (action.equals("note_begin")) return begin(user, account, args, api);
        Pending p = operations.values().stream().filter(v -> v.uploadId.equals(args.path("uploadId").asText()) && v.user==user && v.account.equals(account)).findFirst()
            .orElseThrow(() -> fail("upload_not_found", "当前账号没有此上传任务，请重新连接原账号"));
        if (p.expires < System.currentTimeMillis()) { p.buffer=null; throw fail("upload_expired", "上传任务已过期，请先核对平台记录，不要重复创建"); }
        if (p.noteId == null) throw fail("outcome_unknown", "暂存记录结果不确定，请先核对平台记录，勿重新创建");
        return action.equals("media_upload") ? upload(p,args,api) : finish(p,api);
    }
    private Object begin(long user, String account, JsonNode args, Api api) {
        String op = args.path("operationId").asText();
        try { if (!UUID.fromString(op).toString().equals(op)) throw new IllegalArgumentException(); }
        catch (IllegalArgumentException e) { throw fail("invalid_params", "创建操作标识必须为 UUID"); }
        String title = text(args,"title",20), status = state(args,false), type=args.path("type").asText();
        if (!Set.of("IMAGE","VIDEO").contains(type)) throw fail("media_required","新建笔记需要图片或视频及独立封面");
        if (!args.path("confirmed").asBoolean(false)) throw fail("confirmation_required","创建笔记前请明确确认保存或发布");
        if (!args.path("content").isTextual() || args.path("content").asText().length()>1000) throw fail("invalid_params","笔记说明须为文字且不超过 1000 字");
        String description=args.path("content").asText(), business=id(args,"businessId");
        List<FileSpec> files=specs(type,args.path("files"));
        String fingerprint=object("title",title,"status",status,"type",type,"description",description,"businessId",business,"files",files).toString();
        String key=user+":"+account+":"+op;
        Pending previous=operations.get(key);
        if(previous!=null) {
            if(!previous.fingerprint.equals(fingerprint)) throw fail("operation_conflict","同一创建操作的内容已变化，请先核对原记录");
            if(previous.beginFailure!=null) throw previous.beginFailure;
            if(previous.expires<System.currentTimeMillis()) throw fail("upload_expired","创建操作已过期，请核对平台记录，勿重复创建");
            if(previous.noteId==null) throw fail("outcome_unknown","此前创建结果不确定，请核对平台记录，勿重复创建");
            return Map.of("id",previous.noteId,"uploadId",previous.uploadId);
        }
        // Keep small tombstones for the instance lifetime: expiring a task must never make its operationId create again.
        if(operations.values().stream().filter(p->p.user==user).count()>=32) throw fail("upload_limit","本次会话的上传任务已达上限，请先完成或核对已有任务");
        JsonNode cert=api.call("POST","/bqt/lawyer/cert/status",object(),false);
        if(!cert.path("status").asText().equals("cert_succeed")) throw fail("certification_required","请先在包晴天完成实名认证与律师资格认证");
        Pending p=new Pending(user,account,op,fingerprint,type,status,title,description,files);
        operations.put(key,p);
        List<String> placeholders=new ArrayList<>();
        for(int i=0;i<files.size();i++) placeholders.add("local://aiworkdeck/"+p.uploadId+"/"+i+"."+files.get(i).ext);
        String content=type.equals("IMAGE")?String.join(";",placeholders):placeholders.get(0);
        String cover=placeholders.get(type.equals("IMAGE")?0:1);
        try {
            JsonNode result=api.call("POST","/bqt/lawyer/note/add",object("title",title,"type",type,"content",content,"cover",cover,"description",description,
                "status",status,"businessId",business,"isNoteDraft","Y","contentSource",0,"aiCreationStatement",0),true);
            String noteId=result.path("noteId").asText();
            if(!noteId.matches("[1-9][0-9]{0,18}")) throw fail("outcome_unknown","平台未返回暂存笔记标识，请先核对平台记录，勿重复创建");
            p.noteId=noteId;
            return Map.of("id",p.noteId,"uploadId",p.uploadId);
        } catch(Failure e) {
            if(e.code.equals("request_not_sent")) operations.remove(key,p);
            else p.beginFailure=e;
            throw e;
        }
    }
    private static List<FileSpec> specs(String type,JsonNode rows) {
        if(!rows.isArray() || (type.equals("IMAGE") ? rows.size()<1||rows.size()>9 : rows.size()!=2)) throw fail("invalid_params","图片需要 1–9 张；视频需要一个视频和一张独立封面");
        List<FileSpec> files=new ArrayList<>();
        for(int i=0;i<rows.size();i++) {
            JsonNode row=rows.get(i); String name=text(row,"name",200),mime=row.path("mime").asText();
            if(name.contains("/")||name.contains("\\")||name.chars().anyMatch(c->c<32)||name.contains("\"")) throw fail("invalid_params","文件名无效");
            String ext=name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
            boolean video=type.equals("VIDEO")&&i==0;
            Map<String,String> allowed=video?Map.of("mp4","video/mp4","mov","video/quicktime","webm","video/webm"):Map.of("jpg","image/jpeg","jpeg","image/jpeg","png","image/png","webp","image/webp","gif","image/gif");
            if(!Objects.equals(allowed.get(ext),mime)) throw fail("invalid_params","不支持此媒体格式，请选择 JPG/PNG/WebP/GIF 图片或 MP4/MOV/WebM 视频");
            long size=row.path("size").asLong(-1);
            if(!row.path("size").isIntegralNumber()||size<1||size>(video?50L:10L)*1024*1024) throw fail("invalid_params",video?"视频须不超过 50 MiB":"每张图片须不超过 10 MiB");
            files.add(new FileSpec(name,size,mime,ext));
        }
        return List.copyOf(files);
    }
    private Object upload(Pending p,JsonNode args,Api api) {
        if(!args.path("index").isIntegralNumber()) throw fail("invalid_params","上传文件序号无效");
        int index=args.path("index").asInt(-1);
        if(index<0||index>=p.files.size()) throw fail("invalid_params","上传文件序号无效");
        FileSpec spec=p.files.get(index);
        if(p.urls.containsKey(index)) return Map.of("uploaded",true,"received",spec.size);
        if(p.finalizeAttempted||p.saved) throw fail("upload_closed","笔记已进入确认阶段，不能替换媒体");
        if(!args.path("offset").isIntegralNumber()||!args.path("offset").canConvertToInt()) throw fail("invalid_params","上传偏移无效");
        int offset=args.path("offset").asInt(-1);
        String encoded=args.path("base64").asText();
        if(offset<0||offset>=spec.size||!args.path("base64").isTextual()||encoded.length()>4*((4*1024*1024+2)/3)||encoded.isEmpty()) throw fail("invalid_params","媒体分块或偏移无效");
        byte[] chunk;
        try { chunk=Base64.getDecoder().decode(encoded); } catch(IllegalArgumentException e) { throw fail("invalid_params","媒体编码无效"); }
        if(chunk.length==0||chunk.length>4*1024*1024||(long)offset+chunk.length>spec.size) throw fail("invalid_params","媒体分块超过大小限制");
        if(p.buffer!=null&&p.bufferIndex!=index) throw fail("upload_in_progress","请先完成当前文件上传");
        if(p.buffer==null) {
            if(offset!=0) return Map.of("uploaded",false,"received",0);
            if(operations.values().stream().anyMatch(other->other.user==p.user&&other!=p&&other.buffer!=null)) throw fail("upload_in_progress","请先完成当前账号的另一个媒体上传");
            p.buffer=new byte[(int)spec.size]; p.bufferIndex=index; p.received=0;
        }
        if(offset>p.received) return Map.of("uploaded",false,"received",p.received);
        if(offset<p.received) {
            if(offset+chunk.length>p.received||!Arrays.equals(p.buffer,offset,offset+chunk.length,chunk,0,chunk.length)) throw fail("operation_conflict","重复分块与已接收内容不一致");
        } else { System.arraycopy(chunk,0,p.buffer,offset,chunk.length); p.received+=chunk.length; }
        if(p.received<spec.size) return Map.of("uploaded",false,"received",p.received);
        byte[] bytes=p.buffer;
        if(!matches(bytes,spec.mime)) { p.buffer=null; p.received=0; p.bufferIndex=-1; throw fail("invalid_params","媒体格式与文件声明不一致，请重新选择有效文件"); }
        JsonNode policy=api.call("POST","/bqt/file/common/generatePolicy",object("ext",spec.ext),false);
        Policy parsed=policy(policy);
        try {
            int status=cos.upload(parsed.host,parsed.fields,bytes,spec.name,spec.mime);
            if(status!=200&&status!=204) throw fail("upload_failed","媒体上传未完成，请重试该文件；不会重新创建笔记");
        } catch(Failure e) { throw e; }
        catch(Exception e) { if(e instanceof InterruptedException) Thread.currentThread().interrupt(); throw fail("upload_failed","媒体上传未确认，请重试该文件；不会重新创建笔记"); }
        p.urls.put(index,parsed.url); p.buffer=null; p.bufferIndex=-1; p.received=0;
        return Map.of("uploaded",true,"received",spec.size);
    }
    private Object finish(Pending p,Api api) {
        if(p.saved) return Map.of("id",p.noteId,"saved",true);
        if(p.urls.size()!=p.files.size()) throw fail("upload_incomplete","全部媒体及封面上传成功后才能完成保存");
        String content=p.type.equals("IMAGE")?String.join(";",orderedUrls(p)):p.urls.get(0), cover=p.urls.get(p.type.equals("IMAGE")?0:1);
        if(p.finalizeAttempted) {
            // A lost response may follow a committed write. Never repeat add or finalize without verifying first.
            if(verified(p,api,content,cover)) { p.saved=true; return Map.of("id",p.noteId,"saved",true); }
            throw fail("outcome_unknown","平台尚未确认媒体保存完成，请稍后再核对；不会重复提交");
        }
        own(p,api);
        p.finalizeAttempted=true;
        JsonNode result;
        try { result=api.call("POST","/bqt/lawyer/note/updateAfterUploadSuccess",object("noteId",p.noteId,"cover",cover,"content",content),true); }
        catch(Failure e) {
            if(Set.of("remote_rejected","invalid_params","auth_required","not_owner","request_not_sent").contains(e.code)) p.finalizeAttempted=false;
            throw e;
        }
        if(!result.path("isSuccess").isBoolean()||!result.path("isSuccess").asBoolean()) throw fail("outcome_unknown","平台未确认媒体保存，请稍后核对，勿重新创建");
        if(!verified(p,api,content,cover)) throw fail("outcome_unknown","媒体确认已返回，但笔记回读尚未一致，请稍后核对");
        p.saved=true; return Map.of("id",p.noteId,"saved",true);
    }
    private static List<String> orderedUrls(Pending p) { List<String> urls=new ArrayList<>(); for(int i=0;i<p.files.size();i++) urls.add(p.urls.get(i)); return urls; }
    private static JsonNode own(Pending p,Api api) {
        JsonNode row=api.call("GET","/bqt/lawyer/note/detail?id="+p.noteId,null,false);
        if(!row.path("id").asText().equals(p.noteId)||!row.path("lawyerId").asText().equals(p.account)) throw fail("not_owner","只能确认当前律师账号创建的笔记");
        return row;
    }
    private static boolean verified(Pending p,Api api,String content,String cover) {
        JsonNode row=own(p,api);
        if(!row.path("type").asText().equals(p.type)||!row.path("status").asText().equals(p.status)||!media(row.path("content")).equals(content)
            ||!row.path("cover").asText().equals(cover)||!row.path("title").asText().equals(p.title)||!row.path("description").asText("").equals(p.description)) return false;
        if(row.hasNonNull("isDraft")) return row.path("isDraft").isIntegralNumber()&&row.path("isDraft").asInt()==0;
        if(row.hasNonNull("isNoteDraft")) return row.path("isNoteDraft").asText().equals("N");
        // The official detail VO omits isDraft; the authenticated list explicitly excludes isDraft=Y.
        JsonNode data=api.call("POST","/bqt/lawyer/note/lawyer/page",object("pageNum",1,"pageSize",100,"keyword",p.title),false);
        for(JsonNode item:data.path("list")) if(item.path("id").asText().equals(p.noteId)) return true;
        return false;
    }
    record Policy(URI host,Map<String,String> fields,String url) {}
    static Policy policy(JsonNode node) {
        try {
            URI host=URI.create(node.path("cosHost").asText());
            // Pinned official bucket, not arbitrary *.myqcloud.com buckets or caller-provided addresses.
            if(!"https".equals(host.getScheme())||!Set.of("bqt-1251512257.cos.ap-beijing.myqcloud.com").contains(host.getHost())||host.getRawUserInfo()!=null||host.getPort()!=-1||host.getRawQuery()!=null||host.getRawFragment()!=null||!(host.getPath().isEmpty()||host.getPath().equals("/"))) throw new IllegalArgumentException();
            String key=node.path("cosKey").asText();
            if(!key.matches("[A-Za-z0-9_./-]{1,512}")||key.startsWith("/")||key.contains("..")) throw new IllegalArgumentException();
            Map<String,String> fields=new LinkedHashMap<>(); fields.put("key",key); fields.put("policy",field(node,"policy")); fields.put("success_action_status","200");
            fields.put("q-sign-algorithm",field(node,"qSignAlgorithm","qsignAlgorithm")); fields.put("q-ak",field(node,"qAk","qak"));
            fields.put("q-key-time",field(node,"qKeyTime","qkeyTime")); fields.put("q-signature",field(node,"qSignature","qsignature"));
            if(!fields.get("q-sign-algorithm").equals("sha1")) throw new IllegalArgumentException();
            String[] times=fields.get("q-key-time").split(";"); long now=System.currentTimeMillis()/1000;
            if(times.length!=2||Long.parseLong(times[0])>now+60||Long.parseLong(times[1])<=now) throw new IllegalArgumentException();
            return new Policy(URI.create("https://"+host.getHost()),Map.copyOf(fields),"https://"+host.getHost()+"/"+key);
        } catch(Exception e) { throw fail("invalid_upload_policy","平台上传策略不可用或上传地址尚未受支持，请刷新后重试"); }
    }
    private static String field(JsonNode n,String... keys) {
        for(String key:keys) if(n.path(key).isTextual()) { String v=n.path(key).asText(); if(!v.isBlank()&&v.length()<=16384&&!v.contains("\r")&&!v.contains("\n")) return v; }
        throw new IllegalArgumentException();
    }
    static boolean matches(byte[] b,String mime) {
        if(mime.equals("image/jpeg")) return b.length>=3&&(b[0]&255)==255&&(b[1]&255)==216&&(b[2]&255)==255;
        if(mime.equals("image/png")) return b.length>=8&&Arrays.equals(Arrays.copyOf(b,8),new byte[]{(byte)137,80,78,71,13,10,26,10});
        if(mime.equals("image/gif")) return b.length>=6&&new String(b,0,6,StandardCharsets.US_ASCII).matches("GIF8[79]a");
        if(mime.equals("image/webp")) return b.length>=12&&new String(b,0,4,StandardCharsets.US_ASCII).equals("RIFF")&&new String(b,8,4,StandardCharsets.US_ASCII).equals("WEBP");
        if(mime.equals("video/webm")) return b.length>=4&&(b[0]&255)==26&&(b[1]&255)==69&&(b[2]&255)==223&&(b[3]&255)==163;
        return b.length>=12&&new String(b,4,4,StandardCharsets.US_ASCII).equals("ftyp");
    }
    static final class NativeCos implements CosTransport {
        private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
        public int upload(URI host,Map<String,String> fields,byte[] bytes,String name,String mime) throws Exception {
            String boundary="awd-"+UUID.randomUUID(); List<HttpRequest.BodyPublisher> chunks=new ArrayList<>();
            for(var entry:fields.entrySet()) chunks.add(HttpRequest.BodyPublishers.ofString("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+entry.getKey()+"\"\r\n\r\n"+entry.getValue()+"\r\n"));
            chunks.add(HttpRequest.BodyPublishers.ofString("--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+name+"\"\r\nContent-Type: "+mime+"\r\n\r\n"));
            chunks.add(HttpRequest.BodyPublishers.ofByteArray(bytes)); chunks.add(HttpRequest.BodyPublishers.ofString("\r\n--"+boundary+"--\r\n"));
            HttpRequest req=HttpRequest.newBuilder(host).timeout(Duration.ofMillis(CallDeadline.remainingMillis(45_000))).header("Content-Type","multipart/form-data; boundary="+boundary)
                .POST(HttpRequest.BodyPublishers.concat(chunks.toArray(HttpRequest.BodyPublisher[]::new))).build();
            long waitMillis=CallDeadline.remainingMillis(50_000);
            CompletableFuture<HttpResponse<byte[]>> future=client.sendAsync(req,ignored->new BaoqingtianTools.LimitedBody());
            try{return future.get(waitMillis,TimeUnit.MILLISECONDS).statusCode();}finally{if(!future.isDone())future.cancel(true);}
        }
    }
}
