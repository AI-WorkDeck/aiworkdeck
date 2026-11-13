// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.pitch;

import com.checkba.model.entity.pitch.PitchEntryUse;
import com.checkba.model.entity.pitch.PitchSharedEntry;
import com.checkba.repository.pitch.PitchEntryUseRepository;
import com.checkba.repository.pitch.PitchSharedEntryRepository;
import com.checkba.service.LangText;
import com.checkba.service.lawfirm.LawFirmAuthority;
import com.checkba.service.lawfirm.LawFirmCloudFeature;
import com.checkba.service.lawfirm.LawFirmCloudVersions;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 律所云端 pitch 功能：律师把自己的业绩或简历分享给团队或全所，同事检索后用进自己的投标材料，作者能看到被用在哪里。
 *
 * <p>可见性全部在服务端判断：只看同一律所；scope=firm 全所可见；scope=team 只有与条目团队有交集的同事可见
 * （查看人的团队以账户名录为准，每次检索现查）。作者随时撤回，撤回即清空内容，此后检索不到；已生成的文件不受影响。
 * 上传的只有作者选定的字段，真实客户名仅在作者勾选时保存。
 */
@Component
public class PitchCloudFeature implements LawFirmCloudFeature {
    static final Set<String> KINDS = Set.of("credential", "lawyer");
    static final Set<String> SCOPES = Set.of("team", "firm");
    /** 允许上传的字段及长度上限；其余字段一律丢弃。 */
    static final Map<String, Integer> CREDENTIAL_FIELDS = Map.ofEntries(
            Map.entry("title", 200), Map.entry("clientAlias", 120), Map.entry("client", 200), Map.entry("area", 60),
            Map.entry("year", 8), Map.entry("amount", 120), Map.entry("role", 60), Map.entry("summary", 1200),
            Map.entry("scopeOfWork", 1200), Map.entry("highlights", 1200), Map.entry("outcome", 600), Map.entry("period", 60));
    static final Map<String, Integer> LAWYER_FIELDS = Map.of(
            "name", 60, "title", 60, "since", 8, "education", 200, "bio", 1500);
    static final Set<String> LIST_FIELDS = Set.of("lawyers", "tags", "areas");
    static final int MAX_LIST = 20;
    static final int SEARCH_LIMIT = 200;

    private static final ObjectMapper JSON = new ObjectMapper();
    private final LawFirmAuthority authority;
    private final PitchSharedEntryRepository entries;
    private final PitchEntryUseRepository uses;

    public PitchCloudFeature(LawFirmAuthority authority, PitchSharedEntryRepository entries, PitchEntryUseRepository uses) {
        this.authority = authority;
        this.entries = entries;
        this.uses = uses;
    }

    @Override public String key() { return "pitch"; }

    @Override public Set<String> pluginIds() { return Set.of("pitch-materials"); }

    @Override public Map<String, String> names() {
        return Map.of("zh-CN", "投标与提案：共享业绩与简历", "zh-TW", "投標與提案：共享業績與簡歷",
                "en-US", "Bids and proposals: shared experience");
    }

    @Override public Map<String, String> descriptions() {
        return Map.of("zh-CN", "律师可以把自己的业绩和简历分享给团队或全所，同事做投标材料时检索使用；作者随时可以撤回。",
                "zh-TW", "律師可以把自己的業績和簡歷分享給團隊或全所，同事製作投標材料時檢索使用；作者隨時可以撤回。",
                "en-US", "Lawyers can share their own credentials and profiles with their team or the whole firm for colleagues' bids; the author can withdraw them at any time.");
    }

    @Override
    @Transactional
    public long purge(String firmId) {
        return uses.deleteByFirmId(firmId) + entries.deleteByFirmId(firmId);
    }

    @Override
    @Transactional
    public Map<String, Object> execute(LawFirmAuthority.Member me, String action, Map<String, Object> params) {
        Map<String, Object> p = params == null ? Map.of() : params;
        return switch (action) {
            case "pitch.context" -> context(me);
            case "pitch.share" -> share(me, p);
            case "pitch.withdraw" -> withdraw(me, p);
            case "pitch.mine" -> mine(me);
            case "pitch.search" -> search(me, p);
            case "pitch.recordUse" -> recordUse(me, p);
            case "pitch.usage" -> usage(me, p);
            default -> throw new IllegalArgumentException(LangText.of("不支持的投标共享操作", "Unsupported shared-experience action"));
        };
    }

    // ------------------------------------------------------------------ 动作

