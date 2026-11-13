// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.User;
import com.checkba.model.entity.UserActivityLog;
import com.checkba.model.entity.lawfirm.LawFirmBill;
import com.checkba.model.entity.lawfirm.LawFirmBillingTerms;
import com.checkba.model.entity.lawfirm.LawFirmCollection;
import com.checkba.model.entity.lawfirm.LawFirmInvoice;
import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import com.checkba.model.entity.lawfirm.LawFirmTimeEntry;
import com.checkba.model.entity.lawfirm.LawFirmTimeEntryAudit;
import com.checkba.model.entity.lawfirm.LawFirmTimekeeper;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserActivityLogRepository;
import com.checkba.repository.UserRepository;
import com.checkba.repository.lawfirm.LawFirmBillRepository;
import com.checkba.repository.lawfirm.LawFirmBillingTermsRepository;
import com.checkba.repository.lawfirm.LawFirmCollectionRepository;
import com.checkba.repository.lawfirm.LawFirmInvoiceRepository;
import com.checkba.repository.lawfirm.LawFirmMatterIntakeRepository;
import com.checkba.repository.lawfirm.LawFirmTimeEntryAuditRepository;
import com.checkba.repository.lawfirm.LawFirmTimeEntryRepository;
import com.checkba.repository.lawfirm.LawFirmTimekeeperRepository;
import com.checkba.service.LangText;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 计时收费：工作记录 → 计费工时 → 合伙人审核 → 账单 → 客户确认 → 既有发票申请与回款台账 → 实现率。
 *
 * <p>与「工作记录」的关系：律师不另填一张工时表。{@code timeImport} 把本人在日期范围内的工作记录
 * （{@link UserActivityLog}，活动记录器按文件/网页会话写入、已扣空闲、带 projectId）按「项目 × 日」汇总成草稿工时；
 * 律师在「工作记录 › 计费工时」里改描述、改时长、标可收费或补录，再提交审核。
 *
 * <p>与收费台账的关系：账单在客户确认时调用 {@link LawFirmManagementService#submitInvoice} 生成一张普通的
 * 发票申请（{@code lawfirm_invoice}），之后开票、回款核销、ERP 导出全走原台账；实现率里的「实收」只读
 * {@code lawfirm_collection} 中核销到该发票的真实回款，不另记一套钱。
 *
 * <p>与本机台账同样只在桌面端（local-mode）可用：表上没有律所归属，服务器上无法按律所隔离。
 * 金额与时长口径见 {@link LawFirmBillingMath}。
 */
@Service
@RequiredArgsConstructor
public class LawFirmBillingService {

    public static final Set<String> ACTIONS = Set.of(
            "timeMine", "timeImport", "timeSave", "timeDelete", "timeSubmit",
            "timeReviewList", "timeReview", "timeApproveAll",
            "billingRates", "billingSaveTimekeeper", "billingSaveTerms",
            "billPreview", "billCreate", "billList", "billSend", "billCancel", "billConfirm",
            "billingMetrics", "billingSeedDemo");

    static final Set<String> LEVELS = Set.of("PARTNER", "COUNSEL", "SENIOR_ASSOCIATE", "ASSOCIATE", "PARALEGAL");
    /** 活动记录里不算律师工时的类型：AI 工具耗时与律师打开文件的时间重叠，登录是瞬时事件。 */
    static final Set<String> NON_WORK_ACTIONS = Set.of("ai_tool", "LOGIN");
    static final int MAX_RANGE_DAYS = 92;
    static final int MAX_ACTIVITY_ROWS = 20_000;

    private final LawFirmTimeEntryRepository entries;
    private final LawFirmTimeEntryAuditRepository audits;
    private final LawFirmTimekeeperRepository timekeepers;
    private final LawFirmBillingTermsRepository termsRepository;
    private final LawFirmBillRepository bills;
    private final LawFirmMatterIntakeRepository intakes;
    private final LawFirmInvoiceRepository invoices;
    private final LawFirmCollectionRepository collections;
    private final UserActivityLogRepository activityLogs;
    private final ProjectRepository projects;
    private final UserRepository users;
    private final LawFirmManagementService ledger;
    private final LawFirmAccessPolicy access;
    private final ObjectMapper objectMapper;

    @Transactional
    public Map<String, Object> execute(Long userId, Long projectId, String action, Map<String, Object> rawParams) {
        if (userId == null) throw new IllegalArgumentException(LangText.of("请先登录", "Please sign in first"));
        ledger.requireLocalLedger();
        Map<String, Object> p = rawParams == null ? Map.of() : rawParams;
        return switch (action) {
            case "timeMine" -> timeMine(userId, p);
            case "timeImport" -> timeImport(userId, p);
            case "timeSave" -> timeSave(userId, p);
            case "timeDelete" -> timeDelete(userId, p);
            case "timeSubmit" -> timeSubmit(userId, p);
            case "timeReviewList" -> timeReviewList(userId, p);
            case "timeReview" -> timeReview(userId, p);
            case "timeApproveAll" -> timeApproveAll(userId, p);
            case "billingRates" -> billingRates(userId);
            case "billingSaveTimekeeper" -> saveTimekeeper(userId, p);
            case "billingSaveTerms" -> saveTerms(userId, p);
            case "billPreview" -> billPreview(userId, p);
            case "billCreate" -> billCreate(userId, p);
            case "billList" -> billList(userId, p);
            case "billSend" -> billSend(userId, p);
            case "billCancel" -> billCancel(userId, p);
            case "billConfirm" -> billConfirm(userId, p);
            case "billingMetrics" -> billingMetrics(userId, p);
            case "billingSeedDemo" -> seedDemo(userId);
            default -> throw new IllegalArgumentException(LangText.of("不支持的计时收费操作：", "Unsupported time billing action: ") + action);
        };
    }

    // ───────────────────────────── 律师：我的计费工时 ─────────────────────────────

    Map<String, Object> timeMine(Long userId, Map<String, Object> p) {
        LocalDate[] range = range(p);
        Ctx ctx = new Ctx();
        List<LawFirmTimeEntry> mine = entries.findByUserIdAndWorkDateBetweenOrderByWorkDateDescIdDesc(userId, range[0], range[1])
                .stream().filter(e -> !"DISMISSED".equals(e.getStatus())).toList();
        // 审核结论（退回理由、核减、不收费）回给律师本人看
        Map<Long, List<LawFirmTimeEntryAudit>> trail = audits.findByEntryIdInOrderByIdAsc(mine.stream().map(LawFirmTimeEntry::getId).toList())
                .stream().collect(Collectors.groupingBy(LawFirmTimeEntryAudit::getEntryId));
        List<Map<String, Object>> rows = mine.stream().map(e -> {
            Map<String, Object> v = entryView(e, ctx, false);
            v.put("audit", trail.getOrDefault(e.getId(), List.of()).stream().map(this::auditView).toList());
            return v;
        }).toList();
        List<Map<String, Object>> targets = new ArrayList<>();
        Set<Long> linkedIntakes = new LinkedHashSet<>();
        for (Project pr : projects.findByUserIdOrderByCreatedAtDesc(userId)) {
            if (pr.isScratchWorkspace() || pr.isLooseFileWorkspace()) continue;
            LawFirmMatterIntake in = ctx.intakeForProject(pr.getId());
            if (in != null) linkedIntakes.add(in.getId());
            targets.add(target("p:" + pr.getId(), pr.getName(), in));
        }
        for (LawFirmMatterIntake in : ctx.allIntakes()) {
            if (linkedIntakes.contains(in.getId()) || "REJECTED_CONFLICT".equals(in.getStatus())) continue;
            if (in.getProjectId() != null && projects.existsById(in.getProjectId())) continue;
            targets.add(target("i:" + in.getId(), in.getTitle(), in));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", range[0].toString());
        out.put("to", range[1].toString());
        out.put("entries", rows);
        out.put("targets", targets);
        out.put("incrementMinutes", LawFirmBillingMath.INCREMENT_MINUTES);
        return out;
    }

    private static Map<String, Object> target(String key, String label, LawFirmMatterIntake in) {
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("key", key);
        t.put("label", label);
        t.put("intakeId", in == null ? null : in.getId());
        t.put("matterTitle", in == null ? null : in.getTitle());
        t.put("clientName", in == null ? null : in.getClientName());
        return t;
    }

    /** 本人工作记录按「项目 × 日」汇总成草稿工时；同一项目同一天只生成一条，律师改过的不覆盖。 */
    Map<String, Object> timeImport(Long userId, Map<String, Object> p) {
        LocalDate[] range = range(p);
        LocalDate to = range[1].isAfter(LocalDate.now()) ? LocalDate.now() : range[1];
        List<UserActivityLog> logs = activityLogs.findByUserIdAndTimestampGreaterThanEqualAndTimestampLessThanOrderByTimestampDesc(
                userId, range[0].atStartOfDay(), to.plusDays(1).atStartOfDay(), PageRequest.of(0, MAX_ACTIVITY_ROWS));
        record Key(Long projectId, LocalDate date) {}
        Map<Key, Long> millis = new LinkedHashMap<>();
        Map<Key, Set<String>> objects = new HashMap<>();
        Map<Long, Project> projectCache = new HashMap<>();
        for (UserActivityLog log : logs) {
            if (log.getProjectId() == null || log.getDuration() == null || log.getDuration() <= 0
                    || log.getTimestamp() == null || NON_WORK_ACTIONS.contains(log.getActionType())) continue;
            Project pr = projectCache.computeIfAbsent(log.getProjectId(), id -> projects.findById(id).orElse(null));
            if (pr == null || pr.isScratchWorkspace() || pr.isLooseFileWorkspace()) continue;
            Key k = new Key(log.getProjectId(), log.getTimestamp().toLocalDate());
            millis.merge(k, log.getDuration(), Long::sum);
            if (log.getTargetName() != null && !log.getTargetName().isBlank()) {
                objects.computeIfAbsent(k, x -> new LinkedHashSet<>()).add(log.getTargetName().trim());
            }
        }
        String name = displayName(userId);
        int created = 0, updated = 0, kept = 0, tooShort = 0;
        Instant now = Instant.now();
        List<Map.Entry<Key, Long>> ordered = new ArrayList<>(millis.entrySet());
        ordered.sort(Comparator.comparing((Map.Entry<Key, Long> e) -> e.getKey().date()).thenComparing(e -> e.getKey().projectId()));
        for (Map.Entry<Key, Long> agg : ordered) {
            int minutes = LawFirmBillingMath.minutesFromCapturedMillis(agg.getValue());
            if (minutes == 0) { tooShort++; continue; }
            Key k = agg.getKey();
            String sourceKey = "WR:" + k.projectId() + ":" + k.date();
            String description = describe(objects.getOrDefault(k, Set.of()));
            LawFirmTimeEntry existing = entries.findByUserIdAndSourceKey(userId, sourceKey).orElse(null);
            if (existing == null) {
                entries.save(LawFirmTimeEntry.builder()
                        .userId(userId).timekeeperName(name).projectId(k.projectId()).workDate(k.date())
                        .capturedMinutes(minutes).minutes(minutes).description(description)
                        .billableClaimed(true).billable(true).source("WORK_RECORD").sourceKey(sourceKey)
                        .edited(false).status("DRAFT").createdAt(now).updatedAt(now).build());
                created++;
            } else if ("DRAFT".equals(existing.getStatus()) && !Boolean.TRUE.equals(existing.getEdited())
                    && (!Objects.equals(existing.getCapturedMinutes(), minutes) || !Objects.equals(existing.getDescription(), description))) {
                existing.setCapturedMinutes(minutes);
                existing.setMinutes(minutes);
                existing.setDescription(description);
                existing.setUpdatedAt(now);
                entries.save(existing);
                updated++;
            } else {
                if ("DRAFT".equals(existing.getStatus()) && !Objects.equals(existing.getCapturedMinutes(), minutes)) {
                    existing.setCapturedMinutes(minutes);
                    existing.setUpdatedAt(now);
                    entries.save(existing);
                }
                kept++;
            }
        }
        Map<String, Object> out = new LinkedHashMap<>(timeMine(userId, p));
        out.put("created", created);
        out.put("updated", updated);
        out.put("kept", kept);
        out.put("tooShort", tooShort);
        return out;
    }

    private static String describe(Set<String> objects) {
        if (objects.isEmpty()) return LangText.of("处理项目文件", "Worked on matter files");
        List<String> names = objects.stream().limit(5).toList();
        String joined = String.join(LangText.isEnglish() ? ", " : "、", names);
        if (objects.size() > names.size()) {
            joined += LangText.of(" 等 " + objects.size() + " 项", " and " + (objects.size() - names.size()) + " more");
        }
        return LangText.of("处理：", "Worked on: ") + joined;
    }

    Map<String, Object> timeSave(Long userId, Map<String, Object> p) {
        Long id = longVal(p.get("id"));
        Instant now = Instant.now();
        LawFirmTimeEntry e;
        if (id == null) {
            e = LawFirmTimeEntry.builder().userId(userId).timekeeperName(displayName(userId))
                    .source("MANUAL").status("DRAFT").edited(true).billableClaimed(true).billable(true)
                    .createdAt(now).build();
        } else {
            e = ownEntry(userId, id);
            if (!Set.of("DRAFT", "RETURNED").contains(e.getStatus())) {
                throw new IllegalStateException(LangText.of("已提交审核的工时不能再修改；如需更正请联系审核合伙人退回", "Submitted entries cannot be edited; ask the reviewing partner to return it"));
            }
            e.setEdited(true);
        }
        if (p.containsKey("target") || id == null) applyTarget(e, string(p.get("target")));
        if (p.containsKey("workDate") || id == null) {
            LocalDate d = date(p.get("workDate"), null);
            if (d == null) throw new IllegalArgumentException(LangText.of("请填写工作日期", "Please enter the work date"));
            if (d.isAfter(LocalDate.now())) throw new IllegalArgumentException(LangText.of("工作日期不能晚于今天", "Work date cannot be in the future"));
            e.setWorkDate(d);
        }
        if (p.containsKey("hours") || id == null) e.setMinutes(LawFirmBillingMath.minutesFromHours(p.get("hours")));
        if (p.containsKey("description") || id == null) e.setDescription(description(p.get("description"), true));
        if (p.containsKey("billable")) {
            boolean billable = !Boolean.FALSE.equals(boolVal(p.get("billable")));
            e.setBillable(billable);
            e.setBillableClaimed(billable);
        }
        e.setUpdatedAt(now);
        e = entries.save(e);
        return Map.of("entry", entryView(e, new Ctx(), false));
    }

    private void applyTarget(LawFirmTimeEntry e, String target) {
        if (target == null || !target.matches("[pi]:[1-9][0-9]{0,18}")) {
            throw new IllegalArgumentException(LangText.of("请选择项目或事项", "Please choose a project or matter"));
        }
        Long tid = Long.parseLong(target.substring(2));
        if (target.startsWith("p:")) {
            Project pr = projects.findById(tid).orElseThrow(() -> new IllegalArgumentException(LangText.of("项目不存在", "Project not found")));
            if (!Objects.equals(pr.getUserId(), e.getUserId()) && !access.canViewFirmWide(e.getUserId())) {
                throw new IllegalArgumentException(LangText.of("项目不存在", "Project not found"));
            }
            e.setProjectId(pr.getId());
            e.setIntakeId(null);
        } else {
            LawFirmMatterIntake in = intakes.findById(tid).orElseThrow(() -> new IllegalArgumentException(LangText.of("事项不存在", "Matter not found")));
            e.setIntakeId(in.getId());
            e.setProjectId(in.getProjectId());
        }
    }

    Map<String, Object> timeDelete(Long userId, Map<String, Object> p) {
        LawFirmTimeEntry e = ownEntry(userId, longVal(p.get("id")));
        if (!Set.of("DRAFT", "RETURNED").contains(e.getStatus())) {
            throw new IllegalStateException(LangText.of("已提交审核的工时不能删除", "Submitted entries cannot be deleted"));
        }
        if ("WORK_RECORD".equals(e.getSource())) {
            // 保留一条「已忽略」，重新从工作记录生成时不再冒出来
            e.setStatus("DISMISSED");
            e.setUpdatedAt(Instant.now());
            entries.save(e);
        } else {
            entries.delete(e);
        }
        return Map.of("deleted", e.getId());
    }

    Map<String, Object> timeSubmit(Long userId, Map<String, Object> p) {
        List<Long> ids = longList(p.get("ids"));
        if (ids.isEmpty()) throw new IllegalArgumentException(LangText.of("请选择要提交的工时", "Please choose entries to submit"));
        String actor = displayName(userId);
        Instant now = Instant.now();
        int submitted = 0;
        List<String> skipped = new ArrayList<>();
        for (Long id : ids) {
            LawFirmTimeEntry e = ownEntry(userId, id);
            if (!Set.of("DRAFT", "RETURNED").contains(e.getStatus())) continue;
            if (e.getProjectId() == null && e.getIntakeId() == null) {
                skipped.add(e.getWorkDate() + " " + LangText.of("未选项目", "no project"));
                continue;
            }
            e.setStatus("SUBMITTED");
            e.setSubmittedAt(now);
            e.setUpdatedAt(now);
            entries.save(e);
            audit(e, userId, actor, "SUBMIT", Map.of("minutes", change(null, e.getMinutes())), null);
            submitted++;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("submitted", submitted);
        out.put("skipped", skipped);
        return out;
    }

    // ───────────────────────────── 合伙人：月底审核 ─────────────────────────────

    Map<String, Object> timeReviewList(Long userId, Map<String, Object> p) {
        LocalDate[] range = range(p);
        String status = string(p.get("status"));
        Ctx ctx = new Ctx();
        List<LawFirmTimeEntry> rows = entries.findByWorkDateBetweenOrderByWorkDateAscIdAsc(range[0], range[1]).stream()
                .filter(e -> Set.of("SUBMITTED", "APPROVED", "BILLED").contains(e.getStatus()))
                .filter(e -> status == null || status.isBlank() || status.equals(e.getStatus()))
                .filter(e -> canReview(userId, ctx.intakeFor(e)))
                .toList();
        Map<Long, List<LawFirmTimeEntryAudit>> trail = audits.findByEntryIdInOrderByIdAsc(rows.stream().map(LawFirmTimeEntry::getId).toList())
                .stream().collect(Collectors.groupingBy(LawFirmTimeEntryAudit::getEntryId, LinkedHashMap::new, Collectors.toList()));
        List<Map<String, Object>> views = new ArrayList<>();
        for (LawFirmTimeEntry e : rows) {
            Map<String, Object> v = entryView(e, ctx, true);
            v.put("audit", trail.getOrDefault(e.getId(), List.of()).stream().map(this::auditView).toList());
            views.add(v);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", range[0].toString());
        out.put("to", range[1].toString());
        out.put("entries", views);
        out.put("firmWide", access.canViewFirmWide(userId));
        return out;
    }

    Map<String, Object> timeReview(Long userId, Map<String, Object> p) {
        Long id = longVal(p.get("id"));
        String op = string(p.get("op"));
        Ctx ctx = new Ctx();
        LawFirmTimeEntry e = entries.findById(id == null ? -1L : id)
                .orElseThrow(() -> new IllegalArgumentException(LangText.of("工时不存在", "Time entry not found")));
        LawFirmMatterIntake intake = ctx.intakeFor(e);
        requireReviewer(userId, intake);
        if (!Set.of("SUBMITTED", "APPROVED").contains(e.getStatus())) {
            throw new IllegalStateException(LangText.of("只有待审核或已通过、尚未进账单的工时可以审核", "Only submitted or approved entries that are not on a bill can be reviewed"));
        }
        String reason = trimTo(string(p.get("reason")), 500);
        String actor = displayName(userId);
        Map<String, Object> detail = new LinkedHashMap<>();
        String action;
        switch (op == null ? "" : op) {
            case "ADJUST" -> {
                if (p.containsKey("billedHours") && !String.valueOf(p.get("billedHours")).isBlank()) {
                    int billed = LawFirmBillingMath.minutesFromHours(p.get("billedHours"));
                    if (billed > e.getMinutes()) {
                        throw new IllegalArgumentException(LangText.of("核定时长不能超过律师申报的时长", "Approved hours cannot exceed the hours recorded by the lawyer"));
                    }
                    if (billed != e.effectiveBilledMinutes()) {
                        if (billed < e.getMinutes() && (reason == null || reason.isBlank())) {
                            throw new IllegalArgumentException(LangText.of("核减工时请填写理由", "Please give a reason for the write-down"));
                        }
                        detail.put("billedMinutes", change(e.effectiveBilledMinutes(), billed));
                        e.setBilledMinutes(billed);
                    }
                }
                if (p.containsKey("description")) {
                    String desc = description(p.get("description"), true);
                    if (!Objects.equals(desc, e.getDescription())) {
                        detail.put("description", change(e.getDescription(), desc));
                        e.setDescription(desc);
                    }
                }
                if (detail.isEmpty()) return Map.of("entry", entryView(e, ctx, true));
                action = detail.containsKey("billedMinutes") ? "WRITE_DOWN" : "EDIT";
                if (detail.size() > 1) action = "WRITE_DOWN_EDIT";
            }
            case "NO_CHARGE" -> {
                if (reason == null || reason.isBlank()) {
                    throw new IllegalArgumentException(LangText.of("标记不收费请填写理由", "Please give a reason for marking no charge"));
                }
                detail.put("billable", change(e.getBillable(), false));
                e.setBillable(false);
                action = "NO_CHARGE";
            }
            case "CHARGE" -> {
                detail.put("billable", change(e.getBillable(), true));
                e.setBillable(true);
                action = "CHARGE";
            }
            case "APPROVE" -> {
                if (intake == null) {
                    throw new IllegalStateException(LangText.of("这条工时所在项目尚未在律所管理中立案，不能出账单；请先在「收案与立项」登记并关联项目",
                            "This entry's project has no matter in Law Firm Management; register the matter and link the project first"));
                }
                Rate rate = resolveRate(e.getUserId(), intake.getId());
                if (rate == null) {
                    throw new IllegalStateException(LangText.of("未设置该律师的小时费率，请先在「费率与约定」中设置：", "No hourly rate for this lawyer; set it under Rates & terms first: ") + nameOf(e));
                }
                e.setIntakeId(intake.getId());
                e.setRateCents(rate.rateCents());
                e.setStandardRateCents(rate.standardRateCents());
                if (e.getBilledMinutes() == null) e.setBilledMinutes(e.getMinutes());
                e.setStatus("APPROVED");
                detail.put("status", change("SUBMITTED", "APPROVED"));
                detail.put("rateCents", change(null, rate.rateCents()));
                action = "APPROVE";
            }
            case "RETURN" -> {
                if (reason == null || reason.isBlank()) {
                    throw new IllegalArgumentException(LangText.of("退回请填写理由", "Please give a reason for returning the entry"));
                }
                detail.put("status", change(e.getStatus(), "RETURNED"));
                e.setStatus("RETURNED");
                e.setRateCents(null);
                e.setStandardRateCents(null);
                action = "RETURN";
            }
            default -> throw new IllegalArgumentException(LangText.of("不支持的审核操作", "Unsupported review operation"));
        }
        Instant now = Instant.now();
        e.setReviewedByUserId(userId);
        e.setReviewedByName(actor);
        e.setReviewedAt(now);
        e.setUpdatedAt(now);
        e = entries.save(e);
        audit(e, userId, actor, action, detail, reason);
        Map<String, Object> v = entryView(e, ctx, true);
        v.put("audit", audits.findByEntryIdInOrderByIdAsc(List.of(e.getId())).stream().map(this::auditView).toList());
        return Map.of("entry", v);
    }

    Map<String, Object> timeApproveAll(Long userId, Map<String, Object> p) {
        int approved = 0;
        List<String> failed = new ArrayList<>();
        for (Long id : longList(p.get("ids"))) {
            LawFirmTimeEntry e = entries.findById(id).orElse(null);
            if (e == null || !"SUBMITTED".equals(e.getStatus())) continue;
            try {
                timeReview(userId, Map.of("id", id, "op", "APPROVE"));
                approved++;
            } catch (IllegalStateException | IllegalArgumentException ex) {
                failed.add(e.getWorkDate() + " " + nameOf(e) + "：" + ex.getMessage());
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("approved", approved);
        out.put("failed", failed);
        return out;
    }

    // ───────────────────────────── 费率与事项约定 ─────────────────────────────

    Map<String, Object> billingRates(Long userId) {
        access.requireFirmWide(userId);
        Map<Long, LawFirmTimekeeper> cards = timekeepers.findAll().stream()
                .collect(Collectors.toMap(LawFirmTimekeeper::getUserId, Function.identity(), (a, b) -> a));
        List<Map<String, Object>> people = new ArrayList<>();
        for (User u : users.findAll()) {
            LawFirmTimekeeper card = cards.get(u.getId());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("userId", u.getId());
            row.put("name", firstNonBlank(u.getDisplayName(), u.getUsername()));
            row.put("level", card == null ? null : card.getLevel());
            row.put("standardRateCents", card == null ? null : card.getStandardRateCents());
            people.add(row);
        }
        Map<Long, Long> billedByIntake = new HashMap<>();
        for (LawFirmBill b : bills.findAll()) {
            if (!"CANCELLED".equals(b.getStatus())) billedByIntake.merge(b.getIntakeId(), nz(b.getTotalCents()), Long::sum);
        }
        Map<Long, LawFirmBillingTerms> terms = termsRepository.findAll().stream()
                .collect(Collectors.toMap(LawFirmBillingTerms::getIntakeId, Function.identity(), (a, b) -> a));
        List<Map<String, Object>> matters = new ArrayList<>();
        for (LawFirmMatterIntake in : intakes.findAllByOrderByCreatedAtDescIdDesc()) {
            if ("REJECTED_CONFLICT".equals(in.getStatus())) continue;
            LawFirmBillingTerms t = terms.get(in.getId());
            Map<String, Object> row = matterRef(in);
            row.put("discountBps", t == null ? 0 : nzi(t.getDiscountBps()));
            row.put("capCents", t == null ? null : t.getCapCents());
            row.put("levelRates", t == null ? Map.of() : levelRates(t));
            row.put("billedToDateCents", billedByIntake.getOrDefault(in.getId(), 0L));
            matters.add(row);
        }
        matters.sort(Comparator.comparing((Map<String, Object> m) -> !"HOURLY".equals(m.get("feeMode"))));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("timekeepers", people);
        out.put("matters", matters);
        out.put("levels", List.of("PARTNER", "COUNSEL", "SENIOR_ASSOCIATE", "ASSOCIATE", "PARALEGAL"));
        return out;
    }

    Map<String, Object> saveTimekeeper(Long userId, Map<String, Object> p) {
        access.requireFirmWide(userId);
        Long target = longVal(p.get("userId"));
        User u = users.findById(target == null ? -1L : target)
                .orElseThrow(() -> new IllegalArgumentException(LangText.of("律师不存在", "Lawyer not found")));
        String level = string(p.get("level"));
        if (level == null || !LEVELS.contains(level)) throw new IllegalArgumentException(LangText.of("请选择律师级别", "Please choose a level"));
        Long rate = LawFirmBillingMath.centsFromYuan(p.get("standardRateYuan"));
        if (rate == null || rate <= 0) throw new IllegalArgumentException(LangText.of("标准小时费率须大于 0", "Standard hourly rate must be greater than 0"));
        LawFirmTimekeeper card = timekeepers.findByUserId(u.getId()).orElseGet(() -> LawFirmTimekeeper.builder().userId(u.getId()).build());
        card.setDisplayName(firstNonBlank(u.getDisplayName(), u.getUsername()));
        card.setLevel(level);
        card.setStandardRateCents(rate);
        card.setUpdatedAt(Instant.now());
        timekeepers.save(card);
        return billingRates(userId);
    }

    Map<String, Object> saveTerms(Long userId, Map<String, Object> p) {
        LawFirmMatterIntake in = intake(longVal(p.get("intakeId")));
        requireReviewer(userId, in);
        LawFirmBillingTerms t = termsRepository.findByIntakeId(in.getId())
                .orElseGet(() -> LawFirmBillingTerms.builder().intakeId(in.getId()).build());
        t.setDiscountBps(LawFirmBillingMath.bpsFromPercent(p.get("discountPercent")));
        t.setCapCents(LawFirmBillingMath.centsFromYuan(p.get("capYuan")));
        Map<String, Long> rates = new LinkedHashMap<>();
        if (p.get("levelRates") instanceof Map<?, ?> m) {
            for (Map.Entry<?, ?> en : m.entrySet()) {
                String level = String.valueOf(en.getKey());
                if (!LEVELS.contains(level)) continue;
                Long cents = LawFirmBillingMath.centsFromYuan(en.getValue());
                if (cents != null && cents > 0) rates.put(level, cents);
            }
        }
        t.setLevelRatesJson(toJson(rates));
        t.setUpdatedAt(Instant.now());
        termsRepository.save(t);
        return access.canViewFirmWide(userId) ? billingRates(userId) : Map.of("saved", true);
    }

    private Map<String, Long> levelRates(LawFirmBillingTerms t) {
        if (t == null || t.getLevelRatesJson() == null || t.getLevelRatesJson().isBlank()) return Map.of();
        try {
            return objectMapper.readValue(t.getLevelRatesJson(), new TypeReference<LinkedHashMap<String, Long>>() {});
        } catch (Exception ex) {
            return Map.of();
        }
    }

    record Rate(String level, long rateCents, long standardRateCents) {}

    /** 适用费率：事项按级别约定的费率优先，否则所内标准费率；律师未设置费率返回 null。 */
    Rate resolveRate(Long timekeeperId, Long intakeId) {
        LawFirmTimekeeper card = timekeepers.findByUserId(timekeeperId).orElse(null);
        if (card == null || card.getStandardRateCents() == null || card.getStandardRateCents() <= 0) return null;
        Long agreed = intakeId == null ? null
                : termsRepository.findByIntakeId(intakeId).map(this::levelRates).map(r -> r.get(card.getLevel())).orElse(null);
        return new Rate(card.getLevel(), agreed != null && agreed > 0 ? agreed : card.getStandardRateCents(), card.getStandardRateCents());
    }

    // ───────────────────────────── 账单 ─────────────────────────────

    record Draft(LawFirmMatterIntake intake, LocalDate from, LocalDate to, List<LawFirmTimeEntry> rows,
                 List<Map<String, Object>> lines, int billedMinutes, long standardCents,
                 LawFirmBillingMath.Totals totals, int noChargeCount, int pendingCount) {}

    private Draft draft(Long userId, Map<String, Object> p) {
        LawFirmMatterIntake in = intake(longVal(p.get("intakeId")));
        requireReviewer(userId, in);
        LocalDate[] range = range(p);
        Ctx ctx = new Ctx();
        List<LawFirmTimeEntry> all = entries.findByWorkDateBetweenOrderByWorkDateAscIdAsc(range[0], range[1]).stream()
                .filter(e -> { LawFirmMatterIntake x = ctx.intakeFor(e); return x != null && x.getId().equals(in.getId()); })
                .toList();
        List<LawFirmTimeEntry> rows = all.stream()
                .filter(e -> "APPROVED".equals(e.getStatus()) && Boolean.TRUE.equals(e.getBillable()) && e.getBillId() == null)
                .toList();
        int noCharge = (int) all.stream().filter(e -> "APPROVED".equals(e.getStatus()) && !Boolean.TRUE.equals(e.getBillable())).count();
        int pending = (int) all.stream().filter(e -> "SUBMITTED".equals(e.getStatus())).count();
        List<Map<String, Object>> lines = new ArrayList<>();
        long subtotal = 0, standard = 0;
        int minutes = 0;
        Map<Long, String> levels = timekeepers.findAll().stream()
                .collect(Collectors.toMap(LawFirmTimekeeper::getUserId, t -> t.getLevel() == null ? "" : t.getLevel(), (a, b) -> a));
        for (LawFirmTimeEntry e : rows) {
            int billed = e.effectiveBilledMinutes();
            long amount = LawFirmBillingMath.amountCents(billed, nz(e.getRateCents()));
            long std = LawFirmBillingMath.amountCents(e.getMinutes(), nz(e.getStandardRateCents()));
            Map<String, Object> line = new LinkedHashMap<>();
            line.put("entryId", e.getId());
            line.put("userId", e.getUserId());
            line.put("timekeeperName", nameOf(e));
            line.put("level", levels.get(e.getUserId()));
            line.put("workDate", e.getWorkDate().toString());
            line.put("description", e.getDescription());
            line.put("minutes", e.getMinutes());
            line.put("billedMinutes", billed);
            line.put("rateCents", e.getRateCents());
            line.put("standardRateCents", e.getStandardRateCents());
            line.put("amountCents", amount);
            line.put("standardAmountCents", std);
            lines.add(line);
            subtotal += amount;
            standard += std;
            minutes += billed;
        }
        LawFirmBillingTerms terms = termsRepository.findByIntakeId(in.getId()).orElse(null);
        int discountBps = p.containsKey("discountPercent") && !String.valueOf(p.get("discountPercent")).isBlank()
                ? LawFirmBillingMath.bpsFromPercent(p.get("discountPercent"))
                : terms == null ? 0 : nzi(terms.getDiscountBps());
        long prior = bills.findByIntakeId(in.getId()).stream()
                .filter(b -> !"CANCELLED".equals(b.getStatus()))
                .mapToLong(b -> nz(b.getTotalCents())).sum();
        LawFirmBillingMath.Totals totals = LawFirmBillingMath.totals(subtotal, discountBps, terms == null ? null : terms.getCapCents(), prior);
        return new Draft(in, range[0], range[1], rows, lines, minutes, standard, totals, noCharge, pending);
    }

    Map<String, Object> billPreview(Long userId, Map<String, Object> p) {
        Draft d = draft(userId, p);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("matter", matterRef(d.intake()));
        out.put("periodFrom", d.from().toString());
        out.put("periodTo", d.to().toString());
        out.put("lines", d.lines());
        out.put("billedMinutes", d.billedMinutes());
        out.put("standardAmountCents", d.standardCents());
        putTotals(out, d.totals());
        out.put("noChargeCount", d.noChargeCount());
        out.put("pendingCount", d.pendingCount());
        return out;
    }

    Map<String, Object> billCreate(Long userId, Map<String, Object> p) {
        Draft d = draft(userId, p);
        if (d.rows().isEmpty()) {
            throw new IllegalStateException(LangText.of("这段期间没有已审核通过、可收费且未出账单的工时", "No approved, billable, unbilled entries in this period"));
        }
        Instant now = Instant.now();
        String actor = displayName(userId);
        LawFirmBillingMath.Totals t = d.totals();
        LawFirmBill bill = bills.save(LawFirmBill.builder()
                .billNo(nextBillNo())
                .intakeId(d.intake().getId()).intakeNo(d.intake().getIntakeNo()).matterTitle(d.intake().getTitle())
                .clientName(d.intake().getClientName()).projectId(d.intake().getProjectId())
                .periodFrom(d.from()).periodTo(d.to()).status("DRAFT")
                .linesJson(toJson(d.lines())).entryCount(d.rows().size()).billedMinutes(d.billedMinutes())
                .standardAmountCents(d.standardCents()).subtotalCents(t.subtotalCents())
                .discountBps(t.discountBps()).discountCents(t.discountCents())
                .capCents(t.capCents()).capReductionCents(t.capReductionCents()).totalCents(t.totalCents())
                .createdByUserId(userId).createdByName(actor).createdAt(now).updatedAt(now)
                .build());
        for (LawFirmTimeEntry e : d.rows()) {
            e.setStatus("BILLED");
            e.setBillId(bill.getId());
            e.setUpdatedAt(now);
            entries.save(e);
            audit(e, userId, actor, "BILL", Map.of("billNo", change(null, bill.getBillNo())), null);
        }
        return Map.of("bill", billView(bill, true));
    }

    Map<String, Object> billList(Long userId, Map<String, Object> p) {
        Long intakeId = longVal(p.get("intakeId"));
        Map<Long, LawFirmMatterIntake> byId = intakes.findAll().stream().collect(Collectors.toMap(LawFirmMatterIntake::getId, Function.identity()));
        List<Map<String, Object>> rows = bills.findAllByOrderByCreatedAtDescIdDesc().stream()
                .filter(b -> intakeId == null || intakeId.equals(b.getIntakeId()))
                .filter(b -> canReview(userId, byId.get(b.getIntakeId())))
                .map(b -> billView(b, true)).toList();
        return Map.of("bills", rows);
    }

    Map<String, Object> billSend(Long userId, Map<String, Object> p) {
        LawFirmBill b = billFor(userId, p);
        if (!"DRAFT".equals(b.getStatus())) throw new IllegalStateException(LangText.of("只有草稿账单可以发送客户确认", "Only draft bills can be sent for client confirmation"));
        b.setStatus("SENT");
        b.setSentAt(Instant.now());
        b.setUpdatedAt(Instant.now());
        return Map.of("bill", billView(bills.save(b), true));
    }

    Map<String, Object> billCancel(Long userId, Map<String, Object> p) {
        LawFirmBill b = billFor(userId, p);
        if (!Set.of("DRAFT", "SENT").contains(b.getStatus())) {
            throw new IllegalStateException(LangText.of("客户已确认的账单不能作废；如需冲销请在「发票与财务收费」作废或红冲发票", "Confirmed bills cannot be cancelled; void or red-invoice the invoice under Invoicing instead"));
        }
        Instant now = Instant.now();
        String actor = displayName(userId);
        String reason = trimTo(string(p.get("reason")), 500);
        for (LawFirmTimeEntry e : entries.findByBillId(b.getId())) {
            e.setStatus("APPROVED");
            e.setBillId(null);
            e.setUpdatedAt(now);
            entries.save(e);
            audit(e, userId, actor, "UNBILL", Map.of("billNo", change(b.getBillNo(), null)), reason);
        }
        b.setStatus("CANCELLED");
        b.setCancelledAt(now);
        b.setUpdatedAt(now);
        return Map.of("bill", billView(bills.save(b), true));
    }

    /** 客户确认：生成一张普通发票申请进入原收费台账（之后开票、核销回款都在原台账做）。 */
    Map<String, Object> billConfirm(Long userId, Map<String, Object> p) {
        LawFirmBill b = billFor(userId, p);
        if (!"SENT".equals(b.getStatus())) {
            throw new IllegalStateException(LangText.of("请先把账单发送客户确认，再登记客户确认结果", "Send the bill to the client before recording the confirmation"));
        }
        String confirmedBy = trimTo(string(p.get("confirmedBy")), 128);
        if (confirmedBy == null || confirmedBy.isBlank()) {
            throw new IllegalArgumentException(LangText.of("请填写客户确认人", "Please enter who confirmed on the client side"));
        }
        LocalDate confirmedDate = date(p.get("confirmedDate"), LocalDate.now());
        if (b.getTotalCents() != null && b.getTotalCents() > 0) {
            Map<String, Object> inv = new LinkedHashMap<>();
            inv.put("intakeId", b.getIntakeId());
            inv.put("amountCents", b.getTotalCents());
            inv.put("matterTitle", b.getMatterTitle());
            inv.put("invoiceType", firstNonBlank(string(p.get("invoiceType")), "DIGITAL_NORMAL"));
            putIfText(inv, "buyerTaxId", p.get("buyerTaxId"));
            putIfText(inv, "recipientEmail", p.get("recipientEmail"));
            inv.put("remark", LangText.of("计时账单 ", "Hourly bill ") + b.getBillNo() + "（" + b.getPeriodFrom() + " – " + b.getPeriodTo() + "）");
            @SuppressWarnings("unchecked")
            Map<String, Object> invoice = (Map<String, Object>) ledger.submitInvoice(userId, b.getProjectId(), inv).get("invoice");
            b.setInvoiceId(longVal(invoice.get("id")));
            b.setInvoiceAppNo(string(invoice.get("invoiceAppNo")));
        }
        Instant now = Instant.now();
        b.setStatus("CONFIRMED");
        b.setConfirmedBy(confirmedBy);
        b.setConfirmNote(trimTo(LangText.of("确认日期 ", "Confirmed on ") + confirmedDate
                + (string(p.get("note")) == null || string(p.get("note")).isBlank() ? "" : "；" + string(p.get("note"))), 500));
        b.setConfirmedAt(now);
        b.setUpdatedAt(now);
        return Map.of("bill", billView(bills.save(b), true));
    }

    private LawFirmBill billFor(Long userId, Map<String, Object> p) {
        Long id = longVal(p.get("id"));
        LawFirmBill b = bills.findById(id == null ? -1L : id)
                .orElseThrow(() -> new IllegalArgumentException(LangText.of("账单不存在", "Bill not found")));
        requireReviewer(userId, intakes.findById(b.getIntakeId()).orElse(null));
        return b;
    }

    private String nextBillNo() {
        String prefix = "TB" + YearMonth.now().format(DateTimeFormatter.ofPattern("yyyyMM")) + "-";
        long n = bills.countByBillNoStartingWith(prefix) + 1;
        return prefix + String.format("%04d", n);
    }

    private Map<String, Object> billView(LawFirmBill b, boolean withLines) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", b.getId());
        v.put("billNo", b.getBillNo());
        v.put("intakeId", b.getIntakeId());
        v.put("intakeNo", b.getIntakeNo());
        v.put("matterTitle", b.getMatterTitle());
        v.put("clientName", b.getClientName());
        v.put("periodFrom", str(b.getPeriodFrom()));
        v.put("periodTo", str(b.getPeriodTo()));
        v.put("status", b.getStatus());
        v.put("entryCount", b.getEntryCount());
        v.put("billedMinutes", b.getBilledMinutes());
        v.put("standardAmountCents", b.getStandardAmountCents());
        v.put("subtotalCents", b.getSubtotalCents());
        v.put("discountBps", b.getDiscountBps());
        v.put("discountCents", b.getDiscountCents());
        v.put("capCents", b.getCapCents());
        v.put("capReductionCents", b.getCapReductionCents());
        v.put("totalCents", b.getTotalCents());
        v.put("invoiceId", b.getInvoiceId());
        v.put("invoiceAppNo", b.getInvoiceAppNo());
        if (b.getInvoiceId() != null) {
            LawFirmInvoice inv = invoices.findById(b.getInvoiceId()).orElse(null);
            v.put("invoiceStatus", inv == null ? null : inv.getStatus());
            v.put("collectedCents", collectedFor(b.getInvoiceId()));
        }
        v.put("createdByName", b.getCreatedByName());
        v.put("createdAt", str(b.getCreatedAt()));
        v.put("sentAt", str(b.getSentAt()));
        v.put("confirmedAt", str(b.getConfirmedAt()));
        v.put("confirmedBy", b.getConfirmedBy());
        v.put("confirmNote", b.getConfirmNote());
        if (withLines) v.put("lines", lines(b));
        return v;
    }

    private long collectedFor(Long invoiceId) {
        return collections.findByInvoiceIdOrderByCreatedAtDescIdDesc(invoiceId).stream().mapToLong(c -> nz(c.getAmountCents())).sum();
    }

    private List<Map<String, Object>> lines(LawFirmBill b) {
        if (b.getLinesJson() == null || b.getLinesJson().isBlank()) return List.of();
        try {
            return objectMapper.readValue(b.getLinesJson(), new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception ex) {
            return List.of();
        }
    }

    // ───────────────────────────── 管理者：可收费工时与实现率 ─────────────────────────────

    /**
     * 每位律师（按工作日期落在区间内的工时）：
     * <ul>
     *   <li>recordedMinutes：已提交（待审/已通过/已进账单）的申报时长；billableMinutes：其中当前可收费的核定时长；</li>
     *   <li>writtenDownMinutes：申报可收费、但被核减或标为不收费的时长；wipMinutes：已通过、尚未出账单的可收费时长；</li>
     *   <li>实现率 = 实收 ÷ 按标准费率应收。分母只算「已有结论」的工时：所在账单客户已确认，或审核通过时标为不收费；
     *       分子是这些账单对应发票上真实核销的回款，按各条金额占比分摊（最大余数法）。</li>
     * </ul>
     */
    Map<String, Object> billingMetrics(Long userId, Map<String, Object> p) {
        access.requireFirmWide(userId);
        LocalDate[] range = range(p);
        Ctx ctx = new Ctx();
        List<LawFirmTimeEntry> rows = entries.findByWorkDateBetweenOrderByWorkDateAscIdAsc(range[0], range[1]).stream()
                .filter(e -> Set.of("SUBMITTED", "APPROVED", "BILLED").contains(e.getStatus())).toList();
        Map<Long, LawFirmBill> billById = bills.findAll().stream().collect(Collectors.toMap(LawFirmBill::getId, Function.identity()));
        Map<Long, long[]> allocByEntry = new HashMap<>(); // entryId -> {billed, collected}
        for (LawFirmBill b : billById.values()) {
            if (!"CONFIRMED".equals(b.getStatus())) continue;
            List<Map<String, Object>> ls = lines(b);
            long[] weights = ls.stream().mapToLong(l -> nz(longVal(l.get("amountCents")))).toArray();
            long[] billed = LawFirmBillingMath.allocate(nz(b.getTotalCents()), weights);
            long[] collected = LawFirmBillingMath.allocate(b.getInvoiceId() == null ? 0L : collectedFor(b.getInvoiceId()), weights);
            for (int i = 0; i < ls.size(); i++) {
                allocByEntry.put(longVal(ls.get(i).get("entryId")), new long[]{billed[i], collected[i]});
            }
        }
        Map<Long, Map<String, Object>> byUser = new LinkedHashMap<>();
        Map<Long, LawFirmTimekeeper> cards = timekeepers.findAll().stream()
                .collect(Collectors.toMap(LawFirmTimekeeper::getUserId, Function.identity(), (a, b) -> a));
        long[] firm = new long[8];
        for (LawFirmTimeEntry e : rows) {
            Map<String, Object> m = byUser.computeIfAbsent(e.getUserId(), uid -> {
                Map<String, Object> x = new LinkedHashMap<>();
                x.put("userId", uid);
                x.put("name", nameOf(e));
                LawFirmTimekeeper card = cards.get(uid);
                x.put("level", card == null ? null : card.getLevel());
                x.put("standardRateCents", card == null ? null : card.getStandardRateCents());
                for (String k : List.of("recordedMinutes", "billableMinutes", "writtenDownMinutes", "wipMinutes", "billedMinutes",
                        "standardValueCents", "billedAmountCents", "collectedCents")) x.put(k, 0L);
                return x;
            });
            boolean claimed = Boolean.TRUE.equals(e.getBillableClaimed());
            boolean billable = Boolean.TRUE.equals(e.getBillable());
            int claimedMin = e.getMinutes();
            int billedMin = e.effectiveBilledMinutes();
            add(m, "recordedMinutes", claimedMin, firm, 0);
            if (billable) add(m, "billableMinutes", billedMin, firm, 1);
            if (claimed && !"SUBMITTED".equals(e.getStatus())) {
                add(m, "writtenDownMinutes", billable ? claimedMin - billedMin : claimedMin, firm, 2);
            }
            if ("APPROVED".equals(e.getStatus()) && billable) add(m, "wipMinutes", billedMin, firm, 3);
            LawFirmBill bill = e.getBillId() == null ? null : billById.get(e.getBillId());
            if (bill != null) add(m, "billedMinutes", billedMin, firm, 4);
            boolean confirmed = bill != null && "CONFIRMED".equals(bill.getStatus());
            boolean writtenOff = "APPROVED".equals(e.getStatus()) && !billable && claimed;
            if (confirmed || writtenOff) {
                add(m, "standardValueCents", LawFirmBillingMath.amountCents(claimedMin, nz(e.getStandardRateCents())), firm, 5);
            }
            long[] alloc = allocByEntry.get(e.getId());
            if (confirmed && alloc != null) {
                add(m, "billedAmountCents", alloc[0], firm, 6);
                add(m, "collectedCents", alloc[1], firm, 7);
            }
        }
        List<Map<String, Object>> lawyers = new ArrayList<>(byUser.values());
        lawyers.forEach(LawFirmBillingService::putRates);
        lawyers.sort(Comparator.comparing((Map<String, Object> m) -> -((Number) m.get("billableMinutes")).longValue()));
        Map<String, Object> total = new LinkedHashMap<>();
        String[] keys = {"recordedMinutes", "billableMinutes", "writtenDownMinutes", "wipMinutes", "billedMinutes",
                "standardValueCents", "billedAmountCents", "collectedCents"};
        for (int i = 0; i < keys.length; i++) total.put(keys[i], firm[i]);
        putRates(total);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", range[0].toString());
        out.put("to", range[1].toString());
        out.put("lawyers", lawyers);
        out.put("total", total);
        return out;
    }

    private static void add(Map<String, Object> m, String key, long value, long[] firm, int idx) {
        m.put(key, ((Number) m.get(key)).longValue() + value);
        firm[idx] += value;
    }

    /** 实现率保留一位小数的百分数（四舍五入），分母为 0 时为 null（界面显示「—」）。 */
    private static void putRates(Map<String, Object> m) {
        long standard = ((Number) m.get("standardValueCents")).longValue();
        m.put("realizationPercent", percent(((Number) m.get("collectedCents")).longValue(), standard));
        m.put("billingRealizationPercent", percent(((Number) m.get("billedAmountCents")).longValue(), standard));
    }

    static String percent(long numerator, long denominator) {
        if (denominator <= 0) return null;
        return java.math.BigDecimal.valueOf(numerator).multiply(java.math.BigDecimal.valueOf(100))
                .divide(java.math.BigDecimal.valueOf(denominator), 1, java.math.RoundingMode.HALF_UP).toPlainString();
    }

    // ───────────────────────────── 样板数据（演示/录屏用） ─────────────────────────────

    /**
     * 一个虚构的计时收费事项和四位不同级别律师的上月工时（已提交待审核），费率卡与事项约定（九折、封顶）。
     * 幂等：样板事项已存在时只补齐缺的部分。只在桌面单机台账里写，不涉及任何真实客户。
     */
    Map<String, Object> seedDemo(Long userId) {
        access.requireFirmWide(userId);
        Instant now = Instant.now();
        String intakeNo = "DEMO-HOURLY-001";
        User partner = demoUser("partner_lin", "林正源（高级合伙人）");
        User counsel = demoUser("partner_su", "苏婉清（合伙人）");
        User senior = demoUser("lawyer_zhou", "周铭泽（主办律师）");
        User associate = demoUser("lawyer_chen", "陈思远（主办律师）");
        LawFirmMatterIntake in = intakes.findByIntakeNo(intakeNo).orElseGet(() -> intakes.save(LawFirmMatterIntake.builder()
                .intakeNo(intakeNo).title(LangText.of("（样板）星河科技数据合规专项（计时）", "(Sample) Xinghe Tech data compliance (hourly)"))
                .practiceArea("IP_TECH").applicantUserId(partner.getId()).applicantName(partner.getDisplayName())
                .leadLawyerUserId(partner.getId()).leadLawyerName(partner.getDisplayName())
                .departmentName(LangText.of("知识产权与数据合规", "IP & Data Compliance"))
                .clientName(LangText.of("星河科技有限公司（虚构）", "Xinghe Technology Co., Ltd. (fictional)"))
                .clientCreditCode("91110000MA00DEMO01").feeMode("HOURLY").status("APPROVED_FILED")
                .conflictRiskLevel("GREEN").submittedAt(now).filedAt(now).createdAt(now).updatedAt(now).build()));
        seedCard(partner, "PARTNER", 400_000L);
        seedCard(counsel, "COUNSEL", 300_000L);
        seedCard(senior, "SENIOR_ASSOCIATE", 200_000L);
        seedCard(associate, "ASSOCIATE", 120_000L);
        if (termsRepository.findByIntakeId(in.getId()).isEmpty()) {
            termsRepository.save(LawFirmBillingTerms.builder().intakeId(in.getId())
                    .levelRatesJson(toJson(Map.of("PARTNER", 350_000L))).discountBps(1000).capCents(5_000_000L).updatedAt(now).build());
        }
        int created = 0;
        YearMonth last = YearMonth.now().minusMonths(1);
        Object[][] plan = {
                {partner, 3, 90, "审阅数据出境安全评估申报材料并提出修改意见"},
                {partner, 12, 60, "与客户法务总监电话会议，讨论个人信息保护影响评估范围"},
                {counsel, 5, 180, "起草个人信息处理规则与隐私政策（第一稿）"},
                {counsel, 18, 120, "修改数据处理协议，回复客户批注"},
                {senior, 6, 240, "梳理客户业务系统数据流，制作数据清单"},
                {senior, 19, 150, "检索数据出境相关监管案例并形成备忘录"},
                {associate, 7, 300, "整理供应商合同中的数据条款对照表"},
                {associate, 20, 36, "内部例会记录（申报为可收费）"},
        };
        for (Object[] row : plan) {
            User u = (User) row[0];
            LocalDate d = last.atDay((Integer) row[1]);
            String key = "DEMO:" + intakeNo + ":" + d + ":" + u.getId();
            if (entries.findByUserIdAndSourceKey(u.getId(), key).isPresent()) continue;
            LawFirmTimeEntry e = entries.save(LawFirmTimeEntry.builder()
                    .userId(u.getId()).timekeeperName(u.getDisplayName()).intakeId(in.getId()).projectId(in.getProjectId())
                    .workDate(d).minutes((Integer) row[2]).description((String) row[3])
                    .billableClaimed(true).billable(true).source("MANUAL").sourceKey(key).edited(true)
                    .status("SUBMITTED").submittedAt(now).createdAt(now).updatedAt(now).build());
            audit(e, u.getId(), u.getDisplayName(), "SUBMIT", Map.of("minutes", change(null, e.getMinutes())), null);
            created++;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("intakeId", in.getId());
        out.put("created", created);
        out.put("from", last.atDay(1).toString());
        out.put("to", last.atEndOfMonth().toString());
        return out;
    }

    private User demoUser(String username, String displayName) {
        return users.findByUsername(username).orElseGet(() -> {
            User u = new User();
            u.setUsername(username);
            u.setDisplayName(displayName);
            u.setPassword("{noop}" + java.util.UUID.randomUUID() + java.util.UUID.randomUUID());
            u.setRole("USER");
            u.setSubscriptionType("PAID");
            u.setCreatedAt(java.time.LocalDateTime.now());
            u.setUpdatedAt(java.time.LocalDateTime.now());
            return users.save(u);
        });
    }

    private void seedCard(User u, String level, long rateCents) {
        if (timekeepers.findByUserId(u.getId()).isPresent()) return;
        timekeepers.save(LawFirmTimekeeper.builder().userId(u.getId()).displayName(u.getDisplayName())
                .level(level).standardRateCents(rateCents).updatedAt(Instant.now()).build());
    }

    // ───────────────────────────── 共用 ─────────────────────────────

    /** 一次请求内缓存事项，按 projectId 推导事项（取最近一条未被利冲驳回的收案）。 */
    private final class Ctx {
        private List<LawFirmMatterIntake> all;
        private final Map<Long, String> projectNames = new HashMap<>();

        List<LawFirmMatterIntake> allIntakes() {
            if (all == null) all = intakes.findAllByOrderByCreatedAtDescIdDesc();
            return all;
        }

        LawFirmMatterIntake intakeForProject(Long projectId) {
            if (projectId == null) return null;
            return allIntakes().stream()
                    .filter(i -> projectId.equals(i.getProjectId()) && !"REJECTED_CONFLICT".equals(i.getStatus()))
                    .findFirst().orElse(null);
        }

        LawFirmMatterIntake intakeFor(LawFirmTimeEntry e) {
            if (e.getIntakeId() != null) {
                return allIntakes().stream().filter(i -> i.getId().equals(e.getIntakeId())).findFirst().orElse(null);
            }
            return intakeForProject(e.getProjectId());
        }

        String projectName(Long projectId) {
            if (projectId == null) return null;
            return projectNames.computeIfAbsent(projectId, id -> projects.findById(id).map(Project::getName).orElse(""));
        }
    }

    private Map<String, Object> entryView(LawFirmTimeEntry e, Ctx ctx, boolean forReview) {
        LawFirmMatterIntake in = ctx.intakeFor(e);
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", e.getId());
        v.put("userId", e.getUserId());
        v.put("timekeeperName", nameOf(e));
        v.put("projectId", e.getProjectId());
        v.put("projectName", ctx.projectName(e.getProjectId()));
        v.put("intakeId", in == null ? null : in.getId());
        v.put("intakeNo", in == null ? null : in.getIntakeNo());
        v.put("matterTitle", in == null ? null : in.getTitle());
        v.put("clientName", in == null ? null : in.getClientName());
        v.put("feeMode", in == null ? null : in.getFeeMode());
        v.put("workDate", e.getWorkDate().toString());
        v.put("capturedMinutes", e.getCapturedMinutes());
        v.put("minutes", e.getMinutes());
        v.put("billedMinutes", e.effectiveBilledMinutes());
        v.put("description", e.getDescription());
        v.put("billableClaimed", e.getBillableClaimed());
        v.put("billable", e.getBillable());
        v.put("source", e.getSource());
        v.put("status", e.getStatus());
        v.put("billId", e.getBillId());
        v.put("reviewedByName", e.getReviewedByName());
        v.put("reviewedAt", str(e.getReviewedAt()));
        if (forReview) {
            Long rate = e.getRateCents();
            Long standard = e.getStandardRateCents();
            if (rate == null && in != null) {
                Rate r = resolveRate(e.getUserId(), in.getId());
                if (r != null) { rate = r.rateCents(); standard = r.standardRateCents(); }
            }
            v.put("rateCents", rate);
            v.put("standardRateCents", standard);
            v.put("amountCents", rate == null || !Boolean.TRUE.equals(e.getBillable()) ? null
                    : LawFirmBillingMath.amountCents(e.effectiveBilledMinutes(), rate));
        }
        return v;
    }

    private Map<String, Object> auditView(LawFirmTimeEntryAudit a) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("action", a.getAction());
        v.put("actorName", a.getActorName());
        v.put("reason", a.getReason());
        v.put("at", str(a.getCreatedAt()));
        try {
            v.put("detail", a.getDetail() == null ? Map.of() : objectMapper.readValue(a.getDetail(), new TypeReference<Map<String, Object>>() {}));
        } catch (Exception ex) {
            v.put("detail", Map.of());
        }
        return v;
    }

    private void audit(LawFirmTimeEntry e, Long actorId, String actorName, String action, Map<String, Object> detail, String reason) {
        audits.save(LawFirmTimeEntryAudit.builder().entryId(e.getId()).actorUserId(actorId).actorName(actorName)
                .action(action).detail(toJson(detail)).reason(reason).createdAt(Instant.now()).build());
    }

    private static Map<String, Object> change(Object from, Object to) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("from", from);
        m.put("to", to);
        return m;
    }

    private Map<String, Object> matterRef(LawFirmMatterIntake in) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("intakeId", in.getId());
        row.put("intakeNo", in.getIntakeNo());
        row.put("title", in.getTitle());
        row.put("clientName", in.getClientName());
        row.put("feeMode", in.getFeeMode());
        row.put("leadLawyerName", in.getLeadLawyerName());
        row.put("projectId", in.getProjectId());
        return row;
    }

    private static void putTotals(Map<String, Object> out, LawFirmBillingMath.Totals t) {
        out.put("subtotalCents", t.subtotalCents());
        out.put("discountBps", t.discountBps());
        out.put("discountCents", t.discountCents());
        out.put("capCents", t.capCents());
        out.put("capRemainingCents", t.capCents() == null ? null : t.capRemainingCents());
        out.put("capReductionCents", t.capReductionCents());
        out.put("totalCents", t.totalCents());
    }

    private boolean canReview(Long userId, LawFirmMatterIntake intake) {
        if (access.canViewFirmWide(userId)) return true;
        return intake != null && userId != null && userId.equals(intake.getLeadLawyerUserId());
    }

    private void requireReviewer(Long userId, LawFirmMatterIntake intake) {
        if (!canReview(userId, intake)) {
            throw new IllegalArgumentException(LangText.of("无权审核：仅事项主办律师或律所管理员可以审核工时、出账单",
                    "Not permitted: only the matter's lead lawyer or a law firm administrator can review time and issue bills"));
        }
    }

    private LawFirmTimeEntry ownEntry(Long userId, Long id) {
        LawFirmTimeEntry e = entries.findById(id == null ? -1L : id)
                .orElseThrow(() -> new IllegalArgumentException(LangText.of("工时不存在", "Time entry not found")));
        if (!userId.equals(e.getUserId())) throw new IllegalArgumentException(LangText.of("工时不存在", "Time entry not found"));
        return e;
    }

    private LawFirmMatterIntake intake(Long id) {
        return intakes.findById(id == null ? -1L : id)
                .orElseThrow(() -> new IllegalArgumentException(LangText.of("事项不存在", "Matter not found")));
    }

    private String displayName(Long userId) {
        return users.findById(userId).map(u -> firstNonBlank(u.getDisplayName(), u.getUsername())).orElse("#" + userId);
    }

    private static String nameOf(LawFirmTimeEntry e) {
        return firstNonBlank(e.getTimekeeperName(), "#" + e.getUserId());
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** from/to（yyyy-MM-dd，闭区间），缺省为本月；跨度不超过 92 天。 */
    static LocalDate[] range(Map<String, Object> p) {
        YearMonth month = YearMonth.now();
        LocalDate from = date(p.get("from"), month.atDay(1));
        LocalDate to = date(p.get("to"), month.atEndOfMonth());
        if (to.isBefore(from)) throw new IllegalArgumentException(LangText.of("结束日期不能早于开始日期", "End date cannot be before start date"));
        if (ChronoUnit.DAYS.between(from, to) >= MAX_RANGE_DAYS) {
            throw new IllegalArgumentException(LangText.of("日期范围最长 92 天", "Date range is limited to 92 days"));
        }
        return new LocalDate[]{from, to};
    }

    static LocalDate date(Object raw, LocalDate fallback) {
        if (raw == null || String.valueOf(raw).isBlank()) return fallback;
        try {
            return LocalDate.parse(String.valueOf(raw).trim());
        } catch (DateTimeParseException ex) {
            throw new IllegalArgumentException(LangText.of("日期格式应为 年-月-日", "Dates must be YYYY-MM-DD"));
        }
    }

    private static String description(Object raw, boolean required) {
        String s = trimTo(string(raw), 1000);
        if (required && (s == null || s.isBlank())) {
            throw new IllegalArgumentException(LangText.of("请填写工作内容描述", "Please describe the work"));
        }
        return s;
    }

    private static void putIfText(Map<String, Object> m, String key, Object raw) {
        String s = string(raw);
        if (s != null && !s.isBlank()) m.put(key, s.trim());
    }

    private static String trimTo(String s, int max) {
        if (s == null) return null;
        String t = s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static String string(Object raw) {
        return raw == null ? null : String.valueOf(raw);
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }

    private static Long longVal(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        String s = String.valueOf(v).trim();
        return s.matches("-?\\d{1,18}") ? Long.parseLong(s) : null;
    }

    private static List<Long> longList(Object raw) {
        if (!(raw instanceof Collection<?> c)) return List.of();
        return c.stream().map(LawFirmBillingService::longVal).filter(Objects::nonNull).distinct().toList();
    }

    private static Boolean boolVal(Object v) {
        if (v == null) return null;
        if (v instanceof Boolean b) return b;
        return Boolean.parseBoolean(String.valueOf(v));
    }

    private static long nz(Long v) {
        return v == null ? 0L : v;
    }

    private static int nzi(Integer v) {
        return v == null ? 0 : v;
    }

    private static String firstNonBlank(String... vals) {
        for (String v : vals) if (v != null && !v.isBlank()) return v;
        return null;
    }
}
