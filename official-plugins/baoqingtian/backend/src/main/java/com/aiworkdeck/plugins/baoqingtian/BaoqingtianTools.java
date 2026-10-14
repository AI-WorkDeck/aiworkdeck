// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.baoqingtian;

import com.checkba.plugin.api.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import java.util.concurrent.locks.ReentrantLock;

/** Fixed official API adapter; remote credentials never leave this backend instance. */
public class BaoqingtianTools implements HostAware {
    static final ObjectMapper JSON = new ObjectMapper();
    static final String BASE = "https://uat.bqt.com";
    static final int MAX_RESPONSE = 2 * 1024 * 1024;
    // Exact upstream validation messages only: never echo arbitrary remote text or rejected values.
    private static final Map<String, String> VALIDATION_MESSAGES = Map.ofEntries(
        Map.entry("笔记标题不能为空", "平台要求填写笔记标题"),
        Map.entry("笔记类型不能为空", "平台未识别笔记类型，请检查插件请求"),
        Map.entry("请选择正确的笔记类型", "平台未接受当前笔记类型，请检查插件请求"),
        Map.entry("内容不能为空", "平台要求填写笔记正文或提供媒体内容"),
        Map.entry("笔记状态不能为空", "平台要求指定笔记状态"),
        Map.entry("请选择正确的笔记状态", "平台未接受当前笔记状态"),
        Map.entry("请选择正确的草稿标识", "平台未接受当前草稿标识，请检查插件请求"),
        Map.entry("必须指定业务类型", "平台要求选择业务类型，请刷新后重新选择"),
        Map.entry("笔记ID不能为空", "平台未识别笔记标识，请刷新列表后重试"),
        Map.entry("笔记ID不能小于1", "平台未接受笔记标识，请刷新列表后重试"),
        Map.entry("订单id不能为空", "平台未识别状态变更所需的笔记标识"),
        Map.entry("状态不能为空", "平台要求指定要变更的状态")
    );
    interface Transport { Reply request(String method, String path, String token, JsonNode body) throws Exception; }
    record Reply(int status, String body) {}
    private record Session(String token, String lawyerId, String displayName) {}
    static final class Failure extends RuntimeException {
        final String code;
        Failure(String code, String message) { super(message); this.code = code; }
    }
    private final Transport transport;
    private final NoteUploads uploads;
    private final SecureEnvelope secureEnvelope = new SecureEnvelope();
    private final Map<Long, Session> sessions = new ConcurrentHashMap<>();
    private final Map<Long, ReentrantLock> locks = new ConcurrentHashMap<>();
    private PluginHost host;
    public BaoqingtianTools() { this(new NativeTransport()); }
    BaoqingtianTools(Transport transport) { this(transport, new NoteUploads.NativeCos()); }
    BaoqingtianTools(Transport transport, NoteUploads.CosTransport cos) { this.transport = transport; this.uploads = new NoteUploads(cos); }
    @Override public void setHost(PluginHost host) { this.host = host; }