    private Map<String, Object> context(LawFirmAuthority.Member me) {
        LawFirmAuthority.Scope scope = authority.scope(me.userId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", me.name());
        out.put("teams", new ArrayList<>(new TreeSet<>(scope.teamIds())));
        return out;
    }

    private Map<String, Object> share(LawFirmAuthority.Member me, Map<String, Object> p) {
        String localId = text(p.get("localId"), 64);
        String kind = text(p.get("kind"), 16);
        String scope = text(p.get("scope"), 8);
        if (localId.isEmpty() || !KINDS.contains(kind) || !SCOPES.contains(scope)) throw invalid();
        boolean includeClient = Boolean.TRUE.equals(p.get("includeClient")) && "credential".equals(kind);
        Set<String> teams = new TreeSet<>();
        if ("team".equals(scope)) {
            // 只能分享给自己当前所在的团队（名录现查）；多个团队时必须明确选
            Set<String> mine = authority.scope(me.userId()).teamIds();
            for (Object t : p.get("teams") instanceof Collection<?> c ? c : List.of()) {
                String id = String.valueOf(t).trim();
                if (!mine.contains(id)) throw new IllegalArgumentException(LangText.of("只能分享给你所在的团队", "You can only share with teams you belong to"));
                teams.add(id);
            }
            if (teams.isEmpty()) {
                if (mine.size() != 1) throw new IllegalArgumentException(LangText.of("请选择要分享给哪个团队", "Choose the team to share with"));
                teams.addAll(mine);
            }
        }
        Map<String, Object> payload = sanitize(kind, p.get("payload"), includeClient);
        Instant now = Instant.now();
        PitchSharedEntry e = entries.findByFirmIdAndOwnerUserIdAndLocalId(me.firmId(), me.userId(), localId).orElse(null);
        if (e == null) {
            e = new PitchSharedEntry();
            e.setId(UUID.randomUUID().toString());
            e.setFirmId(me.firmId());
            e.setOwnerUserId(me.userId());
            e.setLocalId(localId);
            e.setCreatedAt(now);
        } else {
            LawFirmCloudVersions.check(p, e.getVersion());
        }
        e.setOwnerName(text(me.name(), 128));
        e.setKind(kind);
        e.setScope(scope);
        e.setTeamIds(String.join(",", teams));
        e.setIncludeClient(includeClient);
        e.setPayloadJson(write(payload));
        e.setUpdatedAt(now);
        e.setWithdrawnAt(null);
        e = entries.saveAndFlush(e);
        return Map.of("id", e.getId(), "version", e.getVersion());
    }

    private Map<String, Object> withdraw(LawFirmAuthority.Member me, Map<String, Object> p) {
        PitchSharedEntry e = owned(me, p);
        if (e.getWithdrawnAt() == null) {
            e.setWithdrawnAt(Instant.now());
            e.setPayloadJson(null);
            e.setUpdatedAt(Instant.now());
            e = entries.saveAndFlush(e);
        }
        return Map.of("id", e.getId(), "withdrawn", true, "version", e.getVersion());
    }

    private Map<String, Object> mine(LawFirmAuthority.Member me) {
        List<PitchSharedEntry> list = entries.findByFirmIdAndOwnerUserId(me.firmId(), me.userId());
        Map<String, Long> counts = new HashMap<>();
        if (!list.isEmpty()) {
            for (PitchEntryUse u : uses.findByFirmIdAndEntryIdIn(me.firmId(), list.stream().map(PitchSharedEntry::getId).toList())) {
                counts.merge(u.getEntryId(), 1L, Long::sum);
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (PitchSharedEntry e : list) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.getId());
            m.put("localId", e.getLocalId());
            m.put("kind", e.getKind());
            m.put("scope", e.getScope());
            m.put("teams", splitTeams(e.getTeamIds()));
            m.put("includeClient", e.isIncludeClient());
            m.put("withdrawn", e.getWithdrawnAt() != null);
            m.put("version", e.getVersion());
            m.put("updatedAt", e.getUpdatedAt().toString());
            m.put("uses", counts.getOrDefault(e.getId(), 0L));
            out.add(m);
        }
        return Map.of("entries", out);
    }

    private Map<String, Object> search(LawFirmAuthority.Member me, Map<String, Object> p) {
        LawFirmAuthority.Scope viewer = authority.scope(me.userId());
        String kind = text(p.get("kind"), 16);
        String q = text(p.get("query"), 200).toLowerCase(Locale.ROOT);
        List<Map<String, Object>> out = new ArrayList<>();
        for (PitchSharedEntry e : entries.findByFirmIdAndWithdrawnAtIsNull(me.firmId())) {
            if (e.getOwnerUserId().equals(me.userId())) continue;
            if (!kind.isEmpty() && !kind.equals(e.getKind())) continue;
            if (!visible(e, viewer)) continue;
            if (!q.isEmpty() && (e.getPayloadJson() == null || !e.getPayloadJson().toLowerCase(Locale.ROOT).contains(q))) continue;
            out.add(view(e));
            if (out.size() >= SEARCH_LIMIT) break;
        }
        return Map.of("entries", out);
    }

    private Map<String, Object> recordUse(LawFirmAuthority.Member me, Map<String, Object> p) {
        LawFirmAuthority.Scope viewer = authority.scope(me.userId());
        String label = text(p.get("label"), 200);
        int recorded = 0;
        for (Object raw : p.get("ids") instanceof Collection<?> c ? c : List.of()) {
            if (recorded >= 50) break;
            PitchSharedEntry e = entries.findById(String.valueOf(raw)).orElse(null);
            // 只能记录对自己可见的、别人的条目（不能借此探测别人的条目是否存在）
            if (e == null || !me.firmId().equals(e.getFirmId()) || e.getWithdrawnAt() != null
                    || e.getOwnerUserId().equals(me.userId()) || !visible(e, viewer)) continue;
            PitchEntryUse u = new PitchEntryUse();
            u.setFirmId(me.firmId());
            u.setEntryId(e.getId());
            u.setUsedByUserId(me.userId());
            u.setUsedByName(text(me.name(), 128));
            u.setLabel(label);
            u.setUsedAt(Instant.now());
            uses.save(u);
            recorded++;
        }
        return Map.of("recorded", recorded);
    }

    private Map<String, Object> usage(LawFirmAuthority.Member me, Map<String, Object> p) {
        PitchSharedEntry e = owned(me, p);
        List<Map<String, Object>> out = new ArrayList<>();
        for (PitchEntryUse u : uses.findByFirmIdAndEntryIdOrderByUsedAtDesc(me.firmId(), e.getId())) {
            out.add(Map.of("by", u.getUsedByName() == null ? "" : u.getUsedByName(), "label", u.getLabel() == null ? "" : u.getLabel(),
                    "at", u.getUsedAt().toString()));
            if (out.size() >= 200) break;
        }
        return Map.of("uses", out);
    }

    // ------------------------------------------------------------------ 规则

    static boolean visible(PitchSharedEntry e, LawFirmAuthority.Scope viewer) {
        if (!viewer.inFirm(e.getFirmId())) return false;
        if ("firm".equals(e.getScope())) return true;
        return "team".equals(e.getScope()) && viewer.sharesTeam(splitTeams(e.getTeamIds()));
    }

    private PitchSharedEntry owned(LawFirmAuthority.Member me, Map<String, Object> p) {
        String id = text(p.get("id"), 36);
        PitchSharedEntry e = entries.findById(id).orElse(null);
        if (e == null || !me.firmId().equals(e.getFirmId()) || !me.userId().equals(e.getOwnerUserId())) {
            throw new IllegalArgumentException(LangText.of("找不到这条分享", "Shared entry not found"));
        }
        return e;
    }

    private Map<String, Object> view(PitchSharedEntry e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.getId());
        m.put("kind", e.getKind());
        m.put("owner", e.getOwnerName() == null ? "" : e.getOwnerName());
        m.put("scope", e.getScope());
        m.put("includeClient", e.isIncludeClient());
        m.put("updatedAt", e.getUpdatedAt().toString());
        m.put("payload", read(e.getPayloadJson()));
        return m;
    }

