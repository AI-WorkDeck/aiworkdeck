// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.ImConversation;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.User;
import com.checkba.model.entity.lawfirm.LawFirmCollection;
import com.checkba.model.entity.lawfirm.LawFirmInvoice;
import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import com.checkba.model.entity.lawfirm.LawFirmParty;
import com.checkba.model.entity.lawfirm.LawFirmPartyRelation;
import com.checkba.repository.ImConversationRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.ProjectTaskRepository;
import com.checkba.repository.UserActivityLogRepository;
import com.checkba.repository.UserRepository;
import com.checkba.repository.lawfirm.LawFirmCollectionRepository;
import com.checkba.repository.lawfirm.LawFirmInvoiceRepository;
import com.checkba.repository.lawfirm.LawFirmMatterIntakeRepository;
import com.checkba.repository.lawfirm.LawFirmPartyRelationRepository;
import com.checkba.repository.lawfirm.LawFirmPartyRepository;
import com.checkba.service.LangText;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
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
import java.util.stream.Collectors;

/**
 * 客户管理（律所管理插件「客户」栏）。一份主体数据（{@link LawFirmParty}，客户是 client=true 的行）
 * 加主体间的有向关系（{@link LawFirmPartyRelation}），与收案、利冲检索共用：
 * <ul>
 *   <li>收案通过 {@link LawFirmMatterIntake#getClientId()} 挂到客户；选已有客户不重复录入，只填名称的收案按
 *       信用代码或规范化全称归到同一主体（是非客户主体就升为客户），找不到才新建；</li>
 *   <li>旧收案（没有 clientId）在打开台账时按同一规则归集，收案上登记的关联方转成关系，不留孤儿；</li>
 *   <li>{@link #graph()} 交给 {@link LawFirmConflictEngine}，沿关系链（含多层股权）检索利冲。</li>
 * </ul>
 * 「最近往来」取真实信号的最大值：手动登记的联系、客户名下项目的工作记录（user_activity_log）、
 * 项目群消息、已过日期的会议/开庭日程、收案登记时间。
 * 与 {@link LawFirmManagementService} 同属本机台账：只在桌面端可用（由调用方 requireLocalLedger 把关）。
 */
@Service
@RequiredArgsConstructor
public class LawFirmClientService {

    public static final Set<String> ACTIONS = Set.of(
            "listClients", "getClient", "saveClient", "logClientContact", "searchParties", "saveRelation", "deleteRelation",
            "uploadClientsToCloud");

    static final Set<String> ACTIVE_STATUSES = Set.of(
            "CONFLICT_CHECKING", "PENDING_LAWYER_CLEARANCE", "PENDING_COMMITTEE_REVIEW", "APPROVED_FILED");
    private static final Set<String> NOT_BILLED = Set.of("VOIDED", "RED_INVOICED", "PENDING_APPROVAL");
    private static final Set<String> CONTACT_CHANNELS = Set.of("MEETING", "CALL", "EMAIL", "VISIT", "MESSAGE", "OTHER");
    private static final int MAX_CONTACT_LOG = 50;
    private static final int MAX_LIST = 30;

    private final LawFirmPartyRepository partyRepository;
    private final LawFirmPartyRelationRepository relationRepository;
    private final LawFirmMatterIntakeRepository intakeRepository;
    private final LawFirmInvoiceRepository invoiceRepository;
    private final LawFirmCollectionRepository collectionRepository;
    private final ProjectRepository projectRepository;
    private final UserRepository userRepository;
    private final UserActivityLogRepository activityLogRepository;
    private final ImConversationRepository imConversationRepository;
    private final ProjectTaskRepository projectTaskRepository;
    private final LawFirmAccessPolicy access;
    private final LawFirmConflictEngine conflictEngine;
    private final ObjectMapper objectMapper;
    private final org.springframework.beans.factory.ObjectProvider<LawFirmCloudCaller> cloudCaller;

    /** 调用方已在事务内并已核本机台账。 */
    public Map<String, Object> execute(Long userId, String action, Map<String, Object> params) {
        linkUnassignedIntakes();
        return switch (action) {
            case "listClients" -> listClients(userId, params);
            case "getClient" -> getClient(userId, params);
            case "saveClient" -> saveClient(userId, params);
            case "logClientContact" -> logContact(userId, params);
            case "searchParties" -> searchParties(userId, params);
            case "saveRelation" -> saveRelation(userId, params);
            case "deleteRelation" -> deleteRelation(userId, params);
            case "uploadClientsToCloud" -> uploadToCloud(userId, params);
            default -> throw new IllegalArgumentException(LangText.of("不支持的客户操作：", "Unsupported client action: ") + action);
        };
    }

    // ---- 与收案、利冲共用的主体数据 ----

    /** 把没有 clientId 的收案归到客户（按信用代码或规范化全称；都对不上才新建）。幂等。 */
    public int linkUnassignedIntakes() {
        List<LawFirmMatterIntake> pending = intakeRepository.findAllByOrderByCreatedAtDescIdDesc().stream()
                .filter(i -> i.getClientId() == null && !blank(i.getClientName()))
                .sorted(Comparator.comparing(LawFirmMatterIntake::getId))
                .toList();
        if (pending.isEmpty()) return 0;
        List<LawFirmParty> parties = new ArrayList<>(partyRepository.findAllByOrderByIdAsc());
        List<LawFirmPartyRelation> relations = new ArrayList<>(relationRepository.findAllByOrderByIdAsc());
        for (LawFirmMatterIntake intake : pending) {
            LawFirmParty client = clientFor(parties, intake);
            intake.setClientId(client.getId());
            intakeRepository.save(intake);
            importIntakeRelatedParties(intake, client, parties, relations);
        }
        return pending.size();
    }

    /**
     * 收案参数里带了 clientId：以客户档案的名称与信用代码为准（不让表单上残留的旧文字和档案不一致）。
     * 没带就按名称/信用代码找已有客户；找不到原样返回，由 {@link #linkIntake} 在保存后建档。
     */
    public Map<String, Object> applyClientToIntakeParams(Long userId, Map<String, Object> params) {
        Long clientId = longVal(params.get("clientId"));
        if (clientId == null) {
            String name = string(params, "clientName");
            LawFirmParty match = name.isEmpty() ? null
                    : findMatch(partyRepository.findAllByOrderByIdAsc(), name, string(params, "clientCreditCode"), null);
            if (match == null || !match.isClientParty()) return params;
            Map<String, Object> out = new LinkedHashMap<>(params);
            out.put("clientId", match.getId());
            return out;
        }
        LawFirmParty client = requireVisibleClient(userId, clientId);
        Map<String, Object> out = new LinkedHashMap<>(params);
        out.put("clientId", client.getId());
        out.put("clientName", client.getName());
        out.put("clientCreditCode", client.getCreditCode() == null ? "" : client.getCreditCode());
        return out;
    }

    /** 新收案保存后挂到客户：已选客户直接用，否则按名称/信用代码找（非客户主体升为客户），找不到新建。 */
    public LawFirmParty linkIntake(LawFirmMatterIntake intake) {
        if (blank(intake.getClientName()) && intake.getClientId() == null) return null;
        List<LawFirmParty> parties = new ArrayList<>(partyRepository.findAllByOrderByIdAsc());
        LawFirmParty client = intake.getClientId() == null ? null
                : parties.stream().filter(p -> p.getId().equals(intake.getClientId()) && p.isClientParty()).findFirst().orElse(null);
        if (client == null) client = clientFor(parties, intake);
        if (!Objects.equals(intake.getClientId(), client.getId())) {
            intake.setClientId(client.getId());
            intakeRepository.save(intake);
        }
        importIntakeRelatedParties(intake, client, parties, new ArrayList<>(relationRepository.findAllByOrderByIdAsc()));
        return client;
    }

