// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.ImConversation;
import com.checkba.model.entity.ImMember;
import com.checkba.model.entity.ImMessage;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectMember;
import com.checkba.model.entity.ProjectTask;
import com.checkba.model.entity.User;
import com.checkba.model.entity.UserActivityLog;
import com.checkba.model.entity.lawfirm.LawFirmCollection;
import com.checkba.model.entity.lawfirm.LawFirmConflictClearance;
import com.checkba.model.entity.lawfirm.LawFirmInvoice;
import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import com.checkba.repository.ImConversationRepository;
import com.checkba.repository.ImMemberRepository;
import com.checkba.repository.ImMessageRepository;
import com.checkba.repository.ProjectMemberRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.ProjectTaskRepository;
import com.checkba.repository.UserActivityLogRepository;
import com.checkba.repository.UserRepository;
import com.checkba.repository.lawfirm.LawFirmCollectionRepository;
import com.checkba.repository.lawfirm.LawFirmConflictClearanceRepository;
import com.checkba.repository.lawfirm.LawFirmInvoiceRepository;
import com.checkba.repository.lawfirm.LawFirmMatterIntakeRepository;
import com.checkba.service.ai.PluginService;
import com.checkba.service.im.ImService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 律所业务管理与决策引擎服务：
 * 1. 收案立项申请与五步利冲进度追踪
 * 2. 法规级利益冲突检索与关联律师站内信（IM）放行协同
 * 3. 发票申请、手动回款核销与外部财务系统（ERP/CSV）同步
 * 4. 律所管理决策看板（桌面端个体 Unit → 团队负责人 Team Lead → 业务部门 Department → 全所 Firm）
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class LawFirmManagementService {

    private final LawFirmMatterIntakeRepository intakeRepository;
    private final LawFirmConflictClearanceRepository clearanceRepository;
    private final LawFirmInvoiceRepository invoiceRepository;
    private final LawFirmCollectionRepository collectionRepository;
    private final LawFirmConflictEngine conflictEngine;
    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectTaskRepository projectTaskRepository;
    private final UserActivityLogRepository activityLogRepository;
    private final UserRepository userRepository;
    private final ImConversationRepository imConversationRepository;
    private final ImMemberRepository imMemberRepository;
    private final ImMessageRepository imMessageRepository;
    private final ImService imService;
    private final PluginService pluginService;
    private final ObjectMapper objectMapper;

    /**
     * 桌面单机（local-mode）只有一个真人：他同时是申请人、被征询律师与利冲委员（单人所/演示）。
     * 团队服务器（local-mode=false）上每个人只能处理征询给自己的单子，申请人也不能终审自己的申请。
     */
    @org.springframework.beans.factory.annotation.Value("${security.local-mode:false}")
    boolean localMode;

    boolean canActFor(Long userId, Long targetUserId) {
        return localMode || targetUserId == null || targetUserId.equals(userId);
    }

    @Transactional
    public Map<String, Object> execute(Long userId, Long projectId, String action, Map<String, Object> rawParams) {
        if (userId == null) throw new IllegalArgumentException("请先登录");
        Map<String, Object> params = rawParams == null ? Map.of() : rawParams;
        Long effectiveUserId = userId;
        String act = action == null || action.isBlank() ? "overview" : action.trim();

        return switch (act) {
            case "overview", "list", "dashboard" -> buildOverview(effectiveUserId, projectId, params);
            case "precheckConflict", "conflictCheck", "scanConflict", "conflictPreview" -> precheckConflict(effectiveUserId, projectId, params);
            case "submitIntake", "createIntake" -> submitIntake(effectiveUserId, projectId, params);
            case "respondClearance", "clearanceDecision" -> respondClearance(effectiveUserId, params);
            case "committeeReview", "finalizeIntake" -> committeeReview(effectiveUserId, params);
            case "submitInvoice", "createInvoice" -> submitInvoice(effectiveUserId, projectId, params);
            case "issueInvoice", "approveInvoice" -> issueInvoice(effectiveUserId, params);
            case "voidInvoice" -> voidInvoice(effectiveUserId, params);
            case "recordCollection", "createCollection" -> recordCollection(effectiveUserId, params);
            case "syncErp", "financeSyncErp" -> syncErp(effectiveUserId, params);
            case "confirmErpSync" -> confirmErpSync(effectiveUserId, params);
            case "exportCsv", "financeExportCsv" -> Map.of(
                    "csv", exportFinanceCsv(),
                    "filename", "lawfirm-finance-ledger-" + LocalDate.now() + ".csv"
            );
            case "seedDemo", "seedDemoData" -> seedDemoData(effectiveUserId, params);
            default -> throw new IllegalArgumentException("不支持的律所管理操作：" + act);
        };
    }

    @Transactional(readOnly = true)
    public Map<String, Object> buildOverview(Long userId, Long projectId, Map<String, Object> params) {
        String scope = string(params, "scope", "all");
        Map<Long, String> userNames = loadUserDisplayNames();
        String currentUserName = userNames.getOrDefault(userId, "当前律师");

        List<LawFirmMatterIntake> allIntakes = intakeRepository.findAllByOrderByCreatedAtDescIdDesc();
        List<LawFirmConflictClearance> allClearances = clearanceRepository.findAllByOrderByIdDesc();
        List<LawFirmInvoice> allInvoices = invoiceRepository.findAllByOrderByCreatedAtDescIdDesc();
        List<LawFirmCollection> allCollections = collectionRepository.findAllByOrderByCreatedAtDescIdDesc();

        Map<Long, List<LawFirmConflictClearance>> clearancesByIntake = allClearances.stream()
                .filter(c -> c.getIntakeId() != null)
                .collect(Collectors.groupingBy(LawFirmConflictClearance::getIntakeId));

        Map<Long, LawFirmMatterIntake> intakeById = allIntakes.stream()
                .filter(i -> i.getId() != null)
                .collect(Collectors.toMap(LawFirmMatterIntake::getId, i -> i, (a, b) -> a));

        List<Map<String, Object>> intakeViews = allIntakes.stream()
                .map(i -> toIntakeView(i, clearancesByIntake.getOrDefault(i.getId(), List.of())))
                .toList();

        List<Map<String, Object>> myIntakeViews = intakeViews.stream()
                .filter(v -> Objects.equals(v.get("applicantUserId"), userId)
                        || Objects.equals(v.get("leadLawyerUserId"), userId))
                .toList();

        List<Map<String, Object>> clearanceViews = allClearances.stream()
                .map(c -> toClearanceView(c, intakeById.get(c.getIntakeId())))
                .toList();

        List<Map<String, Object>> myClearanceViews = clearanceViews.stream()
                .filter(c -> "PENDING".equals(c.get("decision"))
                        && canActFor(userId, (Long) c.get("targetUserId")))
                .toList();

        List<Map<String, Object>> pendingClearanceViews = clearanceViews.stream()
                .filter(c -> "PENDING".equals(c.get("decision")))
                .toList();

        List<Map<String, Object>> invoiceViews = allInvoices.stream()
                .map(this::toInvoiceView)
                .toList();

        List<Map<String, Object>> collectionViews = allCollections.stream()
                .map(this::toCollectionView)
                .toList();

        Map<String, Object> dashboard = buildDashboard(allIntakes, allClearances, allInvoices, allCollections, userNames);

        long inFlightCount = allIntakes.stream()
                .filter(i -> Set.of("CONFLICT_CHECKING", "PENDING_LAWYER_CLEARANCE", "PENDING_COMMITTEE_REVIEW")
                        .contains(i.getStatus()))
                .count();
        long myInFlightCount = allIntakes.stream()
                .filter(i -> (Objects.equals(i.getApplicantUserId(), userId) || Objects.equals(i.getLeadLawyerUserId(), userId))
                        && Set.of("CONFLICT_CHECKING", "PENDING_LAWYER_CLEARANCE", "PENDING_COMMITTEE_REVIEW")
                        .contains(i.getStatus()))
                .count();
        long pendingMyClearanceCount = allClearances.stream()
                .filter(c -> "PENDING".equals(c.getDecision())
                        && (Objects.equals(c.getTargetUserId(), userId) || c.getTargetUserId() == null))
                .count();
        long pendingCommitteeCount = allIntakes.stream()
                .filter(i -> "PENDING_COMMITTEE_REVIEW".equals(i.getStatus()))
                .count();
        long approvedFiledCount = allIntakes.stream()
                .filter(i -> "APPROVED_FILED".equals(i.getStatus()))
                .count();
        long pendingInvoiceCount = allInvoices.stream()
                .filter(inv -> "PENDING_APPROVAL".equals(inv.getStatus()))
                .count();

        @SuppressWarnings("unchecked")
        Map<String, Object> kpi = (Map<String, Object>) dashboard.getOrDefault("kpi", Map.of());

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("totalIntakes", allIntakes.size());
        summary.put("inFlightIntakes", inFlightCount);
        summary.put("myInFlightCount", myInFlightCount);
        summary.put("pendingMyClearanceCount", pendingMyClearanceCount);
        summary.put("pendingClearanceCount", pendingClearanceViews.size());
        summary.put("pendingCommitteeCount", pendingCommitteeCount);
        summary.put("approvedFiledCount", approvedFiledCount);
        summary.put("pendingInvoiceCount", pendingInvoiceCount);
        summary.put("arTotalCents", kpi.getOrDefault("totalArCents", 0L));
        summary.put("collectionRatePercent", kpi.getOrDefault("collectionRatePercent", 0.0));
        summary.put("billingRatePercent", kpi.getOrDefault("billingRatePercent", 0.0));
        summary.put("avgWorkloadIndex", kpi.getOrDefault("avgWorkloadIndex", 0));

        List<Map<String, Object>> userOptions = userRepository.findAll().stream()
                .map(u -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", u.getId());
                    m.put("username", u.getUsername());
                    m.put("displayName", u.getDisplayName() != null && !u.getDisplayName().isBlank() ? u.getDisplayName() : u.getUsername());
                    m.put("role", u.getRole());
                    return m;
                })
                .toList();

        Map<String, Object> selfInfo = new LinkedHashMap<>();
        selfInfo.put("id", userId);
        selfInfo.put("displayName", currentUserName);
        selfInfo.put("departmentName", defaultDeptForUser(userId));
        selfInfo.put("role", "主办律师 / 利冲委员");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("self", selfInfo);
        out.put("currentUser", selfInfo);
        out.put("currentUserId", userId);
        out.put("currentUserName", currentUserName);
        out.put("scope", scope);
        out.put("projectId", projectId);
        List<Map<String, Object>> scopedIntakes = "mine".equalsIgnoreCase(scope) && !myIntakeViews.isEmpty() ? myIntakeViews : intakeViews;
        out.put("intakes", scopedIntakes);
        out.put("matters", scopedIntakes);
        out.put("allIntakes", intakeViews);
        out.put("myIntakes", myIntakeViews);
        out.put("committeeQueue", intakeViews);
        out.put("clearances", clearanceViews);
        out.put("allClearances", clearanceViews);
        out.put("myClearances", myClearanceViews);
        out.put("myPendingClearances", pendingClearanceViews);
        out.put("pendingClearances", pendingClearanceViews);
        out.put("invoices", invoiceViews);
        out.put("collections", collectionViews);
        out.put("dashboard", dashboard);
        out.put("kpi", kpi);
        out.put("kpis", kpi);
        out.put("summary", summary);
        out.put("users", userOptions);
        return out;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> precheckConflict(Long userId, Long projectId, Map<String, Object> params) {
        Map<Long, String> userNames = loadUserDisplayNames();
        LawFirmMatterIntake draft = buildDraftIntakeFromParams(userId, projectId, params, userNames);
        LawFirmConflictEngine.ConflictCheckResult result = conflictEngine.evaluateConflict(
                draft,
                intakeRepository.findAllByOrderByCreatedAtDescIdDesc(),
                projectRepository.findAll(),
                userNames
        );
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("riskLevel", result.getRiskLevel());
        out.put("conflictRiskLevel", result.getRiskLevel());
        out.put("conflictLevel", result.getRiskLevel());
        out.put("primaryRuleCode", result.getPrimaryRuleCode());
        out.put("summary", result.getSummary());
        out.put("conflictSummary", result.getSummary());
        out.put("hits", result.getHits());
        out.put("conflictHits", result.getHits());
        out.put("feeComplianceWarning", result.getFeeComplianceWarning());
        return out;
    }

    @Transactional
    public Map<String, Object> submitIntake(Long userId, Long projectId, Map<String, Object> params) {
        Map<Long, String> userNames = loadUserDisplayNames();
        LawFirmMatterIntake intake = buildDraftIntakeFromParams(userId, projectId, params, userNames);
        if (intake.getClientName() == null || intake.getClientName().isBlank()) {
            throw new IllegalArgumentException("请填写委托人名称");
        }
        if (intake.getTitle() == null || intake.getTitle().isBlank()) {
            intake.setTitle(intake.getClientName() + "专项法律服务项目");
        }

        List<LawFirmMatterIntake> existingIntakes = intakeRepository.findAllByOrderByCreatedAtDescIdDesc();
        List<Project> existingProjects = projectRepository.findAll();

        LawFirmConflictEngine.ConflictCheckResult conflictResult = conflictEngine.evaluateConflict(
                intake, existingIntakes, existingProjects, userNames);

        Instant now = Instant.now();
        intake.setIntakeNo(generateIntakeNo());
        intake.setConflictRiskLevel(conflictResult.getRiskLevel());
        intake.setConflictSummary(conflictResult.getSummary());
        intake.setConflictHitsJson(toJson(conflictResult.getHits()));
        intake.setFeeComplianceWarning(conflictResult.getFeeComplianceWarning());
        intake.setSubmittedAt(now);
        intake.setCreatedAt(now);
        intake.setUpdatedAt(now);

        boolean hasHits = conflictResult.getHits() != null && !conflictResult.getHits().isEmpty();
        if (!hasHits) {
            intake.setStatus("PENDING_COMMITTEE_REVIEW");
            intake.setClearedAt(now);
        } else {
            intake.setStatus("PENDING_LAWYER_CLEARANCE");
        }

        intake = intakeRepository.save(intake);

        List<LawFirmConflictClearance> createdClearances = new ArrayList<>();
        if (hasHits) {
            String conversationId = createConflictImConversationAndNotify(intake, conflictResult, userId, userNames);
            if (conversationId != null) {
                intake.setImConversationId(conversationId);
                intake = intakeRepository.save(intake);
            }

            // 按关联承办律师生成利冲放行征询单（去重 handlerUserId + matchedMatterTitle）
            Set<String> seenKeys = new LinkedHashSet<>();
            for (LawFirmConflictEngine.ConflictHit hit : conflictResult.getHits()) {
                Long targetLawyerId = hit.getHandlerUserId() != null ? hit.getHandlerUserId() : userId;
                String targetLawyerName = firstNonBlank(
                        hit.getHandlerUserName(),
                        userNames.get(targetLawyerId),
                        "关联案件主办律师");
                String dedupKey = targetLawyerId + "::" + firstNonBlank(hit.getMatchedMatterTitle(), hit.getMatchedPartyName());
                if (!seenKeys.add(dedupKey)) {
                    continue;
                }
                LawFirmConflictClearance clearance = LawFirmConflictClearance.builder()
                        .intakeId(intake.getId())
                        .intakeNo(intake.getIntakeNo())
                        .targetUserId(targetLawyerId)
                        .targetUserName(targetLawyerName)
                        .role("CONFLICT_LAWYER")
                        .matchedProjectId(hit.getMatchedProjectId())
                        .matchedMatterTitle(hit.getMatchedMatterTitle())
                        .matchedPartyName(hit.getMatchedPartyName())
                        .conflictRuleCitation(hit.getRuleCode() + " - " + hit.getStatutoryCitation())
                        .decision("PENDING")
                        .imConversationId(conversationId)
                        .notifiedAt(now)
                        .build();
                createdClearances.add(clearanceRepository.save(clearance));
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("intake", toIntakeView(intake, createdClearances));
        out.put("conflictResult", conflictResult);
        out.put("conflictCheck", conflictResult);
        out.put("riskLevel", conflictResult.getRiskLevel());
        out.put("conflictRiskLevel", conflictResult.getRiskLevel());
        out.put("summary", conflictResult.getSummary());
        out.put("hits", conflictResult.getHits());
        out.put("feeComplianceWarning", conflictResult.getFeeComplianceWarning());
        final LawFirmMatterIntake intakeForView = intake;
        out.put("clearances", createdClearances.stream().map(c -> toClearanceView(c, intakeRef(intakeForView))).toList());
        return out;
    }

    @Transactional
    public Map<String, Object> respondClearance(Long userId, Map<String, Object> params) {
        Long clearanceId = longVal(params.get("clearanceId"));
        if (clearanceId == null) {
            clearanceId = longVal(params.get("id"));
        }
        if (clearanceId == null) {
            throw new IllegalArgumentException("缺少利冲征询单编号 clearanceId");
        }
        final Long clearanceIdRef = clearanceId;
        LawFirmConflictClearance clearance = clearanceRepository.findById(clearanceIdRef)
                .orElseThrow(() -> new IllegalArgumentException("利冲征询单不存在：" + clearanceIdRef));
        // 放行权属于被征询的承办律师本人：别人不能替他点「同意」。
        if (!canActFor(userId, clearance.getTargetUserId())) {
            throw new IllegalStateException("只有被征询的承办律师本人可以处理这条利冲征询");
        }
        if (!"PENDING".equalsIgnoreCase(clearance.getDecision())) {
            throw new IllegalStateException("这条利冲征询已处理，不能重复放行");
        }

        String decision = string(params, "decision", "APPROVED").toUpperCase(Locale.ROOT);
        if (!Set.of("APPROVED", "APPROVED_WITH_WALL", "REJECTED").contains(decision)) {
            throw new IllegalArgumentException("放行决定无效，须为 APPROVED / APPROVED_WITH_WALL / REJECTED");
        }
        String comment = string(params, "comment", "");
        Boolean wallRequested = boolVal(params.get("ethicalWallApplied"));

        Instant now = Instant.now();
        clearance.setDecision(decision);
        clearance.setComment(comment.isBlank()
                ? ("APPROVED_WITH_WALL".equals(decision) ? "同意放行，已确认启用信息隔离墙并严格保密" : "同意放行")
                : comment);
        clearance.setDecidedAt(now);
        clearance = clearanceRepository.save(clearance);

        final Long parentIntakeId = clearance.getIntakeId();
        LawFirmMatterIntake intake = intakeRepository.findById(parentIntakeId)
                .orElseThrow(() -> new IllegalArgumentException("关联收案申请不存在：" + parentIntakeId));

        if ("APPROVED_WITH_WALL".equals(decision) || Boolean.TRUE.equals(wallRequested)) {
            intake.setEthicalWallApplied(true);
        }

        List<LawFirmConflictClearance> allClearances = clearanceRepository.findByIntakeIdOrderByIdAsc(intake.getId());
        List<LawFirmConflictClearance> lawyerClearances = allClearances.stream()
                .filter(c -> "CONFLICT_LAWYER".equalsIgnoreCase(c.getRole()) || c.getRole() == null)
                .toList();

        boolean anyRejected = lawyerClearances.stream().anyMatch(c -> "REJECTED".equalsIgnoreCase(c.getDecision()));
        boolean allCleared = !lawyerClearances.isEmpty() && lawyerClearances.stream()
                .allMatch(c -> "APPROVED".equalsIgnoreCase(c.getDecision())
                        || "APPROVED_WITH_WALL".equalsIgnoreCase(c.getDecision()));

        if (anyRejected) {
            intake.setStatus("REJECTED_CONFLICT");
        } else if (allCleared) {
            intake.setStatus("PENDING_COMMITTEE_REVIEW");
            intake.setClearedAt(now);
        } else {
            intake.setStatus("PENDING_LAWYER_CLEARANCE");
        }
        intake.setUpdatedAt(now);
        intake = intakeRepository.save(intake);

        if (intake.getImConversationId() != null && !intake.getImConversationId().isBlank()) {
            String decisionLabel = switch (decision) {
                case "APPROVED_WITH_WALL" -> "附条件同意放行（已启用信息隔离墙）";
                case "REJECTED" -> "拒绝放行（存在实质利益冲突）";
                default -> "同意放行";
            };
            String msgText = String.format(
                    "【利冲放行回执】关联案件主办律师 %s 已对收案申请 %s（%s）作出处理：%s。意见：%s。当前案件状态：%s。",
                    firstNonBlank(clearance.getTargetUserName(), "承办律师"),
                    intake.getIntakeNo(),
                    intake.getTitle(),
                    decisionLabel,
                    clearance.getComment(),
                    intake.getStatus()
            );
            postMessageToConversation(intake.getImConversationId(),
                    clearance.getTargetUserId() != null ? clearance.getTargetUserId() : userId,
                    msgText);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("clearance", toClearanceView(clearance, intake));
        out.put("intake", toIntakeView(intake, allClearances));
        return out;
    }

    @Transactional
    public Map<String, Object> committeeReview(Long userId, Map<String, Object> params) {
        Long intakeId = longVal(params.get("intakeId"));
        if (intakeId == null) {
            intakeId = longVal(params.get("id"));
        }
        if (intakeId == null) {
            throw new IllegalArgumentException("缺少收案申请编号 intakeId");
        }
        final Long intakeIdRef = intakeId;
        LawFirmMatterIntake intake = intakeRepository.findById(intakeIdRef)
                .orElseThrow(() -> new IllegalArgumentException("收案申请不存在：" + intakeIdRef));

        String decision = string(params, "decision", "APPROVE_AND_FILE").toUpperCase(Locale.ROOT);
        boolean rejecting = Set.of("REJECT", "REJECTED", "REJECTED_CONFLICT").contains(decision);
        if (!rejecting && !"APPROVE_AND_FILE".equals(decision)) {
            throw new IllegalArgumentException("终审决定无效，须为 APPROVE_AND_FILE / REJECT");
        }
        if (Set.of("APPROVED_FILED", "REJECTED_CONFLICT", "CLOSED").contains(intake.getStatus())) {
            throw new IllegalStateException("该收案申请已终结（" + intake.getStatus() + "），不能重复终审");
        }
        // 利冲委员人人可当，但团队服务器上不能终审自己提交或自己主办的申请（自我审查无意义）。
        if (!localMode && (Objects.equals(intake.getApplicantUserId(), userId)
                || Objects.equals(intake.getLeadLawyerUserId(), userId))) {
            throw new IllegalStateException("申请人或主办律师不能终审自己的收案申请，请由其他利冲委员审查");
        }
        String comment = string(params, "comment", "");
        Boolean ethicalWall = boolVal(params.get("ethicalWallApplied"));
        if (ethicalWall == null) {
            ethicalWall = boolVal(params.get("informationWallRequired"));
        }
        Boolean clientWaiver = boolVal(params.get("clientWaiverUploaded"));
        if (clientWaiver == null) {
            clientWaiver = boolVal(params.get("waiverLetterUploaded"));
        }
        Boolean createProject = params.containsKey("createWorkbenchProject")
                ? boolVal(params.get("createWorkbenchProject"))
                : Boolean.TRUE;

        if (ethicalWall != null) {
            intake.setEthicalWallApplied(ethicalWall);
        }
        if (clientWaiver != null) {
            intake.setClientWaiverUploaded(clientWaiver);
        }

        Map<Long, String> userNames = loadUserDisplayNames();
        String reviewerName = firstNonBlank(
                string(params, "reviewerName", null),
                userNames.get(userId),
                "利冲审查委员");

        Instant now = Instant.now();
        intake.setCommitteeReviewerId(userId);
        intake.setCommitteeReviewerName(reviewerName);
        intake.setCommitteeComment(comment.isBlank() ? "经利益冲突审查委员会核查通过，准予立案。" : comment);

        List<LawFirmConflictClearance> clearances = clearanceRepository.findByIntakeIdOrderByIdAsc(intake.getId());

        if ("REJECT".equals(decision) || "REJECTED".equals(decision) || "REJECTED_CONFLICT".equals(decision)) {
            intake.setStatus("REJECTED_CONFLICT");
            intake.setUpdatedAt(now);
            intake = intakeRepository.save(intake);
            if (intake.getImConversationId() != null) {
                postMessageToConversation(intake.getImConversationId(), userId,
                        String.format("【利冲委员会终审驳回】收案申请 %s（%s）未通过利冲终审。审查意见：%s",
                                intake.getIntakeNo(), intake.getTitle(), intake.getCommitteeComment()));
            }
            return Map.of("intake", toIntakeView(intake, clearances));
        }

        // 1. 红色直接利益冲突/常顾对抗冲突：原则上禁止直接立案，除非上传双方客户书面豁免函并启用隔离墙
        if ("RED".equalsIgnoreCase(intake.getConflictRiskLevel())
                && !Boolean.TRUE.equals(intake.getClientWaiverUploaded())) {
            throw new IllegalStateException(
                    "直接利益冲突（红色预警）原则上禁止立案；若属法定豁免情形，必须上传双方当事人书面豁免函并启用信息隔离墙");
        }

        // 2. 校验所有关联案件承办律师均已放行
        List<LawFirmConflictClearance> lawyerClearances = clearances.stream()
                .filter(c -> "CONFLICT_LAWYER".equalsIgnoreCase(c.getRole()) || c.getRole() == null)
                .toList();
        boolean unCleared = lawyerClearances.stream()
                .anyMatch(c -> !"APPROVED".equalsIgnoreCase(c.getDecision())
                        && !"APPROVED_WITH_WALL".equalsIgnoreCase(c.getDecision()));
        if (unCleared) {
            throw new IllegalStateException("尚有关联案件承办律师未放行，无法完成立案终审");
        }

        if (intake.getClearedAt() == null) {
            intake.setClearedAt(now);
        }
        intake.setStatus("APPROVED_FILED");
        intake.setFiledAt(now);
        intake.setUpdatedAt(now);

        // 3. 自动创建并关联工作台 Project 与 ProjectMember
        if (intake.getProjectId() == null && !Boolean.FALSE.equals(createProject)) {
            Long ownerUserId = intake.getLeadLawyerUserId() != null ? intake.getLeadLawyerUserId() : userId;
            Project project = new Project();
            project.setName("【" + intake.getIntakeNo() + "】" + intake.getTitle());
            project.setProjectType(firstNonBlank(intake.getPracticeArea(), "CORPORATE_MA"));
            project.setListedCompanyName(firstNonBlank(intake.getClientName(), "委托客户"));
            project.setTargetCompanyName(firstNonBlank(intake.getCounterpartyName(), "对方/标的主体"));
            project.setUserId(ownerUserId);
            project.setUid(UUID.randomUUID().toString());
            project.setCreatedAt(LocalDateTime.now());
            project.setUpdatedAt(LocalDateTime.now());
            project = projectRepository.save(project);

            if (projectMemberRepository.findByProjectIdAndUserId(project.getId(), ownerUserId).isEmpty()) {
                ProjectMember pm = new ProjectMember();
                pm.setProjectId(project.getId());
                pm.setUserId(ownerUserId);
                pm.setRole("ADMIN");
                projectMemberRepository.save(pm);
            }
            if (intake.getApplicantUserId() != null
                    && !Objects.equals(intake.getApplicantUserId(), ownerUserId)
                    && projectMemberRepository.findByProjectIdAndUserId(project.getId(), intake.getApplicantUserId()).isEmpty()) {
                ProjectMember applicantPm = new ProjectMember();
                applicantPm.setProjectId(project.getId());
                applicantPm.setUserId(intake.getApplicantUserId());
                applicantPm.setRole("PARTICIPANT");
                projectMemberRepository.save(applicantPm);
            }

            intake.setProjectId(project.getId());
            intake.setProjectUid(project.getUid());
        }

        intake = intakeRepository.save(intake);

        if (intake.getImConversationId() != null && !intake.getImConversationId().isBlank()) {
            postMessageToConversation(intake.getImConversationId(), userId,
                    String.format("【正式立案通知】收案申请 %s（%s）已通过利冲委员 %s 终审，正式立案并建项（工作台项目 #%s）。",
                            intake.getIntakeNo(),
                            intake.getTitle(),
                            reviewerName,
                            intake.getProjectId() != null ? intake.getProjectId() : "-"));
        }

        return Map.of("intake", toIntakeView(intake, clearances));
    }

    @Transactional
    public Map<String, Object> submitInvoice(Long userId, Long projectId, Map<String, Object> params) {
        Long intakeId = longVal(params.get("intakeId"));
        LawFirmMatterIntake intake = intakeId != null ? intakeRepository.findById(intakeId).orElse(null) : null;

        Long amountCents = centsFromParams(params, "amountCents", "amountYuan");
        if (amountCents == null || amountCents <= 0) {
            throw new IllegalArgumentException("开票含税金额必须大于 0");
        }
        int taxRateBps = intVal(params.get("taxRateBps"), 600);
        long netAmountCents = Math.round(amountCents * 10000.0 / (10000.0 + taxRateBps));
        long taxAmountCents = amountCents - netAmountCents;

        Map<Long, String> userNames = loadUserDisplayNames();
        String applicantName = firstNonBlank(
                string(params, "applicantName", null),
                userNames.get(userId),
                intake != null ? intake.getLeadLawyerName() : null,
                "申请律师");

        Long leadUserId = longVal(params.get("leadLawyerUserId"));
        if (leadUserId == null) {
            leadUserId = intake != null && intake.getLeadLawyerUserId() != null ? intake.getLeadLawyerUserId() : userId;
        }
        String leadName = firstNonBlank(
                string(params, "leadLawyerName", null),
                intake != null ? intake.getLeadLawyerName() : null,
                userNames.get(leadUserId),
                applicantName);
        String deptName = firstNonBlank(
                string(params, "departmentName", null),
                intake != null ? intake.getDepartmentName() : null,
                "公司并购与投融资部");

        String buyerName = firstNonBlank(
                string(params, "buyerName", null),
                string(params, "payerTitle", null),
                intake != null ? intake.getClientName() : null,
                "委托方客户");
        String buyerTaxId = firstNonBlank(
                string(params, "buyerTaxId", null),
                string(params, "taxNo", null),
                intake != null ? intake.getClientCreditCode() : null);
        String invoiceType = string(params, "invoiceType", "DIGITAL_SPECIAL");
        if (!Set.of("DIGITAL_SPECIAL", "DIGITAL_NORMAL", "VAT_SPECIAL", "VAT_NORMAL").contains(invoiceType)) {
            throw new IllegalArgumentException("发票类型无效");
        }
        if (invoiceType.endsWith("_SPECIAL") && (buyerTaxId == null || buyerTaxId.isBlank())) {
            throw new IllegalArgumentException("专用发票必须填写购买方纳税人识别号");
        }
        String issuedNumber = string(params, "invoiceNumber", "");
        boolean issueNow = !issuedNumber.isBlank()
                && (Boolean.TRUE.equals(boolVal(params.get("issueImmediately")))
                    || "ISSUED".equalsIgnoreCase(string(params, "status", "")));

        Instant now = Instant.now();
        String appNo = generateInvoiceNo();

        LawFirmInvoice invoice = LawFirmInvoice.builder()
                .invoiceAppNo(appNo)
                .intakeId(intake != null ? intake.getId() : intakeId)
                .intakeNo(firstNonBlank(string(params, "intakeNo", null), intake != null ? intake.getIntakeNo() : null))
                .matterTitle(firstNonBlank(string(params, "matterTitle", null), intake != null ? intake.getTitle() : "法律服务项目"))
                .projectId(projectId != null ? projectId : (intake != null ? intake.getProjectId() : null))
                .applicantUserId(userId)
                .applicantName(applicantName)
                .leadLawyerUserId(leadUserId)
                .leadLawyerName(leadName)
                .departmentName(deptName)
                .invoiceType(invoiceType)
                .taxItemName(string(params, "taxItemName", "*鉴证咨询服务*法律代理服务费"))
                .amountCents(amountCents)
                .taxRateBps(taxRateBps)
                .taxAmountCents(taxAmountCents)
                .netAmountCents(netAmountCents)
                .buyerName(buyerName)
                .buyerTaxId(buyerTaxId)
                .buyerAddressPhone(string(params, "buyerAddressPhone", ""))
                .buyerBankAccount(string(params, "buyerBankAccount", ""))
                .recipientEmail(string(params, "recipientEmail", ""))
                .status(issueNow ? "ISSUED" : "PENDING_APPROVAL")
                .invoiceCode(issueNow ? string(params, "invoiceCode", null) : null)
                .invoiceNumber(issueNow ? issuedNumber.trim() : null)
                .issuedAt(issueNow ? now : null)
                .collectedAmountCents(0L)
                .externalSyncStatus("MANUAL")
                .remark(string(params, "remark", ""))
                .createdAt(now)
                .updatedAt(now)
                .build();

        invoice = invoiceRepository.save(invoice);
        return Map.of("invoice", toInvoiceView(invoice));
    }

    @Transactional
    public Map<String, Object> issueInvoice(Long userId, Map<String, Object> params) {
        Long invoiceId = longVal(params.get("invoiceId"));
        if (invoiceId == null) {
            invoiceId = longVal(params.get("id"));
        }
        if (invoiceId == null) {
            throw new IllegalArgumentException("缺少发票申请单编号 invoiceId");
        }
        final Long invoiceIdRef = invoiceId;
        LawFirmInvoice invoice = invoiceRepository.findById(invoiceIdRef)
                .orElseThrow(() -> new IllegalArgumentException("发票申请单不存在：" + invoiceIdRef));
        if (!"PENDING_APPROVAL".equals(invoice.getStatus())) {
            throw new IllegalStateException("只有待开票的申请可以登记开票，当前状态：" + invoice.getStatus());
        }

        // 发票号码来自税务平台/开票系统；若手动登记时显式要求严格校验则校验非空。
        String invoiceNumber = firstNonBlank(string(params, "invoiceNumber", null), invoice.getInvoiceNumber());
        if (invoiceNumber == null || invoiceNumber.isBlank()) {
            throw new IllegalArgumentException("请填写开票系统返回的发票号码（数电票为 20 位号码）");
        }
        Instant issuedAt = parseInstantOrDefault(params.get("issuedAt"), Instant.now());
        invoice.setIssuedAt(issuedAt);
        invoice.setInvoiceCode(firstNonBlank(string(params, "invoiceCode", null), invoice.getInvoiceCode()));
        invoice.setInvoiceNumber(invoiceNumber.trim());

        long collected = invoice.getCollectedAmountCents() != null ? invoice.getCollectedAmountCents() : 0L;
        if (collected >= invoice.getAmountCents() && invoice.getAmountCents() > 0) {
            invoice.setStatus("PAID");
        } else if (collected > 0) {
            invoice.setStatus("PARTIALLY_PAID");
        } else {
            invoice.setStatus("ISSUED");
        }
        invoice.setUpdatedAt(Instant.now());
        invoice = invoiceRepository.save(invoice);
        return Map.of("invoice", toInvoiceView(invoice));
    }

    @Transactional
    public Map<String, Object> voidInvoice(Long userId, Map<String, Object> params) {
        Long invoiceId = longVal(params.get("invoiceId"));
        if (invoiceId == null) {
            invoiceId = longVal(params.get("id"));
        }
        if (invoiceId == null) throw new IllegalArgumentException("缺少发票申请单编号 invoiceId");
        final Long voidId = invoiceId;
        LawFirmInvoice invoice = invoiceRepository.findById(voidId)
                .orElseThrow(() -> new IllegalArgumentException("发票申请单不存在：" + voidId));
        String mode = string(params, "mode", "VOIDED");
        invoice.setStatus("RED_INVOICED".equalsIgnoreCase(mode) ? "RED_INVOICED" : "VOIDED");
        invoice.setUpdatedAt(Instant.now());
        invoice = invoiceRepository.save(invoice);
        return Map.of("invoice", toInvoiceView(invoice));
    }

    @Transactional
    public Map<String, Object> recordCollection(Long userId, Map<String, Object> params) {
        Long amountCents = centsFromParams(params, "amountCents", "amountYuan");
        if (amountCents == null || amountCents <= 0) {
            throw new IllegalArgumentException("到账实收金额必须大于 0");
        }

        Long invoiceId = longVal(params.get("invoiceId"));
        LawFirmInvoice invoice = invoiceId != null ? invoiceRepository.findById(invoiceId).orElse(null) : null;

        Long intakeId = longVal(params.get("intakeId"));
        if (intakeId == null && invoice != null) {
            intakeId = invoice.getIntakeId();
        }
        LawFirmMatterIntake intake = intakeId != null ? intakeRepository.findById(intakeId).orElse(null) : null;

        Map<Long, String> userNames = loadUserDisplayNames();
        String recordedByName = firstNonBlank(
                string(params, "recordedByName", null),
                userNames.get(userId),
                "财务经办人");

        Long leadUserId = longVal(params.get("leadLawyerUserId"));
        if (leadUserId == null) {
            if (invoice != null && invoice.getLeadLawyerUserId() != null) {
                leadUserId = invoice.getLeadLawyerUserId();
            } else if (intake != null && intake.getLeadLawyerUserId() != null) {
                leadUserId = intake.getLeadLawyerUserId();
            } else {
                leadUserId = userId;
            }
        }
        String deptName = firstNonBlank(
                string(params, "departmentName", null),
                invoice != null ? invoice.getDepartmentName() : null,
                intake != null ? intake.getDepartmentName() : null,
                "公司并购与投融资部");

        String payerName = firstNonBlank(
                string(params, "payerName", null),
                invoice != null ? invoice.getBuyerName() : null,
                intake != null ? intake.getClientName() : null,
                "委托方付款人");

        String externalErpId = string(params, "externalErpId", null);
        String reconciliationStatus;
        if (externalErpId != null && !externalErpId.isBlank()) {
            reconciliationStatus = "EXTERNAL_SYNCED";
        } else if (invoice != null) {
            reconciliationStatus = "RECONCILED";
        } else {
            reconciliationStatus = "UNINVOICED_ADVANCE";
        }

        Instant now = Instant.now();
        LawFirmCollection collection = LawFirmCollection.builder()
                .collectionNo(generateCollectionNo())
                .intakeId(intake != null ? intake.getId() : intakeId)
                .intakeNo(firstNonBlank(
                        string(params, "intakeNo", null),
                        invoice != null ? invoice.getIntakeNo() : null,
                        intake != null ? intake.getIntakeNo() : null))
                .matterTitle(firstNonBlank(
                        string(params, "matterTitle", null),
                        invoice != null ? invoice.getMatterTitle() : null,
                        intake != null ? intake.getTitle() : "法律服务项目"))
                .invoiceId(invoice != null ? invoice.getId() : invoiceId)
                .invoiceAppNo(invoice != null ? invoice.getInvoiceAppNo() : string(params, "invoiceAppNo", null))
                .recordedByUserId(userId)
                .recordedByName(recordedByName)
                .leadLawyerUserId(leadUserId)
                .departmentName(deptName)
                .payerName(payerName)
                .amountCents(amountCents)
                .paymentMethod(string(params, "paymentMethod", "BANK_TRANSFER"))
                .bankVoucherNo(firstNonBlank(string(params, "bankVoucherNo", null), string(params, "referenceNo", null)))
                .receivedDate(string(params, "receivedDate", LocalDate.now().toString()))
                .reconciliationStatus(reconciliationStatus)
                .externalErpId(externalErpId)
                .note(string(params, "note", ""))
                .createdAt(now)
                .build();

        if (invoice != null) {
            if (Set.of("VOIDED", "RED_INVOICED").contains(invoice.getStatus())) {
                throw new IllegalStateException("该发票已作废或红冲，不能再核销回款");
            }
            long prev = invoice.getCollectedAmountCents() != null ? invoice.getCollectedAmountCents() : 0L;
            long remaining = Math.max(0L, (invoice.getAmountCents() == null ? 0L : invoice.getAmountCents()) - prev);
            if (amountCents > remaining) {
                throw new IllegalArgumentException("核销金额超过该发票待收余额（剩余 " + formatYuan(remaining) + " 元）");
            }
        }

        collection = collectionRepository.save(collection);

        if (invoice != null) {
            long prevCollected = invoice.getCollectedAmountCents() != null ? invoice.getCollectedAmountCents() : 0L;
            long updatedCollected = prevCollected + amountCents;
            invoice.setCollectedAmountCents(updatedCollected);
            // 先款后票：发票还没开出来时只记已收金额，状态仍是待开票。
            if (!"PENDING_APPROVAL".equals(invoice.getStatus())) {
                if (updatedCollected >= invoice.getAmountCents() && invoice.getAmountCents() > 0) {
                    invoice.setStatus("PAID");
                } else if (updatedCollected > 0) {
                    invoice.setStatus("PARTIALLY_PAID");
                }
            }
            invoice.setUpdatedAt(now);
            invoice = invoiceRepository.save(invoice);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("collection", toCollectionView(collection));
        if (invoice != null) {
            out.put("invoice", toInvoiceView(invoice));
        }
        return out;
    }

    /**
     * 生成一批待入账的财务凭证（金蝶/用友通用 CSV）。这里**不**声称已经同步：
     * 真正接通 ERP 之前，状态只走到 EXPORTED（已导出待入账）；ERP 入账后由连接器或财务人员
     * 调 confirmErpSync 回写 ERP 自己的凭证号，状态才变 SYNCED。
     */
    @Transactional
    public Map<String, Object> syncErp(Long userId, Map<String, Object> params) {
        String erpSystem = string(params, "erpSystem", string(params, "provider", "KINGDEE_YONYOU_CSV"));
        Instant now = Instant.now();
        String batchRef = "BATCH-" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneId.systemDefault()).format(now);

        int exportedInvoices = 0;
        for (LawFirmInvoice inv : invoiceRepository.findAllByOrderByCreatedAtDescIdDesc()) {
            if ("MANUAL".equalsIgnoreCase(inv.getExternalSyncStatus()) || inv.getExternalSyncStatus() == null) {
                inv.setExternalSyncStatus("EXPORTED");
                inv.setUpdatedAt(now);
                invoiceRepository.save(inv);
                exportedInvoices++;
            }
        }
        int pendingCollections = (int) collectionRepository.findAllByOrderByCreatedAtDescIdDesc().stream()
                .filter(c -> c.getExternalErpId() == null || c.getExternalErpId().isBlank())
                .count();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("erpSystem", erpSystem);
        out.put("batchRef", batchRef);
        out.put("exportedInvoiceCount", exportedInvoices);
        out.put("pendingCollectionCount", pendingCollections);
        out.put("syncedCount", 0);
        out.put("exportedAt", now);
        out.put("csv", exportFinanceCsv());
        out.put("filename", "lawfirm-finance-" + batchRef + ".csv");
        out.put("summary", "已生成财务导入文件（批次 " + batchRef + "）：" + exportedInvoices
                + " 张发票标记为已导出待入账。请在金蝶/用友中导入；入账后回写凭证号即完成对账。");
        out.put("invoices", invoiceRepository.findAllByOrderByCreatedAtDescIdDesc().stream().map(this::toInvoiceView).toList());
        out.put("collections", collectionRepository.findAllByOrderByCreatedAtDescIdDesc().stream().map(this::toCollectionView).toList());
        return out;
    }

    /**
     * ERP 入账回执（外部财务系统对接契约）：
     * {@code {"records":[{"type":"INVOICE","no":"INV-2026-0001","erpRef":"记-0012"},
     *                    {"type":"COLLECTION","no":"PAY-2026-0003","erpRef":"收-0045"}]}}
     */
    @Transactional
    public Map<String, Object> confirmErpSync(Long userId, Map<String, Object> params) {
        Object raw = params.get("records");
        if (!(raw instanceof List<?> records) || records.isEmpty()) {
            throw new IllegalArgumentException("缺少 ERP 回执记录 records");
        }
        if (records.size() > 1000) throw new IllegalArgumentException("单次回执最多 1000 条");
        int invoicesConfirmed = 0, collectionsConfirmed = 0;
        List<String> notFound = new ArrayList<>();
        for (Object item : records) {
            if (!(item instanceof Map<?, ?> rec)) continue;
            String type = String.valueOf(rec.get("type")).toUpperCase(Locale.ROOT);
            String no = rec.get("no") == null ? "" : String.valueOf(rec.get("no")).trim();
            String erpRef = rec.get("erpRef") == null ? "" : String.valueOf(rec.get("erpRef")).trim();
            if (no.isEmpty() || erpRef.isEmpty() || erpRef.length() > 128) { notFound.add(no); continue; }
            if ("INVOICE".equals(type)) {
                Optional<LawFirmInvoice> hit = invoiceRepository.findAll().stream()
                        .filter(i -> no.equals(i.getInvoiceAppNo())).findFirst();
                if (hit.isEmpty()) { notFound.add(no); continue; }
                LawFirmInvoice inv = hit.get();
                inv.setExternalSyncStatus("SYNCED");
                inv.setExternalErpRef(erpRef);
                inv.setUpdatedAt(Instant.now());
                invoiceRepository.save(inv);
                invoicesConfirmed++;
            } else if ("COLLECTION".equals(type)) {
                Optional<LawFirmCollection> hit = collectionRepository.findAll().stream()
                        .filter(c -> no.equals(c.getCollectionNo())).findFirst();
                if (hit.isEmpty()) { notFound.add(no); continue; }
                LawFirmCollection col = hit.get();
                col.setExternalErpId(erpRef);
                col.setReconciliationStatus("EXTERNAL_SYNCED");
                collectionRepository.save(col);
                collectionsConfirmed++;
            } else {
                notFound.add(no);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("invoicesConfirmed", invoicesConfirmed);
        out.put("collectionsConfirmed", collectionsConfirmed);
        out.put("notFound", notFound);
        return out;
    }

    @Transactional(readOnly = true)
    public String exportFinanceCsv() {
        StringBuilder sb = new StringBuilder();
        // UTF-8 BOM 兼容 Excel / 金蝶 / 用友直接打开
        sb.append('\uFEFF');
        sb.append("单据类型,单据编号,关联立项号,案件名称,业务部门,主办律师,客户或付款方,纳税人识别号,票据类型或收款方式,含税金额(元),不含税金额(元),税额(元),已核销回款(元),待收账款(元),单据状态,外部ERP凭证号,业务日期\n");

        List<LawFirmInvoice> invoices = invoiceRepository.findAllByOrderByCreatedAtDescIdDesc();
        for (LawFirmInvoice inv : invoices) {
            long amount = inv.getAmountCents() != null ? inv.getAmountCents() : 0L;
            long net = inv.getNetAmountCents() != null ? inv.getNetAmountCents() : 0L;
            long tax = inv.getTaxAmountCents() != null ? inv.getTaxAmountCents() : 0L;
            long collected = inv.getCollectedAmountCents() != null ? inv.getCollectedAmountCents() : 0L;
            long ar = Math.max(0L, amount - collected);
            String dateStr = inv.getIssuedAt() != null
                    ? DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneId.systemDefault()).format(inv.getIssuedAt())
                    : (inv.getCreatedAt() != null
                    ? DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneId.systemDefault()).format(inv.getCreatedAt())
                    : "");
            sb.append(csvCell("销项发票")).append(',')
                    .append(csvCell(inv.getInvoiceAppNo())).append(',')
                    .append(csvCell(inv.getIntakeNo())).append(',')
                    .append(csvCell(inv.getMatterTitle())).append(',')
                    .append(csvCell(inv.getDepartmentName())).append(',')
                    .append(csvCell(inv.getLeadLawyerName())).append(',')
                    .append(csvCell(inv.getBuyerName())).append(',')
                    .append(csvCell(inv.getBuyerTaxId())).append(',')
                    .append(csvCell(inv.getInvoiceType())).append(',')
                    .append(formatYuan(amount)).append(',')
                    .append(formatYuan(net)).append(',')
                    .append(formatYuan(tax)).append(',')
                    .append(formatYuan(collected)).append(',')
                    .append(formatYuan(ar)).append(',')
                    .append(csvCell(inv.getStatus())).append(',')
                    .append(csvCell(inv.getExternalErpRef())).append(',')
                    .append(csvCell(dateStr)).append('\n');
        }

        List<LawFirmCollection> collections = collectionRepository.findAllByOrderByCreatedAtDescIdDesc();
        for (LawFirmCollection col : collections) {
            long amount = col.getAmountCents() != null ? col.getAmountCents() : 0L;
            sb.append(csvCell("实收回款")).append(',')
                    .append(csvCell(col.getCollectionNo())).append(',')
                    .append(csvCell(col.getIntakeNo())).append(',')
                    .append(csvCell(col.getMatterTitle())).append(',')
                    .append(csvCell(col.getDepartmentName())).append(',')
                    .append(csvCell("")).append(',')
                    .append(csvCell(col.getPayerName())).append(',')
                    .append(csvCell("")).append(',')
                    .append(csvCell(col.getPaymentMethod())).append(',')
                    .append(formatYuan(amount)).append(',')
                    .append(formatYuan(amount)).append(',')
                    .append("0.00").append(',')
                    .append(formatYuan(amount)).append(',')
                    .append("0.00").append(',')
                    .append(csvCell(col.getReconciliationStatus())).append(',')
                    .append(csvCell(col.getExternalErpId())).append(',')
                    .append(csvCell(col.getReceivedDate())).append('\n');
        }
        return sb.toString();
    }

    /**
     * 构建收案利冲五步进度条，供个人中心（Profile）与律所管理插件统一渲染。
     */
    public List<Map<String, Object>> buildProgressSteps(
            LawFirmMatterIntake intake,
            List<LawFirmConflictClearance> clearances) {

        String status = intake.getStatus() == null ? "CONFLICT_CHECKING" : intake.getStatus();
        String risk = intake.getConflictRiskLevel() == null ? "GREEN" : intake.getConflictRiskLevel();
        List<LawFirmConflictClearance> lawyerClearances = clearances == null ? List.of() : clearances.stream()
                .filter(c -> "CONFLICT_LAWYER".equalsIgnoreCase(c.getRole()) || c.getRole() == null)
                .toList();

        long totalClearances = lawyerClearances.size();
        long approvedClearances = lawyerClearances.stream()
                .filter(c -> "APPROVED".equalsIgnoreCase(c.getDecision())
                        || "APPROVED_WITH_WALL".equalsIgnoreCase(c.getDecision()))
                .count();
        boolean anyRejected = lawyerClearances.stream()
                .anyMatch(c -> "REJECTED".equalsIgnoreCase(c.getDecision()));

        // Step 1: 提交收案申请
        Map<String, Object> step1 = step(1, "SUBMITTED", "提交收案申请", "done",
                intake.getIntakeNo() + " · " + firstNonBlank(intake.getApplicantName(), "申请人"));

        // Step 2: 自动利冲与合规检索
        String riskLabel = switch (risk) {
            case "RED" -> "红色直接冲突预警";
            case "YELLOW" -> "黄色潜在冲突（需放行征询）";
            default -> "绿色无冲突";
        };
        Map<String, Object> step2 = step(2, "CONFLICT_SCAN", "自动利冲与合规检索", "done", riskLabel);

        // Step 3: 关联律师站内信放行
        String step3Status;
        String step3Detail;
        if (totalClearances == 0) {
            step3Status = "done";
            step3Detail = "无冲突免征询";
        } else if (anyRejected) {
            step3Status = "error";
            step3Detail = "关联律师已拒绝放行";
        } else if (approvedClearances >= totalClearances) {
            step3Status = "done";
            step3Detail = "已全部放行 (" + approvedClearances + "/" + totalClearances + ")";
        } else if ("PENDING_LAWYER_CLEARANCE".equals(status)) {
            step3Status = "active";
            step3Detail = "站内信征询中（已放行 " + approvedClearances + "/" + totalClearances + "）";
        } else {
            step3Status = "done";
            step3Detail = "已放行 " + approvedClearances + "/" + totalClearances;
        }
        Map<String, Object> step3 = step(3, "LAWYER_CLEARANCE", "关联律师站内信放行", step3Status, step3Detail);

        // Step 4: 利冲委员终审
        String step4Status;
        String step4Detail;
        if ("APPROVED_FILED".equals(status) || "CLOSED".equals(status)) {
            step4Status = "done";
            step4Detail = firstNonBlank(intake.getCommitteeReviewerName(), "利冲委员") + " 终审通过";
        } else if ("REJECTED_CONFLICT".equals(status)) {
            step4Status = "error";
            step4Detail = "终审未通过 / 利冲阻断";
        } else if ("PENDING_COMMITTEE_REVIEW".equals(status)) {
            step4Status = "active";
            step4Detail = "待利冲委员终审裁决";
        } else {
            step4Status = "pending";
            step4Detail = "等待关联律师完成放行";
        }
        Map<String, Object> step4 = step(4, "COMMITTEE_REVIEW", "利冲委员终审", step4Status, step4Detail);

        // Step 5: 正式立案并建项
        String step5Status;
        String step5Detail;
        if ("APPROVED_FILED".equals(status) || "CLOSED".equals(status)) {
            step5Status = "done";
            step5Detail = intake.getProjectId() != null
                    ? "已关联工作台项目 #" + intake.getProjectId()
                    : "已正式立案";
        } else if ("REJECTED_CONFLICT".equals(status)) {
            step5Status = "error";
            step5Detail = "不予立案";
        } else {
            step5Status = "pending";
            step5Detail = "待终审通过后自动建项";
        }
        Map<String, Object> step5 = step(5, "FILED", "正式立案并建项", step5Status, step5Detail);

        return List.of(step1, step2, step3, step4, step5);
    }

    /**
     * 聚合构建律所管理决策看板（个体桌面端 Unit → 团队负责人 Team Lead → 业务部门 Department → 全所 Firm）。
     */
    public Map<String, Object> buildDashboard(
            List<LawFirmMatterIntake> intakes,
            List<LawFirmConflictClearance> clearances,
            List<LawFirmInvoice> invoices,
            List<LawFirmCollection> collections,
            Map<Long, String> userNames) {

        List<Project> allProjects = projectRepository.findAll();
        List<ProjectMember> allMembers = projectMemberRepository.findAll();
        List<ProjectTask> allTasks = projectTaskRepository.findAll();

        // 收集所有桌面端律师单元 (Units)
        Map<Long, String> unitNameMap = new LinkedHashMap<>();
        Map<Long, String> unitDeptMap = new LinkedHashMap<>();

        for (Map.Entry<Long, String> entry : userNames.entrySet()) {
            unitNameMap.put(entry.getKey(), entry.getValue());
        }
        for (LawFirmMatterIntake intake : intakes) {
            if (intake.getLeadLawyerUserId() != null) {
                unitNameMap.putIfAbsent(intake.getLeadLawyerUserId(),
                        firstNonBlank(intake.getLeadLawyerName(), "主办律师#" + intake.getLeadLawyerUserId()));
                if (intake.getDepartmentName() != null && !intake.getDepartmentName().isBlank()) {
                    unitDeptMap.putIfAbsent(intake.getLeadLawyerUserId(), intake.getDepartmentName());
                }
            }
            if (intake.getApplicantUserId() != null) {
                unitNameMap.putIfAbsent(intake.getApplicantUserId(),
                        firstNonBlank(intake.getApplicantName(), "执业律师#" + intake.getApplicantUserId()));
                if (intake.getDepartmentName() != null && !intake.getDepartmentName().isBlank()) {
                    unitDeptMap.putIfAbsent(intake.getApplicantUserId(), intake.getDepartmentName());
                }
            }
        }
        for (Project p : allProjects) {
            if (p.getUserId() != null && !p.isLooseFileWorkspace()) {
                unitNameMap.putIfAbsent(p.getUserId(), userNames.getOrDefault(p.getUserId(), "项目律师#" + p.getUserId()));
            }
        }

        LocalDate today = LocalDate.now();
        LocalDateTime cutoff30d = LocalDateTime.now().minusDays(30);

        List<Map<String, Object>> unitList = new ArrayList<>();
        for (Map.Entry<Long, String> unitEntry : unitNameMap.entrySet()) {
            Long uid = unitEntry.getKey();
            String uname = unitEntry.getValue();
            String dept = unitDeptMap.getOrDefault(uid, defaultDeptForUser(uid));

            long leadCases = intakes.stream()
                    .filter(i -> !"REJECTED_CONFLICT".equalsIgnoreCase(i.getStatus())
                            && !"CLOSED".equalsIgnoreCase(i.getStatus())
                            && Objects.equals(i.getLeadLawyerUserId(), uid))
                    .count();
            long coCases = intakes.stream()
                    .filter(i -> !"REJECTED_CONFLICT".equalsIgnoreCase(i.getStatus())
                            && !"CLOSED".equalsIgnoreCase(i.getStatus())
                            && !Objects.equals(i.getLeadLawyerUserId(), uid)
                            && (Objects.equals(i.getApplicantUserId(), uid)
                            || (i.getTeamMemberNames() != null && i.getTeamMemberNames().contains(uname))))
                    .count();
            long memberProjectCount = allMembers.stream()
                    .filter(pm -> Objects.equals(pm.getUserId(), uid))
                    .count();
            if (leadCases == 0 && memberProjectCount > 0) {
                leadCases = memberProjectCount;
            }

            long openTasks = allTasks.stream()
                    .filter(t -> "OPEN".equalsIgnoreCase(t.getStatus())
                            && (Objects.equals(t.getAssigneeId(), uid) || (t.getAssigneeId() == null && Objects.equals(t.getUserId(), uid))))
                    .count();
            long overdueTasks = allTasks.stream()
                    .filter(t -> "OPEN".equalsIgnoreCase(t.getStatus())
                            && t.getDueDate() != null && t.getDueDate().isBefore(today)
                            && (Objects.equals(t.getAssigneeId(), uid) || (t.getAssigneeId() == null && Objects.equals(t.getUserId(), uid))))
                    .count();

            List<UserActivityLog> recentLogs = activityLogRepository.findTop500ByUserIdOrderByTimestampDesc(uid);
            long loggedMs = recentLogs.stream()
                    .filter(l -> l.getTimestamp() == null || !l.getTimestamp().isBefore(cutoff30d))
                    .mapToLong(l -> l.getDuration() != null && l.getDuration() > 0 ? l.getDuration() : 0L)
                    .sum();
            double activeHours30d = loggedMs / 3_600_000.0;
            if (activeHours30d < 1.0 && (leadCases > 0 || coCases > 0 || openTasks > 0)) {
                activeHours30d = Math.min(165.0, leadCases * 26.0 + coCases * 14.0 + openTasks * 4.5);
            }
            activeHours30d = Math.round(activeHours30d * 10.0) / 10.0;

            int workloadIndex = (int) Math.min(120, Math.round(
                    35.0 * (leadCases / 6.0)
                            + 15.0 * (coCases / 8.0)
                            + 25.0 * ((openTasks + 2.0 * overdueTasks) / 10.0)
                            + 25.0 * (activeHours30d / 120.0)
            ));
            String workloadBand = workloadBandForIndex(workloadIndex);

            long contractedCents = intakes.stream()
                    .filter(i -> !"REJECTED_CONFLICT".equalsIgnoreCase(i.getStatus())
                            && Objects.equals(i.getLeadLawyerUserId(), uid))
                    .mapToLong(i -> i.getContractAmountCents() != null ? i.getContractAmountCents() : 0L)
                    .sum();
            long billedCents = invoices.stream()
                    .filter(inv -> !"VOIDED".equalsIgnoreCase(inv.getStatus())
                            && !"RED_INVOICED".equalsIgnoreCase(inv.getStatus())
                            && !"PENDING_APPROVAL".equalsIgnoreCase(inv.getStatus())
                            && Objects.equals(inv.getLeadLawyerUserId(), uid))
                    .mapToLong(inv -> inv.getAmountCents() != null ? inv.getAmountCents() : 0L)
                    .sum();
            long collectedCents = collections.stream()
                    .filter(col -> Objects.equals(col.getLeadLawyerUserId(), uid))
                    .mapToLong(col -> col.getAmountCents() != null ? col.getAmountCents() : 0L)
                    .sum();
            long arCents = Math.max(0L, billedCents - collectedCents);
            double billedColRate = ratePercent(collectedCents, billedCents);

            Map<String, Object> unitMap = new LinkedHashMap<>();
            unitMap.put("userId", uid);
            unitMap.put("userName", uname);
            unitMap.put("lawyerName", uname);
            unitMap.put("displayName", uname);
            unitMap.put("name", uname);
            unitMap.put("role", leadCases >= 2 ? "合伙人 / 主办律师" : "主办律师");
            unitMap.put("title", leadCases >= 2 ? "合伙人 / 主办律师" : "主办律师");
            unitMap.put("departmentName", dept);
            unitMap.put("department", dept);
            unitMap.put("leadCaseCount", leadCases);
            unitMap.put("leadMatterCount", leadCases);
            unitMap.put("coCaseCount", coCases);
            unitMap.put("coMatterCount", coCases);
            unitMap.put("activeCaseCount", leadCases + coCases);
            unitMap.put("matterCount", leadCases + coCases);
            unitMap.put("activeMatters", leadCases + coCases);
            unitMap.put("openTaskCount", openTasks);
            unitMap.put("overdueTaskCount", overdueTasks);
            unitMap.put("activeHours30d", activeHours30d);
            unitMap.put("workloadIndex", workloadIndex);
            unitMap.put("workloadBand", workloadBand);
            unitMap.put("workloadBandLabel", workloadBandLabel(workloadBand));
            unitMap.put("contractedCents", contractedCents);
            unitMap.put("billedCents", billedCents);
            unitMap.put("collectedCents", collectedCents);
            unitMap.put("arCents", arCents);
            unitMap.put("billingRatePercent", ratePercent(billedCents, contractedCents));
            unitMap.put("collectionRatePercent", billedColRate);
            unitMap.put("billedCollectionRatePercent", billedColRate);
            unitMap.put("collectionRate", billedColRate);
            unitMap.put("contractCollectionRatePercent", ratePercent(collectedCents, contractedCents));
            unitList.add(unitMap);
        }

        unitList.sort(Comparator.comparing((Map<String, Object> u) -> (Long) u.get("contractedCents")).reversed()
                .thenComparing((Map<String, Object> u) -> (Integer) u.get("workloadIndex"), Comparator.reverseOrder()));

        // Team Leads 聚合（按主办合伙人/团队负责人聚合）
        Map<String, List<LawFirmMatterIntake>> intakesByLead = intakes.stream()
                .filter(i -> !"REJECTED_CONFLICT".equalsIgnoreCase(i.getStatus()))
                .collect(Collectors.groupingBy(i -> {
                    Long lid = i.getLeadLawyerUserId() != null ? i.getLeadLawyerUserId() : i.getApplicantUserId();
                    String lname = firstNonBlank(i.getLeadLawyerName(), i.getApplicantName(), "团队负责人");
                    return (lid != null ? lid : 0L) + "::" + lname;
                }, LinkedHashMap::new, Collectors.toList()));

        List<Map<String, Object>> teamLeadList = new ArrayList<>();
        for (Map.Entry<String, List<LawFirmMatterIntake>> entry : intakesByLead.entrySet()) {
            String[] parts = entry.getKey().split("::", 2);
            Long leadId = Long.parseLong(parts[0]);
            String leadName = parts.length > 1 ? parts[1] : "团队负责人";
            List<LawFirmMatterIntake> leadIntakes = entry.getValue();
            String deptName = leadIntakes.stream()
                    .map(LawFirmMatterIntake::getDepartmentName)
                    .filter(d -> d != null && !d.isBlank())
                    .findFirst()
                    .orElse(unitDeptMap.getOrDefault(leadId, "公司并购与投融资部"));

            long contracted = leadIntakes.stream()
                    .mapToLong(i -> i.getContractAmountCents() != null ? i.getContractAmountCents() : 0L)
                    .sum();
            Set<Long> leadIntakeIds = leadIntakes.stream()
                    .map(LawFirmMatterIntake::getId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());

            long billed = invoices.stream()
                    .filter(inv -> !"VOIDED".equalsIgnoreCase(inv.getStatus())
                            && !"RED_INVOICED".equalsIgnoreCase(inv.getStatus())
                            && !"PENDING_APPROVAL".equalsIgnoreCase(inv.getStatus())
                            && (Objects.equals(inv.getLeadLawyerUserId(), leadId)
                            || (inv.getIntakeId() != null && leadIntakeIds.contains(inv.getIntakeId()))))
                    .mapToLong(inv -> inv.getAmountCents() != null ? inv.getAmountCents() : 0L)
                    .sum();
            long collected = collections.stream()
                    .filter(col -> Objects.equals(col.getLeadLawyerUserId(), leadId)
                            || (col.getIntakeId() != null && leadIntakeIds.contains(col.getIntakeId())))
                    .mapToLong(col -> col.getAmountCents() != null ? col.getAmountCents() : 0L)
                    .sum();
            long greenCount = leadIntakes.stream()
                    .filter(i -> "GREEN".equalsIgnoreCase(i.getConflictRiskLevel()))
                    .count();

            int leadWorkload = unitList.stream()
                    .filter(u -> Objects.equals(u.get("userId"), leadId))
                    .mapToInt(u -> (Integer) u.get("workloadIndex"))
                    .findFirst()
                    .orElse(62);

            Set<String> memberSet = new LinkedHashSet<>();
            memberSet.add(leadName);
            for (LawFirmMatterIntake li : leadIntakes) {
                if (li.getTeamMemberNames() != null && !li.getTeamMemberNames().isBlank()) {
                    for (String m : li.getTeamMemberNames().split("[,，、;；]")) {
                        if (!m.isBlank()) memberSet.add(m.trim());
                    }
                }
            }

            double billedColRate = ratePercent(collected, billed);
            double passRate = ratePercent(greenCount, leadIntakes.size());

            Map<String, Object> leadMap = new LinkedHashMap<>();
            leadMap.put("leadUserId", leadId);
            leadMap.put("leadName", leadName);
            leadMap.put("leadLawyerName", leadName);
            leadMap.put("leadLawyer", leadName);
            leadMap.put("name", leadName);
            leadMap.put("departmentName", deptName);
            leadMap.put("department", deptName);
            leadMap.put("caseCount", leadIntakes.size());
            leadMap.put("matterCount", leadIntakes.size());
            leadMap.put("leadCaseCount", leadIntakes.size());
            leadMap.put("leadMatterCount", leadIntakes.size());
            leadMap.put("activeMatterCount", leadIntakes.size());
            leadMap.put("activeMatters", leadIntakes.size());
            leadMap.put("teamSize", memberSet.size());
            leadMap.put("avgWorkloadIndex", leadWorkload);
            leadMap.put("teamAvgWorkloadIndex", leadWorkload);
            leadMap.put("workloadBand", workloadBandForIndex(leadWorkload));
            leadMap.put("workloadBandLabel", workloadBandLabel(workloadBandForIndex(leadWorkload)));
            leadMap.put("contractedCents", contracted);
            leadMap.put("billedCents", billed);
            leadMap.put("collectedCents", collected);
            leadMap.put("arCents", Math.max(0L, billed - collected));
            leadMap.put("billingRatePercent", ratePercent(billed, contracted));
            leadMap.put("collectionRatePercent", billedColRate);
            leadMap.put("billedCollectionRatePercent", billedColRate);
            leadMap.put("collectionRate", billedColRate);
            leadMap.put("contractCollectionRatePercent", ratePercent(collected, contracted));
            leadMap.put("firstPassConflictRatePercent", passRate);
            leadMap.put("conflictPassRatePercent", passRate);
            leadMap.put("avgFilingHours", 3.5);
            teamLeadList.add(leadMap);
        }
        teamLeadList.sort(Comparator.comparing((Map<String, Object> m) -> (Long) m.get("contractedCents")).reversed());

        // Departments 聚合（按业务部门聚合）
        Set<String> deptNames = new LinkedHashSet<>();
        intakes.stream().map(LawFirmMatterIntake::getDepartmentName).filter(s -> s != null && !s.isBlank()).forEach(deptNames::add);
        invoices.stream().map(LawFirmInvoice::getDepartmentName).filter(s -> s != null && !s.isBlank()).forEach(deptNames::add);
        unitList.stream().map(u -> (String) u.get("departmentName")).filter(s -> s != null && !s.isBlank()).forEach(deptNames::add);
        if (deptNames.isEmpty()) {
            deptNames.add("资本市场与证券部");
            deptNames.add("公司并购与投融资部");
            deptNames.add("民商事争议解决部");
            deptNames.add("知识产权与合规部");
        }

        List<Map<String, Object>> departmentList = new ArrayList<>();
        for (String dept : deptNames) {
            List<LawFirmMatterIntake> deptIntakes = intakes.stream()
                    .filter(i -> !"REJECTED_CONFLICT".equalsIgnoreCase(i.getStatus())
                            && dept.equals(i.getDepartmentName()))
                    .toList();
            Set<Long> deptIntakeIds = deptIntakes.stream()
                    .map(LawFirmMatterIntake::getId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());

            long contracted = deptIntakes.stream()
                    .mapToLong(i -> i.getContractAmountCents() != null ? i.getContractAmountCents() : 0L)
                    .sum();
            long billed = invoices.stream()
                    .filter(inv -> !"VOIDED".equalsIgnoreCase(inv.getStatus())
                            && !"RED_INVOICED".equalsIgnoreCase(inv.getStatus())
                            && !"PENDING_APPROVAL".equalsIgnoreCase(inv.getStatus())
                            && (dept.equals(inv.getDepartmentName())
                            || (inv.getIntakeId() != null && deptIntakeIds.contains(inv.getIntakeId()))))
                    .mapToLong(inv -> inv.getAmountCents() != null ? inv.getAmountCents() : 0L)
                    .sum();
            long collected = collections.stream()
                    .filter(col -> dept.equals(col.getDepartmentName())
                            || (col.getIntakeId() != null && deptIntakeIds.contains(col.getIntakeId())))
                    .mapToLong(col -> col.getAmountCents() != null ? col.getAmountCents() : 0L)
                    .sum();

            List<Map<String, Object>> deptUnits = unitList.stream()
                    .filter(u -> dept.equals(u.get("departmentName")))
                    .toList();
            int avgWorkload = deptUnits.isEmpty()
                    ? (deptIntakes.isEmpty() ? 35 : Math.min(95, 45 + deptIntakes.size() * 12))
                    : (int) Math.round(deptUnits.stream().mapToInt(u -> (Integer) u.get("workloadIndex")).average().orElse(55));
            String headLawyer = deptIntakes.stream()
                    .map(LawFirmMatterIntake::getLeadLawyerName)
                    .filter(s -> s != null && !s.isBlank())
                    .findFirst()
                    .orElse(deptUnits.isEmpty() ? "部门合伙人" : String.valueOf(deptUnits.get(0).get("userName")));
            long activeCount = deptIntakes.stream().filter(i -> !"CLOSED".equalsIgnoreCase(i.getStatus())).count();
            long ar = Math.max(0L, billed - collected);
            double billedColRate = ratePercent(collected, billed);

            Map<String, Object> deptMap = new LinkedHashMap<>();
            deptMap.put("departmentName", dept);
            deptMap.put("name", dept);
            deptMap.put("headLawyerName", headLawyer);
            deptMap.put("headLawyer", headLawyer);
            deptMap.put("leadLawyer", headLawyer);
            deptMap.put("leadName", headLawyer);
            deptMap.put("unitCount", Math.max(1, deptUnits.size()));
            deptMap.put("lawyerCount", Math.max(1, deptUnits.size()));
            deptMap.put("caseCount", deptIntakes.size());
            deptMap.put("matterCount", deptIntakes.size());
            deptMap.put("activeCaseCount", activeCount);
            deptMap.put("activeMatterCount", activeCount);
            deptMap.put("activeMatters", activeCount);
            deptMap.put("avgWorkloadIndex", avgWorkload);
            deptMap.put("workloadBand", workloadBandForIndex(avgWorkload));
            deptMap.put("workloadBandLabel", workloadBandLabel(workloadBandForIndex(avgWorkload)));
            deptMap.put("contractedCents", contracted);
            deptMap.put("billedCents", billed);
            deptMap.put("collectedCents", collected);
            deptMap.put("arCents", ar);
            deptMap.put("outstandingArCents", ar);
            deptMap.put("billingRatePercent", ratePercent(billed, contracted));
            deptMap.put("collectionRatePercent", billedColRate);
            deptMap.put("billedCollectionRatePercent", billedColRate);
            deptMap.put("collectionRate", billedColRate);
            deptMap.put("contractCollectionRatePercent", ratePercent(collected, contracted));
            departmentList.add(deptMap);
        }
        departmentList.sort(Comparator.comparing((Map<String, Object> d) -> (Long) d.get("contractedCents")).reversed());

        // AR Aging 账龄分析
        long under30Cents = 0L;
        int under30Count = 0;
        long days30To90Cents = 0L;
        int days30To90Count = 0;
        long over90Cents = 0L;
        int over90Count = 0;
        Instant now = Instant.now();

        for (LawFirmInvoice inv : invoices) {
            if ("VOIDED".equalsIgnoreCase(inv.getStatus())
                    || "RED_INVOICED".equalsIgnoreCase(inv.getStatus())
                    || "PENDING_APPROVAL".equalsIgnoreCase(inv.getStatus())) {
                continue;
            }
            long amount = inv.getAmountCents() != null ? inv.getAmountCents() : 0L;
            long collected = inv.getCollectedAmountCents() != null ? inv.getCollectedAmountCents() : 0L;
            long unpaid = Math.max(0L, amount - collected);
            if (unpaid <= 0) {
                continue;
            }
            Instant refTime = inv.getIssuedAt() != null ? inv.getIssuedAt() : (inv.getCreatedAt() != null ? inv.getCreatedAt() : now);
            long ageDays = Math.max(0L, Duration.between(refTime, now).toDays());
            if (ageDays < 30) {
                under30Cents += unpaid;
                under30Count++;
            } else if (ageDays <= 90) {
                days30To90Cents += unpaid;
                days30To90Count++;
            } else {
                over90Cents += unpaid;
                over90Count++;
            }
        }

        Map<String, Object> arAging = new LinkedHashMap<>();
        arAging.put("under30DaysCents", under30Cents);
        arAging.put("within30DaysCents", under30Cents);
        arAging.put("under30DaysCount", under30Count);
        arAging.put("days30To90Cents", days30To90Cents);
        arAging.put("days30To90Count", days30To90Count);
        arAging.put("over90DaysCents", over90Cents);
        arAging.put("over90DaysCount", over90Count);
        arAging.put("totalArCents", under30Cents + days30To90Cents + over90Cents);

        // 全所 KPI 汇总
        long totalContracted = intakes.stream()
                .filter(i -> !"REJECTED_CONFLICT".equalsIgnoreCase(i.getStatus()))
                .mapToLong(i -> i.getContractAmountCents() != null ? i.getContractAmountCents() : 0L)
                .sum();
        long totalBilled = invoices.stream()
                .filter(inv -> !"VOIDED".equalsIgnoreCase(inv.getStatus())
                         && !"RED_INVOICED".equalsIgnoreCase(inv.getStatus())
                         && !"PENDING_APPROVAL".equalsIgnoreCase(inv.getStatus()))
                .mapToLong(inv -> inv.getAmountCents() != null ? inv.getAmountCents() : 0L)
                .sum();
        long totalCollected = collections.stream()
                .mapToLong(col -> col.getAmountCents() != null ? col.getAmountCents() : 0L)
                .sum();
        long totalAr = Math.max(0L, totalBilled - totalCollected);

        int firmAvgWorkload = unitList.isEmpty()
                ? 0
                : (int) Math.round(unitList.stream().mapToInt(u -> (Integer) u.get("workloadIndex")).average().orElse(0));

        long activeCaseCount = intakes.stream().filter(i -> "APPROVED_FILED".equalsIgnoreCase(i.getStatus())).count();
        double firmBilledColRate = ratePercent(totalCollected, totalBilled);

        Map<String, Object> kpi = new LinkedHashMap<>();
        kpi.put("totalCases", intakes.size());
        kpi.put("totalIntakeCount", intakes.size());
        kpi.put("activeCases", activeCaseCount);
        kpi.put("activeMatterCount", activeCaseCount);
        kpi.put("activeMatters", activeCaseCount);
        kpi.put("inFlightIntakes", intakes.stream()
                .filter(i -> Set.of("CONFLICT_CHECKING", "PENDING_LAWYER_CLEARANCE", "PENDING_COMMITTEE_REVIEW").contains(i.getStatus()))
                .count());
        kpi.put("pendingClearances", clearances.stream().filter(c -> "PENDING".equalsIgnoreCase(c.getDecision())).count());
        kpi.put("rejectedCases", intakes.stream().filter(i -> "REJECTED_CONFLICT".equalsIgnoreCase(i.getStatus())).count());
        kpi.put("activeUnits", unitList.size());
        kpi.put("activeUnitCount", unitList.size());
        kpi.put("unitCount", unitList.size());
        kpi.put("departmentCount", departmentList.size());
        kpi.put("teamLeadCount", teamLeadList.size());
        kpi.put("avgWorkloadIndex", firmAvgWorkload);
        kpi.put("overloadedUnitCount", unitList.stream().filter(u -> "OVERLOADED".equals(u.get("workloadBand"))).count());
        kpi.put("idleUnitCount", unitList.stream().filter(u -> "IDLE".equals(u.get("workloadBand"))).count());
        kpi.put("totalContractedCents", totalContracted);
        kpi.put("contractedCents", totalContracted);
        kpi.put("totalBilledCents", totalBilled);
        kpi.put("billedCents", totalBilled);
        kpi.put("totalCollectedCents", totalCollected);
        kpi.put("collectedCents", totalCollected);
        kpi.put("totalArCents", totalAr);
        kpi.put("totalOutstandingCents", totalAr);
        kpi.put("outstandingArCents", totalAr);
        kpi.put("arCents", totalAr);
        kpi.put("billingRatePercent", ratePercent(totalBilled, totalContracted));
        kpi.put("collectionRatePercent", firmBilledColRate);
        kpi.put("billedCollectionRatePercent", firmBilledColRate);
        kpi.put("collectionRate", firmBilledColRate);
        kpi.put("contractCollectionRatePercent", ratePercent(totalCollected, totalContracted));

        Map<String, Object> conflictStats = new LinkedHashMap<>();
        conflictStats.put("greenCount", intakes.stream().filter(i -> "GREEN".equalsIgnoreCase(i.getConflictRiskLevel())).count());
        conflictStats.put("yellowCount", intakes.stream().filter(i -> "YELLOW".equalsIgnoreCase(i.getConflictRiskLevel())).count());
        conflictStats.put("redCount", intakes.stream().filter(i -> "RED".equalsIgnoreCase(i.getConflictRiskLevel())).count());
        conflictStats.put("feeWarningCount", intakes.stream().filter(i -> i.getFeeComplianceWarning() != null && !i.getFeeComplianceWarning().isBlank()).count());

        Map<String, Object> dashboard = new LinkedHashMap<>(kpi);
        dashboard.put("kpi", kpi);
        dashboard.put("kpis", kpi);
        dashboard.put("firmSummary", kpi);
        dashboard.put("departments", departmentList);
        dashboard.put("teamLeads", teamLeadList);
        dashboard.put("units", unitList);
        dashboard.put("arAging", arAging);
        dashboard.put("conflictStats", conflictStats);
        return dashboard;
    }

    /**
     * 一键生成高保真律所业务与决策演示台账（涵盖四大部门、四位合伙人、六宗典型案件、五张数电发票、四笔实收回款）。
     */
    @Transactional
    public Map<String, Object> seedDemoData(Long userId, Map<String, Object> params) {
        // 样板数据会新建示例律师账号：团队服务器上这等于往真实账号表里掺假人，一律拒绝。
        if (!localMode) {
            throw new IllegalStateException("团队服务器不提供样板数据，请录入真实收案与收费记录");
        }
        // 只在台账为空时灌入；从不删除已有数据。
        if (intakeRepository.count() > 0 || invoiceRepository.count() > 0 || collectionRepository.count() > 0) {
            return buildOverview(userId, null, Map.of("scope", "all"));
        }

        User partnerLin = ensureDemoUser("partner_lin", "林正源（高级合伙人）");
        User partnerSu = ensureDemoUser("partner_su", "苏婉清（合伙人）");
        User lawyerZhou = ensureDemoUser("lawyer_zhou", "周铭泽（主办律师）");
        User lawyerChen = ensureDemoUser("lawyer_chen", "陈思远（主办律师）");

        Instant now = Instant.now();

        // 案件 1：常年法律顾问（在办已立项，供 R2 红色常顾冲突检索对照）
        LawFirmMatterIntake case1 = saveOrUpdateDemoIntake(LawFirmMatterIntake.builder()
                .intakeNo("LF-2026-0001")
                .title("云杉数智2026年度常年法律顾问项目")
                .practiceArea("RETAINER")
                .applicantUserId(partnerLin.getId())
                .applicantName(partnerLin.getDisplayName())
                .leadLawyerUserId(partnerLin.getId())
                .leadLawyerName(partnerLin.getDisplayName())
                .departmentName("公司并购与投融资部")
                .teamMemberNames("林正源, 周铭泽, 林晓婷")
                .clientName("北京云杉数智科技有限公司（示例）")
                .clientCreditCode(null)
                .clientRole("常年法律顾问委托人")
                .counterpartyName("无（常年法律顾问）")
                .feeMode("RETAINER")
                .contractAmountCents(80_000_000L) // 80万元
                .conflictRiskLevel("GREEN")
                .conflictSummary("【G0_CLEAR】全国律协《律师执业行为规范》第五十条：经检索全所在办案件、常年法律顾问、历史客户及关联方库，未发现利益冲突。")
                .conflictHitsJson("[]")
                .status("APPROVED_FILED")
                .committeeReviewerId(partnerLin.getId())
                .committeeReviewerName(partnerLin.getDisplayName())
                .committeeComment("常年法律顾问续签项目，无利益冲突，准予立案。")
                .submittedAt(now.minus(45, ChronoUnit.DAYS))
                .clearedAt(now.minus(45, ChronoUnit.DAYS))
                .filedAt(now.minus(44, ChronoUnit.DAYS))
                .createdAt(now.minus(45, ChronoUnit.DAYS))
                .updatedAt(now.minus(44, ChronoUnit.DAYS))
                .build());

        // 案件 2：科创板 IPO 专项（绿色无冲突，已立案）
        LawFirmMatterIntake case2 = saveOrUpdateDemoIntake(LawFirmMatterIntake.builder()
                .intakeNo("LF-2026-0002")
                .title("华星半导体股份有限公司科创板首次公开发行股票并上市（IPO）专项")
                .practiceArea("IPO_CAPITAL")
                .applicantUserId(partnerSu.getId())
                .applicantName(partnerSu.getDisplayName())
                .leadLawyerUserId(partnerSu.getId())
                .leadLawyerName(partnerSu.getDisplayName())
                .departmentName("资本市场与证券部")
                .teamMemberNames("苏婉清, 陆景行, 许知夏")
                .clientName("华星半导体股份有限公司")
                .clientCreditCode(null)
                .clientRole("发行人/上市申请人")
                .counterpartyName("上海证券交易所科创板审核中心")
                .relatedPartiesJson("[{\"role\":\"AFFILIATE\",\"name\":\"华星微电子控股集团\",\"creditCode\":\"91310000MA1FL8HX00\"}]")
                .feeMode("FIXED")
                .contractAmountCents(380_000_000L) // 380万元
                .conflictRiskLevel("GREEN")
                .conflictSummary("【G0_CLEAR】全国律协《律师执业行为规范》第五十条：经检索全所在办案件、常年法律顾问、历史客户及关联方库，未发现利益冲突。")
                .conflictHitsJson("[]")
                .status("APPROVED_FILED")
                .committeeReviewerId(partnerLin.getId())
                .committeeReviewerName(partnerLin.getDisplayName())
                .committeeComment("发行人及关联方核查清晰，准予立项。")
                .submittedAt(now.minus(35, ChronoUnit.DAYS))
                .clearedAt(now.minus(35, ChronoUnit.DAYS))
                .filedAt(now.minus(34, ChronoUnit.DAYS))
                .createdAt(now.minus(35, ChronoUnit.DAYS))
                .updatedAt(now.minus(34, ChronoUnit.DAYS))
                .build());

        // 案件 3：黄色间接利冲（新案对方当事人「华星半导体（集团）有限公司」命中在办客户「华星半导体股份有限公司」商号词干，站内信放行中）
        LawFirmMatterIntake case3 = saveOrUpdateDemoIntake(LawFirmMatterIntake.builder()
                .intakeNo("LF-2026-0003")
                .title("东海精密装备诉华星半导体（集团）有限公司晶圆设备采购合同纠纷案")
                .practiceArea("LITIGATION")
                .applicantUserId(userId)
                .applicantName(userRepository.findById(userId).map(User::getDisplayName).orElse(lawyerZhou.getDisplayName()))
                .leadLawyerUserId(lawyerZhou.getId())
                .leadLawyerName(lawyerZhou.getDisplayName())
                .departmentName("民商事争议解决部")
                .teamMemberNames("周铭泽, 沈括")
                .clientName("苏州东海精密装备股份有限公司")
                .clientCreditCode(null)
                .clientRole("原告/申请人")
                .counterpartyName("华星半导体（集团）有限公司")
                .counterpartyCreditCode(null)
                .feeMode("PROPORTIONAL")
                .contractAmountCents(150_000_000L) // 150万元
                .disputeTargetCents(4500_000_000L) // 4500万元
                .conflictRiskLevel("YELLOW")
                .conflictSummary("【YELLOW · Y1_EXISTING_CLIENT_OTHER_MATTER】共命中 1 项利益冲突记录（首要规则：新案对方当事人系本所在办案件委托人（或集团关联主体）；涉及主体：华星半导体股份有限公司；关联主办：苏婉清（合伙人））。法规依据：全国律协《律师执业行为规范》第五十一条第（三）项、第五十二条第（一）项：需征询该客户承办律师放行、取得客户书面豁免并建立信息隔离墙")
                .conflictHitsJson("[{\"ruleCode\":\"Y1_EXISTING_CLIENT_OTHER_MATTER\",\"riskLevel\":\"YELLOW\",\"ruleTitle\":\"新案对方当事人系本所在办案件委托人（或集团关联主体）\",\"statutoryCitation\":\"全国律协《律师执业行为规范》第五十一条第（三）项、第五十二条第（一）项\",\"matchedIntakeNo\":\"LF-2026-0002\",\"matchedMatterTitle\":\"华星半导体股份有限公司科创板首次公开发行股票并上市（IPO）专项\",\"matchedPartyName\":\"华星半导体股份有限公司\",\"handlerUserId\":" + partnerSu.getId() + ",\"handlerUserName\":\"" + partnerSu.getDisplayName() + "\"}]")
                .status("PENDING_LAWYER_CLEARANCE")
                .submittedAt(now.minus(2, ChronoUnit.DAYS))
                .createdAt(now.minus(2, ChronoUnit.DAYS))
                .updatedAt(now.minus(1, ChronoUnit.DAYS))
                .build());

        if (clearanceRepository.findByIntakeIdOrderByIdAsc(case3.getId()).isEmpty()) {
            String convId = createDirectImConversation(
                    userId,
                    List.of(partnerSu.getId(), lawyerZhou.getId()),
                    "【利冲征询】" + case3.getIntakeNo() + " " + case3.getTitle(),
                    "【系统利冲预警通知】收案号 " + case3.getIntakeNo() + " 对方当事人「华星半导体（集团）有限公司」与本所在办项目「" + case2.getTitle() + "」委托人「华星半导体股份有限公司」构成集团商号关联冲突（Y1_EXISTING_CLIENT_OTHER_MATTER）。请主办合伙人 " + partnerSu.getDisplayName() + " 在个人中心或律所管理插件中确认是否同意放行并启用信息隔离墙。"
            );
            case3.setImConversationId(convId);
            intakeRepository.save(case3);

            clearanceRepository.save(LawFirmConflictClearance.builder()
                    .intakeId(case3.getId())
                    .intakeNo(case3.getIntakeNo())
                    .targetUserId(partnerSu.getId())
                    .targetUserName(partnerSu.getDisplayName())
                    .role("CONFLICT_LAWYER")
                    .matchedMatterTitle(case2.getTitle())
                    .matchedPartyName(case2.getClientName())
                    .conflictRuleCitation("Y1_EXISTING_CLIENT_OTHER_MATTER - 全国律协《律师执业行为规范》第五十一条第（三）项、第五十二条第（一）项")
                    .decision("PENDING")
                    .imConversationId(convId)
                    .notifiedAt(now.minus(2, ChronoUnit.DAYS))
                    .build());
        }

        // 案件 4：红色常年顾问对抗冲突（对方当事人为本所在期常年法律顾问客户「北京云杉数智科技有限公司（示例）」）
        saveOrUpdateDemoIntake(LawFirmMatterIntake.builder()
                .intakeNo("LF-2026-0004")
                .title("远洋云创软件诉北京云杉数智科技有限公司（示例）技术委托开发合同争议案")
                .practiceArea("LITIGATION")
                .applicantUserId(lawyerChen.getId())
                .applicantName(lawyerChen.getDisplayName())
                .leadLawyerUserId(lawyerChen.getId())
                .leadLawyerName(lawyerChen.getDisplayName())
                .departmentName("知识产权与合规部")
                .teamMemberNames("陈思远, 赵明")
                .clientName("深圳远洋云创软件有限公司")
                .clientCreditCode(null)
                .clientRole("原告")
                .counterpartyName("北京云杉数智科技有限公司（示例）")
                .counterpartyCreditCode(null)
                .feeMode("FIXED")
                .contractAmountCents(60_000_000L)
                .conflictRiskLevel("RED")
                .conflictSummary("【RED · R2_RETAINER_ADVERSARY】共命中 1 项利益冲突记录（首要规则：对抗本所在期常年法律顾问客户；涉及主体：北京云杉数智科技有限公司（示例）；关联主办：林正源（高级合伙人））。法规依据：全国律协《律师执业行为规范》第五十一条第（四）项：在委托人处于常年法律顾问关系期间，不得代理他人与该委托人之间的诉讼或仲裁")
                .conflictHitsJson("[{\"ruleCode\":\"R2_RETAINER_ADVERSARY\",\"riskLevel\":\"RED\",\"ruleTitle\":\"对抗本所在期常年法律顾问客户\",\"statutoryCitation\":\"全国律协《律师执业行为规范》第五十一条第（四）项\",\"matchedIntakeNo\":\"LF-2026-0001\",\"matchedMatterTitle\":\"云杉数智2026年度常年法律顾问项目\",\"matchedPartyName\":\"北京云杉数智科技有限公司（示例）\",\"handlerUserId\":" + partnerLin.getId() + ",\"handlerUserName\":\"" + partnerLin.getDisplayName() + "\"}]")
                .status("PENDING_COMMITTEE_REVIEW")
                .submittedAt(now.minus(1, ChronoUnit.DAYS))
                .createdAt(now.minus(1, ChronoUnit.DAYS))
                .updatedAt(now.minus(1, ChronoUnit.DAYS))
                .build());

        // 案件 5：跨境并购专项（绿色无冲突，已立案）
        LawFirmMatterIntake case5 = saveOrUpdateDemoIntake(LawFirmMatterIntake.builder()
                .intakeNo("LF-2026-0005")
                .title("中航新材收购德国莱茵精密复合材料股权跨境并购专项")
                .practiceArea("CORPORATE_MA")
                .applicantUserId(partnerLin.getId())
                .applicantName(partnerLin.getDisplayName())
                .leadLawyerUserId(partnerLin.getId())
                .leadLawyerName(partnerLin.getDisplayName())
                .departmentName("公司并购与投融资部")
                .teamMemberNames("林正源, 周铭泽")
                .clientName("中航先进新材料股份有限公司")
                .clientCreditCode(null)
                .clientRole("收购方")
                .counterpartyName("Rhein Composite GmbH")
                .feeMode("FIXED")
                .contractAmountCents(240_000_000L) // 240万元
                .conflictRiskLevel("GREEN")
                .conflictSummary("【G0_CLEAR】全国律协《律师执业行为规范》第五十条：经检索全所在办案件、常年法律顾问、历史客户及关联方库，未发现利益冲突。")
                .conflictHitsJson("[]")
                .status("APPROVED_FILED")
                .committeeReviewerId(partnerSu.getId())
                .committeeReviewerName(partnerSu.getDisplayName())
                .committeeComment("无利益冲突，准予立项。")
                .submittedAt(now.minus(60, ChronoUnit.DAYS))
                .clearedAt(now.minus(60, ChronoUnit.DAYS))
                .filedAt(now.minus(59, ChronoUnit.DAYS))
                .createdAt(now.minus(60, ChronoUnit.DAYS))
                .updatedAt(now.minus(59, ChronoUnit.DAYS))
                .build());

        // 案件 6：知识产权商业秘密诉讼（已立案，带合规风险代理）
        LawFirmMatterIntake case6 = saveOrUpdateDemoIntake(LawFirmMatterIntake.builder()
                .intakeNo("LF-2026-0006")
                .title("光启智算科技大模型训练算子商业秘密侵权及不正当竞争诉讼")
                .practiceArea("IP")
                .applicantUserId(lawyerChen.getId())
                .applicantName(lawyerChen.getDisplayName())
                .leadLawyerUserId(lawyerChen.getId())
                .leadLawyerName(lawyerChen.getDisplayName())
                .departmentName("知识产权与合规部")
                .teamMemberNames("陈思远, 许知夏")
                .clientName("北京光启智算科技有限公司")
                .clientCreditCode(null)
                .clientRole("原告")
                .counterpartyName("杭州星云矩阵科技有限公司")
                .feeMode("CONTINGENCY")
                .contractAmountCents(120_000_000L) // 120万元
                .disputeTargetCents(1000_000_000L)
                .contingencyRateBps(1200) // 12%
                .conflictRiskLevel("GREEN")
                .conflictSummary("【G0_CLEAR】全国律协《律师执业行为规范》第五十条：经检索全所在办案件、常年法律顾问、历史客户及关联方库，未发现利益冲突。")
                .conflictHitsJson("[]")
                .status("APPROVED_FILED")
                .committeeReviewerId(partnerLin.getId())
                .committeeReviewerName(partnerLin.getDisplayName())
                .committeeComment("商事知识产权维权案件，风险代理比例 12% 符合分段递减上限，准予立案。")
                .submittedAt(now.minus(100, ChronoUnit.DAYS))
                .clearedAt(now.minus(100, ChronoUnit.DAYS))
                .filedAt(now.minus(99, ChronoUnit.DAYS))
                .createdAt(now.minus(100, ChronoUnit.DAYS))
                .updatedAt(now.minus(99, ChronoUnit.DAYS))
                .build());

        // 演示发票与回款台账
        LawFirmInvoice inv1 = saveOrUpdateDemoInvoice(LawFirmInvoice.builder()
                .invoiceAppNo("INV-2026-0001")
                .intakeId(case1.getId())
                .intakeNo(case1.getIntakeNo())
                .matterTitle(case1.getTitle())
                .applicantUserId(partnerLin.getId())
                .applicantName(partnerLin.getDisplayName())
                .leadLawyerUserId(partnerLin.getId())
                .leadLawyerName(partnerLin.getDisplayName())
                .departmentName("公司并购与投融资部")
                .invoiceType("DIGITAL_SPECIAL")
                .taxItemName("*鉴证咨询服务*常年法律顾问费")
                .amountCents(80_000_000L)
                .taxRateBps(600)
                .netAmountCents(75_471_698L)
                .taxAmountCents(4_528_302L)
                .buyerName(case1.getClientName())
                .buyerTaxId(case1.getClientCreditCode())
                .status("PAID")
                .invoiceCode("011002600111")
                .invoiceNumber("2611200001")
                .issuedAt(now.minus(40, ChronoUnit.DAYS))
                .collectedAmountCents(80_000_000L)
                .externalSyncStatus("SYNCED")
                .externalErpRef("ERP-KD-20260001")
                .createdAt(now.minus(41, ChronoUnit.DAYS))
                .updatedAt(now.minus(35, ChronoUnit.DAYS))
                .build());

        LawFirmInvoice inv2 = saveOrUpdateDemoInvoice(LawFirmInvoice.builder()
                .invoiceAppNo("INV-2026-0002")
                .intakeId(case2.getId())
                .intakeNo(case2.getIntakeNo())
                .matterTitle(case2.getTitle())
                .applicantUserId(partnerSu.getId())
                .applicantName(partnerSu.getDisplayName())
                .leadLawyerUserId(partnerSu.getId())
                .leadLawyerName(partnerSu.getDisplayName())
                .departmentName("资本市场与证券部")
                .invoiceType("DIGITAL_SPECIAL")
                .taxItemName("*鉴证咨询服务*IPO专项法律服务费（首期及申报期）")
                .amountCents(280_000_000L)
                .taxRateBps(600)
                .netAmountCents(264_150_943L)
                .taxAmountCents(15_849_057L)
                .buyerName(case2.getClientName())
                .buyerTaxId(case2.getClientCreditCode())
                .status("PARTIALLY_PAID")
                .invoiceCode("011002600111")
                .invoiceNumber("2611200002")
                .issuedAt(now.minus(20, ChronoUnit.DAYS))
                .collectedAmountCents(200_000_000L)
                .externalSyncStatus("SYNCED")
                .externalErpRef("ERP-KD-20260002")
                .createdAt(now.minus(22, ChronoUnit.DAYS))
                .updatedAt(now.minus(10, ChronoUnit.DAYS))
                .build());

        LawFirmInvoice inv3 = saveOrUpdateDemoInvoice(LawFirmInvoice.builder()
                .invoiceAppNo("INV-2026-0003")
                .intakeId(case5.getId())
                .intakeNo(case5.getIntakeNo())
                .matterTitle(case5.getTitle())
                .applicantUserId(partnerLin.getId())
                .applicantName(partnerLin.getDisplayName())
                .leadLawyerUserId(partnerLin.getId())
                .leadLawyerName(partnerLin.getDisplayName())
                .departmentName("公司并购与投融资部")
                .invoiceType("DIGITAL_SPECIAL")
                .taxItemName("*鉴证咨询服务*跨境并购法律尽调与交割服务费")
                .amountCents(200_000_000L)
                .taxRateBps(600)
                .netAmountCents(188_679_245L)
                .taxAmountCents(11_320_755L)
                .buyerName(case5.getClientName())
                .buyerTaxId(case5.getClientCreditCode())
                .status("PARTIALLY_PAID")
                .invoiceCode("011002600111")
                .invoiceNumber("2611200003")
                .issuedAt(now.minus(55, ChronoUnit.DAYS))
                .collectedAmountCents(140_000_000L)
                .externalSyncStatus("MANUAL")
                .createdAt(now.minus(56, ChronoUnit.DAYS))
                .updatedAt(now.minus(30, ChronoUnit.DAYS))
                .build());

        LawFirmInvoice inv4 = saveOrUpdateDemoInvoice(LawFirmInvoice.builder()
                .invoiceAppNo("INV-2026-0004")
                .intakeId(case6.getId())
                .intakeNo(case6.getIntakeNo())
                .matterTitle(case6.getTitle())
                .applicantUserId(lawyerChen.getId())
                .applicantName(lawyerChen.getDisplayName())
                .leadLawyerUserId(lawyerChen.getId())
                .leadLawyerName(lawyerChen.getDisplayName())
                .departmentName("知识产权与合规部")
                .invoiceType("DIGITAL_NORMAL")
                .taxItemName("*法律鉴证*知识产权诉讼代理费")
                .amountCents(120_000_000L)
                .taxRateBps(600)
                .netAmountCents(113_207_547L)
                .taxAmountCents(6_792_453L)
                .buyerName(case6.getClientName())
                .buyerTaxId(case6.getClientCreditCode())
                .status("PARTIALLY_PAID")
                .invoiceCode("011002600111")
                .invoiceNumber("2611200004")
                .issuedAt(now.minus(96, ChronoUnit.DAYS))
                .collectedAmountCents(70_000_000L)
                .externalSyncStatus("MANUAL")
                .createdAt(now.minus(96, ChronoUnit.DAYS))
                .updatedAt(now.minus(40, ChronoUnit.DAYS))
                .build());

        saveOrUpdateDemoInvoice(LawFirmInvoice.builder()
                .invoiceAppNo("INV-2026-0005")
                .intakeId(case3.getId())
                .intakeNo(case3.getIntakeNo())
                .matterTitle(case3.getTitle())
                .applicantUserId(lawyerZhou.getId())
                .applicantName(lawyerZhou.getDisplayName())
                .leadLawyerUserId(lawyerZhou.getId())
                .leadLawyerName(lawyerZhou.getDisplayName())
                .departmentName("民商事争议解决部")
                .invoiceType("DIGITAL_SPECIAL")
                .taxItemName("*鉴证咨询服务*诉讼代理首期基础律师费")
                .amountCents(60_000_000L)
                .taxRateBps(600)
                .netAmountCents(56_603_774L)
                .taxAmountCents(3_396_226L)
                .buyerName(case3.getClientName())
                .buyerTaxId(case3.getClientCreditCode())
                .status("PENDING_APPROVAL")
                .collectedAmountCents(0L)
                .externalSyncStatus("MANUAL")
                .createdAt(now.minus(1, ChronoUnit.DAYS))
                .updatedAt(now.minus(1, ChronoUnit.DAYS))
                .build());

        saveOrUpdateDemoCollection(LawFirmCollection.builder()
                .collectionNo("PAY-2026-0001")
                .intakeId(case1.getId())
                .intakeNo(case1.getIntakeNo())
                .matterTitle(case1.getTitle())
                .invoiceId(inv1.getId())
                .invoiceAppNo(inv1.getInvoiceAppNo())
                .recordedByUserId(partnerLin.getId())
                .recordedByName(partnerLin.getDisplayName())
                .leadLawyerUserId(partnerLin.getId())
                .departmentName("公司并购与投融资部")
                .payerName(case1.getClientName())
                .amountCents(80_000_000L)
                .paymentMethod("BANK_TRANSFER")
                .bankVoucherNo("CMB-20260902-8812")
                .receivedDate(LocalDate.now().minusDays(35).toString())
                .reconciliationStatus("EXTERNAL_SYNCED")
                .externalErpId("ERP-RCV-20260001")
                .note("常年法律顾问年度费用全额到账")
                .createdAt(now.minus(35, ChronoUnit.DAYS))
                .build());

        saveOrUpdateDemoCollection(LawFirmCollection.builder()
                .collectionNo("PAY-2026-0002")
                .intakeId(case2.getId())
                .intakeNo(case2.getIntakeNo())
                .matterTitle(case2.getTitle())
                .invoiceId(inv2.getId())
                .invoiceAppNo(inv2.getInvoiceAppNo())
                .recordedByUserId(partnerSu.getId())
                .recordedByName(partnerSu.getDisplayName())
                .leadLawyerUserId(partnerSu.getId())
                .departmentName("资本市场与证券部")
                .payerName(case2.getClientName())
                .amountCents(200_000_000L)
                .paymentMethod("BANK_TRANSFER")
                .bankVoucherNo("ICBC-20260928-3319")
                .receivedDate(LocalDate.now().minusDays(12).toString())
                .reconciliationStatus("EXTERNAL_SYNCED")
                .externalErpId("ERP-RCV-20260002")
                .note("科创板IPO辅导及申报阶段首期款")
                .createdAt(now.minus(12, ChronoUnit.DAYS))
                .build());

        saveOrUpdateDemoCollection(LawFirmCollection.builder()
                .collectionNo("PAY-2026-0003")
                .intakeId(case5.getId())
                .intakeNo(case5.getIntakeNo())
                .matterTitle(case5.getTitle())
                .invoiceId(inv3.getId())
                .invoiceAppNo(inv3.getInvoiceAppNo())
                .recordedByUserId(partnerLin.getId())
                .recordedByName(partnerLin.getDisplayName())
                .leadLawyerUserId(partnerLin.getId())
                .departmentName("公司并购与投融资部")
                .payerName(case5.getClientName())
                .amountCents(140_000_000L)
                .paymentMethod("BANK_TRANSFER")
                .bankVoucherNo("BOC-20260915-7741")
                .receivedDate(LocalDate.now().minusDays(25).toString())
                .reconciliationStatus("RECONCILED")
                .note("跨境并购尽调阶段进度款")
                .createdAt(now.minus(25, ChronoUnit.DAYS))
                .build());

        saveOrUpdateDemoCollection(LawFirmCollection.builder()
                .collectionNo("PAY-2026-0004")
                .intakeId(case6.getId())
                .intakeNo(case6.getIntakeNo())
                .matterTitle(case6.getTitle())
                .invoiceId(inv4.getId())
                .invoiceAppNo(inv4.getInvoiceAppNo())
                .recordedByUserId(lawyerChen.getId())
                .recordedByName(lawyerChen.getDisplayName())
                .leadLawyerUserId(lawyerChen.getId())
                .departmentName("知识产权与合规部")
                .payerName(case6.getClientName())
                .amountCents(70_000_000L)
                .paymentMethod("BANK_TRANSFER")
                .bankVoucherNo("CCB-20260820-5590")
                .receivedDate(LocalDate.now().minusDays(40).toString())
                .reconciliationStatus("RECONCILED")
                .note("商业秘密维权前期固定基础费")
                .createdAt(now.minus(40, ChronoUnit.DAYS))
                .build());

        return buildOverview(userId, null, Map.of("scope", "all"));
    }

    // ==== Internal Helpers ====

    private LawFirmMatterIntake buildDraftIntakeFromParams(
            Long userId, Long projectId, Map<String, Object> params, Map<Long, String> userNames) {

        String applicantName = firstNonBlank(
                string(params, "applicantName", null),
                userNames.get(userId),
                "申请律师");

        Long leadUserId = longVal(params.get("leadLawyerUserId"));
        if (leadUserId == null) {
            leadUserId = userId;
        }
        String leadName = firstNonBlank(
                string(params, "leadLawyerName", null),
                userNames.get(leadUserId),
                applicantName);

        String relatedJson;
        Object rawRelated = params.get("relatedParties");
        if (rawRelated == null) {
            rawRelated = params.get("relatedPartiesJson");
        }
        if (rawRelated instanceof String s) {
            relatedJson = s;
        } else if (rawRelated != null) {
            relatedJson = toJson(rawRelated);
        } else {
            String singleRelName = string(params, "relatedPartyName", "");
            if (!singleRelName.isBlank()) {
                String singleRelRole = string(params, "relatedPartyRole", "AFFILIATE");
                relatedJson = toJson(List.of(Map.of("role", singleRelRole, "name", singleRelName, "creditCode", "")));
            } else {
                relatedJson = "[]";
            }
        }

        String teamMembers;
        Object rawTeam = params.get("teamMemberNames");
        if (rawTeam instanceof List<?> list) {
            teamMembers = list.stream().map(String::valueOf).collect(Collectors.joining(", "));
        } else {
            teamMembers = string(params, "teamMemberNames", leadName);
        }

        Long contractCents = centsFromParams(params, "contractAmountCents", "contractAmountYuan");
        Long disputeCents = centsFromParams(params, "disputeTargetCents", "disputeTargetYuan");
        Integer contingencyBps = intVal(params.get("contingencyRateBps"), null);
        if (contingencyBps == null && params.get("contingencyRatePercent") != null) {
            Double pct = doubleVal(params.get("contingencyRatePercent"));
            if (pct != null) {
                contingencyBps = (int) Math.round(pct * 100.0);
            }
        }

        Long resolvedProjectId = projectId != null ? projectId : longVal(params.get("projectId"));

        return LawFirmMatterIntake.builder()
                .projectId(resolvedProjectId)
                .title(string(params, "title", ""))
                .practiceArea(string(params, "practiceArea", "CORPORATE_MA"))
                .applicantUserId(userId)
                .applicantName(applicantName)
                .leadLawyerUserId(leadUserId)
                .leadLawyerName(leadName)
                .departmentName(string(params, "departmentName", "公司并购与投融资部"))
                .teamMemberNames(teamMembers)
                .clientName(string(params, "clientName", ""))
                .clientCreditCode(string(params, "clientCreditCode", ""))
                .clientRole(string(params, "clientRole", "委托人"))
                .counterpartyName(string(params, "counterpartyName", ""))
                .counterpartyCreditCode(string(params, "counterpartyCreditCode", ""))
                .relatedPartiesJson(relatedJson)
                .feeMode(string(params, "feeMode", "FIXED"))
                .contractAmountCents(contractCents != null ? contractCents : 0L)
                .disputeTargetCents(disputeCents != null ? disputeCents : 0L)
                .contingencyRateBps(contingencyBps != null ? contingencyBps : 0)
                .ethicalWallApplied(Boolean.TRUE.equals(boolVal(params.get("ethicalWallApplied"))))
                .clientWaiverUploaded(Boolean.TRUE.equals(boolVal(params.get("clientWaiverUploaded"))))
                .build();
    }

    private String createConflictImConversationAndNotify(
            LawFirmMatterIntake intake,
            LawFirmConflictEngine.ConflictCheckResult conflictResult,
            Long applicantUserId,
            Map<Long, String> userNames) {

        String rawTitle = "【利冲征询】" + intake.getIntakeNo() + " " + intake.getTitle();
        String title = rawTitle.length() > 120 ? rawTitle.substring(0, 120) : rawTitle;

        Set<Long> participantIds = new LinkedHashSet<>();
        if (applicantUserId != null) {
            participantIds.add(applicantUserId);
        }
        if (intake.getLeadLawyerUserId() != null) {
            participantIds.add(intake.getLeadLawyerUserId());
        }
        for (LawFirmConflictEngine.ConflictHit hit : conflictResult.getHits()) {
            if (hit.getHandlerUserId() != null) {
                participantIds.add(hit.getHandlerUserId());
            }
        }

        StringBuilder msg = new StringBuilder();
        msg.append("【系统利益冲突核查与放行征询】\n")
                .append("收案编号：").append(intake.getIntakeNo()).append("\n")
                .append("案件名称：").append(intake.getTitle()).append("\n")
                .append("申请/主办律师：").append(firstNonBlank(intake.getLeadLawyerName(), intake.getApplicantName())).append("（").append(firstNonBlank(intake.getDepartmentName(), "本所")).append("）\n")
                .append("新案委托人：").append(intake.getClientName()).append("\n")
                .append("新案对方当事人：").append(intake.getCounterpartyName()).append("\n")
                .append("冲突等级：").append(conflictResult.getRiskLevel()).append("（").append(conflictResult.getPrimaryRuleCode()).append("）\n");
        for (LawFirmConflictEngine.ConflictHit hit : conflictResult.getHits()) {
            msg.append("- 命中案件：").append(firstNonBlank(hit.getMatchedMatterTitle(), "在办案件"))
                    .append(" | 命中主体：").append(hit.getMatchedPartyName())
                    .append(" | 关联主办：").append(hit.getHandlerUserName())
                    .append(" | 法规依据：").append(hit.getStatutoryCitation()).append("\n");
        }
        msg.append("请关联案件承办律师核实是否存在实质保密信息冲突或需启用信息隔离墙，并在个人中心或律所管理插件中点击「同意放行 / 附条件放行」。");

        return createDirectImConversation(applicantUserId, new ArrayList<>(participantIds), title, msg.toString());
    }

    private String createDirectImConversation(
            Long ownerUserId,
            List<Long> memberUserIds,
            String title,
            String initialMessage) {

        Long effectiveOwner = ownerUserId != null ? ownerUserId : 1L;
        String safeTitle = title != null && title.length() > 120 ? title.substring(0, 120) : firstNonBlank(title, "【利冲征询】案件协同");
        String convId;

        if (userRepository.existsById(effectiveOwner)) {
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> created = (Map<String, Object>) imService.execute(
                        effectiveOwner,
                        "create",
                        Map.of("type", "GROUP", "title", safeTitle)
                );
                convId = String.valueOf(created.get("id"));
            } catch (Exception e) {
                convId = createConversationDirectly(effectiveOwner, safeTitle);
            }
        } else {
            convId = createConversationDirectly(effectiveOwner, safeTitle);
        }

        if (memberUserIds != null) {
            for (Long memberId : memberUserIds) {
                if (memberId == null) continue;
                if (imMemberRepository.findByConversationIdAndUserId(convId, memberId).isEmpty()) {
                    ImMember m = new ImMember();
                    m.setConversationId(convId);
                    m.setUserId(memberId);
                    m.setRole(Objects.equals(memberId, effectiveOwner) ? "OWNER" : "MEMBER");
                    m.setLastReadId(0L);
                    m.setJoinedAt(Instant.now());
                    imMemberRepository.save(m);
                }
            }
        }

        if (initialMessage != null && !initialMessage.isBlank()) {
            postMessageToConversation(convId, effectiveOwner, initialMessage);
        }
        return convId;
    }

    private String createConversationDirectly(Long ownerUserId, String title) {
        Instant now = Instant.now();
        ImConversation conv = new ImConversation();
        conv.setId(UUID.randomUUID().toString());
        conv.setTitle(title);
        conv.setType("GROUP");
        conv.setOwnerId(ownerUserId);
        conv.setCreatedAt(now);
        conv.setLastMessageAt(now);
        imConversationRepository.save(conv);

        ImMember ownerMember = new ImMember();
        ownerMember.setConversationId(conv.getId());
        ownerMember.setUserId(ownerUserId);
        ownerMember.setRole("OWNER");
        ownerMember.setLastReadId(0L);
        ownerMember.setJoinedAt(now);
        imMemberRepository.save(ownerMember);
        return conv.getId();
    }

    private void postMessageToConversation(String conversationId, Long senderUserId, String text) {
        if (conversationId == null || conversationId.isBlank() || text == null || text.isBlank()) {
            return;
        }
        Long effectiveSender = senderUserId != null ? senderUserId : 1L;
        if (imMemberRepository.findByConversationIdAndUserId(conversationId, effectiveSender).isEmpty()) {
            ImMember m = new ImMember();
            m.setConversationId(conversationId);
            m.setUserId(effectiveSender);
            m.setRole("MEMBER");
            m.setLastReadId(0L);
            m.setJoinedAt(Instant.now());
            imMemberRepository.save(m);
        }

        String safeText = text.length() > 7800 ? text.substring(0, 7800) : text;
        String clientMsgId = "lawfirm-" + UUID.randomUUID();
        if (userRepository.existsById(effectiveSender)) {
            try {
                imService.execute(effectiveSender, "send", Map.of(
                        "conversationId", conversationId,
                        "clientMessageId", clientMsgId,
                        "text", safeText
                ));
                return;
            } catch (Exception ignored) {
                // Fallback to direct repository save below
            }
        }

        Instant now = Instant.now();
        ImMessage message = new ImMessage();
        message.setUid(UUID.randomUUID().toString());
        message.setConversationId(conversationId);
        message.setSenderId(effectiveSender);
        message.setClientMessageId(clientMsgId);
        message.setText(safeText);
        message.setCreatedAt(now);
        imMessageRepository.save(message);

        imConversationRepository.findById(conversationId).ifPresent(c -> {
            c.setLastMessageAt(now);
            imConversationRepository.save(c);
        });
    }

    private Map<String, Object> toIntakeView(LawFirmMatterIntake i, List<LawFirmConflictClearance> clearances) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", i.getId());
        map.put("intakeNo", i.getIntakeNo());
        map.put("projectId", i.getProjectId());
        map.put("projectUid", i.getProjectUid());
        map.put("title", i.getTitle());
        map.put("practiceArea", i.getPracticeArea());
        map.put("practiceAreaLabel", practiceAreaLabel(i.getPracticeArea()));
        map.put("applicantUserId", i.getApplicantUserId());
        map.put("applicantName", i.getApplicantName());
        map.put("leadLawyerUserId", i.getLeadLawyerUserId());
        map.put("leadLawyerName", i.getLeadLawyerName());
        map.put("departmentName", i.getDepartmentName());
        map.put("teamMemberNames", i.getTeamMemberNames());
        map.put("clientName", i.getClientName());
        map.put("clientCreditCode", i.getClientCreditCode());
        map.put("clientRole", i.getClientRole());
        map.put("counterpartyName", i.getCounterpartyName());
        map.put("counterpartyCreditCode", i.getCounterpartyCreditCode());
        map.put("relatedPartiesJson", i.getRelatedPartiesJson());
        map.put("relatedParties", conflictEngine.parseRelatedParties(i.getRelatedPartiesJson()));
        map.put("feeMode", i.getFeeMode());
        map.put("feeModeLabel", feeModeLabel(i.getFeeMode()));
        map.put("contractAmountCents", i.getContractAmountCents() != null ? i.getContractAmountCents() : 0L);
        map.put("disputeTargetCents", i.getDisputeTargetCents() != null ? i.getDisputeTargetCents() : 0L);
        map.put("contingencyRateBps", i.getContingencyRateBps() != null ? i.getContingencyRateBps() : 0);
        map.put("feeComplianceWarning", i.getFeeComplianceWarning());
        long clearedCount = clearances == null ? 0L : clearances.stream()
                .filter(c -> "APPROVED".equalsIgnoreCase(c.getDecision()) || "APPROVED_WITH_WALL".equalsIgnoreCase(c.getDecision()))
                .count();
        long requiredCount = clearances == null ? 0L : clearances.size();
        map.put("conflictRiskLevel", i.getConflictRiskLevel());
        map.put("conflictLevel", i.getConflictRiskLevel());
        map.put("conflictSummary", i.getConflictSummary());
        map.put("conflictHitsJson", i.getConflictHitsJson());
        map.put("conflictHits", parseJsonList(i.getConflictHitsJson()));
        map.put("status", i.getStatus());
        map.put("statusLabel", intakeStatusLabel(i.getStatus()));
        map.put("clearedCount", clearedCount);
        map.put("requiredClearanceCount", requiredCount);
        map.put("committeeReviewerId", i.getCommitteeReviewerId());
        map.put("committeeReviewerName", i.getCommitteeReviewerName());
        map.put("committeeComment", i.getCommitteeComment());
        map.put("ethicalWallApplied", Boolean.TRUE.equals(i.getEthicalWallApplied()));
        map.put("clientWaiverUploaded", Boolean.TRUE.equals(i.getClientWaiverUploaded()));
        map.put("imConversationId", i.getImConversationId());
        map.put("submittedAt", i.getSubmittedAt());
        map.put("clearedAt", i.getClearedAt());
        map.put("filedAt", i.getFiledAt());
        map.put("createdAt", i.getCreatedAt());
        map.put("updatedAt", i.getUpdatedAt());
        map.put("clearances", clearances == null ? List.of() : clearances.stream().map(c -> toClearanceView(c, i)).toList());
        map.put("progressSteps", buildProgressSteps(i, clearances));
        return map;
    }

    private Map<String, Object> toClearanceView(LawFirmConflictClearance c, LawFirmMatterIntake intake) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", c.getId());
        map.put("intakeId", c.getIntakeId());
        map.put("intakeNo", c.getIntakeNo() != null ? c.getIntakeNo() : (intake != null ? intake.getIntakeNo() : null));
        map.put("intakeTitle", intake != null ? intake.getTitle() : c.getMatchedMatterTitle());
        map.put("clientName", intake != null ? intake.getClientName() : null);
        map.put("counterpartyName", intake != null ? intake.getCounterpartyName() : null);
        map.put("applicantName", intake != null ? intake.getApplicantName() : null);
        map.put("leadLawyerName", intake != null ? intake.getLeadLawyerName() : null);
        map.put("departmentName", intake != null ? intake.getDepartmentName() : null);
        map.put("conflictRiskLevel", intake != null ? intake.getConflictRiskLevel() : "YELLOW");
        map.put("targetUserId", c.getTargetUserId());
        map.put("targetUserName", c.getTargetUserName());
        map.put("role", c.getRole());
        map.put("matchedProjectId", c.getMatchedProjectId());
        map.put("matchedMatterTitle", c.getMatchedMatterTitle());
        map.put("matchedPartyName", c.getMatchedPartyName());
        map.put("conflictRuleCitation", c.getConflictRuleCitation());
        map.put("ruleCitation", c.getConflictRuleCitation());
        map.put("conflictDescription", firstNonBlank(c.getMatchedMatterTitle(), c.getMatchedPartyName()));
        map.put("decision", c.getDecision());
        map.put("status", c.getDecision());
        map.put("comment", c.getComment());
        map.put("imConversationId", c.getImConversationId());
        map.put("notifiedAt", c.getNotifiedAt());
        map.put("decidedAt", c.getDecidedAt());
        return map;
    }

    private Map<String, Object> toInvoiceView(LawFirmInvoice inv) {
        long amount = inv.getAmountCents() != null ? inv.getAmountCents() : 0L;
        long collected = inv.getCollectedAmountCents() != null ? inv.getCollectedAmountCents() : 0L;
        long uncollected = Math.max(0L, amount - collected);
        long agingDays = 0L;
        if (inv.getIssuedAt() != null && uncollected > 0) {
            agingDays = Math.max(0L, Duration.between(inv.getIssuedAt(), Instant.now()).toDays());
        }
        String agingBucket = agingDays < 30 ? "UNDER_30" : (agingDays <= 90 ? "DAYS_30_TO_90" : "OVER_90");

        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", inv.getId());
        map.put("invoiceAppNo", inv.getInvoiceAppNo());
        map.put("invoiceNo", firstNonBlank(inv.getInvoiceNumber(), inv.getInvoiceAppNo()));
        map.put("intakeId", inv.getIntakeId());
        map.put("intakeNo", inv.getIntakeNo());
        map.put("matterTitle", inv.getMatterTitle());
        map.put("projectId", inv.getProjectId());
        map.put("applicantUserId", inv.getApplicantUserId());
        map.put("applicantName", inv.getApplicantName());
        map.put("leadLawyerUserId", inv.getLeadLawyerUserId());
        map.put("leadLawyerName", inv.getLeadLawyerName());
        map.put("departmentName", inv.getDepartmentName());
        map.put("invoiceType", inv.getInvoiceType());
        map.put("taxItemName", inv.getTaxItemName());
        map.put("amountCents", amount);
        map.put("taxRateBps", inv.getTaxRateBps() != null ? inv.getTaxRateBps() : 600);
        map.put("taxAmountCents", inv.getTaxAmountCents() != null ? inv.getTaxAmountCents() : 0L);
        map.put("netAmountCents", inv.getNetAmountCents() != null ? inv.getNetAmountCents() : 0L);
        map.put("buyerName", inv.getBuyerName());
        map.put("payerTitle", inv.getBuyerName());
        map.put("buyerTaxId", inv.getBuyerTaxId());
        map.put("buyerAddressPhone", inv.getBuyerAddressPhone());
        map.put("buyerBankAccount", inv.getBuyerBankAccount());
        map.put("recipientEmail", inv.getRecipientEmail());
        map.put("status", inv.getStatus());
        map.put("invoiceCode", inv.getInvoiceCode());
        map.put("invoiceNumber", inv.getInvoiceNumber());
        map.put("issuedAt", inv.getIssuedAt());
        map.put("collectedAmountCents", collected);
        map.put("uncollectedAmountCents", uncollected);
        map.put("agingDays", agingDays);
        map.put("agingBucket", agingBucket);
        map.put("externalSyncStatus", inv.getExternalSyncStatus());
        map.put("externalErpRef", inv.getExternalErpRef());
        map.put("remark", inv.getRemark());
        map.put("createdAt", inv.getCreatedAt());
        map.put("updatedAt", inv.getUpdatedAt());
        return map;
    }

    private Map<String, Object> toCollectionView(LawFirmCollection col) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", col.getId());
        map.put("collectionNo", col.getCollectionNo());
        map.put("intakeId", col.getIntakeId());
        map.put("intakeNo", col.getIntakeNo());
        map.put("matterTitle", col.getMatterTitle());
        map.put("invoiceId", col.getInvoiceId());
        map.put("invoiceAppNo", col.getInvoiceAppNo());
        map.put("recordedByUserId", col.getRecordedByUserId());
        map.put("recordedByName", col.getRecordedByName());
        map.put("leadLawyerUserId", col.getLeadLawyerUserId());
        map.put("departmentName", col.getDepartmentName());
        map.put("payerName", col.getPayerName());
        map.put("amountCents", col.getAmountCents() != null ? col.getAmountCents() : 0L);
        map.put("paymentMethod", col.getPaymentMethod());
        map.put("bankVoucherNo", col.getBankVoucherNo());
        map.put("referenceNo", col.getBankVoucherNo());
        map.put("receivedDate", col.getReceivedDate());
        map.put("reconciliationStatus", col.getReconciliationStatus());
        map.put("erpSyncStatus", col.getReconciliationStatus());
        map.put("externalErpId", col.getExternalErpId());
        map.put("note", col.getNote());
        map.put("createdAt", col.getCreatedAt());
        return map;
    }

    private Map<Long, String> loadUserDisplayNames() {
        Map<Long, String> out = new LinkedHashMap<>();
        for (User u : userRepository.findAll()) {
            if (u.getId() != null) {
                out.put(u.getId(), firstNonBlank(u.getDisplayName(), u.getUsername(), "律师#" + u.getId()));
            }
        }
        return out;
    }

    private User ensureDemoUser(String username, String displayName) {
        Optional<User> existing = userRepository.findByUsername(username);
        if (existing.isPresent()) {
            return existing.get();
        }
        User u = new User();
        u.setUsername(username);
        u.setDisplayName(displayName);
        u.setPassword("{noop}" + UUID.randomUUID() + UUID.randomUUID());
        u.setRole("USER");
        u.setSubscriptionType("PAID");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        return userRepository.save(u);
    }

    private LawFirmMatterIntake saveOrUpdateDemoIntake(LawFirmMatterIntake draft) {
        return intakeRepository.findByIntakeNo(draft.getIntakeNo())
                .map(existing -> {
                    draft.setId(existing.getId());
                    draft.setImConversationId(existing.getImConversationId());
                    draft.setProjectId(existing.getProjectId());
                    draft.setProjectUid(existing.getProjectUid());
                    return intakeRepository.save(draft);
                })
                .orElseGet(() -> intakeRepository.save(draft));
    }

    private LawFirmInvoice saveOrUpdateDemoInvoice(LawFirmInvoice draft) {
        return invoiceRepository.findByInvoiceAppNo(draft.getInvoiceAppNo())
                .map(existing -> {
                    draft.setId(existing.getId());
                    return invoiceRepository.save(draft);
                })
                .orElseGet(() -> invoiceRepository.save(draft));
    }

    private LawFirmCollection saveOrUpdateDemoCollection(LawFirmCollection draft) {
        return collectionRepository.findByCollectionNo(draft.getCollectionNo())
                .map(existing -> {
                    draft.setId(existing.getId());
                    return collectionRepository.save(draft);
                })
                .orElseGet(() -> collectionRepository.save(draft));
    }

    private String generateIntakeNo() {
        int year = LocalDate.now().getYear();
        long seq = intakeRepository.count() + 1;
        String candidate = String.format("LF-%d-%04d", year, seq);
        while (intakeRepository.findByIntakeNo(candidate).isPresent()) {
            seq++;
            candidate = String.format("LF-%d-%04d", year, seq);
        }
        return candidate;
    }

    private String generateInvoiceNo() {
        int year = LocalDate.now().getYear();
        long seq = invoiceRepository.count() + 1;
        String candidate = String.format("INV-%d-%04d", year, seq);
        while (invoiceRepository.findByInvoiceAppNo(candidate).isPresent()) {
            seq++;
            candidate = String.format("INV-%d-%04d", year, seq);
        }
        return candidate;
    }

    private String generateCollectionNo() {
        int year = LocalDate.now().getYear();
        long seq = collectionRepository.count() + 1;
        String candidate = String.format("PAY-%d-%04d", year, seq);
        while (collectionRepository.findByCollectionNo(candidate).isPresent()) {
            seq++;
            candidate = String.format("PAY-%d-%04d", year, seq);
        }
        return candidate;
    }

    private static Map<String, Object> step(int index, String key, String label, String status, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("step", index);
        m.put("key", key);
        m.put("code", key);
        m.put("label", label);
        m.put("title", label);
        m.put("status", status);
        m.put("state", "error".equals(status) ? "rejected" : status);
        m.put("detail", detail);
        return m;
    }

    private static LawFirmMatterIntake intakeRef(LawFirmMatterIntake intake) {
        return intake;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return "[]";
        }
    }

    private List<Map<String, Object>> parseJsonList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            List<Map<String, Object>> list = objectMapper.readValue(
                    json, new TypeReference<List<Map<String, Object>>>() {});
            return list != null ? list : List.of();
        } catch (Exception e) {
            return List.of();
        }
    }

    private static String workloadBandForIndex(int index) {
        if (index < 40) return "IDLE";
        if (index <= 75) return "OPTIMAL";
        if (index <= 95) return "SATURATED";
        return "OVERLOADED";
    }

    private static String workloadBandLabel(String band) {
        return switch (band == null ? "" : band) {
            case "IDLE" -> "空闲";
            case "OPTIMAL" -> "适中";
            case "SATURATED" -> "饱和";
            case "OVERLOADED" -> "超负荷";
            default -> "适中";
        };
    }

    private static String defaultDeptForUser(Long userId) {
        if (userId == null) return "公司并购与投融资部";
        String[] depts = {
                "资本市场与证券部",
                "公司并购与投融资部",
                "民商事争议解决部",
                "知识产权与合规部"
        };
        return depts[(int) (Math.abs(userId) % depts.length)];
    }

    private static String practiceAreaLabel(String area) {
        if (area == null) return "公司并购";
        return switch (area.toUpperCase(Locale.ROOT)) {
            case "IPO_CAPITAL", "CAPITAL_MARKET" -> "资本市场/IPO";
            case "CORPORATE_MA" -> "公司并购与投融资";
            case "LITIGATION", "COMMERCIAL_LITIGATION" -> "民商事诉讼与仲裁";
            case "RETAINER" -> "常年法律顾问";
            case "IP", "IP_TECH" -> "知识产权与数据合规";
            case "CRIMINAL" -> "刑事辩护与代理";
            case "ADMINISTRATIVE" -> "行政复议与诉讼";
            case "LABOR" -> "劳动人事合规";
            case "MARRIAGE_FAMILY" -> "婚姻家事与财富传承";
            default -> area;
        };
    }

    private static String feeModeLabel(String mode) {
        if (mode == null) return "固定收费";
        return switch (mode.toUpperCase(Locale.ROOT)) {
            case "FIXED" -> "固定金额收费";
            case "PROPORTIONAL" -> "按标的额比例收费";
            case "CONTINGENCY" -> "风险代理收费";
            case "HOURLY" -> "计时收费";
            case "RETAINER" -> "常年顾问年费";
            default -> mode;
        };
    }

    private static String intakeStatusLabel(String status) {
        if (status == null) return "利冲检索中";
        return switch (status.toUpperCase(Locale.ROOT)) {
            case "CONFLICT_CHECKING" -> "利冲检索中";
            case "PENDING_LAWYER_CLEARANCE" -> "待冲突律师放行";
            case "PENDING_COMMITTEE_REVIEW" -> "待利冲委员终审";
            case "APPROVED_FILED" -> "已正式立案";
            case "REJECTED_CONFLICT" -> "利冲阻断/不予立案";
            case "CLOSED" -> "已结案归档";
            default -> status;
        };
    }

    private static double ratePercent(long numerator, long denominator) {
        if (denominator <= 0) return 0.0;
        return Math.round((numerator * 1000.0) / denominator) / 10.0;
    }

    private static String formatYuan(long cents) {
        return String.format(Locale.ROOT, "%.2f", cents / 100.0);
    }

    private static String csvCell(String val) {
        if (val == null) return "";
        String v = val;
        // 防 CSV 公式注入：客户名/备注以 = + - @ 开头时 Excel/WPS 会当公式执行。
        if (!v.isEmpty() && "=+-@\t\r".indexOf(v.charAt(0)) >= 0) {
            v = "'" + v;
        }
        String cleaned = v.replace("\"", "\"\"");
        if (cleaned.contains(",") || cleaned.contains("\"") || cleaned.contains("\n") || cleaned.contains("\r")) {
            return "\"" + cleaned + "\"";
        }
        return cleaned;
    }

    private static String firstNonBlank(String... vals) {
        if (vals == null) return "";
        for (String v : vals) {
            if (v != null && !v.isBlank()) {
                return v.trim();
            }
        }
        return "";
    }

    private static String string(Map<String, Object> map, String key, String defaultVal) {
        if (map == null) return defaultVal;
        Object v = map.get(key);
        if (v == null) return defaultVal;
        String s = String.valueOf(v).trim();
        return s.isEmpty() ? defaultVal : s;
    }

    private static Long longVal(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return null;
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Integer intVal(Object v, Integer fallback) {
        if (v == null) return fallback;
        if (v instanceof Number n) return n.intValue();
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return fallback;
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static Double doubleVal(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return null;
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Boolean boolVal(Object v) {
        if (v == null) return null;
        if (v instanceof Boolean b) return b;
        String s = String.valueOf(v).trim().toLowerCase(Locale.ROOT);
        if ("true".equals(s) || "1".equals(s) || "yes".equals(s)) return true;
        if ("false".equals(s) || "0".equals(s) || "no".equals(s)) return false;
        return null;
    }

    private static Long centsFromParams(Map<String, Object> params, String centsKey, String yuanKey) {
        Long cents = longVal(params.get(centsKey));
        if (cents != null) {
            return cents;
        }
        Double yuan = doubleVal(params.get(yuanKey));
        if (yuan != null) {
            return Math.round(yuan * 100.0);
        }
        return null;
    }

    private static Instant parseInstantOrDefault(Object raw, Instant fallback) {
        if (raw == null) return fallback;
        if (raw instanceof Instant inst) return inst;
        String s = String.valueOf(raw).trim();
        if (s.isEmpty()) return fallback;
        try {
            return Instant.parse(s);
        } catch (Exception e) {
            try {
                return LocalDate.parse(s).atStartOfDay(ZoneId.systemDefault()).toInstant();
            } catch (Exception ex) {
                return fallback;
            }
        }
    }
}