    /** 只留白名单字段、截断长度；没勾选时去掉真实客户名。 */
    static Map<String, Object> sanitize(String kind, Object raw, boolean includeClient) {
        if (!(raw instanceof Map<?, ?> in)) throw invalid();
        Map<String, Integer> fields = "credential".equals(kind) ? CREDENTIAL_FIELDS : LAWYER_FIELDS;
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Integer> f : fields.entrySet()) {
            if ("client".equals(f.getKey()) && !includeClient) continue;
            String v = text(in.get(f.getKey()), f.getValue());
            if (!v.isEmpty()) out.put(f.getKey(), v);
        }
        for (String f : LIST_FIELDS) {
            if (in.get(f) instanceof Collection<?> c) {
                List<String> vals = new ArrayList<>();
                for (Object o : c) {
                    String v = text(o, 60);
                    if (!v.isEmpty() && vals.size() < MAX_LIST) vals.add(v);
                }
                if (!vals.isEmpty()) out.put(f, vals);
            }
        }
        String required = "credential".equals(kind) ? "title" : "name";
        if (!out.containsKey(required)) throw invalid();
        return out;
    }

    private static List<String> splitTeams(String s) {
        if (s == null || s.isBlank()) return List.of();
        return Arrays.stream(s.split(",")).map(String::trim).filter(t -> !t.isEmpty()).toList();
    }

    private static String text(Object v, int max) {
        if (v == null) return "";
        String s = String.valueOf(v).replaceAll("[\\p{Cntrl}&&[^\\n]]", "").trim();
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException(LangText.of("分享内容不完整或格式不正确", "The shared entry is incomplete or malformed"));
    }

    private static String write(Map<String, Object> m) {
        try { return JSON.writeValueAsString(m); } catch (Exception e) { throw invalid(); }
    }

    private static Map<String, Object> read(String s) {
        if (s == null || s.isBlank()) return Map.of();
        try { return JSON.readValue(s, new TypeReference<Map<String, Object>>() {}); } catch (Exception e) { return Map.of(); }
    }
}