    /**
     * 利冲引擎用的主体关系图（全所范围，不按查看人裁剪——利冲检索本来就扫全所）。
     * 收案时自动建档、但名下收案全部被利冲驳回的客户不算「本所客户」（只是未接的潜在客户）。
     * 征询对象：客户维护人，没有则主办合伙人。
     */
    public LawFirmPartyGraph graph() {
        Map<Long, String> names = userNames();
        Map<Long, Boolean> hasLiveIntake = new HashMap<>();
        for (LawFirmMatterIntake i : intakeRepository.findAllByOrderByCreatedAtDescIdDesc()) {
            if (i.getClientId() == null) continue;
            hasLiveIntake.merge(i.getClientId(), !"REJECTED_CONFLICT".equals(i.getStatus()), Boolean::logicalOr);
        }
        List<LawFirmPartyGraph.Node> nodes = partyRepository.findAllByOrderByIdAsc().stream()
                .map(p -> {
                    boolean declinedProspect = "INTAKE".equals(p.getSource()) && Boolean.FALSE.equals(hasLiveIntake.get(p.getId()));
                    Long handler = p.getOwnerUserId() != null ? p.getOwnerUserId() : p.getPartnerUserId();
                    String handlerName = p.getOwnerUserId() != null || p.getOwnerName() != null
                            ? firstNonBlank(p.getOwnerName(), p.getOwnerUserId() == null ? null : names.get(p.getOwnerUserId()))
                            : firstNonBlank(p.getPartnerName(), p.getPartnerUserId() == null ? null : names.get(p.getPartnerUserId()));
                    return new LawFirmPartyGraph.Node(p.getId(), p.getName(), p.getCreditCode(),
                            p.isClientParty() && !declinedProspect, p.getClientNo(), handler, handlerName);
                })
                .toList();
        List<LawFirmPartyGraph.Edge> edges = relationRepository.findAllByOrderByIdAsc().stream()
                .map(r -> new LawFirmPartyGraph.Edge(r.getId(), r.getFromPartyId(), r.getToPartyId(), r.getRelationType(), r.getShareBps(), r.getNote()))
                .toList();
        return new LawFirmPartyGraph(nodes, edges);
    }

    // ---- 动作 ----

    Map<String, Object> listClients(Long userId, Map<String, Object> params) {
        Ledger ledger = loadLedger(userId);
        String query = LawFirmConflictEngine.normalizeExact(string(params, "query"));
        Long ownerFilter = longVal(params.get("ownerUserId"));
        Integer staleDays = intVal(params.get("staleDays"));

        List<Map<String, Object>> rows = new ArrayList<>();
        long revenueYear = 0, ar = 0, activeMatters = 0, stale90 = 0;
        for (LawFirmParty c : ledger.visibleClients) {
            Map<String, Object> row = summary(c, ledger);
            Integer days = (Integer) row.get("lastInteractionDays");
            if (days == null || days > 90) stale90++;
            revenueYear += (Long) row.get("collectedThisYearCents");
            ar += (Long) row.get("arCents");
            activeMatters += (Long) row.get("activeMatterCount");
            if (!query.isEmpty() && !LawFirmConflictEngine.normalizeExact(c.getName()).contains(query)
                    && !LawFirmConflictEngine.normalizeExact(c.getCreditCode()).contains(query)
                    && !LawFirmConflictEngine.normalizeExact(c.getClientNo()).contains(query)) continue;
            if (ownerFilter != null && !ownerFilter.equals(c.getOwnerUserId()) && !ownerFilter.equals(c.getPartnerUserId())) continue;
            if (staleDays != null && days != null && days <= staleDays) continue;
            rows.add(row);
        }
        Comparator<Map<String, Object>> order = switch (string(params, "sort")) {
            case "ar" -> Comparator.comparing((Map<String, Object> r) -> (Long) r.get("arCents")).reversed();
            case "stale" -> Comparator.comparing((Map<String, Object> r) -> r.get("lastInteractionDays") == null
                    ? Integer.MAX_VALUE : (Integer) r.get("lastInteractionDays")).reversed();
            case "name" -> Comparator.comparing((Map<String, Object> r) -> String.valueOf(r.get("name")));
            default -> Comparator.comparing((Map<String, Object> r) -> (Long) r.get("collectedThisYearCents")).reversed()
                    .thenComparing((Map<String, Object> r) -> (Long) r.get("activeMatterCount"), Comparator.reverseOrder());
        };
        rows.sort(order);

        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("clientCount", ledger.visibleClients.size());
        totals.put("activeMatterCount", activeMatters);
        totals.put("collectedThisYearCents", revenueYear);
        totals.put("arCents", ar);
        totals.put("staleOver90Count", stale90);
        totals.put("year", LocalDate.now().getYear());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("clients", rows);
        out.put("totals", totals);
        out.put("users", ledger.userOptions());
        out.put("restricted", !ledger.firmWide);
        return out;
    }

