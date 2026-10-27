// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 法规级律所利益冲突检索与收费合规校验引擎。
 *
 * <p>依据：
 * <ul>
 *   <li>《中华人民共和国律师法》第三十九条、第五十条</li>
 *   <li>中华全国律师协会《律师执业行为规范》第五十条至第五十六条</li>
 *   <li>《律师服务收费管理办法》第十一条至第十三条、《关于进一步规范律师服务收费的意见》</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class LawFirmConflictEngine {

    private static final List<String> COMPANY_SUFFIXES = List.of(
            "股份有限公司", "有限责任公司", "有限公司", "合伙企业", "有限合伙",
            "集团", "控股", "科技", "技术", "投资", "实业", "发展", "管理", "咨询", "股份", "公司"
    );

    private static final Set<String> CONTINGENCY_PROHIBITED_AREAS = Set.of(
            "CRIMINAL", "ADMINISTRATIVE", "MARRIAGE_FAMILY", "STATE_COMPENSATION", "MASS_LITIGATION"
    );

    private final ObjectMapper objectMapper;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class RelatedParty {
        private String role;
        private String name;
        private String creditCode;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class ConflictHit {
        private String ruleCode;
        private String riskLevel;
        private String ruleTitle;
        private String statutoryCitation;
        private Long matchedIntakeId;
        private String matchedIntakeNo;
        private Long matchedProjectId;
        private String matchedMatterTitle;
        private String matchedPartyName;
        private String matchedPartyRole;
        private Long handlerUserId;
        private String handlerUserName;
        private String departmentName;
        private String actionRequired;

        public String getRuleCitation() {
            return statutoryCitation;
        }

        public String getConflictingMatterTitle() {
            return matchedMatterTitle;
        }

        public String getDescription() {
            String title = matchedMatterTitle != null && !matchedMatterTitle.isBlank() ? matchedMatterTitle : "在办案件";
            String party = matchedPartyName != null && !matchedPartyName.isBlank() ? "（命中主体：" + matchedPartyName + "）" : "";
            return (ruleTitle != null && !ruleTitle.isBlank() ? ruleTitle + " — " : "") + title + party;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class ConflictCheckResult {
        private String riskLevel;
        private String primaryRuleCode;
        private String summary;
        private List<ConflictHit> hits;
        private String feeComplianceWarning;
    }

    /**
     * 规范化主体全称：去除空白字符、全角括号转半角、英文大写。
     */
    public static String normalizeExact(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replaceAll("[\\s\\u00A0\\u3000]+", "")
                .replace('（', '(')
                .replace('）', ')')
                .toUpperCase(Locale.ROOT)
                .trim();
    }

    /**
     * 提取商号核心词干（去除括号附加词及常见公司/集团/行业尾缀）。
     * 例如：「华星半导体股份有限公司」与「华星半导体（集团）有限公司」均归一化为「华星半导体」。
     */
    public static String extractCoreStem(String raw) {
        String normalized = normalizeExact(raw);
        if (normalized.isEmpty()) {
            return "";
        }
        String withoutParens = normalized.replaceAll("\\([^)]*\\)", "");
        String current = withoutParens;
        boolean changed = true;
        while (changed && current.length() > 2) {
            changed = false;
            for (String suffix : COMPANY_SUFFIXES) {
                if (current.endsWith(suffix) && current.length() - suffix.length() >= 2) {
                    current = current.substring(0, current.length() - suffix.length());
                    changed = true;
                    break;
                }
            }
        }
        return current.trim();
    }

    /**
     * 判断两个主体是否构成同一或集团关联命中（统一社会信用代码一致、规范化全称一致或商号核心词干一致）。
     */
    public static boolean matchesParty(String nameA, String codeA, String nameB, String codeB) {
        String normCodeA = normalizeExact(codeA);
        String normCodeB = normalizeExact(codeB);
        if (!normCodeA.isEmpty() && normCodeA.equals(normCodeB)) {
            return true;
        }
        String normNameA = normalizeExact(nameA);
        String normNameB = normalizeExact(nameB);
        if (normNameA.isEmpty() || normNameB.isEmpty()) {
            return false;
        }
        if (normNameA.equals(normNameB)) {
            return true;
        }
        String stemA = extractCoreStem(nameA);
        String stemB = extractCoreStem(nameB);
        // 词干至少 4 个字：去掉尾缀后只剩「北京」「上海」这种地名时，不能据此认定是同一集团。
        return stemA.length() >= 4 && stemA.equals(stemB);
    }

    public List<RelatedParty> parseRelatedParties(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            List<Map<String, Object>> rawList = objectMapper.readValue(
                    json, new TypeReference<List<Map<String, Object>>>() {});
            if (rawList == null) {
                return List.of();
            }
            List<RelatedParty> out = new ArrayList<>();
            for (Map<String, Object> item : rawList) {
                if (item == null) continue;
                String name = item.get("name") != null ? String.valueOf(item.get("name")).trim() : "";
                if (name.isEmpty()) continue;
                String role = item.get("role") != null ? String.valueOf(item.get("role")).trim() : "AFFILIATE";
                String creditCode = item.get("creditCode") != null ? String.valueOf(item.get("creditCode")).trim() : "";
                out.add(RelatedParty.builder()
                        .role(role)
                        .name(name)
                        .creditCode(creditCode)
                        .build());
            }
            return out;
        } catch (Exception e) {
            return List.of();
        }
    }

    /**
     * 收费合规审查（《律师服务收费管理办法》第十一至十三条、《关于进一步规范律师服务收费的意见》）。
     */
    public String evaluateFeeCompliance(String practiceArea, String feeMode, Integer contingencyRateBps, Long disputeTargetCents) {
        if (!"CONTINGENCY".equalsIgnoreCase(feeMode)) {
            return null;
        }
        List<String> warnings = new ArrayList<>();
        String area = practiceArea == null ? "" : practiceArea.trim().toUpperCase(Locale.ROOT);
        if (CONTINGENCY_PROHIBITED_AREAS.contains(area)) {
            warnings.add("《律师服务收费管理办法》第十一条、第十二条：婚姻继承案件、刑事诉讼案件、行政诉讼案件、国家赔偿案件以及群体性诉讼案件禁止实行风险代理收费");
        }
        int bps = contingencyRateBps != null ? contingencyRateBps : 0;
        if (bps > 3000) {
            warnings.add("《关于进一步规范律师服务收费的意见》：风险代理收费最高不得超过标的额的30%，且分段递减上限为：不超过100万元部分≤18%，100-500万元≤15%，500-1000万元≤12%，1000-5000万元≤9%，5000万元以上≤6%");
        } else if (bps > 1800) {
            warnings.add("《关于进一步规范律师服务收费的意见》分段递减上限提示：风险代理收费最高不得超过标的额的30%，且分段递减上限为：不超过100万元部分≤18%，100-500万元≤15%，500-1000万元≤12%，1000-5000万元≤9%，5000万元以上≤6%");
        }
        return warnings.isEmpty() ? null : String.join("；", warnings);
    }

    /**
     * 执行全所利益冲突检索与法规分级判定。
     */
    public ConflictCheckResult evaluateConflict(
            LawFirmMatterIntake candidate,
            List<LawFirmMatterIntake> existingIntakes,
            List<Project> existingProjects,
            Map<Long, String> userDisplayNames) {

        List<ConflictHit> hits = new ArrayList<>();
        String candClient = candidate.getClientName();
        String candClientCode = candidate.getClientCreditCode();
        String candCounter = candidate.getCounterpartyName();
        String candCounterCode = candidate.getCounterpartyCreditCode();
        List<RelatedParty> candRelated = parseRelatedParties(candidate.getRelatedPartiesJson());

        Set<Long> coveredProjectIds = new LinkedHashSet<>();

        if (existingIntakes != null) {
            for (LawFirmMatterIntake ex : existingIntakes) {
                if (ex == null) continue;
                if (candidate.getId() != null && Objects.equals(candidate.getId(), ex.getId())) {
                    continue;
                }
                String exStatus = ex.getStatus() == null ? "APPROVED_FILED" : ex.getStatus();
                if ("REJECTED_CONFLICT".equalsIgnoreCase(exStatus)) {
                    continue;
                }
                if (ex.getProjectId() != null) {
                    coveredProjectIds.add(ex.getProjectId());
                }

                Long handlerId = ex.getLeadLawyerUserId() != null ? ex.getLeadLawyerUserId() : ex.getApplicantUserId();
                String handlerName = firstNonBlank(
                        ex.getLeadLawyerName(),
                        ex.getApplicantName(),
                        handlerId != null && userDisplayNames != null ? userDisplayNames.get(handlerId) : null,
                        "关联案件主办律师");
                String exDept = firstNonBlank(ex.getDepartmentName(), "本所业务部");

                boolean clientMatchesExCounter = matchesParty(candClient, candClientCode, ex.getCounterpartyName(), ex.getCounterpartyCreditCode());
                boolean counterMatchesExClient = matchesParty(candCounter, candCounterCode, ex.getClientName(), ex.getClientCreditCode());
                boolean isRetainer = "RETAINER".equalsIgnoreCase(ex.getPracticeArea()) || "RETAINER".equalsIgnoreCase(ex.getFeeMode());
                boolean isHistorical = "CLOSED".equalsIgnoreCase(exStatus);
                boolean isInFlight = Set.of("CONFLICT_CHECKING", "PENDING_LAWYER_CLEARANCE", "PENDING_COMMITTEE_REVIEW").contains(exStatus);

                // R1: 直接双向对抗冲突（委托人与对方当事人互换）
                if (!isHistorical && clientMatchesExCounter && counterMatchesExClient) {
                    hits.add(ConflictHit.builder()
                            .ruleCode("R1_DIRECT_ADVERSARY")
                            .riskLevel("RED")
                            .ruleTitle("同一或关联争议双方直接利益冲突")
                            .statutoryCitation("《中华人民共和国律师法》第三十九条第一款、全国律协《律师执业行为规范》第五十一条第（一）（二）项")
                            .matchedIntakeId(ex.getId())
                            .matchedIntakeNo(ex.getIntakeNo())
                            .matchedProjectId(ex.getProjectId())
                            .matchedMatterTitle(ex.getTitle())
                            .matchedPartyName(ex.getClientName() + " / " + ex.getCounterpartyName())
                            .matchedPartyRole("在办委托人及对方当事人双向对抗")
                            .handlerUserId(handlerId)
                            .handlerUserName(handlerName)
                            .departmentName(exDept)
                            .actionRequired("禁止直接立案；如属法定可豁免情形，须经关联主办律师放行、双方客户签署书面豁免函并启用信息隔离墙后由利冲委员特批")
                            .build());
                    continue;
                }

                // R2: 常年法律顾问客户对抗冲突
                if (!isHistorical && isRetainer && (counterMatchesExClient || clientMatchesExCounter)) {
                    String matchedParty = counterMatchesExClient ? ex.getClientName() : ex.getCounterpartyName();
                    hits.add(ConflictHit.builder()
                            .ruleCode("R2_RETAINER_ADVERSARY")
                            .riskLevel("RED")
                            .ruleTitle("对抗本所在期常年法律顾问客户")
                            .statutoryCitation("全国律协《律师执业行为规范》第五十一条第（四）项：在委托人处于常年法律顾问关系期间，不得代理他人与该委托人之间的诉讼或仲裁")
                            .matchedIntakeId(ex.getId())
                            .matchedIntakeNo(ex.getIntakeNo())
                            .matchedProjectId(ex.getProjectId())
                            .matchedMatterTitle(ex.getTitle())
                            .matchedPartyName(matchedParty)
                            .matchedPartyRole("在期常年法律顾问客户")
                            .handlerUserId(handlerId)
                            .handlerUserName(handlerName)
                            .departmentName(exDept)
                            .actionRequired("常年法律顾问关系存续期间严禁代理对抗该顾问客户的案件；特殊非诉豁免须上传书面豁免函并经管委会/利冲委员特批")
                            .build());
                    continue;
                }

                // Y2: 历史已结案客户对抗冲突
                if (isHistorical && (counterMatchesExClient || clientMatchesExCounter)) {
                    String matchedParty = counterMatchesExClient ? ex.getClientName() : ex.getCounterpartyName();
                    hits.add(ConflictHit.builder()
                            .ruleCode("Y2_HISTORICAL_CLIENT_ADVERSARY")
                            .riskLevel("YELLOW")
                            .ruleTitle("新案对方当事人系本所历史已结案客户")
                            .statutoryCitation("全国律协《律师执业行为规范》第五十一条第（五）项、第五十二条第（二）项：对抗历史结案客户，需原承办律师确认不涉及原委托事项中获知的保密信息")
                            .matchedIntakeId(ex.getId())
                            .matchedIntakeNo(ex.getIntakeNo())
                            .matchedProjectId(ex.getProjectId())
                            .matchedMatterTitle(ex.getTitle())
                            .matchedPartyName(matchedParty)
                            .matchedPartyRole("历史结案客户")
                            .handlerUserId(handlerId)
                            .handlerUserName(handlerName)
                            .departmentName(exDept)
                            .actionRequired("向原案主办律师发送站内信征询，确认不涉及原委托事项保密信息并放行")
                            .build());
                    continue;
                }

                // Y4: 在途收案申请交叉冲突
                if (isInFlight && (counterMatchesExClient || clientMatchesExCounter)) {
                    String matchedParty = counterMatchesExClient ? ex.getClientName() : ex.getCounterpartyName();
                    hits.add(ConflictHit.builder()
                            .ruleCode("Y4_INFLIGHT_INTAKE_OVERLAP")
                            .riskLevel("YELLOW")
                            .ruleTitle("与本所在途审查收案存在主体对抗交叉")
                            .statutoryCitation("全国律协《律师执业行为规范》第五十条及律所收案排他规范：与在途立项主体存在对抗交叉，需在途案件主办律师协同确认")
                            .matchedIntakeId(ex.getId())
                            .matchedIntakeNo(ex.getIntakeNo())
                            .matchedProjectId(ex.getProjectId())
                            .matchedMatterTitle(ex.getTitle())
                            .matchedPartyName(matchedParty)
                            .matchedPartyRole("在途案件当事人")
                            .handlerUserId(handlerId)
                            .handlerUserName(handlerName)
                            .departmentName(exDept)
                            .actionRequired("向在途案件申请/主办律师发送站内信协同征询并由利冲委员裁决")
                            .build());
                    continue;
                }

                // Y1: 在办非关联案件现有客户间接冲突
                if (counterMatchesExClient || clientMatchesExCounter) {
                    String matchedParty = counterMatchesExClient ? ex.getClientName() : ex.getCounterpartyName();
                    hits.add(ConflictHit.builder()
                            .ruleCode("Y1_EXISTING_CLIENT_OTHER_MATTER")
                            .riskLevel("YELLOW")
                            .ruleTitle("新案对方当事人系本所在办案件委托人（或集团关联主体）")
                            .statutoryCitation("全国律协《律师执业行为规范》第五十一条第（三）项、第五十二条第（一）项：需征询该客户承办律师放行、取得客户书面豁免并建立信息隔离墙")
                            .matchedIntakeId(ex.getId())
                            .matchedIntakeNo(ex.getIntakeNo())
                            .matchedProjectId(ex.getProjectId())
                            .matchedMatterTitle(ex.getTitle())
                            .matchedPartyName(matchedParty)
                            .matchedPartyRole(counterMatchesExClient ? "在办案件委托人" : "在办案件对方当事人")
                            .handlerUserId(handlerId)
                            .handlerUserName(handlerName)
                            .departmentName(exDept)
                            .actionRequired("自动向关联案件主办律师发送站内信征询，放行并建立信息隔离墙后交利冲委员终审")
                            .build());
                    continue;
                }

                // Y3: 关联方 / 控股股东 / 一致行动人 / 律师近亲属交叉命中
                List<RelatedParty> exRelated = parseRelatedParties(ex.getRelatedPartiesJson());
                String matchedAffiliate = findAffiliateCrossMatch(
                        candClient, candClientCode, candCounter, candCounterCode, candRelated,
                        ex.getClientName(), ex.getClientCreditCode(), ex.getCounterpartyName(), ex.getCounterpartyCreditCode(), exRelated);
                if (matchedAffiliate != null) {
                    hits.add(ConflictHit.builder()
                            .ruleCode("Y3_AFFILIATE_OR_CONCERTED")
                            .riskLevel("YELLOW")
                            .ruleTitle("关联方/控股股东/一致行动人潜在利益冲突")
                            .statutoryCitation("全国律协《律师执业行为规范》第五十条、第五十三条：关联方/控股股东/一致行动人潜在利冲，需关联案件承办律师征询放行")
                            .matchedIntakeId(ex.getId())
                            .matchedIntakeNo(ex.getIntakeNo())
                            .matchedProjectId(ex.getProjectId())
                            .matchedMatterTitle(ex.getTitle())
                            .matchedPartyName(matchedAffiliate)
                            .matchedPartyRole("关联方/一致行动人")
                            .handlerUserId(handlerId)
                            .handlerUserName(handlerName)
                            .departmentName(exDept)
                            .actionRequired("向关联案件承办律师发送站内信征询放行")
                            .build());
                }
            }
        }

        // 同时检索工作台已有 Project（尚未通过 LawFirmMatterIntake 登记的存量项目）
        if (existingProjects != null) {
            for (Project proj : existingProjects) {
                if (proj == null || proj.isLooseFileWorkspace() || proj.isScratchWorkspace()) continue;
                if (proj.getId() != null && coveredProjectIds.contains(proj.getId())) continue;
                if (candidate.getProjectId() != null && Objects.equals(candidate.getProjectId(), proj.getId())) continue;

                boolean clientMatchesProjTarget = matchesParty(candClient, candClientCode, proj.getTargetCompanyName(), null);
                boolean counterMatchesProjClient = matchesParty(candCounter, candCounterCode, proj.getListedCompanyName(), null);
                Long ownerId = proj.getUserId();
                String ownerName = ownerId != null && userDisplayNames != null
                        ? userDisplayNames.getOrDefault(ownerId, "项目负责人")
                        : "项目负责人";

                if (clientMatchesProjTarget && counterMatchesProjClient) {
                    hits.add(ConflictHit.builder()
                            .ruleCode("R1_DIRECT_ADVERSARY")
                            .riskLevel("RED")
                            .ruleTitle("与工作台在办项目存在直接双向对抗冲突")
                            .statutoryCitation("《中华人民共和国律师法》第三十九条第一款、全国律协《律师执业行为规范》第五十一条第（一）（二）项")
                            .matchedProjectId(proj.getId())
                            .matchedMatterTitle(proj.getName())
                            .matchedPartyName(proj.getListedCompanyName() + " / " + proj.getTargetCompanyName())
                            .matchedPartyRole("工作台在办项目双方")
                            .handlerUserId(ownerId)
                            .handlerUserName(ownerName)
                            .departmentName("工作台在办项目")
                            .actionRequired("禁止直接立案；需项目负责人确认及利冲委员特批")
                            .build());
                } else if (counterMatchesProjClient || clientMatchesProjTarget) {
                    String matchedParty = counterMatchesProjClient ? proj.getListedCompanyName() : proj.getTargetCompanyName();
                    hits.add(ConflictHit.builder()
                            .ruleCode("Y1_EXISTING_CLIENT_OTHER_MATTER")
                            .riskLevel("YELLOW")
                            .ruleTitle("新案当事人命中工作台在办项目客户/标的方")
                            .statutoryCitation("全国律协《律师执业行为规范》第五十一条第（三）项、第五十二条第（一）项：需征询该客户承办律师放行、取得客户书面豁免并建立信息隔离墙")
                            .matchedProjectId(proj.getId())
                            .matchedMatterTitle(proj.getName())
                            .matchedPartyName(matchedParty)
                            .matchedPartyRole(counterMatchesProjClient ? "工作台项目委托方" : "工作台项目对方/标的方")
                            .handlerUserId(ownerId)
                            .handlerUserName(ownerName)
                            .departmentName("工作台在办项目")
                            .actionRequired("向工作台项目负责人发送站内信征询放行并建立信息隔离墙")
                            .build());
                }
            }
        }

        String feeWarning = evaluateFeeCompliance(
                candidate.getPracticeArea(),
                candidate.getFeeMode(),
                candidate.getContingencyRateBps(),
                candidate.getDisputeTargetCents());

        if (hits.isEmpty()) {
            return ConflictCheckResult.builder()
                    .riskLevel("GREEN")
                    .primaryRuleCode("G0_CLEAR")
                    .summary("【G0_CLEAR】全国律协《律师执业行为规范》第五十条：经检索全所在办案件、常年法律顾问、历史客户及关联方库，未发现利益冲突。")
                    .hits(List.of())
                    .feeComplianceWarning(feeWarning)
                    .build();
        }

        boolean hasRed = hits.stream().anyMatch(h -> "RED".equals(h.getRiskLevel()));
        String overallRisk = hasRed ? "RED" : "YELLOW";
        ConflictHit primary = hits.stream()
                .filter(h -> overallRisk.equals(h.getRiskLevel()))
                .findFirst()
                .orElse(hits.get(0));

        String summary = String.format(
                "【%s · %s】共命中 %d 项利益冲突记录（首要规则：%s；涉及主体：%s；关联主办：%s）。法规依据：%s",
                overallRisk,
                primary.getRuleCode(),
                hits.size(),
                primary.getRuleTitle(),
                primary.getMatchedPartyName(),
                primary.getHandlerUserName(),
                primary.getStatutoryCitation()
        );

        return ConflictCheckResult.builder()
                .riskLevel(overallRisk)
                .primaryRuleCode(primary.getRuleCode())
                .summary(summary)
                .hits(hits)
                .feeComplianceWarning(feeWarning)
                .build();
    }

    private String findAffiliateCrossMatch(
            String candClient, String candClientCode,
            String candCounter, String candCounterCode,
            List<RelatedParty> candRelated,
            String exClient, String exClientCode,
            String exCounter, String exCounterCode,
            List<RelatedParty> exRelated) {

        for (RelatedParty rp : candRelated) {
            if (matchesParty(rp.getName(), rp.getCreditCode(), exClient, exClientCode)
                    || matchesParty(rp.getName(), rp.getCreditCode(), exCounter, exCounterCode)) {
                return rp.getName() + "（" + rp.getRole() + "）";
            }
            for (RelatedParty exRp : exRelated) {
                if (matchesParty(rp.getName(), rp.getCreditCode(), exRp.getName(), exRp.getCreditCode())) {
                    return rp.getName() + "（" + rp.getRole() + "）";
                }
            }
        }
        for (RelatedParty exRp : exRelated) {
            if (matchesParty(candClient, candClientCode, exRp.getName(), exRp.getCreditCode())
                    || matchesParty(candCounter, candCounterCode, exRp.getName(), exRp.getCreditCode())) {
                return exRp.getName() + "（" + exRp.getRole() + "）";
            }
        }
        return null;
    }

    private static String firstNonBlank(String... values) {
        if (values == null) return "";
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v.trim();
            }
        }
        return "";
    }
}
