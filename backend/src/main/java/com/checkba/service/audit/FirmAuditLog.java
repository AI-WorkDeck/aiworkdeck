// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.audit;

import com.checkba.model.entity.FirmAuditEvent;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.User;
import com.checkba.repository.FirmAuditEventRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.collab.AccountDirectoryClient;
import com.checkba.service.collab.DirectoryUnavailableException;
import com.checkba.service.lawfirm.LawFirmAuthority;
import com.checkba.util.ClientIp;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 律所管理员审计日志（readiness S20，设计见 readiness/s20/S20-audit-log-design.md）。
 *
 * <ul>
 *   <li><b>只在服务端记</b>：local-mode（桌面单机）与没配账户名录的服务器一律不记——没有律所可归属；</li>
 *   <li><b>不拖慢请求</b>：调用点只入队（事务内的调用等提交后再入队，回滚的动作不留痕）；一个后台线程解析律所、
 *       接哈希链、落库。队列满或名录多次不可用时丢弃并记 ERROR，绝不阻塞或让主流程失败；</li>
 *   <li><b>归属</b>：带项目的事件归项目所有人的律所，其余归操作人的律所；</li>
 *   <li><b>防篡改</b>：每个律所一条 SHA-256 哈希链（单写线程保证顺序），{@link #verify} 重算；</li>
 *   <li><b>隐私</b>：不记文档内容、文件字节、提示词、口令、验证码与令牌；detail 只由调用点用固定键组装。</li>
 * </ul>
 */
@Service
public class FirmAuditLog {

    private static final Logger log = LoggerFactory.getLogger(FirmAuditLog.class);
    private static final ObjectMapper JSON = new ObjectMapper().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    public static final String SUCCESS = "SUCCESS";
    public static final String FAILURE = "FAILURE";
    public static final int MAX_PAGE = 500;
    static final int MAX_QUEUE = 20_000;
    private static final long[] RETRY_MINUTES = {1, 3, 6};
    private static final Duration FIRM_CACHE_TTL = Duration.ofMinutes(10);
    private static final int MIN_RETENTION_DAYS = 90;

    private final FirmAuditEventRepository repository;
    private final LawFirmAuthority authority;
    private final AccountDirectoryClient directory;
    private final UserRepository users;
    private final ProjectRepository projects;
    private final boolean localMode;
    private final int retentionDays;

    private final ScheduledThreadPoolExecutor writer;
    private final Map<Long, CachedFirm> firmCache = new ConcurrentHashMap<>();
    /** 只由写线程读写。 */
    private final Map<String, String> lastHash = new HashMap<>();
    private final AtomicLong dropped = new AtomicLong();

    private record CachedFirm(String firmId, Instant expires) {}

    public FirmAuditLog(FirmAuditEventRepository repository, LawFirmAuthority authority, AccountDirectoryClient directory,
                        UserRepository users, ProjectRepository projects,
                        @Value("${security.local-mode:false}") boolean localMode,
                        @Value("${awd.audit.retention-days:1095}") int retentionDays) {
        this.repository = repository;
        this.authority = authority;
        this.directory = directory;
        this.users = users;
        this.projects = projects;
        this.localMode = localMode;
        this.retentionDays = Math.max(MIN_RETENTION_DAYS, retentionDays);
        this.writer = new ScheduledThreadPoolExecutor(1, r -> {
            Thread t = new Thread(r, "firm-audit");
            t.setDaemon(true);
            return t;
        });
    }

    // ==================== 事件 ====================

    /** 一条待记的事件。调用点只填事实；律所、显示名、项目名由写线程补。 */
    public static final class Event {
        final String category;
        final String action;
        String outcome = SUCCESS;
        Long actorUserId;
        Long projectId;
        String targetType;
        String targetId;
        String targetLabel;
        Long targetUserId;
        Long firmUserId;
        final Map<String, Object> detail = new LinkedHashMap<>();
        Instant occurredAt;
        /** 跨服务上报（官网）用：幂等键、来源、直接给定的律所与显示名。本服务内的调用点不用。 */
        String eventId;
        String source;
        String explicitFirmId;
        String actorNameOverride;
        String sourceIp;
        String userAgent;
        int attempts;

        private Event(String category, String action) {
            this.category = category;
            this.action = action;
        }

        public Event actor(Long userId) { this.actorUserId = userId; return this; }
        public Event project(Long projectId) { this.projectId = projectId; return this; }
        public Event failed() { this.outcome = FAILURE; return this; }

        /** 显式指定按谁的律所归档（如外部客户的动作归邀请人所在律所）；优先于项目所有人与操作人。 */
        public Event firmOf(Long userId) { this.firmUserId = userId; return this; }

        /** 官网等外部来源已知律所，直接给定（不再按名录解析）。 */
        public Event firm(String firmId) { this.explicitFirmId = firmId; return this; }

        public Event actorName(String name) { this.actorNameOverride = name; return this; }

        /** 幂等键：同一 eventId 只落一行（上报方重试安全）。 */
        public Event eventId(String id) { this.eventId = id; return this; }

        public Event source(String source) { this.source = source; return this; }

        public Event at(Instant when) { this.occurredAt = when == null ? null : when.truncatedTo(ChronoUnit.MILLIS); return this; }

        public Event from(String ip, String userAgent) { this.sourceIp = clip(ip, 64); this.userAgent = clip(userAgent, 256); return this; }

        public Event target(String type, Object id, String label) {
            this.targetType = type;
            this.targetId = id == null ? null : String.valueOf(id);
            this.targetLabel = label;
            return this;
        }

        /** 目标是一位用户：显示名由写线程按 id 查。 */
        public Event targetUser(Long userId) {
            this.targetUserId = userId;
            return target("USER", userId, null);
        }

        /** 只允许标量（字符串、数字、布尔）；调用点用固定键，绝不传请求体原文。 */
        public Event detail(String key, Object value) {
            if (key != null && value != null && (value instanceof String || value instanceof Number || value instanceof Boolean)) {
                detail.put(key, value instanceof String s ? clip(s, 200) : value);
            }
            return this;
        }
    }

    public static Event event(String category, String action) {
        return new Event(category, action);
    }

    /** 本进程是否记审计：服务端 profile 且配了账户名录。 */
    public boolean enabled() {
        return !localMode && directory.configured();
    }

    /**
     * 入队一条事件；永不抛。成功事件等事务提交后才入队（回滚的动作不留痕）；
     * {@link Event#failed()} 的拒绝/失败事件一律立即入队（同 {@link #recordNow}）——被拒的请求往往正是要回滚的那一个。
     */
    public void record(Event e) {
        if (e != null && FAILURE.equals(e.outcome)) {
            recordNow(e);
            return;
        }
        try {
            if (e == null || !enabled() || (e.actorUserId == null && e.projectId == null && e.firmUserId == null && e.explicitFirmId == null)) return;
            if (e.occurredAt == null) e.occurredAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);
            if (e.sourceIp == null && e.userAgent == null) captureRequest(e);
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() { enqueue(e); }
                });
            } else {
                enqueue(e);
            }
        } catch (Exception ex) {
            log.warn("Firm audit record failed for {}: {}", e == null ? null : e.action, ex.toString());
        }
    }

    /**
     * For a refusal: the request being refused rolls back its transaction, so an after-commit record would never be
     * written. Enqueues at once instead. Never throws; same checks as {@link #record}.
     */
    public void recordNow(Event e) {
        try {
            if (e == null || !enabled() || (e.actorUserId == null && e.projectId == null && e.firmUserId == null && e.explicitFirmId == null)) return;
            if (e.occurredAt == null) e.occurredAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);
            if (e.sourceIp == null && e.userAgent == null) captureRequest(e);
            enqueue(e);
        } catch (Exception ex) {
            log.warn("Firm audit record failed for {}: {}", e == null ? null : e.action, ex.toString());
        }
    }

    private static void captureRequest(Event e) {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs)) return;
        var request = attrs.getRequest();
        e.sourceIp = clip(ClientIp.of(request), 64);
        e.userAgent = clip(request.getHeader("User-Agent"), 256);
    }

    private void enqueue(Event e) {
        if (writer.isShutdown()) return;
        if (writer.getQueue().size() >= MAX_QUEUE) {
            long n = dropped.incrementAndGet();
            log.error("Firm audit queue full; dropped event {} (total dropped {})", e.action, n);
            return;
        }
        writer.execute(() -> write(e));
    }

    /** 测试与关停用：等队列里已有的事件写完。 */
    public void flush() {
        try {
            writer.submit(() -> { }).get(30, TimeUnit.SECONDS);
        } catch (Exception ex) {
            log.warn("Firm audit flush interrupted: {}", ex.toString());
        }
    }

    // ==================== 权限拒绝（防刷：同人同资源 10 分钟一条，全局每分钟上限） ====================

    static final long DENIED_WINDOW_MS = 10 * 60_000L;
    static final int DENIED_PER_MINUTE = 120;
    private static final int DENIED_KEYS_MAX = 50_000;
    private record DeniedSeen(long at, int suppressed) {}
    private final Map<String, DeniedSeen> deniedSeen = new ConcurrentHashMap<>();
    private final AtomicLong deniedMinute = new AtomicLong();
    private final java.util.concurrent.atomic.AtomicInteger deniedInMinute = new java.util.concurrent.atomic.AtomicInteger();

    /**
     * 记一次「权限拒绝」（非管理员读审计日志、跨所访问等）。同一人对同一资源 10 分钟内只落一条，
     * 其间被压下的次数记在下一条的 {@code suppressedRepeats}；全局每分钟最多 {@value #DENIED_PER_MINUTE} 条。
     * 探测者刷不爆日志，管理员仍能看到「有人在试」。永不抛。
     */
    public void recordDenied(Long userId, String resource, String reason) {
        try {
            if (userId == null || !enabled()) return;
            long now = System.currentTimeMillis();
            String key = userId + "|" + resource;
            DeniedSeen prev = deniedSeen.get(key);
            if (prev != null && now - prev.at() < DENIED_WINDOW_MS) {
                deniedSeen.put(key, new DeniedSeen(prev.at(), prev.suppressed() + 1));
                return;
            }
            long minute = now / 60_000L;
            if (deniedMinute.getAndSet(minute) != minute) deniedInMinute.set(0);
            if (deniedInMinute.incrementAndGet() > DENIED_PER_MINUTE) return;
            if (deniedSeen.size() > DENIED_KEYS_MAX) deniedSeen.clear();
            deniedSeen.put(key, new DeniedSeen(now, 0));
            Event e = event("ACCESS", "PERMISSION_DENIED").failed().actor(userId)
                    .target("RESOURCE", resource, resource).detail("reason", reason);
            if (prev != null && prev.suppressed() > 0) e.detail("suppressedRepeats", prev.suppressed());
            recordNow(e);
        } catch (Exception ex) {
            log.warn("Firm audit denied record failed: {}", ex.toString());
        }
    }

    public long droppedCount() {
        return dropped.get();
    }

    @PreDestroy
    void shutdown() {
        writer.shutdown();
        try {
            writer.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    // ==================== 写线程 ====================

    private void write(Event e) {
        try {
            Project project = e.projectId == null ? null : projects.findById(e.projectId).orElse(null);
            Long subject = e.firmUserId != null ? e.firmUserId
                    : project != null && project.getUserId() != null ? project.getUserId() : e.actorUserId;
            String firmId = e.explicitFirmId != null ? clip(e.explicitFirmId, 64) : firmOf(subject);
            if (firmId == null) return;
            if (e.eventId != null && repository.existsByEventId(e.eventId)) return; // 上报方重试：已落过

            FirmAuditEvent row = new FirmAuditEvent();
            row.setFirmId(firmId);
            row.setOccurredAt(e.occurredAt);
            row.setCategory(clip(e.category, 24));
            row.setAction(clip(e.action, 48));
            row.setOutcome(e.outcome);
            row.setActorUserId(e.actorUserId);
            row.setActorName(clip(e.actorNameOverride != null ? e.actorNameOverride : displayName(e.actorUserId), 128));
            row.setEventId(e.eventId);
            row.setSource(e.source);
            row.setTargetType(clip(e.targetType, 32));
            row.setTargetId(clip(e.targetId, 64));
            row.setTargetLabel(clip(e.targetLabel != null ? e.targetLabel : displayName(e.targetUserId), 256));
            row.setProjectId(e.projectId);
            row.setProjectName(clip(project == null ? null : project.getName(), 256));
            row.setSourceIp(e.sourceIp);
            row.setUserAgent(e.userAgent);
            row.setDetail(e.detail.isEmpty() ? null : JSON.writeValueAsString(e.detail));

            String prev = lastHash.computeIfAbsent(firmId,
                    f -> repository.findTopByFirmIdOrderByIdDesc(f).map(FirmAuditEvent::getHash).orElse(null));
            row.setPrevHash(prev);
            row.setHash(hash(row));
            repository.save(row);
            lastHash.put(firmId, row.getHash());
        } catch (DirectoryUnavailableException ex) {
            retry(e, ex);
        } catch (Exception ex) {
            // 写失败后链头可能与库不一致，下一次从库重读
            lastHash.clear();
            log.error("Firm audit write failed for {}: {}", e.action, ex.toString());
        }
    }

    private void retry(Event e, Exception cause) {
        if (e.attempts >= RETRY_MINUTES.length || writer.isShutdown()) {
            long n = dropped.incrementAndGet();
            log.error("Firm audit dropped {} after {} directory retries: {} (total dropped {})", e.action, e.attempts, cause.toString(), n);
            return;
        }
        long delay = RETRY_MINUTES[e.attempts++];
        writer.schedule(() -> write(e), delay, TimeUnit.MINUTES);
    }

    /** 名录里该用户所在律所；没有律所 / 没有官方账户绑定回 null。名录不可用时抛 {@link DirectoryUnavailableException}。 */
    private String firmOf(Long userId) {
        if (userId == null) return null;
        CachedFirm cached = firmCache.get(userId);
        if (cached != null && cached.expires().isAfter(Instant.now())) return cached.firmId();
        String firmId;
        try {
            firmId = authority.current(userId).firmId();
        } catch (DirectoryUnavailableException ex) {
            throw ex;
        } catch (IllegalArgumentException ex) {
            firmId = null; // 无绑定 / 不在任何律所：个人用户的动作不进律所日志
        }
        firmCache.put(userId, new CachedFirm(firmId, Instant.now().plus(FIRM_CACHE_TTL)));
        return firmId;
    }

    private String displayName(Long userId) {
        if (userId == null) return null;
        return users.findById(userId).map(FirmAuditLog::nameOf).orElse(null);
    }

    private static String nameOf(User u) {
        return u.getDisplayName() != null && !u.getDisplayName().isBlank() ? u.getDisplayName() : u.getUsername();
    }

    static String hash(FirmAuditEvent r) {
        StringBuilder sb = new StringBuilder();
        for (Object part : new Object[]{r.getPrevHash(), r.getFirmId(), r.getOccurredAt() == null ? null : r.getOccurredAt().toEpochMilli(),
                r.getCategory(), r.getAction(), r.getOutcome(), r.getActorUserId(), r.getActorName(), r.getTargetType(),
                r.getTargetId(), r.getTargetLabel(), r.getProjectId(), r.getProjectName(), r.getSourceIp(), r.getUserAgent(),
                r.getDetail()}) {
            sb.append(part == null ? "" : part).append('\u001f');
        }
        // 后加的两列只在有值时入链：此前写下的行（两列为空）哈希不变
        if (r.getEventId() != null || r.getSource() != null) {
            sb.append(r.getEventId() == null ? "" : r.getEventId()).append('\u001f')
              .append(r.getSource() == null ? "" : r.getSource()).append('\u001f');
        }
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    static String clip(String s, int max) {
        if (s == null) return null;
        String t = s.strip();
        return t.length() <= max ? t : t.substring(0, max);
    }

    // ==================== 读取（只给律所管理员；调用方已核过身份） ====================

    /** 一页筛选结果，按 id 倒序。 */
    public Map<String, Object> list(String firmId, Map<String, Object> p) {
        int limit = (int) Math.max(1, Math.min(MAX_PAGE, number(p.get("limit"), 100)));
        long before = number(p.get("beforeId"), Long.MAX_VALUE);
        Instant from = date(p.get("from"), false);
        Instant to = date(p.get("to"), true);
        String actor = text(p.get("actor"), 64).toLowerCase(Locale.ROOT);
        List<FirmAuditEvent> rows = repository.search(firmId, before <= 0 ? Long.MAX_VALUE : before,
                from == null ? Instant.EPOCH : from, to == null ? Instant.parse("9999-01-01T00:00:00Z") : to,
                text(p.get("category"), 24), text(p.get("action"), 48), number(p.get("projectId"), -1),
                actor.isEmpty() ? "" : "%" + actor.replace("\\", "").replace("%", "").replace("_", "") + "%",
                PageRequest.of(0, limit + 1));
        boolean more = rows.size() > limit;
        List<Map<String, Object>> out = new ArrayList<>();
        for (FirmAuditEvent r : rows.subList(0, Math.min(limit, rows.size()))) out.add(view(r));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("events", out);
        result.put("hasMore", more);
        result.put("nextBeforeId", out.isEmpty() ? null : out.get(out.size() - 1).get("id"));
        result.put("retentionDays", retentionDays);
        return result;
    }

    private static Map<String, Object> view(FirmAuditEvent r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.getId());
        m.put("occurredAt", r.getOccurredAt() == null ? null : r.getOccurredAt().toString());
        m.put("category", r.getCategory());
        m.put("action", r.getAction());
        m.put("outcome", r.getOutcome());
        m.put("actorUserId", r.getActorUserId());
        m.put("actorName", r.getActorName());
        m.put("targetType", r.getTargetType());
        m.put("targetId", r.getTargetId());
        m.put("targetLabel", r.getTargetLabel());
        m.put("projectId", r.getProjectId());
        m.put("projectName", r.getProjectName());
        m.put("sourceIp", r.getSourceIp());
        m.put("userAgent", r.getUserAgent());
        m.put("detail", parse(r.getDetail()));
        m.put("source", r.getSource());
        return m;
    }

    private static Object parse(String detail) {
        if (detail == null) return null;
        try {
            return JSON.readValue(detail, Map.class);
        } catch (Exception ex) {
            return null;
        }
    }

    /** 重算本律所整条哈希链；最早一行的 prevHash 是锚（更早的已按保留期清理）。 */
    public Map<String, Object> verify(String firmId) {
        long after = 0, checked = 0;
        String expectedPrev = null;
        boolean first = true;
        while (true) {
            List<FirmAuditEvent> page = repository.findByFirmIdAndIdGreaterThanOrderByIdAsc(firmId, after, PageRequest.of(0, 1000));
            if (page.isEmpty()) break;
            for (FirmAuditEvent r : page) {
                boolean linkOk = first || Objects.equals(expectedPrev, r.getPrevHash());
                if (!linkOk || !Objects.equals(hash(r), r.getHash())) {
                    return Map.of("ok", false, "checked", checked, "firstBrokenId", r.getId());
                }
                first = false;
                expectedPrev = r.getHash();
                after = r.getId();
                checked++;
            }
        }
        return Map.of("ok", true, "checked", checked);
    }

    // ==================== 保留期 ====================

    @Scheduled(cron = "${awd.audit.retention-cron:0 30 3 * * *}")
    @Transactional
    public void purgeExpired() {
        if (localMode) return;
        try {
            int n = repository.deleteOlderThan(Instant.now().minus(retentionDays, ChronoUnit.DAYS));
            if (n > 0) log.info("Firm audit retention removed {} events older than {} days", n, retentionDays);
        } catch (Exception ex) {
            log.warn("Firm audit retention purge failed: {}", ex.toString());
        }
    }

    // ==================== 参数 ====================

    private static long number(Object v, long fallback) {
        if (v instanceof Number n) return n.longValue();
        if (v instanceof String s && s.matches("-?\\d{1,19}")) {
            try {
                return Long.parseLong(s);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static String text(Object v, int max) {
        return v instanceof String s ? Objects.requireNonNullElse(clip(s, max), "") : "";
    }

    /** "yyyy-MM-dd"（按 UTC+8 当天）或 ISO 时间；{@code endExclusive} 时日期取次日零点。 */
    private static Instant date(Object v, boolean endExclusive) {
        if (!(v instanceof String s) || s.isBlank()) return null;
        try {
            if (s.length() == 10) {
                var day = java.time.LocalDate.parse(s);
                if (endExclusive) day = day.plusDays(1);
                return day.atStartOfDay(java.time.ZoneOffset.ofHours(8)).toInstant();
            }
            return Instant.parse(s);
        } catch (Exception ex) {
            throw new IllegalArgumentException(com.checkba.service.LangText.of("日期格式无效", "Invalid date"));
        }
    }
}