    Map<String, Object> getClient(Long userId, Map<String, Object> params) {
        Long clientId = longVal(params.get("clientId"));
        Long intakeId = longVal(params.get("intakeId"));
        if (clientId == null && intakeId != null) {
            clientId = intakeRepository.findById(intakeId).map(LawFirmMatterIntake::getClientId).orElse(null);
        }
        if (clientId == null) {
            throw new IllegalArgumentException(LangText.of("请指定客户", "Please specify a client"));
        }
        Ledger ledger = loadLedger(userId);
        final Long id = clientId;
        LawFirmParty client = ledger.visibleClients.stream().filter(c -> c.getId().equals(id)).findFirst()
                .orElseThrow(LawFirmClientService::notFound);
        Map<String, Object> view = new LinkedHashMap<>(summary(client, ledger));
        view.put("address", client.getAddress());
        view.put("notes", client.getNotes());
        view.put("contacts", parseList(client.getContactsJson()));
        view.put("contactLog", parseList(client.getContactLogJson()));
        view.put("createdAt", client.getCreatedAt());
        view.put("canEdit", canEdit(userId, client, ledger.firmWide));

        List<LawFirmMatterIntake> matters = ledger.intakesByClient.getOrDefault(client.getId(), List.of());
        Set<Long> matterIds = matters.stream().map(LawFirmMatterIntake::getId).collect(Collectors.toSet());
        view.put("matters", matters.stream().map(i -> matterView(i, ledger)).toList());
        view.put("workbenchProjects", ledger.nameMatchedProjects(client).stream()
                .filter(p -> matters.stream().noneMatch(i -> Objects.equals(i.getProjectId(), p.getId())))
                .map(p -> Map.<String, Object>of("id", p.getId(), "name", Objects.requireNonNullElse(firstNonBlank(p.getName()), "#" + p.getId())))
                .toList());
        view.put("invoices", ledger.invoices.stream().filter(v -> matterIds.contains(v.getIntakeId())).map(v -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", v.getId());
            m.put("invoiceAppNo", v.getInvoiceAppNo());
            m.put("matterTitle", v.getMatterTitle());
            m.put("amountCents", nz(v.getAmountCents()));
            m.put("collectedAmountCents", nz(v.getCollectedAmountCents()));
            m.put("status", v.getStatus());
            m.put("issuedAt", v.getIssuedAt());
            return m;
        }).toList());
        view.put("collections", ledger.collections.stream().filter(c -> matterIds.contains(ledger.intakeIdOf(c))).map(c -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", c.getId());
            m.put("collectionNo", c.getCollectionNo());
            m.put("matterTitle", c.getMatterTitle());
            m.put("amountCents", nz(c.getAmountCents()));
            m.put("receivedDate", c.getReceivedDate());
            return m;
        }).toList());
        view.put("conflicts", conflictRecords(client, matters, ledger));
        view.put("signals", ledger.signalsFor(client).stream().limit(12).map(Signal::toMap).toList());
        putRelations(view, client.getId());
        return Map.of("client", view);
    }

    /** 直接关系（可编辑）+ 沿股权链推导的间接股东与下级子公司（只读，带链路）。 */
    private void putRelations(Map<String, Object> view, Long clientId) {
        LawFirmPartyGraph g = graph();
        Set<Long> net = networkOf(g, clientId);
        List<Map<String, Object>> direct = new ArrayList<>();
        Set<Long> seenEdges = new java.util.HashSet<>();
        List<LawFirmPartyGraph.Edge> edges = new ArrayList<>(g.edgesOf(clientId));
        // 关系网内其他主体之间的关系（例如在本档案里补登的「控股股东的实际控制人」），也列出来以便核对和删除
        for (Long pid : net) {
            for (LawFirmPartyGraph.Edge e : g.edgesOf(pid)) {
                Long other = e.from().equals(pid) ? e.to() : e.from();
                if (net.contains(other)) edges.add(e);
            }
        }
        for (LawFirmPartyGraph.Edge e : edges) {
            if (!seenEdges.add(e.id())) continue;
            boolean touches = e.from().equals(clientId) || e.to().equals(clientId);
            boolean out = e.from().equals(clientId);
            LawFirmPartyGraph.Node other = g.node(touches ? (out ? e.to() : e.from()) : e.from());
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.id());
            m.put("relationType", e.type());
            m.put("direction", !touches ? "NETWORK" : LawFirmPartyGraph.SYMMETRIC.contains(e.type()) ? "BOTH" : (out ? "OUT" : "IN"));
            m.put("partyId", other.id());
            m.put("partyName", other.name());
            m.put("partyIsClient", other.client());
            m.put("shareBps", e.shareBps());
            m.put("note", e.note());
            m.put("description", g.describe(e));
            direct.add(m);
        }
        view.put("relations", direct);
        List<Map<String, Object>> network = new ArrayList<>();
        for (Long pid : net) {
            LawFirmPartyGraph.Node n = g.node(pid);
            network.add(Map.of("id", n.id(), "name", n.name(), "client", n.client()));
        }
        view.put("network", network);
        view.put("indirectShareholders", chainView(g, g.equityChain(clientId, true, LawFirmPartyGraph.CHAIN_DEPTH)));
        view.put("indirectSubsidiaries", chainView(g, g.equityChain(clientId, false, LawFirmPartyGraph.CHAIN_DEPTH)));
    }

    /** 客户关系网：直接关联方 + 股权链上下各层（不含客户本身），登记关系时可选作「这一端」。 */
    private static Set<Long> networkOf(LawFirmPartyGraph g, Long clientId) {
        Set<Long> ids = new LinkedHashSet<>();
        for (LawFirmPartyGraph.Edge e : g.edgesOf(clientId)) ids.add(e.from().equals(clientId) ? e.to() : e.from());
        for (LawFirmPartyGraph.Reach r : g.equityChain(clientId, true, LawFirmPartyGraph.CHAIN_DEPTH)) ids.add(r.node().id());
        for (LawFirmPartyGraph.Reach r : g.equityChain(clientId, false, LawFirmPartyGraph.CHAIN_DEPTH)) ids.add(r.node().id());
        ids.remove(clientId);
        return ids;
    }

    private static List<Map<String, Object>> chainView(LawFirmPartyGraph g, List<LawFirmPartyGraph.Reach> chain) {
        return chain.stream().filter(r -> r.depth() > 1).map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("partyId", r.node().id());
            m.put("partyName", r.node().name());
            m.put("partyIsClient", r.node().client());
            m.put("depth", r.depth());
            m.put("effectiveBps", LawFirmPartyGraph.effectiveBps(r.steps()));
            m.put("path", g.describe(r.steps()));
            return m;
        }).toList();
    }

    Map<String, Object> saveClient(Long userId, Map<String, Object> params) {
        Long clientId = longVal(params.get("clientId"));
        String name = trimTo(string(params, "name"), 256);
        if (name.isEmpty()) throw new IllegalArgumentException(LangText.of("请填写客户名称", "Please enter the client name"));
        String code = trimTo(string(params, "creditCode"), 128);
        List<LawFirmParty> all = partyRepository.findAllByOrderByIdAsc();
        Instant now = Instant.now();
        LawFirmParty client;
        LawFirmParty dup = findMatch(all, name, code, clientId);
        if (clientId == null) {
            if (dup != null && !dup.isClientParty()) {
                // 已作为关联主体登记过（如某客户的股东）：升为客户，沿用其关系
                client = dup;
                promote(client, userId);
                dup = null;
            } else {
                client = LawFirmParty.builder().client(true).clientNo(nextClientNo()).source("MANUAL").createdByUserId(userId).createdAt(now).build();
            }
        } else {
            client = partyRepository.findById(clientId).filter(LawFirmParty::isClientParty).orElseThrow(LawFirmClientService::notFound);
            requireEditable(userId, client);
        }
        if (dup != null) {
            boolean show = access.canViewFirmWide(userId) || !dup.isClientParty() || isVisibleClient(userId, dup);
            throw new IllegalArgumentException(LangText.of("已有同名或同一信用代码的主体", "A party with the same name or credit code already exists")
                    + (show ? "：" + dup.getName() + (dup.getClientNo() == null ? "" : "（" + dup.getClientNo() + "）") : ""));
        }
        Map<Long, String> names = userNames();
        client.setName(name);
        client.setCreditCode(code.isEmpty() ? null : code);
        String type = string(params, "partyType").toUpperCase();
        client.setPartyType(Set.of("ORGANIZATION", "INDIVIDUAL").contains(type) ? type : "ORGANIZATION");
        client.setIndustry(trimTo(string(params, "industry"), 128));
        client.setAddress(trimTo(string(params, "address"), 512));
        client.setNotes(trimTo(string(params, "notes"), 4000));
        client.setContactsJson(toJson(cleanContacts(params.get("contacts"))));
        // 只填过姓名（非本机账号）的维护人/主办合伙人：编辑时没改就保留
        String keptOwnerName = client.getOwnerUserId() == null ? client.getOwnerName() : null;
        String keptPartnerName = client.getPartnerUserId() == null ? client.getPartnerName() : null;
        Long ownerId = longVal(params.get("ownerUserId"));
        client.setOwnerUserId(ownerId != null && names.containsKey(ownerId) ? ownerId : null);
        client.setOwnerName(firstNonBlank(trimTo(string(params, "ownerName"), 128),
                client.getOwnerUserId() == null ? keptOwnerName : names.get(client.getOwnerUserId())));
        Long partnerId = longVal(params.get("partnerUserId"));
        client.setPartnerUserId(partnerId != null && names.containsKey(partnerId) ? partnerId : null);
        client.setPartnerName(firstNonBlank(trimTo(string(params, "partnerName"), 128),
                client.getPartnerUserId() == null ? keptPartnerName : names.get(client.getPartnerUserId())));
        client.setUpdatedAt(now);
        client = partyRepository.save(client);
        return getClient(userId, Map.of("clientId", client.getId()));
    }

    Map<String, Object> logContact(Long userId, Map<String, Object> params) {
        Long clientId = longVal(params.get("clientId"));
        if (clientId == null) throw new IllegalArgumentException(LangText.of("请指定客户", "Please specify a client"));
        LawFirmParty client = requireVisibleClient(userId, clientId);
        LocalDate date;
        try {
            String raw = string(params, "date");
            date = raw.isEmpty() ? LocalDate.now() : LocalDate.parse(raw);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException(LangText.of("联系日期格式应为 YYYY-MM-DD", "Contact date must be YYYY-MM-DD"));
        }
        if (date.isAfter(LocalDate.now())) {
            throw new IllegalArgumentException(LangText.of("联系日期不能晚于今天", "Contact date cannot be in the future"));
        }
        String channel = string(params, "channel").toUpperCase();
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("date", date.toString());
        entry.put("channel", CONTACT_CHANNELS.contains(channel) ? channel : "OTHER");
        entry.put("note", trimTo(string(params, "note"), 500));
        entry.put("byUserId", userId);
        entry.put("byName", userNames().get(userId));
        List<Map<String, Object>> log = new ArrayList<>(parseList(client.getContactLogJson()));
        log.add(0, entry);
        log.sort(Comparator.comparing((Map<String, Object> m) -> String.valueOf(m.get("date"))).reversed());
        client.setContactLogJson(toJson(log.subList(0, Math.min(MAX_CONTACT_LOG, log.size()))));
        client.setUpdatedAt(Instant.now());
        partyRepository.save(client);
        return getClient(userId, Map.of("clientId", clientId));
    }

    /** 关系登记时选对方主体：客户（可见范围内）与非客户主体，按名称/信用代码/编号模糊匹配。 */
    Map<String, Object> searchParties(Long userId, Map<String, Object> params) {
        String q = LawFirmConflictEngine.normalizeExact(string(params, "query"));
        boolean firmWide = access.canViewFirmWide(userId);
        Set<Long> visible = new java.util.HashSet<>();
        if (!firmWide) {
            LawFirmPartyGraph g = graph();
            for (LawFirmParty c : loadLedger(userId).visibleClients) {
                visible.add(c.getId());
                visible.addAll(networkOf(g, c.getId()));
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (LawFirmParty p : partyRepository.findAllByOrderByIdAsc()) {
            if (out.size() >= 20) break;
            if (!firmWide && !visible.contains(p.getId())) continue;
            if (!q.isEmpty() && !LawFirmConflictEngine.normalizeExact(p.getName()).contains(q)
                    && !LawFirmConflictEngine.normalizeExact(p.getCreditCode()).contains(q)
                    && !LawFirmConflictEngine.normalizeExact(p.getClientNo()).contains(q)) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", p.getId());
            m.put("name", p.getName());
            m.put("creditCode", p.getCreditCode());
            m.put("client", p.isClientParty());
            m.put("clientNo", p.getClientNo());
            out.add(m);
        }
        return Map.of("parties", out);
    }

    /**
     * 登记/修改一条直接关系。clientId 是当前客户（权限按它核）；subjectPartyId 是关系的这一端，缺省为客户本身，
     * 也可以是客户关系网里的主体（直接关联方、间接股东/子公司），这样在一个客户档案里就能补齐多层股权链。
     * 对方用 partyId 选已有主体，或用 partyName 新建非客户主体（同名/同信用代码的已有主体直接复用）。
     * direction=OUT 表示「这一端 → 对方」，IN 表示「对方 → 这一端」。
     */
    Map<String, Object> saveRelation(Long userId, Map<String, Object> params) {
        Long clientId = longVal(params.get("clientId"));
        if (clientId == null) throw new IllegalArgumentException(LangText.of("请指定客户", "Please specify a client"));
        LawFirmParty client = partyRepository.findById(clientId).filter(LawFirmParty::isClientParty).orElseThrow(LawFirmClientService::notFound);
        requireEditable(userId, client);
        Long subjectId = longVal(params.get("subjectPartyId"));
        if (subjectId == null) subjectId = client.getId();
        if (!subjectId.equals(client.getId()) && !networkOf(graph(), client.getId()).contains(subjectId)) {
            throw new IllegalArgumentException(LangText.of("只能在本客户的关系网内登记关系", "Relationships can only be added within this client's network"));
        }
        LawFirmParty subject = partyRepository.findById(subjectId).orElseThrow(LawFirmClientService::notFound);
        String type = string(params, "relationType").toUpperCase();
        if (!LawFirmPartyGraph.TYPES.contains(type)) {
            throw new IllegalArgumentException(LangText.of("请选择关系类型", "Please choose a relationship type"));
        }
        LawFirmParty other;
        Long otherId = longVal(params.get("partyId"));
        if (otherId != null) {
            other = partyRepository.findById(otherId).orElseThrow(LawFirmClientService::notFound);
            if (other.isClientParty() && !access.canViewFirmWide(userId) && !isVisibleClient(userId, other)) throw notFound();
        } else {
            String name = trimTo(string(params, "partyName"), 256);
            if (name.isEmpty()) throw new IllegalArgumentException(LangText.of("请填写关联主体名称", "Please enter the related party's name"));
            String code = trimTo(string(params, "partyCreditCode"), 128);
            String ptype = string(params, "partyType").toUpperCase();
            other = findOrCreateParty(new ArrayList<>(partyRepository.findAllByOrderByIdAsc()), name, code,
                    Set.of("ORGANIZATION", "INDIVIDUAL").contains(ptype) ? ptype : null, "RELATION", userId);
            if (other.isClientParty() && !access.canViewFirmWide(userId) && !isVisibleClient(userId, other)) {
                throw new IllegalArgumentException(LangText.of("该主体已在本所登记，请联系律所管理员登记这条关系",
                        "This party is already registered by the firm; please ask a firm administrator to record this relationship"));
            }
        }
        if (other.getId().equals(subject.getId())) {
            throw new IllegalArgumentException(LangText.of("不能与自身建立关系", "A party cannot be related to itself"));
        }
        boolean out = !"IN".equalsIgnoreCase(string(params, "direction"));
        Long from = out ? subject.getId() : other.getId();
        Long to = out ? other.getId() : subject.getId();
        Integer shareBps = null;
        if ("SHAREHOLDER".equals(type) && !string(params, "sharePercent").isEmpty()) {
            try {
                BigDecimal pct = new BigDecimal(string(params, "sharePercent"));
                if (pct.signum() <= 0 || pct.compareTo(BigDecimal.valueOf(100)) > 0) throw new NumberFormatException();
                shareBps = pct.movePointRight(2).setScale(0, java.math.RoundingMode.HALF_UP).intValueExact();
            } catch (RuntimeException e) {
                throw new IllegalArgumentException(LangText.of("持股比例应为 0 到 100 之间的数字", "Shareholding must be a number between 0 and 100"));
            }
        }
        LawFirmPartyRelation rel = findRelation(relationRepository.findAllByOrderByIdAsc(), from, to, type);
        if (rel == null) {
            rel = LawFirmPartyRelation.builder().fromPartyId(from).toPartyId(to).relationType(type)
                    .source("MANUAL").createdByUserId(userId).createdAt(Instant.now()).build();
        }
        rel.setShareBps(shareBps);
        rel.setNote(trimTo(string(params, "note"), 256));
        relationRepository.save(rel);
        return getClient(userId, Map.of("clientId", clientId));
    }

    Map<String, Object> deleteRelation(Long userId, Map<String, Object> params) {
        Long relationId = longVal(params.get("relationId"));
        Long clientId = longVal(params.get("clientId"));
        LawFirmPartyRelation rel = relationId == null ? null : relationRepository.findById(relationId).orElse(null);
        Set<Long> network = clientId == null ? Set.of() : networkOf(graph(), clientId);
        if (rel == null || clientId == null || (!clientId.equals(rel.getFromPartyId()) && !clientId.equals(rel.getToPartyId())
                && !(network.contains(rel.getFromPartyId()) && network.contains(rel.getToPartyId())))) {
            throw new IllegalArgumentException(LangText.of("关系不存在", "Relationship not found"));
        }
        LawFirmParty client = partyRepository.findById(clientId).filter(LawFirmParty::isClientParty).orElseThrow(LawFirmClientService::notFound);
        requireEditable(userId, client);
        relationRepository.delete(rel);
        return getClient(userId, Map.of("clientId", clientId));
    }

    /**
     * 把本人可编辑的客户（或全所资格者指定的全部客户）连同其关系网中的主体与关系上传到律所云端。
     * 只在律所管理员开启「客户管理」云端功能后可用（云端会拒绝）；只传客户档案，不传收案、收费、回款与往来记录。
     * 云端按信用代码/全称对上已有主体，返回的对应写回本机 cloudPartyId，可重复上传。
     */
    Map<String, Object> uploadToCloud(Long userId, Map<String, Object> params) {
        LawFirmCloudCaller caller = cloudCaller.getIfAvailable();
        if (caller == null) {
            throw new IllegalArgumentException(LangText.of("律所云端通道尚未就绪", "The law firm cloud channel is not available yet"));
        }
        boolean firmWide = access.canViewFirmWide(userId);
        Set<Long> only = new LinkedHashSet<>();
        if (params.get("clientIds") instanceof List<?> ids) for (Object o : ids) { Long v = longVal(o); if (v != null) only.add(v); }
        List<LawFirmParty> all = partyRepository.findAllByOrderByIdAsc();
        LawFirmPartyGraph g = graph();
        Set<Long> include = new LinkedHashSet<>();
        Set<Long> clientIds = new LinkedHashSet<>();
        for (LawFirmParty c : all) {
            if (!c.isClientParty() || (!only.isEmpty() && !only.contains(c.getId()))) continue;
            if (!canEdit(userId, c, firmWide)) continue;
            clientIds.add(c.getId());
            include.add(c.getId());
            include.addAll(networkOf(g, c.getId()));
        }
        if (clientIds.isEmpty()) {
            throw new IllegalArgumentException(LangText.of("没有可上传的客户：只能上传由你维护、主办或建档的客户", "No clients to upload: you can only upload clients you own, lead or created"));
        }
        List<Map<String, Object>> partyRows = new ArrayList<>();
        for (LawFirmParty x : all) {
            if (!include.contains(x.getId())) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("localId", String.valueOf(x.getId()));
            m.put("client", clientIds.contains(x.getId()));
            m.put("name", x.getName());
            m.put("creditCode", x.getCreditCode());
            m.put("partyType", x.getPartyType());
            if (clientIds.contains(x.getId())) {
                m.put("industry", x.getIndustry());
                m.put("address", x.getAddress());
                m.put("notes", x.getNotes());
                m.put("contacts", parseList(x.getContactsJson()));
            }
            partyRows.add(m);
        }
        List<Map<String, Object>> relRows = new ArrayList<>();
        for (LawFirmPartyRelation r : relationRepository.findAllByOrderByIdAsc()) {
            if (!include.contains(r.getFromPartyId()) || !include.contains(r.getToPartyId())) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("fromLocalId", String.valueOf(r.getFromPartyId()));
            m.put("toLocalId", String.valueOf(r.getToPartyId()));
            m.put("relationType", r.getRelationType());
            if (r.getShareBps() != null) m.put("shareBps", r.getShareBps());
            m.put("note", r.getNote());
            relRows.add(m);
        }
        Map<String, Object> result = caller.call(userId, "clients.import", Map.of("parties", partyRows, "relations", relRows));
        int linked = 0;
        if (result.get("mapping") instanceof Map<?, ?> mapping) {
            for (LawFirmParty x : all) {
                Long cloudId = longVal(mapping.get(String.valueOf(x.getId())));
                if (cloudId != null && !cloudId.equals(x.getCloudPartyId())) {
                    x.setCloudPartyId(cloudId);
                    partyRepository.save(x);
                    linked++;
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("uploadedClients", clientIds.size());
        out.put("uploadedParties", partyRows.size());
        out.put("uploadedRelations", relRows.size());
        out.put("created", result.get("created"));
        out.put("matched", result.get("matched"));
        out.put("linked", linked);
        return out;
    }

    // ---- 视图 ----

    private Map<String, Object> summary(LawFirmParty c, Ledger ledger) {
        List<LawFirmMatterIntake> matters = ledger.intakesByClient.getOrDefault(c.getId(), List.of());
        Set<Long> ids = matters.stream().map(LawFirmMatterIntake::getId).collect(Collectors.toSet());
        int year = LocalDate.now().getYear();
        long contracted = matters.stream().filter(i -> !"REJECTED_CONFLICT".equalsIgnoreCase(i.getStatus()))
                .mapToLong(i -> nz(i.getContractAmountCents())).sum();
        long billed = ledger.invoices.stream()
                .filter(v -> ids.contains(v.getIntakeId()) && !NOT_BILLED.contains(String.valueOf(v.getStatus()).toUpperCase()))
                .mapToLong(v -> nz(v.getAmountCents())).sum();
        List<LawFirmCollection> cols = ledger.collections.stream().filter(col -> ids.contains(ledger.intakeIdOf(col))).toList();
        long collected = cols.stream().mapToLong(col -> nz(col.getAmountCents())).sum();
        long collectedYear = cols.stream().filter(col -> collectionYear(col) == year).mapToLong(col -> nz(col.getAmountCents())).sum();
        long active = matters.stream().filter(i -> ACTIVE_STATUSES.contains(String.valueOf(i.getStatus()))).count();

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.getId());
        m.put("clientNo", c.getClientNo());
        m.put("name", c.getName());
        m.put("creditCode", c.getCreditCode());
        m.put("partyType", c.getPartyType());
        m.put("industry", c.getIndustry());
        m.put("ownerUserId", c.getOwnerUserId());
        m.put("ownerName", firstNonBlank(c.getOwnerName(), c.getOwnerUserId() == null ? null : ledger.names.get(c.getOwnerUserId())));
        m.put("partnerUserId", c.getPartnerUserId());
        m.put("partnerName", firstNonBlank(c.getPartnerName(), c.getPartnerUserId() == null ? null : ledger.names.get(c.getPartnerUserId())));
        m.put("source", c.getSource());
        m.put("matterCount", (long) matters.size());
        m.put("activeMatterCount", active);
        m.put("contractedCents", contracted);
        m.put("billedCents", billed);
        m.put("collectedCents", collected);
        m.put("collectedThisYearCents", collectedYear);
        m.put("arCents", Math.max(0L, billed - collected));
        List<Signal> signals = ledger.signalsFor(c);
        Signal last = signals.isEmpty() ? null : signals.get(0);
        m.put("lastInteractionAt", last == null ? null : last.date.toString());
        m.put("lastInteractionSource", last == null ? null : last.source);
        m.put("lastInteractionProject", last == null ? null : last.projectName);
        m.put("lastInteractionDays", last == null ? null : (int) ChronoUnit.DAYS.between(last.date, LocalDate.now()));
        return m;
    }

    private Map<String, Object> matterView(LawFirmMatterIntake i, Ledger ledger) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", i.getId());
        m.put("intakeNo", i.getIntakeNo());
        m.put("title", i.getTitle());
        m.put("status", i.getStatus());
        m.put("practiceArea", i.getPracticeArea());
        m.put("leadLawyerName", i.getLeadLawyerName());
        m.put("counterpartyName", i.getCounterpartyName());
        m.put("contractAmountCents", nz(i.getContractAmountCents()));
        m.put("conflictRiskLevel", i.getConflictRiskLevel());
        m.put("projectId", i.getProjectId());
        m.put("projectName", i.getProjectId() == null ? null : ledger.projectNames.get(i.getProjectId()));
        m.put("submittedAt", i.getSubmittedAt());
        return m;
    }

    /** 本客户自己收案的利冲结论 + 其他收案命中本客户的记录（只含查看人可见的收案）。 */
    private List<Map<String, Object>> conflictRecords(LawFirmParty client, List<LawFirmMatterIntake> matters, Ledger ledger) {
        Set<Long> matterIds = matters.stream().map(LawFirmMatterIntake::getId).collect(Collectors.toSet());
        List<Map<String, Object>> out = new ArrayList<>();
        for (LawFirmMatterIntake i : matters) {
            out.add(conflictRow("OWN", i, i.getConflictRiskLevel(), i.getConflictSummary(), null, null));
        }
        for (LawFirmMatterIntake i : ledger.visibleIntakes) {
            if (matterIds.contains(i.getId())) continue;
            for (Map<String, Object> hit : parseList(i.getConflictHitsJson())) {
                Long hitClient = longVal(hit.get("matchedClientId"));
                Long hitIntake = longVal(hit.get("matchedIntakeId"));
                if (Objects.equals(hitClient, client.getId()) || (hitIntake != null && matterIds.contains(hitIntake))) {
                    out.add(conflictRow("AGAINST", i, String.valueOf(hit.getOrDefault("riskLevel", i.getConflictRiskLevel())),
                            String.valueOf(hit.getOrDefault("ruleTitle", "")), stringOrNull(hit.get("matchedPartyName")),
                            stringOrNull(hit.get("relationPath"))));
                    break;
                }
            }
        }
        return out;
    }

    private static Map<String, Object> conflictRow(String kind, LawFirmMatterIntake i, String level, String summary, String party, String path) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("intakeId", i.getId());
        m.put("intakeNo", i.getIntakeNo());
        m.put("title", i.getTitle());
        m.put("status", i.getStatus());
        m.put("riskLevel", level);
        m.put("summary", summary);
        m.put("matchedPartyName", party);
        m.put("relationPath", path);
        m.put("submittedAt", i.getSubmittedAt());
        return m;
    }

    // ---- 台账快照 ----

    private Ledger loadLedger(Long userId) {
        Ledger l = new Ledger();
        l.firmWide = access.canViewFirmWide(userId);
        l.users = userRepository.findAll();
        l.names = new HashMap<>();
        for (User u : l.users) l.names.put(u.getId(), firstNonBlank(u.getDisplayName(), u.getUsername()));
        List<LawFirmMatterIntake> intakes = intakeRepository.findAllByOrderByCreatedAtDescIdDesc();
        List<LawFirmParty> clients = partyRepository.findAllByOrderByIdAsc().stream().filter(LawFirmParty::isClientParty).toList();
        Set<Long> mineClientIds = new LinkedHashSet<>();
        for (LawFirmMatterIntake i : intakes) {
            if (i.getClientId() != null && !"REJECTED_CONFLICT".equals(i.getStatus())
                    && (Objects.equals(i.getApplicantUserId(), userId) || Objects.equals(i.getLeadLawyerUserId(), userId))) {
                mineClientIds.add(i.getClientId());
            }
        }
        l.visibleClients = l.firmWide ? clients : clients.stream()
                .filter(c -> mineClientIds.contains(c.getId()) || canEdit(userId, c, false))
                .toList();
        l.visibleIntakes = l.firmWide ? intakes : intakes.stream()
                .filter(i -> Objects.equals(i.getApplicantUserId(), userId) || Objects.equals(i.getLeadLawyerUserId(), userId)
                        || Objects.equals(i.getCommitteeReviewerId(), userId))
                .toList();
        // 客户名下的项目、收费：只要客户可见就按客户整体统计（客户维护人要看到全貌）
        Set<Long> visibleIds = l.visibleClients.stream().map(LawFirmParty::getId).collect(Collectors.toSet());
        l.intakesByClient = intakes.stream().filter(i -> i.getClientId() != null && visibleIds.contains(i.getClientId()))
                .collect(Collectors.groupingBy(LawFirmMatterIntake::getClientId, LinkedHashMap::new, Collectors.toList()));
        l.invoices = invoiceRepository.findAllByOrderByCreatedAtDescIdDesc();
        l.invoiceIntake = l.invoices.stream().filter(v -> v.getIntakeId() != null)
                .collect(Collectors.toMap(LawFirmInvoice::getId, LawFirmInvoice::getIntakeId, (a, b) -> a));
        l.collections = collectionRepository.findAllByOrderByCreatedAtDescIdDesc();

        l.projectNames = new HashMap<>();
        l.projectsByClientName = new HashMap<>();
        for (Project p : projectRepository.findAll()) {
            if (p.isLooseFileWorkspace() || p.isScratchWorkspace()) continue;
            l.projectNames.put(p.getId(), Objects.requireNonNullElse(firstNonBlank(p.getName()), "#" + p.getId()));
            String key = LawFirmConflictEngine.normalizeExact(p.getListedCompanyName());
            // 按名称匹配工作台项目只给全所资格者：其他人可能看不到这些项目
            if (l.firmWide && !key.isEmpty()) l.projectsByClientName.computeIfAbsent(key, k -> new ArrayList<>()).add(p);
        }
        Set<Long> projectIds = new LinkedHashSet<>();
        for (LawFirmParty c : l.visibleClients) projectIds.addAll(l.projectIdsOf(c));
        l.loadSignals(projectIds);
        return l;
    }

    private final class Ledger {
        boolean firmWide;
        Map<Long, String> names;
        List<User> users;
        List<LawFirmParty> visibleClients;
        List<LawFirmMatterIntake> visibleIntakes;
        Map<Long, List<LawFirmMatterIntake>> intakesByClient;
        List<LawFirmInvoice> invoices;
        Map<Long, Long> invoiceIntake;
        List<LawFirmCollection> collections;
        Map<Long, String> projectNames;
        Map<String, List<Project>> projectsByClientName;
        final Map<Long, LocalDate> workLog = new HashMap<>();
        final Map<Long, LocalDate> im = new HashMap<>();
        final Map<Long, LocalDate> meetings = new HashMap<>();

        Long intakeIdOf(LawFirmCollection c) {
            return c.getIntakeId() != null ? c.getIntakeId() : (c.getInvoiceId() == null ? null : invoiceIntake.get(c.getInvoiceId()));
        }

        /** 工作台里未经收案登记、但委托方名称与客户全称一致的项目。 */
        List<Project> nameMatchedProjects(LawFirmParty c) {
            return projectsByClientName.getOrDefault(LawFirmConflictEngine.normalizeExact(c.getName()), List.of());
        }

        Set<Long> projectIdsOf(LawFirmParty c) {
            Set<Long> ids = new LinkedHashSet<>();
            for (LawFirmMatterIntake i : intakesByClient.getOrDefault(c.getId(), List.of())) {
                if (i.getProjectId() != null) ids.add(i.getProjectId());
            }
            for (Project p : nameMatchedProjects(c)) ids.add(p.getId());
            return ids;
        }

        void loadSignals(Collection<Long> projectIds) {
            if (projectIds.isEmpty()) return;
            ZoneId zone = ZoneId.systemDefault();
            for (Object[] row : activityLogRepository.latestTimestampByProjectIds(projectIds)) {
                if (row[0] instanceof Long pid && row[1] instanceof LocalDateTime ts) workLog.put(pid, ts.toLocalDate());
            }
            for (ImConversation conv : imConversationRepository.findByProjectIdIn(projectIds)) {
                if (conv.getProjectId() != null && conv.getLastMessageAt() != null) {
                    im.put(conv.getProjectId(), LocalDate.ofInstant(conv.getLastMessageAt(), zone));
                }
            }
            for (Object[] row : projectTaskRepository.latestMeetingDateByProjectIds(projectIds, LocalDate.now())) {
                if (row[0] instanceof Long pid && row[1] instanceof LocalDate d) meetings.put(pid, d);
            }
        }

        /** 该客户的往来信号，最新在前。 */
        List<Signal> signalsFor(LawFirmParty c) {
            List<Signal> out = new ArrayList<>();
            for (Map<String, Object> e : parseList(c.getContactLogJson())) {
                try {
                    out.add(new Signal("MANUAL", LocalDate.parse(String.valueOf(e.get("date"))), null, null,
                            stringOrNull(e.get("channel")), stringOrNull(e.get("note"))));
                } catch (RuntimeException ignored) {
                    // 坏日期跳过
                }
            }
            ZoneId zone = ZoneId.systemDefault();
            for (LawFirmMatterIntake i : intakesByClient.getOrDefault(c.getId(), List.of())) {
                Instant at = i.getSubmittedAt() != null ? i.getSubmittedAt() : i.getCreatedAt();
                if (at != null) out.add(new Signal("INTAKE", LocalDate.ofInstant(at, zone), i.getProjectId(), i.getTitle(), null, null));
            }
            for (Long pid : projectIdsOf(c)) {
                String pname = projectNames.get(pid);
                if (workLog.containsKey(pid)) out.add(new Signal("WORK_LOG", workLog.get(pid), pid, pname, null, null));
                if (im.containsKey(pid)) out.add(new Signal("IM", im.get(pid), pid, pname, null, null));
                if (meetings.containsKey(pid)) out.add(new Signal("CALENDAR", meetings.get(pid), pid, pname, null, null));
            }
            LocalDate today = LocalDate.now();
            out.removeIf(s -> s.date.isAfter(today));
            // 同一天里收案登记排最后：它只是建档时间，其他来源才说明真有往来
            out.sort(Comparator.comparing((Signal s) -> s.date).reversed()
                    .thenComparing((Signal s) -> "INTAKE".equals(s.source)));
            return out;
        }

        List<Map<String, Object>> userOptions() {
            return users.stream().map(u -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", u.getId());
                m.put("displayName", names.get(u.getId()));
                return m;
            }).toList();
        }
    }

    private record Signal(String source, LocalDate date, Long projectId, String projectName, String channel, String note) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("source", source);
            m.put("date", date.toString());
            m.put("projectId", projectId);
            m.put("projectName", projectName);
            m.put("channel", channel);
            m.put("note", note);
            return m;
        }
    }

    // ---- 主体维护 ----

    /** 收案委托人对应的客户：已有客户直接用；已有非客户主体升为客户；都没有就新建。 */
    private LawFirmParty clientFor(List<LawFirmParty> parties, LawFirmMatterIntake intake) {
        LawFirmParty p = findMatch(parties, intake.getClientName(), intake.getClientCreditCode(), null);
        if (p == null) {
            Instant now = Instant.now();
            p = partyRepository.save(LawFirmParty.builder()
                    .client(true)
                    .clientNo(nextClientNo())
                    .name(trimTo(intake.getClientName(), 256))
                    .creditCode(blank(intake.getClientCreditCode()) ? null : trimTo(intake.getClientCreditCode(), 128))
                    .partyType("ORGANIZATION")
                    .ownerUserId(intake.getLeadLawyerUserId())
                    .ownerName(intake.getLeadLawyerName())
                    .source("INTAKE")
                    .createdByUserId(intake.getApplicantUserId())
                    .createdAt(intake.getCreatedAt() != null ? intake.getCreatedAt() : now)
                    .updatedAt(now)
                    .build());
            parties.add(p);
            return p;
        }
        boolean changed = false;
        if (!p.isClientParty()) {
            promote(p, intake.getApplicantUserId());
            p.setOwnerUserId(intake.getLeadLawyerUserId());
            p.setOwnerName(intake.getLeadLawyerName());
            p.setSource("INTAKE");
            changed = true;
        }
        if (blank(p.getCreditCode()) && !blank(intake.getClientCreditCode())) {
            p.setCreditCode(trimTo(intake.getClientCreditCode(), 128));
            changed = true;
        }
        if (changed) {
            p.setUpdatedAt(Instant.now());
            partyRepository.save(p);
        }
        return p;
    }

    private void promote(LawFirmParty p, Long userId) {
        p.setClient(true);
        if (p.getClientNo() == null) p.setClientNo(nextClientNo());
        // 建档人按升为客户的人算：先前把它登记为别人关联方的律师不因此取得这位客户的查看/编辑权
        p.setCreatedByUserId(userId);
    }

    /** 收案上登记的关联方（控股股东、一致行动人等）转成主体关系，旧数据不丢。 */
    private void importIntakeRelatedParties(LawFirmMatterIntake intake, LawFirmParty client,
                                            List<LawFirmParty> parties, List<LawFirmPartyRelation> relations) {
        for (LawFirmConflictEngine.RelatedParty rp : conflictEngine.parseRelatedParties(intake.getRelatedPartiesJson())) {
            String role = rp.getRole() == null ? "" : rp.getRole().trim().toUpperCase();
            String type = switch (role) {
                case "CONTROLLING_SHAREHOLDER", "SHAREHOLDER" -> "SHAREHOLDER";
                case "ACTUAL_CONTROLLER" -> "ACTUAL_CONTROLLER";
                case "GUARANTOR" -> "GUARANTOR";
                case "CONCERTED_ACTOR" -> "CONCERTED_ACTOR";
                case "AFFILIATE" -> "AFFILIATE";
                default -> "OTHER";
            };
            LawFirmParty other = findOrCreateParty(parties, rp.getName(), rp.getCreditCode(), null, "INTAKE", intake.getApplicantUserId());
            if (other.getId().equals(client.getId())) continue;
            // 股东/担保人指向委托人；其余为无方向关系
            if (findRelation(relations, other.getId(), client.getId(), type) != null) continue;
            relations.add(relationRepository.save(LawFirmPartyRelation.builder()
                    .fromPartyId(other.getId()).toPartyId(client.getId()).relationType(type)
                    .source("INTAKE").createdByUserId(intake.getApplicantUserId()).createdAt(Instant.now()).build()));
        }
    }

    private LawFirmParty findOrCreateParty(List<LawFirmParty> parties, String name, String code, String partyType, String source, Long userId) {
        LawFirmParty p = findMatch(parties, name, code, partyType, null);
        if (p != null) return p;
        Instant now = Instant.now();
        p = partyRepository.save(LawFirmParty.builder()
                .client(false)
                .name(trimTo(name, 256))
                .creditCode(blank(code) ? null : trimTo(code, 128))
                .partyType(partyType)
                .source(source)
                .createdByUserId(userId)
                .createdAt(now)
                .updatedAt(now)
                .build());
        parties.add(p);
        return p;
    }

    private static LawFirmPartyRelation findRelation(List<LawFirmPartyRelation> relations, Long from, Long to, String type) {
        boolean symmetric = LawFirmPartyGraph.SYMMETRIC.contains(type);
        for (LawFirmPartyRelation r : relations) {
            if (!type.equals(r.getRelationType())) continue;
            if (r.getFromPartyId().equals(from) && r.getToPartyId().equals(to)) return r;
            if (symmetric && r.getFromPartyId().equals(to) && r.getToPartyId().equals(from)) return r;
        }
        return null;
    }

    // ---- 工具 ----

    private boolean isVisibleClient(Long userId, LawFirmParty client) {
        if (canEdit(userId, client, false)) return true;
        return intakeRepository.findByApplicantUserIdOrLeadLawyerUserIdOrderByCreatedAtDescIdDesc(userId, userId).stream()
                .anyMatch(i -> client.getId().equals(i.getClientId()) && !"REJECTED_CONFLICT".equals(i.getStatus()));
    }

    private LawFirmParty requireVisibleClient(Long userId, Long clientId) {
        LawFirmParty client = partyRepository.findById(clientId).filter(LawFirmParty::isClientParty).orElseThrow(LawFirmClientService::notFound);
        if (access.canViewFirmWide(userId) || isVisibleClient(userId, client)) return client;
        throw notFound();
    }

    private void requireEditable(Long userId, LawFirmParty client) {
        if (!canEdit(userId, client, access.canViewFirmWide(userId))) {
            throw new IllegalStateException(LangText.of("无权修改这位客户：仅客户维护人、主办合伙人、建档人或律所管理员可以修改",
                    "Not permitted: only the relationship owner, the responsible partner, the creator or a firm administrator can edit this client"));
        }
    }

    private static boolean canEdit(Long userId, LawFirmParty c, boolean firmWide) {
        return firmWide || Objects.equals(c.getOwnerUserId(), userId) || Objects.equals(c.getPartnerUserId(), userId)
                || Objects.equals(c.getCreatedByUserId(), userId);
    }

    private static IllegalArgumentException notFound() {
        return new IllegalArgumentException(LangText.of("客户不存在或无权查看", "Client not found or not visible to you"));
    }

    /** 同一主体：信用代码一致；或规范化全称一致且两边信用代码不冲突。 */
    static LawFirmParty findMatch(List<LawFirmParty> parties, String name, String code, Long excludeId) {
        return findMatch(parties, name, code, null, excludeId);
    }

    /** 同上；任何一边是自然人时不按姓名合并（同名不同人），只认证件号/信用代码。 */
    static LawFirmParty findMatch(List<LawFirmParty> parties, String name, String code, String partyType, Long excludeId) {
        boolean queryIndividual = "INDIVIDUAL".equals(partyType);
        String n = LawFirmConflictEngine.normalizeExact(name);
        String k = LawFirmConflictEngine.normalizeExact(code);
        LawFirmParty byName = null;
        for (LawFirmParty p : parties) {
            if (excludeId != null && excludeId.equals(p.getId())) continue;
            String pk = LawFirmConflictEngine.normalizeExact(p.getCreditCode());
            if (!k.isEmpty() && k.equals(pk)) return p;
            if (byName == null && !queryIndividual && !"INDIVIDUAL".equals(p.getPartyType())
                    && !n.isEmpty() && n.equals(LawFirmConflictEngine.normalizeExact(p.getName()))
                    && (k.isEmpty() || pk.isEmpty())) {
                byName = p;
            }
        }
        return byName;
    }

    private String nextClientNo() {
        String prefix = "KH-" + LocalDate.now().getYear() + "-";
        long n = partyRepository.countByClientTrue() + 1;
        String no = prefix + String.format("%04d", n);
        while (partyRepository.existsByClientNo(no)) {
            no = prefix + String.format("%04d", ++n);
        }
        return no;
    }

    private static int collectionYear(LawFirmCollection c) {
        String d = c.getReceivedDate();
        if (d != null && d.matches("^\\d{4}-.*")) return Integer.parseInt(d.substring(0, 4));
        return c.getCreatedAt() == null ? -1 : LocalDate.ofInstant(c.getCreatedAt(), ZoneId.systemDefault()).getYear();
    }

    private static List<Map<String, Object>> cleanContacts(Object raw) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!(raw instanceof List<?> list)) return out;
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> m) || out.size() >= MAX_LIST) continue;
            Map<String, Object> e = new LinkedHashMap<>();
            for (String f : List.of("name", "title", "phone", "email")) {
                e.put(f, trimTo(m.get(f) == null ? "" : String.valueOf(m.get(f)), 128));
            }
            if (!String.valueOf(e.get("name")).isEmpty()) out.add(e);
        }
        return out;
    }

    private Map<Long, String> userNames() {
        Map<Long, String> m = new HashMap<>();
        for (User u : userRepository.findAll()) m.put(u.getId(), firstNonBlank(u.getDisplayName(), u.getUsername()));
        return m;
    }

    private List<Map<String, Object>> parseList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            List<Map<String, Object>> list = objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
            return list == null ? List.of() : list;
        } catch (Exception e) {
            return List.of();
        }
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return "[]";
        }
    }

    private static long nz(Long v) {
        return v == null ? 0L : v;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static String trimTo(String s, int max) {
        String t = s == null ? "" : s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static String string(Map<String, Object> params, String key) {
        Object v = params.get(key);
        return v == null ? "" : String.valueOf(v).trim();
    }

    private static String stringOrNull(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    static Long longVal(Object v) {
        if (v instanceof Number n) return n.longValue();
        if (v instanceof String s && s.trim().matches("\\d{1,18}")) return Long.parseLong(s.trim());
        return null;
    }

    private static Integer intVal(Object v) {
        Long l = longVal(v);
        return l == null ? null : (int) Math.min(Integer.MAX_VALUE, l);
    }

    private static String firstNonBlank(String... vals) {
        for (String v : vals) {
            if (v != null && !v.isBlank()) return v.trim();
        }
        return null;
    }
}
