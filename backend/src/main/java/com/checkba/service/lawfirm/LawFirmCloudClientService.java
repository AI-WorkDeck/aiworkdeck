// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmCloudParty;
import com.checkba.model.entity.lawfirm.LawFirmCloudRelation;
import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import com.checkba.repository.lawfirm.LawFirmCloudPartyRepository;
import com.checkba.repository.lawfirm.LawFirmCloudRelationRepository;
import com.checkba.service.LangText;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 客户管理的律所云端部分（服务器端，按律所隔离）。由律所云端通道分派 {@code clients.*} 动作进来；
 * 调用方已按账户名录确认律所成员身份、且律所管理员已开启「客户管理」云端功能。
 *
 * <p>谁能看什么（默认）：
 * <ul>
 *   <li>律所管理员（名录 firmAdmin，即管理角色）：全部客户，可编辑；</li>
 *   <li>客户维护人、主办合伙人：该客户的完整档案（联系人、备注、关系网），可编辑；</li>
 *   <li>其他律师：只看到客户名称、编号、维护人与主办合伙人——知道「这是本所客户、该找谁」，看不到客户材料。</li>
 * </ul>
 * 并发编辑：每条记录带版本号，修改须带上读取时的版本，版本不符即拒绝，不做合并。
 * 云端利冲：{@link #graphForFirm} 把全所主体与关系交给利冲引擎（云端提交时由 {@link LawFirmWorkflowService} 调用），
 * 他人案件名称仍按既有规则只给相关律师本人。
 */
@Service
@RequiredArgsConstructor
public class LawFirmCloudClientService {
    public static final String FEATURE = "clients";
    public static final Set<String> ACTIONS = Set.of(
            "clients.list", "clients.get", "clients.save", "clients.saveRelation", "clients.deleteRelation",
            "clients.searchParties", "clients.import", "clients.conflictSearch");
    static final String STALE = "该记录已被同事修改，请刷新后再改";
    private static final int MAX_IMPORT = 2000;

    private final LawFirmAuthority authority;
    private final LawFirmCloudPartyRepository parties;
    private final LawFirmCloudRelationRepository relations;
    private final LawFirmConflictEngine engine;
    private final ObjectMapper mapper;
    private final org.springframework.beans.factory.ObjectProvider<LawFirmCloudClientsSwitch> clientsSwitch;

    /** 本所是否已开启「客户管理」云端功能；开关实现缺席时视为未开启。 */
    public boolean enabledFor(String firmId) {
        LawFirmCloudClientsSwitch s = clientsSwitch.getIfAvailable();
        return firmId != null && s != null && s.enabled(firmId);
    }

    public Map<String, Object> execute(LawFirmAuthority.Member me, String action, Map<String, Object> raw) {
        Map<String, Object> p = raw == null ? Map.of() : raw;
        Ctx ctx = new Ctx(me);
        return switch (action) {
            case "clients.list" -> list(ctx, p);
            case "clients.get" -> Map.of("client", profile(ctx, requireClient(ctx, longVal(p.get("partyId")))));
            case "clients.save" -> save(ctx, p);
            case "clients.saveRelation" -> saveRelation(ctx, p);
            case "clients.deleteRelation" -> deleteRelation(ctx, p);
            case "clients.searchParties" -> searchParties(ctx, p);
            case "clients.import" -> importLedger(ctx, p);
            case "clients.conflictSearch" -> conflictSearch(ctx, p);
            default -> throw new IllegalArgumentException(LangText.of("不支持的客户云端操作", "Unsupported client cloud action"));
        };
    }

    /** 全所主体关系图（云端利冲用，不按查看人裁剪）；征询对象为客户维护人，没有则主办合伙人。 */
    public LawFirmPartyGraph graphForFirm(String firmId) {
        List<LawFirmPartyGraph.Node> nodes = parties.findByFirmIdOrderByIdAsc(firmId).stream()
                .map(x -> new LawFirmPartyGraph.Node(x.getId(), x.getName(), x.getCreditCode(), x.isClient(), x.getClientNo(),
                        x.getOwnerUserId() != null ? x.getOwnerUserId() : x.getPartnerUserId(), null))
                .toList();
        List<LawFirmPartyGraph.Edge> edges = relations.findByFirmIdOrderByIdAsc(firmId).stream()
                .map(r -> new LawFirmPartyGraph.Edge(r.getId(), r.getFromPartyId(), r.getToPartyId(), r.getRelationType(), r.getShareBps(), r.getNote()))
                .toList();
        return new LawFirmPartyGraph(nodes, edges);
    }

    // ---- 动作 ----

    private Map<String, Object> list(Ctx ctx, Map<String, Object> p) {
        String q = LawFirmConflictEngine.normalizeExact(string(p, "query"));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (LawFirmCloudParty c : ctx.all()) {
            if (!c.isClient()) continue;
            if (!q.isEmpty() && !LawFirmConflictEngine.normalizeExact(c.getName()).contains(q)
                    && !LawFirmConflictEngine.normalizeExact(c.getClientNo()).contains(q)) continue;
            rows.add(summary(ctx, c));
        }
        return Map.of("clients", rows, "self", Map.of("userId", ctx.me.userId(), "firmAdmin", ctx.me.firmAdmin()));
    }

    private Map<String, Object> save(Ctx ctx, Map<String, Object> p) {
        Long id = longVal(p.get("partyId"));
        String name = trimTo(string(p, "name"), 256);
        if (name.isEmpty()) throw new IllegalArgumentException(LangText.of("请填写客户名称", "Please enter the client name"));
        String code = trimTo(string(p, "creditCode"), 128);
        String type = string(p, "partyType").toUpperCase();
        type = Set.of("ORGANIZATION", "INDIVIDUAL").contains(type) ? type : "ORGANIZATION";
        LawFirmCloudParty c;
        LawFirmCloudParty dup = findMatch(ctx.all(), name, code, type, id);
        Instant now = Instant.now();
        if (id == null) {
            if (dup != null && dup.isClient()) {
                throw new IllegalArgumentException(LangText.of("律所云端已有这位客户：", "This client already exists in the firm cloud: ")
                        + dup.getName() + "（" + dup.getClientNo() + "）");
            }
            c = dup != null ? dup : new LawFirmCloudParty();
            if (dup == null) {
                c.setFirmId(ctx.me.firmId());
                c.setCreatedBy(ctx.me.userId());
                c.setCreatedAt(now);
            }
            c.setClient(true);
            c.setClientNo(nextClientNo(ctx.me.firmId()));
            if (p.get("ownerUserId") == null) c.setOwnerUserId(ctx.me.userId());
        } else {
            c = requireClient(ctx, id);
            if (!canEdit(ctx.me, c)) throw LawFirmAuthority.denied();
            requireVersion(p, c.getVersion());
            if (dup != null) {
                throw new IllegalArgumentException(LangText.of("律所云端已有同名或同一信用代码的主体：", "A party with the same name or credit code already exists in the firm cloud: ") + dup.getName());
            }
        }
        c.setName(name);
        c.setCreditCode(code.isEmpty() ? null : code);
        c.setPartyType(type);
        c.setIndustry(trimTo(string(p, "industry"), 128));
        c.setAddress(trimTo(string(p, "address"), 512));
        c.setNotes(trimTo(string(p, "notes"), 4000));
        c.setContactsJson(toJson(cleanContacts(p.get("contacts"))));
        if (p.containsKey("ownerUserId")) c.setOwnerUserId(member(ctx, longVal(p.get("ownerUserId"))));
        if (p.containsKey("partnerUserId")) c.setPartnerUserId(member(ctx, longVal(p.get("partnerUserId"))));
        // 新客户总要有人维护：没指定维护人就是建档人
        if (id == null && c.getOwnerUserId() == null) c.setOwnerUserId(ctx.me.userId());
        c.setUpdatedAt(now);
        c = parties.saveAndFlush(c);
        ctx.invalidate();
        return Map.of("client", profile(ctx, c));
    }

    private Map<String, Object> saveRelation(Ctx ctx, Map<String, Object> p) {
        LawFirmCloudParty client = requireClient(ctx, longVal(p.get("clientId")));
        if (!canEdit(ctx.me, client)) throw LawFirmAuthority.denied();
        String type = string(p, "relationType").toUpperCase();
        if (!LawFirmPartyGraph.TYPES.contains(type)) {
            throw new IllegalArgumentException(LangText.of("请选择关系类型", "Please choose a relationship type"));
        }
        LawFirmPartyGraph g = graphForFirm(ctx.me.firmId());
        Long subjectId = longVal(p.get("subjectPartyId"));
        if (subjectId == null) subjectId = client.getId();
        if (!subjectId.equals(client.getId()) && !networkOf(g, client.getId()).contains(subjectId)) {
            throw new IllegalArgumentException(LangText.of("只能在本客户的关系网内登记关系", "Relationships can only be added within this client's network"));
        }
        LawFirmCloudParty other;
        Long otherId = longVal(p.get("partyId"));
        if (otherId != null) {
            other = ctx.byId(otherId);
            if (other == null) throw notFound();
        } else {
            String name = trimTo(string(p, "partyName"), 256);
            if (name.isEmpty()) throw new IllegalArgumentException(LangText.of("请填写关联主体名称", "Please enter the related party's name"));
            String ptype = string(p, "partyType").toUpperCase();
            other = findOrCreate(ctx, name, string(p, "partyCreditCode"), Set.of("ORGANIZATION", "INDIVIDUAL").contains(ptype) ? ptype : null);
        }
        if (other.getId().equals(subjectId)) {
            throw new IllegalArgumentException(LangText.of("不能与自身建立关系", "A party cannot be related to itself"));
        }
        boolean out = !"IN".equalsIgnoreCase(string(p, "direction"));
        Long from = out ? subjectId : other.getId();
        Long to = out ? other.getId() : subjectId;
        LawFirmCloudRelation rel = findRelation(relations.findByFirmIdOrderByIdAsc(ctx.me.firmId()), from, to, type);
        if (rel == null) {
            rel = new LawFirmCloudRelation();
            rel.setFirmId(ctx.me.firmId());
            rel.setFromPartyId(from);
            rel.setToPartyId(to);
            rel.setRelationType(type);
            rel.setCreatedBy(ctx.me.userId());
            rel.setCreatedAt(Instant.now());
        } else if (p.containsKey("expectedVersion")) {
            requireVersion(p, rel.getVersion());
        }
        rel.setShareBps("SHAREHOLDER".equals(type) ? shareBps(string(p, "sharePercent")) : null);
        rel.setNote(trimTo(string(p, "note"), 256));
        relations.saveAndFlush(rel);
        ctx.invalidate();
        return Map.of("client", profile(ctx, client));
    }

    private Map<String, Object> deleteRelation(Ctx ctx, Map<String, Object> p) {
        LawFirmCloudParty client = requireClient(ctx, longVal(p.get("clientId")));
        if (!canEdit(ctx.me, client)) throw LawFirmAuthority.denied();
        Long relId = longVal(p.get("relationId"));
        LawFirmCloudRelation rel = relId == null ? null : relations.findById(relId).orElse(null);
        Set<Long> net = networkOf(graphForFirm(ctx.me.firmId()), client.getId());
        net.add(client.getId());
        if (rel == null || !ctx.me.firmId().equals(rel.getFirmId())
                || !net.contains(rel.getFromPartyId()) || !net.contains(rel.getToPartyId())) {
            throw new IllegalArgumentException(LangText.of("关系不存在", "Relationship not found"));
        }
        requireVersion(p, rel.getVersion());
        relations.delete(rel);
        relations.flush();
        ctx.invalidate();
        return Map.of("client", profile(ctx, client));
    }

    /** 选关联主体：管理员看全所；其他人看全部客户名称与自己可见客户关系网中的非客户主体。 */
    private Map<String, Object> searchParties(Ctx ctx, Map<String, Object> p) {
        String q = LawFirmConflictEngine.normalizeExact(string(p, "query"));
        Set<Long> visibleNonClients = new java.util.HashSet<>();
        if (!ctx.me.firmAdmin()) {
            LawFirmPartyGraph g = graphForFirm(ctx.me.firmId());
            for (LawFirmCloudParty c : ctx.all()) if (c.isClient() && canView(ctx.me, c)) visibleNonClients.addAll(networkOf(g, c.getId()));
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (LawFirmCloudParty x : ctx.all()) {
            if (out.size() >= 20) break;
            if (!x.isClient() && !ctx.me.firmAdmin() && !visibleNonClients.contains(x.getId())) continue;
            if (!q.isEmpty() && !LawFirmConflictEngine.normalizeExact(x.getName()).contains(q)
                    && !LawFirmConflictEngine.normalizeExact(x.getClientNo()).contains(q)) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", x.getId());
            m.put("name", x.getName());
            m.put("client", x.isClient());
            m.put("clientNo", x.getClientNo());
            out.add(m);
        }
        return Map.of("parties", out);
    }

    /**
     * 本机台账上传（由客户维护人在桌面端主动发起）。按信用代码或规范化全称（自然人只认证件号）与云端已有主体对上；
     * 对上的云端客户不改其档案与归属，只补关系；新客户的维护人为上传者。返回本机 id → 云端 id 的对应，可重复上传。
     */
    private Map<String, Object> importLedger(Ctx ctx, Map<String, Object> p) {
        List<?> rawParties = p.get("parties") instanceof List<?> l ? l : List.of();
        List<?> rawRelations = p.get("relations") instanceof List<?> l ? l : List.of();
        if (rawParties.size() > MAX_IMPORT || rawRelations.size() > MAX_IMPORT) {
            throw new IllegalArgumentException(LangText.of("一次上传的主体或关系过多，请分批上传", "Too many parties or relationships in one upload; please upload in batches"));
        }
        Map<String, Long> mapping = new LinkedHashMap<>();
        int created = 0, matched = 0, relCreated = 0;
        Instant now = Instant.now();
        for (Object o : rawParties) {
            if (!(o instanceof Map<?, ?> m)) continue;
            String localId = String.valueOf(m.get("localId"));
            String name = trimTo(m.get("name") == null ? "" : String.valueOf(m.get("name")), 256);
            if (name.isEmpty() || localId.isBlank()) continue;
            String code = trimTo(m.get("creditCode") == null ? "" : String.valueOf(m.get("creditCode")), 128);
            String type = m.get("partyType") == null ? null : String.valueOf(m.get("partyType")).toUpperCase();
            if (type != null && !Set.of("ORGANIZATION", "INDIVIDUAL").contains(type)) type = null;
            boolean isClient = Boolean.TRUE.equals(m.get("client"));
            String importKey = trimTo(ctx.me.userId() + ":" + localId, 64);
            LawFirmCloudParty x = null;
            for (LawFirmCloudParty e : ctx.all()) if (importKey.equals(e.getImportKey())) { x = e; break; }
            if (x == null) x = findMatch(ctx.all(), name, code, type, null);
            if (x == null) {
                x = new LawFirmCloudParty();
                x.setFirmId(ctx.me.firmId());
                x.setName(name);
                x.setCreditCode(code.isEmpty() ? null : code);
                x.setPartyType(type);
                x.setImportKey(importKey);
                x.setCreatedBy(ctx.me.userId());
                x.setCreatedAt(now);
                x.setUpdatedAt(now);
                if (isClient) {
                    x.setClient(true);
                    x.setClientNo(nextClientNo(ctx.me.firmId()));
                    x.setOwnerUserId(ctx.me.userId());
                    x.setIndustry(trimTo(m.get("industry") == null ? "" : String.valueOf(m.get("industry")), 128));
                    x.setAddress(trimTo(m.get("address") == null ? "" : String.valueOf(m.get("address")), 512));
                    x.setNotes(trimTo(m.get("notes") == null ? "" : String.valueOf(m.get("notes")), 4000));
                    x.setContactsJson(toJson(cleanContacts(m.get("contacts"))));
                }
                x = parties.saveAndFlush(x);
                ctx.invalidate();
                created++;
            } else {
                if (isClient && !x.isClient()) {
                    // 云端只作为别人客户的关联方登记过：升为客户，维护人为上传者
                    x.setClient(true);
                    x.setClientNo(nextClientNo(ctx.me.firmId()));
                    x.setOwnerUserId(ctx.me.userId());
                    x.setUpdatedAt(now);
                    parties.saveAndFlush(x);
                    ctx.invalidate();
                }
                matched++;
            }
            mapping.put(localId, x.getId());
        }
        List<LawFirmCloudRelation> existing = new ArrayList<>(relations.findByFirmIdOrderByIdAsc(ctx.me.firmId()));
        for (Object o : rawRelations) {
            if (!(o instanceof Map<?, ?> m)) continue;
            Long from = mapping.get(String.valueOf(m.get("fromLocalId")));
            Long to = mapping.get(String.valueOf(m.get("toLocalId")));
            String type = m.get("relationType") == null ? "" : String.valueOf(m.get("relationType")).toUpperCase();
            if (from == null || to == null || from.equals(to) || !LawFirmPartyGraph.TYPES.contains(type)) continue;
            if (findRelation(existing, from, to, type) != null) continue;
            LawFirmCloudRelation r = new LawFirmCloudRelation();
            r.setFirmId(ctx.me.firmId());
            r.setFromPartyId(from);
            r.setToPartyId(to);
            r.setRelationType(type);
            if ("SHAREHOLDER".equals(type) && m.get("shareBps") instanceof Number n && n.intValue() > 0 && n.intValue() <= 10000) {
                r.setShareBps(n.intValue());
            }
            r.setNote(trimTo(m.get("note") == null ? "" : String.valueOf(m.get("note")), 256));
            r.setCreatedBy(ctx.me.userId());
            r.setCreatedAt(now);
            existing.add(relations.saveAndFlush(r));
            relCreated++;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("mapping", mapping);
        out.put("created", created);
        out.put("matched", matched);
        out.put("relationsCreated", relCreated);
        return out;
    }

    /**
     * 收案前的云端主体预检：只按全所主体与关系检索（Y5/Y6/Y7 中与主体有关的部分），命中只指向客户档案，
     * 不涉及任何案件名称。正式提交仍走云端利冲协作，案件名称按既有规则只给相关律师。
     */
    private Map<String, Object> conflictSearch(Ctx ctx, Map<String, Object> p) {
        LawFirmMatterIntake draft = LawFirmMatterIntake.builder()
                .clientId(longVal(p.get("clientPartyId")))
                .clientName(trimTo(string(p, "clientName"), 256))
                .clientCreditCode(trimTo(string(p, "clientCreditCode"), 128))
                .counterpartyName(trimTo(string(p, "counterpartyName"), 256))
                .counterpartyCreditCode(trimTo(string(p, "counterpartyCreditCode"), 128))
                .relatedPartiesJson("[]")
                .build();
        if ((draft.getClientName() == null || draft.getClientName().isEmpty()) && draft.getCounterpartyName().isEmpty()) {
            throw new IllegalArgumentException(LangText.of("请至少填写委托人或对方当事人名称", "Please enter at least the client or the opposing party"));
        }
        var result = engine.evaluateConflict(draft, List.of(), List.of(), Map.of(), graphForFirm(ctx.me.firmId()));
        List<Map<String, Object>> hits = new ArrayList<>();
        for (var h : result.getHits()) {
            LawFirmCloudParty c = h.getMatchedClientId() == null ? null : ctx.byId(h.getMatchedClientId());
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("ruleCode", h.getRuleCode());
            m.put("riskLevel", h.getRiskLevel());
            m.put("ruleTitle", h.getRuleTitle());
            m.put("clientId", h.getMatchedClientId());
            m.put("clientName", c == null ? h.getMatchedPartyName() : c.getName());
            m.put("clientNo", c == null ? null : c.getClientNo());
            m.put("relationPath", h.getRelationPath());
            m.put("ownerName", c == null ? null : ctx.name(c.getOwnerUserId() != null ? c.getOwnerUserId() : c.getPartnerUserId()));
            m.put("statutoryCitation", h.getStatutoryCitation());
            hits.add(m);
        }
        return Map.of("riskLevel", result.getRiskLevel(), "hits", hits);
    }

    // ---- 视图 ----

    private Map<String, Object> summary(Ctx ctx, LawFirmCloudParty c) {
        boolean full = canView(ctx.me, c);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.getId());
        m.put("clientNo", c.getClientNo());
        m.put("name", c.getName());
        m.put("ownerUserId", c.getOwnerUserId());
        m.put("ownerName", ctx.name(c.getOwnerUserId()));
        m.put("partnerUserId", c.getPartnerUserId());
        m.put("partnerName", ctx.name(c.getPartnerUserId()));
        m.put("restricted", !full);
        m.put("canEdit", canEdit(ctx.me, c));
        m.put("version", c.getVersion());
        if (full) {
            m.put("creditCode", c.getCreditCode());
            m.put("partyType", c.getPartyType());
            m.put("industry", c.getIndustry());
        }
        return m;
    }

    private Map<String, Object> profile(Ctx ctx, LawFirmCloudParty c) {
        Map<String, Object> m = summary(ctx, c);
        if (!canView(ctx.me, c)) return m;
        m.put("address", c.getAddress());
        m.put("notes", c.getNotes());
        m.put("contacts", parseList(c.getContactsJson()));
        LawFirmPartyGraph g = graphForFirm(ctx.me.firmId());
        Set<Long> net = networkOf(g, c.getId());
        List<Map<String, Object>> rels = new ArrayList<>();
        Set<Long> seen = new java.util.HashSet<>();
        List<LawFirmPartyGraph.Edge> edges = new ArrayList<>(g.edgesOf(c.getId()));
        for (Long pid : net) for (LawFirmPartyGraph.Edge e : g.edgesOf(pid)) {
            if (net.contains(e.from().equals(pid) ? e.to() : e.from())) edges.add(e);
        }
        Map<Long, Long> relVersions = new HashMap<>();
        for (LawFirmCloudRelation r : relations.findByFirmIdOrderByIdAsc(ctx.me.firmId())) relVersions.put(r.getId(), r.getVersion());
        for (LawFirmPartyGraph.Edge e : edges) {
            if (!seen.add(e.id())) continue;
            boolean touches = e.from().equals(c.getId()) || e.to().equals(c.getId());
            boolean out = e.from().equals(c.getId());
            LawFirmPartyGraph.Node other = g.node(touches ? (out ? e.to() : e.from()) : e.from());
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", e.id());
            r.put("version", relVersions.get(e.id()));
            r.put("relationType", e.type());
            r.put("direction", !touches ? "NETWORK" : LawFirmPartyGraph.SYMMETRIC.contains(e.type()) ? "BOTH" : (out ? "OUT" : "IN"));
            r.put("partyId", other.id());
            r.put("partyName", other.name());
            r.put("partyIsClient", other.client());
            r.put("shareBps", e.shareBps());
            r.put("description", g.describe(e));
            rels.add(r);
        }
        m.put("relations", rels);
        List<Map<String, Object>> network = new ArrayList<>();
        for (Long pid : net) network.add(Map.of("id", pid, "name", g.node(pid).name(), "client", g.node(pid).client()));
        m.put("network", network);
        m.put("indirectShareholders", chain(g, g.equityChain(c.getId(), true, LawFirmPartyGraph.CHAIN_DEPTH)));
        m.put("indirectSubsidiaries", chain(g, g.equityChain(c.getId(), false, LawFirmPartyGraph.CHAIN_DEPTH)));
        return m;
    }

    private static List<Map<String, Object>> chain(LawFirmPartyGraph g, List<LawFirmPartyGraph.Reach> reach) {
        return reach.stream().filter(r -> r.depth() > 1).map(r -> {
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

    // ---- 权限与工具 ----

    static boolean canView(LawFirmAuthority.Member me, LawFirmCloudParty c) {
        return me.firmAdmin() || Objects.equals(c.getOwnerUserId(), me.userId()) || Objects.equals(c.getPartnerUserId(), me.userId());
    }

    static boolean canEdit(LawFirmAuthority.Member me, LawFirmCloudParty c) {
        return canView(me, c);
    }

    private LawFirmCloudParty requireClient(Ctx ctx, Long id) {
        LawFirmCloudParty c = id == null ? null : ctx.byId(id);
        if (c == null || !c.isClient()) throw notFound();
        return c;
    }

    /** 维护人/主办合伙人必须是同所成员（按账户名录核）；null 表示清空。 */
    private Long member(Ctx ctx, Long userId) {
        if (userId == null) return null;
        authority.requireMember(ctx.me.userId(), userId);
        return userId;
    }

    static void requireVersion(Map<String, Object> p, long current) {
        if (!(p.get("expectedVersion") instanceof Number v) || v.longValue() != current) {
            throw new IllegalStateException(LangText.of(STALE, "This record was changed by a colleague; please refresh and try again"));
        }
    }

    private LawFirmCloudParty findOrCreate(Ctx ctx, String name, String code, String type) {
        LawFirmCloudParty x = findMatch(ctx.all(), name, code, type, null);
        if (x != null) return x;
        x = new LawFirmCloudParty();
        x.setFirmId(ctx.me.firmId());
        x.setName(trimTo(name, 256));
        String c = trimTo(code, 128);
        x.setCreditCode(c.isEmpty() ? null : c);
        x.setPartyType(type);
        x.setCreatedBy(ctx.me.userId());
        x.setCreatedAt(Instant.now());
        x.setUpdatedAt(x.getCreatedAt());
        x = parties.saveAndFlush(x);
        ctx.invalidate();
        return x;
    }

    /** 与本机 {@link LawFirmClientService#findMatch} 同一规则：信用代码一致；或全称一致且信用代码不冲突，自然人不按姓名合并。 */
    static LawFirmCloudParty findMatch(List<LawFirmCloudParty> all, String name, String code, String type, Long excludeId) {
        String n = LawFirmConflictEngine.normalizeExact(name);
        String k = LawFirmConflictEngine.normalizeExact(code);
        boolean individual = "INDIVIDUAL".equals(type);
        LawFirmCloudParty byName = null;
        for (LawFirmCloudParty x : all) {
            if (excludeId != null && excludeId.equals(x.getId())) continue;
            String xk = LawFirmConflictEngine.normalizeExact(x.getCreditCode());
            if (!k.isEmpty() && k.equals(xk)) return x;
            if (byName == null && !individual && !"INDIVIDUAL".equals(x.getPartyType()) && !n.isEmpty()
                    && n.equals(LawFirmConflictEngine.normalizeExact(x.getName())) && (k.isEmpty() || xk.isEmpty())) {
                byName = x;
            }
        }
        return byName;
    }

    private static LawFirmCloudRelation findRelation(List<LawFirmCloudRelation> all, Long from, Long to, String type) {
        boolean sym = LawFirmPartyGraph.SYMMETRIC.contains(type);
        for (LawFirmCloudRelation r : all) {
            if (!type.equals(r.getRelationType())) continue;
            if (r.getFromPartyId().equals(from) && r.getToPartyId().equals(to)) return r;
            if (sym && r.getFromPartyId().equals(to) && r.getToPartyId().equals(from)) return r;
        }
        return null;
    }

    static Set<Long> networkOf(LawFirmPartyGraph g, Long clientId) {
        Set<Long> ids = new LinkedHashSet<>();
        for (LawFirmPartyGraph.Edge e : g.edgesOf(clientId)) ids.add(e.from().equals(clientId) ? e.to() : e.from());
        for (LawFirmPartyGraph.Reach r : g.equityChain(clientId, true, LawFirmPartyGraph.CHAIN_DEPTH)) ids.add(r.node().id());
        for (LawFirmPartyGraph.Reach r : g.equityChain(clientId, false, LawFirmPartyGraph.CHAIN_DEPTH)) ids.add(r.node().id());
        ids.remove(clientId);
        return ids;
    }

    private String nextClientNo(String firmId) {
        String prefix = "KH-" + LocalDate.now().getYear() + "-";
        Set<String> used = new java.util.HashSet<>();
        for (LawFirmCloudParty x : parties.findByFirmIdOrderByIdAsc(firmId)) if (x.getClientNo() != null) used.add(x.getClientNo());
        long n = parties.countByFirmIdAndClientTrue(firmId) + 1;
        String no = prefix + String.format("%04d", n);
        while (used.contains(no)) no = prefix + String.format("%04d", ++n);
        return no;
    }

    private static Integer shareBps(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            BigDecimal pct = new BigDecimal(raw.trim());
            if (pct.signum() <= 0 || pct.compareTo(BigDecimal.valueOf(100)) > 0) throw new NumberFormatException();
            return pct.movePointRight(2).setScale(0, RoundingMode.HALF_UP).intValueExact();
        } catch (RuntimeException e) {
            throw new IllegalArgumentException(LangText.of("持股比例应为 0 到 100 之间的数字", "Shareholding must be a number between 0 and 100"));
        }
    }

    private static List<Map<String, Object>> cleanContacts(Object raw) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!(raw instanceof List<?> list)) return out;
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> m) || out.size() >= 30) continue;
            Map<String, Object> e = new LinkedHashMap<>();
            for (String f : List.of("name", "title", "phone", "email")) e.put(f, trimTo(m.get(f) == null ? "" : String.valueOf(m.get(f)), 128));
            if (!String.valueOf(e.get("name")).isEmpty()) out.add(e);
        }
        return out;
    }

    private List<Map<String, Object>> parseList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return mapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private String toJson(Object v) {
        try {
            return mapper.writeValueAsString(v);
        } catch (Exception e) {
            return "[]";
        }
    }

    private static IllegalArgumentException notFound() {
        return new IllegalArgumentException(LangText.of("客户不存在", "Client not found"));
    }

    private static String string(Map<String, Object> p, String k) {
        Object v = p.get(k);
        return v == null ? "" : String.valueOf(v).trim();
    }

    private static String trimTo(String s, int max) {
        String t = s == null ? "" : s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static Long longVal(Object v) {
        if (v instanceof Number n) return n.longValue();
        if (v instanceof String s && s.trim().matches("\\d{1,18}")) return Long.parseLong(s.trim());
        return null;
    }

    /** 单次请求的快照：本所全部主体（写后失效）与同事姓名（按名录核，查不到就不显示）。 */
    private final class Ctx {
        final LawFirmAuthority.Member me;
        private List<LawFirmCloudParty> all;
        private final Map<Long, String> names = new HashMap<>();

        Ctx(LawFirmAuthority.Member me) {
            this.me = me;
        }

        List<LawFirmCloudParty> all() {
            if (all == null) all = parties.findByFirmIdOrderByIdAsc(me.firmId());
            return all;
        }

        LawFirmCloudParty byId(Long id) {
            for (LawFirmCloudParty x : all()) if (x.getId().equals(id)) return x;
            return null;
        }

        void invalidate() {
            all = null;
        }

        String name(Long userId) {
            if (userId == null) return null;
            if (userId.equals(me.userId())) return me.name();
            return names.computeIfAbsent(userId, id -> {
                try {
                    return authority.requireMember(me.userId(), id).name();
                } catch (RuntimeException unresolved) {
                    return null;
                }
            });
        }
    }
}