    @Tool("包晴天插件私密传输入口，仅供加密工作区页面调用。AI 请引导用户打开包晴天插件，不能构造明文请求。仅支持 transport_key 获取临时公钥与 secure 接收加密信封；不得在工具参数中放明文手机号、验证码、媒体或笔记。")
    public String baoqingtian_action(@P("transport_key 或 secure") String action, @P("JSON 加密信封") String json) {
        if ("transport_key".equals(action)) {
            try { identity(); return success(secureEnvelope.publicKey()).toString(); }
            catch (Exception e) { return failureResult(e).toString(); }
        }
        if (!"secure".equals(action)) return failureResult(fail("secure_required", "请通过包晴天插件面板的安全连接操作")).toString();
        SecureEnvelope.Request request;
        try {
            if (json == null || json.length() > 9 * 1024 * 1024) throw new IllegalArgumentException();
            request = secureEnvelope.open(JSON.readTree(json));
        } catch (Exception e) { return failureResult(fail("secure_invalid", "安全请求无法验证，请重新打开插件后重试")).toString(); }
        ObjectNode result;
        try (CallDeadline deadline = CallDeadline.open()) {
            ToolCall call = identity();
            String innerAction = request.action();
            JsonNode args = request.args();
            if (Set.of("secure", "transport_key").contains(innerAction)) throw fail("invalid_params", "不支持嵌套安全请求");
            if (args == null || !args.isObject() || args.toString().length() > ("media_upload".equals(innerAction) ? 6 * 1024 * 1024 : 100_000))
                throw fail("invalid_params", "操作参数无效或过长");
            ReentrantLock lock = locks.computeIfAbsent(call.userId(), ignored -> new ReentrantLock());
            if (!lock.tryLock(CallDeadline.remainingMillis(50_000), TimeUnit.MILLISECONDS))
                throw fail("request_not_sent", "前一操作仍在处理，请稍后继续原操作核对结果");
            try {
                CallDeadline.remainingMillis(50_000);
                result = success(execute(call.userId(), innerAction, args));
            } finally { lock.unlock(); }
        } catch (Exception e) { result = failureResult(e); }
        try { return success(secureEnvelope.seal(request, result)).toString(); }
        catch (Exception e) { return failureResult(fail("secure_invalid", "安全响应无法生成，请先核对操作结果，勿重复提交")).toString(); }
    }
    private ToolCall identity() {
        ToolCall call = host == null ? null : host.call();
        if (call == null || call.userId() == null || call.userId() <= 0 || call.projectId() == null || call.projectId() <= 0)
            throw fail("host_auth", "请先登录 AI WorkDeck 并打开项目");
        host.files().list(call.projectId(), null, false);
        return call;
    }
    private static ObjectNode success(Object data) {
        return JSON.createObjectNode().put("ok", true).set("data", JSON.valueToTree(data));
    }
    private static ObjectNode failureResult(Exception error) {
        if (error instanceof InterruptedException) Thread.currentThread().interrupt();
        if (error instanceof Failure f) return JSON.createObjectNode().put("ok", false).put("error", f.getMessage()).put("errorCode", f.code);
        return JSON.createObjectNode().put("ok", false).put("error", "操作未完成，请检查项目权限或稍后重试").put("errorCode", "unavailable");
    }
    private Object execute(long user, String action, JsonNode args) {
        if (action.equals("logout")) { sessions.remove(user); return Map.of("connected", false); }
        if (action.equals("status")) {
            Session s = sessions.get(user);
            if (s == null) return Map.of("connected", false, "displayName", "");
            JsonNode profile = request(user, "GET", "/bqt/unapp/user/info", s.token, null, false);
            if (!s.lawyerId.equals(id(profile, "id"))) { sessions.remove(user); throw fail("auth_required", "平台身份已变化，请重新登录"); }
            return Map.of("connected", true, "displayName", s.displayName, "accountId", s.lawyerId);
        }
        if (action.equals("sms") || action.equals("login")) {
            String country = args.path("countryCode").asText("+86");
            String mobile = text(args, "mobile", 16);
            if (!(country.equals("+86") && mobile.matches("1[0-9]{10}")) && !(country.equals("+852") && mobile.matches("[0-9]{8}")))
                throw fail("invalid_params", "请填写有效的中国内地或香港手机号");
            if (action.equals("sms")) {
                request(user, "GET", "/bqt/unapp/pagehome/fetchSmsCode/" + mobile + "?countryCode=%2B" + country.substring(1) + "&type=lawyer_login", null, null, true);
                return Map.of("sent", true);
            }
            String code = text(args, "authCode", 10);
            if (!code.matches("[0-9]{4,8}")) throw fail("invalid_params", "请填写有效的短信验证码");
            JsonNode logged = request(user, "POST", "/bqt/unapp/pagehome/phoneSmsLogin", null,
                object("countryCode", country, "mobile", mobile, "authCode", code, "authCodeType", "lawyer_login"), true);
            String token = text(logged, "token", 8192);
            JsonNode profile = request(user, "GET", "/bqt/unapp/user/info", token, null, false);
            String lawyerId = id(profile, "id");
            if (!profile.path("type").isIntegralNumber() || profile.path("type").asInt(-1) != 1) throw fail("not_lawyer", "请使用包晴天律师账号登录");
            // This endpoint checks the authenticated LAWYER role on the server. appUserRoleDTO is a subscription, not a role.
            request(user, "POST", "/bqt/lawyer/note/lawyer/page", token, object("pageNum", 1, "pageSize", 1), false);
            String name = profile.path("nickName").asText("包晴天律师");
            sessions.put(user, new Session(token, lawyerId, name));
            return Map.of("connected", true, "displayName", name, "accountId", lawyerId);
        }
        Session s = sessions.get(user);
        if (s == null) throw fail("auth_required", "请先连接包晴天律师账号；重启后需重新登录");
        return switch (action) {
            case "business_types" -> businessTypes(user, s);
            case "cases" -> cases(user, s, args);
            case "case_detail" -> caseView(request(user, "POST", "/bqt/lawCase/lawyer/caseInfo", s.token, object("id", id(args, "id")), false));
            case "notes" -> notes(user, s, args);
            case "note_detail" -> noteView(ownedNote(user, s, id(args, "id")));
            case "note_begin", "media_upload", "note_finish" -> uploads.execute(user, s.lawyerId, action, args, (method, path, body, write) -> request(user, method, path, s.token, body, write));
            case "note_save" -> saveNote(user, s, args);
            case "note_status" -> changeStatus(user, s, args);
            default -> throw fail("invalid_params", "不支持的包晴天操作");
        };
    }
    private Object businessTypes(long user, Session s) {
        JsonNode data = request(user, "GET", "/bqt/sys/lawBusinessType/listEnable", s.token, null, false);
        if (!data.isArray()) throw fail("invalid_response", "平台业务类型格式已变化");
        List<Object> items = new ArrayList<>();
        for (JsonNode row : data) items.add(Map.of("id", id(row, "id"), "name", row.path("name").asText("")));
        return Map.of("items", items);
    }
    private Object cases(long user, Session s, JsonNode args) {
        int page = page(args);
        String sort = args.path("sort").asText("newest_release_time");
        if (!Set.of("newest_release_time", "amount_desc", "amount_asc").contains(sort)) throw fail("invalid_params", "不支持的排序");
        JsonNode data = request(user, "POST", "/bqt/lawCase/lawyer/listAllCases", s.token, object("page", page, "limit", 20, "sort", sort), false);
        JsonNode list = data.has("list") ? data : data.path("caseList");
        return pageView(list, page, false);
    }
    private Object notes(long user, Session s, JsonNode args) {
        int page = page(args);
        ObjectNode body = object("pageNum", page, "pageSize", 20);
        if (args.hasNonNull("keyword")) {
            if (!args.path("keyword").isTextual() || args.path("keyword").asText().length() > 200) throw fail("invalid_params", "笔记搜索词须为文字且不超过 200 字");
            String keyword = args.path("keyword").asText().trim();
            if (!keyword.isEmpty()) body.put("keyword", keyword);
        }
        JsonNode data = request(user, "POST", "/bqt/lawyer/note/lawyer/page", s.token, body, false);
        return pageView(data, page, true);
    }
    private Object pageView(JsonNode data, int page, boolean notes) {
        if (!data.path("list").isArray() || !data.path("total").canConvertToLong()) throw fail("invalid_response", "平台列表格式已变化，请稍后重试");
        List<Object> items = new ArrayList<>();
        for (JsonNode row : data.path("list")) items.add(notes ? noteView(row) : caseView(row));
        return Map.of("items", items, "total", data.path("total").asLong(), "hasMore", (long) page * 20 < data.path("total").asLong(), "page", page);
    }
    private Object caseView(JsonNode row) {
        String description = row.path("demand").asText("");
        return Map.of("id", id(row, "id"), "title", description, "description", description,
            "category", row.path("topic").path("topicName").asText(""), "region", row.path("cityName").asText(row.path("areaName").asText("")),
            "budget", row.path("showMoney").asText(""), "createdAt", row.path("createTime").asText(""));
    }
    private Object noteView(JsonNode row) {
        String type = row.path("type").asText("");
        String media = media(row.path("content"));
        String status = switch (row.path("status").asText()) { case "DRAFT" -> "draft"; case "PUBLIC" -> "published"; case "PRIVATE" -> "private"; case "DELETED" -> "deleted"; default -> "unknown"; };
        return Map.of("id", id(row, "id"), "title", row.path("title").asText(""), "content", type.equals("TEXT") ? media : row.path("description").asText(""),
            "status", status, "updatedAt", row.path("updateTime").asText(row.path("createTime").asText("")), "type", type,
            "mediaCount", type.equals("TEXT") || media.isBlank() ? 0 : media.split(";").length,
            "editable", Set.of("TEXT", "IMAGE", "VIDEO").contains(type) && !Set.of("unknown", "deleted").contains(status));
    }
    private JsonNode ownedNote(long user, Session s, String noteId) {
        JsonNode row = request(user, "GET", "/bqt/lawyer/note/detail?id=" + noteId, s.token, null, false);
        if (!noteId.equals(id(row, "id")) || !s.lawyerId.equals(row.path("lawyerId").asText())) throw fail("not_owner", "只能管理当前律师账号自己的笔记");
        return row;
    }
    private Object saveNote(long user, Session s, JsonNode args) {
        String title = text(args, "title", 200);
        if (!args.path("content").isTextual() || args.path("content").asText().length() > 50_000) throw fail("invalid_params", "正文须为文字且不超过 50000 字");
        String content = args.path("content").asText();
        String state = state(args, false);
        confirm(args, state);
        ObjectNode body = object("title", title, "status", state, "isNoteDraft", "N");
        boolean edit = args.hasNonNull("id") && !args.path("id").asText().isBlank();
        String noteId = null;
        if (edit) {
            noteId = id(args, "id");
            JsonNode old = ownedNote(user, s, noteId);
            String type = old.path("type").asText();
            if (!Set.of("TEXT", "IMAGE", "VIDEO").contains(type) || old.path("status").asText().equals("DELETED")) throw fail("not_editable", "此笔记暂不支持编辑");
            if (type.equals("TEXT") && content.isBlank()) throw fail("invalid_params", "请填写有效的正文");
            body.put("noteId", noteId).put("type", type).put("content", type.equals("TEXT") ? content : media(old.path("content")));
            body.put("description", type.equals("TEXT") ? old.path("description").asText("") : content);
            for (String key : List.of("cover", "topicId", "productId", "hotSpot")) if (old.hasNonNull(key)) body.set(key, old.get(key));
        } else {
            throw fail("media_required", "新建笔记请先选择图片，或视频及独立封面，再完成媒体上传");
        }
        JsonNode response = request(user, "POST", "/bqt/lawyer/note/edit", s.token, body, true);
        if (!response.path("isSuccess").isBoolean()) throw fail("outcome_unknown", "平台未明确确认保存，请刷新笔记核对，勿重复提交");
        return Map.of("id", noteId, "saved", true);
    }
    private Object changeStatus(long user, Session s, JsonNode args) {
        String noteId = id(args, "id"), status = state(args, true);
        confirm(args, status);
        ownedNote(user, s, noteId);
        request(user, "POST", "/bqt/lawyer/note/changeStatus", s.token, object("noteId", noteId, "status", status), true);
        return Map.of("id", noteId, "saved", true);
    }
    private JsonNode request(long user, String method, String path, String token, JsonNode body, boolean write) {
        CallDeadline.remainingMillis(50_000); // Before transport: certainly not sent when the budget is exhausted.
        try {
            Reply response = transport.request(method, path, token, body);
            if (response.status == 401) { sessions.remove(user); throw fail("auth_required", "包晴天登录已失效，请重新登录"); }
            if (response.status != 200) throw fail(write ? "outcome_unknown" : "remote_error", (write ? "平台暂未确认操作结果，请先刷新核对，勿重复提交" : "平台暂时无法处理请求，请稍后重试") + "（HTTP " + response.status + "）");
            if (response.body == null || response.body.length() > MAX_RESPONSE) throw fail(write ? "outcome_unknown" : "invalid_response", "平台响应过大或格式异常，请先刷新核对操作结果");
            JsonNode root = JSON.readTree(response.body);
            if (root == null || !root.path("code").canConvertToInt()) throw fail(write ? "outcome_unknown" : "invalid_response", "平台响应异常，请先刷新核对操作结果");
            int code = root.path("code").asInt();
            if (code != 0) {
                if (code == 10029 || code == 10003) {
                    String hint = VALIDATION_MESSAGES.get(root.path("msg").asText(""));
                    if (hint != null) throw fail("invalid_params", hint + "（平台代码 " + code + "）");
                }
                if (code == 401 || code == 21008) { sessions.remove(user); throw fail("auth_required", "包晴天登录已失效，请重新登录（平台代码 " + code + "）"); }
                if (code == 21055) throw fail("certification_required", "请在包晴天工作台的资料设置中完成实名认证与律师资格认证，并确认账号状态正常（平台代码 21055）");
                if (code == 21107) throw fail("invalid_business", "该业务类型已失效，请刷新业务类型列表后重新选择（平台代码 21107）");
                if (code == 21025) throw fail("not_registered", "该手机号尚未注册律师端，请先在包晴天 APP 注册");
                if (code == 21027) throw fail("account_blocked", "该平台账号已被限制，请联系包晴天客服");
                String msg = root.path("msg").asText("").toLowerCase(Locale.ROOT);
                if (path.startsWith("/bqt/unapp/pagehome/") && (msg.contains("captcha") || msg.contains("图形") || msg.contains("人机") || msg.contains("滑块"))) throw fail("captcha_required", "平台要求安全验证，请到包晴天官方登录页完成验证");
                throw fail(write ? "outcome_unknown" : "remote_error", (write ? "平台未明确确认操作结果，请先刷新核对，勿重复提交" : "平台未接受请求，请检查登录状态或填写内容") + "（平台代码 " + code + "）");
            }
            JsonNode data = root.path("data");
            if ((data.isBoolean() && !data.asBoolean()) || (data.path("success").isBoolean() && !data.path("success").asBoolean()) || (data.path("isSuccess").isBoolean() && !data.path("isSuccess").asBoolean())) throw fail("remote_rejected", "平台未完成此操作，请刷新核对后重试");
            return data;
        } catch (Failure e) { throw e; }
        catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw fail(write ? "outcome_unknown" : "network_error", write ? "未收到平台确认，操作结果尚不确定；请先刷新核对，勿重复提交" : "暂时无法连接包晴天，请稍后重试");
        }
    }
    static ObjectNode object(Object... pairs) { ObjectNode node = JSON.createObjectNode(); for (int i = 0; i < pairs.length; i += 2) node.set((String) pairs[i], JSON.valueToTree(pairs[i + 1])); return node; }
    static Failure fail(String code, String message) { return new Failure(code, message); }
    static String text(JsonNode args, String key, int max) { String value = args.path(key).asText(""); if (value.isBlank() || value.length() > max) throw fail("invalid_params", "请填写有效的" + switch(key) { case "title" -> "标题"; case "content" -> "正文"; case "mobile" -> "手机号"; case "authCode" -> "验证码"; default -> "必要信息"; }); return value; }
    static String id(JsonNode args, String key) { String value = args.path(key).asText(""); if (!value.matches("[1-9][0-9]{0,18}")) throw fail("invalid_params", "笔记、案源或业务类型标识无效"); return value; }
    private static int page(JsonNode args) { int p = args.path("page").asInt(1); if (p < 1 || p > 10000) throw fail("invalid_params", "页码无效"); return p; }
    static String state(JsonNode args, boolean deleting) { return switch (args.path("status").asText("draft")) { case "draft" -> "DRAFT"; case "published" -> "PUBLIC"; case "private" -> "PRIVATE"; case "deleted" -> { if (!deleting) throw fail("invalid_params", "保存不能执行删除"); yield "DELETED"; } default -> throw fail("invalid_params", "笔记状态无效"); }; }
    private static void confirm(JsonNode args, String state) { if ((state.equals("PUBLIC") || state.equals("DELETED")) && !args.path("confirmed").asBoolean(false)) throw fail("confirmation_required", "公开发布或删除前请明确确认"); }
    static String media(JsonNode value) { if (!value.isArray()) return value.asText(""); List<String> parts = new ArrayList<>(); value.forEach(v -> parts.add(v.asText())); return String.join(";", parts); }

    static final class NativeTransport implements Transport {
        private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
        @Override public Reply request(String method, String path, String token, JsonNode body) throws Exception {
            if (!path.startsWith("/bqt/") || path.contains("\r") || path.contains("\n")) throw new IOException("Invalid path");
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(BASE + path)).timeout(Duration.ofMillis(CallDeadline.remainingMillis(25_000)))
                .header("User-Origin", "lawyer_pc").header("version", "v2.2.1").header("business", "BQT_LAWYER").header("Accept", "application/json");
            if (token != null) b.header("appToken", token);
            if (method.equals("GET")) b.GET(); else b.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString()));
            long waitMillis = CallDeadline.remainingMillis(30_000);
            CompletableFuture<HttpResponse<byte[]>> future = client.sendAsync(b.build(), ignored -> new LimitedBody());
            try { HttpResponse<byte[]> r = future.get(waitMillis, TimeUnit.MILLISECONDS); return new Reply(r.statusCode(), new String(r.body(), java.nio.charset.StandardCharsets.UTF_8)); }
            finally { if (!future.isDone()) future.cancel(true); }
        }
    }
    static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        public CompletionStage<byte[]> getBody() { return result; }
        public void onSubscribe(Flow.Subscription s) { subscription = s; s.request(1); }
        public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer b : buffers) {
                if (bytes.size() + b.remaining() > MAX_RESPONSE) { subscription.cancel(); result.completeExceptionally(new IOException("Response too large")); return; }
                byte[] chunk = new byte[b.remaining()]; b.get(chunk); bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }
        public void onError(Throwable t) { result.completeExceptionally(t); }
        public void onComplete() { result.complete(bytes.toByteArray()); }
    }
}
